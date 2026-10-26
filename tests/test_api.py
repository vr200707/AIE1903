import json
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

from fastapi.testclient import TestClient

from app import api
from app.parser import PageText, ParsedDocument


def _parsed(text="Extracted candidate text", warnings=None):
    return ParsedDocument(
        filename="a.pdf",
        content_type="application/pdf",
        pages=[PageText(page_number=1, text=text)],
        warnings=warnings or [],
    )


def _full_profile():
    return {
        "schema_version": "1.0.0",
        "candidate": {
            "basic_info": {
                "name": "Alice",
                "institution": "Example University",
                "position": "Associate Professor",
                "research_interests": [],
                "highest_degree": "PhD",
                "skills": [],
                "strengths": [],
                "to_verify": [],
                "evidence": [],
            },
            "education_employment": {"education": [], "employment": []},
            "awards_funding": {
                "awards": [
                    {
                        "name": "Best Paper Award",
                        "year": 2023,
                        "awarding_body": "IEEE",
                        "evidence": [],
                    }
                ],
                "funding": [],
            },
            "publications_impact": {
                "publications": [
                    {
                        "title": "Evidence Grounded Systems",
                        "year": 2024,
                        "author_role": "first_author",
                        "venue": "ExampleConf",
                        "venue_type": "conference",
                        "ranking": None,
                        "citation_count": None,
                        "citation_query_date": None,
                        "code_repository": None,
                        "repository_stars": None,
                        "stars_query_date": None,
                        "evidence": [],
                    }
                ],
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


class ApiTests(unittest.TestCase):
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

    def _wait_analysis(self, upload_id: str, timeout: float = 5.0):
        deadline = time.time() + timeout
        while time.time() < deadline:
            response = self.client.get(f"/api/analyze/{upload_id}")
            body = response.json()
            if body.get("status") in (
                "completed",
                "completed_with_warnings",
                "failed",
            ):
                return response
            time.sleep(0.05)
        raise AssertionError("analysis did not finish in time")

    def test_health(self):
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok"})

    def test_liveness_is_independent_of_dependencies(self):
        response = self.client.get("/health/live")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok"})

    def test_ready_returns_503_when_not_ready(self):
        payload = {"status": "degraded", "checks": {}}
        with mock.patch.object(
            api.health_monitor, "check_readiness", return_value=payload
        ):
            response = self.client.get("/health/ready")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["status"], "degraded")

    def test_dependencies_endpoint_returns_observed_state(self):
        payload = {"deepseek": {"status": "unknown"}}
        with mock.patch.object(
            api.health_monitor, "dependency_snapshot", return_value=payload
        ):
            response = self.client.get("/health/dependencies")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), payload)

    def test_upload_analyze_profile_flow(self):
        upload = self.client.post(
            "/api/upload",
            files=[("files", ("a.pdf", b"%PDF-fake", "application/pdf"))],
        )
        self.assertEqual(upload.status_code, 201)
        upload_id = upload.json()["upload_id"]
        self.assertTrue(upload_id.startswith("upl_"))

        profile = {"schema_version": "1.0.0", "candidate": {"basic_info": {}}}
        with mock.patch.object(api, "parse_document", return_value=_parsed()), mock.patch.object(
            api, "extract_profile", return_value=(profile, [])
        ), mock.patch.object(
            api, "verify_profile", return_value=profile
        ), mock.patch.object(api, "score_candidate", return_value=_assessment()):
            started = self.client.post("/api/analyze", json={"upload_id": upload_id})
            self.assertEqual(started.status_code, 202)
            self.assertEqual(started.json()["status"], "processing")
            analyzed = self._wait_analysis(upload_id)

        self.assertEqual(analyzed.status_code, 200)
        body = analyzed.json()
        self.assertEqual(body["status"], "completed")
        self.assertEqual(body["schema_version"], "1.0.0")
        self.assertEqual(body["warnings"], [])
        self.assertTrue(body["profile_id"].startswith("prf_"))

        fetched = self.client.get(
            "/api/profile", params={"upload_id": upload_id}
        )
        self.assertEqual(fetched.status_code, 200)
        self.assertEqual(fetched.json()["schema_version"], "1.0.0")

    def test_analyze_keeps_other_documents_when_one_parse_fails(self):
        api._UPLOADS["upl_partial"] = {
            "documents": [],
            "paths": ["broken.pdf", "good.pdf"],
        }
        with mock.patch.object(
            api,
            "parse_document",
            side_effect=[RuntimeError("broken"), _parsed()],
        ), mock.patch.object(
            api, "extract_profile", return_value=(_full_profile(), [])
        ), mock.patch.object(
            api,
            "verify_profile",
            side_effect=lambda profile, verify_web, on_progress=None: profile,
        ), mock.patch.object(
            api, "score_candidate", return_value=_assessment()
        ):
            started = self.client.post(
                "/api/analyze", json={"upload_id": "upl_partial"}
            )
            self.assertEqual(started.status_code, 202)
            response = self._wait_analysis("upl_partial")

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["status"], "completed_with_warnings")
        self.assertEqual(body["warnings"][0]["code"], "document_parse_failed")
        self.assertTrue(body["warnings"][0]["retryable"] is False)

    def test_analyze_keeps_profile_when_verification_crashes(self):
        api._UPLOADS["upl_verify_fail"] = {
            "documents": [],
            "paths": ["good.pdf"],
        }
        with mock.patch.object(
            api, "parse_document", return_value=_parsed()
        ), mock.patch.object(
            api, "extract_profile", return_value=(_full_profile(), [])
        ), mock.patch.object(
            api, "verify_profile", side_effect=RuntimeError("network")
        ), mock.patch.object(
            api, "score_candidate", return_value=_assessment()
        ):
            started = self.client.post(
                "/api/analyze", json={"upload_id": "upl_verify_fail"}
            )
            self.assertEqual(started.status_code, 202)
            response = self._wait_analysis("upl_verify_fail")

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["status"], "completed_with_warnings")
        self.assertEqual(body["warnings"][0]["code"], "verification_incomplete")
        publication = body["candidate"]["publications_impact"]["publications"][0]
        self.assertEqual(publication["evidence"][-1]["evidence_status"], "to_verify")
        self.assertIn("Retryable: yes", publication["evidence"][-1]["notes"])

    def test_analyze_surfaces_partial_verification_failure(self):
        profile = _full_profile()
        publication = profile["candidate"]["publications_impact"]["publications"][0]
        publication["evidence"].append(
            {
                "source": "OpenAlex",
                "source_url": None,
                "evidence": "OpenAlex was unavailable.",
                "evidence_status": "to_verify",
                "query_date": "2026-10-21",
                "source_type": "bibliographic_database",
                "notes": "Reason: RuntimeError. Retryable: yes.",
            }
        )
        api._UPLOADS["upl_partial_verify"] = {
            "documents": [],
            "paths": ["good.pdf"],
        }
        with mock.patch.object(
            api, "parse_document", return_value=_parsed()
        ), mock.patch.object(
            api, "extract_profile", return_value=(profile, [])
        ), mock.patch.object(
            api, "verify_profile", return_value=profile
        ), mock.patch.object(
            api, "score_candidate", return_value=_assessment()
        ):
            started = self.client.post(
                "/api/analyze", json={"upload_id": "upl_partial_verify"}
            )
            self.assertEqual(started.status_code, 202)
            response = self._wait_analysis("upl_partial_verify")

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["status"], "completed_with_warnings")
        self.assertEqual(
            body["warnings"][0]["code"], "verification_dependency_failed"
        )

    def test_analyze_rejects_when_all_documents_are_unreadable(self):
        api._UPLOADS["upl_empty"] = {"documents": [], "paths": ["empty.pdf"]}
        with mock.patch.object(
            api, "parse_document", return_value=_parsed(text="")
        ):
            started = self.client.post(
                "/api/analyze", json={"upload_id": "upl_empty"}
            )
            self.assertEqual(started.status_code, 202)
            response = self._wait_analysis("upl_empty")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "failed")
        self.assertEqual(
            response.json()["error"]["code"], "no_readable_documents"
        )

    def test_failed_analysis_can_be_retried(self):
        upload = self.client.post(
            "/api/upload",
            files=[("files", ("a.pdf", b"%PDF-fake", "application/pdf"))],
        )
        upload_id = upload.json()["upload_id"]
        profile = _full_profile()

        with mock.patch.object(
            api, "parse_document", return_value=_parsed()
        ), mock.patch.object(
            api,
            "extract_profile",
            side_effect=RuntimeError("temporary"),
        ):
            started = self.client.post(
                "/api/analyze", json={"upload_id": upload_id}
            )
            self.assertEqual(started.status_code, 202)
            failed = self._wait_analysis(upload_id)

        self.assertEqual(failed.json()["status"], "failed")
        self.assertEqual(failed.json()["error"]["code"], "extraction_failed")

        with mock.patch.object(
            api, "parse_document", return_value=_parsed()
        ), mock.patch.object(
            api, "extract_profile", return_value=(profile, [])
        ), mock.patch.object(
            api, "verify_profile", return_value=profile
        ), mock.patch.object(api, "score_candidate", return_value=_assessment()):
            retried = self.client.post(
                "/api/analyze", json={"upload_id": upload_id}
            )
            self.assertEqual(retried.status_code, 202)
            completed = self._wait_analysis(upload_id)

        self.assertEqual(completed.json()["status"], "completed")
        self.assertEqual(completed.json()["candidate"], profile["candidate"])

    def test_profile_missing_id_is_422(self):
        response = self.client.get("/api/profile")
        self.assertEqual(response.status_code, 422)

    def test_upload_rejects_too_many_files(self):
        files = [
            ("files", (f"{index}.pdf", b"x", "application/pdf"))
            for index in range(5)
        ]
        response = self.client.post("/api/upload", files=files)
        self.assertEqual(response.status_code, 413)

    def test_upload_rejects_unsupported_suffix(self):
        response = self.client.post(
            "/api/upload",
            files=[("files", ("notes.txt", b"hello", "text/plain"))],
        )
        self.assertEqual(response.status_code, 422)

    def _seed_profile(self):
        profile = {"schema_version": "1.0.0", "candidate": {"basic_info": {}}}
        api._UPLOADS["upl_test"] = {
            "documents": [],
            "paths": [],
            "profile": profile,
            "profile_id": "prf_test",
        }
        return profile

    def test_qa_returns_answer_envelope(self):
        self._seed_profile()
        payload = {"answer": "博士。", "confidence": "high", "evidence": []}
        with mock.patch.object(api, "answer_question", return_value=payload) as patched:
            response = self.client.post(
                "/api/qa",
                json={"profile_id": "prf_test", "question": "他最高学历是什么？"},
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), payload)
        self.assertEqual(patched.call_args.args[1], "他最高学历是什么？")

    def test_qa_unknown_profile_is_404(self):
        response = self.client.post(
            "/api/qa", json={"profile_id": "prf_missing", "question": "hi"}
        )
        self.assertEqual(response.status_code, 404)

    def test_qa_missing_question_is_422(self):
        self._seed_profile()
        response = self.client.post("/api/qa", json={"profile_id": "prf_test"})
        self.assertEqual(response.status_code, 422)

    def test_qa_model_failure_is_500(self):
        self._seed_profile()
        with mock.patch.object(api, "answer_question", side_effect=ValueError("boom")):
            response = self.client.post(
                "/api/qa", json={"profile_id": "prf_test", "question": "hi"}
            )
        self.assertEqual(response.status_code, 500)


class ProfileSnapshotTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(api.app)
        api._UPLOADS.clear()
        self.original_profile_dir = api.PROFILE_DIR
        self.original_upload_dir = api.UPLOAD_DIR
        self.temp_dir = tempfile.TemporaryDirectory()
        api.PROFILE_DIR = Path(self.temp_dir.name) / "profiles"
        api.UPLOAD_DIR = Path(self.temp_dir.name) / "uploads"

    def tearDown(self):
        api._UPLOADS.clear()
        api.PROFILE_DIR = self.original_profile_dir
        api.UPLOAD_DIR = self.original_upload_dir
        self.temp_dir.cleanup()

    def _wait_analysis(self, upload_id: str, timeout: float = 5.0):
        deadline = time.time() + timeout
        while time.time() < deadline:
            response = self.client.get(f"/api/analyze/{upload_id}")
            body = response.json()
            if body.get("status") in (
                "completed",
                "completed_with_warnings",
                "failed",
            ):
                return response
            time.sleep(0.05)
        raise AssertionError("analysis did not finish in time")

    def test_completed_snapshot_survives_restart(self):
        upload = self.client.post(
            "/api/upload",
            files=[("files", ("a.pdf", b"%PDF-fake", "application/pdf"))],
        )
        self.assertEqual(upload.status_code, 201)
        upload_id = upload.json()["upload_id"]

        profile = {"schema_version": "1.0.0", "candidate": {"basic_info": {}}}
        with mock.patch.object(
            api, "parse_document", return_value=_parsed()
        ), mock.patch.object(
            api, "extract_profile", return_value=(profile, [])
        ), mock.patch.object(
            api, "verify_profile", return_value=profile
        ), mock.patch.object(api, "score_candidate", return_value=_assessment()):
            started = self.client.post(
                "/api/analyze", json={"upload_id": upload_id}
            )
            self.assertEqual(started.status_code, 202)
            analyzed = self._wait_analysis(upload_id)
        self.assertEqual(analyzed.json()["status"], "completed")

        snapshot = api.PROFILE_DIR / f"{upload_id}.json"
        self.assertTrue(snapshot.exists())

        # Simulate a process restart: drop memory and restore from disk.
        api._UPLOADS.clear()
        self.assertEqual(api.load_profile_snapshots(), 1)
        restored = api._UPLOADS[upload_id]
        self.assertEqual(restored["status"], "completed")
        self.assertTrue(restored["profile_id"].startswith("prf_"))
        self.assertEqual(
            restored["profile"]["candidate"]["basic_info"],
            {},
        )
        self.assertEqual(restored["assessment"]["overall"], 7.5)

        fetched = self.client.get(
            "/api/profile", params={"upload_id": upload_id}
        )
        self.assertEqual(fetched.status_code, 200)
        by_profile = self.client.get(
            "/api/profile", params={"profile_id": restored["profile_id"]}
        )
        self.assertEqual(by_profile.status_code, 200)

    def test_processing_snapshot_downgraded_on_load(self):
        entry = {
            "documents": [],
            "paths": [],
            "status": "processing",
            "progress": {"stage": "verifying_publications", "done": 2, "total": 4},
        }
        api._save_profile_snapshot("upl_crashed", entry)
        api._UPLOADS.clear()
        self.assertEqual(api.load_profile_snapshots(), 1)
        restored = api._UPLOADS["upl_crashed"]
        self.assertEqual(restored["status"], "created")
        self.assertIsNone(restored["error"])
        self.assertEqual(
            restored["progress"],
            {"stage": "queued", "done": 0, "total": 0},
        )
        # The downgraded state is itself persisted, so the next restart keeps it.
        payload = json.loads(
            (api.PROFILE_DIR / "upl_crashed.json").read_text(encoding="utf-8")
        )
        self.assertEqual(payload["status"], "created")


if __name__ == "__main__":
    unittest.main()
