"""通用网页搜索（免费后端）：无 key 也能核验非论文声明。

背景：D4 的核验以 Crossref / OpenAlex 为主，只能覆盖论文（publication）类声明。
奖项、经费、职位、机构等声明无法用文献数据库核验，需要通用网页搜索（web search）。

本模块默认使用 Bing 的 HTML 结果页（`cn.bing.com`，无需 key、免费），用 httpx 抓取
并以 lxml 解析结果列表。这是「无 key 阶段的过渡方案」，可能有速率限制或被反爬；
后续拿到 Tavily / Brave / Serper 等付费 key 时，只需新增一个 provider 函数并在
环境变量 `WEB_SEARCH_PROVIDER` 切换，上层核验逻辑无需改动。

统一返回 `SearchResult(title, url, snippet, source)`，屏蔽不同供应商的差异。
"""

from __future__ import annotations

import base64
import html as html_module
import os
import re
from dataclasses import dataclass
from urllib.parse import parse_qs, unquote, urlparse

import httpx
from lxml import html as lxml_html


DEFAULT_BASE_URL = os.getenv("WEB_SEARCH_BASE_URL", "https://cn.bing.com/search")
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)
HTTP_TIMEOUT = 20.0
MAX_RESULTS = 8


@dataclass
class SearchResult:
    """一条统一的搜索结果。"""

    title: str
    url: str
    snippet: str
    source: str


def _clean(text: str | None) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def _resolve_bing_url(href: str) -> str:
    """把 Bing 结果链接还原成真实目标 URL。"""
    href = html_module.unescape((href or "").strip())
    if href.startswith("//"):
        href = "https:" + href
    parsed = urlparse(href)
    if "bing.com" in parsed.netloc and parsed.path.rstrip("/").endswith("/ck/a"):
        # Bing 的重定向形如 /ck/a?...&u=a1<base64url(target)>.，需要解码 u 参数。
        u = parse_qs(parsed.query).get("u", [None])[0]
        if u and u.startswith("a1"):
            payload = u[2:].split(".", 1)[0]
            payload += "=" * (-len(payload) % 4)
            try:
                return base64.urlsafe_b64decode(payload).decode("utf-8")
            except Exception:  # 解码失败则保留原链接，避免丢弃结果。
                pass
    return href


def _bing_results(query: str, *, max_results: int) -> list[SearchResult]:
    response = httpx.get(
        DEFAULT_BASE_URL,
        params={"q": query},
        headers={"User-Agent": USER_AGENT},
        timeout=HTTP_TIMEOUT,
        follow_redirects=True,
    )
    response.raise_for_status()
    tree = lxml_html.fromstring(response.text)

    results: list[SearchResult] = []
    for node in tree.xpath(
        "//li[contains(concat(' ', normalize-space(@class), ' '), ' b_algo ')]"
    ):
        link = node.xpath(".//h2/a")
        if not link:
            continue
        title = _clean(link[0].text_content())
        url = _resolve_bing_url(link[0].get("href") or "")
        snippet_nodes = node.xpath(".//p")
        snippet = _clean(snippet_nodes[0].text_content()) if snippet_nodes else ""
        if not title or not url:
            continue
        results.append(
            SearchResult(title=title, url=url, snippet=snippet, source="bing")
        )
        if len(results) >= max_results:
            break
    return results


_PROVIDERS = {"bing": _bing_results}


def search_web(query: str, *, max_results: int | None = None) -> list[SearchResult]:
    """按环境变量选择搜索供应商，返回统一形状的结果列表。"""
    provider = os.getenv("WEB_SEARCH_PROVIDER", "bing")
    fetcher = _PROVIDERS.get(provider)
    if fetcher is None:
        raise ValueError(f"Unknown web search provider: {provider}")
    return fetcher(query, max_results=max_results or MAX_RESULTS)
