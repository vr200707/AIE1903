"""Shared DeepSeek helpers for the interview workflow.

The interview pipeline makes several model calls over potentially long
transcripts.  Every call goes through this module so the input character
budget and JSON parsing behavior stay consistent.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from openai import OpenAI

from app import health


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INPUT_CHAR_BUDGET = 24_000
DEFAULT_MAX_OUTPUT_TOKENS = 4_096


def _load_dotenv() -> None:
    load_dotenv(PROJECT_ROOT / ".env")


def model_name() -> str:
    _load_dotenv()
    return os.getenv("DEEPSEEK_MODEL", "deepseek-chat")


def base_url() -> str:
    _load_dotenv()
    return os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")


def input_char_budget() -> int:
    """Conservative prompt budget that leaves room for instructions/output."""
    _load_dotenv()
    raw = os.getenv(
        "INTERVIEW_LLM_INPUT_CHAR_BUDGET",
        str(DEFAULT_INPUT_CHAR_BUDGET),
    )
    try:
        return max(6_000, int(raw))
    except (TypeError, ValueError):
        return DEFAULT_INPUT_CHAR_BUDGET


def max_output_tokens() -> int:
    _load_dotenv()
    raw = os.getenv(
        "INTERVIEW_LLM_MAX_OUTPUT_TOKENS",
        str(DEFAULT_MAX_OUTPUT_TOKENS),
    )
    try:
        return max(512, int(raw))
    except (TypeError, ValueError):
        return DEFAULT_MAX_OUTPUT_TOKENS


def parse_json_object(raw: str) -> dict[str, Any]:
    """Parse a JSON object while tolerating an accidental markdown fence."""
    text = raw.strip()
    if text.startswith("```"):
        first_newline = text.find("\n")
        if first_newline != -1:
            text = text[first_newline + 1 :]
        if text.rstrip().endswith("```"):
            text = text.rstrip()[:-3]
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end <= start:
        raise ValueError("model output did not contain a JSON object")
    payload = json.loads(text[start : end + 1])
    if not isinstance(payload, dict):
        raise ValueError("model output root must be a JSON object")
    return payload


def chat_json(
    system_prompt: str,
    user_prompt: str,
    *,
    temperature: float = 0.1,
) -> dict[str, Any]:
    """Call DeepSeek and return one validated JSON object.

    The hard prompt guard is intentionally based on characters.  A character
    budget is model-agnostic and more conservative than estimating tokens for
    mixed English, punctuation, and citations.
    """
    budget = input_char_budget()
    total_chars = len(system_prompt) + len(user_prompt)
    if total_chars > budget:
        raise ValueError(
            f"interview prompt exceeds input budget: {total_chars} > {budget}"
        )

    _load_dotenv()
    try:
        client = OpenAI(
            api_key=os.getenv("DEEPSEEK_API_KEY"),
            base_url=base_url(),
        )
        response = client.chat.completions.create(
            model=model_name(),
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=temperature,
            max_tokens=max_output_tokens(),
            response_format={"type": "json_object"},
        )
    except Exception as exc:
        health.record_dependency_failure("deepseek", exc)
        raise

    health.record_dependency_success("deepseek")
    raw = response.choices[0].message.content or "{}"
    return parse_json_object(raw)


def trim_text(value: Any, limit: int) -> str:
    text = str(value or "").strip()
    if len(text) <= limit:
        return text
    return text[: max(0, limit - 1)].rstrip() + "…"
