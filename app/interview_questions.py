"""Evidence-grounded English interview question generation."""

from __future__ import annotations

import json
import re
from typing import Any, Iterable

from app.interview_llm import chat_json, input_char_budget, model_name, trim_text
from app.resilience import warning


QUESTION_MIN = 5
QUESTION_MAX = 7
DEFAULT_QUESTION_COUNT = 6
MAX_CLAIM_CANDIDATES = 36
MAX_SOURCE_REFS_PER_CLAIM = 4
MAX_EXCERPT_CHARS = 420

STATUS_RANK = {
    "conflict": 5,
    "to_verify": 4,
    "not_found_public": 3,
    "confirmed": 1,
}

CATEGORY_RANK = {
    "publication": 5,
    "funding": 5,
    "award": 4,
    "employment": 4,
    "education": 2,
    "service": 2,
    "verification": 5,
    "other": 1,
}

SYSTEM_PROMPT = """\
You design high-signal screening questions for an academic hiring committee.
Use only the supplied candidate claims. Never invent achievements, numbers,
institutions, publications, awards, or evidence.

Selection rules:
1. Prefer claims that materially distinguish the candidate: important research
   outcomes, funding, awards, leadership, ownership, career transitions, and
   claims that are conflicting or awaiting verification.
2. Avoid low-value skill-list checks and questions answerable by reading the CV.
3. Cover different parts of the record. Do not ask the same fact twice.
4. Use a sensible progression: context and flagship work first, then personal
   contribution, uncertain claims, teaching/collaboration, and future direction.
5. Every question must cite one or more supplied claim_id values.
6. Questions must not ask about protected or irrelevant personal traits.
7. All question text and rationale must be natural English.

Return one JSON object with this exact shape:
{
  "questions": [
    {
      "text": "question text",
      "competency": "research_impact|ownership_leadership|evidence_clarity|teaching|collaboration|career_motivation|other",
      "objective": "what the answer should clarify",
      "why_it_matters": "why this matters to the hiring decision",
      "answer_seconds": 90,
      "claim_ids": ["C1"]
    }
  ]
}
No markdown fence and no extra text.
"""

COMPETENCIES = {
    "research_impact",
    "ownership_leadership",
    "evidence_clarity",
    "teaching",
    "collaboration",
    "career_motivation",
    "other",
}


def _iter_evidence(node: dict[str, Any], path: str) -> list[dict[str, Any]]:
    refs: list[dict[str, Any]] = []
    evidence_items = node.get("evidence")
    if not isinstance(evidence_items, list):
        return refs
    for index, item in enumerate(evidence_items[:MAX_SOURCE_REFS_PER_CLAIM]):
        if not isinstance(item, dict):
            continue
        refs.append(
            {
                "source": str(item.get("source") or "Candidate document"),
                "source_url": item.get("source_url"),
                "excerpt": trim_text(
                    item.get("evidence") or item.get("excerpt"),
                    MAX_EXCERPT_CHARS,
                ),
                "evidence_status": item.get("evidence_status")
                if item.get("evidence_status") in STATUS_RANK
                else "to_verify",
                "page": item.get("page"),
                "source_type": item.get("source_type"),
                "profile_path": f"{path}.evidence[{index}]",
            }
        )
    return refs


def _add_claim(
    claims: list[dict[str, Any]],
    *,
    path: str,
    category: str,
    statement: Any,
    node: dict[str, Any],
    role_context: str,
) -> None:
    text = trim_text(statement, 900)
    if not text:
        return
    sources = _iter_evidence(node, path)
    statuses = sorted(
        {ref["evidence_status"] for ref in sources},
        key=lambda value: STATUS_RANK.get(value, 0),
        reverse=True,
    )
    uncertainty = max(
        (STATUS_RANK.get(status, 0) for status in statuses),
        default=0,
    )
    overlap = len(
        set(re.findall(r"[a-z0-9]+", text.lower()))
        & set(re.findall(r"[a-z0-9]+", role_context.lower()))
    )
    priority = (
        CATEGORY_RANK.get(category, 0) * 10
        + uncertainty * 4
        + min(overlap, 8)
        + min(len(sources), 3)
    )
    claims.append(
        {
            "claim_id": "",
            "profile_path": path,
            "category": category,
            "statement": text,
            "evidence_statuses": statuses,
            "sources": sources,
            "priority": priority,
        }
    )


def _format_amount(amount: Any, currency: Any) -> str:
    if amount is None:
        return ""
    return f"{amount} {currency or ''}".strip()


def collect_claim_candidates(
    profile: dict[str, Any],
    role_context: str = "",
) -> list[dict[str, Any]]:
    """Turn the profile into compact, evidence-bearing claims for prompting."""
    candidate = profile.get("candidate", {})
    if not isinstance(candidate, dict):
        return []
    claims: list[dict[str, Any]] = []

    basic = candidate.get("basic_info", {})
    if isinstance(basic, dict):
        _add_claim(
            claims,
            path="candidate.basic_info",
            category="employment",
            statement=(
                f"{basic.get('position') or 'Current role'} at "
                f"{basic.get('institution') or 'current institution'}; "
                f"research areas: {', '.join(basic.get('research_interests') or [])}"
            ),
            node=basic,
            role_context=role_context,
        )
        for index, item in enumerate(basic.get("to_verify") or []):
            if not isinstance(item, dict):
                continue
            refs = item.get("evidence") if isinstance(item.get("evidence"), list) else []
            _add_claim(
                claims,
                path=f"candidate.basic_info.to_verify[{index}]",
                category="verification",
                statement=(
                    f"Claim to verify: {item.get('claim')}. "
                    f"Reason for review: {item.get('reason')}"
                ),
                node={"evidence": refs},
                role_context=role_context,
            )

    education_employment = candidate.get("education_employment", {})
    if isinstance(education_employment, dict):
        for index, item in enumerate(education_employment.get("education") or []):
            if not isinstance(item, dict):
                continue
            _add_claim(
                claims,
                path=f"candidate.education_employment.education[{index}]",
                category="education",
                statement=(
                    f"{item.get('degree') or 'Degree'} in {item.get('field') or 'field'} "
                    f"at {item.get('institution') or 'institution'}; "
                    f"outcomes: {'; '.join(item.get('outcomes') or [])}"
                ),
                node=item,
                role_context=role_context,
            )
        for index, item in enumerate(education_employment.get("employment") or []):
            if not isinstance(item, dict):
                continue
            _add_claim(
                claims,
                path=f"candidate.education_employment.employment[{index}]",
                category="employment",
                statement=(
                    f"{item.get('position') or 'Role'} at "
                    f"{item.get('institution') or 'institution'}; "
                    f"responsibilities: {'; '.join(item.get('responsibilities') or [])}; "
                    f"outcomes: {'; '.join(item.get('outcomes') or [])}"
                ),
                node=item,
                role_context=role_context,
            )

    awards_funding = candidate.get("awards_funding", {})
    if isinstance(awards_funding, dict):
        for index, item in enumerate(awards_funding.get("awards") or []):
            if not isinstance(item, dict):
                continue
            _add_claim(
                claims,
                path=f"candidate.awards_funding.awards[{index}]",
                category="award",
                statement=(
                    f"Award: {item.get('name')}; year: {item.get('year')}; "
                    f"awarding body: {item.get('awarding_body')}"
                ),
                node=item,
                role_context=role_context,
            )
        for index, item in enumerate(awards_funding.get("funding") or []):
            if not isinstance(item, dict):
                continue
            _add_claim(
                claims,
                path=f"candidate.awards_funding.funding[{index}]",
                category="funding",
                statement=(
                    f"Funding project: {item.get('project_name')}; "
                    f"funder: {item.get('funder')}; role: {item.get('role')}; "
                    f"amount: {_format_amount(item.get('amount'), item.get('currency'))}"
                ),
                node=item,
                role_context=role_context,
            )

    publications = candidate.get("publications_impact", {})
    if isinstance(publications, dict):
        publication_items = [
            item
            for item in publications.get("publications") or []
            if isinstance(item, dict)
        ]
        publication_items.sort(
            key=lambda item: (
                int(item.get("citation_count") or 0),
                int(item.get("year") or 0),
            ),
            reverse=True,
        )
        for index, item in enumerate(publication_items[:12]):
            original_index = (publications.get("publications") or []).index(item)
            _add_claim(
                claims,
                path=(
                    "candidate.publications_impact.publications"
                    f"[{original_index}]"
                ),
                category="publication",
                statement=(
                    f"Publication: {item.get('title')} ({item.get('year')}); "
                    f"author role: {item.get('author_role')}; "
                    f"venue: {item.get('venue')}; ranking: {item.get('ranking')}; "
                    f"citations: {item.get('citation_count')}; "
                    f"repository stars: {item.get('repository_stars')}"
                ),
                node=item,
                role_context=role_context,
            )

    service = candidate.get("academic_service", {})
    if isinstance(service, dict):
        for index, item in enumerate(service.get("services") or []):
            if not isinstance(item, dict):
                continue
            _add_claim(
                claims,
                path=f"candidate.academic_service.services[{index}]",
                category="service",
                statement=(
                    f"Academic service: {item.get('service_type')} at "
                    f"{item.get('organization_or_venue')}; role: {item.get('role')}"
                ),
                node=item,
                role_context=role_context,
            )

    claims.sort(key=lambda item: item["priority"], reverse=True)
    deduplicated: list[dict[str, Any]] = []
    seen: set[str] = set()
    for claim in claims:
        key = claim["statement"].strip().lower()
        if not key or key in seen:
            continue
        seen.add(key)
        deduplicated.append(claim)
        if len(deduplicated) >= MAX_CLAIM_CANDIDATES:
            break
    for index, claim in enumerate(deduplicated, start=1):
        claim["claim_id"] = f"C{index}"
    return deduplicated


def _compact_claims(
    claims: Iterable[dict[str, Any]],
    *,
    excerpt_limit: int = 220,
) -> list[dict[str, Any]]:
    compact: list[dict[str, Any]] = []
    for claim in claims:
        compact.append(
            {
                "claim_id": claim["claim_id"],
                "category": claim["category"],
                "statement": trim_text(claim["statement"], 650),
                "evidence_statuses": claim["evidence_statuses"],
                "sources": [
                    {
                        "source": source["source"],
                        "evidence_status": source["evidence_status"],
                        "excerpt": trim_text(source["excerpt"], excerpt_limit),
                    }
                    for source in claim["sources"]
                ],
            }
        )
    return compact


def _fit_claims_to_budget(
    claims: list[dict[str, Any]],
    system_prompt: str,
    role_context: str,
) -> tuple[list[dict[str, Any]], bool]:
    budget = input_char_budget()
    fixed = len(system_prompt) + len(role_context) + 2_500
    for excerpt_limit in (220, 120, 60, 0):
        compact = _compact_claims(claims, excerpt_limit=excerpt_limit)
        if fixed + len(json.dumps(compact, ensure_ascii=False)) <= budget:
            return compact, False
        for count in (32, 24, 18, 12, 8):
            subset = compact[:count]
            if fixed + len(json.dumps(subset, ensure_ascii=False)) <= budget:
                return subset, count < len(claims)
    return _compact_claims(claims[:6], excerpt_limit=0), True


def _fallback_question(
    claim: dict[str, Any],
    *,
    variant: int = 0,
) -> dict[str, Any]:
    category = claim["category"]
    statement = trim_text(claim["statement"], 280)
    variant_key = variant % 5
    if variant_key == 1:
        text = (
            f"Using the record item \"{statement}\", explain the key decision "
            "you made, the alternatives you considered, and the result."
        )
        competency = "ownership_leadership"
    elif variant_key == 2:
        text = (
            f"What measurable outcome supports the record item \"{statement}\", "
            "and what was your personal part in producing it?"
        )
        competency = "evidence_clarity"
    elif variant_key == 3:
        text = (
            f"What changed in research or practice because of \"{statement}\", "
            "and how did you verify that change?"
        )
        competency = "research_impact"
    elif variant_key == 4:
        text = (
            f"For \"{statement}\", who did you work with, what did you personally "
            "own, and what was the hardest unresolved issue?"
        )
        competency = "collaboration"
    elif category == "publication":
        text = (
            f"For your publication record described as \"{statement}\", what was "
            "your specific contribution, and what evidence best demonstrates its impact?"
        )
        competency = "ownership_leadership"
    elif category == "funding":
        text = (
            f"For the funded work described as \"{statement}\", what did you "
            "personally lead, and what outcome can you substantiate?"
        )
        competency = "ownership_leadership"
    elif category == "verification":
        text = (
            f"The record contains an item requiring clarification: \"{statement}\". "
            "Please explain the facts precisely and point to evidence that can support them."
        )
        competency = "evidence_clarity"
    elif category == "service":
        text = (
            f"For the service role described as \"{statement}\", what did you "
            "contribute personally, and how did it affect the research community?"
        )
        competency = "collaboration"
    else:
        text = (
            f"Please walk us through \"{statement}\" and clarify your personal "
            "contribution, the decisions you made, and the measurable result."
        )
        competency = "ownership_leadership"
    return {
        "text": text,
        "competency": competency,
        "objective": "Clarify personal contribution, evidence, and impact.",
        "why_it_matters": "Tests the depth and ownership behind a material profile claim.",
        "answer_seconds": 90,
        "claim_ids": [claim["claim_id"]],
    }


def _materialize_question(
    raw: dict[str, Any],
    claim_map: dict[str, dict[str, Any]],
    *,
    order: int,
    existing_texts: set[str],
) -> dict[str, Any] | None:
    text = trim_text(raw.get("text"), 1_200)
    raw_ids = raw.get("claim_ids")
    claim_ids = [
        item
        for item in (raw_ids if isinstance(raw_ids, list) else [])
        if isinstance(item, str) and item in claim_map
    ]
    claim_ids = list(dict.fromkeys(claim_ids))
    if not text or not claim_ids or text.lower() in existing_texts:
        return None
    competency = raw.get("competency")
    if competency not in COMPETENCIES:
        competency = "other"
    try:
        answer_seconds = int(raw.get("answer_seconds") or 90)
    except (TypeError, ValueError):
        answer_seconds = 90
    return {
        "question_id": "",
        "order": order,
        "text": text,
        "competency": competency,
        "objective": trim_text(raw.get("objective"), 500),
        "why_it_matters": trim_text(raw.get("why_it_matters"), 500),
        "answer_seconds": min(180, max(45, answer_seconds)),
        "source_claims": [
            {
                "claim_id": claim_id,
                "profile_path": claim_map[claim_id]["profile_path"],
                "category": claim_map[claim_id]["category"],
                "claim": claim_map[claim_id]["statement"],
                "evidence_statuses": claim_map[claim_id]["evidence_statuses"],
                "evidence": claim_map[claim_id]["sources"],
            }
            for claim_id in claim_ids
        ],
    }


def _normalize_questions(
    payload: dict[str, Any],
    claims: list[dict[str, Any]],
    desired_count: int,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    claim_map = {claim["claim_id"]: claim for claim in claims}
    raw_questions = payload.get("questions")
    if not isinstance(raw_questions, list):
        raw_questions = []
    questions: list[dict[str, Any]] = []
    used_claims: set[str] = set()
    for raw in raw_questions:
        if not isinstance(raw, dict):
            continue
        materialized = _materialize_question(
            raw,
            claim_map,
            order=len(questions) + 1,
            existing_texts={item["text"].lower() for item in questions},
        )
        if materialized is None:
            continue
        questions.append(materialized)
        used_claims.update(
            claim["claim_id"] for claim in materialized["source_claims"]
        )
        if len(questions) >= desired_count:
            break

    warnings: list[dict[str, Any]] = []
    fallback_used = False
    if len(questions) < desired_count:
        unused = [claim for claim in claims if claim["claim_id"] not in used_claims]
        fallback_pool = unused or claims
        attempt = 0
        while len(questions) < desired_count and attempt < desired_count * 4:
            claim = fallback_pool[attempt % len(fallback_pool)]
            raw = _fallback_question(
                claim,
                variant=attempt // len(fallback_pool),
            )
            materialized = _materialize_question(
                raw,
                claim_map,
                order=len(questions) + 1,
                existing_texts={item["text"].lower() for item in questions},
            )
            if materialized is not None:
                questions.append(materialized)
                used_claims.add(claim["claim_id"])
                fallback_used = True
            if len(questions) >= desired_count:
                break
            attempt += 1
        if fallback_used:
            warnings.append(
                warning(
                    "question_fallback_used",
                    "question_generation",
                    (
                        "The model returned fewer usable questions than requested; "
                        "the backend added evidence-grounded fallback questions."
                    ),
                    retryable=False,
                    source=None,
                ).as_dict()
            )

    if not questions:
        raise ValueError("question generation produced no usable questions")

    for index, question in enumerate(questions, start=1):
        question["order"] = index
        question["question_id"] = f"q_{index:02d}"
    return questions[:desired_count], warnings


def build_question_set(
    *,
    profile_id: str,
    profile: dict[str, Any],
    role_context: str | None,
    question_count: int = DEFAULT_QUESTION_COUNT,
) -> dict[str, Any]:
    """Generate and normalize a question set without persisting it."""
    desired_count = min(QUESTION_MAX, max(QUESTION_MIN, int(question_count)))
    role_text = trim_text(role_context, 4_000)
    claims = collect_claim_candidates(profile, role_text)
    if not claims:
        raise ValueError("candidate profile contains no usable claims")

    prompt_claims, source_truncated = _fit_claims_to_budget(
        claims,
        SYSTEM_PROMPT,
        role_text,
    )
    user_prompt = (
        f"Target question count: {desired_count}\n"
        f"Optional role context:\n{role_text or 'Not provided.'}\n\n"
        "Candidate claims:\n"
        + json.dumps(prompt_claims, ensure_ascii=False, indent=1)
        + "\n\nReturn the JSON object now."
    )
    while (
        len(SYSTEM_PROMPT) + len(user_prompt) > input_char_budget()
        and len(prompt_claims) > 1
    ):
        prompt_claims = prompt_claims[:-1]
        source_truncated = True
        user_prompt = (
            f"Target question count: {desired_count}\n"
            f"Optional role context:\n{role_text or 'Not provided.'}\n\n"
            "Candidate claims:\n"
            + json.dumps(prompt_claims, ensure_ascii=False, indent=1)
            + "\n\nReturn the JSON object now."
        )
    payload = chat_json(SYSTEM_PROMPT, user_prompt, temperature=0.2)
    questions, warnings = _normalize_questions(payload, claims, desired_count)
    candidate = profile.get("candidate", {})
    basic = candidate.get("basic_info", {}) if isinstance(candidate, dict) else {}
    generation = {
        "model": model_name(),
        "requested_question_count": desired_count,
        "claim_candidates": len(claims),
        "claims_sent_to_model": len(prompt_claims),
        "input_char_budget": input_char_budget(),
        "source_truncated": source_truncated,
    }
    candidate_name = basic.get("name") if isinstance(basic, dict) else None
    document = render_question_document(
        profile_id=profile_id,
        candidate_name=candidate_name,
        role_context=role_text or None,
        questions=questions,
        generation=generation,
    )
    return {
        "questions": questions,
        "warnings": warnings,
        "generation": generation,
        "document_markdown": document,
        "candidate_name": candidate_name,
    }


def render_question_document(
    *,
    profile_id: str,
    candidate_name: str | None,
    role_context: str | None,
    questions: list[dict[str, Any]],
    generation: dict[str, Any],
) -> str:
    lines = [
        "# Candidate Interview Question Set",
        "",
        f"- Candidate: {candidate_name or 'Not provided'}",
        f"- Profile ID: {profile_id}",
        f"- Language: English",
        f"- Questions: {len(questions)}",
    ]
    if role_context:
        lines.extend([f"- Role context: {role_context}", ""])
    else:
        lines.append("")
    lines.extend(
        [
            "## Questions",
            "",
        ]
    )
    for question in questions:
        lines.append(f"### {question['order']}. {question['text']}")
        lines.append("")
        lines.append(f"- Target answer time: {question['answer_seconds']} seconds")
        lines.append(f"- Competency: {question['competency']}")
        if question.get("why_it_matters"):
            lines.append(f"- Why it matters: {question['why_it_matters']}")
        lines.append("- Profile sources:")
        for source_claim in question["source_claims"]:
            statuses = ", ".join(source_claim["evidence_statuses"]) or "none"
            lines.append(
                f"  - {source_claim['claim_id']} "
                f"({source_claim['profile_path']}; evidence: {statuses}): "
                f"{source_claim['claim']}"
            )
        lines.append("")
    lines.extend(
        [
            "## Generation Notes",
            "",
            f"- Model: {generation['model']}",
            "- Generated from the candidate profile; verify any changed facts.",
            "",
        ]
    )
    return "\n".join(lines)
