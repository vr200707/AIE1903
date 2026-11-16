"""Local visual activity analysis for the interview recording.

This first version intentionally stays local and token-free.  It samples the
video with PyAV/Pillow and produces frame-level motion cues plus merged activity
events.  It does not claim to recognize emotion, personality, or protected
traits; facial-expression and hand-gesture landmark detection can be added as a
separate optional detector without changing this public result shape.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from app import health


DEFAULT_SAMPLE_INTERVAL_MS = 1000
DEFAULT_MAX_FRAMES = 3600
ACTIVITY_THRESHOLD = 2.5
EVENT_GAP_MS = 1500


class InterviewVisualError(RuntimeError):
    def __init__(self, code: str, detail: str) -> None:
        super().__init__(detail)
        self.code = code
        self.detail = detail


def _sample_interval_ms() -> int:
    raw = os.getenv(
        "INTERVIEW_VISUAL_SAMPLE_INTERVAL_MS",
        str(DEFAULT_SAMPLE_INTERVAL_MS),
    )
    try:
        return max(250, int(raw))
    except (TypeError, ValueError):
        return DEFAULT_SAMPLE_INTERVAL_MS


def _max_frames() -> int:
    raw = os.getenv("INTERVIEW_VISUAL_MAX_FRAMES", str(DEFAULT_MAX_FRAMES))
    try:
        return max(60, int(raw))
    except (TypeError, ValueError):
        return DEFAULT_MAX_FRAMES


def _grayscale_array(frame: Any) -> Any:
    try:
        import numpy as np

        image = frame.to_image().convert("L").resize((64, 48))
        return np.asarray(image, dtype=np.float32)
    except Exception:
        return None


def analyze_video(path: Path) -> dict[str, Any]:
    """Return local visual activity events for one interview recording."""
    try:
        import av
    except ImportError as exc:
        raise InterviewVisualError(
            "visual_dependency_missing",
            "Video analysis requires PyAV, which is bundled with faster-whisper.",
        ) from exc

    try:
        with av.open(str(path)) as container:
            video_stream = next(
                (stream for stream in container.streams if stream.type == "video"),
                None,
            )
            if video_stream is None:
                raise InterviewVisualError(
                    "no_video_stream",
                    "The uploaded file does not contain a video stream.",
                )

            interval_ms = _sample_interval_ms()
            max_frames = _max_frames()
            sampled = 0
            previous: Any = None
            frame_motions: list[tuple[int, float]] = []
            next_sample_ms = 0.0

            for frame in container.decode(video_stream):
                timestamp_ms = float(frame.time) * 1000 if frame.time else 0.0
                if timestamp_ms + 1e-9 < next_sample_ms:
                    continue
                if sampled >= max_frames:
                    break
                sampled += 1
                next_sample_ms = timestamp_ms + interval_ms
                current = _grayscale_array(frame)
                if current is None:
                    continue
                if previous is not None:
                    difference = abs(current - previous)
                    motion = float(difference.mean())
                else:
                    motion = 0.0
                previous = current
                frame_motions.append((int(round(timestamp_ms)), motion))
    except InterviewVisualError:
        raise
    except Exception as exc:
        health.record_dependency_failure("interview_visual", exc)
        raise InterviewVisualError(
            "visual_analysis_failed",
            f"Local visual analysis failed ({type(exc).__name__}).",
        ) from exc

    if not frame_motions:
        raise InterviewVisualError(
            "no_visual_frames",
            "No visual frames could be decoded from the uploaded video.",
        )

    active = [
        (timestamp_ms, motion)
        for timestamp_ms, motion in frame_motions
        if motion >= ACTIVITY_THRESHOLD
    ]
    events = _merge_events(active, interval_ms)
    motions = [motion for _, motion in frame_motions]
    metrics = {
        "sampled_frames": len(frame_motions),
        "active_frames": len(active),
        "mean_motion": round(float(sum(motions) / len(motions)), 4),
        "max_motion": round(float(max(motions)), 4),
    }
    health.record_dependency_success("interview_visual")
    return {
        "analyzer": "local-motion-v1",
        "sample_interval_ms": interval_ms,
        "metrics": metrics,
        "events": events,
        "caveats": [
            "Local motion cues only; not an emotion, personality, or ability judgment.",
            "Facial-expression and hand-gesture landmark detection requires an optional vision detector.",
        ],
    }


def _merge_events(
    active: list[tuple[int, float]],
    interval_ms: int,
) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    for timestamp_ms, motion in active:
        if events and timestamp_ms - events[-1]["end_ms"] <= EVENT_GAP_MS:
            event = events[-1]
            event["end_ms"] = timestamp_ms
            event["intensity"] = round(
                max(event["intensity"], min(10.0, motion)),
                2,
            )
            continue
        events.append(
            {
                "event_id": f"v{len(events) + 1:05d}",
                "start_ms": timestamp_ms,
                "end_ms": timestamp_ms,
                "intensity": round(min(10.0, motion), 2),
                "description": "Local visual movement above the activity threshold.",
            }
        )
    return events
