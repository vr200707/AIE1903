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
from app.interview_clips import (
    apply_recorded_marks,
    clip_path,
    generate_interview_clips,
)
from app.interview_media import (
    InterviewMediaError,
    VIDEO_CONTENT_TYPES,
    max_video_bytes,
    probe_video,
    transcribe_video,
    validate_video_suffix,
)
from app.interview_questions import (
    COMPETENCIES,
    DEFAULT_QUESTION_COUNT,
    QUESTION_MAX,
    QUESTION_MIN,
    build_question_set,
    render_question_document,
)
from app.interview_llm import trim_text
from app.interview_store import InterviewStore, _id


PROJECT_ROOT = Path(__file__).resolve().parents[1]
STORAGE_ROOT = Path(
    os.getenv("INTERVIEW_DATA_DIR", str(PROJECT_ROOT / ".cache" / "interview"))
)
STORE = InterviewStore(STORAGE_ROOT)
CHUNK_SIZE = 4 * 1024 * 1024
UPLOAD_SESSION_TTL_SECONDS = 60 * 60
MAX_UPLOAD_SESSIONS = 16
DEFAULT_ANALYSIS_WORKERS = 2
MAX_COMMITTEE_QUESTIONS = 12

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


def _load_editable_question_set(question_set_id: str) -> dict[str, Any]:
    question_set = STORE.get_question_set(question_set_id)
    if question_set is None:
        raise InterviewWorkflowError(
            "question_set_not_found",
            "Question set not found.",
        )
    if question_set.get("status") == "published":
        raise InterviewWorkflowError(
            "question_set_locked",
            (
                "This question set has been published. Unpublish it before "
                "editing, adding, deleting, or changing question approval."
            ),
        )
    if STORE.has_submitted_interview(question_set_id):
        raise InterviewWorkflowError(
            "question_set_locked",
            (
                "This question set already has a submitted interview session "
                "(a recorded video or a generated report), so its questions "
                "can no longer be edited or deleted."
            ),
        )
    return question_set


def _persist_question_changes(
    question_set: dict[str, Any],
    questions: list[dict[str, Any]],
) -> dict[str, Any]:
    document = render_question_document(
        profile_id=question_set["profile_id"],
        candidate_name=question_set.get("candidate_name"),
        role_context=question_set.get("role_context"),
        questions=questions,
        generation=question_set["generation"],
    )
    updated = STORE.replace_question_set_questions(
        question_set["question_set_id"],
        questions,
        document,
    )
    if updated is None:
        raise InterviewWorkflowError(
            "question_set_not_found",
            "Question set not found.",
        )
    return updated


def update_question(
    question_set_id: str,
    question_id: str,
    updates: dict[str, Any],
) -> dict[str, Any]:
    """Apply validated field changes to one question in a question set."""
    question_set = _load_editable_question_set(question_set_id)
    questions = question_set["questions"]
    target_index = next(
        (
            index
            for index, question in enumerate(questions)
            if question.get("question_id") == question_id
        ),
        None,
    )
    if target_index is None:
        raise InterviewWorkflowError(
            "question_not_found",
            "Question not found in this question set.",
        )

    target = dict(questions[target_index])
    if "text" in updates:
        text = trim_text(updates["text"], 1_200)
        if not text:
            raise InterviewWorkflowError(
                "invalid_question_text",
                "Question text must not be empty.",
            )
        target["text"] = text
    if "objective" in updates:
        target["objective"] = trim_text(updates["objective"], 500)
    if "why_it_matters" in updates:
        target["why_it_matters"] = trim_text(updates["why_it_matters"], 500)
    if "answer_seconds" in updates:
        try:
            target["answer_seconds"] = min(180, max(45, int(updates["answer_seconds"])))
        except (TypeError, ValueError) as exc:
            raise InterviewWorkflowError(
                "invalid_answer_seconds",
                "answer_seconds must be an integer.",
            ) from exc
    if "competency" in updates:
        if updates["competency"] not in COMPETENCIES:
            raise InterviewWorkflowError(
                "invalid_competency",
                f"competency must be one of: {', '.join(sorted(COMPETENCIES))}.",
            )
        target["competency"] = updates["competency"]
    if "approved" in updates:
        if not isinstance(updates["approved"], bool):
            raise InterviewWorkflowError(
                "invalid_approval",
                "approved must be a boolean.",
            )
        target["approved"] = updates["approved"]

    questions[target_index] = target
    return _persist_question_changes(question_set, questions)


def delete_question(question_set_id: str, question_id: str) -> dict[str, Any]:
    """Remove one question and renumber the remaining ones."""
    question_set = _load_editable_question_set(question_set_id)
    questions = question_set["questions"]
    if len(questions) <= 1:
        raise InterviewWorkflowError(
            "cannot_delete_last_question",
            "A question set must keep at least one question.",
        )
    remaining = [
        question
        for question in questions
        if question.get("question_id") != question_id
    ]
    if len(remaining) == len(questions):
        raise InterviewWorkflowError(
            "question_not_found",
            "Question not found in this question set.",
        )
    for index, question in enumerate(remaining, start=1):
        question["order"] = index
        question["question_id"] = f"q_{index:02d}"
    return _persist_question_changes(question_set, remaining)


def add_question(
    question_set_id: str,
    question: dict[str, Any],
) -> dict[str, Any]:
    """Append a committee-authored question to an editable question set."""
    question_set = _load_editable_question_set(question_set_id)
    questions = question_set["questions"]
    if len(questions) >= MAX_COMMITTEE_QUESTIONS:
        raise InterviewWorkflowError(
            "question_limit_reached",
            f"A question set can hold at most {MAX_COMMITTEE_QUESTIONS} questions.",
        )

    text = trim_text(question.get("text"), 1_200)
    if not text:
        raise InterviewWorkflowError(
            "invalid_question_text",
            "Question text must not be empty.",
        )

    competency = question.get("competency") or "other"
    if competency not in COMPETENCIES:
        raise InterviewWorkflowError(
            "invalid_competency",
            f"competency must be one of: {', '.join(sorted(COMPETENCIES))}.",
        )

    try:
        answer_seconds = min(
            180,
            max(45, int(question.get("answer_seconds") or 90)),
        )
    except (TypeError, ValueError) as exc:
        raise InterviewWorkflowError(
            "invalid_answer_seconds",
            "answer_seconds must be an integer.",
        ) from exc

    next_order = len(questions) + 1
    questions.append(
        {
            "question_id": f"q_{next_order:02d}",
            "order": next_order,
            "text": text,
            "competency": competency,
            "objective": trim_text(question.get("objective"), 500),
            "why_it_matters": trim_text(question.get("why_it_matters"), 500),
            "answer_seconds": answer_seconds,
            "source_claims": [],
        }
    )
    return _persist_question_changes(question_set, questions)


def publish_question_set(question_set_id: str) -> dict[str, Any]:
    """Publish the approved subset of a question set for the candidate."""
    question_set = STORE.get_question_set(question_set_id)
    if question_set is None:
        raise InterviewWorkflowError(
            "question_set_not_found",
            "Question set not found.",
        )
    if STORE.has_submitted_interview(question_set_id):
        raise InterviewWorkflowError(
            "question_set_locked",
            (
                "This question set already has a submitted interview session, "
                "so its publish state can no longer change."
            ),
        )
    approved = [
        question
        for question in question_set["questions"]
        if question.get("approved")
    ]
    if not approved:
        raise InterviewWorkflowError(
            "no_approved_questions",
            "Approve at least one question before publishing.",
        )
    if question_set.get("status") != "published":
        question_set = STORE.set_publish_state(
            question_set_id,
            published=True,
            candidate_token=_id("cand_"),
        )
    if question_set is None:
        raise InterviewWorkflowError(
            "question_set_not_found",
            "Question set not found.",
        )
    return question_set


def unpublish_question_set(question_set_id: str) -> dict[str, Any]:
    """Return a published question set to draft while no session is submitted."""
    question_set = STORE.get_question_set(question_set_id)
    if question_set is None:
        raise InterviewWorkflowError(
            "question_set_not_found",
            "Question set not found.",
        )
    if STORE.has_submitted_interview(question_set_id):
        raise InterviewWorkflowError(
            "question_set_locked",
            (
                "This question set already has a submitted interview session, "
                "so it can no longer be unpublished."
            ),
        )
    updated = STORE.set_publish_state(question_set_id, published=False)
    if updated is None:
        raise InterviewWorkflowError(
            "question_set_not_found",
            "Question set not found.",
        )
    return updated


def get_candidate_question_set(candidate_token: str) -> dict[str, Any]:
    """Return the approved, published questions visible to the candidate."""
    question_set = STORE.get_question_set_by_token(candidate_token)
    if question_set is None:
        raise InterviewWorkflowError(
            "candidate_set_not_found",
            "Candidate question set not found.",
        )
    if question_set.get("status") != "published":
        raise InterviewWorkflowError(
            "candidate_set_not_published",
            "This question set is not currently published.",
        )
    approved = [
        question
        for question in question_set["questions"]
        if question.get("approved")
    ]
    return {
        "schema_version": "1.0.0",
        "question_set_id": question_set["question_set_id"],
        "candidate_name": question_set.get("candidate_name"),
        "role_context": question_set.get("role_context"),
        "questions": approved,
    }


def create_candidate_interview(candidate_token: str) -> dict[str, Any]:
    """Start an interview session from the candidate-facing link."""
    candidate_set = get_candidate_question_set(candidate_token)
    interview = STORE.create_interview(candidate_set["question_set_id"])
    if interview is None:
        raise InterviewWorkflowError(
            "candidate_set_not_found",
            "Candidate question set not found.",
        )
    return interview


def create_interview(question_set_id: str) -> dict[str, Any] | None:
    return STORE.create_interview(question_set_id)


def get_interview(interview_id: str) -> dict[str, Any] | None:
    return STORE.get_interview(interview_id)


def get_report(interview_id: str) -> dict[str, Any] | None:
    return STORE.get_report(interview_id)


def get_transcript(interview_id: str) -> dict[str, Any] | None:
    return STORE.get_transcript(interview_id)


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


def get_interview_clip(
    interview_id: str,
    question_id: str,
) -> Path | None:
    """Return the extracted MP4 clip for one question, when available."""
    interview = STORE.get_interview(interview_id)
    if interview is None or not isinstance(interview.get("video"), dict):
        return None
    return clip_path(STORE, interview_id, question_id)


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


def _sanitize_question_marks(
    question_marks: Any,
) -> list[dict[str, Any]] | None:
    """Validate the per-question recorder boundaries sent by the frontend."""
    if question_marks is None:
        return None
    if not isinstance(question_marks, list):
        raise InterviewWorkflowError(
            "invalid_question_marks",
            "question_marks must be a list of {question_id, start_ms} entries.",
        )
    cleaned: list[dict[str, Any]] = []
    seen: set[str] = set()
    for mark in question_marks:
        if not isinstance(mark, dict):
            continue
        question_id = mark.get("question_id")
        start_ms = mark.get("start_ms")
        if not isinstance(question_id, str) or not question_id:
            continue
        if question_id in seen:
            continue
        if not isinstance(start_ms, int) or isinstance(start_ms, bool) or start_ms < 0:
            continue
        seen.add(question_id)
        cleaned.append({"question_id": question_id, "start_ms": start_ms})
    return cleaned or None


def complete_video_upload(
    interview_id: str,
    session_id: str,
    question_marks: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    marks = _sanitize_question_marks(question_marks)
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
        if marks is not None:
            duration_ms = probe["duration_ms"]
            marks = [
                {**mark, "start_ms": min(mark["start_ms"], duration_ms)}
                for mark in marks
            ]
        video = {
            "filename": session["filename"],
            "content_type": session["content_type"],
            "size_bytes": session["total_bytes"],
            "sha256": digest.hexdigest(),
            "duration_ms": probe["duration_ms"],
            "width": probe["width"],
            "height": probe["height"],
            "question_marks": marks or [],
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
        if question_set.get("status") == "published":
            # Candidates only answer the approved subset.
            question_set = {
                **question_set,
                "questions": [
                    question
                    for question in question_set["questions"]
                    if question.get("approved")
                ],
            }

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
            progress={"done": 1, "total": 5},
        )

        alignment = align_answers(question_set, transcript["segments"])
        STORE.update_interview(
            interview_id,
            stage="analyzing_questions",
            progress={"done": 2, "total": 5},
        )

        report = analyze_interview(question_set, transcript, alignment)
        video_meta = interview.get("video") or {}
        report = apply_recorded_marks(
            report,
            video_meta.get("question_marks"),
            video_meta.get("duration_ms"),
        )
        STORE.update_interview(
            interview_id,
            stage="clipping_answers",
            progress={"done": 3, "total": 5},
        )
        clip_results = generate_interview_clips(
            STORE,
            interview_id,
            report,
            video_path,
            (interview.get("video") or {}).get("duration_ms"),
        )
        failed_clips = [
            item for item in clip_results if not item.get("clip_generated")
        ]
        if failed_clips:
            report.setdefault("warnings", []).extend(
                [
                    {
                        "code": "clip_generation_failed",
                        "stage": "clipping_answers",
                        "message": (
                            f"Could not extract the clip for "
                            f"{item['question_id']}: {item.get('detail')}"
                        ),
                        "retryable": True,
                        "source": item["question_id"],
                    }
                    for item in failed_clips
                ]
            )
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
            progress={"done": 5, "total": 5},
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
