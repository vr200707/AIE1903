import tempfile
import unittest
from fractions import Fraction
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

import av
import numpy as np

import app.interview_media as interview_media
from app.interview_media import (
    InterviewMediaError,
    _segment_uncertain,
    audio_metrics,
    communication_metrics,
    probe_video,
    validate_video_suffix,
)


def _write_small_video(path: Path, seconds: int = 2) -> None:
    with av.open(str(path), "w") as output:
        video = output.add_stream("libx264", rate=1)
        video.width = 160
        video.height = 120
        video.pix_fmt = "yuv420p"
        audio_stream = output.add_stream("aac", rate=16000)
        audio_stream.layout = "mono"

        for second in range(seconds):
            image = np.zeros((120, 160, 3), dtype=np.uint8)
            frame = av.VideoFrame.from_ndarray(image, format="rgb24")
            frame.pts = second
            frame.time_base = Fraction(1, 1)
            for packet in video.encode(frame):
                output.mux(packet)

        samples = 16000 * seconds
        for offset in range(0, samples, 1024):
            size = min(1024, samples - offset)
            block = np.zeros((1, size), dtype=np.float32)
            frame = av.AudioFrame.from_ndarray(
                block,
                format="fltp",
                layout="mono",
            )
            frame.sample_rate = 16000
            frame.pts = offset
            frame.time_base = Fraction(1, 16000)
            for packet in audio_stream.encode(frame):
                output.mux(packet)
        for packet in video.encode(None):
            output.mux(packet)
        for packet in audio_stream.encode(None):
            output.mux(packet)


class InterviewMediaTests(unittest.TestCase):
    def test_probe_valid_video(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "answer.mp4"
            _write_small_video(path)
            result = probe_video(path)
        self.assertGreaterEqual(result["duration_ms"], 1900)
        self.assertEqual(result["width"], 160)
        self.assertEqual(result["height"], 120)

    def test_probe_without_duration_falls_back_to_packet_timestamps(self):
        class FakePacket:
            def __init__(self, pts, duration, time_base):
                self.pts = pts
                self.duration = duration
                self.time_base = time_base

        class FakeStream:
            type = "video"
            codec_context = SimpleNamespace(width=160, height=120)
            duration = None
            time_base = None

        class FakeContainer:
            duration = None
            time_base = None
            streams = [FakeStream()]

            def demux(self):
                tb = Fraction(1, 1000)
                yield FakePacket(0, 500, tb)
                yield FakePacket(500, 500, tb)
                yield FakePacket(1000, 500, tb)

            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

        with mock.patch.object(av, "open", return_value=FakeContainer()):
            result = probe_video(Path("/tmp/missing-duration.webm"))
        self.assertAlmostEqual(result["duration_ms"], 1500, delta=5)
        self.assertEqual(result["width"], 160)
        self.assertEqual(result["height"], 120)

    def test_unsupported_suffix_is_rejected(self):
        with self.assertRaises(InterviewMediaError):
            validate_video_suffix("answer.txt")

    def test_segment_uncertainty_thresholds(self):
        self.assertFalse(_segment_uncertain(-0.5, 0.1))
        self.assertFalse(_segment_uncertain(None, None))
        self.assertTrue(_segment_uncertain(-1.2, 0.1))
        self.assertTrue(_segment_uncertain(-0.5, 0.4))
        self.assertTrue(_segment_uncertain(None, 0.9))
        self.assertTrue(_segment_uncertain(-2.0, None))

    def test_transcribe_video_marks_uncertain_segments(self):
        class FakeSegment:
            def __init__(self, text, start, end, avg_logprob, no_speech_prob):
                self.text = text
                self.start = start
                self.end = end
                self.avg_logprob = avg_logprob
                self.no_speech_prob = no_speech_prob

        class FakeModel:
            def transcribe(self, *args, **kwargs):
                return iter(
                    [
                        FakeSegment("Solid words.", 0.0, 2.0, -0.2, 0.05),
                        FakeSegment(" ", 2.0, 2.5, -0.2, 0.05),
                        FakeSegment("Mumbled words.", 2.5, 4.0, -1.4, 0.10),
                    ],
                ), SimpleNamespace(duration=4.5, language_probability=0.98)

        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "answer.mp4"
            path.write_bytes(b"placeholder")
            with (
                mock.patch.object(
                    interview_media,
                    "_get_model",
                    return_value=FakeModel(),
                ),
                mock.patch.object(
                    interview_media,
                    "_decode_audio",
                    return_value=np.zeros(16_000, dtype=np.float32),
                ),
            ):
                result = interview_media.transcribe_video(path)

        self.assertEqual(
            [segment["text"] for segment in result["segments"]],
            ["Solid words.", "Mumbled words."],
        )
        self.assertFalse(result["segments"][0]["uncertain"])
        self.assertEqual(result["segments"][0]["avg_logprob"], -0.2)
        self.assertTrue(result["segments"][1]["uncertain"])
        self.assertEqual(result["segments"][1]["no_speech_prob"], 0.1)

    def test_communication_metrics_from_timestamped_segments(self):
        segments = [
            {
                "segment_id": "s00001",
                "start_ms": 0,
                "end_ms": 5000,
                "text": "Um I led the project and explained the result.",
            },
            {
                "segment_id": "s00002",
                "start_ms": 6500,
                "end_ms": 10000,
                "text": "We delivered a benchmark and documented the outcome.",
            },
        ]
        metrics = communication_metrics(segments, 11000)
        self.assertEqual(metrics["word_count"], 17)
        self.assertEqual(metrics["long_pause_count"], 1)
        self.assertEqual(metrics["longest_pause_ms"], 1500)
        self.assertGreater(metrics["filler_rate_per_100_words"], 0)
        self.assertLessEqual(metrics["speech_ratio"], 1)

    def test_audio_metrics_are_nullable_without_audio_array(self):
        segments = [
            {
                "segment_id": "s00001",
                "start_ms": 0,
                "end_ms": 1000,
                "text": "English answer.",
            }
        ]
        metrics = audio_metrics(None, segments, 1200)
        self.assertIsNone(metrics["mean_volume_dbfs"])
        self.assertIsNone(metrics["volume_variability_db"])


if __name__ == "__main__":
    unittest.main()
