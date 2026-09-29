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

import json
import os
from pathlib import Path
from typing import Any, Iterator

from dotenv import load_dotenv
from openai import OpenAI


PROJECT_ROOT = Path(__file__).resolve().parents[1]
EVIDENCE_KEYS = {"source", "evidence", "evidence_status", "query_date"}
CONFIDENCE_LEVELS = ("high", "medium", "low")
MAX_EVIDENCE_REFS = 8

SYSTEM_PROMPT = """\
你是候选人档案问答助手。你只能依据【给定的档案 JSON】与【证据索引】回答问题。

硬性规则：
1. 档案里能回答：直接给出结论，并用 evidence_ids 引用支撑该结论的证据编号。
2. 档案里找不到依据：answer 写「档案中没有相关信息」，confidence 填 "low"，
   evidence_ids 返回 []。禁止用外部知识或常识补全。
3. evidence_ids 只能使用【证据索引】里真实存在的编号；不确定就不要引用。
4. 档案内部互相矛盾时（例如两处日期不一致），必须在 answer 里明确指出矛盾，
   并把双方证据编号都列进 evidence_ids。
5. confidence 取值：high（档案明确写出一致事实且有直接证据）/ medium（需要合并
   多处信息或存在少量推断）/ low（信息缺失或存在冲突）。
6. 用提问所用的语言作答：中文提问用中文，英文提问用英文。
7. 只输出一个 JSON 对象，字段为 answer(string)、confidence(string)、
   evidence_ids(string 数组)。不要 markdown 代码围栏，不要任何额外解释文字。
"""


def _load_dotenv() -> None:
    load_dotenv(PROJECT_ROOT / ".env")


def _model_name() -> str:
    _load_dotenv()
    return os.getenv("DEEPSEEK_MODEL", "deepseek-chat")


def _base_url() -> str:
    _load_dotenv()
    return os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")


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


def _build_user_message(
    profile: dict[str, Any], evidence_index: list[dict[str, Any]], question: str
) -> str:
    candidate = profile.get("candidate", {})
    return (
        "【档案 JSON】（schema_version："
        + str(profile.get("schema_version"))
        + "）\n"
        + json.dumps(candidate, ensure_ascii=False, indent=1)
        + "\n\n【证据索引】\n"
        + json.dumps(evidence_index, ensure_ascii=False, indent=1)
        + "\n\n【提问】\n"
        + question
    )


def _call_model(system_prompt: str, user_message: str) -> str:
    """调用 DeepSeek 并返回原始文本。测试里会替换掉这个函数。"""
    _load_dotenv()  # 必须先加载 .env，否则读不到 DEEPSEEK_API_KEY
    client = OpenAI(api_key=os.getenv("DEEPSEEK_API_KEY"), base_url=_base_url())
    response = client.chat.completions.create(
        model=_model_name(),
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ],
        temperature=0,
        response_format={"type": "json_object"},
    )
    return response.choices[0].message.content or "{}"


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


def answer_question(
    profile: dict[str, Any], question: str, *, max_evidence: int = MAX_EVIDENCE_REFS
) -> dict[str, Any]:
    """基于档案回答一个自然语言问题，返回 {answer, confidence, evidence}。"""
    if not question or not question.strip():
        raise ValueError("Question cannot be empty")

    index, evidence_index = build_evidence_index(profile)
    raw = _call_model(
        SYSTEM_PROMPT, _build_user_message(profile, evidence_index, question.strip())
    )
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Q&A model did not return valid JSON: {exc}") from exc

    answer, confidence, evidence_ids = _validate_payload(payload)

    # 只用真实存在的编号，去重并保持顺序；不存在的编号直接丢弃（防引用幻觉）。
    matched: list[dict[str, Any]] = []
    seen: set[str] = set()
    for evidence_id in evidence_ids:
        if evidence_id in index and evidence_id not in seen:
            seen.add(evidence_id)
            matched.append(index[evidence_id])
        if len(matched) >= max_evidence:
            break

    # 拿不出证据就不能声称高可信度。
    if not matched and confidence != "low":
        confidence = "low"

    return {"answer": answer, "confidence": confidence, "evidence": matched}
