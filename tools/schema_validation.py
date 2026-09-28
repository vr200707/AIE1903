from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Sequence

from jsonschema import Draft202012Validator, FormatChecker
from jsonschema.exceptions import SchemaError, ValidationError


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SCHEMA_PATH = PROJECT_ROOT / "docs" / "schema.json"


@dataclass(frozen=True)
class ValidationIssue:
    path: str
    message: str


@dataclass(frozen=True)
class ValidationResult:
    errors: tuple[ValidationIssue, ...]
    warnings: tuple[ValidationIssue, ...]

    @property
    def valid(self) -> bool:
        return not self.errors


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def build_validator(
    schema: dict[str, Any],
) -> Draft202012Validator:
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema, format_checker=FormatChecker())


def validate_instance(
    instance: Any,
    schema_path: Path = DEFAULT_SCHEMA_PATH,
) -> ValidationResult:
    schema = load_json(schema_path)
    validator = build_validator(schema)

    errors = tuple(
        sorted(
            (_to_issue(error) for error in validator.iter_errors(instance)),
            key=lambda issue: (issue.path, issue.message),
        )
    )
    warnings = tuple(
        sorted(
            set(_iter_semantic_warnings(instance)),
            key=lambda issue: (issue.path, issue.message),
        )
    )
    return ValidationResult(errors=errors, warnings=warnings)


def _to_issue(error: ValidationError) -> ValidationIssue:
    return ValidationIssue(
        path=_format_path(error.absolute_path),
        message=error.message,
    )


def _format_path(parts: Iterable[object]) -> str:
    path = "$"
    for part in parts:
        if isinstance(part, int):
            path += f"[{part}]"
        else:
            path += f".{part}"
    return path


def _iter_semantic_warnings(
    value: Any,
    path: tuple[object, ...] = (),
) -> Iterable[ValidationIssue]:
    if isinstance(value, dict):
        evidence = value.get("evidence")
        if isinstance(evidence, list):
            has_conflict = any(
                isinstance(item, dict)
                and item.get("evidence_status") == "conflict"
                for item in evidence
            )
            if has_conflict and len(evidence) < 2:
                yield ValidationIssue(
                    path=_format_path((*path, "evidence")),
                    message=(
                        "conflict evidence has fewer than two entries; "
                        "review for contradictory sources"
                    ),
                )

        if (
            value.get("evidence_status") == "not_found_public"
            and value.get("source_url") is not None
        ):
            yield ValidationIssue(
                path=_format_path((*path, "source_url")),
                message=(
                    "not_found_public should use source_url=null and describe "
                    "the search conclusion in evidence"
                ),
            )

        for key, child in value.items():
            yield from _iter_semantic_warnings(child, (*path, key))
    elif isinstance(value, list):
        for index, child in enumerate(value):
            yield from _iter_semantic_warnings(child, (*path, index))


def _print_issues(label: str, issues: Sequence[ValidationIssue]) -> None:
    for issue in issues:
        print(f"{label} {issue.path}: {issue.message}")


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Validate candidate profiles against docs/schema.json."
    )
    parser.add_argument(
        "--schema",
        type=Path,
        default=DEFAULT_SCHEMA_PATH,
        help="Path to the JSON Schema contract.",
    )
    parser.add_argument(
        "instances",
        nargs="*",
        type=Path,
        help="Candidate profile JSON files to validate.",
    )
    args = parser.parse_args(argv)

    try:
        schema = load_json(args.schema)
        build_validator(schema)
    except (OSError, json.JSONDecodeError, SchemaError) as error:
        print(f"SCHEMA ERROR: {error}")
        return 2

    print(f"SCHEMA OK: {args.schema}")
    if not args.instances:
        return 0

    exit_code = 0
    for instance_path in args.instances:
        try:
            result = validate_instance(load_json(instance_path), args.schema)
        except (OSError, json.JSONDecodeError) as error:
            print(f"INSTANCE ERROR {instance_path}: {error}")
            exit_code = 2
            continue

        status = "VALID" if result.valid else "INVALID"
        print(f"{status}: {instance_path}")
        _print_issues("ERROR", result.errors)
        _print_issues("WARNING", result.warnings)
        if not result.valid:
            exit_code = 1

    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
