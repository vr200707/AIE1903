"""D5 联调：FastAPI 端点，把解析、抽取、核验串成完整链路。

端点（与 docs/api.md 对齐，并扩展大文件分片上传与异步分析）：
- `POST /api/upload`   上传 1-4 份 PDF/DOCX（小文件，multipart 一次提交）；
- `POST /api/upload/init`            创建分片上传会话；
- `PUT  /api/upload/session/{sid}/files/{i}/chunks/{j}`  上传单个分片（raw bytes）；
- `POST /api/upload/session/{sid}/complete`              校验并合并分片，返回 upload_id；
- `POST /api/analyze`  异步触发 解析 -> 抽取 -> 核验，立即返回 202；
- `GET  /api/analyze/{upload_id}`  轮询分析进度与结果（含 warnings）；
- `GET  /api/profile`  按 `profile_id` 或 `upload_id` 返回档案本体；
- `POST /api/qa`       基于档案回答自然语言问题（加分项）；
- `GET  /health`       健康检查（联调用）。

存储为进程内字典 + 落盘上传目录，适合单进程本地联调；生产需替换为持久化存储。
"""

from __future__ import annotations

import hashlib
import os
import shutil
import threading
import uuid
from pathlib import Path
from typing import Any, Optional

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse

from app.extractor import extract_profile
from app.parser import CONTENT_TYPES, SUPPORTED_SUFFIXES, parse_document
from app.qa import answer_question
from app.verify import verify_profile


PROJECT_ROOT = Path(__file__).resolve().parents[1]
UPLOAD_DIR = PROJECT_ROOT / ".cache" / "uploads"
CHUNK_DIR = UPLOAD_DIR / ".chunks"
MAX_FILES = 4
# 分片大小 4MB，远低于 Next.js 代理默认 10MB 的请求体缓冲上限，
# 因此任意大文件都能分多次请求稳定传输，不再触碰代理层的 500。
CHUNK_SIZE = 4 * 1024 * 1024
# 单文件业务上限（策略性上限，而非传输限制），可通过 MAX_FILE_BYTES 覆盖。
DEFAULT_MAX_FILE_BYTES = 100 * 1024 * 1024

app = FastAPI(title="AIE1903 Candidate Analysis", version="0.1.0")

# upload_id -> {"documents": [...], "paths": [...], "profile": ..., "profile_id": ...}
_UPLOADS: dict[str, dict[str, Any]] = {}
# session_id -> {"chunk_size": int, "files": [{"filename", "total_bytes", "chunk_count", "received": set}]}
_CHUNK_SESSIONS: dict[str, dict[str, Any]] = {}
_UPLOAD_LOCK = threading.Lock()


def _max_file_bytes() -> int:
    raw = os.getenv("MAX_FILE_BYTES", str(DEFAULT_MAX_FILE_BYTES))
    try:
        return max(1024, int(raw))
    except (TypeError, ValueError):
        return DEFAULT_MAX_FILE_BYTES


def _http_error(status: int, code: str, message: str) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "detail": message})


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
    for upload in files:
        filename = _validate_filename(upload.filename)
        path = dest / filename
        size = 0
        with path.open("wb") as out:
            while chunk := upload.file.read(1024 * 1024):
                size += len(chunk)
                if size > max_bytes:
                    raise _http_error(413, "file_too_large", f"File too large: {filename}")
                out.write(chunk)
        documents.append(_document_entry(filename, size))
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
    return JSONResponse(status_code=201, content={"upload_id": upload_id, "documents": documents})


@app.post("/api/upload/init")
def upload_init(body: dict[str, Any]) -> JSONResponse:
    files = body.get("files")
    if not isinstance(files, list) or not (1 <= len(files) <= MAX_FILES):
        raise _http_error(413, "too_many_files", f"Upload between 1 and {MAX_FILES} documents")
    max_bytes = _max_file_bytes()
    session_files: list[dict[str, Any]] = []
    for item in files:
        if not isinstance(item, dict):
            raise _http_error(422, "bad_file", "Each file entry must be an object")
        filename = _validate_filename(str(item.get("filename", "")))
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
    (CHUNK_DIR / session_id).mkdir(parents=True, exist_ok=True)
    _CHUNK_SESSIONS[session_id] = {"chunk_size": CHUNK_SIZE, "files": session_files}
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
    session = _CHUNK_SESSIONS.get(session_id)
    if session is None:
        raise _http_error(404, "session_not_found", "Upload session not found or already completed")
    files = session["files"]
    if not (0 <= file_index < len(files)):
        raise _http_error(422, "bad_file_index", "file_index out of range")
    meta = files[file_index]
    if not (0 <= chunk_index < meta["chunk_count"]):
        raise _http_error(422, "bad_chunk_index", "chunk_index out of range")
    data = await request.body()
    expected = _expected_chunk_size(meta, chunk_index)
    if len(data) != expected:
        raise _http_error(
            422,
            "bad_chunk_size",
            f"Chunk {chunk_index} for {meta['filename']} expected {expected} bytes, got {len(data)}",
        )
    part = CHUNK_DIR / session_id / f"{file_index:02d}_{chunk_index:05d}.part"
    part.write_bytes(data)
    meta["received"].add(chunk_index)
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
    session = _CHUNK_SESSIONS.get(session_id)
    if session is None:
        raise _http_error(404, "session_not_found", "Upload session not found")
    session_dir = CHUNK_DIR / session_id
    upload_id = "upl_" + uuid.uuid4().hex[:12]
    dest = UPLOAD_DIR / upload_id
    dest.mkdir(parents=True, exist_ok=True)
    documents: list[dict[str, Any]] = []
    max_bytes = _max_file_bytes()
    for file_index, meta in enumerate(session["files"]):
        missing = [i for i in range(meta["chunk_count"]) if i not in meta["received"]]
        if missing:
            raise _http_error(409, "incomplete_upload", f"Missing chunks {missing} for {meta['filename']}")
        path = dest / meta["filename"]
        size = 0
        with path.open("wb") as out:
            for chunk_index in range(meta["chunk_count"]):
                part = session_dir / f"{file_index:02d}_{chunk_index:05d}.part"
                data = part.read_bytes()
                if len(data) != _expected_chunk_size(meta, chunk_index):
                    raise _http_error(409, "corrupt_chunk", f"Chunk {chunk_index} for {meta['filename']} is corrupt")
                out.write(data)
                size += len(data)
        if size != meta["total_bytes"] or size > max_bytes:
            raise _http_error(413, "file_too_large", f"File too large: {meta['filename']}")
        documents.append(_document_entry(meta["filename"], size))
    _UPLOADS[upload_id] = {
        "documents": documents,
        "paths": [str(p) for p in sorted(dest.iterdir())],
    }
    shutil.rmtree(session_dir, ignore_errors=True)
    _CHUNK_SESSIONS.pop(session_id, None)
    return JSONResponse(status_code=201, content={"upload_id": upload_id, "documents": documents})


def _run_analysis(upload_id: str, entry: dict[str, Any]) -> None:
    """后台执行解析 -> 抽取 -> 核验，并把核验降级信息收集为 warnings。"""
    try:
        documents = [parse_document(path) for path in entry["paths"]]
        profile, _skipped = extract_profile(documents)
        warnings: list[str] = []
        verified = verify_profile(profile, verify_web=True, warnings=warnings)
        profile_id = "prf_" + hashlib.sha256(upload_id.encode()).hexdigest()[:12]
        with _UPLOAD_LOCK:
            entry["profile"] = verified
            entry["profile_id"] = profile_id
            entry["warnings"] = warnings
            entry["status"] = "partial" if warnings else "completed"
    except Exception as exc:  # 解析/抽取失败才判 failed，核验失败不走到这里。
        with _UPLOAD_LOCK:
            entry["status"] = "failed"
            entry["error"] = f"{type(exc).__name__}: {exc}"


@app.post("/api/analyze")
def analyze(body: dict[str, Any]) -> JSONResponse:
    upload_id = body.get("upload_id")
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
            return JSONResponse(status_code=202, content={"upload_id": upload_id, "status": "processing"})
        if entry.get("status") == "failed":
            raise _http_error(500, "analysis_failed", entry.get("error") or "Analysis failed")
        entry["status"] = "processing"
        entry["warnings"] = []
    threading.Thread(target=_run_analysis, args=(upload_id, entry), daemon=True).start()
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
    if profile is not None:
        return JSONResponse(
            status_code=200,
            content={
                "upload_id": upload_id,
                "status": status,
                "profile_id": profile_id,
                "schema_version": profile["schema_version"],
                "candidate": profile["candidate"],
                "warnings": warnings,
            },
        )
    if status == "failed":
        raise _http_error(500, "analysis_failed", error or "Analysis failed")
    if status == "processing":
        return JSONResponse(status_code=202, content={"upload_id": upload_id, "status": "processing", "warnings": []})
    return JSONResponse(status_code=200, content={"upload_id": upload_id, "status": "pending", "warnings": []})


@app.get("/api/profile")
def profile(
    profile_id: Optional[str] = None,
    upload_id: Optional[str] = None,
) -> dict[str, Any]:
    entry = _find_entry(profile_id=profile_id, upload_id=upload_id)
    if "profile" not in entry:
        status = entry.get("status")
        if status == "processing":
            raise _http_error(409, "still_processing", "Analysis is still running. Poll /api/analyze/{upload_id}.")
        if status == "failed":
            raise _http_error(500, "analysis_failed", entry.get("error") or "Analysis failed")
        raise _http_error(404, "not_analyzed", "Profile has not been generated. Call /api/analyze first.")
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
