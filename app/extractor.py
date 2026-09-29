"""D3 信息抽取：调用 DeepSeek，按 schema.json 从文档文本中结构化抽取候选人档案。

设计要点：
- 一次调用把一批文档一起抽取（结构化批量抽取，省 API 调用）。
- 事实与判断分离：前五模块是事实，overall_evaluation 是基于事实的判断。
- 每个事实都带 evidence 证据（来源文件、页码、原文摘录、状态、查询日期）。
- 结果按「文档内容 + 模型 + schema 版本」哈希后落盘缓存，避免重复调用。
- 抽取结果用 jsonschema（Draft 2020-12）校验，失败自动带错误反馈重试。
"""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from jsonschema import Draft202012Validator
from openai import OpenAI

from app.parser import ParsedDocument


PROJECT_ROOT = Path(__file__).resolve().parents[1]
SCHEMA_PATH = PROJECT_ROOT / "docs" / "schema.json"
CACHE_DIR = PROJECT_ROOT / ".cache" / "extraction"
QUERY_DATE = "2026-09-29"  # 样本集标明的查询日期


def _load_dotenv() -> None:
    load_dotenv(PROJECT_ROOT / ".env")


def _load_schema() -> dict[str, Any]:
    return json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))


def _model_name() -> str:
    _load_dotenv()
    return os.getenv("DEEPSEEK_MODEL", "deepseek-chat")


def _base_url() -> str:
    _load_dotenv()
    return os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")


SYSTEM_PROMPT = """\
你是候选人简历结构化抽取引擎。输入是多份简历文档的纯文本，输出是一个 JSON 对象。

硬性规则：
1. 只抽取文档中【明确写出】的信息；找不到、不确定、或未提及的字段一律填 null 或空数组 []。禁止推测、补全、编造。
2. 每个事实必须附带 evidence 证据对象；evidence.evidence 要写支持该事实的【原文片段】（尽量逐字），并标注来源文件与页码。
3. 事实与判断分离：basic_info / education_employment / awards_funding / publications_impact / academic_service 是事实；overall_evaluation（summary / strengths / risks / dimensions）是基于事实给出的评价，必须能追溯到证据。
4. evidence_status 取值：
   - confirmed：文档明确写出且无矛盾；
   - to_verify：文档写得含糊、需要外部核验；
   - conflict：多份文档对同一事实给出互相矛盾的说法（在 evidence 中说明双方）；
   - not_found_public：本阶段不要使用，无法核实的用 to_verify。
5. evidence.source 用文件名；source_url 用文档里出现的 URL，没有就 null；query_date 固定 "2026-09-29"；page 用该事实所在页码（DOCX 无页码就 null）；source_type 简历统一 "resume"。
6. 日期格式：YYYY、YYYY-MM 或 YYYY-MM-DD；无法确定用 null。年份类字段（year / start_year / end_year）用整数或 null。
7. 金额 amount 用数字或 null；currency 用三字母 ISO 代码或 null。
8. 只输出一个 JSON 对象，不要 markdown 代码围栏，不要任何解释文字。

输出结构（顶层含 schema_version 与 candidate，candidate 含 6 个模块）：
{
  "schema_version": "1.0.0",
  "candidate": {
    "basic_info": {
      "name": string|null, "institution": string|null, "position": string|null,
      "research_interests": [string], "highest_degree": string|null,
      "skills": [string], "strengths": [string],
      "to_verify": [{"claim": string, "reason": string, "evidence": [evidence]}],
      "evidence": [evidence]
    },
    "education_employment": {
      "education": [{"degree": string|null, "field": string|null, "institution": string|null,
        "advisor": string|null, "start_date": date|null, "end_date": date|null,
        "projects": [string], "outcomes": [string], "evidence": [evidence]}],
      "employment": [{"institution": string|null, "position": string|null,
        "start_date": date|null, "end_date": date|null, "responsibilities": [string],
        "projects": [string], "outcomes": [string], "evidence": [evidence]}]
    },
    "awards_funding": {
      "awards": [{"name": string, "year": integer|null, "awarding_body": string|null, "evidence": [evidence]}],
      "funding": [{"project_name": string, "funder": string|null, "start_date": date|null,
        "end_date": date|null, "amount": number|null, "currency": string|null,
        "role": "PI"|"Co-PI"|"participant"|"unknown", "evidence": [evidence]}]
    },
    "publications_impact": {
      "publications": [{"title": string, "year": integer|null,
        "author_role": "first_author"|"co_first_author"|"corresponding_author"|"co_corresponding_author"|"middle_author"|"single_author"|"unknown",
        "venue": string|null, "venue_type": "journal"|"conference"|"workshop"|"preprint"|"other"|"unknown",
        "ranking": string|null, "citation_count": integer|null, "citation_query_date": date|null,
        "code_repository": url|null, "repository_stars": integer|null, "stars_query_date": date|null,
        "evidence": [evidence]}],
      "total_citations": integer|null, "citation_query_date": date|null
    },
    "academic_service": {
      "services": [{"service_type": "reviewer"|"editor"|"program_committee"|"other",
        "organization_or_venue": string, "role": string|null,
        "start_year": integer|null, "end_year": integer|null,
        "research_areas": [string], "evidence": [evidence]}]
    },
    "overall_evaluation": {
      "summary": string|null, "strengths": [string], "risks": [string],
      "dimensions": [{"dimension": string, "assessment": string, "evidence": [evidence]}]
    }
  }
}

evidence 对象字段：source(string), source_url(url|null), evidence(string),
evidence_status("confirmed"|"not_found_public"|"to_verify"|"conflict"), query_date(date),
page(integer|null，可选), source_type("resume"|"supporting_document"|"institutional_page"|"publisher_page"|"bibliographic_database"|"code_repository"|"other"，可选), notes(string|null，可选)。
"""


def _render_documents(documents: list[ParsedDocument]) -> str:
    blocks: list[str] = []
    for doc in documents:
        header = f"=== 文档：{doc.filename} ==="
        if all(page.page_number is None for page in doc.pages):
            body = doc.full_text()
        else:
            pages = []
            for page in doc.pages:
                if page.page_number is not None:
                    pages.append(f"[第 {page.page_number} 页]\n{page.text}")
                else:
                    pages.append(page.text)
            body = "\n\n".join(pages)
        blocks.append(f"{header}\n{body}")
    return "\n\n".join(blocks)


def _validate_profile(profile: dict[str, Any]) -> list[str]:
    schema = _load_schema()
    validator = Draft202012Validator(schema)
    errors = sorted(validator.iter_errors(profile), key=lambda e: list(e.path))
    messages: list[str] = []
    for error in errors:
        path = "/".join(str(part) for part in error.path) or "(root)"
        messages.append(f"{path}: {error.message}")
    return messages


def _cache_key(documents: list[ParsedDocument]) -> str:
    schema = _load_schema()
    schema_version = schema["properties"]["schema_version"]["const"]
    payload = {
        "schema_version": schema_version,
        "model": _model_name(),
        "documents": [
            {"filename": doc.filename, "text": doc.full_text()} for doc in documents
        ],
    }
    return hashlib.sha256(
        json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()


def _read_cache(key: str) -> dict[str, Any] | None:
    cache_file = CACHE_DIR / f"{key}.json"
    if cache_file.exists():
        return json.loads(cache_file.read_text(encoding="utf-8"))
    return None


def _write_cache(key: str, profile: dict[str, Any]) -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    (CACHE_DIR / f"{key}.json").write_text(
        json.dumps(profile, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def _extract_once(
    documents: list[ParsedDocument],
    previous_errors: list[str] | None = None,
) -> dict[str, Any]:
    _load_dotenv()
    client = OpenAI(api_key=os.getenv("DEEPSEEK_API_KEY"), base_url=_base_url())
    user_content = _render_documents(documents)
    if previous_errors:
        user_content = (
            "上一次输出不符合 schema，请修正以下问题后重新输出完整 JSON：\n"
            + "\n".join(previous_errors)
            + "\n\n"
            + user_content
        )
    messages: list[dict[str, str]] = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_content},
    ]
    response = client.chat.completions.create(
        model=_model_name(),
        messages=messages,
        temperature=0,
        response_format={"type": "json_object"},
    )
    raw = response.choices[0].message.content or "{}"
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"LLM 未返回合法 JSON：{exc}") from exc
    if "candidate" in data and isinstance(data.get("schema_version"), str):
        return data
    if "candidate" in data:
        return {"schema_version": "1.0.0", "candidate": data["candidate"]}
    raise ValueError("LLM 返回中缺少 candidate 字段")


def extract_profile(
    documents: list[ParsedDocument],
    *,
    max_retries: int = 2,
) -> tuple[dict[str, Any], list[str]]:
    """从一批文档抽取结构化档案，返回 (profile, 无文字层被跳过的文件名列表)。"""
    skipped = [doc.filename for doc in documents if not doc.full_text().strip()]
    usable = [doc for doc in documents if doc.full_text().strip()]
    if not usable:
        raise ValueError("所有文档都没有可提取的文字层（可能是扫描件），需要先做 OCR。")

    key = _cache_key(usable)
    cached = _read_cache(key)
    if cached is not None:
        return cached, skipped

    profile: dict[str, Any] | None = None
    last_errors: list[str] = []
    for _ in range(max_retries + 1):
        profile = _extract_once(usable, previous_errors=last_errors)
        last_errors = _validate_profile(profile)
        if not last_errors:
            break

    if profile is None or last_errors:
        raise ValueError(
            "抽取结果在重试后仍不符合 schema.json：\n" + "\n".join(last_errors)
        )

    _write_cache(key, profile)
    return profile, skipped
