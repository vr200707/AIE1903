import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

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


def _evidence() -> dict:
    return {
        "source": "cv.pdf",
        "source_url": None,
        "evidence": "Jialun Cao",
        "evidence_status": "confirmed",
        "query_date": "2026-09-29",
        "source_type": "resume",
    }


def _meta_candidate() -> dict:
    return {
        "basic_info": {
            "name": "Jialun Cao",
            "institution": None,
            "position": None,
            "research_interests": [],
            "highest_degree": None,
            "skills": [],
            "strengths": [],
            "to_verify": [],
            "evidence": [_evidence()],
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
    }


def _publication(title: str, year: int) -> dict:
    return {
        "title": title,
        "year": year,
        "author_role": "first_author",
        "venue": "Journal",
        "venue_type": "journal",
        "ranking": None,
        "citation_count": None,
        "citation_query_date": None,
        "code_repository": None,
        "repository_stars": None,
        "stars_query_date": None,
        "evidence": [_evidence()],
    }


class ExtractorSplitTests(unittest.TestCase):
    def test_dedup_publications_keeps_first_by_normalized_title(self):
        pubs = [
            _publication("Calibration Drift in Clinical Decision Support", 2025),
            _publication("calibration drift in clinical decision-support!", 2025),
            _publication("A Different Paper", 2024),
        ]
        result = extractor._dedup_publications(pubs)
        self.assertEqual([p["title"] for p in result], [
            "Calibration Drift in Clinical Decision Support",
            "A Different Paper",
        ])

    def test_enumerate_titles_filters_junk_and_coerces_year(self):
        raw = json.dumps({
            "publications": [
                {"title": "Paper A", "year": 2024},
                {"title": " ", "year": 2020},
                {"title": "Paper B", "year": "nope"},
                "not-a-dict",
            ]
        })
        with mock.patch.object(extractor, "_chat", return_value=raw):
            titles = extractor._enumerate_titles("cv text")
        self.assertEqual(titles, [
            {"title": "Paper A", "year": 2024},
            {"title": "Paper B", "year": None},
        ])

    def test_expand_publications_batches_and_merges(self):
        titles = [
            {"title": "Paper A", "year": 2024},
            {"title": "Paper B", "year": 2023},
            {"title": "Paper C", "year": 2022},
        ]
        batch_one = json.dumps({"publications": [
            _publication("Paper A", 2024), _publication("Paper B", 2023)
        ]})
        batch_two = json.dumps({"publications": [_publication("Paper C", 2022)]})
        with mock.patch.object(
            extractor, "_chat", side_effect=[batch_one, batch_two]
        ) as chat:
            records = extractor._expand_publications("cv text", titles, papers_per_chunk=2)
        self.assertEqual(chat.call_count, 2)
        self.assertEqual([r["title"] for r in records], ["Paper A", "Paper B", "Paper C"])

    def test_cache_key_varies_by_chunk_size(self):
        doc = _doc("cv.pdf", "Hello CV")
        key_a = extractor._cache_key([doc], papers_per_chunk=8)
        key_b = extractor._cache_key([doc], papers_per_chunk=16)
        self.assertNotEqual(key_a, key_b)

    def test_extract_profile_splits_meta_enumerate_and_expand(self):
        meta = json.dumps({
            "schema_version": "1.0.0",
            "candidate": _meta_candidate(),
        })
        enumerate_raw = json.dumps({
            "publications": [
                {"title": "Paper A", "year": 2024},
                {"title": "Paper B", "year": 2023},
            ]
        })
        expand_raw = json.dumps({
            "publications": [_publication("Paper A", 2024), _publication("Paper B", 2023)]
        })
        doc = _doc("cv.pdf", "Jialun Cao\nPUBLICATIONS\nPaper A\nPaper B")
        with tempfile.TemporaryDirectory() as tmp:
            original_cache = extractor.CACHE_DIR
            extractor.CACHE_DIR = Path(tmp)
            try:
                with mock.patch.object(
                    extractor,
                    "_chat",
                    side_effect=[meta, enumerate_raw, expand_raw],
                ) as chat:
                    profile, skipped = extractor.extract_profile([doc])
            finally:
                extractor.CACHE_DIR = original_cache
        self.assertEqual(skipped, [])
        self.assertGreaterEqual(chat.call_count, 3)
        pubs = profile["candidate"]["publications_impact"]["publications"]
        self.assertEqual([p["title"] for p in pubs], ["Paper A", "Paper B"])


if __name__ == "__main__":
    unittest.main()
