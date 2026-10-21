import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from app import health


class HealthTests(unittest.TestCase):
    def test_readiness_checks_schema_storage_and_configuration(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            schema = root / "schema.json"
            schema.write_text(json.dumps({"type": "object"}), encoding="utf-8")

            with mock.patch.dict(
                os.environ, {"DEEPSEEK_API_KEY": "test-key"}, clear=False
            ):
                payload = health.check_readiness(
                    project_root=root,
                    schema_path=schema,
                    upload_dir=root / "uploads",
                )

        self.assertEqual(payload["status"], "ready")
        self.assertEqual(payload["checks"]["schema"]["status"], "ok")
        self.assertEqual(payload["checks"]["upload_storage"]["status"], "ok")

    def test_readiness_reports_missing_model_configuration(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            schema = root / "schema.json"
            schema.write_text("{}", encoding="utf-8")

            with mock.patch.dict(os.environ, {}, clear=True):
                payload = health.check_readiness(
                    project_root=root,
                    schema_path=schema,
                    upload_dir=root / "uploads",
                )

        self.assertEqual(payload["status"], "degraded")
        self.assertEqual(payload["checks"]["deepseek_config"]["status"], "error")

    def test_dependency_failure_records_retryable_error(self):
        health.record_dependency_failure("openalex", RuntimeError("429"))
        payload = health.dependency_snapshot()

        self.assertEqual(payload["openalex"]["status"], "error")
        self.assertEqual(payload["openalex"]["retryable"], True)
        self.assertIn("RuntimeError", payload["openalex"]["last_error"])


if __name__ == "__main__":
    unittest.main()
