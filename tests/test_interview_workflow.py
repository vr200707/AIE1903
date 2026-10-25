import json
import os
import tempfile
import time
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

from fastapi.testclient import TestClient
from jsonschema import Draft202012Validator

from app import api
from app import interview_service
from app.interview_analysis import (
    CHUNK_SYSTEM_PROMPT,
    QUESTION_SYSTEM_PROMPT,
    align_answers,
    analyze_interview,
    analyze_question,
    pack_segments,
)
from app.interview_llm import chat_json, input_char_budget
from app.interview_questions import build_question_set
from app.interview_store import InterviewStore


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def _evidence(text="Evidence text", status="confirmed"):
    return {
        "source": "cv.pdf",
        "source_url": None,
        "evidence": text,
        "evidence_status": status,
        "query_date": "2026-10-25",
        "page": 1,
        "source_type": "resume",
    }


def _profile():
    return {
        "schema_version": "1.0.0",
        "candidate": {
            "basic_info": {
                "name": "Alice Example",
                "institution": "Example University",
                "position": "Associate Professor",
                "research_interests": ["Grounded AI", "Evaluation"],
                "highest_degree": "PhD",
                "skills": ["Python"],
                "strengths": ["Research leadership"],
                "to_verify": [],
                "evidence": [_evidence("Alice is an associate professor.")],
            },
            "education_employment": {
                "education": [
                    {
                        "degree": "PhD",
                        "field": "Computer Science",
                        "institution": "Example University",
                        "advisor": None,
                        "start_date": "2015",
                        "end_date": "2019",
                        "projects": [],
                        "outcomes": ["Dissertation on robust evaluation"],
                        "evidence": [_evidence("PhD in Computer Science.")],
                    }
                ],
                "employment": [
                    {
                        "institution": "Example University",
                        "position": "Associate Professor",
                        "start_date": "2022",
                        "end_date": None,
                        "responsibilities": ["Lead a research group"],
                        "projects": ["Evaluation platform"],
                        "outcomes": ["Released an evaluation benchmark"],
                        "evidence": [_evidence("Leads a research group.")],
                    }
                ],
            },
            "awards_funding": {
                "awards": [
                    {
                        "name": "Best Paper Award",
                        "year": 2024,
                        "awarding_body": "Example Society",
                        "evidence": [_evidence("Best paper award.", "to_verify")],
                    }
                ],
                "funding": [
                    {
                        "project_name": "Trustworthy Evaluation",
                        "funder": "Example Fund",
                        "start_date": "2024",
                        "end_date": "2027",
                        "amount": 100000,
                        "currency": "USD",
                        "role": "PI",
                        "evidence": [_evidence("PI on the project.")],
                    }
                ],
            },
            "publications_impact": {
                "publications": [
                    {
                        "title": "Grounded Interview Analysis",
                        "year": 2025,
                        "author_role": "first_author",
                        "venue": "ExampleConf",
                        "venue_type": "conference",
                        "ranking": "A",
                        "citation_count": 20,
                        "citation_query_date": "2026-10-25",
                        "code_repository": None,
                        "repository_stars": None,
                        "stars_query_date": None,
                        "evidence": [_evidence("First author publication.")],
                    }
                ],
                "total_citations": 20,
                "citation_query_date": "2026-10-25",
            },
            "academic_service": {
                "services": [
                    {
                        "service_type": "reviewer",
                        "organization_or_venue": "ExampleConf",
                        "role": "Reviewer",
                        "start_year": 2024,
                        "end_year": 2026,
                        "research_areas": ["AI"],
                        "evidence": [_evidence("Served as reviewer.")],
                    }
                ]
            },
            "overall_evaluation": {
                "summary": "Evidence-grounded researcher.",
                "strengths": ["Research leadership"],
                "risks": ["Some claims require verification"],
                "dimensions": [],
            },
        },
    }


def _question_payload(count=5):
    questions = []
    for index in range(1, count + 1):
        questions.append(
            {
                "text": (
                    f"Question {index}: explain a material contribution and "
                    "the evidence supporting it."
                ),
                "competency": "ownership_leadership",
                "objective": "Clarify ownership and evidence.",
                "why_it_matters": "Distinguishes depth from a CV summary.",
                "answer_seconds": 90,
                "claim_ids": [f"C{index}"],
            }
        )
    return {"questions": questions}


def _build_set():
    with mock.patch(
        "app.interview_questions.chat_json",
        return_value=_question_payload(),
    ):
        result = build_question_set(
            profile_id="prf_test",
            profile=_profile(),
            role_context="Tenure-track faculty role in trustworthy AI.",
            question_count=5,
        )
    return result


def _segments(count=5):
    return [
        {
            "segment_id": f"s{index:05d}",
            "start_ms": (index - 1) * 10_000,
            "end_ms": index * 10_000 - 100,
            "text": (
                f"I led contribution {index} and measured a concrete outcome "
                "with supporting evidence."
            ),
        }
        for index in range(1, count + 1)
    ]


def _stored_question_set(store, result):
    return store.create_question_set(
        profile_id="prf_test",
        profile_snapshot=_profile(),
        language="en",
        role_context="Tenure-track faculty role in trustworthy AI.",
        candidate_name="Alice Example",
        questions=result["questions"],
        document_markdown=result["document_markdown"],
        generation=result["generation"],
        warnings=result["warnings"],
    )


class InterviewStoreTests(unittest.TestCase):
    def test_round_trip_and_interview_state(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            store = InterviewStore(Path(temp_dir))
            result = _build_set()
            question_set = _stored_question_set(store, result)
            loaded = store.get_question_set(question_set["question_set_id"])
            self.assertIsNotNone(loaded)
            self.assertEqual(len(loaded["questions"]), 5)
            interview = store.create_interview(question_set["question_set_id"])
            self.assertIsNotNone(interview)
            self.assertEqual(interview["status"], "created")
            updated = store.update_interview(
                interview["interview_id"],
                status="uploaded",
                stage="video_ready",
                progress={"done": 1, "total": 1},
                video={"filename": "answer.mp4"},
                error=None,
            )
            self.assertEqual(updated["status"], "uploaded")
            self.assertIsNone(updated["error"])


class InterviewQuestionTests(unittest.TestCase):
    def test_question_set_is_evidence_grounded(self):
        result = _build_set()
        self.assertEqual(len(result["questions"]), 5)
        for question in result["questions"]:
            self.assertTrue(question["source_claims"])
            self.assertEqual(question["source_claims"][0]["claim_id"][0], "C")
        self.assertIn("# Candidate Interview Question Set", result["document_markdown"])

    def test_prompt_guard_rejects_oversized_input(self):
        with mock.patch.dict(
            os.environ,
            {"INTERVIEW_LLM_INPUT_CHAR_BUDGET": "6000"},
        ):
            with self.assertRaisesRegex(ValueError, "exceeds input budget"):
                chat_json("short system", "x" * 7000)

    def test_fallback_questions_still_match_contract_shape(self):
        profile = _profile()
        profile["candidate"]["education_employment"] = {
            "education": [],
            "employment": [],
        }
        profile["candidate"]["awards_funding"] = {"awards": [], "funding": []}
        profile["candidate"]["publications_impact"] = {
            "publications": [],
            "total_citations": None,
            "citation_query_date": None,
        }
        profile["candidate"]["academic_service"] = {"services": []}
        with mock.patch(
            "app.interview_questions.chat_json",
            return_value={"questions": []},
        ):
            result = build_question_set(
                profile_id="prf_test",
                profile=profile,
                role_context=None,
                question_count=5,
            )
        self.assertEqual(len(result["questions"]), 5)
        self.assertTrue(all(item["source_claims"] for item in result["questions"]))
        self.assertTrue(
            any(item["code"] == "question_fallback_used" for item in result["warnings"])
        )


class InterviewAnalysisTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.question_set = _stored_question_set(
            InterviewStore(Path(self.temp_dir.name)),
            _build_set(),
        )

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_segment_packing_respects_character_budget(self):
        segments = [
            {
                "segment_id": f"s{index:05d}",
                "start_ms": index * 1000,
                "end_ms": index * 1000 + 900,
                "text": "word " * 120,
            }
            for index in range(1, 9)
        ]
        batches = pack_segments(segments, max_chars=1500)
        self.assertGreater(len(batches), 1)
        for batch in batches:
            rendered = "\n".join(
                f"[{item['segment_id']} 0-0] {item['text']}" for item in batch
            )
            self.assertLessEqual(len(rendered), 1500)

    def test_alignment_maps_model_ids_to_backend_timestamps(self):
        segments = _segments()
        ranges = {
            "ranges": [
                {
                    "question_id": f"q_{index:02d}",
                    "start_segment_id": f"s{index:05d}",
                    "end_segment_id": f"s{index:05d}",
                    "confidence": "high",
                }
                for index in range(1, 6)
            ]
        }
        with mock.patch(
            "app.interview_analysis.chat_json",
            return_value=ranges,
        ):
            alignment = align_answers(self.question_set, segments)
        self.assertEqual(len(alignment["items"]), 5)
        for index, item in enumerate(alignment["items"], start=1):
            self.assertEqual(item["answer_window"]["start_ms"], (index - 1) * 10_000)
            self.assertEqual(
                item["segments"][0]["segment_id"],
                f"s{index:05d}",
            )

    def test_invalid_citation_is_dropped_and_valid_timestamp_is_resolved(self):
        segment = _segments(1)[0]
        question = self.question_set["questions"][0]
        payload = {
            "summary": "The answer explains ownership.",
            "scores": {
                "evidence_specificity": 7,
                "ownership": 8,
                "depth": 7,
                "consistency": 8,
                "communication": 7,
            },
            "strengths": [
                {
                    "text": "Ownership is explicit.",
                    "supporting_segment_ids": [segment["segment_id"]],
                },
                {
                    "text": "This citation is invalid.",
                    "supporting_segment_ids": ["s99999"],
                },
            ],
            "concerns": [],
            "missing_details": ["Quantify the outcome."],
            "confidence": "high",
        }
        with mock.patch(
            "app.interview_analysis.chat_json",
            return_value=payload,
        ):
            result, warnings = analyze_question(
                question,
                [segment],
                {
                    "start_ms": segment["start_ms"],
                    "end_ms": segment["end_ms"],
                },
                "high",
                role_context="Faculty role.",
            )
        self.assertEqual(len(result["strengths"]), 1)
        self.assertEqual(
            result["strengths"][0]["supporting_segments"][0]["start_ms"],
            segment["start_ms"],
        )
        self.assertTrue(
            any(item["code"] == "ungrounded_analysis_dropped" for item in warnings)
        )
        self.assertEqual(result["score_overall"], 7.4)

    def test_long_answer_is_map_reduced_within_deepseek_prompt_budget(self):
        question = self.question_set["questions"][0]
        long_segments = [
            {
                "segment_id": f"s{index:05d}",
                "start_ms": index * 15_000,
                "end_ms": index * 15_000 + 14_000,
                "text": ("specific evidence " * 110).strip(),
            }
            for index in range(1, 19)
        ]
        calls = []

        def fake_chat_json(system_prompt, user_prompt, **kwargs):
            calls.append((system_prompt, user_prompt))
            self.assertLessEqual(
                len(system_prompt) + len(user_prompt),
                input_char_budget(),
            )
            if system_prompt == CHUNK_SYSTEM_PROMPT:
                match = __import__("re").search(r"\[(s\d{5}) ", user_prompt)
                segment_id = match.group(1) if match else "s00001"
                return {
                    "chunk_summary": "The candidate describes concrete work.",
                    "observations": [
                        {
                            "text": "The candidate states concrete evidence.",
                            "supporting_segment_ids": [segment_id],
                        }
                    ],
                    "missing_details": ["A quantified outcome."],
                }
            self.assertEqual(system_prompt, QUESTION_SYSTEM_PROMPT)
            return {
                "summary": "The long answer is grounded but repetitive.",
                "scores": {
                    "evidence_specificity": 6,
                    "ownership": 7,
                    "depth": 6,
                    "consistency": 7,
                    "communication": 5,
                },
                "strengths": [
                    {
                        "text": "The answer provides specific evidence.",
                        "supporting_segment_ids": ["s00001"],
                    }
                ],
                "concerns": [
                    {
                        "text": "The answer repeats similar detail.",
                        "supporting_segment_ids": ["s00005"],
                    }
                ],
                "missing_details": ["A concise quantified result."],
                "confidence": "medium",
            }

        with mock.patch(
            "app.interview_analysis.chat_json",
            side_effect=fake_chat_json,
        ):
            result, warnings = analyze_question(
                question,
                long_segments,
                {
                    "start_ms": long_segments[0]["start_ms"],
                    "end_ms": long_segments[-1]["end_ms"],
                },
                "medium",
                role_context="Faculty role.",
            )
        self.assertGreaterEqual(len(calls), 2)
        self.assertEqual(result["answered"], True)
        self.assertTrue(
            any(item["code"] == "answer_context_map_reduce" for item in warnings)
        )

    def test_report_matches_contract_and_has_timestamp_inventory(self):
        segments = _segments()
        alignment = {
            "items": [
                {
                    "question": question,
                    "segments": [segments[index]],
                    "answer_window": {
                        "start_ms": segments[index]["start_ms"],
                        "end_ms": segments[index]["end_ms"],
                    },
                    "alignment_confidence": "medium",
                }
                for index, question in enumerate(self.question_set["questions"])
            ],
            "warnings": [],
        }
        question_response = {
            "summary": "The candidate gives a grounded explanation.",
            "scores": {
                "evidence_specificity": 7,
                "ownership": 8,
                "depth": 7,
                "consistency": 8,
                "communication": 7,
            },
            "strengths": [
                {
                    "text": "Personal ownership is explicit.",
                    "supporting_segment_ids": ["s00001"],
                }
            ],
            "concerns": [
                {
                    "text": "Some details remain compact.",
                    "supporting_segment_ids": ["s00002"],
                }
            ],
            "missing_details": ["A quantified outcome."],
            "confidence": "medium",
        }
        overall_response = {
            "summary": "The interview provides grounded but compact evidence.",
            "strengths": [
                {
                    "text": "The candidate states a personal contribution.",
                    "question_ids": ["q_01"],
                    "supporting_segment_ids": ["s00001"],
                }
            ],
            "risks": [
                {
                    "text": "Several answers need concrete metrics.",
                    "question_ids": ["q_02"],
                    "supporting_segment_ids": ["s00002"],
                }
            ],
            "recommended_follow_up_questions": [
                "What metric best captures the outcome?"
            ],
        }
        transcript = {
            "language": "en",
            "duration_ms": 60_000,
            "segments": segments,
            "audio_features": {
                "mean_volume_dbfs": -24.2,
                "volume_variability_db": 3.5,
            },
        }
        with mock.patch(
            "app.interview_analysis.chat_json",
            side_effect=[question_response] * 5 + [overall_response],
        ):
            report = analyze_interview(self.question_set, transcript, alignment)
        report["interview_id"] = "int_123456789abc"
        report["video"] = {
            "filename": "answer.mp4",
            "content_type": "video/mp4",
            "size_bytes": 1234,
            "sha256": "a" * 64,
            "duration_ms": 60_000,
            "width": 1280,
            "height": 720,
        }
        report["generated_at"] = datetime.now(timezone.utc).isoformat()
        schema = json.loads(
            (PROJECT_ROOT / "contracts" / "interview.schema.json").read_text(
                encoding="utf-8"
            )
        )
        Draft202012Validator(schema).validate(report)
        self.assertEqual(len(report["timestamp_inventory"]), 5)
        self.assertEqual(
            report["timestamp_inventory"][0]["start_ms"],
            segments[0]["start_ms"],
        )


class InterviewApiTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.old_store = interview_service.STORE
        interview_service.STORE = InterviewStore(Path(self.temp_dir.name))
        self.client = TestClient(api.app)
        api._UPLOADS.clear()
        api._UPLOADS["upl_test"] = {
            "profile_id": "prf_test",
            "profile": _profile(),
            "status": "completed",
        }

    def tearDown(self):
        interview_service.STORE = self.old_store
        api._UPLOADS.clear()
        self.temp_dir.cleanup()

    def test_question_upload_and_analysis_flow(self):
        with mock.patch(
            "app.interview_questions.chat_json",
            return_value=_question_payload(),
        ):
            created = self.client.post(
                "/api/interview/question-sets",
                json={
                    "profile_id": "prf_test",
                    "role_context": "Faculty role in trustworthy AI.",
                    "question_count": 5,
                    "language": "en",
                },
            )
        self.assertEqual(created.status_code, 201)
        question_set = created.json()
        schema = json.loads(
            (PROJECT_ROOT / "contracts" / "interview.schema.json").read_text(
                encoding="utf-8"
            )
        )
        Draft202012Validator(schema).validate(question_set)
        question_set_id = question_set["question_set_id"]

        document = self.client.get(
            f"/api/interview/question-sets/{question_set_id}/document"
        )
        self.assertEqual(document.status_code, 200)
        self.assertIn("Candidate Interview Question Set", document.text)

        interview_response = self.client.post(
            "/api/interview/interviews",
            json={"question_set_id": question_set_id},
        )
        self.assertEqual(interview_response.status_code, 201)
        interview_id = interview_response.json()["interview_id"]

        init = self.client.post(
            f"/api/interview/interviews/{interview_id}/video/init",
            json={
                "filename": "answer.mp4",
                "total_bytes": 5,
                "content_type": "video/mp4",
            },
        )
        self.assertEqual(init.status_code, 201)
        session_id = init.json()["session_id"]
        chunk = self.client.put(
            (
                f"/api/interview/interviews/{interview_id}/video/sessions/"
                f"{session_id}/chunks/0"
            ),
            content=b"abcde",
        )
        self.assertEqual(chunk.status_code, 200)
        with mock.patch.object(
            interview_service,
            "probe_video",
            return_value={
                "duration_ms": 60_000,
                "width": 1280,
                "height": 720,
            },
        ):
            complete = self.client.post(
                (
                    f"/api/interview/interviews/{interview_id}/video/sessions/"
                    f"{session_id}/complete"
                )
            )
        self.assertEqual(complete.status_code, 200)
        self.assertEqual(complete.json()["status"], "uploaded")
        video_response = self.client.get(
            f"/api/interview/interviews/{interview_id}/video"
        )
        self.assertEqual(video_response.status_code, 200)
        self.assertEqual(video_response.content, b"abcde")

        question = question_set["questions"][0]
        segment = _segments(1)[0]
        alignment = {
            "items": [
                {
                    "question": question,
                    "segments": [segment],
                    "answer_window": {
                        "start_ms": segment["start_ms"],
                        "end_ms": segment["end_ms"],
                    },
                    "alignment_confidence": "medium",
                }
            ],
            "warnings": [],
        }
        stub_report = {
            "schema_version": "1.0.0",
            "question_set_id": question_set_id,
            "language": "en",
            "analysis_model": "deepseek-chat",
            "overall_report": {
                "summary": "Grounded summary.",
                "strengths": [],
                "risks": [],
                "recommended_follow_up_questions": [],
            },
            "question_results": [],
            "timestamp_inventory": [],
            "communication_profile": {
                "metrics": {},
                "interpretations": [],
                "caveats": [],
            },
            "warnings": [],
        }
        with mock.patch.object(
            interview_service,
            "transcribe_video",
            return_value={
                "language": "en",
                "duration_ms": 60_000,
                "segments": [segment],
                "audio_features": {},
            },
        ), mock.patch.object(
            interview_service,
            "align_answers",
            return_value=alignment,
        ), mock.patch.object(
            interview_service,
            "analyze_interview",
            return_value=stub_report,
        ):
            started = self.client.post(
                f"/api/interview/interviews/{interview_id}/analyze"
            )
            self.assertEqual(started.status_code, 202)
            deadline = time.time() + 5
            report_response = None
            while time.time() < deadline:
                report_response = self.client.get(
                    f"/api/interview/interviews/{interview_id}/report"
                )
                if report_response.status_code == 200:
                    break
                time.sleep(0.05)
        self.assertIsNotNone(report_response)
        self.assertEqual(report_response.status_code, 200)
        self.assertEqual(
            report_response.json()["interview_id"],
            interview_id,
        )

    def test_endpoint_rejects_non_english_questions(self):
        response = self.client.post(
            "/api/interview/question-sets",
            json={"profile_id": "prf_test", "language": "zh"},
        )
        self.assertEqual(response.status_code, 422)


if __name__ == "__main__":
    unittest.main()
