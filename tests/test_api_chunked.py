import shutil
import time
import unittest
from unittest import mock

from fastapi.testclient import TestClient

from app import api


class ChunkedUploadTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(api.app)
        api._UPLOADS.clear()
        api._CHUNK_SESSIONS.clear()
        shutil.rmtree(api.UPLOAD_DIR, ignore_errors=True)

    def tearDown(self):
        api._UPLOADS.clear()
        api._CHUNK_SESSIONS.clear()
        shutil.rmtree(api.UPLOAD_DIR, ignore_errors=True)

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
            self._put_chunk(session_id, 0, 0, payload[: api.CHUNK_SIZE]).status_code,
            200,
        )
        self.assertEqual(
            self._put_chunk(session_id, 0, 1, payload[api.CHUNK_SIZE :]).status_code,
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

    def test_chunked_upload_single_chunk_multiple_files(self):
        session = self._init_session(
            [
                {"filename": "a.pdf", "total_bytes": 5},
                {"filename": "b.docx", "total_bytes": 3},
            ]
        )
        session_id = session["session_id"]
        self._put_chunk(session_id, 0, 0, b"hello")
        self._put_chunk(session_id, 1, 0, b"bye")
        complete = self.client.post(
            f"/api/upload/session/{session_id}/complete"
        )
        self.assertEqual(complete.status_code, 201)
        filenames = sorted(d["filename"] for d in complete.json()["documents"])
        self.assertEqual(filenames, ["a.pdf", "b.docx"])

    def test_chunked_upload_missing_chunk_is_409(self):
        session = self._init_session(
            [{"filename": "a.pdf", "total_bytes": api.CHUNK_SIZE + 1}]
        )
        session_id = session["session_id"]
        self._put_chunk(session_id, 0, 0, b"x" * api.CHUNK_SIZE)
        complete = self.client.post(
            f"/api/upload/session/{session_id}/complete"
        )
        self.assertEqual(complete.status_code, 409)
        self.assertEqual(complete.json()["detail"]["code"], "incomplete_upload")

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
        response = self.client.post("/api/upload/init", json={"files": files})
        self.assertEqual(response.status_code, 413)

    def test_chunked_init_rejects_oversized_file(self):
        response = self.client.post(
            "/api/upload/init",
            json={
                "files": [
                    {"filename": "huge.pdf", "total_bytes": api.DEFAULT_MAX_FILE_BYTES + 1}
                ]
            },
        )
        self.assertEqual(response.status_code, 413)
        self.assertEqual(response.json()["detail"]["code"], "file_too_large")


class AsyncAnalyzeTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(api.app)
        api._UPLOADS.clear()
        api._CHUNK_SESSIONS.clear()
        shutil.rmtree(api.UPLOAD_DIR, ignore_errors=True)

    def tearDown(self):
        api._UPLOADS.clear()
        api._CHUNK_SESSIONS.clear()
        shutil.rmtree(api.UPLOAD_DIR, ignore_errors=True)

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
            if response.status_code == 500:
                return response
            if response.json().get("status") in done_statuses:
                return response
            time.sleep(0.05)
        raise AssertionError("analysis did not finish in time")

    def test_analyze_returns_processing_then_partial_with_warnings(self):
        upload_id = self._upload_one()
        profile = {"schema_version": "1.0.0", "candidate": {"basic_info": {}}}

        def fake_verify(profile_arg, verify_web=False, search=None, warnings=None):
            if warnings is not None:
                warnings.append("boom")
            return profile_arg

        with mock.patch.object(api, "parse_document", return_value=object()), mock.patch.object(
            api, "extract_profile", return_value=(profile, [])
        ), mock.patch.object(api, "verify_profile", side_effect=fake_verify):
            started = self.client.post("/api/analyze", json={"upload_id": upload_id})
            self.assertEqual(started.status_code, 202)
            done = self._wait(upload_id, {"completed", "partial"})

        self.assertEqual(done.status_code, 200)
        self.assertEqual(done.json()["status"], "partial")
        self.assertEqual(done.json()["warnings"], ["boom"])

    def test_analyze_failure_is_marked_failed_not_stuck(self):
        upload_id = self._upload_one()
        with mock.patch.object(api, "parse_document", return_value=object()), mock.patch.object(
            api, "extract_profile", side_effect=RuntimeError("boom")
        ):
            started = self.client.post("/api/analyze", json={"upload_id": upload_id})
            self.assertEqual(started.status_code, 202)
            failed = self._wait(upload_id, {"failed"})

        self.assertEqual(failed.status_code, 500)
        self.assertEqual(failed.json()["detail"]["code"], "analysis_failed")


if __name__ == "__main__":
    unittest.main()
