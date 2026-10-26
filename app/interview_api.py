"""FastAPI routes for the interview page's backend workflow."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, Response

from app.interview_clips import answer_windows
from app.interview_media import InterviewMediaError
from app.interview_questions import DEFAULT_QUESTION_COUNT, QUESTION_MAX, QUESTION_MIN
from app.interview_service import (
    CHUNK_SIZE,
    InterviewWorkflowError,
    add_question,
    complete_video_upload,
    create_candidate_interview,
    create_interview,
    delete_question,
    delete_interview,
    get_candidate_question_set,
    generate_question_set,
    get_interview,
    get_interview_clip,
    get_question_document,
    get_question_set,
    get_report,
    get_transcript,
    get_video_asset,
    init_video_upload,
    start_interview_analysis,
    publish_question_set,
    update_question,
    unpublish_question_set,
    upload_video_chunk,
)


ProfileResolver = Callable[[str], dict[str, Any]]


def _http_error(status: int, code: str, detail: str) -> HTTPException:
    return HTTPException(
        status_code=status,
        detail={"code": code, "detail": detail},
    )


def _workflow_status(code: str) -> int:
    if code.endswith("_not_found"):
        return 404
    if code in {
        "interview_locked",
        "question_set_locked",
        "question_limit_reached",
        "no_approved_questions",
        "candidate_set_not_published",
        "video_not_uploaded",
        "incomplete_upload",
        "interview_busy",
        "upload_session_completing",
    }:
        return 409
    if code in {"too_many_upload_sessions"}:
        return 429
    if code in {"video_too_large"}:
        return 413
    if code in {"analysis_queue_failed"}:
        return 503
    return 422


def create_interview_router(
    profile_resolver: ProfileResolver,
) -> APIRouter:
    router = APIRouter(prefix="/api/interview")

    @router.post("/question-sets")
    def create_question_set(body: dict[str, Any]) -> JSONResponse:
        profile_id = body.get("profile_id")
        if not isinstance(profile_id, str) or not profile_id.strip():
            raise _http_error(
                422,
                "missing_profile_id",
                "Provide profile_id from the existing candidate profile.",
            )
        language = body.get("language", "en")
        if language != "en":
            raise _http_error(
                422,
                "unsupported_language",
                "This release supports English interview questions only.",
            )
        role_context = body.get("role_context")
        if role_context is not None and not isinstance(role_context, str):
            raise _http_error(
                422,
                "invalid_role_context",
                "role_context must be a string when provided.",
            )
        raw_count = body.get("question_count", DEFAULT_QUESTION_COUNT)
        if (
            isinstance(raw_count, bool)
            or not isinstance(raw_count, int)
            or not (QUESTION_MIN <= raw_count <= QUESTION_MAX)
        ):
            raise _http_error(
                422,
                "invalid_question_count",
                f"question_count must be between {QUESTION_MIN} and {QUESTION_MAX}.",
            )
        profile = profile_resolver(profile_id.strip())
        try:
            question_set = generate_question_set(
                profile_id=profile_id.strip(),
                profile_snapshot=profile,
                role_context=role_context.strip() if role_context else None,
                question_count=raw_count,
            )
        except ValueError as exc:
            raise _http_error(
                502,
                "question_generation_failed",
                f"Could not generate interview questions: {exc}",
            ) from exc
        except Exception as exc:
            raise _http_error(
                502,
                "question_generation_failed",
                f"Could not generate interview questions ({type(exc).__name__}).",
            ) from exc
        return JSONResponse(status_code=201, content=question_set)

    @router.get("/question-sets/{question_set_id}")
    def read_question_set(question_set_id: str) -> dict[str, Any]:
        question_set = get_question_set(question_set_id)
        if question_set is None:
            raise _http_error(404, "question_set_not_found", "Question set not found.")
        return question_set

    @router.get("/question-sets/{question_set_id}/document")
    def download_question_set(
        question_set_id: str,
        format: str = "md",
    ) -> Response:
        if format not in {"md", "txt"}:
            raise _http_error(
                422,
                "invalid_document_format",
                "format must be md or txt.",
            )
        document = get_question_document(question_set_id)
        if document is None:
            raise _http_error(404, "question_set_not_found", "Question set not found.")
        if format == "txt":
            document = (
                document.replace("### ", "")
                .replace("## ", "")
                .replace("# ", "")
            )
            media_type = "text/plain; charset=utf-8"
            suffix = "txt"
        else:
            media_type = "text/markdown; charset=utf-8"
            suffix = "md"
        filename = f"interview-questions-{question_set_id}.{suffix}"
        return Response(
            content=document,
            media_type=media_type,
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
            },
        )

    @router.patch("/question-sets/{question_set_id}/questions/{question_id}")
    def patch_question(
        question_set_id: str,
        question_id: str,
        body: dict[str, Any],
    ) -> dict[str, Any]:
        updates: dict[str, Any] = {}
        for field in ("text", "objective", "why_it_matters"):
            if field not in body:
                continue
            value = body[field]
            if not isinstance(value, str):
                raise _http_error(
                    422,
                    "invalid_question_field",
                    f"{field} must be a string when provided.",
                )
            updates[field] = value
        if "answer_seconds" in body:
            value = body["answer_seconds"]
            if isinstance(value, bool) or not isinstance(value, int):
                raise _http_error(
                    422,
                    "invalid_answer_seconds",
                    "answer_seconds must be an integer when provided.",
                )
            updates["answer_seconds"] = value
        if "competency" in body:
            value = body["competency"]
            if not isinstance(value, str):
                raise _http_error(
                    422,
                    "invalid_competency",
                    "competency must be a string when provided.",
                )
            updates["competency"] = value
        if "approved" in body:
            value = body["approved"]
            if not isinstance(value, bool):
                raise _http_error(
                    422,
                    "invalid_approval",
                    "approved must be a boolean when provided.",
                )
            updates["approved"] = value
        if not updates:
            raise _http_error(
                422,
                "empty_question_update",
                "Provide at least one editable question field.",
            )
        try:
            return update_question(question_set_id, question_id, updates)
        except InterviewWorkflowError as exc:
            raise _http_error(
                _workflow_status(exc.code),
                exc.code,
                exc.detail,
            ) from exc

    @router.post("/question-sets/{question_set_id}/questions")
    def create_question(
        question_set_id: str,
        body: dict[str, Any],
    ) -> dict[str, Any]:
        text = body.get("text")
        if not isinstance(text, str) or not text.strip():
            raise _http_error(
                422,
                "invalid_question_text",
                "Question text is required and must be a string.",
            )
        question: dict[str, Any] = {"text": text}
        for field in ("objective", "why_it_matters", "competency"):
            if field not in body:
                continue
            value = body[field]
            if not isinstance(value, str):
                raise _http_error(
                    422,
                    f"invalid_{field}",
                    f"{field} must be a string when provided.",
                )
            question[field] = value
        if "answer_seconds" in body:
            value = body["answer_seconds"]
            if isinstance(value, bool) or not isinstance(value, int):
                raise _http_error(
                    422,
                    "invalid_answer_seconds",
                    "answer_seconds must be an integer when provided.",
                )
            question["answer_seconds"] = value
        try:
            return add_question(question_set_id, question)
        except InterviewWorkflowError as exc:
            raise _http_error(
                _workflow_status(exc.code),
                exc.code,
                exc.detail,
            ) from exc

    @router.post("/question-sets/{question_set_id}/publish")
    def publish_question_set_route(question_set_id: str) -> dict[str, Any]:
        try:
            return publish_question_set(question_set_id)
        except InterviewWorkflowError as exc:
            raise _http_error(
                _workflow_status(exc.code),
                exc.code,
                exc.detail,
            ) from exc

    @router.post("/question-sets/{question_set_id}/unpublish")
    def unpublish_question_set_route(question_set_id: str) -> dict[str, Any]:
        try:
            return unpublish_question_set(question_set_id)
        except InterviewWorkflowError as exc:
            raise _http_error(
                _workflow_status(exc.code),
                exc.code,
                exc.detail,
            ) from exc

    @router.delete("/question-sets/{question_set_id}/questions/{question_id}")
    def remove_question(
        question_set_id: str,
        question_id: str,
    ) -> dict[str, Any]:
        try:
            return delete_question(question_set_id, question_id)
        except InterviewWorkflowError as exc:
            raise _http_error(
                _workflow_status(exc.code),
                exc.code,
                exc.detail,
            ) from exc

    @router.get("/candidate/{candidate_token}")
    def candidate_question_set(candidate_token: str) -> dict[str, Any]:
        try:
            return get_candidate_question_set(candidate_token)
        except InterviewWorkflowError as exc:
            raise _http_error(
                _workflow_status(exc.code),
                exc.code,
                exc.detail,
            ) from exc

    @router.post("/candidate/{candidate_token}/interviews")
    def candidate_interview(candidate_token: str) -> JSONResponse:
        try:
            created = create_candidate_interview(candidate_token)
        except InterviewWorkflowError as exc:
            raise _http_error(
                _workflow_status(exc.code),
                exc.code,
                exc.detail,
            ) from exc
        return JSONResponse(status_code=201, content=created)

    @router.post("/interviews")
    def create(body: dict[str, Any]) -> JSONResponse:
        question_set_id = body.get("question_set_id")
        if not isinstance(question_set_id, str) or not question_set_id.strip():
            raise _http_error(
                422,
                "missing_question_set_id",
                "Provide question_set_id.",
            )
        interview = create_interview(question_set_id.strip())
        if interview is None:
            raise _http_error(
                404,
                "question_set_not_found",
                "Question set not found.",
            )
        return JSONResponse(status_code=201, content=interview)

    @router.get("/interviews/{interview_id}")
    def read_interview(interview_id: str) -> dict[str, Any]:
        interview = get_interview(interview_id)
        if interview is None:
            raise _http_error(404, "interview_not_found", "Interview not found.")
        return interview

    @router.post("/interviews/{interview_id}/video/init")
    def init_video(interview_id: str, body: dict[str, Any]) -> JSONResponse:
        filename = body.get("filename")
        total_bytes = body.get("total_bytes")
        content_type = body.get("content_type")
        if not isinstance(filename, str) or not filename.strip():
            raise _http_error(422, "missing_filename", "Provide video filename.")
        try:
            session = init_video_upload(
                interview_id,
                filename=filename.strip(),
                total_bytes=total_bytes,
                content_type=content_type if isinstance(content_type, str) else None,
            )
        except InterviewMediaError as exc:
            raise _http_error(422, exc.code, exc.detail) from exc
        except InterviewWorkflowError as exc:
            raise _http_error(
                _workflow_status(exc.code),
                exc.code,
                exc.detail,
            ) from exc
        return JSONResponse(status_code=201, content=session)

    @router.put(
        "/interviews/{interview_id}/video/sessions/{session_id}/chunks/{chunk_index}"
    )
    async def put_video_chunk(
        interview_id: str,
        session_id: str,
        chunk_index: int,
        request: Request,
    ) -> dict[str, Any]:
        data = bytearray()
        async for block in request.stream():
            data.extend(block)
            if len(data) > CHUNK_SIZE:
                raise _http_error(
                    413,
                    "chunk_too_large",
                    f"Video chunks must not exceed {CHUNK_SIZE} bytes.",
                )
        try:
            return upload_video_chunk(
                interview_id,
                session_id,
                chunk_index,
                bytes(data),
            )
        except InterviewWorkflowError as exc:
            raise _http_error(
                _workflow_status(exc.code),
                exc.code,
                exc.detail,
            ) from exc

    @router.post(
        "/interviews/{interview_id}/video/sessions/{session_id}/complete"
    )
    def complete_video(
        interview_id: str,
        session_id: str,
        body: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        try:
            question_marks = body.get("question_marks") if body else None
            return complete_video_upload(
                interview_id,
                session_id,
                question_marks=question_marks,
            )
        except InterviewMediaError as exc:
            raise _http_error(
                422 if exc.code not in {"media_dependency_missing"} else 503,
                exc.code,
                exc.detail,
            ) from exc
        except InterviewWorkflowError as exc:
            raise _http_error(
                _workflow_status(exc.code),
                exc.code,
                exc.detail,
            ) from exc

    @router.post("/interviews/{interview_id}/analyze")
    def analyze(interview_id: str) -> JSONResponse:
        try:
            result = start_interview_analysis(interview_id)
        except InterviewWorkflowError as exc:
            raise _http_error(
                _workflow_status(exc.code),
                exc.code,
                exc.detail,
            ) from exc
        status_code = 202 if result["accepted"] else 200
        return JSONResponse(status_code=status_code, content=result)

    @router.get("/interviews/{interview_id}/video")
    def stream_video(interview_id: str) -> FileResponse:
        asset = get_video_asset(interview_id)
        if asset is None:
            raise _http_error(
                404,
                "video_not_found",
                "Interview video is not available.",
            )
        path, video = asset
        return FileResponse(
            path=path,
            media_type=video.get("content_type", "video/mp4"),
            headers={"Cache-Control": "private, max-age=0"},
        )

    @router.get("/interviews/{interview_id}/clips/{question_id}")
    def stream_clip(interview_id: str, question_id: str) -> FileResponse:
        clip = get_interview_clip(interview_id, question_id)
        if clip is None:
            raise _http_error(
                404,
                "clip_not_found",
                "No extracted clip exists for this question yet.",
            )
        return FileResponse(
            path=clip,
            media_type="video/mp4",
            headers={"Cache-Control": "private, max-age=0"},
        )

    @router.get("/interviews/{interview_id}/clips")
    def list_clips(interview_id: str) -> dict[str, Any]:
        if get_interview(interview_id) is None:
            raise _http_error(404, "interview_not_found", "Interview not found.")
        report = get_report(interview_id)
        if report is None:
            return {"interview_id": interview_id, "clips": []}
        clips = []
        for window in answer_windows(report):
            question_id = window["question_id"]
            clips.append(
                {
                    "question_id": question_id,
                    "start_ms": window["start_ms"],
                    "end_ms": window["end_ms"],
                    "available": get_interview_clip(interview_id, question_id)
                    is not None,
                    "url": (
                        f"/api/interview/interviews/{interview_id}/clips/"
                        f"{question_id}"
                    ),
                }
            )
        return {"interview_id": interview_id, "clips": clips}

    @router.get("/interviews/{interview_id}/report")
    def read_report(interview_id: str) -> dict[str, Any]:
        interview = get_interview(interview_id)
        if interview is None:
            raise _http_error(404, "interview_not_found", "Interview not found.")
        report = get_report(interview_id)
        if report is None:
            if interview["status"] == "analyzing":
                raise _http_error(
                    409,
                    "analysis_in_progress",
                    "Interview analysis is still running.",
                )
            if interview["status"] == "failed":
                error = interview.get("error") or {}
                raise _http_error(
                    409,
                    error.get("code", "interview_analysis_failed"),
                    error.get("detail", "Interview analysis failed."),
                )
            raise _http_error(
                409,
                "report_not_ready",
                "Upload a video and start analysis before requesting the report.",
            )
        return report

    @router.get("/interviews/{interview_id}/transcript")
    def read_transcript(interview_id: str) -> dict[str, Any]:
        interview = get_interview(interview_id)
        if interview is None:
            raise _http_error(404, "interview_not_found", "Interview not found.")
        transcript = get_transcript(interview_id)
        if transcript is None:
            if interview["status"] == "analyzing":
                raise _http_error(
                    409,
                    "analysis_in_progress",
                    "Transcription is still running.",
                )
            if interview["status"] == "failed":
                error = interview.get("error") or {}
                raise _http_error(
                    409,
                    error.get("code", "interview_analysis_failed"),
                    error.get("detail", "Interview analysis failed."),
                )
            raise _http_error(
                409,
                "transcript_not_ready",
                "Upload a video and start analysis before requesting the transcript.",
            )
        return transcript

    @router.delete("/interviews/{interview_id}")
    def remove_interview(interview_id: str) -> dict[str, Any]:
        try:
            deleted = delete_interview(interview_id)
        except InterviewWorkflowError as exc:
            raise _http_error(
                _workflow_status(exc.code),
                exc.code,
                exc.detail,
            ) from exc
        if not deleted:
            raise _http_error(404, "interview_not_found", "Interview not found.")
        return {"interview_id": interview_id, "deleted": True}

    return router
