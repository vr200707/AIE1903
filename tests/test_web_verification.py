import unittest

from app.search import SearchResult
from app.web_verification import (
    WebClaim,
    build_web_claims,
    gate_search_results,
    strip_web_evidence,
)


def _result(title, url, snippet=""):
    return SearchResult(title=title, url=url, snippet=snippet, source="bing")


def _candidate():
    return {
        "basic_info": {
            "name": "Jiaping Xiao",
            "institution": "Nanyang Technological University, Singapore",
            "position": "Research Fellow",
        },
        "education_employment": {
            "education": [
                {
                    "degree": "Ph.D.",
                    "field": "Robotics and Intelligent Systems",
                    "institution": "Nanyang Technological University",
                }
            ],
            "employment": [
                {
                    "institution": "Nanyang Technological University, Singapore",
                    "position": "Research Fellow",
                }
            ],
        },
        "awards_funding": {
            "awards": [
                {
                    "name": "Best Paper Award",
                    "awarding_body": "IEEE",
                    "year": 2023,
                }
            ],
            "funding": [],
        },
    }


def _employment_claim():
    return WebClaim(
        kind="employment",
        index=0,
        claim_text="Research Fellow at Nanyang Technological University, Singapore",
        query='"Jiaping Xiao" "Nanyang Technological University" "Research Fellow"',
        candidate_name="Jiaping Xiao",
        anchor_phrases=("Nanyang Technological University, Singapore", "Research Fellow"),
        anchor_tokens=("nanyang", "ntu", "technological"),
    )


class BuildWebClaimTests(unittest.TestCase):
    def test_builds_precise_queries_and_skips_duplicate_basic_role(self):
        claims = build_web_claims(_candidate())
        kinds = [claim.kind for claim in claims]
        self.assertEqual(kinds, ["employment", "education", "award"])
        self.assertEqual(
            claims[0].query,
            '"Jiaping Xiao" "Nanyang Technological University, Singapore" '
            '"Research Fellow"',
        )

    def test_name_only_basic_info_does_not_create_a_search(self):
        candidate = _candidate()
        candidate["education_employment"] = {"education": [], "employment": []}
        candidate["awards_funding"] = {"awards": [], "funding": []}
        candidate["basic_info"] = {"name": "Jiaping Xiao"}
        self.assertEqual(build_web_claims(candidate), [])


class SearchGateTests(unittest.TestCase):
    def test_rejects_known_unrelated_pages_without_calling_model(self):
        def should_not_run(claim, results):
            raise AssertionError("model should not run for entity-less results")

        results = [
            _result("《永劫无间》官网", "https://www.yjwujian.cn/", "新英雄上线"),
            _result(
                "Vision | DeepSeek API Docs",
                "https://api-docs.deepseek.com/guides/vision/",
                "The model accepts images alongside text.",
            ),
            _result(
                "Research | SPJ",
                "https://spj.science.org/journal/research",
                "A journal about research.",
            ),
        ]
        outcome = gate_search_results(
            _employment_claim(),
            results,
            judge=should_not_run,
        )
        self.assertFalse(outcome.judge_called)
        self.assertEqual(outcome.accepted, ())

    def test_generic_research_word_is_not_enough_even_with_candidate_name(self):
        def should_not_run(claim, results):
            raise AssertionError("generic anchor overlap should be rejected by rules")

        result = _result(
            "Jiaping Xiao Research | SPJ",
            "https://spj.science.org/journal/research",
            "A journal about research.",
        )
        outcome = gate_search_results(
            _employment_claim(),
            [result],
            judge=should_not_run,
        )
        self.assertFalse(outcome.judge_called)
        self.assertEqual(outcome.accepted, ())

    def test_model_accepts_result_with_candidate_and_claim_entities(self):
        result = _result(
            "Jiaping Xiao - Research Fellow at NTU",
            "https://www.ntu.edu.sg/example",
            "Nanyang Technological University, Singapore",
        )

        def judge(claim, results):
            return {
                "results": [
                    {
                        "index": 0,
                        "decision": "accept",
                        "candidate_match": True,
                        "claim_match": True,
                        "authority": "official",
                        "evidence_quote": results[0].title,
                        "reason": "The official page names the candidate and role.",
                    }
                ]
            }

        outcome = gate_search_results(_employment_claim(), [result], judge=judge)
        self.assertTrue(outcome.judge_called)
        self.assertEqual(len(outcome.accepted), 1)
        self.assertEqual(outcome.accepted[0].result.url, result.url)

    def test_model_cannot_accept_a_fabricated_quote(self):
        result = _result(
            "Jiaping Xiao - Research Fellow at NTU",
            "https://www.ntu.edu.sg/example",
            "Nanyang Technological University, Singapore",
        )

        def judge(claim, results):
            return {
                "results": [
                    {
                        "index": 0,
                        "decision": "accept",
                        "candidate_match": True,
                        "claim_match": True,
                        "authority": "official",
                        "evidence_quote": "Jiaping Xiao won the Nobel Prize.",
                        "reason": "Incorrectly claims a quote.",
                    }
                ]
            }

        outcome = gate_search_results(_employment_claim(), [result], judge=judge)
        self.assertEqual(outcome.accepted, ())


class StripWebEvidenceTests(unittest.TestCase):
    def test_removes_only_web_search_entries(self):
        candidate = _candidate()
        candidate["basic_info"]["evidence"] = [
            {"source": "CV.pdf", "evidence": "Candidate text"},
            {"source": "WebSearch", "evidence": "Old noisy result"},
        ]
        removed = strip_web_evidence(candidate)
        self.assertEqual(removed, 1)
        self.assertEqual(
            candidate["basic_info"]["evidence"],
            [{"source": "CV.pdf", "evidence": "Candidate text"}],
        )


if __name__ == "__main__":
    unittest.main()
