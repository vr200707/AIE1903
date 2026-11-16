import json
import subprocess
import tempfile
import unittest
from pathlib import Path

from jsonschema import Draft202012Validator

from app.interview_visual import analyze_video


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def _ffmpeg():
    from imageio_ffmpeg import get_ffmpeg_exe

    return get_ffmpeg_exe()


def _synthetic_video(path: Path, seconds: int = 3) -> Path:
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


class InterviewVisualTests(unittest.TestCase):
    def test_analyze_video_matches_visual_contract(self):
        schema = json.loads(
            (PROJECT_ROOT / "contracts" / "interview.schema.json").read_text(
                encoding="utf-8"
            )
        )
        validator = Draft202012Validator(
            {
                "$defs": schema["$defs"],
                "$ref": "#/$defs/VisualAnalysis",
            }
        )
        with tempfile.TemporaryDirectory() as temp_dir:
            video_path = _synthetic_video(Path(temp_dir) / "sample.mp4")
            result = analyze_video(video_path)
        validator.validate(result)
        self.assertEqual(result["analyzer"], "local-motion-v1")
        self.assertGreaterEqual(result["metrics"]["sampled_frames"], 1)
        self.assertIn("not an emotion", result["caveats"][0])


if __name__ == "__main__":
    unittest.main()
