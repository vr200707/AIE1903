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


class SchemaValidatorSmokeTests(unittest.TestCase):
    def test_minimal_profile_is_valid(self):
        result = validate_instance(minimal_profile())

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


if __name__ == "__main__":
    unittest.main()
