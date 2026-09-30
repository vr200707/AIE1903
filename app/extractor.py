"""D3 信息抽取：调用 DeepSeek，按 schema.json 从文档文本中结构化抽取候选人档案。

设计要点：
- 拆分抽取（split extraction）：不再要求模型一次性吐出完整 6 模块 JSON。
  真实简历的 publications 列表往往非常长（数十篇论文），一次性输出会撞上
  DeepSeek 的输出 token 上限（8192），导致 JSON 被截断。因此把抽取拆成三类调用：
    1. 基础模块（basic_info / education_employment / awards_funding /
       academic_service / overall_evaluation + publications 汇总字段）；
    2. 论文标题清单（紧凑枚举，仅 title + year，输出极小）；
    3. 论文明细（按标题分组、分批补全完整 publication record）。
  三类调用的输出各自都远小于输出上限，最后再合并回完整 candidate。
- 事实与判断分离：前五模块是事实，overall_evaluation 是基于事实的判断。
- 每个事实都带 evidence 证据（来源文件、页码、原文摘录、状态、查询日期）。
- 结果按「文档内容 + 模型 + schema 版本 + 拆分策略」哈希后落盘缓存。
- 抽取结果用 jsonschema（Draft 2020-12）校验，基础模块失败自动带错误反馈重试。
"""

from __future__ import annotations

import hashlib
import json
import os
import re
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

EXTRACTION_STRATEGY = "split-v1"
PUBLICATIONS_PER_CHUNK = 12


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


def _max_context_chars() -> int:
    """返回上下文压缩的字符预算（可用环境变量 EXTRACT_MAX_CONTEXT_CHARS 覆盖）。"""
    _load_dotenv()
    raw = os.getenv("EXTRACT_MAX_CONTEXT_CHARS", "60000")
    try:
        return max(1000, int(raw))
    except (TypeError, ValueError):
        return 60000


_EVIDENCE_RULES = """\
evidence 对象字段：source(string), source_url(url|null), evidence(string),
evidence_status("confirmed"|"to_verify"|"conflict"), query_date(date),
page(integer|null，可选), source_type("resume"，可选), notes(string|null，可选)。

硬性规则：
1. 只抽取文档中【明确写出】的信息；找不到、不确定、或未提及的字段一律填 null 或空数组 []。禁止推测、补全、编造。
2. 每个事实必须附带 evidence 证据对象；evidence.evidence 要写支持该事实的【原文片段】（尽量逐字），并标注来源文件与页码。
3. evidence_status 取值：confirmed（明确写出且无矛盾）/ to_verify（含糊，需外部核验）/ conflict（互相矛盾）；本阶段不要使用 not_found_public。
4. evidence.source 用文件名；source_url 用文档里出现的 URL，没有就 null；query_date 固定 "2026-09-29"；page 用该事实所在页码（DOCX 无页码就 null）；source_type 简历统一 "resume"。
5. 日期格式：YYYY、YYYY-MM 或 YYYY-MM-DD；无法确定用 null。年份类字段（year / start_year / end_year）用整数或 null。
6. 金额 amount 用数字或 null；currency 用三字母 ISO 代码或 null。
7. 只输出一个 JSON 对象，不要 markdown 代码围栏，不要任何解释文字。
8. 所有字段值、evidence.evidence 与 overall_evaluation 内容一律使用英文，不随输入语言切换。
"""


META_SYSTEM_PROMPT = """\
你是候选人简历结构化抽取引擎（基础模块阶段）。输入是多份简历文档的纯文本，输出是一个 JSON 对象。

""" + _EVIDENCE_RULES + """

事实与判断分离：basic_info / education_employment / awards_funding / academic_service
是事实；overall_evaluation（summary / strengths / risks / dimensions）是基于事实给出的
评价，必须能追溯到证据。

本阶段只负责抽取以下 5 个模块，以及 publications_impact 的汇总字段：
- basic_info
- education_employment
- awards_funding
- academic_service
- overall_evaluation
- publications_impact：{"publications": [], "total_citations": ..., "citation_query_date": ...}
  publications 数组本阶段必须输出空数组 []（论文条目由后续阶段单独处理）；
  total_citations / citation_query_date 仅当文档明确写出（如 Google Scholar 引用数）才填，否则 null。

输出结构（顶层含 schema_version 与 candidate）：
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
      "publications": [],
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
"""


ENUMERATE_SYSTEM_PROMPT = """\
你是候选人简历论文清单提取器。输入是简历纯文本，输出是一个 JSON 对象。

任务：找出文档中列出的所有论文（publications），输出紧凑的标题清单：
{"publications": [{"title": string, "year": integer|null}, ...]}

规则：
1. title 必须逐字照抄论文标题，不缩写、不改写、不翻译。
2. year 用整数；找不到就 null。
3. 去重：同一篇论文只列一次（标题相同视为同一篇）。
4. 文档里没有论文时输出 {"publications": []}。
5. 只输出一个 JSON 对象，不要 markdown 代码围栏，不要任何解释文字。
"""


EXPAND_SYSTEM_PROMPT = """\
你是候选人简历论文结构化抽取器。输入是简历纯文本，以及一个「需要抽取的论文标题列表」。
请为列表中【每一篇】论文输出完整的论文记录（publication record），输出：
{"publications": [publication_record, ...]}

publication_record 字段：
title(string), year(integer|null),
author_role("first_author"|"co_first_author"|"corresponding_author"|"co_corresponding_author"|"middle_author"|"single_author"|"unknown"),
venue(string|null), venue_type("journal"|"conference"|"workshop"|"preprint"|"other"|"unknown"),
ranking(string|null), citation_count(integer|null), citation_query_date(date|null),
code_repository(url|null), repository_stars(integer|null), stars_query_date(date|null),
evidence([evidence])

""" + _EVIDENCE_RULES + """

规则：
1. 只抽取「需要抽取的论文标题列表」中给出的论文，每篇输出一条记录，顺序与列表一致。
2. 某篇论文在文档里找不到时跳过它，禁止编造。
3. citation_count / repository_stars 只在文档明确写出时填数字，否则 null；citation_query_date / stars_query_date 相应填 "2026-09-29" 或 null。
4. evidence 里 source 用文件名、page 用该论文所在页码（找不到就 null）、evidence 逐字引用原文。
5. 只输出一个 JSON 对象，不要 markdown 代码围栏，不要任何解释文字。
6. 标题与 evidence 原文保留原样，其余字段值使用英文。
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


def _compress_text(text: str, *, max_chars: int) -> str:
    """压缩文档文本以降低送入 LLM 的上下文 token 用量。

    采取保守的压缩，不改变关键事实：
    1. 折叠多余空白（OCR 常见）；
    2. 丢弃纯分隔线 / 孤立标点等噪声行；
    3. 去除逐字重复的行（页眉页脚常被 OCR 逐页重复）；
    4. 若仍超过 max_chars，保留头部与尾部、截断中间并显式标注（简历关键信息
       通常在开头，论文/参考文献通常在中后部）。
    """
    seen: set[str] = set()
    lines: list[str] = []
    for raw in text.splitlines():
        line = re.sub(r"\s+", " ", raw).strip()
        if not line:
            continue
        if re.fullmatch(r"[-_=~#*•·]{2,}", line):
            continue
        if len(line) == 1 and not line.isalnum():
            continue
        if line in seen:
            continue
        seen.add(line)
        lines.append(line)

    compressed = "\n".join(lines)
    if len(compressed) <= max_chars:
        return compressed

    head_size = int(max_chars * 0.7)
    tail_size = max_chars - head_size
    return (
        compressed[:head_size]
        + "\n[… context compressed: middle truncated …]\n"
        + compressed[-tail_size:]
    )


def _validate_profile(profile: dict[str, Any]) -> list[str]:
    schema = _load_schema()
    validator = Draft202012Validator(schema)
    errors = sorted(validator.iter_errors(profile), key=lambda e: list(e.path))
    messages: list[str] = []
    for error in errors:
        path = "/".join(str(part) for part in error.path) or "(root)"
        messages.append(f"{path}: {error.message}")
    return messages


def _cache_key(
    documents: list[ParsedDocument],
    *,
    papers_per_chunk: int,
    context_max_chars: int | None = None,
) -> str:
    schema = _load_schema()
    schema_version = schema["properties"]["schema_version"]["const"]
    payload = {
        "extraction_strategy": EXTRACTION_STRATEGY,
        "papers_per_chunk": papers_per_chunk,
        "context_max_chars": context_max_chars,
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


def _chat(messages: list[dict[str, str]]) -> str:
    """调用 DeepSeek 并返回原始文本。测试里会替换掉这个函数。"""
    _load_dotenv()
    client = OpenAI(api_key=os.getenv("DEEPSEEK_API_KEY"), base_url=_base_url())
    response = client.chat.completions.create(
        model=_model_name(),
        messages=messages,
        temperature=0,
        response_format={"type": "json_object"},
    )
    return response.choices[0].message.content or "{}"


def _parse_json(raw: str, context: str) -> Any:
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"LLM did not return valid JSON for {context}: {exc}") from exc


def _extract_meta(rendered: str, max_retries: int) -> dict[str, Any]:
    """抽取基础模块（含空 publications + 汇总字段），失败自动带错误反馈重试。"""
    last_errors: list[str] = []
    for _ in range(max_retries + 1):
        user_content = rendered
        if last_errors:
            user_content = (
                "上一次输出不符合 schema，请修正以下问题后重新输出完整 JSON：\n"
                + "\n".join(last_errors)
                + "\n\n"
                + rendered
            )
        raw = _chat(
            [
                {"role": "system", "content": META_SYSTEM_PROMPT},
                {"role": "user", "content": user_content},
            ]
        )
        data = _parse_json(raw, "basic modules")
        candidate = data.get("candidate") if isinstance(data, dict) else None
        if not isinstance(candidate, dict):
            raise ValueError("Basic-module extraction is missing the candidate field")

        publications_impact = candidate.setdefault("publications_impact", {})
        publications_impact.setdefault("publications", [])
        publications_impact.setdefault("total_citations", None)
        publications_impact.setdefault("citation_query_date", None)

        profile = {"schema_version": "1.0.0", "candidate": candidate}
        last_errors = _validate_profile(profile)
        if not last_errors:
            return candidate

    raise ValueError(
        "Basic-module extraction still does not conform to schema.json after retries:\n"
        + "\n".join(last_errors)
    )


def _enumerate_titles(rendered: str) -> list[dict[str, Any]]:
    """紧凑枚举文档里所有论文标题（仅 title + year），输出极小。"""
    raw = _chat(
        [
            {"role": "system", "content": ENUMERATE_SYSTEM_PROMPT},
            {"role": "user", "content": rendered},
        ]
    )
    data = _parse_json(raw, "publication enumeration")
    publications = data.get("publications") if isinstance(data, dict) else None
    if not isinstance(publications, list):
        raise ValueError("Publication enumeration did not return a publications list")
    titles: list[dict[str, Any]] = []
    for item in publications:
        if not isinstance(item, dict):
            continue
        title = item.get("title")
        if isinstance(title, str) and title.strip():
            year = item.get("year")
            if not (year is None or isinstance(year, int)):
                year = None
            titles.append({"title": title.strip(), "year": year})
    return titles


def _expand_publications(
    rendered: str,
    titles: list[dict[str, Any]],
    papers_per_chunk: int,
) -> list[dict[str, Any]]:
    """按标题分批补全完整 publication record，并合并返回。"""
    records: list[dict[str, Any]] = []
    for start in range(0, len(titles), papers_per_chunk):
        batch = titles[start : start + papers_per_chunk]
        user_content = (
            rendered
            + "\n\n需要抽取的论文标题列表：\n"
            + json.dumps(batch, ensure_ascii=False)
        )
        raw = _chat(
            [
                {"role": "system", "content": EXPAND_SYSTEM_PROMPT},
                {"role": "user", "content": user_content},
            ]
        )
        data = _parse_json(raw, "publication expansion")
        publications = data.get("publications") if isinstance(data, dict) else None
        if isinstance(publications, list):
            records.extend(item for item in publications if isinstance(item, dict))
    return records


def _normalize_title(title: Any) -> str:
    if not isinstance(title, str):
        return ""
    text = re.sub(r"[^\w\s]", " ", title.lower())
    return re.sub(r"\s+", " ", text).strip()


def _dedup_publications(publications: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """按规范化标题去重，保留首次出现。"""
    seen: set[str] = set()
    result: list[dict[str, Any]] = []
    for publication in publications:
        key = _normalize_title(publication.get("title"))
        if not key or key in seen:
            continue
        seen.add(key)
        result.append(publication)
    return result


def extract_profile(
    documents: list[ParsedDocument],
    *,
    max_retries: int = 2,
    papers_per_chunk: int = PUBLICATIONS_PER_CHUNK,
    compress: bool = True,
) -> tuple[dict[str, Any], list[str]]:
    """从一批文档抽取结构化档案，返回 (profile, 无文字层被跳过的文件名列表)。"""
    skipped = [doc.filename for doc in documents if not doc.full_text().strip()]
    usable = [doc for doc in documents if doc.full_text().strip()]
    if not usable:
        raise ValueError("No document has an extractable text layer. OCR may be required.")

    context_max_chars = _max_context_chars() if compress else None
    key = _cache_key(
        usable,
        papers_per_chunk=papers_per_chunk,
        context_max_chars=context_max_chars,
    )
    cached = _read_cache(key)
    if cached is not None:
        return cached, skipped

    rendered = _render_documents(usable)
    if compress:
        rendered = _compress_text(rendered, max_chars=context_max_chars)
    candidate = _extract_meta(rendered, max_retries)

    titles = _enumerate_titles(rendered) if "publication" in rendered.lower() else []
    publications = _expand_publications(rendered, titles, papers_per_chunk)
    candidate["publications_impact"]["publications"] = _dedup_publications(publications)

    profile = {"schema_version": "1.0.0", "candidate": candidate}
    errors = _validate_profile(profile)
    if errors:
        raise ValueError(
            "Extraction result still does not conform to schema.json:\n"
            + "\n".join(errors)
        )

    _write_cache(key, profile)
    return profile, skipped
