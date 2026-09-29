"""D4 证据引擎：对抽取出的声明做公开来源核验（external verification）。

当前实现以公开文献数据库为核心，核验论文（publication）类声明：

- Crossref（免费、无需 key）：期刊 / 会议等正式发表物，含 DOI；
- OpenAlex（免费，带 mailto 进入礼貌池）：额外覆盖 arXiv 预印本等 Crossref
  未收录的文献，并提供作者名，便于人工复核。

判定口径（先确定“论文身份”，再判断年份是否一致）：

- 在任意数据库中检索到【标题匹配 + 年份一致】的论文 -> confirmed，回填 DOI；
- 检索到【标题基本一致但年份明显矛盾】-> conflict（保留原文供人工复核）；
- 检索不到标题匹配的论文 -> not_found_public；
- 所有检索源都因网络 / 服务异常不可用 -> to_verify（不把故障误判成造假）。

奖项、经费、职位、机构等声明需要通用网页搜索。当前版本已接入免费网页搜索（默认
Bing HTML，见 `app/search.py`），但网页搜索只能「找公开线索」，无法像文献数据库那样
自动认定真伪，因此对这类声明保守地产出 `to_verify`（附上线索链接）或
`not_found_public`，交由人工复核，避免把未证实的声明误判为 `confirmed`。
"""

from __future__ import annotations

import copy
import difflib
import re
from dataclasses import dataclass, field
from datetime import date
from typing import Any

import httpx

from app.search import search_web


CROSSREF_WORKS = "https://api.crossref.org/works"
OPENALEX_WORKS = "https://api.openalex.org/works"
MAILTO = "aie1903@example.com"
USER_AGENT = f"AIE1903-cv-verify/1.0 (mailto:{MAILTO})"

MATCH_THRESHOLD = 0.6
CONFIRM_THRESHOLD = 0.8
YEAR_TOLERANCE = 1
HTTP_TIMEOUT = 30.0


@dataclass
class _Candidate:
    """把不同来源的检索结果统一成同一形状，供匹配与判定使用。"""

    source: str
    title: str
    year: int | None
    url: str | None
    venue: str | None
    authors: list[str] = field(default_factory=list)


def _today() -> str:
    return date.today().isoformat()


def _normalize(text: str) -> str:
    text = text.lower()
    text = re.sub(r"[^\w\s]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _title_score(query_title: str, item_title: str) -> float:
    return difflib.SequenceMatcher(
        None, _normalize(query_title), _normalize(item_title)
    ).ratio()


def _year_consistent(claimed_year: Any, found_year: int | None) -> bool:
    if claimed_year is None or found_year is None:
        return True
    try:
        return abs(int(claimed_year) - int(found_year)) <= YEAR_TOLERANCE
    except (TypeError, ValueError):
        return True


def _crossref_candidates(title: str) -> list[_Candidate]:
    response = httpx.get(
        CROSSREF_WORKS,
        params={"query.bibliographic": title, "rows": 5},
        timeout=HTTP_TIMEOUT,
    )
    response.raise_for_status()
    items = response.json()["message"]["items"]
    candidates: list[_Candidate] = []
    for item in items:
        item_titles = item.get("title") or []
        if not item_titles:
            continue
        date_parts = (item.get("published") or {}).get("date-parts") or [[None]]
        year = date_parts[0][0] if date_parts and date_parts[0] else None
        doi = item.get("DOI")
        containers = item.get("container-title") or []
        authors = [
            f"{a.get('given', '')} {a.get('family', '')}".strip()
            for a in (item.get("author") or [])
            if a.get("given") or a.get("family")
        ]
        candidates.append(
            _Candidate(
                source="Crossref",
                title=item_titles[0],
                year=year,
                url=f"https://doi.org/{doi}" if doi else None,
                venue=containers[0] if containers else None,
                authors=authors[:5],
            )
        )
    return candidates


def _openalex_candidates(title: str) -> list[_Candidate]:
    response = httpx.get(
        OPENALEX_WORKS,
        params={
            "search": title,
            "per-page": 5,
            "mailto": MAILTO,
        },
        headers={"User-Agent": USER_AGENT},
        timeout=HTTP_TIMEOUT,
    )
    response.raise_for_status()
    results = response.json().get("results", [])
    candidates: list[_Candidate] = []
    for item in results:
        item_title = item.get("title") or ""
        if not item_title:
            continue
        venue = None
        primary_location = item.get("primary_location") or {}
        source = primary_location.get("source") or {}
        if source.get("display_name"):
            venue = source["display_name"]
        authors = [
            a.get("author", {}).get("display_name", "")
            for a in (item.get("authorships") or [])
            if a.get("author", {}).get("display_name")
        ]
        candidates.append(
            _Candidate(
                source="OpenAlex",
                title=item_title,
                year=item.get("publication_year"),
                url=item.get("doi") or None,
                venue=venue,
                authors=authors[:5],
            )
        )
    return candidates


def _search_candidates(title: str) -> tuple[list[_Candidate], list[str]]:
    """顺序检索所有来源；返回 (候选列表, 失败来源列表)。"""
    candidates: list[_Candidate] = []
    errors: list[str] = []
    fetchers = [("Crossref", _crossref_candidates), ("OpenAlex", _openalex_candidates)]
    for name, fetcher in fetchers:
        try:
            candidates.extend(fetcher(title))
        except Exception as exc:  # 网络 / 服务异常不判为造假。
            errors.append(f"{name}: {type(exc).__name__}")
    return candidates, errors


def _verification_evidence(
    *,
    source: str,
    status: str,
    source_url: str | None,
    text: str,
    query_date: str,
) -> dict[str, Any]:
    return {
        "source": source,
        "source_url": source_url,
        "evidence": text,
        "evidence_status": status,
        "query_date": query_date,
        "source_type": "bibliographic_database",
    }


def _authors_label(authors: list[str]) -> str:
    if not authors:
        return ""
    return "，作者：" + "、".join(authors)


def verify_publication(
    publication: dict[str, Any],
    *,
    query_date: str | None = None,
) -> dict[str, Any]:
    """核验一条论文声明，返回追加了核验证据的副本（不修改入参）。"""
    query_date = query_date or _today()
    verified = dict(publication)
    verified["evidence"] = list(publication.get("evidence", []))
    title = publication.get("title")
    if not title:
        return verified

    candidates, errors = _search_candidates(title)

    if errors and not candidates:
        verified["evidence"].append(
            _verification_evidence(
                source="ExternalVerifier",
                status="to_verify",
                source_url=None,
                text=(
                    "核验服务暂时不可用，未能联网检索公开来源（"
                    + "；".join(errors)
                    + "），该声明暂标记为待核验。"
                ),
                query_date=query_date,
            )
        )
        return verified

    scored = [
        (_title_score(title, c.title), c)
        for c in candidates
        if _title_score(title, c.title) >= MATCH_THRESHOLD
    ]
    if not scored:
        verified["evidence"].append(
            _verification_evidence(
                source="ExternalVerifier",
                status="not_found_public",
                source_url=None,
                text="在 Crossref / OpenAlex 中均未检索到标题匹配的论文，公开来源暂无法证实该声明。",
                query_date=query_date,
            )
        )
        return verified

    scored.sort(key=lambda pair: pair[0], reverse=True)
    best_score = scored[0][0]
    top = [c for score, c in scored if abs(score - best_score) < 1e-6]

    claimed_year = publication.get("year")
    consistent = [c for c in top if _year_consistent(claimed_year, c.year)]
    chosen = consistent[0] if consistent else top[0]

    if best_score < CONFIRM_THRESHOLD:
        # 标题只是部分相似，不足以认定是同一篇论文，交给人工复核。
        verified["evidence"].append(
            _verification_evidence(
                source="ExternalVerifier",
                status="to_verify",
                source_url=chosen.url,
                text=(
                    f"公开来源中仅检索到标题部分相似的论文：{chosen.title}"
                    f"{_authors_label(chosen.authors)}，相似度不足以认定是同一篇，请人工复核。"
                ),
                query_date=query_date,
            )
        )
        return verified

    is_confirmed = _year_consistent(claimed_year, chosen.year)
    venue_text = f"，发表载体：{chosen.venue}" if chosen.venue else ""
    authors_text = _authors_label(chosen.authors)

    if is_confirmed:
        status = "confirmed"
        year_text = f"，年份：{chosen.year}" if chosen.year else ""
        text = (
            f"在 {chosen.source} 检索到标题匹配的论文：{chosen.title}"
            f"{venue_text}{authors_text}{year_text}。"
        )
    else:
        status = "conflict"
        claimed_text = claimed_year if claimed_year is not None else "未知"
        found_text = chosen.year if chosen.year is not None else "未知"
        text = (
            f"简历标注年份 {claimed_text}，{chosen.source} 记录为 {found_text}，两者不一致。"
            f"匹配论文：{chosen.title}{venue_text}{authors_text}，请人工复核。"
        )

    verified["evidence"].append(
        _verification_evidence(
            source=chosen.source,
            status=status,
            source_url=chosen.url,
            text=text,
            query_date=query_date,
        )
    )
    return verified


def verify_publications(
    publications: list[dict[str, Any]],
    *,
    query_date: str | None = None,
) -> list[dict[str, Any]]:
    return [
        verify_publication(publication, query_date=query_date)
        for publication in publications
    ]


def _web_evidence(
    text: str,
    status: str,
    source_url: str | None,
    query_date: str,
) -> dict[str, Any]:
    return {
        "source": "WebSearch",
        "source_url": source_url,
        "evidence": text,
        "evidence_status": status,
        "query_date": query_date,
        "source_type": "other",
    }


def verify_text_claim(
    claim_text: str,
    *,
    query_date: str | None = None,
    search: Any = None,
    max_results: int = 5,
) -> dict[str, Any]:
    """对一条非论文声明做通用网页搜索核验，返回一条 evidence。

    口径（保守，网页搜索不能自动认定真伪）：
    - 搜索服务异常 -> `to_verify`（不把故障误判成造假）；
    - 搜索无结果 -> `not_found_public`；
    - 搜索有结果 -> `to_verify`，附上 top 结果链接与摘要，供人工打开核对。
    """
    query_date = query_date or _today()
    search = search or search_web
    try:
        results = search(claim_text, max_results=max_results)
    except Exception as exc:  # 网络 / 服务异常不判为造假。
        return _web_evidence(
            f"网页搜索服务暂时不可用（{type(exc).__name__}），该声明暂标记为待核验。",
            "to_verify",
            None,
            query_date,
        )

    if not results:
        return _web_evidence(
            f"公开网页搜索未找到与「{claim_text}」相关的信息，暂无法证实该声明。",
            "not_found_public",
            None,
            query_date,
        )

    top = results[0]
    snippet = (top.snippet or "")[:160]
    text = f"网页搜索找到相关线索：{top.title}（{snippet}）。"
    others = "；".join(r.title for r in results[1:3] if r.title)
    if others:
        text += f" 另有相关结果：{others}。"
    text += " 网页搜索无法自动确认真伪，请人工打开链接核对权威来源。"
    return _web_evidence(text, "to_verify", top.url, query_date)


def _claim_text(*parts: Any) -> str:
    return " ".join(str(p) for p in parts if p not in (None, "")).strip()


def _web_claims_from_profile(
    candidate: dict[str, Any],
) -> list[tuple[str, str, int | None]]:
    """从档案中收集可网页核验的声明，返回 (claim 文本, 模块, 列表索引)。"""
    claims: list[tuple[str, str, int | None]] = []

    basic = candidate.get("basic_info") or {}
    basic_text = _claim_text(
        basic.get("name"), basic.get("institution"), basic.get("position")
    )
    if basic_text:
        claims.append((basic_text, "basic_info", None))

    edu = (candidate.get("education_employment") or {}).get("education") or []
    for index, item in enumerate(edu):
        text = _claim_text(
            item.get("degree"), item.get("field"), item.get("institution")
        )
        if text:
            claims.append((text, "education", index))

    emp = (candidate.get("education_employment") or {}).get("employment") or []
    for index, item in enumerate(emp):
        text = _claim_text(item.get("position"), item.get("institution"))
        if text:
            claims.append((text, "employment", index))

    awards = (candidate.get("awards_funding") or {}).get("awards") or []
    for index, item in enumerate(awards):
        text = _claim_text(
            item.get("name"), item.get("awarding_body"), item.get("year")
        )
        if text:
            claims.append((text, "award", index))

    funding = (candidate.get("awards_funding") or {}).get("funding") or []
    for index, item in enumerate(funding):
        text = _claim_text(item.get("project_name"), item.get("funder"))
        if text:
            claims.append((text, "funding", index))

    return claims


def _append_web_evidence(
    candidate: dict[str, Any],
    kind: str,
    index: int | None,
    evidence: dict[str, Any],
) -> None:
    target: dict[str, Any] | None = None
    if kind == "basic_info":
        target = candidate.setdefault("basic_info", {})
    elif kind == "education":
        target = candidate["education_employment"]["education"][index]
    elif kind == "employment":
        target = candidate["education_employment"]["employment"][index]
    elif kind == "award":
        target = candidate["awards_funding"]["awards"][index]
    elif kind == "funding":
        target = candidate["awards_funding"]["funding"][index]
    if target is not None:
        target.setdefault("evidence", []).append(evidence)


def _verify_web_claims(
    candidate: dict[str, Any],
    *,
    query_date: str,
    search: Any,
) -> dict[str, Any]:
    for claim_text, kind, index in _web_claims_from_profile(candidate):
        evidence = verify_text_claim(
            claim_text, query_date=query_date, search=search
        )
        _append_web_evidence(candidate, kind, index, evidence)
    return candidate


def verify_profile(
    profile: dict[str, Any],
    *,
    query_date: str | None = None,
    verify_web: bool = False,
    search: Any = None,
) -> dict[str, Any]:
    """对完整档案执行公开来源核验，返回追加核验证据后的档案（浅拷贝）。

    - 论文声明（publication）：始终用 Crossref / OpenAlex 精确核验；
    - 非论文声明（奖项 / 经费 / 职位 / 机构等）：仅在 `verify_web=True` 时用
      通用网页搜索补充线索（默认关闭，由上层 API 按需开启）。
    """
    verified = dict(profile)
    candidate = copy.deepcopy(profile["candidate"])
    publications_impact = candidate["publications_impact"]
    publications_impact["publications"] = verify_publications(
        publications_impact.get("publications", []), query_date=query_date
    )
    if verify_web:
        candidate = _verify_web_claims(
            candidate, query_date=query_date or _today(), search=search
        )
    verified["candidate"] = candidate
    return verified
