"""Per-question answer clips extracted from the interview recording.

The analysis report stores an ``answer_window`` (``start_ms`` / ``end_ms``)
for every aligned question.  This module re-encodes each window into a
standalone H.264/AAC MP4 so reviewers can open one short clip per question
instead of scrubbing the single continuous recording.
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path
from typing import Any

from app.interview_media import InterviewMediaError
from app.interview_store import InterviewStore


CLIPS_DIRNAME = "clips"
_CLIP_ENCODER: str | None = None
_CLIP_ENCODER_TESTED = False
_CLIP_TIMEOUT_SECONDS = 600


def _ffmpeg_binary() -> str:
    try:
        from imageio_ffmpeg import get_ffmpeg_exe

        return get_ffmpeg_exe()
    except ImportError as exc:
        raise InterviewMediaError(
            "clip_encoder_unavailable",
            "The bundled ffmpeg runtime is unavailable for clip extraction.",
        ) from exc


def _pick_encoder() -> str:
    """Prefer Apple hardware encoding when the bundled ffmpeg supports it."""
    global _CLIP_ENCODER, _CLIP_ENCODER_TESTED
    if _CLIP_ENCODER_TESTED:
        return _CLIP_ENCODER or "libx264"
    _CLIP_ENCODER_TESTED = True
    _CLIP_ENCODER = None
    try:
        proc = subprocess.run(
            [_ffmpeg_binary(), "-hide_banner", "-encoders"],
            capture_output=True,
            text=True,
            timeout=20,
        )
        if "h264_videotoolbox" in proc.stdout:
            _CLIP_ENCODER = "h264_videotoolbox"
    except (OSError, subprocess.SubprocessError):
        _CLIP_ENCODER = None
    return _CLIP_ENCODER or "libx264"


def _encode_clip(
    source: Path,
    destination: Path,
    start_ms: int,
    end_ms: int,
    encoder: str,
) -> subprocess.CompletedProcess[str]:
    args = [
        _ffmpeg_binary(),
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        f"{max(0, start_ms) / 1000:.3f}",
        "-to",
        f"{max(0, end_ms) / 1000:.3f}",
        "-i",
        str(source),
        "-map",
        "0:v:0",
        "-map",
        "0:a:0?",
    ]
    if encoder == "h264_videotoolbox":
        args += ["-c:v", "h264_videotoolbox", "-b:v", "2600k", "-allow_sw", "1"]
    else:
        args += ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23"]
    args += [
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-movflags",
        "+faststart",
        str(destination),
    ]
    return subprocess.run(
        args,
        capture_output=True,
        text=True,
        timeout=_CLIP_TIMEOUT_SECONDS,
    )


def clip_video_segment(
    source: Path,
    destination: Path,
    start_ms: int,
    end_ms: int,
) -> None:
    """Re-encode ``[start_ms, end_ms)`` of ``source`` into ``destination``."""
    if end_ms <= start_ms:
        raise InterviewMediaError(
            "clip_empty_window",
            "The answer window for this question is empty.",
        )
    destination.parent.mkdir(parents=True, exist_ok=True)
    encoder = _pick_encoder()
    try:
        proc = _encode_clip(source, destination, start_ms, end_ms, encoder)
    except (OSError, subprocess.SubprocessError) as exc:
        raise InterviewMediaError(
            "clip_encoding_failed",
            "Clip extraction failed while running ffmpeg.",
        ) from exc
    if proc.returncode != 0:
        if encoder == "h264_videotoolbox":
            retry = _encode_clip(source, destination, start_ms, end_ms, "libx264")
            proc = retry
        if proc.returncode != 0:
            raise InterviewMediaError(
                "clip_encoding_failed",
                (proc.stderr or "Clip extraction failed.").strip()[-400:],
            )
    if not destination.exists() or destination.stat().st_size == 0:
        raise InterviewMediaError(
            "clip_encoding_failed",
            "Clip extraction produced no playable output.",
        )


def answer_windows(report: dict[str, Any]) -> list[dict[str, Any]]:
    """Return one aligned window per question with a valid time range.

    Windows come from transcription/LLM alignment, or from the exact
    ``next question`` boundaries recorded by the in-browser recorder
    (applied beforehand via :func:`apply_recorded_marks`).
    """
    windows: list[dict[str, Any]] = []
    for item in report.get("timestamp_inventory", []):
        start_ms = item.get("start_ms")
        end_ms = item.get("end_ms")
        if isinstance(start_ms, int) and isinstance(end_ms, int) and end_ms > start_ms:
            windows.append(
                {
                    "question_id": item["question_id"],
                    "start_ms": start_ms,
                    "end_ms": end_ms,
                }
            )
    return windows


def apply_recorded_marks(
    report: dict[str, Any],
    marks: list[dict[str, Any]] | None,
    duration_ms: int | None,
) -> dict[str, Any]:
    """Overwrite report answer windows with exact recorder boundaries.

    The recorder timestamps each ``next question`` press, so every
    question's window is ``[its start, next question's start)`` (or the
    end of the recording for the last one).  These boundaries are far more
    accurate than transcription-based alignment; the report keeps the
    transcription-derived ``answered`` flag for scoring.
    """
    if not marks:
        return report
    cleaned: list[dict[str, Any]] = []
    seen: set[str] = set()
    for mark in marks:
        question_id = mark.get("question_id")
        start_ms = mark.get("start_ms")
        if not isinstance(question_id, str) or not question_id:
            continue
        if question_id in seen:
            continue
        if not isinstance(start_ms, int) or start_ms < 0:
            continue
        seen.add(question_id)
        cleaned.append({"question_id": question_id, "start_ms": start_ms})
    if not cleaned:
        return report
    cleaned.sort(key=lambda mark: mark["start_ms"])
    starts = [mark["start_ms"] for mark in cleaned]
    index_of = {mark["question_id"]: i for i, mark in enumerate(cleaned)}

    def window_for(question_id: Any) -> tuple[int, int] | None:
        index = index_of.get(question_id)
        if index is None:
            return None
        start = starts[index]
        if duration_ms is not None:
            start = min(start, duration_ms)
        end = starts[index + 1] if index + 1 < len(starts) else duration_ms
        if end is None:
            return None
        if duration_ms is not None:
            end = min(end, duration_ms)
        return start, end

    for item in report.get("timestamp_inventory", []):
        window = window_for(item.get("question_id"))
        if window is not None:
            item["start_ms"], item["end_ms"] = window
    for result in report.get("question_results", []):
        window = window_for(result.get("question_id"))
        if window is not None:
            result["answer_window"] = {
                "start_ms": window[0],
                "end_ms": window[1],
            }
    return report


def clips_dir(store: InterviewStore, interview_id: str) -> Path:
    return store.interview_dir(interview_id) / CLIPS_DIRNAME


def clear_clips(store: InterviewStore, interview_id: str) -> None:
    directory = clips_dir(store, interview_id)
    if directory.exists():
        shutil.rmtree(directory)


def generate_interview_clips(
    store: InterviewStore,
    interview_id: str,
    report: dict[str, Any],
    video_path: Path,
    duration_ms: int | None,
) -> list[dict[str, Any]]:
    """Re-encode every answered question into ``clips/<question_id>.mp4``."""
    clear_clips(store, interview_id)
    results: list[dict[str, Any]] = []
    for window in answer_windows(report):
        question_id = window["question_id"]
        start_ms = window["start_ms"]
        end_ms = window["end_ms"]
        if duration_ms and start_ms >= duration_ms:
            results.append(
                {
                    "question_id": question_id,
                    "clip_generated": False,
                    "detail": "The answer window starts after the recording ends.",
                }
            )
            continue
        if duration_ms:
            end_ms = min(end_ms, duration_ms)
        destination = clips_dir(store, interview_id) / f"{question_id}.mp4"
        try:
            clip_video_segment(video_path, destination, start_ms, end_ms)
            results.append({"question_id": question_id, "clip_generated": True})
        except InterviewMediaError as exc:
            results.append(
                {
                    "question_id": question_id,
                    "clip_generated": False,
                    "detail": exc.detail,
                }
            )
    return results


def clip_path(
    store: InterviewStore,
    interview_id: str,
    question_id: str,
) -> Path | None:
    candidate = clips_dir(store, interview_id) / f"{question_id}.mp4"
    return candidate if candidate.exists() else None
