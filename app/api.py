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

from app import health as health_monitor
from app.extractor import extract_profile
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
from app.verify import mark_verification_incomplete, verify_profile


PROJECT_ROOT = Path(__file__).resolve().parents[1]
UPLOAD_DIR = PROJECT_ROOT / ".cache" / "uploads"
SCHEMA_PATH = PROJECT_ROOT / "contracts" / "schema.json"
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
                422, "unsupported_type", f"Unsupported document type: {filename}"
            )
        path = dest / filename
        size = 0
        with path.open("wb") as out:
            while chunk := upload.file.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_FILE_BYTES:
                    raise _http_error(413, "file_too_large", f"File too large: {filename}")
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
        raise _http_error(404, "not_found", "profile_id not found")
    if upload_id:
        entry = _UPLOADS.get(upload_id)
        if entry is None:
            raise _http_error(404, "not_found", "upload_id not found")
        return entry
    raise _http_error(422, "missing_id", "Provide either profile_id or upload_id")


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
        raise _http_error(
            413, "too_many_files", f"Upload at most {MAX_FILES} documents"
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
            "status": entry.get("status", "completed"),
            "schema_version": profile["schema_version"],
            "candidate": profile["candidate"],
            "warnings": entry.get("warnings", []),
        }

    documents, warnings = _parse_documents_safely(entry["paths"])
    if not documents:
        detail = (
            "No uploaded document contained extractable text. Install OCR "
            "dependencies or upload a text-based PDF/DOCX and retry."
        )
        raise _http_error(422, "no_readable_documents", detail)

    try:
        profile, _skipped = extract_profile(documents)
    except Exception as exc:
        raise _http_error(
            503,
            "extraction_failed",
            f"Structured extraction failed ({type(exc).__name__}). Retry the analysis.",
        ) from exc

    try:
        verified = verify_profile(profile, verify_web=True)
        warnings.extend(collect_retryable_verification_warnings(verified))
    except Exception as exc:
        verified = mark_verification_incomplete(profile, error=exc)
        warnings.append(
            warning(
                "verification_incomplete",
                "verification",
                (
                    "External verification stopped unexpectedly. The extracted "
                    "profile was kept, and affected claims are marked to_verify. "
                    "Retry the analysis when the services recover."
                ),
                retryable=True,
            )
        )

    profile_id = "prf_" + hashlib.sha256(upload_id.encode()).hexdigest()[:12]
    entry["profile"] = verified
    entry["profile_id"] = profile_id
    entry["warnings"] = [item.as_dict() for item in warnings]
    entry["status"] = "completed_with_warnings" if warnings else "completed"
    return {
        "profile_id": profile_id,
        "status": entry["status"],
        "schema_version": verified["schema_version"],
        "candidate": verified["candidate"],
        "warnings": entry["warnings"],
    }


@app.get("/api/profile")
def profile(
    profile_id: Optional[str] = None,
    upload_id: Optional[str] = None,
) -> dict[str, Any]:
    entry = _find_entry(profile_id=profile_id, upload_id=upload_id)
    if "profile" not in entry:
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
