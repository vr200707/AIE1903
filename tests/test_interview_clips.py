import subprocess
import tempfile
import unittest
from pathlib import Path

import av

from app.interview_clips import (
    answer_windows,
    apply_recorded_marks,
    clip_path,
    clip_video_segment,
    generate_interview_clips,
)
from app.interview_store import InterviewStore


def _ffmpeg():
    from imageio_ffmpeg import get_ffmpeg_exe

    return get_ffmpeg_exe()


def _synthetic_video(path: Path, seconds: int = 4) -> Path:
    subprocess.run(
        [
            _ffmpeg(),
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=320x240:rate=30",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:sample_rate=44100",
            "-t",
            str(seconds),
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-shortest",
            str(path),
        ],
        check=True,
        capture_output=True,
        text=True,
        timeout=120,
    )
    return path


def _duration_ms(path: Path) -> float:
    with av.open(str(path)) as container:
        return container.duration / av.time_base * 1000


def _report():
    return {
        "schema_version": "1.0.0",
        "timestamp_inventory": [
            {
                "question_id": "q_01",
                "order": 1,
                "answered": True,
                "start_ms": 500,
                "end_ms": 2000,
                "alignment_confidence": "high",
                "segment_ids": ["s00001"],
                "profile_paths": [],
            },
            {
                "question_id": "q_02",
                "order": 2,
                "answered": True,
                "start_ms": 2100,
                "end_ms": 3500,
                "alignment_confidence": "medium",
                "segment_ids": ["s00002"],
                "profile_paths": [],
            },
            {
                "question_id": "q_03",
                "order": 3,
                "answered": False,
                "start_ms": None,
                "end_ms": None,
                "alignment_confidence": "low",
                "segment_ids": [],
                "profile_paths": [],
            },
        ],
    }


class ClipExtractionTests(unittest.TestCase):
    def test_answer_windows_skip_unanswered_and_empty(self):
        windows = answer_windows(_report())
        self.assertEqual([w["question_id"] for w in windows], ["q_01", "q_02"])

    def test_clip_video_segment_extracts_the_window(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            source = _synthetic_video(root / "source.mp4", seconds=4)
            destination = root / "clips" / "q_01.mp4"
            clip_video_segment(source, destination, 1000, 3000)
            self.assertTrue(destination.exists())
            self.assertGreater(destination.stat().st_size, 0)
            duration = _duration_ms(destination)
            self.assertGreaterEqual(duration, 1600)
            self.assertLessEqual(duration, 2400)

    def test_generate_interview_clips_writes_one_file_per_answer(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            store = InterviewStore(Path(temp_dir))
            question_set = store.create_question_set(
                profile_id="prf_test",
                profile_snapshot={},
                language="en",
                role_context=None,
                candidate_name="Clip Example",
                questions=[
                    {
                        "question_id": "q_01",
                        "order": 1,
                        "text": "First question",
                        "competency": "other",
                        "objective": "",
                        "why_it_matters": "",
                        "answer_seconds": 90,
                        "source_claims": [],
                    },
                    {
                        "question_id": "q_02",
                        "order": 2,
                        "text": "Second question",
                        "competency": "other",
                        "objective": "",
                        "why_it_matters": "",
                        "answer_seconds": 90,
                        "source_claims": [],
                    },
                ],
                document_markdown="# Questions",
                generation={},
                warnings=[],
            )
            interview = store.create_interview(question_set["question_set_id"])
            video_path = _synthetic_video(
                store.interview_dir(interview["interview_id"]) / "source.mp4",
                seconds=4,
            )
            results = generate_interview_clips(
                store,
                interview["interview_id"],
                _report(),
                video_path,
                duration_ms=4000,
            )
            generated = {
                item["question_id"]
                for item in results
                if item.get("clip_generated")
            }
            self.assertEqual(generated, {"q_01", "q_02"})
            self.assertTrue(
                clip_path(store, interview["interview_id"], "q_01").exists()
            )
            self.assertIsNone(
                clip_path(store, interview["interview_id"], "q_03")
            )
            store.delete_interview(interview["interview_id"])
            self.assertFalse(
                (store.root / "interviews" / interview["interview_id"]).exists()
            )

    def test_apply_recorded_marks_replaces_windows_and_clamps(self):
        report = {
            "timestamp_inventory": [
                {
                    "question_id": "q_01",
                    "answered": True,
                    "start_ms": 500,
                    "end_ms": 2000,
                },
                {
                    "question_id": "q_02",
                    "answered": True,
                    "start_ms": 2100,
                    "end_ms": 3500,
                },
                {
                    "question_id": "q_03",
                    "answered": False,
                    "start_ms": None,
                    "end_ms": None,
                },
            ],
            "question_results": [
                {
                    "question_id": "q_01",
                    "answer_window": {"start_ms": 500, "end_ms": 2000},
                },
                {
                    "question_id": "q_02",
                    "answer_window": {"start_ms": 2100, "end_ms": 3500},
                },
            ],
        }
        marks = [
            {"question_id": "q_01", "start_ms": 0},
            {"question_id": "q_01", "start_ms": 99999},
            {"question_id": "q_02", "start_ms": 31000},
            {"question_id": "bad", "start_ms": "nope"},
            {"question_id": "negative", "start_ms": -5},
        ]
        updated = apply_recorded_marks(report, marks, duration_ms=60_000)
        inventory = {
            item["question_id"]: item for item in updated["timestamp_inventory"]
        }
        self.assertEqual(inventory["q_01"]["start_ms"], 0)
        self.assertEqual(inventory["q_01"]["end_ms"], 31000)
        self.assertEqual(inventory["q_02"]["start_ms"], 31000)
        self.assertEqual(inventory["q_02"]["end_ms"], 60000)
        self.assertIsNone(inventory["q_03"]["start_ms"])
        self.assertEqual(
            updated["question_results"][0]["answer_window"],
            {"start_ms": 0, "end_ms": 31000},
        )
        windows = answer_windows(updated)
        self.assertEqual(
            [(w["question_id"], w["start_ms"], w["end_ms"]) for w in windows],
            [("q_01", 0, 31000), ("q_02", 31000, 60000)],
        )

    def test_apply_recorded_marks_over_clamp_skips_empty_windows(self):
        report = {
            "timestamp_inventory": [
                {
                    "question_id": "q_01",
                    "answered": True,
                    "start_ms": 0,
                    "end_ms": 1000,
                }
            ]
        }
        updated = apply_recorded_marks(
            report,
            [{"question_id": "q_01", "start_ms": 80_000}],
            duration_ms=30_000,
        )
        self.assertEqual(answer_windows(updated), [])


if __name__ == "__main__":
    unittest.main()
