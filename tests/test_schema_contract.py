import json
import unittest
from pathlib import Path


SCHEMA_PATH = Path(__file__).parents[1] / "docs" / "schema.json"


class SchemaContractTests(unittest.TestCase):
    def setUp(self):
        self.schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))

    def test_defines_all_six_candidate_modules(self):
        candidate = self.schema["properties"]["candidate"]
        expected = {
            "basic_info",
            "education_employment",
            "awards_funding",
            "publications_impact",
            "academic_service",
            "overall_evaluation",
        }
        self.assertEqual(set(candidate["properties"]), expected)
        self.assertEqual(set(candidate["required"]), expected)

    def test_evidence_contract_has_required_fields_and_status_enum(self):
        evidence = self.schema["$defs"]["evidence"]
        self.assertEqual(
            set(evidence["required"]),
            {
                "source",
                "source_url",
                "evidence",
                "evidence_status",
                "query_date",
            },
        )
        self.assertEqual(
            evidence["properties"]["evidence_status"]["enum"],
            ["confirmed", "not_found_public", "to_verify", "conflict"],
        )

    def test_source_url_reserves_a_nullable_clickable_provenance_link(self):
        source_url = self.schema["$defs"]["evidence"]["properties"]["source_url"]
        self.assertEqual(
            source_url["anyOf"],
            [{"type": "string", "format": "uri"}, {"type": "null"}],
        )

    def test_schema_is_strict_and_uses_no_unresolved_local_refs(self):
        self.assertFalse(self.schema["additionalProperties"])

        def visit(value):
            if isinstance(value, dict):
                ref = value.get("$ref")
                if ref and ref.startswith("#/$defs/"):
                    self.assertIn(ref.removeprefix("#/$defs/"), self.schema["$defs"])
                for child in value.values():
                    visit(child)
            elif isinstance(value, list):
                for child in value:
                    visit(child)

        visit(self.schema)


if __name__ == "__main__":
    unittest.main()
