"""Interview workflow orchestration and asynchronous analysis jobs."""

from __future__ import annotations

import hashlib
import os
import shutil
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

from app.interview_analysis import align_answers, analyze_interview
from app.interview_media import (
    InterviewMediaError,
    VIDEO_CONTENT_TYPES,
    max_video_bytes,
    probe_video,
    transcribe_video,
    validate_video_suffix,
)
from app.interview_questions import (
    DEFAULT_QUESTION_COUNT,
    QUESTION_MAX,
    QUESTION_MIN,
    build_question_set,
)
from app.interview_store import InterviewStore


PROJECT_ROOT = Path(__file__).resolve().parents[1]
STORAGE_ROOT = Path(
    os.getenv("INTERVIEW_DATA_DIR", str(PROJECT_ROOT / ".cache" / "interview"))
)
STORE = InterviewStore(STORAGE_ROOT)
CHUNK_SIZE = 4 * 1024 * 1024
UPLOAD_SESSION_TTL_SECONDS = 60 * 60
MAX_UPLOAD_SESSIONS = 16
DEFAULT_ANALYSIS_WORKERS = 2

_VIDEO_SESSIONS: dict[str, dict[str, Any]] = {}
_VIDEO_LOCK = threading.RLock()


def _analysis_workers() -> int:
    raw = os.getenv("INTERVIEW_ANALYSIS_WORKERS", str(DEFAULT_ANALYSIS_WORKERS))
    try:
        return max(1, int(raw))
    except (TypeError, ValueError):
        return DEFAULT_ANALYSIS_WORKERS


_ANALYSIS_POOL = ThreadPoolExecutor(
    max_workers=_analysis_workers(),
    thread_name_prefix="interview-analysis",
)


class InterviewWorkflowError(RuntimeError):
    def __init__(self, code: str, detail: str) -> None:
        super().__init__(detail)
        self.code = code
        self.detail = detail


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _chunk_count(total_bytes: int) -> int:
    return (total_bytes + CHUNK_SIZE - 1) // CHUNK_SIZE


def _expected_chunk_bytes(total_bytes: int, chunk_index: int) -> int:
    count = _chunk_count(total_bytes)
    if chunk_index < count - 1:
        return CHUNK_SIZE
    return total_bytes - (count - 1) * CHUNK_SIZE


def _cleanup_upload_sessions_locked(now: float | None = None) -> None:
    cutoff = (now or time.time()) - UPLOAD_SESSION_TTL_SECONDS
    for session_id, session in list(_VIDEO_SESSIONS.items()):
        if session.get("updated_at", 0) < cutoff:
            shutil.rmtree(session["directory"], ignore_errors=True)
            _VIDEO_SESSIONS.pop(session_id, None)


def generate_question_set(
    *,
    profile_id: str,
    profile_snapshot: dict[str, Any],
    role_context: str | None,
    question_count: int = DEFAULT_QUESTION_COUNT,
) -> dict[str, Any]:
    if not (QUESTION_MIN <= question_count <= QUESTION_MAX):
        raise InterviewWorkflowError(
            "invalid_question_count",
            f"question_count must be between {QUESTION_MIN} and {QUESTION_MAX}",
        )
    result = build_question_set(
        profile_id=profile_id,
        profile=profile_snapshot,
        role_context=role_context,
        question_count=question_count,
    )
    return STORE.create_question_set(
        profile_id=profile_id,
        profile_snapshot=profile_snapshot,
        language="en",
        role_context=role_context,
        candidate_name=result["candidate_name"],
        questions=result["questions"],
        document_markdown=result["document_markdown"],
        generation=result["generation"],
        warnings=result["warnings"],
    )


def get_question_set(question_set_id: str) -> dict[str, Any] | None:
    return STORE.get_question_set(question_set_id)


def get_question_document(question_set_id: str) -> str | None:
    return STORE.get_question_document(question_set_id)


def create_interview(question_set_id: str) -> dict[str, Any] | None:
    return STORE.create_interview(question_set_id)


def get_interview(interview_id: str) -> dict[str, Any] | None:
    return STORE.get_interview(interview_id)


def get_report(interview_id: str) -> dict[str, Any] | None:
    return STORE.get_report(interview_id)


def get_video_asset(
    interview_id: str,
) -> tuple[Path, dict[str, Any]] | None:
    interview = STORE.get_interview(interview_id)
    if interview is None or not isinstance(interview.get("video"), dict):
        return None
    path = STORE.get_video_path(interview_id)
    if path is None:
        return None
    return path, interview["video"]


def init_video_upload(
    interview_id: str,
    *,
    filename: str,
    total_bytes: int,
    content_type: str | None,
) -> dict[str, Any]:
    interview = STORE.get_interview(interview_id)
    if interview is None:
        raise InterviewWorkflowError("interview_not_found", "Interview not found")
    if interview["status"] in {
        "analyzing",
        "completed",
        "completed_with_warnings",
    }:
        raise InterviewWorkflowError(
            "interview_locked",
            "Video cannot be replaced while analysis is running or after completion.",
        )
    safe_name = Path(filename or "").name
    suffix = validate_video_suffix(safe_name)
    if (
        isinstance(total_bytes, bool)
        or not isinstance(total_bytes, int)
        or total_bytes <= 0
    ):
        raise InterviewWorkflowError("invalid_video_size", "Invalid total_bytes")
    if total_bytes > max_video_bytes():
        raise InterviewWorkflowError(
            "video_too_large",
            f"Video exceeds the {max_video_bytes()} byte limit",
        )
    canonical_type = VIDEO_CONTENT_TYPES[suffix]
    if content_type and not (
        content_type == canonical_type
        or content_type.startswith("video/")
    ):
        raise InterviewWorkflowError(
            "invalid_video_content_type",
            "Uploaded content type must be a video MIME type.",
        )

    session_id = "vup_" + uuid4().hex[:12]
    directory = STORE.root / "upload-sessions" / session_id
    directory.mkdir(parents=True, exist_ok=True)
    now = time.time()
    with _VIDEO_LOCK:
        _cleanup_upload_sessions_locked(now)
        if len(_VIDEO_SESSIONS) >= MAX_UPLOAD_SESSIONS:
            shutil.rmtree(directory, ignore_errors=True)
            raise InterviewWorkflowError(
                "too_many_upload_sessions",
                "Too many active video upload sessions; retry later.",
            )
        _VIDEO_SESSIONS[session_id] = {
            "interview_id": interview_id,
            "filename": safe_name,
            "suffix": suffix,
            "total_bytes": total_bytes,
            "content_type": canonical_type,
            "chunk_count": _chunk_count(total_bytes),
            "received": set(),
            "directory": str(directory),
            "created_at": now,
            "updated_at": now,
            "completing": False,
        }
    STORE.update_interview(
        interview_id,
        status="uploading",
        stage="uploading_video",
        progress={"done": 0, "total": _chunk_count(total_bytes)},
        error=None,
    )
    return {
        "session_id": session_id,
        "chunk_size": CHUNK_SIZE,
        "chunk_count": _chunk_count(total_bytes),
        "total_bytes": total_bytes,
    }


def upload_video_chunk(
    interview_id: str,
    session_id: str,
    chunk_index: int,
    data: bytes,
) -> dict[str, Any]:
    with _VIDEO_LOCK:
        _cleanup_upload_sessions_locked()
        session = _VIDEO_SESSIONS.get(session_id)
        if session is None or session["interview_id"] != interview_id:
            raise InterviewWorkflowError(
                "upload_session_not_found",
                "Video upload session not found or expired.",
            )
        if session["completing"]:
            raise InterviewWorkflowError(
                "upload_session_completing",
                "Video upload session is already being finalized.",
            )
        if not (0 <= chunk_index < session["chunk_count"]):
            raise InterviewWorkflowError(
                "invalid_chunk_index",
                "chunk_index is out of range.",
            )
        expected = _expected_chunk_bytes(session["total_bytes"], chunk_index)
        if len(data) != expected:
            raise InterviewWorkflowError(
                "invalid_chunk_size",
                f"Chunk expected {expected} bytes, received {len(data)}.",
            )
        part = Path(session["directory"]) / f"{chunk_index:05d}.part"
        part.write_bytes(data)
        session["received"].add(chunk_index)
        session["updated_at"] = time.time()
        received = len(session["received"])
        total = session["chunk_count"]
    STORE.update_interview(
        interview_id,
        progress={"done": received, "total": total},
    )
    return {
        "session_id": session_id,
        "chunk_index": chunk_index,
        "bytes": len(data),
        "received": received,
        "chunk_count": total,
    }


def complete_video_upload(
    interview_id: str,
    session_id: str,
) -> dict[str, Any]:
    with _VIDEO_LOCK:
        _cleanup_upload_sessions_locked()
        session = _VIDEO_SESSIONS.get(session_id)
        if session is None or session["interview_id"] != interview_id:
            raise InterviewWorkflowError(
                "upload_session_not_found",
                "Video upload session not found or expired.",
            )
        if session["completing"]:
            raise InterviewWorkflowError(
                "upload_session_completing",
                "Video upload session is already being finalized.",
            )
        missing = [
            index
            for index in range(session["chunk_count"])
            if index not in session["received"]
        ]
        if missing:
            raise InterviewWorkflowError(
                "incomplete_upload",
                f"Missing video chunks: {missing}",
            )
        session["completing"] = True
        session["updated_at"] = time.time()

    directory = Path(session["directory"])
    destination = STORE.video_destination(interview_id, session["suffix"])
    temporary = destination.with_suffix(destination.suffix + ".part")
    digest = hashlib.sha256()
    try:
        with temporary.open("wb") as output:
            for index in range(session["chunk_count"]):
                part = directory / f"{index:05d}.part"
                with part.open("rb") as source:
                    while block := source.read(1024 * 1024):
                        digest.update(block)
                        output.write(block)
        probe = probe_video(temporary)
        temporary.replace(destination)
        video = {
            "filename": session["filename"],
            "content_type": session["content_type"],
            "size_bytes": session["total_bytes"],
            "sha256": digest.hexdigest(),
            "duration_ms": probe["duration_ms"],
            "width": probe["width"],
            "height": probe["height"],
        }
    except InterviewMediaError:
        temporary.unlink(missing_ok=True)
        with _VIDEO_LOCK:
            _VIDEO_SESSIONS.pop(session_id, None)
        STORE.update_interview(
            interview_id,
            status="created",
            stage="upload_failed",
            error={"code": "invalid_video", "detail": "Video validation failed."},
        )
        raise
    except Exception as exc:
        temporary.unlink(missing_ok=True)
        with _VIDEO_LOCK:
            _VIDEO_SESSIONS.pop(session_id, None)
        STORE.update_interview(
            interview_id,
            status="created",
            stage="upload_failed",
            error={
                "code": "video_finalize_failed",
                "detail": f"Could not finalize video upload ({type(exc).__name__}).",
            },
        )
        raise InterviewWorkflowError(
            "video_finalize_failed",
            f"Could not finalize video upload ({type(exc).__name__}).",
        ) from exc
    finally:
        shutil.rmtree(directory, ignore_errors=True)

    with _VIDEO_LOCK:
        _VIDEO_SESSIONS.pop(session_id, None)
    updated = STORE.update_interview(
        interview_id,
        status="uploaded",
        stage="video_ready",
        progress={"done": session["chunk_count"], "total": session["chunk_count"]},
        video=video,
        video_path=str(destination),
        warnings=[],
        error=None,
    )
    if updated is None:
        raise InterviewWorkflowError(
            "interview_not_found",
            "Interview disappeared while finalizing the upload.",
        )
    return updated


def start_interview_analysis(interview_id: str) -> dict[str, Any]:
    interview = STORE.get_interview(interview_id)
    if interview is None:
        raise InterviewWorkflowError("interview_not_found", "Interview not found")
    if interview["status"] == "analyzing":
        return {"interview_id": interview_id, "status": "analyzing", "accepted": False}
    if interview["status"] in {"completed", "completed_with_warnings"}:
        return {
            "interview_id": interview_id,
            "status": interview["status"],
            "accepted": False,
        }
    video_path = STORE.get_video_path(interview_id)
    if video_path is None:
        raise InterviewWorkflowError(
            "video_not_uploaded",
            "Upload and finalize a video before starting analysis.",
        )
    STORE.update_interview(
        interview_id,
        status="analyzing",
        stage="queued",
        progress={"done": 0, "total": 0},
        warnings=[],
        error=None,
    )
    try:
        _ANALYSIS_POOL.submit(_run_interview_analysis, interview_id)
    except Exception as exc:
        STORE.update_interview(
            interview_id,
            status="failed",
            stage="queue_failed",
            error={
                "code": "analysis_queue_failed",
                "detail": f"Could not queue analysis ({type(exc).__name__}).",
            },
        )
        raise InterviewWorkflowError(
            "analysis_queue_failed",
            "Could not queue interview analysis.",
        ) from exc
    return {"interview_id": interview_id, "status": "analyzing", "accepted": True}


def _run_interview_analysis(interview_id: str) -> None:
    try:
        interview = STORE.get_interview(interview_id)
        if interview is None:
            return
        question_set = STORE.get_question_set(interview["question_set_id"])
        video_path = STORE.get_video_path(interview_id)
        if question_set is None or video_path is None:
            raise InterviewWorkflowError(
                "analysis_inputs_missing",
                "Question set or uploaded video is no longer available.",
            )

        STORE.update_interview(
            interview_id,
            stage="transcribing",
            progress={"done": 0, "total": 1},
        )
        transcript = transcribe_video(video_path)
        STORE.update_interview(
            interview_id,
            transcript=transcript,
            stage="aligning_answers",
            progress={"done": 1, "total": 4},
        )

        alignment = align_answers(question_set, transcript["segments"])
        STORE.update_interview(
            interview_id,
            stage="analyzing_questions",
            progress={"done": 2, "total": 4},
        )

        report = analyze_interview(question_set, transcript, alignment)
        report["interview_id"] = interview_id
        report["video"] = interview["video"]
        report["generated_at"] = _now_iso()
        warnings = report.get("warnings", [])
        final_status = (
            "completed_with_warnings" if warnings else "completed"
        )
        STORE.update_interview(
            interview_id,
            status=final_status,
            stage="completed",
            progress={"done": 4, "total": 4},
            report=report,
            warnings=warnings,
            error=None,
        )
    except InterviewMediaError as exc:
        STORE.update_interview(
            interview_id,
            status="failed",
            stage="failed",
            error={"code": exc.code, "detail": exc.detail},
        )
    except Exception as exc:
        STORE.update_interview(
            interview_id,
            status="failed",
            stage="failed",
            error={
                "code": "interview_analysis_failed",
                "detail": f"Interview analysis failed ({type(exc).__name__}).",
            },
        )


def delete_interview(interview_id: str) -> bool:
    interview = STORE.get_interview(interview_id)
    if interview is None:
        return False
    if interview["status"] == "analyzing":
        raise InterviewWorkflowError(
            "interview_busy",
            "Cannot delete an interview while analysis is running.",
        )
    return STORE.delete_interview(interview_id)
