import copy
import unittest

from tools.schema_validation import validate_instance


def evidence(status: str = "confirmed", source_url: str | None = None) -> dict:
    return {
        "source": "candidate_cv.pdf",
        "source_url": source_url,
        "evidence": "Minimal smoke-test evidence.",
        "evidence_status": status,
        "query_date": "2026-09-28",
        "source_type": "resume",
    }


def minimal_profile() -> dict:
    return {
        "schema_version": "1.0.0",
        "candidate": {
            "basic_info": {
                "name": "Example Candidate",
                "institution": None,
                "position": None,
                "research_interests": [],
                "highest_degree": None,
                "skills": [],
                "strengths": [],
                "to_verify": [],
                "evidence": [evidence()],
            },
            "education_employment": {
                "education": [],
                "employment": [],
            },
            "awards_funding": {
                "awards": [],
                "funding": [],
            },
            "publications_impact": {
                "publications": [],
                "total_citations": None,
                "citation_query_date": None,
            },
            "academic_service": {
                "services": [],
            },
            "overall_evaluation": {
                "summary": None,
                "strengths": [],
                "risks": [],
                "dimensions": [],
            },
        },
    }


def full_profile() -> dict:
    instance = minimal_profile()
    candidate = instance["candidate"]
    candidate["education_employment"]["education"].append(
        {
            "degree": "PhD",
            "field": "Computer Science",
            "institution": "Example University",
            "advisor": "Example Advisor",
            "start_date": "2016-09",
            "end_date": "2020-06",
            "projects": ["Example research project"],
            "outcomes": ["Example outcome"],
            "evidence": [evidence()],
        }
    )
    candidate["education_employment"]["employment"].append(
        {
            "institution": "Example Institute",
            "position": "Researcher",
            "start_date": "2020-07",
            "end_date": None,
            "responsibilities": ["Example responsibility"],
            "projects": ["Example employment project"],
            "outcomes": ["Example employment outcome"],
            "evidence": [evidence()],
        }
    )
    candidate["awards_funding"]["awards"].append(
        {
            "name": "Example Award",
            "year": 2024,
            "awarding_body": "Example Society",
            "evidence": [evidence()],
        }
    )
    candidate["awards_funding"]["funding"].append(
        {
            "project_name": "Example Funded Project",
            "funder": "Example Funder",
            "start_date": "2024-01",
            "end_date": "2026-12",
            "amount": 100000,
            "currency": "CNY",
            "role": "PI",
            "evidence": [evidence()],
        }
    )
    candidate["publications_impact"]["publications"].append(
        {
            "title": "Example Publication",
            "year": 2024,
            "author_role": "first_author",
            "venue": "Example Conference",
            "venue_type": "conference",
            "ranking": "Example Rank",
            "citation_count": 10,
            "citation_query_date": "2026-09-29",
            "code_repository": "https://github.com/example/project",
            "repository_stars": 5,
            "stars_query_date": "2026-09-29",
            "evidence": [evidence()],
        }
    )
    candidate["publications_impact"]["total_citations"] = 10
    candidate["publications_impact"]["citation_query_date"] = "2026-09-29"
    candidate["academic_service"]["services"].append(
        {
            "service_type": "reviewer",
            "organization_or_venue": "Example Conference",
            "role": "Reviewer",
            "start_year": 2024,
            "end_year": None,
            "research_areas": ["Computer Science"],
            "evidence": [evidence()],
        }
    )
    candidate["overall_evaluation"] = {
        "summary": "Synthetic evaluation.",
        "strengths": ["Synthetic strength"],
        "risks": [],
        "dimensions": [
            {
                "dimension": "Research",
                "assessment": "Synthetic assessment.",
                "evidence": [evidence()],
            }
        ],
    }
    return instance


class SchemaValidatorSmokeTests(unittest.TestCase):
    def test_minimal_profile_is_valid(self):
        result = validate_instance(minimal_profile())

        self.assertTrue(result.valid)
        self.assertEqual(result.errors, ())

    def test_full_synthetic_profile_is_valid(self):
        result = validate_instance(full_profile())

        self.assertTrue(result.valid)
        self.assertEqual(result.errors, ())

    def test_missing_top_level_field_is_error(self):
        instance = minimal_profile()
        del instance["schema_version"]

        result = validate_instance(instance)

        self.assertFalse(result.valid)
        self.assertTrue(any(issue.path == "$" for issue in result.errors))

    def test_additional_property_is_error(self):
        instance = minimal_profile()
        instance["unexpected"] = True

        result = validate_instance(instance)

        self.assertFalse(result.valid)
        self.assertTrue(any(issue.path == "$" for issue in result.errors))

    def test_invalid_evidence_status_is_error(self):
        instance = minimal_profile()
        item = instance["candidate"]["basic_info"]["evidence"][0]
        item["evidence_status"] = "maybe"

        result = validate_instance(instance)

        self.assertFalse(result.valid)
        self.assertTrue(
            any(
                issue.path.endswith(".evidence_status")
                for issue in result.errors
            )
        )

    def test_invalid_publication_enum_is_error(self):
        instance = full_profile()
        publication = instance["candidate"]["publications_impact"]["publications"][0]
        publication["venue_type"] = "unknown_venue"

        result = validate_instance(instance)

        self.assertFalse(result.valid)
        self.assertTrue(
            any(
                issue.path.endswith(".venue_type")
                for issue in result.errors
            )
        )

    def test_invalid_service_enum_is_error(self):
        instance = full_profile()
        service = instance["candidate"]["academic_service"]["services"][0]
        service["service_type"] = "unknown_service"

        result = validate_instance(instance)

        self.assertFalse(result.valid)
        self.assertTrue(
            any(
                issue.path.endswith(".service_type")
                for issue in result.errors
            )
        )

    def test_invalid_partial_date_is_error(self):
        instance = full_profile()
        education = instance["candidate"]["education_employment"]["education"][0]
        education["end_date"] = "2023-02-29"

        result = validate_instance(instance)

        self.assertFalse(result.valid)
        self.assertTrue(
            any(issue.path.endswith(".end_date") for issue in result.errors)
        )

    def test_invalid_source_url_is_error(self):
        instance = minimal_profile()
        item = instance["candidate"]["basic_info"]["evidence"][0]
        item["source_url"] = "ftp://example.com/source"

        result = validate_instance(instance)

        self.assertFalse(result.valid)
        self.assertTrue(
            any(
                issue.path.endswith(".source_url")
                for issue in result.errors
            )
        )

    def test_empty_evidence_list_is_error(self):
        instance = minimal_profile()
        instance["candidate"]["basic_info"]["evidence"] = []

        result = validate_instance(instance)

        self.assertFalse(result.valid)
        self.assertTrue(
            any(
                issue.path.endswith(".evidence")
                for issue in result.errors
            )
        )

    def test_extra_property_inside_evidence_is_error(self):
        instance = minimal_profile()
        item = instance["candidate"]["basic_info"]["evidence"][0]
        item["unexpected"] = True

        result = validate_instance(instance)

        self.assertFalse(result.valid)
        self.assertTrue(
            any(
                issue.path.endswith(".evidence[0]")
                for issue in result.errors
            )
        )

    def test_missing_provenance_fields_are_errors(self):
        fields = (
            "source",
            "source_url",
            "evidence",
            "evidence_status",
            "query_date",
        )

        for field in fields:
            with self.subTest(field=field):
                instance = copy.deepcopy(minimal_profile())
                item = instance["candidate"]["basic_info"]["evidence"][0]
                del item[field]

                result = validate_instance(instance)

                self.assertFalse(result.valid)
                self.assertTrue(
                    any(
                        issue.path.endswith(f".{field}")
                        or field in issue.message
                        for issue in result.errors
                    )
                )

    def test_not_found_public_with_url_is_warning_not_error(self):
        instance = minimal_profile()
        item = instance["candidate"]["basic_info"]["evidence"][0]
        item["evidence_status"] = "not_found_public"
        item["source_url"] = "https://example.com/search"

        result = validate_instance(instance)

        self.assertTrue(result.valid)
        self.assertTrue(
            any(
                issue.path.endswith(".source_url")
                for issue in result.warnings
            )
        )

    def test_not_found_public_with_null_url_has_no_warning(self):
        instance = minimal_profile()
        item = instance["candidate"]["basic_info"]["evidence"][0]
        item["evidence_status"] = "not_found_public"

        result = validate_instance(instance)

        self.assertTrue(result.valid)
        self.assertFalse(
            any(
                issue.path.endswith(".source_url")
                for issue in result.warnings
            )
        )

    def test_single_conflict_evidence_is_warning_not_error(self):
        instance = minimal_profile()
        item = instance["candidate"]["basic_info"]["evidence"][0]
        item["evidence_status"] = "conflict"

        result = validate_instance(instance)

        self.assertTrue(result.valid)
        self.assertTrue(
            any(
                issue.path.endswith(".evidence")
                for issue in result.warnings
            )
        )

    def test_conflict_with_two_evidence_entries_has_no_warning(self):
        instance = minimal_profile()
        evidence_list = instance["candidate"]["basic_info"]["evidence"]
        evidence_list[0]["evidence_status"] = "conflict"
        evidence_list.append(evidence())

        result = validate_instance(instance)

        self.assertTrue(result.valid)
        self.assertFalse(
            any(
                issue.path.endswith(".evidence")
                for issue in result.warnings
            )
        )


if __name__ == "__main__":
    unittest.main()
