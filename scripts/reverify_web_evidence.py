"""Re-run only WebSearch evidence for persisted candidate profiles.

This migration does not call the extraction model and does not re-check
publications. It removes old WebSearch entries, builds precise queries, applies
the relevance gate, and writes the updated profile snapshot atomically.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PROFILE_DIR = PROJECT_ROOT / ".cache" / "profiles"

if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app.verify import reverify_web_claims


def _matches(
    payload: dict[str, Any],
    *,
    upload_id: str | None,
    profile_id: str | None,
    candidate_name: str | None,
) -> bool:
    if upload_id and payload.get("upload_id") != upload_id:
        return False
    if profile_id and payload.get("profile_id") != profile_id:
        return False
    if candidate_name:
        candidate = (payload.get("profile") or {}).get("candidate") or {}
        actual = str((candidate.get("basic_info") or {}).get("name") or "")
        if candidate_name.casefold() not in actual.casefold():
            return False
    return True


def _write_atomic(path: Path, payload: dict[str, Any]) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(payload, ensure_ascii=False),
        encoding="utf-8",
    )
    os.replace(temporary, path)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Re-run strict WebSearch verification for cached profiles."
    )
    parser.add_argument("--profile-dir", type=Path, default=DEFAULT_PROFILE_DIR)
    parser.add_argument("--upload-id")
    parser.add_argument("--profile-id")
    parser.add_argument("--name")
    parser.add_argument(
        "--all",
        action="store_true",
        help="Process every cached profile when no narrower selector is supplied.",
    )
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if not any((args.upload_id, args.profile_id, args.name, args.all)):
        parser.error("provide --upload-id, --profile-id, --name, or --all")
    if not args.profile_dir.exists():
        parser.error(f"profile directory does not exist: {args.profile_dir}")

    matched = 0
    updated = 0
    for path in sorted(args.profile_dir.glob("*.json")):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            print(f"SKIP {path.name}: {type(exc).__name__}")
            continue
        if not isinstance(payload, dict):
            continue
        if not _matches(
            payload,
            upload_id=args.upload_id,
            profile_id=args.profile_id,
            candidate_name=args.name,
        ):
            continue

        matched += 1
        profile = payload.get("profile")
        if not isinstance(profile, dict):
            print(f"SKIP {path.name}: no profile snapshot")
            continue
        candidate = (profile.get("candidate") or {}).get("basic_info") or {}
        name = candidate.get("name") or "Unknown candidate"
        print(f"MATCH {path.name}: {name}")
        if args.dry_run:
            continue

        payload["profile"] = reverify_web_claims(profile)
        _write_atomic(path, payload)
        updated += 1
        print(f"UPDATED {path.name}")

    print(f"Matched {matched} profile(s); updated {updated}.")
    return 0 if matched else 1


if __name__ == "__main__":
    raise SystemExit(main())
