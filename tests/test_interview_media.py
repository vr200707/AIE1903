import tempfile
import unittest
from fractions import Fraction
from pathlib import Path

import av
import numpy as np

from app.interview_media import (
    InterviewMediaError,
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

    def test_unsupported_suffix_is_rejected(self):
        with self.assertRaises(InterviewMediaError):
            validate_video_suffix("answer.txt")

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
