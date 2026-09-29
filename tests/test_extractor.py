import json
import tempfile
import unittest
from pathlib import Path

from app import extractor
from app.parser import PageText, ParsedDocument


def _doc(name: str, text: str) -> ParsedDocument:
    return ParsedDocument(
        filename=name,
        content_type="application/pdf",
        pages=[PageText(page_number=1, text=text)],
    )


class ExtractorUnitTests(unittest.TestCase):
    def test_render_documents_adds_page_markers(self):
        doc = _doc("cv.pdf", "Hello CV")
        rendered = extractor._render_documents([doc])
        self.assertIn("cv.pdf", rendered)
        self.assertIn("[第 1 页]", rendered)
        self.assertIn("Hello CV", rendered)

    def test_validate_profile_rejects_missing_modules(self):
        bad = {"schema_version": "1.0.0", "candidate": {}}
        errors = extractor._validate_profile(bad)
        self.assertTrue(errors)

    def test_extract_profile_raises_when_all_documents_have_no_text(self):
        blank = _doc("scanned.pdf", "")
        with self.assertRaises(ValueError):
            extractor.extract_profile([blank])

    def test_cache_roundtrip(self):
        with tempfile.TemporaryDirectory() as tmp:
            original_cache = extractor.CACHE_DIR
            extractor.CACHE_DIR = Path(tmp)
            try:
                key = "test-key"
                profile = {"schema_version": "1.0.0", "candidate": {}}
                extractor._write_cache(key, profile)
                self.assertEqual(extractor._read_cache(key), profile)
            finally:
                extractor.CACHE_DIR = original_cache


if __name__ == "__main__":
    unittest.main()
