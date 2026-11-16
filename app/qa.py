"""D5 加分项：基于结构化档案的问答（Question Answering over the profile）。

设计要点：
- 只依据档案里已有的事实作答，不引入外部知识、不做推断式补全。
- 引用防伪：先把档案中所有证据统一编号（E1、E2…）与问题一起交给模型，
  模型只能回传 evidence_ids；最终返回的 evidence 对象由后端从档案里
  原样取回，因此不会出现「引用一个不存在的来源」这类幻觉。
- 证据不足时降级 confidence：high 必须至少命中 1 条有效证据，否则降为 low。
- 档案内部自相矛盾（例如两处日期不一致）时，要求模型指出矛盾并列出双方证据。
"""

from __future__ import annotations

import hashlib
import json
import os
import re
from pathlib import Path
from typing import Any, Iterator

from app import health
from app import llm


PROJECT_ROOT = Path(__file__).resolve().parents[1]
CACHE_DIR = PROJECT_ROOT / ".cache" / "qa"
EVIDENCE_KEYS = {"source", "evidence", "evidence_status", "query_date"}
CONFIDENCE_LEVELS = ("high", "medium", "low")
MAX_EVIDENCE_REFS = 8
PROMPT_VERSION = "qa-retrieval-v1"
DEFAULT_MAX_OUTPUT_TOKENS = 768
MAX_PROMPT_EVIDENCE = 12

SYSTEM_PROMPT = """\
You are a candidate-profile question-answering assistant. Answer only from the
provided profile JSON and evidence index.

Rules:
1. If the profile supports an answer, state the conclusion and cite the supporting
   evidence IDs in evidence_ids.
2. If the profile does not contain evidence, set answer to "No relevant information
   is available in the profile.", set confidence to "low", and return an empty
   evidence_ids array. Do not use outside knowledge or common-sense completion.
3. Use only evidence IDs that exist in the evidence index. Omit uncertain citations.
4. If the profile contains conflicting evidence, clearly identify the conflict and
   include both supporting evidence IDs.
5. confidence must be one of: high (consistent direct evidence), medium (requires
   combining multiple sources or a small inference), or low (missing or conflicting
   information).
6. Write the answer in English. Preserve verbatim quotations from source material in
   their original language.
7. Return only one JSON object with answer (string), confidence (string), and
   evidence_ids (string array). Do not use markdown code fences or add commentary.
"""


def _iter_evidence(node: Any, path: str = "candidate") -> Iterator[tuple[str, dict[str, Any]]]:
    """按深度优先顺序枚举档案里的所有证据对象，附带其所在路径。"""
    if isinstance(node, dict):
        if EVIDENCE_KEYS.issubset(node.keys()):
            yield path, node
            return
        for key, value in node.items():
            yield from _iter_evidence(value, f"{path}.{key}")
    elif isinstance(node, list):
        for index, value in enumerate(node):
            yield from _iter_evidence(value, f"{path}[{index}]")


def build_evidence_index(
    profile: dict[str, Any],
) -> tuple[dict[str, dict[str, Any]], list[dict[str, Any]]]:
    """给档案里的证据编号，返回 (编号 -> 证据对象, 编号索引列表)。

    编号（E1、E2…）只在本次问答的提示词里使用，不会写回档案本身。
    """
    index: dict[str, dict[str, Any]] = {}
    rendered: list[dict[str, Any]] = []
    for position, (path, evidence) in enumerate(
        _iter_evidence(profile.get("candidate", {})), start=1
    ):
        evidence_id = f"E{position}"
        index[evidence_id] = evidence
        rendered.append(
            {
                "evidence_id": evidence_id,
                "path": path,
                "source": evidence.get("source"),
                "evidence_status": evidence.get("evidence_status"),
                "source_url": evidence.get("source_url"),
                "evidence": evidence.get("evidence"),
            }
        )
    return index, rendered


def _strip_evidence(value: Any) -> Any:
    """Remove evidence arrays from profile JSON sent to the model.

    The evidence index is sent separately, so including the arrays again doubles
    most of the context without adding information the model can use.
    """
    if isinstance(value, dict):
        return {
            key: _strip_evidence(item)
            for key, item in value.items()
            if key != "evidence"
        }
    if isinstance(value, list):
        return [_strip_evidence(item) for item in value]
    return value


def _tokens(text: str) -> set[str]:
    """Return overlapping lexical tokens for English words and CJK text."""
    normalized = text.lower()
    words = {
        word
        for word in re.findall(r"[a-z0-9]+", normalized)
        if len(word) > 1
    }
    cjk = re.sub(r"[\u4e00-\u9fff]", "", normalized)
    characters = "".join(
        character
        for character in normalized
        if "\u4e00" <= character <= "\u9fff"
    )
    return words | {characters[i : i + 2] for i in range(max(0, len(characters) - 1))}


def _compact_profile_for_qa(profile: dict[str, Any]) -> dict[str, Any]:
    """Keep the high-signal fields needed for profile Q&A."""
    candidate = profile.get("candidate", {})
    if not isinstance(candidate, dict):
        return {"schema_version": profile.get("schema_version"), "candidate": {}}

    basic = candidate.get("basic_info") or {}
    basic_compact = {
        key: basic.get(key)
        for key in (
            "name",
            "institution",
            "position",
            "research_interests",
            "highest_degree",
            "skills",
            "strengths",
        )
    }
    basic_compact["to_verify"] = (basic.get("to_verify") or [])[:5]

    def pick(item: Any, keys: tuple[str, ...]) -> dict[str, Any]:
        source = item if isinstance(item, dict) else {}
        return {key: source.get(key) for key in keys}

    education = (candidate.get("education_employment") or {}).get("education") or []
    employment = (candidate.get("education_employment") or {}).get("employment") or []
    awards = (candidate.get("awards_funding") or {}).get("awards") or []
    funding = (candidate.get("awards_funding") or {}).get("funding") or []
    services = (candidate.get("academic_service") or {}).get("services") or []
    publications = (
        (candidate.get("publications_impact") or {}).get("publications") or []
    )
    publications = sorted(
        publications,
        key=lambda item: (
            int(item.get("citation_count") or 0),
            int(item.get("year") or 0),
        ),
        reverse=True,
    )
    overall = candidate.get("overall_evaluation") or {}

    return {
        "schema_version": profile.get("schema_version"),
        "candidate": {
            "basic_info": basic_compact,
            "education_employment": {
                "education": [
                    pick(
                        item,
                        ("degree", "field", "institution", "start_date", "end_date"),
                    )
                    for item in education[:3]
                ],
                "employment": [
                    pick(
                        item,
                        ("institution", "position", "start_date", "end_date"),
                    )
                    for item in employment[:3]
                ],
            },
            "awards_funding": {
                "awards": [
                    pick(item, ("name", "year", "awarding_body"))
                    for item in awards[:5]
                ],
                "funding": [
                    pick(item, ("project_name", "funder", "amount", "currency", "role"))
                    for item in funding[:5]
                ],
            },
            "publications_impact": {
                "publications": [
                    pick(
                        item,
                        ("title", "year", "venue", "author_role", "citation_count"),
                    )
                    for item in publications[:6]
                ],
                "total_citations": (candidate.get("publications_impact") or {}).get(
                    "total_citations"
                ),
            },
            "academic_service": {
                "services": [
                    pick(item, ("service_type", "organization_or_venue", "role"))
                    for item in services[:5]
                ]
            },
            "overall_evaluation": {
                "summary": overall.get("summary"),
                "strengths": (overall.get("strengths") or [])[:5],
                "risks": (overall.get("risks") or [])[:5],
                "dimensions": [],
            },
        },
    }


def _select_relevant_evidence(
    profile: dict[str, Any],
    question: str,
    evidence_index: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Score evidence locally and keep the best candidates for the prompt."""
    query_tokens = _tokens(question)
    status_priority = {
        "conflict": 5,
        "to_verify": 4,
        "not_found_public": 3,
        "confirmed": 1,
    }
    path_priority = {
        "basic_info": 5,
        "publication": 4,
        "award": 4,
        "funding": 4,
        "employment": 3,
        "education": 3,
        "service": 2,
    }

    scored: list[tuple[float, dict[str, Any]]] = []
    for item in evidence_index:
        text = " ".join(
            str(item.get(key) or "")
            for key in ("path", "source", "evidence")
        )
        item_tokens = _tokens(text)
        overlap = len(query_tokens & item_tokens)
        query_denominator = max(1, len(query_tokens))
        status_bonus = status_priority.get(item.get("evidence_status"), 1)
        path = item.get("path", "")
        path_bonus = 0
        for key, bonus in path_priority.items():
            if key in path:
                path_bonus = max(path_bonus, bonus)
        score = (overlap / query_denominator) * 10 + status_bonus + path_bonus
        scored.append((score, item))

    scored.sort(key=lambda pair: pair[0], reverse=True)
    return [item for _, item in scored[:MAX_PROMPT_EVIDENCE]]


def _build_retrieval_user_message(
    profile: dict[str, Any],
    evidence_index: list[dict[str, Any]],
    question: str,
) -> str:
    compact = _compact_profile_for_qa(profile)
    return (
        "PROFILE SUMMARY\n"
        + json.dumps(compact, ensure_ascii=False, indent=1)
        + "\n\nRELEVANT EVIDENCE INDEX\n"
        + json.dumps(evidence_index, ensure_ascii=False, indent=1)
        + "\n\nQUESTION\n"
        + question
    )


def _build_user_message(
    profile: dict[str, Any], evidence_index: list[dict[str, Any]], question: str
) -> str:
    candidate = _strip_evidence(profile.get("candidate", {}))
    return (
        "PROFILE JSON (schema_version: "
        + str(profile.get("schema_version"))
        + ")\n"
        + json.dumps(candidate, ensure_ascii=False, indent=1)
        + "\n\nEVIDENCE INDEX\n"
        + json.dumps(evidence_index, ensure_ascii=False, indent=1)
        + "\n\nQUESTION\n"
        + question
    )


def _max_output_tokens() -> int:
    raw = os.getenv("QA_MAX_OUTPUT_TOKENS", str(DEFAULT_MAX_OUTPUT_TOKENS))
    try:
        return max(256, int(raw))
    except (TypeError, ValueError):
        return DEFAULT_MAX_OUTPUT_TOKENS


def _cache_key(profile: dict[str, Any], question: str) -> str:
    payload = {
        "model": llm.model_name(),
        "prompt_version": PROMPT_VERSION,
        "profile": profile,
        "question": question.strip().lower(),
    }
    canonical = json.dumps(payload, ensure_ascii=False, sort_keys=True, default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _read_cache(key: str) -> dict[str, Any] | None:
    path = CACHE_DIR / f"{key}.json"
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def _write_cache(key: str, result: dict[str, Any]) -> None:
    try:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        (CACHE_DIR / f"{key}.json").write_text(
            json.dumps(result, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    except OSError:
        pass


def _call_model(system_prompt: str, user_message: str) -> str:
    """调用 DeepSeek 并返回原始文本。测试里会替换掉这个函数。"""
    try:
        result = llm.call_chat(
            [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message},
            ],
            stage="qa",
            temperature=0,
            max_tokens=_max_output_tokens(),
            response_format={"type": "json_object"},
        )
    except Exception as exc:
        health.record_dependency_failure("deepseek", exc)
        raise
    health.record_dependency_success("deepseek")
    return result.text


def _validate_payload(payload: Any) -> tuple[str, str, list[str]]:
    if not isinstance(payload, dict):
        raise ValueError("Q&A model did not return a JSON object")
    answer = payload.get("answer")
    if not isinstance(answer, str) or not answer.strip():
        raise ValueError("Q&A model returned an empty answer")
    confidence = payload.get("confidence")
    if confidence not in CONFIDENCE_LEVELS:
        confidence = "low"
    raw_ids = payload.get("evidence_ids")
    if not isinstance(raw_ids, list):
        raw_ids = []
    evidence_ids = [item for item in raw_ids if isinstance(item, str)]
    return answer.strip(), confidence, evidence_ids


def _answer_with_cache(
    profile: dict[str, Any],
    question: str,
    index: dict[str, dict[str, Any]],
    selected_evidence: list[dict[str, Any]],
    *,
    max_evidence: int,
) -> dict[str, Any]:
    raw = _call_model(
        SYSTEM_PROMPT,
        _build_retrieval_user_message(profile, selected_evidence, question),
    )
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Q&A model did not return valid JSON: {exc}") from exc

    answer, confidence, evidence_ids = _validate_payload(payload)

    matched: list[dict[str, Any]] = []
    seen: set[str] = set()
    for evidence_id in evidence_ids:
        if evidence_id in index and evidence_id not in seen:
            seen.add(evidence_id)
            matched.append(index[evidence_id])
        if len(matched) >= max_evidence:
            break

    if not matched and confidence != "low":
        confidence = "low"

    return {"answer": answer, "confidence": confidence, "evidence": matched}


def answer_question(
    profile: dict[str, Any], question: str, *, max_evidence: int = MAX_EVIDENCE_REFS
) -> dict[str, Any]:
    """基于档案回答一个自然语言问题，返回 {answer, confidence, evidence}。"""
    if not question or not question.strip():
        raise ValueError("Question cannot be empty")

    normalized_question = question.strip()
    cache_key = _cache_key(profile, normalized_question)
    cached = _read_cache(cache_key)
    if cached is not None:
        return {
            "answer": cached["answer"],
            "confidence": cached["confidence"],
            "evidence": [
                item
                for item in cached["evidence"]
                if isinstance(item, dict)
            ][:max_evidence],
        }

    index, evidence_index = build_evidence_index(profile)
    selected_evidence = _select_relevant_evidence(
        profile,
        normalized_question,
        evidence_index,
    )
    result = _answer_with_cache(
        profile,
        normalized_question,
        index,
        selected_evidence,
        max_evidence=max_evidence,
    )
    _write_cache(cache_key, result)
    return result
