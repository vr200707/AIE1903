"""Process health, readiness, and lightweight dependency state tracking."""

from __future__ import annotations

import importlib.util
import json
import os
import shutil
import tempfile
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Any

from dotenv import load_dotenv


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEPENDENCY_NAMES = (
    "deepseek",
    "ocr",
    "pdf_renderer",
    "crossref",
    "openalex",
    "bing",
    "interview_asr",
)

_LOCK = Lock()
_STATE: dict[str, dict[str, Any]] = {
    name: {
        "status": "unknown",
        "last_checked_at": None,
        "last_success_at": None,
        "last_error": None,
        "retryable": None,
    }
    for name in DEPENDENCY_NAMES
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def record_dependency_success(name: str) -> None:
    """Record a successful real call; health checks do not make paid calls."""
    if name not in _STATE:
        return
    now = _now()
    with _LOCK:
        state = _STATE[name]
        state.update(
            {
                "status": "ok",
                "last_checked_at": now,
                "last_success_at": now,
                "last_error": None,
                "retryable": None,
            }
        )


def record_dependency_failure(
    name: str,
    exc: BaseException | str,
    *,
    retryable: bool = True,
) -> None:
    """Record a sanitized failure reason without storing user document content."""
    if name not in _STATE:
        return
    error_name = type(exc).__name__ if isinstance(exc, BaseException) else "Error"
    detail = str(exc).strip().replace("\n", " ")[:240]
    with _LOCK:
        state = _STATE[name]
        state.update(
            {
                "status": "error",
                "last_checked_at": _now(),
                "last_error": f"{error_name}: {detail}" if detail else error_name,
                "retryable": retryable,
            }
        )


def _executable_status(candidate: str) -> dict[str, Any]:
    resolved = shutil.which(candidate)
    return {
        "configured": bool(candidate),
        "available": bool(resolved),
    }


def dependency_snapshot(*, project_root: str | Path | None = None) -> dict[str, Any]:
    """Return configuration plus the latest observed status for each dependency."""
    root = Path(project_root) if project_root else PROJECT_ROOT
    load_dotenv(root / ".env")

    configuration: dict[str, dict[str, Any]] = {
        "deepseek": {
            "configured": bool(os.getenv("DEEPSEEK_API_KEY")),
            "model": os.getenv("DEEPSEEK_MODEL", "deepseek-chat"),
        },
        "ocr": {
            **_executable_status(os.getenv("TESSERACT_CMD", "tesseract")),
            "languages": os.getenv("OCR_LANGUAGES", "chi_sim+eng"),
        },
        "pdf_renderer": _executable_status("pdftoppm"),
        "crossref": {
            "configured": True,
            "endpoint": "https://api.crossref.org/works",
        },
        "openalex": {
            "configured": True,
            "endpoint": "https://api.openalex.org/works",
        },
        "bing": {
            "configured": os.getenv("WEB_SEARCH_PROVIDER", "bing") == "bing",
            "provider": os.getenv("WEB_SEARCH_PROVIDER", "bing"),
            "endpoint": os.getenv(
                "WEB_SEARCH_BASE_URL", "https://cn.bing.com/search"
            ),
        },
        "interview_asr": {
            "configured": (
                importlib.util.find_spec("faster_whisper") is not None
                and importlib.util.find_spec("av") is not None
            ),
            "provider": "faster-whisper",
            "model": os.getenv("INTERVIEW_ASR_MODEL", "small.en"),
            "device": os.getenv("INTERVIEW_ASR_DEVICE", "cpu"),
            "compute_type": os.getenv("INTERVIEW_ASR_COMPUTE_TYPE", "int8"),
        },
    }

    with _LOCK:
        observed = deepcopy(_STATE)

    return {
        name: {**configuration[name], **observed[name]}
        for name in DEPENDENCY_NAMES
    }


def _schema_check(schema_path: Path) -> dict[str, str]:
    if not schema_path.is_file():
        return {"status": "error", "detail": "schema.json is missing"}
    try:
        payload = json.loads(schema_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return {"status": "error", "detail": f"schema.json is invalid: {exc}"}
    if not isinstance(payload, dict):
        return {"status": "error", "detail": "schema.json must contain an object"}
    return {"status": "ok", "detail": "schema.json is readable and valid JSON"}


def _storage_check(upload_dir: Path) -> dict[str, str]:
    try:
        upload_dir.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", dir=upload_dir, prefix=".health-", delete=True
        ) as handle:
            handle.write("ok")
            handle.flush()
    except OSError as exc:
        return {"status": "error", "detail": f"upload storage is not writable: {exc}"}
    return {"status": "ok", "detail": "upload storage is writable"}


def check_readiness(
    *,
    project_root: str | Path | None = None,
    schema_path: str | Path | None = None,
    upload_dir: str | Path | None = None,
) -> dict[str, Any]:
    """Check critical local prerequisites without calling paid or remote services."""
    root = Path(project_root) if project_root else PROJECT_ROOT
    schema = Path(schema_path) if schema_path else root / "contracts" / "schema.json"
    storage = Path(upload_dir) if upload_dir else root / ".cache" / "uploads"
    load_dotenv(root / ".env")

    checks = {
        "schema": _schema_check(schema),
        "upload_storage": _storage_check(storage),
        "deepseek_config": {
            "status": "ok" if os.getenv("DEEPSEEK_API_KEY") else "error",
            "detail": (
                "DEEPSEEK_API_KEY is configured"
                if os.getenv("DEEPSEEK_API_KEY")
                else "DEEPSEEK_API_KEY is not configured"
            ),
        },
    }
    ready = all(check["status"] == "ok" for check in checks.values())
    return {
        "status": "ready" if ready else "degraded",
        "checks": checks,
    }
