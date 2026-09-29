import unittest
from unittest import mock

from app import verify
from app.verify import _Candidate


def _pub(title, year, evidence=None):
    return {"title": title, "year": year, "evidence": evidence or []}


def _candidate(
    source="Crossref",
    title="",
    year=None,
    url=None,
    venue=None,
    authors=None,
):
    return _Candidate(
        source=source,
        title=title,
        year=year,
        url=url,
        venue=venue,
        authors=authors or [],
    )


class VerifyPublicationTests(unittest.TestCase):
    def test_confirmed_when_title_and_year_match(self):
        crossref = [
            _candidate(
                title="Deep Residual Learning for Image Recognition",
                year=2016,
                url="https://doi.org/10.1109/cvpr.2016.90",
                venue="CVPR",
                authors=["Kaiming He"],
            )
        ]
        with mock.patch.object(verify, "_crossref_candidates", return_value=crossref), mock.patch.object(
            verify, "_openalex_candidates", return_value=[]
        ):
            result = verify.verify_publication(
                _pub("Deep Residual Learning for Image Recognition", 2016),
                query_date="2026-09-29",
            )

        self.assertEqual(result["evidence"][-1]["evidence_status"], "confirmed")
        self.assertEqual(
            result["evidence"][-1]["source_url"],
            "https://doi.org/10.1109/cvpr.2016.90",
        )
        self.assertEqual(result["evidence"][-1]["source"], "Crossref")

    def test_conflict_when_same_title_but_year_differs(self):
        crossref = [
            _candidate(
                title="Deep Residual Learning for Image Recognition",
                year=2016,
                url="https://doi.org/10.1109/cvpr.2016.90",
            )
        ]
        with mock.patch.object(verify, "_crossref_candidates", return_value=crossref), mock.patch.object(
            verify, "_openalex_candidates", return_value=[]
        ):
            result = verify.verify_publication(
                _pub("Deep Residual Learning for Image Recognition", 2022),
                query_date="2026-09-29",
            )

        self.assertEqual(result["evidence"][-1]["evidence_status"], "conflict")

    def test_year_within_tolerance_is_confirmed(self):
        crossref = [
            _candidate(
                title="Deep Residual Learning for Image Recognition",
                year=2015,
                url="https://doi.org/10.48550/arxiv.1512.03385",
            )
        ]
        with mock.patch.object(verify, "_crossref_candidates", return_value=crossref), mock.patch.object(
            verify, "_openalex_candidates", return_value=[]
        ):
            result = verify.verify_publication(
                _pub("Deep Residual Learning for Image Recognition", 2016),
                query_date="2026-09-29",
            )

        self.assertEqual(result["evidence"][-1]["evidence_status"], "confirmed")

    def test_not_found_public_when_no_match(self):
        with mock.patch.object(verify, "_crossref_candidates", return_value=[]), mock.patch.object(
            verify, "_openalex_candidates", return_value=[]
        ):
            result = verify.verify_publication(
                _pub("Calibration drift in clinical decision support after deployment", 2025),
                query_date="2026-09-29",
            )

        self.assertEqual(result["evidence"][-1]["evidence_status"], "not_found_public")
        self.assertIsNone(result["evidence"][-1]["source_url"])

    def test_weak_title_match_is_to_verify_not_confirmed(self):
        crossref = [
            _candidate(
                title="Attention Is All You Need In Speech Separation",
                year=2021,
            )
        ]
        with mock.patch.object(verify, "_crossref_candidates", return_value=crossref), mock.patch.object(
            verify, "_openalex_candidates", return_value=[]
        ):
            result = verify.verify_publication(
                _pub("Attention is all you need", 2017),
                query_date="2026-09-29",
            )

        self.assertEqual(result["evidence"][-1]["evidence_status"], "to_verify")

    def test_unrelated_weak_match_is_to_verify_not_confirmed(self):
        # 标题部分重叠的无关论文（无年份），不得误判为 confirmed。
        crossref = [
            _candidate(
                title="Robust Visual Learning with Limited Labels",
                year=None,
            )
        ]
        with mock.patch.object(verify, "_crossref_candidates", return_value=crossref), mock.patch.object(
            verify, "_openalex_candidates", return_value=[]
        ):
            result = verify.verify_publication(
                _pub("Robustness under subgroup shift with limited labels", 2020),
                query_date="2026-09-29",
            )

        self.assertEqual(result["evidence"][-1]["evidence_status"], "to_verify")

    def test_to_verify_when_all_sources_fail(self):
        with mock.patch.object(
            verify, "_crossref_candidates", side_effect=RuntimeError("timeout")
        ), mock.patch.object(
            verify, "_openalex_candidates", side_effect=RuntimeError("429")
        ):
            result = verify.verify_publication(
                _pub("Some real paper", 2020),
                query_date="2026-09-29",
            )

        self.assertEqual(result["evidence"][-1]["evidence_status"], "to_verify")

    def test_does_not_mutate_input(self):
        original = _pub("Deep Residual Learning for Image Recognition", 2016)
        crossref = [
            _candidate(
                title="Deep Residual Learning for Image Recognition",
                year=2016,
                url="https://doi.org/10.1109/cvpr.2016.90",
            )
        ]
        with mock.patch.object(verify, "_crossref_candidates", return_value=crossref), mock.patch.object(
            verify, "_openalex_candidates", return_value=[]
        ):
            verify.verify_publication(original, query_date="2026-09-29")

        self.assertEqual(original["evidence"], [])


class VerifyProfileTests(unittest.TestCase):
    def test_verify_profile_preserves_other_modules_and_appends_evidence(self):
        profile = {
            "schema_version": "1.0.0",
            "candidate": {
                "basic_info": {"name": "Alice"},
                "publications_impact": {
                    "publications": [
                        _pub("Deep Residual Learning for Image Recognition", 2016)
                    ],
                    "total_citations": None,
                    "citation_query_date": None,
                },
            },
        }
        crossref = [
            _candidate(
                title="Deep Residual Learning for Image Recognition",
                year=2016,
                url="https://doi.org/10.1109/cvpr.2016.90",
            )
        ]
        with mock.patch.object(verify, "_crossref_candidates", return_value=crossref), mock.patch.object(
            verify, "_openalex_candidates", return_value=[]
        ):
            result = verify.verify_profile(profile)

        self.assertEqual(result["candidate"]["basic_info"]["name"], "Alice")
        publications = result["candidate"]["publications_impact"]["publications"]
        self.assertEqual(len(publications[0]["evidence"]), 1)
        self.assertEqual(
            publications[0]["evidence"][0]["evidence_status"], "confirmed"
        )
        # 入参档案不被改动。
        self.assertEqual(
            profile["candidate"]["publications_impact"]["publications"][0]["evidence"],
            [],
        )


if __name__ == "__main__":
    unittest.main()
