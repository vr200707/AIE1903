import unittest

from app import verify
from app.search import SearchResult
from app.web_verification import WebClaim


def _result(title, url, snippet="snippet"):
    return SearchResult(title=title, url=url, snippet=snippet, source="bing")


def _claim(
    *,
    claim_text="Best Paper Award from IEEE in 2023",
    candidate_name="Alice",
    anchors=("Best Paper Award", "IEEE"),
):
    return WebClaim(
        kind="award",
        index=0,
        claim_text=claim_text,
        query=f'"{candidate_name}" "Best Paper Award" "IEEE"',
        candidate_name=candidate_name,
        anchor_phrases=anchors,
        anchor_tokens=("best", "award", "ieee"),
    )


def _accept_all(claim, results):
    return {
        "results": [
            {
                "index": index,
                "decision": "accept",
                "candidate_match": True,
                "claim_match": True,
                "authority": "official",
                "evidence_quote": result.title,
                "reason": "The page explicitly names the candidate and the award.",
            }
            for index, result in enumerate(results)
        ]
    }


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
        results = [
            _result(
                "Alice receives Best Paper Award from IEEE",
                "https://example.org/award",
            )
        ]
        evidence = verify.verify_text_claim(
            _claim(),
            query_date="2026-09-29",
            search=lambda q, max_results=None: results,
            judge=_accept_all,
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
        self.assertIn("Reason: RuntimeError", evidence["notes"])
        self.assertIn("Retryable: yes", evidence["notes"])

    def test_judge_failure_hides_link_and_stays_retryable(self):
        results = [
            _result(
                "Alice receives Best Paper Award from IEEE",
                "https://example.org/award",
            )
        ]

        def broken_judge(claim, candidates):
            raise RuntimeError("judge timeout")

        evidence = verify.verify_text_claim(
            _claim(),
            query_date="2026-09-29",
            search=lambda q, max_results=None: results,
            judge=broken_judge,
        )
        self.assertEqual(evidence["evidence_status"], "to_verify")
        self.assertIsNone(evidence["source_url"])
        self.assertIn("Retryable: yes", evidence["notes"])

    def test_unrelated_pages_are_not_displayed(self):
        def should_not_run(claim, candidates):
            raise AssertionError("judge should not run")

        results = [
            _result("《永劫无间》官网", "https://www.yjwujian.cn/"),
            _result(
                "Vision | DeepSeek API Docs",
                "https://api-docs.deepseek.com/guides/vision/",
            ),
            _result(
                "Research | SPJ",
                "https://spj.science.org/journal/research",
            ),
        ]
        evidence = verify.verify_text_claim(
            _claim(),
            query_date="2026-09-29",
            search=lambda q, max_results=None: results,
            judge=should_not_run,
        )
        self.assertEqual(evidence["evidence_status"], "not_found_public")
        self.assertIsNone(evidence["source_url"])


class VerifyProfileWebTests(unittest.TestCase):
    def test_verify_profile_appends_web_evidence_for_awards(self):
        results = [
            _result(
                "Alice receives Best Paper Award from IEEE",
                "https://example.org/award",
            )
        ]
        out = verify.verify_profile(
            _profile(),
            verify_web=True,
            search=lambda q, max_results=None: results,
            judge=_accept_all,
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
