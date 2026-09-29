import shutil
import unittest
from unittest import mock

from fastapi.testclient import TestClient

from app import api


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(api.app)
        api._UPLOADS.clear()
        shutil.rmtree(api.UPLOAD_DIR, ignore_errors=True)

    def tearDown(self):
        api._UPLOADS.clear()
        shutil.rmtree(api.UPLOAD_DIR, ignore_errors=True)

    def test_health(self):
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok"})

    def test_upload_analyze_profile_flow(self):
        upload = self.client.post(
            "/api/upload",
            files=[("files", ("a.pdf", b"%PDF-fake", "application/pdf"))],
        )
        self.assertEqual(upload.status_code, 201)
        upload_id = upload.json()["upload_id"]
        self.assertTrue(upload_id.startswith("upl_"))

        profile = {"schema_version": "1.0.0", "candidate": {"basic_info": {}}}
        with mock.patch.object(api, "parse_document", return_value=object()), mock.patch.object(
            api, "extract_profile", return_value=(profile, [])
        ), mock.patch.object(api, "verify_profile", return_value=profile):
            analyzed = self.client.post("/api/analyze", json={"upload_id": upload_id})

        self.assertEqual(analyzed.status_code, 200)
        body = analyzed.json()
        self.assertEqual(body["status"], "completed")
        self.assertEqual(body["schema_version"], "1.0.0")
        self.assertTrue(body["profile_id"].startswith("prf_"))

        fetched = self.client.get(
            "/api/profile", params={"upload_id": upload_id}
        )
        self.assertEqual(fetched.status_code, 200)
        self.assertEqual(fetched.json()["schema_version"], "1.0.0")

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


if __name__ == "__main__":
    unittest.main()
