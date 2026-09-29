"""D5 联调：FastAPI 端点，把解析、抽取、核验串成完整链路。

端点（与 docs/api.md 对齐）：
- `POST /api/upload`   上传 1-4 份 PDF/DOCX，返回 `upload_id`；
- `POST /api/analyze`  解析 -> 抽取 -> 核验，返回档案信封；
- `GET  /api/profile`  按 `profile_id` 或 `upload_id` 返回档案本体；
- `POST /api/qa`       基于档案回答自然语言问题（加分项）；
- `GET  /health`       健康检查（联调用）。

存储为进程内字典 + 落盘上传目录，适合单进程本地联调；生产需替换为持久化存储。
"""

from __future__ import annotations

import hashlib
import shutil
import uuid
from pathlib import Path
from typing import Any, Optional

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse

from app.extractor import extract_profile
from app.parser import CONTENT_TYPES, SUPPORTED_SUFFIXES, parse_document
from app.qa import answer_question
from app.verify import verify_profile


PROJECT_ROOT = Path(__file__).resolve().parents[1]
UPLOAD_DIR = PROJECT_ROOT / ".cache" / "uploads"
MAX_FILES = 4
MAX_FILE_BYTES = 10 * 1024 * 1024  # 单文件 10MB 上限。

app = FastAPI(title="AIE1903 Candidate Analysis", version="0.1.0")

# upload_id -> {"documents": [...], "paths": [...], "profile": ..., "profile_id": ...}
_UPLOADS: dict[str, dict[str, Any]] = {}


def _http_error(status: int, code: str, message: str) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "detail": message})


def _save_upload(files: list[UploadFile], upload_id: str) -> list[dict[str, Any]]:
    dest = UPLOAD_DIR / upload_id
    dest.mkdir(parents=True, exist_ok=True)
    documents: list[dict[str, Any]] = []
    for upload in files:
        filename = Path(upload.filename or "").name
        suffix = Path(filename).suffix.lower()
        if suffix not in SUPPORTED_SUFFIXES:
            raise _http_error(
                422, "unsupported_type", f"不支持的文档类型：{filename}"
            )
        path = dest / filename
        size = 0
        with path.open("wb") as out:
            while chunk := upload.file.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_FILE_BYTES:
                    raise _http_error(413, "file_too_large", f"文件过大：{filename}")
                out.write(chunk)
        documents.append(
            {
                "document_id": "doc_" + uuid.uuid4().hex[:10],
                "filename": filename,
                "content_type": CONTENT_TYPES[suffix],
                "size_bytes": size,
                "status": "accepted",
            }
        )
    return documents


def _find_entry(*, profile_id: str | None, upload_id: str | None) -> dict[str, Any]:
    if profile_id:
        for entry in _UPLOADS.values():
            if entry.get("profile_id") == profile_id:
                return entry
        raise _http_error(404, "not_found", "profile_id 不存在")
    if upload_id:
        entry = _UPLOADS.get(upload_id)
        if entry is None:
            raise _http_error(404, "not_found", "upload_id 不存在")
        return entry
    raise _http_error(422, "missing_id", "请提供 profile_id 或 upload_id")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/upload")
def upload(files: list[UploadFile] = File(...)) -> JSONResponse:
    if not files or len(files) > MAX_FILES:
        raise _http_error(
            413, "too_many_files", f"每次最多上传 {MAX_FILES} 份文档"
        )
    upload_id = "upl_" + uuid.uuid4().hex[:12]
    documents = _save_upload(files, upload_id)
    dest = UPLOAD_DIR / upload_id
    _UPLOADS[upload_id] = {
        "documents": documents,
        "paths": [str(p) for p in sorted(dest.iterdir())],
    }
    return JSONResponse(
        status_code=201,
        content={"upload_id": upload_id, "documents": documents},
    )


@app.post("/api/analyze")
def analyze(body: dict[str, Any]) -> dict[str, Any]:
    upload_id = body.get("upload_id")
    entry = _find_entry(profile_id=None, upload_id=upload_id)
    if "profile" in entry:
        profile = entry["profile"]
        return {
            "profile_id": entry["profile_id"],
            "status": "completed",
            "schema_version": profile["schema_version"],
            "candidate": profile["candidate"],
        }

    documents = [parse_document(path) for path in entry["paths"]]
    profile, _skipped = extract_profile(documents)
    verified = verify_profile(profile, verify_web=True)
    profile_id = "prf_" + hashlib.sha256(upload_id.encode()).hexdigest()[:12]
    entry["profile"] = verified
    entry["profile_id"] = profile_id
    return {
        "profile_id": profile_id,
        "status": "completed",
        "schema_version": verified["schema_version"],
        "candidate": verified["candidate"],
    }


@app.get("/api/profile")
def profile(
    profile_id: Optional[str] = None,
    upload_id: Optional[str] = None,
) -> dict[str, Any]:
    entry = _find_entry(profile_id=profile_id, upload_id=upload_id)
    if "profile" not in entry:
        raise _http_error(404, "not_analyzed", "档案尚未生成，请先调用 /api/analyze")
    stored = entry["profile"]
    return {
        "schema_version": stored["schema_version"],
        "candidate": stored["candidate"],
    }


@app.post("/api/qa")
def qa(body: dict[str, Any]) -> dict[str, Any]:
    profile_id = body.get("profile_id")
    if not isinstance(profile_id, str) or not profile_id.strip():
        raise _http_error(422, "missing_profile_id", "请提供 profile_id")
    question = body.get("question")
    if not isinstance(question, str) or not question.strip():
        raise _http_error(422, "missing_question", "请提供非空的 question")

    entry = _find_entry(profile_id=profile_id.strip(), upload_id=None)
    if "profile" not in entry:
        raise _http_error(404, "not_analyzed", "档案尚未生成，请先调用 /api/analyze")

    try:
        return answer_question(entry["profile"], question)
    except ValueError as exc:
        raise _http_error(500, "qa_failed", f"问答失败：{exc}") from exc
