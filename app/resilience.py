"""Small shared types and helpers for non-fatal analysis warnings."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Iterator


@dataclass(frozen=True)
class AnalysisWarning:
    code: str
    stage: str
    message: str
    retryable: bool
    source: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def warning(
    code: str,
    stage: str,
    message: str,
    *,
    retryable: bool,
    source: str | None = None,
) -> AnalysisWarning:
    return AnalysisWarning(
        code=code,
        stage=stage,
        message=message,
        retryable=retryable,
        source=source,
    )


def _iter_evidence(node: Any) -> Iterator[dict[str, Any]]:
    if isinstance(node, dict):
        if {"source", "evidence", "evidence_status", "query_date"}.issubset(node):
            yield node
            return
        for value in node.values():
            yield from _iter_evidence(value)
    elif isinstance(node, list):
        for value in node:
            yield from _iter_evidence(value)


def collect_retryable_verification_warnings(
    profile: dict[str, Any],
) -> list[AnalysisWarning]:
    """Summarize per-claim provider failures already attached to evidence."""
    failed_claims = 0
    providers: set[str] = set()
    for evidence in _iter_evidence(profile.get("candidate", {})):
        notes = evidence.get("notes")
        if (
            evidence.get("evidence_status") == "to_verify"
            and isinstance(notes, str)
            and "Retryable: yes" in notes
        ):
            failed_claims += 1
            providers.add(str(evidence.get("source") or "ExternalVerifier"))

    if not failed_claims:
        return []
    provider_text = ", ".join(sorted(providers))
    return [
        warning(
            "verification_dependency_failed",
            "verification",
            (
                f"{failed_claims} claim check(s) could not complete because "
                f"{provider_text} was unavailable. Affected claims are marked "
                "to_verify. Retry the analysis when the services recover."
            ),
            retryable=True,
        )
    ]
