import unittest

from app import verify
from app.search import SearchResult


def _result(title, url, snippet="snippet"):
    return SearchResult(title=title, url=url, snippet=snippet, source="bing")


def _profile():
    return {
        "schema_version": "1.0.0",
        "candidate": {
            "basic_info": {"name": "Alice", "evidence": []},
            "publications_impact": {
                "publications": [],
                "total_citations": None,
                "citation_query_date": None,
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
        },
    }


class VerifyTextClaimTests(unittest.TestCase):
    def test_not_found_public_when_no_results(self):
        evidence = verify.verify_text_claim(
            "Some obscure award",
            query_date="2026-09-29",
            search=lambda q, max_results=None: [],
        )
        self.assertEqual(evidence["evidence_status"], "not_found_public")
        self.assertIsNone(evidence["source_url"])

    def test_to_verify_with_links_when_results_found(self):
        results = [_result("Best Paper Award", "https://example.org/award")]
        evidence = verify.verify_text_claim(
            "Best Paper Award",
            query_date="2026-09-29",
            search=lambda q, max_results=None: results,
        )
        self.assertEqual(evidence["evidence_status"], "to_verify")
        self.assertEqual(evidence["source_url"], "https://example.org/award")

    def test_to_verify_when_search_fails(self):
        def boom(q, max_results=None):
            raise RuntimeError("timeout")

        evidence = verify.verify_text_claim(
            "claim", query_date="2026-09-29", search=boom
        )
        self.assertEqual(evidence["evidence_status"], "to_verify")


class VerifyProfileWebTests(unittest.TestCase):
    def test_verify_profile_appends_web_evidence_for_awards(self):
        results = [_result("Best Paper Award", "https://example.org/award")]
        out = verify.verify_profile(
            _profile(),
            verify_web=True,
            search=lambda q, max_results=None: results,
        )
        awards = out["candidate"]["awards_funding"]["awards"]
        self.assertEqual(awards[0]["evidence"][-1]["evidence_status"], "to_verify")
        self.assertEqual(awards[0]["evidence"][-1]["source"], "WebSearch")

    def test_verify_profile_does_not_mutate_input(self):
        original = _profile()
        verify.verify_profile(
            original,
            verify_web=True,
            search=lambda q, max_results=None: [],
        )
        self.assertEqual(original["candidate"]["awards_funding"]["awards"][0]["evidence"], [])


if __name__ == "__main__":
    unittest.main()
