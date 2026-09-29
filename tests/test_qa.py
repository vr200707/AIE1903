import json
import unittest
from unittest import mock

from app import qa


def _evidence(source, text, status="confirmed"):
    return {
        "source": source,
        "source_url": None,
        "evidence": text,
        "evidence_status": status,
        "query_date": "2026-09-29",
        "source_type": "resume",
    }


PROFILE = {
    "schema_version": "1.0.0",
    "candidate": {
        "basic_info": {
            "name": "张三",
            "institution": "某大学",
            "position": None,
            "research_interests": [],
            "highest_degree": "博士",
            "skills": [],
            "strengths": [],
            "to_verify": [],
            "evidence": [_evidence("cv_01.pdf", "姓名：张三，某大学博士")],
        },
        "publications_impact": {
            "publications": [
                {
                    "title": "A Paper",
                    "year": 2020,
                    "author_role": "first_author",
                    "venue": "CVPR",
                    "venue_type": "conference",
                    "ranking": None,
                    "citation_count": 10,
                    "citation_query_date": "2026-09-29",
                    "code_repository": None,
                    "repository_stars": None,
                    "stars_query_date": None,
                    "evidence": [_evidence("cv_01.pdf", "A Paper, CVPR 2020, 引用 10 次")],
                }
            ],
            "total_citations": 10,
            "citation_query_date": "2026-09-29",
        },
    },
}


class EvidenceIndexTests(unittest.TestCase):
    def test_index_covers_every_evidence_in_order(self):
        index, rendered = qa.build_evidence_index(PROFILE)
        self.assertEqual(list(index.keys()), ["E1", "E2"])
        self.assertEqual([item["evidence_id"] for item in rendered], ["E1", "E2"])
        self.assertEqual(rendered[1]["path"], "candidate.publications_impact.publications[0].evidence[0]")

    def test_index_does_not_mutate_profile(self):
        qa.build_evidence_index(PROFILE)
        self.assertNotIn("evidence_id", PROFILE["candidate"]["basic_info"]["evidence"][0])


class AnswerQuestionTests(unittest.TestCase):
    def _answer_with(self, payload):
        with mock.patch.object(qa, "_call_model", return_value=json.dumps(payload)):
            return qa.answer_question(PROFILE, "他最高学历是什么？")

    def test_evidence_ids_map_back_to_profile_evidence(self):
        result = self._answer_with(
            {"answer": "博士。", "confidence": "high", "evidence_ids": ["E1"]}
        )
        self.assertEqual(result["answer"], "博士。")
        self.assertEqual(result["confidence"], "high")
        self.assertEqual(result["evidence"], [PROFILE["candidate"]["basic_info"]["evidence"][0]])
        self.assertNotIn("evidence_id", result["evidence"][0])

    def test_unknown_evidence_ids_are_dropped_and_confidence_downgraded(self):
        result = self._answer_with(
            {"answer": "他在某大学。", "confidence": "high", "evidence_ids": ["E99"]}
        )
        self.assertEqual(result["evidence"], [])
        self.assertEqual(result["confidence"], "low")

    def test_duplicate_ids_are_deduplicated(self):
        result = self._answer_with(
            {"answer": "博士。", "confidence": "medium", "evidence_ids": ["E1", "E1", "E2"]}
        )
        self.assertEqual(len(result["evidence"]), 2)
        self.assertEqual(result["confidence"], "medium")

    def test_invalid_confidence_falls_back_to_low(self):
        result = self._answer_with(
            {"answer": "无法确定。", "confidence": "very high", "evidence_ids": []}
        )
        self.assertEqual(result["confidence"], "low")

    def test_missing_fields_fall_back(self):
        result = self._answer_with({"answer": "档案中没有相关信息"})
        self.assertEqual(result["confidence"], "low")
        self.assertEqual(result["evidence"], [])

    def test_blank_question_rejected(self):
        with self.assertRaises(ValueError):
            qa.answer_question(PROFILE, "   ")

    def test_broken_json_raises_value_error(self):
        with mock.patch.object(qa, "_call_model", return_value="not json"):
            with self.assertRaises(ValueError):
                qa.answer_question(PROFILE, "他发表过什么论文？")

    def test_empty_answer_raises_value_error(self):
        with mock.patch.object(qa, "_call_model", return_value=json.dumps({"answer": "  "})):
            with self.assertRaises(ValueError):
                qa.answer_question(PROFILE, "他发表过什么论文？")

    def test_evidence_refs_are_capped(self):
        result = self._answer_with(
            {
                "answer": "博士。",
                "confidence": "high",
                "evidence_ids": ["E1", "E2", "E1"],
            }
        )
        self.assertLessEqual(len(result["evidence"]), qa.MAX_EVIDENCE_REFS)


if __name__ == "__main__":
    unittest.main()
