"""Shared DeepSeek client, call metadata, and per-stage usage accounting.

The application originally constructed an OpenAI client in four places.  This
module keeps one client, one JSON request path, and one place where token
usage is captured so prompt-size work can be evaluated instead of guessed at.
"""

from __future__ import annotations

import os
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from openai import OpenAI


PROJECT_ROOT = Path(__file__).resolve().parents[1]


@dataclass(frozen=True)
class LlmResult:
    text: str
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    cached_tokens: int | None = None
    latency_ms: int = 0


@dataclass
class _StageStats:
    calls: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0
    cached_tokens: int = 0
    total_latency_ms: int = 0


_client: OpenAI | None = None
_client_lock = threading.Lock()
_stage_stats: dict[str, _StageStats] = {}
_stats_lock = threading.Lock()
_recent_calls: list[dict[str, Any]] = []
_recent_lock = threading.Lock()


def _load_dotenv() -> None:
    load_dotenv(PROJECT_ROOT / ".env")


def model_name() -> str:
    _load_dotenv()
    return os.getenv("DEEPSEEK_MODEL", "deepseek-chat")


def base_url() -> str:
    _load_dotenv()
    return os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")


FAST_STAGES = {"extraction_enumeration", "interview_chunk"}


def stage_model(stage: str) -> str:
    """Resolve an optional per-stage model override."""
    _load_dotenv()
    fast_model = os.getenv("DEEPSEEK_FAST_MODEL")
    if fast_model and stage in FAST_STAGES:
        return fast_model
    return os.getenv(f"DEEPSEEK_MODEL_{stage.upper()}", model_name())


def get_client() -> OpenAI:
    """Return the process-wide client, creating it on first use."""
    global _client
    if _client is not None:
        return _client
    with _client_lock:
        if _client is None:
            _load_dotenv()
            _client = OpenAI(
                api_key=os.getenv("DEEPSEEK_API_KEY"),
                base_url=base_url(),
            )
        return _client


def _extract_usage(response: Any) -> tuple[int | None, int | None, int | None]:
    usage = getattr(response, "usage", None)
    if usage is None:
        return None, None, None
    prompt = getattr(usage, "prompt_tokens", None)
    completion = getattr(usage, "completion_tokens", None)
    cached = getattr(usage, "prompt_cache_hit_tokens", None)
    if cached is None:
        cached = getattr(usage, "cached_tokens", None)
    return prompt, completion, cached


def record_usage(
    stage: str,
    *,
    prompt_tokens: int | None = None,
    completion_tokens: int | None = None,
    cached_tokens: int | None = None,
    latency_ms: int = 0,
) -> None:
    """Aggregate per-stage usage for diagnostics and `/health/dependencies`."""
    with _stats_lock:
        stats = _stage_stats.setdefault(stage, _StageStats())
        stats.calls += 1
        stats.prompt_tokens += int(prompt_tokens or 0)
        stats.completion_tokens += int(completion_tokens or 0)
        stats.cached_tokens += int(cached_tokens or 0)
        stats.total_latency_ms += int(latency_ms or 0)
    with _recent_lock:
        _recent_calls.append(
            {
                "stage": stage,
                "model": model_name(),
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "cached_tokens": cached_tokens,
                "latency_ms": latency_ms,
                "at": time.time(),
            }
        )
        del _recent_calls[:-100]


def call_chat(
    messages: list[dict[str, str]],
    *,
    stage: str,
    temperature: float = 0,
    max_tokens: int | None = None,
    response_format: dict[str, str] | None = None,
) -> LlmResult:
    """Call the shared client and return the message text plus usage."""
    started = time.monotonic()
    kwargs: dict[str, Any] = {
        "model": stage_model(stage),
        "messages": messages,
        "temperature": temperature,
    }
    if max_tokens is not None:
        kwargs["max_tokens"] = max_tokens
    if response_format is not None:
        kwargs["response_format"] = response_format

    response = get_client().chat.completions.create(**kwargs)
    elapsed = int((time.monotonic() - started) * 1000)
    text = response.choices[0].message.content or ""
    prompt_tokens, completion_tokens, cached_tokens = _extract_usage(response)
    record_usage(
        stage,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        cached_tokens=cached_tokens,
        latency_ms=elapsed,
    )
    return LlmResult(
        text=text,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        cached_tokens=cached_tokens,
        latency_ms=elapsed,
    )


def usage_snapshot() -> dict[str, dict[str, Any]]:
    """Return the collected per-stage usage without exposing raw prompts."""
    with _stats_lock:
        return {
            stage: {
                "calls": stats.calls,
                "prompt_tokens": stats.prompt_tokens,
                "completion_tokens": stats.completion_tokens,
                "cached_tokens": stats.cached_tokens,
                "total_latency_ms": stats.total_latency_ms,
            }
            for stage, stats in _stage_stats.items()
        }
