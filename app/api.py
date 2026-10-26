"""D5 联调：FastAPI 端点，把解析、抽取、核验串成完整链路。

端点（与 docs/api.md 对齐，并扩展大文件分片上传与异步分析）：
- `POST /api/upload`   上传 1-4 份 PDF/DOCX（小文件，multipart 一次提交）；
- `POST /api/upload/init`            创建分片上传会话；
- `PUT  /api/upload/session/{sid}/files/{i}/chunks/{j}`  上传单个分片（raw bytes）；
- `POST /api/upload/session/{sid}/complete`              校验并合并分片，返回 upload_id；
- `POST /api/analyze`  异步触发 解析 -> 抽取 -> 核验，立即返回 202；
- `GET  /api/analyze/{upload_id}`  轮询分析进度与结果（含 warnings）；
- `GET  /api/profile`  按 `profile_id` 或 `upload_id` 返回档案本体；
- `POST /api/score`    对给定档案调用 DeepSeek 打分（评分与可信度解耦）；
- `POST /api/qa`       基于档案回答自然语言问题（加分项）；
- `GET  /health`       健康检查（联调用）。

存储为进程内字典 + 落盘上传目录，适合单进程本地联调；生产需替换为持久化存储。
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Optional

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse

from app import health as health_monitor
from app.extractor import extract_profile
from app.interview_api import create_interview_router
from app.parser import (
    CONTENT_TYPES,
    SUPPORTED_SUFFIXES,
    ParsedDocument,
    parse_document,
)
from app.qa import answer_question
from app.resilience import (
    AnalysisWarning,
    collect_retryable_verification_warnings,
    warning,
)
from app.scorer import score_candidate
from app.verify import mark_verification_incomplete, verify_profile


PROJECT_ROOT = Path(__file__).resolve().parents[1]
UPLOAD_DIR = PROJECT_ROOT / ".cache" / "uploads"
PROFILE_DIR = PROJECT_ROOT / ".cache" / "profiles"
SCHEMA_PATH = PROJECT_ROOT / "contracts" / "schema.json"
CHUNK_DIR = UPLOAD_DIR / ".chunks"
MAX_FILES = 4
# 分片大小 4MB，远低于 Next.js 代理默认 10MB 的请求体缓冲上限，
# 因此任意大文件都能分多次请求稳定传输，不再触碰代理层的 500。
CHUNK_SIZE = 4 * 1024 * 1024
# 单文件业务上限（策略性上限，而非传输限制），可通过 MAX_FILE_BYTES 覆盖。
DEFAULT_MAX_FILE_BYTES = 100 * 1024 * 1024
DEFAULT_CHUNK_SESSION_TTL_SECONDS = 60 * 60
DEFAULT_MAX_CHUNK_SESSIONS = 32
DEFAULT_ANALYSIS_MAX_WORKERS = 4

# upload_id -> {"documents": [...], "paths": [...], "profile": ..., "profile_id": ...}
_UPLOADS: dict[str, dict[str, Any]] = {}
# session_id -> {"chunk_size": int, "files": [{"filename", "total_bytes", "chunk_count", "received": set}]}
_CHUNK_SESSIONS: dict[str, dict[str, Any]] = {}
_UPLOAD_LOCK = threading.Lock()
_CHUNK_LOCK = threading.Lock()


def _save_profile_snapshot(upload_id: str, entry: dict[str, Any]) -> None:
    """Atomically persist one upload's state so restarts do not lose profiles."""
    PROFILE_DIR.mkdir(parents=True, exist_ok=True)
    target = PROFILE_DIR / f"{upload_id}.json"
    temporary = PROFILE_DIR / f"{upload_id}.json.tmp"
    payload = {
        "upload_id": upload_id,
        "profile_id": entry.get("profile_id"),
        "documents": entry.get("documents", []),
        "paths": entry.get("paths", []),
        "profile": entry.get("profile"),
        "assessment": entry.get("assessment"),
        "warnings": entry.get("warnings", []),
        "status": entry.get("status"),
        "progress": entry.get("progress"),
        "error": entry.get("error"),
    }
    try:
        temporary.write_text(
            json.dumps(payload, ensure_ascii=False),
            encoding="utf-8",
        )
        os.replace(temporary, target)
    except (OSError, TypeError, ValueError):
        # Persistence must never break the analysis flow itself.
        pass


def load_profile_snapshots() -> int:
    """Restore persisted uploads into `_UPLOADS`. Returns entries loaded."""
    if not PROFILE_DIR.exists():
        return 0
    loaded = 0
    for path in sorted(PROFILE_DIR.glob("*.json")):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if not isinstance(payload, dict):
            continue
        upload_id = payload.get("upload_id") or path.stem
        if not isinstance(upload_id, str) or not upload_id:
            continue
        documents = payload.get("documents")
        paths = payload.get("paths")
        profile = payload.get("profile")
        warnings = payload.get("warnings")
        entry: dict[str, Any] = {
            "documents": documents if isinstance(documents, list) else [],
            "paths": paths if isinstance(paths, list) else [],
            "profile": profile if isinstance(profile, dict) else None,
            "profile_id": payload.get("profile_id"),
            "assessment": payload.get("assessment"),
            "warnings": warnings if isinstance(warnings, list) else [],
            "status": payload.get("status"),
            "progress": payload.get("progress"),
            "error": payload.get("error"),
        }
        if entry.get("status") == "processing":
            # The analysis thread died with the previous process. The raw
            # files remain on disk, so downgrade to a retryable state.
            entry["status"] = "created"
            entry["progress"] = {"stage": "queued", "done": 0, "total": 0}
            entry["error"] = None
            _save_profile_snapshot(upload_id, entry)
        _UPLOADS[upload_id] = entry
        loaded += 1
    return loaded


@asynccontextmanager
async def _lifespan(_: FastAPI):
    load_profile_snapshots()
    yield


app = FastAPI(
    title="AIE1903 Candidate Analysis",
    version="0.1.0",
    lifespan=_lifespan,
)


class _AnalysisFailure(Exception):
    def __init__(self, code: str, detail: str) -> None:
        super().__init__(detail)
        self.code = code
        self.detail = detail


def _max_file_bytes() -> int:
    raw = os.getenv("MAX_FILE_BYTES", str(DEFAULT_MAX_FILE_BYTES))
    try:
        return max(1024, int(raw))
    except (TypeError, ValueError):
        return DEFAULT_MAX_FILE_BYTES


def _chunk_session_ttl_seconds() -> int:
    raw = os.getenv(
        "CHUNK_SESSION_TTL_SECONDS",
        str(DEFAULT_CHUNK_SESSION_TTL_SECONDS),
    )
    try:
        return max(60, int(raw))
    except (TypeError, ValueError):
        return DEFAULT_CHUNK_SESSION_TTL_SECONDS


def _max_chunk_sessions() -> int:
    raw = os.getenv(
        "MAX_CHUNK_SESSIONS",
        str(DEFAULT_MAX_CHUNK_SESSIONS),
    )
    try:
        return max(1, int(raw))
    except (TypeError, ValueError):
        return DEFAULT_MAX_CHUNK_SESSIONS


def _analysis_max_workers() -> int:
    raw = os.getenv(
        "ANALYSIS_MAX_WORKERS",
        str(DEFAULT_ANALYSIS_MAX_WORKERS),
    )
    try:
        return max(1, int(raw))
    except (TypeError, ValueError):
        return DEFAULT_ANALYSIS_MAX_WORKERS


_ANALYSIS_POOL = ThreadPoolExecutor(
    max_workers=_analysis_max_workers(),
    thread_name_prefix="analysis",
)


def _http_error(status: int, code: str, message: str) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "detail": message})


def _cleanup_expired_chunk_sessions_locked(now: float | None = None) -> None:
    cutoff = (now or time.time()) - _chunk_session_ttl_seconds()
    expired = [
        session_id
        for session_id, session in _CHUNK_SESSIONS.items()
        if not session.get("completing")
        and session.get("updated_at", 0) < cutoff
    ]
    for session_id in expired:
        _CHUNK_SESSIONS.pop(session_id, None)
        shutil.rmtree(CHUNK_DIR / session_id, ignore_errors=True)


def _validate_filename(filename: str | None) -> str:
    name = Path(filename or "").name
    if not name:
        raise _http_error(422, "missing_filename", "Upload file name is missing")
    suffix = Path(name).suffix.lower()
    if suffix not in SUPPORTED_SUFFIXES:
        raise _http_error(422, "unsupported_type", f"Unsupported document type: {name}")
    return name


def _document_entry(filename: str, size: int) -> dict[str, Any]:
    suffix = Path(filename).suffix.lower()
    return {
        "document_id": "doc_" + uuid.uuid4().hex[:10],
        "filename": filename,
        "content_type": CONTENT_TYPES[suffix],
        "size_bytes": size,
        "status": "accepted",
    }


def _save_upload(files: list[UploadFile], upload_id: str) -> list[dict[str, Any]]:
    dest = UPLOAD_DIR / upload_id
    dest.mkdir(parents=True, exist_ok=True)
    max_bytes = _max_file_bytes()
    documents: list[dict[str, Any]] = []
    try:
        for upload in files:
            filename = _validate_filename(upload.filename)
            path = dest / filename
            size = 0
            with path.open("wb") as out:
                while chunk := upload.file.read(1024 * 1024):
                    size += len(chunk)
                    if size > max_bytes:
                        raise _http_error(
                            413,
                            "file_too_large",
                            f"File too large: {filename}",
                        )
                    out.write(chunk)
            documents.append(_document_entry(filename, size))
    except Exception:
        shutil.rmtree(dest, ignore_errors=True)
        raise
    return documents


def _find_entry(*, profile_id: str | None, upload_id: str | None) -> dict[str, Any]:
    if profile_id:
        for entry in _UPLOADS.values():
            if entry.get("profile_id") == profile_id:
                return entry
        raise _http_error(404, "not_found", "profile_id not found")
    if upload_id:
        entry = _UPLOADS.get(upload_id)
        if entry is None:
            raise _http_error(404, "not_found", "upload_id not found")
        return entry
    raise _http_error(422, "missing_id", "Provide either profile_id or upload_id")


def _resolve_interview_profile(profile_id: str) -> dict[str, Any]:
    entry = _find_entry(profile_id=profile_id, upload_id=None)
    profile = entry.get("profile")
    if not isinstance(profile, dict):
        raise _http_error(
            404,
            "not_analyzed",
            "Profile has not been generated. Analyze candidate documents first.",
        )
    return {
        "schema_version": profile.get("schema_version", "1.0.0"),
        "candidate": profile.get("candidate", {}),
    }


def _chunk_count(total_bytes: int, chunk_size: int) -> int:
    return (total_bytes + chunk_size - 1) // chunk_size


def _expected_chunk_size(meta: dict[str, Any], chunk_index: int) -> int:
    total = meta["total_bytes"]
    if chunk_index < meta["chunk_count"] - 1:
        return meta["chunk_size"]
    return total - (meta["chunk_count"] - 1) * meta["chunk_size"]


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/health/live")
def health_live() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/health/ready")
def health_ready() -> JSONResponse:
    payload = health_monitor.check_readiness(
        project_root=PROJECT_ROOT,
        schema_path=SCHEMA_PATH,
        upload_dir=UPLOAD_DIR,
    )
    status_code = 200 if payload["status"] == "ready" else 503
    return JSONResponse(status_code=status_code, content=payload)


@app.get("/health/dependencies")
def health_dependencies() -> dict[str, Any]:
    return health_monitor.dependency_snapshot(project_root=PROJECT_ROOT)


def _parse_documents_safely(
    paths: list[str],
) -> tuple[list[ParsedDocument], list[AnalysisWarning]]:
    """Parse independently so one damaged file does not discard other results."""
    documents: list[ParsedDocument] = []
    warnings: list[AnalysisWarning] = []
    for raw_path in paths:
        path = Path(raw_path)
        try:
            document = parse_document(raw_path)
        except Exception as exc:
            warnings.append(
                warning(
                    "document_parse_failed",
                    "parsing",
                    (
                        f"{path.name} could not be parsed ({type(exc).__name__}). "
                        "Replace or repair the file, then retry the analysis."
                    ),
                    retryable=False,
                    source=path.name,
                )
            )
            continue

        document_warnings = getattr(document, "warnings", [])
        warnings.extend(document_warnings)
        if document.full_text().strip():
            documents.append(document)
        elif not document_warnings:
            warnings.append(
                warning(
                    "no_extractable_text",
                    "parsing",
                    (
                        f"{path.name} did not contain extractable text. Use a "
                        "text-based document or enable OCR, then retry."
                    ),
                    retryable=True,
                    source=path.name,
                )
            )
    return documents, warnings


@app.post("/api/upload")
def upload(files: list[UploadFile] = File(...)) -> JSONResponse:
    if not files or len(files) > MAX_FILES:
        raise _http_error(413, "too_many_files", f"Upload at most {MAX_FILES} documents")
    upload_id = "upl_" + uuid.uuid4().hex[:12]
    documents = _save_upload(files, upload_id)
    dest = UPLOAD_DIR / upload_id
    _UPLOADS[upload_id] = {
        "documents": documents,
        "paths": [str(p) for p in sorted(dest.iterdir())],
    }
    _save_profile_snapshot(upload_id, _UPLOADS[upload_id])
    return JSONResponse(status_code=201, content={"upload_id": upload_id, "documents": documents})


@app.post("/api/upload/init")
def upload_init(body: dict[str, Any]) -> JSONResponse:
    files = body.get("files")
    if not isinstance(files, list) or not (1 <= len(files) <= MAX_FILES):
        raise _http_error(413, "too_many_files", f"Upload between 1 and {MAX_FILES} documents")
    max_bytes = _max_file_bytes()
    session_files: list[dict[str, Any]] = []
    filenames: set[str] = set()
    for item in files:
        if not isinstance(item, dict):
            raise _http_error(422, "bad_file", "Each file entry must be an object")
        filename = _validate_filename(str(item.get("filename", "")))
        if filename in filenames:
            raise _http_error(
                422,
                "duplicate_filename",
                f"File names must be unique within one upload session: {filename}",
            )
        filenames.add(filename)
        total_bytes = item.get("total_bytes")
        if not isinstance(total_bytes, int) or total_bytes <= 0:
            raise _http_error(422, "bad_size", f"Invalid total_bytes for {filename}")
        if total_bytes > max_bytes:
            raise _http_error(413, "file_too_large", f"File too large: {filename}")
        session_files.append(
            {
                "filename": filename,
                "total_bytes": total_bytes,
                "chunk_size": CHUNK_SIZE,
                "chunk_count": _chunk_count(total_bytes, CHUNK_SIZE),
                "received": set(),
            }
        )
    session_id = "chk_" + uuid.uuid4().hex[:12]
    now = time.time()
    with _CHUNK_LOCK:
        _cleanup_expired_chunk_sessions_locked(now)
        if len(_CHUNK_SESSIONS) >= _max_chunk_sessions():
            raise _http_error(
                429,
                "too_many_upload_sessions",
                "Too many active upload sessions. Retry after an older session expires.",
            )
        (CHUNK_DIR / session_id).mkdir(parents=True, exist_ok=True)
        _CHUNK_SESSIONS[session_id] = {
            "chunk_size": CHUNK_SIZE,
            "files": session_files,
            "created_at": now,
            "updated_at": now,
            "completing": False,
        }
    return JSONResponse(
        status_code=201,
        content={
            "session_id": session_id,
            "chunk_size": CHUNK_SIZE,
            "files": [
                {
                    "file_index": index,
                    "filename": meta["filename"],
                    "total_bytes": meta["total_bytes"],
                    "chunk_count": meta["chunk_count"],
                }
                for index, meta in enumerate(session_files)
            ],
        },
    )


@app.put("/api/upload/session/{session_id}/files/{file_index}/chunks/{chunk_index}")
async def upload_chunk(
    session_id: str,
    file_index: int,
    chunk_index: int,
    request: Request,
) -> JSONResponse:
    with _CHUNK_LOCK:
        _cleanup_expired_chunk_sessions_locked()
        session = _CHUNK_SESSIONS.get(session_id)
        if session is None:
            raise _http_error(
                404,
                "session_not_found",
                "Upload session not found, expired, or already completed",
            )
        if session.get("completing"):
            raise _http_error(
                409,
                "session_completing",
                "Upload session is already being finalized",
            )
        files = session["files"]
        if not (0 <= file_index < len(files)):
            raise _http_error(422, "bad_file_index", "file_index out of range")
        meta = files[file_index]
        if not (0 <= chunk_index < meta["chunk_count"]):
            raise _http_error(422, "bad_chunk_index", "chunk_index out of range")
    expected = _expected_chunk_size(meta, chunk_index)
    content_length = request.headers.get("content-length")
    if content_length is not None:
        try:
            declared_size = int(content_length)
        except ValueError as exc:
            raise _http_error(
                400,
                "invalid_content_length",
                "Content-Length must be a non-negative integer",
            ) from exc
        if declared_size < 0:
            raise _http_error(
                400,
                "invalid_content_length",
                "Content-Length must be a non-negative integer",
            )
        if declared_size > expected:
            raise _http_error(
                413,
                "chunk_too_large",
                f"Chunk {chunk_index} for {meta['filename']} exceeds {expected} bytes",
            )
        if declared_size != expected:
            raise _http_error(
                422,
                "bad_chunk_size",
                f"Chunk {chunk_index} for {meta['filename']} expected {expected} bytes, got {declared_size}",
            )

    data = bytearray()
    async for block in request.stream():
        if len(data) + len(block) > expected:
            raise _http_error(
                413,
                "chunk_too_large",
                f"Chunk {chunk_index} for {meta['filename']} exceeds {expected} bytes",
            )
        data.extend(block)
    if len(data) != expected:
        raise _http_error(
            422,
            "bad_chunk_size",
            f"Chunk {chunk_index} for {meta['filename']} expected {expected} bytes, got {len(data)}",
        )
    part = CHUNK_DIR / session_id / f"{file_index:02d}_{chunk_index:05d}.part"
    part.write_bytes(bytes(data))
    with _CHUNK_LOCK:
        session = _CHUNK_SESSIONS.get(session_id)
        if session is None or session.get("completing"):
            part.unlink(missing_ok=True)
            raise _http_error(
                409,
                "session_completing",
                "Upload session expired or is already being finalized",
            )
        meta = session["files"][file_index]
        meta["received"].add(chunk_index)
        session["updated_at"] = time.time()
    return JSONResponse(
        status_code=200,
        content={
            "session_id": session_id,
            "file_index": file_index,
            "chunk_index": chunk_index,
            "bytes": len(data),
            "received": len(meta["received"]),
            "chunk_count": meta["chunk_count"],
        },
    )


@app.post("/api/upload/session/{session_id}/complete")
def upload_complete(session_id: str) -> JSONResponse:
    with _CHUNK_LOCK:
        _cleanup_expired_chunk_sessions_locked()
        session = _CHUNK_SESSIONS.get(session_id)
        if session is None:
            raise _http_error(
                404,
                "session_not_found",
                "Upload session not found, expired, or already completed",
            )
        if session.get("completing"):
            raise _http_error(
                409,
                "session_completing",
                "Upload session is already being finalized",
            )
        session["completing"] = True
        session["updated_at"] = time.time()
        session_files = session["files"]

    session_dir = CHUNK_DIR / session_id
    upload_id = "upl_" + uuid.uuid4().hex[:12]
    staging_dir = UPLOAD_DIR / f".{upload_id}.staging"
    dest = UPLOAD_DIR / upload_id
    documents: list[dict[str, Any]] = []
    max_bytes = _max_file_bytes()
    try:
        for meta in session_files:
            missing = [
                index
                for index in range(meta["chunk_count"])
                if index not in meta["received"]
            ]
            if missing:
                raise _http_error(
                    409,
                    "incomplete_upload",
                    f"Missing chunks {missing} for {meta['filename']}",
                )
            if meta["total_bytes"] > max_bytes:
                raise _http_error(
                    413,
                    "file_too_large",
                    f"File too large: {meta['filename']}",
                )

        for file_index, meta in enumerate(session_files):
            for chunk_index in range(meta["chunk_count"]):
                part = session_dir / f"{file_index:02d}_{chunk_index:05d}.part"
                if not part.is_file():
                    raise _http_error(
                        409,
                        "corrupt_chunk",
                        f"Chunk {chunk_index} for {meta['filename']} is missing",
                    )
                if part.stat().st_size != _expected_chunk_size(meta, chunk_index):
                    raise _http_error(
                        409,
                        "corrupt_chunk",
                        f"Chunk {chunk_index} for {meta['filename']} is corrupt",
                    )

        staging_dir.mkdir(parents=True, exist_ok=False)
        for file_index, meta in enumerate(session_files):
            path = staging_dir / meta["filename"]
            size = 0
            with path.open("wb") as out:
                for chunk_index in range(meta["chunk_count"]):
                    part = (
                        session_dir
                        / f"{file_index:02d}_{chunk_index:05d}.part"
                    )
                    data = part.read_bytes()
                    out.write(data)
                    size += len(data)
            if size != meta["total_bytes"] or size > max_bytes:
                raise _http_error(
                    413,
                    "file_too_large",
                    f"File too large: {meta['filename']}",
                )
            documents.append(_document_entry(meta["filename"], size))

        staging_dir.rename(dest)
        with _UPLOAD_LOCK:
            _UPLOADS[upload_id] = {
                "documents": documents,
                "paths": [str(path) for path in sorted(dest.iterdir())],
            }
            _save_profile_snapshot(upload_id, _UPLOADS[upload_id])
        with _CHUNK_LOCK:
            _CHUNK_SESSIONS.pop(session_id, None)
        shutil.rmtree(session_dir, ignore_errors=True)
    except HTTPException:
        shutil.rmtree(staging_dir, ignore_errors=True)
        with _CHUNK_LOCK:
            current = _CHUNK_SESSIONS.get(session_id)
            if current is not None:
                current["completing"] = False
                current["updated_at"] = time.time()
        raise
    except Exception as exc:
        shutil.rmtree(staging_dir, ignore_errors=True)
        with _CHUNK_LOCK:
            current = _CHUNK_SESSIONS.get(session_id)
            if current is not None:
                current["completing"] = False
                current["updated_at"] = time.time()
        raise _http_error(
            500,
            "upload_finalize_failed",
            f"Could not finalize uploaded files ({type(exc).__name__})",
        ) from exc
    return JSONResponse(status_code=201, content={"upload_id": upload_id, "documents": documents})


def _run_analysis(upload_id: str, entry: dict[str, Any]) -> None:
    """Run parsing, extraction, and verification without blocking POST."""
    warnings: list[AnalysisWarning] = []
    profile_id = "prf_" + hashlib.sha256(upload_id.encode()).hexdigest()[:12]

    def _set_progress(stage: str, done: int, total: int) -> None:
        with _UPLOAD_LOCK:
            entry["progress"] = {"stage": stage, "done": done, "total": total}

    try:
        _set_progress("parsing", 0, 0)
        documents, warnings = _parse_documents_safely(entry["paths"])
        if not documents:
            raise _AnalysisFailure(
                "no_readable_documents",
                (
                    "No uploaded document contained extractable text. Install "
                    "OCR dependencies or upload a text-based PDF/DOCX and retry."
                ),
            )

        _set_progress("extracting", 0, 0)
        try:
            profile, _skipped = extract_profile(documents)
        except Exception as exc:
            raise _AnalysisFailure(
                "extraction_failed",
                (
                    "Structured extraction failed "
                    f"({type(exc).__name__}). Retry the analysis."
                ),
            ) from exc

        publications = (
            profile.get("candidate", {})
            .get("publications_impact", {})
            .get("publications", [])
        )
        _set_progress("verifying_publications", 0, len(publications))
        try:
            verified = verify_profile(
                profile, verify_web=True, on_progress=_set_progress
            )
            warnings.extend(collect_retryable_verification_warnings(verified))
        except Exception as exc:
            verified = mark_verification_incomplete(profile, error=exc)
            warnings.append(
                warning(
                    "verification_incomplete",
                    "verification",
                    (
                        "External verification stopped unexpectedly. The "
                        "extracted profile was kept, and affected claims are "
                        "marked to_verify. Retry the analysis when the services "
                        "recover."
                    ),
                    retryable=True,
                )
            )

        _set_progress("scoring", 0, 1)
        candidate = verified.get("candidate", {})
        assessment = (
            score_candidate(candidate) if isinstance(candidate, dict) else None
        )
        if assessment is None:
            warnings.append(
                warning(
                    "scoring_unavailable",
                    "scoring",
                    (
                        "DeepSeek scoring failed; the score overview will show "
                        "rule-based credibility only. Retry the analysis when "
                        "the LLM service recovers."
                    ),
                    retryable=True,
                )
            )

        with _UPLOAD_LOCK:
            entry["progress"] = {
                "stage": "completed",
                "done": len(publications),
                "total": len(publications),
            }
            entry["profile"] = verified
            entry["profile_id"] = profile_id
            entry["assessment"] = assessment
            entry["warnings"] = [item.as_dict() for item in warnings]
            entry["status"] = (
                "completed_with_warnings" if warnings else "completed"
            )
            entry.pop("error", None)
            _save_profile_snapshot(upload_id, entry)
    except _AnalysisFailure as exc:
        with _UPLOAD_LOCK:
            entry["status"] = "failed"
            entry["error"] = {"code": exc.code, "detail": exc.detail}
            _save_profile_snapshot(upload_id, entry)
    except Exception as exc:
        with _UPLOAD_LOCK:
            entry["status"] = "failed"
            entry["error"] = {
                "code": "analysis_failed",
                "detail": f"Analysis failed ({type(exc).__name__}). Retry the analysis.",
            }
            _save_profile_snapshot(upload_id, entry)


@app.post("/api/analyze")
def analyze(body: dict[str, Any]) -> JSONResponse:
    upload_id = body.get("upload_id")
    if not isinstance(upload_id, str) or not upload_id.strip():
        raise _http_error(422, "missing_upload_id", "Provide upload_id")
    entry = _find_entry(profile_id=None, upload_id=upload_id)
    with _UPLOAD_LOCK:
        if entry.get("profile") is not None:
            profile = entry["profile"]
            return JSONResponse(
                status_code=200,
                content={
                    "upload_id": upload_id,
                    "profile_id": entry["profile_id"],
                    "status": entry.get("status", "completed"),
                    "schema_version": profile["schema_version"],
                    "candidate": profile["candidate"],
                    "warnings": entry.get("warnings", []),
                },
            )
        if entry.get("status") == "processing":
            return JSONResponse(
                status_code=202,
                content={"upload_id": upload_id, "status": "processing"},
            )
        entry.pop("error", None)
        entry["status"] = "processing"
        entry["warnings"] = []
        entry["progress"] = {"stage": "queued", "done": 0, "total": 0}
        _save_profile_snapshot(upload_id, entry)
    try:
        _ANALYSIS_POOL.submit(_run_analysis, upload_id, entry)
    except Exception as exc:
        with _UPLOAD_LOCK:
            entry["status"] = "failed"
            entry["error"] = {
                "code": "analysis_queue_failed",
                "detail": f"Could not queue analysis ({type(exc).__name__})",
            }
        raise _http_error(
            503,
            "analysis_queue_failed",
            "Could not queue analysis. Retry shortly.",
        ) from exc
    return JSONResponse(status_code=202, content={"upload_id": upload_id, "status": "processing"})


@app.get("/api/analyze/{upload_id}")
def analyze_status(upload_id: str) -> JSONResponse:
    entry = _find_entry(profile_id=None, upload_id=upload_id)
    with _UPLOAD_LOCK:
        status = entry.get("status", "pending")
        warnings = entry.get("warnings", [])
        error = entry.get("error")
        profile = entry.get("profile")
        profile_id = entry.get("profile_id")
        progress = entry.get("progress")
        assessment = entry.get("assessment")
    if profile is not None:
        return JSONResponse(
            status_code=200,
            content={
                "upload_id": upload_id,
                "status": status,
                "profile_id": profile_id,
                "schema_version": profile["schema_version"],
                "candidate": profile["candidate"],
                "assessment": assessment,
                "warnings": warnings,
            },
        )
    if status == "failed":
        return JSONResponse(
            status_code=200,
            content={
                "upload_id": upload_id,
                "status": "failed",
                "warnings": warnings,
                "error": error or {
                    "code": "analysis_failed",
                    "detail": "Analysis failed",
                },
            },
        )
    if status == "processing":
        return JSONResponse(
            status_code=202,
            content={
                "upload_id": upload_id,
                "status": "processing",
                "warnings": [],
                "progress": progress or {"stage": "queued", "done": 0, "total": 0},
            },
        )
    return JSONResponse(
        status_code=200,
        content={"upload_id": upload_id, "status": "pending", "warnings": []},
    )


@app.post("/api/score")
def score(body: dict[str, Any]) -> JSONResponse:
    """对给定档案调用 DeepSeek 打分；供前端对 mock / 已存档档案即时获取评分。"""
    candidate = body.get("candidate")
    if not isinstance(candidate, dict) or not candidate:
        raise _http_error(422, "missing_candidate", "Provide candidate object")
    assessment = score_candidate(candidate)
    if assessment is None:
        raise _http_error(
            502,
            "scoring_unavailable",
            "DeepSeek scoring failed. Retry shortly.",
        )
    return JSONResponse(status_code=200, content={"assessment": assessment})


@app.get("/api/profile")
def profile(
    profile_id: Optional[str] = None,
    upload_id: Optional[str] = None,
) -> dict[str, Any]:
    entry = _find_entry(profile_id=profile_id, upload_id=upload_id)
    if "profile" not in entry:
        status = entry.get("status")
        if status == "processing":
            raise _http_error(
                409,
                "still_processing",
                "Analysis is still running. Poll /api/analyze/{upload_id}.",
            )
        if status == "failed":
            error = entry.get("error")
            detail = (
                error.get("detail")
                if isinstance(error, dict)
                else "Analysis failed"
            )
            raise _http_error(500, "analysis_failed", detail)
        raise _http_error(
            404,
            "not_analyzed",
            "Profile has not been generated. Call /api/analyze first.",
        )
    stored = entry["profile"]
    return {
        "schema_version": stored["schema_version"],
        "candidate": stored["candidate"],
    }


@app.post("/api/qa")
def qa(body: dict[str, Any]) -> dict[str, Any]:
    profile_id = body.get("profile_id")
    if not isinstance(profile_id, str) or not profile_id.strip():
        raise _http_error(422, "missing_profile_id", "Provide profile_id")
    question = body.get("question")
    if not isinstance(question, str) or not question.strip():
        raise _http_error(422, "missing_question", "Provide a non-empty question")

    entry = _find_entry(profile_id=profile_id.strip(), upload_id=None)
    if "profile" not in entry:
        raise _http_error(404, "not_analyzed", "Profile has not been generated. Call /api/analyze first.")

    try:
        return answer_question(entry["profile"], question)
    except ValueError as exc:
        raise _http_error(500, "qa_failed", f"Q&A failed: {exc}") from exc


app.include_router(create_interview_router(_resolve_interview_profile))
