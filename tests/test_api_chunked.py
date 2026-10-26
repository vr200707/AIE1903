import os
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest import mock

from fastapi.testclient import TestClient

from app import api
from app.parser import PageText, ParsedDocument
from app.resilience import warning


def _parsed() -> ParsedDocument:
    return ParsedDocument(
        filename="a.pdf",
        content_type="application/pdf",
        pages=[PageText(page_number=1, text="Extracted candidate text")],
        warnings=[],
    )


def _profile() -> dict:
    return {
        "schema_version": "1.0.0",
        "candidate": {
            "basic_info": {
                "name": "Alice",
                "institution": "Example University",
                "position": "Professor",
                "research_interests": [],
                "highest_degree": "PhD",
                "skills": [],
                "strengths": [],
                "to_verify": [],
                "evidence": [],
            },
            "education_employment": {"education": [], "employment": []},
            "awards_funding": {"awards": [], "funding": []},
            "publications_impact": {
                "publications": [],
                "total_citations": None,
                "citation_query_date": None,
            },
            "academic_service": {"services": []},
            "overall_evaluation": {
                "summary": None,
                "strengths": [],
                "risks": [],
                "dimensions": [],
            },
        },
    }


def _assessment():
    return {"overall": 7.5, "modules": {}}


class TemporaryUploadDirsMixin:
    def setUp(self):
        self.client = TestClient(api.app)
        api._UPLOADS.clear()
        api._CHUNK_SESSIONS.clear()
        self.original_upload_dir = api.UPLOAD_DIR
        self.original_chunk_dir = api.CHUNK_DIR
        self.original_profile_dir = api.PROFILE_DIR
        self.temp_dir = tempfile.TemporaryDirectory()
        api.UPLOAD_DIR = Path(self.temp_dir.name) / "uploads"
        api.CHUNK_DIR = api.UPLOAD_DIR / ".chunks"
        api.PROFILE_DIR = Path(self.temp_dir.name) / "profiles"

    def tearDown(self):
        api._UPLOADS.clear()
        api._CHUNK_SESSIONS.clear()
        api.UPLOAD_DIR = self.original_upload_dir
        api.CHUNK_DIR = self.original_chunk_dir
        api.PROFILE_DIR = self.original_profile_dir
        self.temp_dir.cleanup()


class ChunkedUploadTests(TemporaryUploadDirsMixin, unittest.TestCase):
    def _init_session(self, files):
        response = self.client.post("/api/upload/init", json={"files": files})
        self.assertEqual(response.status_code, 201)
        return response.json()

    def _put_chunk(self, session_id, file_index, chunk_index, data):
        return self.client.put(
            f"/api/upload/session/{session_id}/files/{file_index}/chunks/{chunk_index}",
            content=data,
            headers={"Content-Type": "application/octet-stream"},
        )

    def test_chunked_upload_reassembles_multi_chunk_file(self):
        payload = b"x" * (api.CHUNK_SIZE + 12345)
        session = self._init_session(
            [{"filename": "big.pdf", "total_bytes": len(payload)}]
        )
        session_id = session["session_id"]
        self.assertEqual(session["files"][0]["chunk_count"], 2)
        self.assertEqual(
            self._put_chunk(
                session_id,
                0,
                0,
                payload[: api.CHUNK_SIZE],
            ).status_code,
            200,
        )
        self.assertEqual(
            self._put_chunk(
                session_id,
                0,
                1,
                payload[api.CHUNK_SIZE :],
            ).status_code,
            200,
        )

        complete = self.client.post(
            f"/api/upload/session/{session_id}/complete"
        )
        self.assertEqual(complete.status_code, 201)
        body = complete.json()
        self.assertTrue(body["upload_id"].startswith("upl_"))
        self.assertEqual(body["documents"][0]["size_bytes"], len(payload))
        saved = api.UPLOAD_DIR / body["upload_id"] / "big.pdf"
        self.assertEqual(saved.read_bytes(), payload)
        self.assertNotIn(session_id, api._CHUNK_SESSIONS)

    def test_chunked_upload_single_chunk_multiple_files(self):
        session = self._init_session(
            [
                {"filename": "a.pdf", "total_bytes": 5},
                {"filename": "b.docx", "total_bytes": 3},
            ]
        )
        session_id = session["session_id"]
        self.assertEqual(
            self._put_chunk(session_id, 0, 0, b"hello").status_code,
            200,
        )
        self.assertEqual(
            self._put_chunk(session_id, 1, 0, b"bye").status_code,
            200,
        )
        complete = self.client.post(
            f"/api/upload/session/{session_id}/complete"
        )
        self.assertEqual(complete.status_code, 201)
        filenames = sorted(
            item["filename"] for item in complete.json()["documents"]
        )
        self.assertEqual(filenames, ["a.pdf", "b.docx"])

    def test_missing_chunk_keeps_session_without_orphan_upload(self):
        session = self._init_session(
            [{"filename": "a.pdf", "total_bytes": api.CHUNK_SIZE + 1}]
        )
        session_id = session["session_id"]
        self._put_chunk(session_id, 0, 0, b"x" * api.CHUNK_SIZE)

        complete = self.client.post(
            f"/api/upload/session/{session_id}/complete"
        )
        self.assertEqual(complete.status_code, 409)
        self.assertEqual(
            complete.json()["detail"]["code"],
            "incomplete_upload",
        )
        self.assertIn(session_id, api._CHUNK_SESSIONS)
        upload_dirs = [
            path
            for path in api.UPLOAD_DIR.iterdir()
            if path.is_dir() and path.name != ".chunks"
        ]
        self.assertEqual(upload_dirs, [])

    def test_oversized_chunk_is_rejected_before_finalizing(self):
        session = self._init_session(
            [{"filename": "a.pdf", "total_bytes": 3}]
        )
        session_id = session["session_id"]
        response = self._put_chunk(session_id, 0, 0, b"toolarge")
        self.assertEqual(response.status_code, 413)
        self.assertEqual(response.json()["detail"]["code"], "chunk_too_large")

    def test_duplicate_filenames_are_rejected(self):
        response = self.client.post(
            "/api/upload/init",
            json={
                "files": [
                    {"filename": "a.pdf", "total_bytes": 1},
                    {"filename": "a.pdf", "total_bytes": 1},
                ]
            },
        )
        self.assertEqual(response.status_code, 422)
        self.assertEqual(
            response.json()["detail"]["code"],
            "duplicate_filename",
        )

    def test_chunked_init_rejects_unsupported_suffix(self):
        response = self.client.post(
            "/api/upload/init",
            json={"files": [{"filename": "notes.txt", "total_bytes": 10}]},
        )
        self.assertEqual(response.status_code, 422)

    def test_chunked_init_rejects_too_many_files(self):
        files = [
            {"filename": f"{index}.pdf", "total_bytes": 1}
            for index in range(5)
        ]
        response = self.client.post(
            "/api/upload/init",
            json={"files": files},
        )
        self.assertEqual(response.status_code, 413)

    def test_chunked_init_rejects_oversized_file(self):
        response = self.client.post(
            "/api/upload/init",
            json={
                "files": [
                    {
                        "filename": "huge.pdf",
                        "total_bytes": api.DEFAULT_MAX_FILE_BYTES + 1,
                    }
                ]
            },
        )
        self.assertEqual(response.status_code, 413)
        self.assertEqual(
            response.json()["detail"]["code"],
            "file_too_large",
        )

    def test_max_file_size_can_be_overridden(self):
        with mock.patch.dict(
            os.environ,
            {"MAX_FILE_BYTES": str(api.CHUNK_SIZE * 2)},
        ):
            session = self._init_session(
                [{"filename": "big.pdf", "total_bytes": api.CHUNK_SIZE * 2}]
            )
        self.assertEqual(session["files"][0]["chunk_count"], 2)

    def test_expired_session_is_cleaned_up(self):
        old = self._init_session(
            [{"filename": "old.pdf", "total_bytes": 1}]
        )["session_id"]
        api._CHUNK_SESSIONS[old]["updated_at"] = 0

        self._init_session([{"filename": "new.pdf", "total_bytes": 1}])

        self.assertNotIn(old, api._CHUNK_SESSIONS)
        self.assertFalse((api.CHUNK_DIR / old).exists())

    def test_active_session_limit_is_enforced(self):
        with mock.patch.dict(os.environ, {"MAX_CHUNK_SESSIONS": "1"}):
            self._init_session([{"filename": "one.pdf", "total_bytes": 1}])
            response = self.client.post(
                "/api/upload/init",
                json={"files": [{"filename": "two.pdf", "total_bytes": 1}]},
            )
        self.assertEqual(response.status_code, 429)
        self.assertEqual(
            response.json()["detail"]["code"],
            "too_many_upload_sessions",
        )


class AsyncAnalyzeTests(TemporaryUploadDirsMixin, unittest.TestCase):
    def _upload_one(self):
        response = self.client.post(
            "/api/upload",
            files=[("files", ("a.pdf", b"%PDF-fake", "application/pdf"))],
        )
        return response.json()["upload_id"]

    def _wait(self, upload_id, done_statuses, timeout=5.0):
        deadline = time.time() + timeout
        while time.time() < deadline:
            response = self.client.get(f"/api/analyze/{upload_id}")
            if response.json().get("status") in done_statuses:
                return response
            time.sleep(0.05)
        raise AssertionError("analysis did not finish in time")

    def test_analyze_returns_immediately_and_emits_structured_warnings(self):
        upload_id = self._upload_one()
        release = threading.Event()
        entered = threading.Event()

        def blocked_extract(documents):
            entered.set()
            release.wait(timeout=5)
            return _profile(), []

        warning_item = warning(
            "verification_dependency_failed",
            "verification",
            "External source unavailable",
            retryable=True,
        )
        started_at = time.monotonic()
        with mock.patch.object(
            api, "parse_document", return_value=_parsed()
        ), mock.patch.object(
            api,
            "extract_profile",
            side_effect=blocked_extract,
        ), mock.patch.object(
            api,
            "verify_profile",
            side_effect=lambda profile, verify_web, on_progress=None: profile,
        ), mock.patch.object(
            api,
            "collect_retryable_verification_warnings",
            return_value=[warning_item],
        ), mock.patch.object(
            api, "score_candidate", return_value=_assessment()
        ):
            try:
                started = self.client.post(
                    "/api/analyze",
                    json={"upload_id": upload_id},
                )
                elapsed = time.monotonic() - started_at
                self.assertEqual(started.status_code, 202)
                self.assertLess(elapsed, 2.0)
                self.assertTrue(entered.wait(timeout=1))
            finally:
                release.set()
            done = self._wait(
                upload_id,
                {"completed", "completed_with_warnings"},
            )

        self.assertEqual(done.status_code, 200)
        self.assertEqual(done.json()["status"], "completed_with_warnings")
        self.assertEqual(
            done.json()["warnings"][0]["code"],
            "verification_dependency_failed",
        )

    def test_analyze_failure_is_pollable_without_sticking(self):
        upload_id = self._upload_one()
        with mock.patch.object(
            api, "parse_document", return_value=_parsed()
        ), mock.patch.object(
            api,
            "extract_profile",
            side_effect=RuntimeError("boom"),
        ):
            started = self.client.post(
                "/api/analyze",
                json={"upload_id": upload_id},
            )
            self.assertEqual(started.status_code, 202)
            failed = self._wait(upload_id, {"failed"})

        self.assertEqual(failed.status_code, 200)
        self.assertEqual(failed.json()["status"], "failed")
        self.assertEqual(
            failed.json()["error"]["code"],
            "extraction_failed",
        )


if __name__ == "__main__":
    unittest.main()
