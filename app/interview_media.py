"""Local English transcription and objective delivery measurements."""

from __future__ import annotations

import math
import os
import re
import threading
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

from app import health


PROJECT_ROOT = Path(__file__).resolve().parents[1]
SUPPORTED_VIDEO_SUFFIXES = {
    ".mp4",
    ".m4v",
    ".mov",
    ".webm",
    ".mkv",
}
VIDEO_CONTENT_TYPES = {
    ".mp4": "video/mp4",
    ".m4v": "video/x-m4v",
    ".mov": "video/quicktime",
    ".webm": "video/webm",
    ".mkv": "video/x-matroska",
}
DEFAULT_MAX_VIDEO_BYTES = 500 * 1024 * 1024
DEFAULT_MAX_VIDEO_SECONDS = 20 * 60
DEFAULT_ASR_MODEL = "small.en"

_MODEL_LOCK = threading.Lock()
_MODEL_CACHE: dict[tuple[str, str, str, str], Any] = {}


class InterviewMediaError(RuntimeError):
    def __init__(self, code: str, detail: str) -> None:
        super().__init__(detail)
        self.code = code
        self.detail = detail


def _load_dotenv() -> None:
    load_dotenv(PROJECT_ROOT / ".env")


def max_video_bytes() -> int:
    _load_dotenv()
    raw = os.getenv("INTERVIEW_MAX_VIDEO_BYTES", str(DEFAULT_MAX_VIDEO_BYTES))
    try:
        return max(1024, int(raw))
    except (TypeError, ValueError):
        return DEFAULT_MAX_VIDEO_BYTES


def max_video_seconds() -> int:
    _load_dotenv()
    raw = os.getenv(
        "INTERVIEW_MAX_VIDEO_SECONDS",
        str(DEFAULT_MAX_VIDEO_SECONDS),
    )
    try:
        return max(30, int(raw))
    except (TypeError, ValueError):
        return DEFAULT_MAX_VIDEO_SECONDS


def validate_video_suffix(filename: str) -> str:
    suffix = Path(filename).suffix.lower()
    if suffix not in SUPPORTED_VIDEO_SUFFIXES:
        raise InterviewMediaError(
            "unsupported_video_type",
            (
                "Unsupported video type. Allowed extensions: "
                + ", ".join(sorted(SUPPORTED_VIDEO_SUFFIXES))
            ),
        )
    return suffix


def probe_video(path: Path) -> dict[str, Any]:
    """Read basic media metadata with PyAV, which ships with faster-whisper."""
    try:
        import av
    except ImportError as exc:
        raise InterviewMediaError(
            "media_dependency_missing",
            "Video support requires the faster-whisper package and its PyAV dependency.",
        ) from exc

    try:
        with av.open(str(path)) as container:
            video_streams = [
                stream for stream in container.streams if stream.type == "video"
            ]
            if not video_streams:
                raise InterviewMediaError(
                    "no_video_stream",
                    "The uploaded file does not contain a video stream.",
                )
            duration_seconds = 0.0
            if container.duration is not None:
                duration_seconds = container.duration / av.time_base
            if duration_seconds <= 0:
                for stream in container.streams:
                    if stream.duration is not None and stream.time_base is not None:
                        duration_seconds = max(
                            duration_seconds,
                            float(stream.duration * stream.time_base),
                        )
            stream = video_streams[0]
            width = int(stream.codec_context.width or 0)
            height = int(stream.codec_context.height or 0)
    except InterviewMediaError:
        raise
    except Exception as exc:
        raise InterviewMediaError(
            "invalid_video",
            f"Could not read the uploaded video ({type(exc).__name__}).",
        ) from exc

    duration_ms = int(round(duration_seconds * 1000))
    if duration_ms <= 0:
        raise InterviewMediaError(
            "invalid_video_duration",
            "The uploaded video has no readable duration.",
        )
    if duration_ms > max_video_seconds() * 1000:
        raise InterviewMediaError(
            "video_too_long",
            f"Video exceeds the {max_video_seconds()} second limit.",
        )
    return {
        "duration_ms": duration_ms,
        "width": width or None,
        "height": height or None,
    }


def _model_config() -> tuple[str, str, str, str]:
    _load_dotenv()
    return (
        os.getenv("INTERVIEW_ASR_MODEL", DEFAULT_ASR_MODEL),
        os.getenv("INTERVIEW_ASR_DEVICE", "cpu"),
        os.getenv("INTERVIEW_ASR_COMPUTE_TYPE", "int8"),
        os.getenv(
            "INTERVIEW_ASR_DOWNLOAD_ROOT",
            str(PROJECT_ROOT / ".cache" / "whisper-models"),
        ),
    )


def _get_model() -> Any:
    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:
        health.record_dependency_failure("interview_asr", exc, retryable=False)
        raise InterviewMediaError(
            "asr_dependency_missing",
            (
                "Local transcription is unavailable because faster-whisper is "
                "not installed. Install backend requirements and retry."
            ),
        ) from exc

    config = _model_config()
    with _MODEL_LOCK:
        cached = _MODEL_CACHE.get(config)
        if cached is not None:
            return cached
        model_name, device, compute_type, download_root = config
        Path(download_root).mkdir(parents=True, exist_ok=True)
        try:
            model = WhisperModel(
                model_name,
                device=device,
                compute_type=compute_type,
                download_root=download_root,
            )
        except Exception as exc:
            health.record_dependency_failure("interview_asr", exc)
            raise InterviewMediaError(
                "asr_model_unavailable",
                (
                    f"Could not load Whisper model '{model_name}' "
                    f"({type(exc).__name__}). Check the first-run model download."
                ),
            ) from exc
        _MODEL_CACHE[config] = model
        return model


def _decode_audio(path: Path) -> Any:
    """Decode any supported container to 16 kHz mono float32 with PyAV."""
    try:
        import av
        import numpy as np

        chunks: list[Any] = []
        with av.open(str(path)) as container:
            audio_streams = [
                stream for stream in container.streams if stream.type == "audio"
            ]
            if not audio_streams:
                raise InterviewMediaError(
                    "no_audio_stream",
                    "The uploaded video does not contain an audio stream.",
                )
            stream = audio_streams[0]
            resampler = av.AudioResampler(
                format="flt",
                layout="mono",
                rate=16_000,
            )
            for packet in container.demux(stream):
                for frame in packet.decode():
                    for resampled in resampler.resample(frame):
                        chunks.append(resampled.to_ndarray())
            for resampled in resampler.resample(None):
                chunks.append(resampled.to_ndarray())
        if not chunks:
            raise InterviewMediaError(
                "empty_audio_stream",
                "The uploaded video audio could not be decoded.",
            )
        return np.concatenate([chunk.reshape(-1) for chunk in chunks]).astype(
            np.float32,
            copy=False,
        )
    except InterviewMediaError:
        raise
    except Exception as exc:
        health.record_dependency_failure("interview_asr", exc)
        raise InterviewMediaError(
            "audio_decode_failed",
            f"Could not decode the video audio ({type(exc).__name__}).",
        ) from exc


def transcribe_video(path: Path) -> dict[str, Any]:
    """Transcribe an English interview video with segment timestamps."""
    model = _get_model()
    audio = _decode_audio(path)
    model_name, device, compute_type, _download_root = _model_config()
    try:
        segments_iter, info = model.transcribe(
            audio,
            language="en",
            vad_filter=True,
            beam_size=5,
            vad_parameters={"min_silence_duration_ms": 500},
            condition_on_previous_text=True,
        )
        segments: list[dict[str, Any]] = []
        for index, segment in enumerate(segments_iter, start=1):
            text = str(segment.text or "").strip()
            if not text:
                continue
            start_ms = max(0, int(round(float(segment.start) * 1000)))
            end_ms = max(start_ms + 1, int(round(float(segment.end) * 1000)))
            segments.append(
                {
                    "segment_id": f"s{index:05d}",
                    "start_ms": start_ms,
                    "end_ms": end_ms,
                    "text": text,
                }
            )
    except Exception as exc:
        health.record_dependency_failure("interview_asr", exc)
        raise InterviewMediaError(
            "asr_failed",
            f"English transcription failed ({type(exc).__name__}).",
        ) from exc

    if not segments:
        raise InterviewMediaError(
            "no_speech_detected",
            "No English speech segments were detected in the uploaded video.",
        )
    health.record_dependency_success("interview_asr")
    info_duration = getattr(info, "duration", None)
    duration_ms = segments[-1]["end_ms"]
    if isinstance(info_duration, (int, float)) and info_duration > 0:
        duration_ms = max(duration_ms, int(round(float(info_duration) * 1000)))
    return {
        "language": "en",
        "language_probability": float(getattr(info, "language_probability", 0.0) or 0.0),
        "duration_ms": duration_ms,
        "segments": segments,
        "asr": {
            "provider": "faster-whisper",
            "model": model_name,
            "device": device,
            "compute_type": compute_type,
        },
        "audio_features": audio_metrics(audio, segments, duration_ms),
    }


def _speech_rms(audio: Any, segments: list[dict[str, Any]]) -> list[float]:
    try:
        import numpy as np
    except ImportError:
        return []
    if not isinstance(audio, np.ndarray) or audio.size == 0:
        return []
    sampling_rate = 16_000
    frame_size = 480
    values: list[float] = []
    for segment in segments:
        start = max(0, int(segment["start_ms"] * sampling_rate / 1000))
        end = min(audio.size, int(segment["end_ms"] * sampling_rate / 1000))
        chunk = np.asarray(audio[start:end], dtype=np.float32)
        usable = (chunk.size // frame_size) * frame_size
        if usable <= 0:
            continue
        frames = chunk[:usable].reshape(-1, frame_size)
        rms = np.sqrt(np.mean(np.square(frames), axis=1))
        values.extend(float(value) for value in rms if value > 0.00001)
    return values


def audio_metrics(
    audio: Any,
    segments: list[dict[str, Any]],
    duration_ms: int,
) -> dict[str, Any]:
    """Return objective, cautiously named audio measurements."""
    rms_values = _speech_rms(audio, segments)
    mean_volume_dbfs = None
    volume_variability_db = None
    if rms_values:
        db_values = [20 * math.log10(value) for value in rms_values]
        mean_volume_dbfs = round(sum(db_values) / len(db_values), 2)
        mean = mean_volume_dbfs
        variance = sum((value - mean) ** 2 for value in db_values) / len(db_values)
        volume_variability_db = round(math.sqrt(variance), 2)
    return {
        "mean_volume_dbfs": mean_volume_dbfs,
        "volume_variability_db": volume_variability_db,
        "speech_duration_ms": sum(
            max(0, item["end_ms"] - item["start_ms"]) for item in segments
        ),
        "video_duration_ms": duration_ms,
    }


def communication_metrics(
    segments: list[dict[str, Any]],
    duration_ms: int,
    audio_features: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Compute transcript-derived pacing and fluency measurements."""
    text = " ".join(segment["text"] for segment in segments)
    words = re.findall(r"[A-Za-z]+(?:'[A-Za-z]+)?", text)
    word_count = len(words)
    speech_ms = sum(
        max(0, segment["end_ms"] - segment["start_ms"]) for segment in segments
    )
    long_pauses: list[int] = []
    for previous, current in zip(segments, segments[1:]):
        gap = current["start_ms"] - previous["end_ms"]
        if gap >= 700:
            long_pauses.append(gap)
    filler_pattern = re.compile(
        r"\b(?:um+|uh+|erm+|hmm+|mm+)\b",
        flags=re.IGNORECASE,
    )
    filler_count = len(filler_pattern.findall(text))
    articulation_rate = (
        round(word_count / (speech_ms / 60_000), 1) if speech_ms else None
    )
    overall_rate = round(word_count / (duration_ms / 60_000), 1) if duration_ms else None
    filler_rate = (
        round(filler_count / word_count * 100, 2) if word_count else 0.0
    )
    speech_ratio = min(1.0, speech_ms / duration_ms) if duration_ms else 0.0
    features = audio_features or {}
    return {
        "word_count": word_count,
        "speech_duration_ms": speech_ms,
        "speech_ratio": round(speech_ratio, 3),
        "articulation_rate_wpm": articulation_rate,
        "overall_speech_rate_wpm": overall_rate,
        "long_pause_count": len(long_pauses),
        "longest_pause_ms": max(long_pauses, default=0),
        "filler_count": filler_count,
        "filler_rate_per_100_words": filler_rate,
        "mean_volume_dbfs": features.get("mean_volume_dbfs"),
        "volume_variability_db": features.get("volume_variability_db"),
    }
