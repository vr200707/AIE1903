"""D6 评分：调用 DeepSeek 对候选人「经历与成果质量」打分（0–10）。

设计要点：
- 与「可信度」解耦：可信度由前端规则（来源类型权重 × 证据状态系数）计算，
  本模块只评估经历与成果本身的质量，不把「是否已公开核验」混进评分。
- 输入是结构化 candidate（去除 evidence 数组以压缩 prompt），输出每个模块
  的 0–10 评分与一句话优劣点评（中文），外加综合分 overall。
- 评分结果按「模型 + 候选档案内容」哈希落盘缓存，避免重复调用花费 token。
- 失败不抛异常：返回 None，由调用方（app/api.py）追加可重试 warning，
  分析链路不会因为评分失败而整体失败。
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from openai import OpenAI


logger = logging.getLogger("app.scorer")

PROJECT_ROOT = Path(__file__).resolve().parents[1]
CACHE_DIR = PROJECT_ROOT / ".cache" / "scoring"

MODULE_KEYS = (
    "basic_info",
    "education_employment",
    "awards_funding",
    "publications_impact",
    "academic_service",
    "overall_evaluation",
)

DEFAULT_MAX_OUTPUT_TOKENS = 2048

SYSTEM_PROMPT = """\
你是学术招聘预筛选的评估专家。输入是一位候选人的结构化档案（JSON），
输出该候选人在 6 个模块上的 0–10 评分，以及每个模块的一句话优劣点评。

评分口径：
1. 只评估「经历与成果本身的质量」，不考虑证据是否已公开核验——证据可信度由
   另一套规则单独计算，不归你管，不要因为证据待核实而压低评分。
2. 综合分 overall 按学术职位竞争力加权：论文与影响力、奖项与资助的权重更高；
   基本信息模块重点看学历、研究方向与技能的匹配广度。
3. 缺失字段按中性处理，不要当作缺点惩罚；不要因为字段少就机械地压低分数，
   有实质内容的部分按内容本身打分。
4. score 是 0–10 的数字，最多一位小数；pros / cons 各是一句不超过 30 字的中文，
   指出该模块最突出的优点与最明显的短板；没有短板时 cons 写「无明显短板」。
5. 6 个模块必须齐全：basic_info / education_employment / awards_funding /
   publications_impact / academic_service / overall_evaluation。
6. 只输出一个 JSON 对象，不要 markdown 代码围栏，不要任何解释文字。

输出结构：
{
  "overall": 7.8,
  "modules": {
    "basic_info": {"score": 8.0, "pros": "……", "cons": "……"},
    "education_employment": {"score": 7.2, "pros": "……", "cons": "……"},
    "awards_funding": {"score": 8.5, "pros": "……", "cons": "……"},
    "publications_impact": {"score": 7.0, "pros": "……", "cons": "……"},
    "academic_service": {"score": 6.5, "pros": "……", "cons": "……"},
    "overall_evaluation": {"score": 7.6, "pros": "……", "cons": "……"}
  }
}
"""


def _load_dotenv() -> None:
    load_dotenv(PROJECT_ROOT / ".env")


def _model_name() -> str:
    _load_dotenv()
    return os.getenv("DEEPSEEK_MODEL", "deepseek-chat")


def _base_url() -> str:
    _load_dotenv()
    return os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")


def _max_output_tokens() -> int:
    _load_dotenv()
    raw = os.getenv("SCORE_MAX_OUTPUT_TOKENS", str(DEFAULT_MAX_OUTPUT_TOKENS))
    try:
        return max(256, int(raw))
    except (TypeError, ValueError):
        return DEFAULT_MAX_OUTPUT_TOKENS


def _strip_evidence(value: Any) -> Any:
    """递归去掉 evidence 数组：评分不需要证据原文，同时压缩 prompt 体积。"""
    if isinstance(value, dict):
        return {k: _strip_evidence(v) for k, v in value.items() if k != "evidence"}
    if isinstance(value, list):
        return [_strip_evidence(item) for item in value]
    return value


def _candidate_digest(candidate: dict[str, Any]) -> dict[str, Any]:
    return _strip_evidence(candidate)


def _parse_json(raw: str) -> Any:
    """从模型输出中稳健地取出 JSON：容忍围栏、前后缀文本。"""
    text = raw.strip()
    if text.startswith("```"):
        first_newline = text.find("\n")
        fence = text[:first_newline].strip()
        if first_newline != -1 and fence.startswith("```"):
            text = text[first_newline + 1 :]
            end = text.rfind("```")
            if end != -1:
                text = text[:end]
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end <= start:
        raise ValueError("no JSON object found in model output")
    return json.loads(text[start : end + 1])


def _num(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    return None


def _round1(value: float) -> float:
    return round(min(10.0, max(0.0, value)), 1)


def _normalize(raw: Any) -> dict[str, Any]:
    """校验并归一化模型输出，任何缺项 / 非法值都抛错，由上层降级。"""
    if not isinstance(raw, dict):
        raise ValueError("assessment root must be an object")
    overall = _num(raw.get("overall"))
    modules_raw = raw.get("modules")
    if overall is None or not isinstance(modules_raw, dict):
        raise ValueError("assessment missing overall/modules")

    modules: dict[str, dict[str, Any]] = {}
    for key in MODULE_KEYS:
        item = modules_raw.get(key)
        if not isinstance(item, dict):
            raise ValueError(f"missing module: {key}")
        score = _num(item.get("score"))
        if score is None:
            raise ValueError(f"module {key} score invalid")
        modules[key] = {
            "score": _round1(score),
            "pros": str(item.get("pros") or "").strip() or "暂无点评",
            "cons": str(item.get("cons") or "").strip() or "无明显短板",
        }

    return {"overall": _round1(overall), "modules": modules}


def _cache_key(candidate: dict[str, Any]) -> str:
    payload = {
        "model": _model_name(),
        "candidate": _candidate_digest(candidate),
    }
    canonical = json.dumps(payload, sort_keys=True, ensure_ascii=False, default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _read_cache(key: str) -> dict[str, Any] | None:
    path = CACHE_DIR / f"{key}.json"
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def _write_cache(key: str, assessment: dict[str, Any]) -> None:
    try:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        (CACHE_DIR / f"{key}.json").write_text(
            json.dumps(assessment, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    except OSError:
        pass


def _chat(messages: list[dict[str, str]]) -> str:
    _load_dotenv()
    client = OpenAI(api_key=os.getenv("DEEPSEEK_API_KEY"), base_url=_base_url())
    response = client.chat.completions.create(
        model=_model_name(),
        messages=messages,
        temperature=0.3,
        max_tokens=_max_output_tokens(),
    )
    return response.choices[0].message.content or ""


def score_candidate(candidate: dict[str, Any]) -> dict[str, Any] | None:
    """对候选人经历质量打分；失败返回 None（不抛异常）。"""
    if not isinstance(candidate, dict) or not candidate:
        return None
    key = _cache_key(candidate)
    cached = _read_cache(key)
    if cached is not None:
        return cached

    digest = _candidate_digest(candidate)
    user_prompt = (
        "以下是候选人结构化档案（已去除证据字段）：\n\n"
        + json.dumps(digest, ensure_ascii=False, default=str)
        + "\n\n请按系统提示输出评分 JSON。"
    )
    try:
        raw = _chat(
            [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ]
        )
        assessment = _normalize(_parse_json(raw))
        _write_cache(key, assessment)
        return assessment
    except Exception as exc:  # 网络 / 解析失败都不影响分析主链路。
        logger.warning("scoring failed: %s: %s", type(exc).__name__, exc)
        return None
