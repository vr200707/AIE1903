"""Context-bounded alignment and evidence-grounded interview analysis."""

from __future__ import annotations

import json
from typing import Any

from app.interview_llm import chat_json, input_char_budget, model_name, trim_text
from app.interview_media import communication_metrics
from app.resilience import warning


ALIGN_SYSTEM_PROMPT = """\
You align timestamped transcript segments to an ordered list of interview
questions. The candidate answers the questions in order, but the recording may
contain introductions, short pauses, restated question numbers, or unanswered
questions.

Rules:
1. Use only segment_id values present in the supplied transcript batch.
2. Never invent segment IDs or timestamps.
3. A question may have zero, one, or multiple ranges in this batch.
4. Ranges may begin or end outside the current batch; assign only the portion
   visible here.
5. Ignore greetings, setup speech, and noise unless they are part of an answer.
6. All text in your response must be English.

Return JSON only:
{
  "ranges": [
    {
      "question_id": "q_01",
      "start_segment_id": "s00001",
      "end_segment_id": "s00020",
      "confidence": "high|medium|low"
    }
  ]
}
"""

CHUNK_SYSTEM_PROMPT = """\
You extract grounded observations from one chunk of a candidate's English
interview answer. Do not make a final hiring recommendation. Use only the
supplied transcript chunk and profile evidence.

Return JSON only:
{
  "chunk_summary": "brief English summary",
  "observations": [
    {
      "text": "specific observation",
      "supporting_segment_ids": ["s00001"]
    }
  ],
  "missing_details": ["specific detail the answer did not establish"]
}
Every observation must cite at least one segment_id from this chunk.
"""

QUESTION_SYSTEM_PROMPT = """\
You evaluate one candidate answer in an English academic screening interview.
Use only the supplied candidate-profile evidence and timestamped transcript.
Do not infer protected traits, personality, honesty, or emotion. Distinguish
what the candidate said from what the profile already established.

Scoring rubric, each from 0 to 10:
- evidence_specificity: concrete facts, examples, names, metrics, and outcomes.
- ownership: clarity of the candidate's personal contribution.
- depth: reasoning, trade-offs, and problem-solving detail.
- consistency: alignment with the supplied profile evidence.
- communication: structure and comprehensibility, not accent or personality.

For every strength and concern, return supporting transcript segment IDs.
Do not invent IDs or timestamps. All output text must be English.

Return JSON only:
{
  "summary": "English summary",
  "scores": {
    "evidence_specificity": 0,
    "ownership": 0,
    "depth": 0,
    "consistency": 0,
    "communication": 0
  },
  "strengths": [
    {"text": "English finding", "supporting_segment_ids": ["s00001"]}
  ],
  "concerns": [
    {"text": "English finding", "supporting_segment_ids": ["s00001"]}
  ],
  "missing_details": ["specific follow-up detail"],
  "confidence": "high|medium|low"
}
"""

OVERALL_SYSTEM_PROMPT = """\
You synthesize grounded findings from an English screening interview. The input
contains compact per-question results, not the full transcript. Do not create
facts that are absent from those findings. Do not infer protected traits,
personality, honesty, or emotion. Do not produce a hire/no-hire decision.

Return JSON only:
{
  "summary": "concise English synthesis",
  "strengths": [
    {
      "text": "cross-answer strength",
      "question_ids": ["q_01"],
      "supporting_segment_ids": ["s00001"]
    }
  ],
  "risks": [
    {
      "text": "cross-answer evidence gap or inconsistency",
      "question_ids": ["q_02"],
      "supporting_segment_ids": ["s00020"]
    }
  ],
  "recommended_follow_up_questions": ["specific English follow-up question"]
}
All cited IDs must exist in the supplied findings.
"""

SCORE_KEYS = (
    "evidence_specificity",
    "ownership",
    "depth",
    "consistency",
    "communication",
)
CONFIDENCE_VALUES = {"high", "medium", "low"}


def _format_segment(segment: dict[str, Any]) -> str:
    start = segment["start_ms"] / 1000
    end = segment["end_ms"] / 1000
    return (
        f"[{segment['segment_id']} {start:07.2f}-{end:07.2f}] "
        f"{segment['text']}"
    )


def pack_segments(
    segments: list[dict[str, Any]],
    *,
    max_chars: int,
    max_segments: int = 140,
) -> list[list[dict[str, Any]]]:
    """Pack segments without splitting individual transcript segments."""
    batches: list[list[dict[str, Any]]] = []
    current: list[dict[str, Any]] = []
    current_chars = 0
    for segment in segments:
        segment_chars = len(_format_segment(segment)) + 1
        if current and (
            current_chars + segment_chars > max_chars
            or len(current) >= max_segments
        ):
            batches.append(current)
            current = []
            current_chars = 0
        current.append(segment)
        current_chars += segment_chars
    if current:
        batches.append(current)
    return batches


def _question_catalog(question_set: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        {
            "question_id": question["question_id"],
            "order": question["order"],
            "text": question["text"],
            "objective": question.get("objective"),
        }
        for question in question_set["questions"]
    ]


def _expand_range(
    batch: list[dict[str, Any]],
    start_id: Any,
    end_id: Any,
) -> list[dict[str, Any]]:
    ids = [segment["segment_id"] for segment in batch]
    if start_id not in ids or end_id not in ids:
        return []
    start = ids.index(start_id)
    end = ids.index(end_id)
    if start > end:
        start, end = end, start
    return batch[start : end + 1]


def align_answers(
    question_set: dict[str, Any],
    transcript_segments: list[dict[str, Any]],
) -> dict[str, Any]:
    """Assign transcript segments to questions using only model-returned IDs."""
    catalog = _question_catalog(question_set)
    valid_question_ids = {item["question_id"] for item in catalog}
    segment_map = {
        segment["segment_id"]: segment for segment in transcript_segments
    }
    assigned: dict[str, dict[str, dict[str, Any]]] = {
        question_id: {} for question_id in valid_question_ids
    }
    confidence: dict[str, str] = {
        question_id: "low" for question_id in valid_question_ids
    }
    warnings: list[dict[str, Any]] = []

    prompt_overhead = (
        len(ALIGN_SYSTEM_PROMPT)
        + len(json.dumps(catalog, ensure_ascii=False))
        + 2_000
    )
    segment_budget = max(4_000, input_char_budget() - prompt_overhead)
    batches = pack_segments(
        transcript_segments,
        max_chars=segment_budget,
    )
    for batch_index, batch in enumerate(batches, start=1):
        user_prompt = (
            f"Questions:\n{json.dumps(catalog, ensure_ascii=False, indent=1)}\n\n"
            "Transcript batch:\n"
            + "\n".join(_format_segment(segment) for segment in batch)
            + "\n\nReturn the JSON object now."
        )
        try:
            payload = chat_json(ALIGN_SYSTEM_PROMPT, user_prompt, temperature=0)
        except Exception as exc:
            warnings.append(
                warning(
                    "answer_alignment_failed",
                    "alignment",
                    (
                        f"Transcript batch {batch_index} could not be aligned "
                        f"({type(exc).__name__})."
                    ),
                    retryable=True,
                    source=None,
                ).as_dict()
            )
            continue
        ranges = payload.get("ranges")
        if not isinstance(ranges, list):
            continue
        if not ranges:
            warnings.append(
                warning(
                    "no_answer_ranges_in_batch",
                    "alignment",
                    (
                        f"Transcript batch {batch_index} contained speech, but "
                        "no segment range could be aligned to an interview "
                        "question."
                    ),
                    retryable=False,
                    source=None,
                ).as_dict()
            )
            continue
        for item in ranges:
            if not isinstance(item, dict):
                continue
            question_id = item.get("question_id")
            if question_id not in valid_question_ids:
                continue
            matched = _expand_range(
                batch,
                item.get("start_segment_id"),
                item.get("end_segment_id"),
            )
            if not matched:
                continue
            item_confidence = item.get("confidence")
            if item_confidence not in CONFIDENCE_VALUES:
                item_confidence = "low"
            current_confidence = confidence[question_id]
            rank = {"low": 0, "medium": 1, "high": 2}
            if rank[item_confidence] > rank[current_confidence]:
                confidence[question_id] = item_confidence
            for segment in matched:
                assigned[question_id][segment["segment_id"]] = segment

    results: list[dict[str, Any]] = []
    for question in question_set["questions"]:
        question_id = question["question_id"]
        answer_segments = sorted(
            assigned[question_id].values(),
            key=lambda item: item["start_ms"],
        )
        answer_window = None
        if answer_segments:
            answer_window = {
                "start_ms": answer_segments[0]["start_ms"],
                "end_ms": answer_segments[-1]["end_ms"],
            }
            if confidence[question_id] == "high" and len(answer_segments) < 2:
                confidence[question_id] = "medium"
        else:
            confidence[question_id] = "low"
        results.append(
            {
                "question": question,
                "segments": answer_segments,
                "answer_window": answer_window,
                "alignment_confidence": confidence[question_id],
            }
        )

    if not any(item["segments"] for item in results):
        warnings.append(
            warning(
                "no_answer_segments_aligned",
                "alignment",
                (
                    "No transcript segments could be aligned to any interview "
                    "question. Every question is marked unanswered; this usually "
                    "means the recording contained greetings or noise instead of "
                    "audible answers."
                ),
                retryable=False,
                source=None,
            ).as_dict()
        )
    return {"items": results, "warnings": warnings}


def _compact_question_evidence(question: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        {
            "claim_id": claim["claim_id"],
            "profile_path": claim["profile_path"],
            "claim": trim_text(claim.get("claim"), 700),
            "evidence_statuses": claim.get("evidence_statuses", []),
            "evidence": [
                {
                    "source": source.get("source"),
                    "excerpt": trim_text(source.get("excerpt"), 350),
                    "evidence_status": source.get("evidence_status"),
                }
                for source in claim.get("evidence", [])[:3]
            ],
        }
        for claim in question.get("source_claims", [])
    ]


def _normalize_score(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return round(min(10.0, max(0.0, float(value))), 1)


def _ground_items(
    raw_items: Any,
    segment_map: dict[str, dict[str, Any]],
    *,
    field_name: str,
    warnings: list[dict[str, Any]],
    question_id: str,
) -> list[dict[str, Any]]:
    grounded: list[dict[str, Any]] = []
    if not isinstance(raw_items, list):
        return grounded
    dropped = 0
    for item in raw_items[:8]:
        if not isinstance(item, dict):
            continue
        text = trim_text(item.get("text"), 600)
        ids = item.get("supporting_segment_ids")
        valid_ids = [
            segment_id
            for segment_id in (ids if isinstance(ids, list) else [])
            if isinstance(segment_id, str) and segment_id in segment_map
        ]
        valid_ids = list(dict.fromkeys(valid_ids))[:4]
        if not text:
            continue
        if not valid_ids:
            dropped += 1
            continue
        grounded.append(
            {
                "text": text,
                "supporting_segments": [
                    {
                        "segment_id": segment_id,
                        "start_ms": segment_map[segment_id]["start_ms"],
                        "end_ms": segment_map[segment_id]["end_ms"],
                        "text": segment_map[segment_id]["text"],
                    }
                    for segment_id in valid_ids
                ],
            }
        )
    if dropped:
        warnings.append(
            warning(
                "ungrounded_analysis_dropped",
                "question_analysis",
                (
                    f"Dropped {dropped} {field_name} item(s) for {question_id} "
                    "because the model did not cite valid transcript segments."
                ),
                retryable=False,
                source=question_id,
            ).as_dict()
        )
    return grounded


def _chunk_answer_observations(
    question: dict[str, Any],
    evidence: list[dict[str, Any]],
    segments: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    fixed_overhead = (
        len(CHUNK_SYSTEM_PROMPT)
        + len(question["text"])
        + len(json.dumps(evidence, ensure_ascii=False))
        + 2_000
    )
    segment_budget = max(2_800, input_char_budget() - fixed_overhead)
    batches = pack_segments(segments, max_chars=segment_budget, max_segments=90)
    summaries: list[dict[str, Any]] = []
    for index, batch in enumerate(batches, start=1):
        user_prompt = (
            f"Question:\n{question['text']}\n\n"
            f"Profile evidence:\n{json.dumps(evidence, ensure_ascii=False, indent=1)}"
            "\n\nTranscript chunk:\n"
            + "\n".join(_format_segment(segment) for segment in batch)
            + f"\n\nThis is chunk {index} of {len(batches)}. Return JSON now."
        )
        payload = chat_json(CHUNK_SYSTEM_PROMPT, user_prompt, temperature=0)
        batch_ids = {segment["segment_id"] for segment in batch}
        observations = []
        for item in payload.get("observations") or []:
            if not isinstance(item, dict):
                continue
            text = trim_text(item.get("text"), 500)
            ids = item.get("supporting_segment_ids")
            valid_ids = [
                segment_id
                for segment_id in (ids if isinstance(ids, list) else [])
                if isinstance(segment_id, str) and segment_id in batch_ids
            ]
            if text and valid_ids:
                observations.append(
                    {
                        "text": text,
                        "supporting_segment_ids": list(dict.fromkeys(valid_ids))[:4],
                    }
                )
        summaries.append(
            {
                "chunk": index,
                "summary": trim_text(payload.get("chunk_summary"), 600),
                "observations": observations[:8],
                "missing_details": [
                    trim_text(item, 300)
                    for item in (payload.get("missing_details") or [])
                    if isinstance(item, str)
                ][:6],
            }
        )
    return summaries


def _empty_question_result(
    question: dict[str, Any],
    answer_window: dict[str, int] | None,
    alignment_confidence: str,
) -> dict[str, Any]:
    return {
        "question_id": question["question_id"],
        "order": question["order"],
        "question": question["text"],
        "competency": question["competency"],
        "answer_window": answer_window,
        "alignment_confidence": alignment_confidence,
        "answered": False,
        "transcript_segments": [],
        "summary": "No answer segment was detected for this question.",
        "scores": {key: None for key in SCORE_KEYS},
        "score_overall": None,
        "strengths": [],
        "concerns": [],
        "missing_details": ["The recording did not yield a locatable answer."],
        "confidence": "low",
    }


def analyze_question(
    question: dict[str, Any],
    segments: list[dict[str, Any]],
    answer_window: dict[str, int] | None,
    alignment_confidence: str,
    *,
    role_context: str | None,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    if not segments:
        return (
            _empty_question_result(question, answer_window, alignment_confidence),
            [],
        )
    segment_map = {segment["segment_id"]: segment for segment in segments}
    evidence = _compact_question_evidence(question)
    warnings: list[dict[str, Any]] = []
    full_transcript = "\n".join(_format_segment(segment) for segment in segments)
    fixed_overhead = (
        len(QUESTION_SYSTEM_PROMPT)
        + len(question["text"])
        + len(json.dumps(evidence, ensure_ascii=False))
        + len(role_context or "")
        + 2_000
    )
    full_budget = input_char_budget() - fixed_overhead
    if len(full_transcript) <= full_budget:
        transcript_payload: Any = full_transcript
    else:
        try:
            transcript_payload = _chunk_answer_observations(
                question,
                evidence,
                segments,
            )
            warnings.append(
                warning(
                    "answer_context_map_reduce",
                    "question_analysis",
                    (
                        f"Long answer for {question['question_id']} was processed "
                        "in bounded chunks and then synthesized."
                    ),
                    retryable=False,
                    source=question["question_id"],
                ).as_dict()
            )
        except Exception as exc:
            warnings.append(
                warning(
                    "answer_chunk_analysis_failed",
                    "question_analysis",
                    (
                        f"Chunked analysis failed for {question['question_id']} "
                        f"({type(exc).__name__})."
                    ),
                    retryable=True,
                    source=question["question_id"],
                ).as_dict()
            )
            transcript_payload = full_transcript[
                : max(0, min(len(full_transcript), full_budget))
            ]

    user_prompt = (
        f"Question:\n{question['text']}\n\n"
        f"Optional role context:\n{role_context or 'Not provided.'}\n\n"
        f"Profile evidence:\n{json.dumps(evidence, ensure_ascii=False, indent=1)}\n\n"
        "Answer transcript or bounded chunk observations:\n"
        + (
            transcript_payload
            if isinstance(transcript_payload, str)
            else json.dumps(transcript_payload, ensure_ascii=False, indent=1)
        )
        + "\n\nReturn the JSON object now."
    )
    try:
        payload = chat_json(QUESTION_SYSTEM_PROMPT, user_prompt, temperature=0.1)
    except Exception as exc:
        warnings.append(
            warning(
                "question_analysis_failed",
                "question_analysis",
                (
                    f"DeepSeek analysis failed for {question['question_id']} "
                    f"({type(exc).__name__})."
                ),
                retryable=True,
                source=question["question_id"],
            ).as_dict()
        )
        result = _empty_question_result(
            question,
            answer_window,
            alignment_confidence,
        )
        result["answered"] = True
        result["transcript_segments"] = segments
        result["summary"] = (
            "Transcript is available, but the model analysis could not be completed."
        )
        return result, warnings

    scores_raw = payload.get("scores")
    scores = {
        key: _normalize_score(
            scores_raw.get(key) if isinstance(scores_raw, dict) else None
        )
        for key in SCORE_KEYS
    }
    numeric_scores = [value for value in scores.values() if value is not None]
    score_overall = (
        round(sum(numeric_scores) / len(numeric_scores), 1)
        if numeric_scores
        else None
    )
    strengths = _ground_items(
        payload.get("strengths"),
        segment_map,
        field_name="strength",
        warnings=warnings,
        question_id=question["question_id"],
    )
    concerns = _ground_items(
        payload.get("concerns"),
        segment_map,
        field_name="concern",
        warnings=warnings,
        question_id=question["question_id"],
    )
    missing_details = [
        trim_text(item, 400)
        for item in (payload.get("missing_details") or [])
        if isinstance(item, str)
    ][:8]
    confidence = payload.get("confidence")
    if confidence not in CONFIDENCE_VALUES:
        confidence = "low"
    if not strengths and not concerns:
        confidence = "low"
    if alignment_confidence == "low" and confidence == "high":
        confidence = "medium"
    result = {
        "question_id": question["question_id"],
        "order": question["order"],
        "question": question["text"],
        "competency": question["competency"],
        "answer_window": answer_window,
        "alignment_confidence": alignment_confidence,
        "answered": True,
        "transcript_segments": segments,
        "summary": trim_text(payload.get("summary"), 1_000),
        "scores": scores,
        "score_overall": score_overall,
        "strengths": strengths,
        "concerns": concerns,
        "missing_details": missing_details,
        "confidence": confidence,
    }
    return result, warnings


def _fit_overall_input(results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    budget = max(6_000, input_char_budget() - len(OVERALL_SYSTEM_PROMPT) - 2_000)
    for limit in (600, 300, 160, 80):
        compact = []
        for result in results:
            compact.append(
                {
                    "question_id": result["question_id"],
                    "question": trim_text(result["question"], limit),
                    "summary": trim_text(result["summary"], limit),
                    "scores": result["scores"],
                    "confidence": result["confidence"],
                    "strengths": [
                        {
                            "text": trim_text(item["text"], limit),
                            "segment_ids": [
                                segment["segment_id"]
                                for segment in item["supporting_segments"]
                            ],
                        }
                        for item in result["strengths"][:3]
                    ],
                    "concerns": [
                        {
                            "text": trim_text(item["text"], limit),
                            "segment_ids": [
                                segment["segment_id"]
                                for segment in item["supporting_segments"]
                            ],
                        }
                        for item in result["concerns"][:3]
                    ],
                }
            )
        if len(json.dumps(compact, ensure_ascii=False)) <= budget:
            return compact
    return compact


def _ground_overall_items(
    raw_items: Any,
    question_ids: set[str],
    segment_map: dict[str, dict[str, Any]],
    segment_question_ids: dict[str, set[str]],
) -> list[dict[str, Any]]:
    grounded: list[dict[str, Any]] = []
    if not isinstance(raw_items, list):
        return grounded
    for item in raw_items[:8]:
        if not isinstance(item, dict):
            continue
        text = trim_text(item.get("text"), 700)
        qids = [
            value
            for value in (item.get("question_ids") or [])
            if isinstance(value, str) and value in question_ids
        ]
        sids = [
            value
            for value in (item.get("supporting_segment_ids") or [])
            if isinstance(value, str) and value in segment_map
        ]
        sids = [
            segment_id
            for segment_id in sids
            if segment_question_ids.get(segment_id, set()) & set(qids)
        ]
        if not text or not qids or not sids:
            continue
        grounded.append(
            {
                "text": text,
                "question_ids": list(dict.fromkeys(qids)),
                "supporting_segments": [
                    {
                        "segment_id": segment_id,
                        "start_ms": segment_map[segment_id]["start_ms"],
                        "end_ms": segment_map[segment_id]["end_ms"],
                        "text": segment_map[segment_id]["text"],
                    }
                    for segment_id in list(dict.fromkeys(sids))[:5]
                ],
            }
        )
    return grounded


def build_overall_report(
    question_results: list[dict[str, Any]],
    transcript_segments: list[dict[str, Any]],
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    warnings: list[dict[str, Any]] = []
    compact = _fit_overall_input(question_results)
    user_prompt = (
        "Per-question findings:\n"
        + json.dumps(compact, ensure_ascii=False, indent=1)
        + "\n\nReturn the JSON object now."
    )
    question_ids = {item["question_id"] for item in question_results}
    segment_map = {
        segment["segment_id"]: segment for segment in transcript_segments
    }
    segment_question_ids: dict[str, set[str]] = {}
    for result in question_results:
        for segment in result["transcript_segments"]:
            segment_question_ids.setdefault(segment["segment_id"], set()).add(
                result["question_id"]
            )
    try:
        payload = chat_json(OVERALL_SYSTEM_PROMPT, user_prompt, temperature=0.1)
        overall = {
            "summary": trim_text(payload.get("summary"), 1_500),
            "strengths": _ground_overall_items(
                payload.get("strengths"),
                question_ids,
                segment_map,
                segment_question_ids,
            ),
            "risks": _ground_overall_items(
                payload.get("risks"),
                question_ids,
                segment_map,
                segment_question_ids,
            ),
            "recommended_follow_up_questions": [
                trim_text(item, 500)
                for item in (
                    payload.get("recommended_follow_up_questions") or []
                )
                if isinstance(item, str)
            ][:8],
        }
    except Exception as exc:
        warnings.append(
            warning(
                "overall_analysis_failed",
                "overall_analysis",
                (
                    "The overall synthesis failed "
                    f"({type(exc).__name__}); per-question findings are retained."
                ),
                retryable=True,
                source=None,
            ).as_dict()
        )
        overall = {
            "summary": (
                "Overall synthesis was unavailable. Review the grounded "
                "per-question findings below."
            ),
            "strengths": [],
            "risks": [],
            "recommended_follow_up_questions": [],
        }
    return overall, warnings


def build_communication_profile(
    transcript: dict[str, Any],
    question_results: list[dict[str, Any]],
) -> dict[str, Any]:
    segments = transcript["segments"]
    duration_ms = transcript["duration_ms"]
    metrics = communication_metrics(
        segments,
        duration_ms,
        transcript.get("audio_features"),
    )
    answered = sum(1 for item in question_results if item["answered"])
    total = len(question_results)
    metrics["answered_questions"] = answered
    metrics["question_count"] = total
    metrics["coverage_ratio"] = round(answered / total, 3) if total else 0.0

    interpretations: list[dict[str, Any]] = []
    rate = metrics.get("articulation_rate_wpm")
    if rate is not None:
        if rate < 105:
            level = "slow"
        elif rate < 145:
            level = "balanced"
        elif rate < 175:
            level = "fast"
        else:
            level = "very_fast"
        interpretations.append(
            {
                "dimension": "pacing",
                "level": level,
                "observation": (
                    f"Measured articulation rate is {rate} words per minute."
                ),
                "confidence": "medium",
            }
        )
    pause_count = metrics["long_pause_count"]
    interpretations.append(
        {
            "dimension": "pausing",
            "level": "frequent" if pause_count >= 8 else "typical",
            "observation": (
                f"{pause_count} pauses of at least 700 ms were detected between "
                "transcript segments."
            ),
            "confidence": "medium",
        }
    )
    filler_rate = metrics["filler_rate_per_100_words"]
    interpretations.append(
        {
            "dimension": "disfluency",
            "level": "elevated" if filler_rate >= 3 else "limited",
            "observation": (
                f"Explicit filler words account for {filler_rate} per 100 spoken words."
            ),
            "confidence": "medium",
        }
    )
    if metrics["coverage_ratio"] < 1:
        interpretations.append(
            {
                "dimension": "coverage",
                "level": "incomplete",
                "observation": (
                    f"Locatable answers were found for {answered} of {total} questions."
                ),
                "confidence": "high",
            }
        )
    return {
        "metrics": metrics,
        "interpretations": interpretations,
        "caveats": [
            "Measurements reflect this recording only and are not personality or ability scores.",
            "Automatic transcription and answer-boundary detection can be imperfect.",
            "Visual behavior was intentionally not analyzed in this release.",
        ],
    }


def analyze_interview(
    question_set: dict[str, Any],
    transcript: dict[str, Any],
    alignment: dict[str, Any],
) -> dict[str, Any]:
    results: list[dict[str, Any]] = []
    warnings = list(alignment.get("warnings", []))
    for item in alignment["items"]:
        question = item["question"]
        try:
            result, item_warnings = analyze_question(
                question,
                item["segments"],
                item["answer_window"],
                item["alignment_confidence"],
                role_context=question_set.get("role_context"),
            )
        except Exception as exc:
            result = _empty_question_result(
                question,
                item["answer_window"],
                item["alignment_confidence"],
            )
            result["answered"] = bool(item["segments"])
            result["transcript_segments"] = item["segments"]
            item_warnings = [
                warning(
                    "question_analysis_crashed",
                    "question_analysis",
                    (
                        f"Analysis for {question['question_id']} failed "
                        f"({type(exc).__name__})."
                    ),
                    retryable=True,
                    source=question["question_id"],
                ).as_dict()
            ]
        results.append(result)
        warnings.extend(item_warnings)

    overall, overall_warnings = build_overall_report(
        results,
        transcript["segments"],
    )
    warnings.extend(overall_warnings)
    timestamp_inventory = [
        {
            "question_id": result["question_id"],
            "order": result["order"],
            "answered": result["answered"],
            "start_ms": (result["answer_window"] or {}).get("start_ms"),
            "end_ms": (result["answer_window"] or {}).get("end_ms"),
            "alignment_confidence": result["alignment_confidence"],
            "segment_ids": [
                segment["segment_id"]
                for segment in result["transcript_segments"]
            ],
            "profile_paths": [
                claim["profile_path"]
                for claim in next(
                    item["question"]
                    for item in alignment["items"]
                    if item["question"]["question_id"] == result["question_id"]
                )["source_claims"]
            ],
        }
        for result in results
    ]
    return {
        "schema_version": "1.0.0",
        "question_set_id": question_set["question_set_id"],
        "language": "en",
        "analysis_model": model_name(),
        "overall_report": overall,
        "question_results": results,
        "timestamp_inventory": timestamp_inventory,
        "communication_profile": build_communication_profile(transcript, results),
        "warnings": warnings,
    }
