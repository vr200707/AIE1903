"""SQLite-backed storage for interview question sets and reports."""

from __future__ import annotations

import json
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator
from uuid import uuid4


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _id(prefix: str) -> str:
    return prefix + uuid4().hex[:12]


_MISSING = object()


def _normalize_questions(
    questions: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Fill in per-question defaults so old rows match the current contract."""
    return [
        {**question, "approved": bool(question.get("approved", False))}
        for question in questions
    ]


class InterviewStore:
    """Small local store suitable for the current single-process demo."""

    def __init__(self, root: Path) -> None:
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.video_root = self.root / "videos"
        self.video_root.mkdir(parents=True, exist_ok=True)
        self.db_path = self.root / "interview.sqlite3"
        self._lock = threading.RLock()
        self._initialize()

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self.db_path, timeout=30)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        try:
            yield connection
            connection.commit()
        finally:
            connection.close()

    def _initialize(self) -> None:
        with self._connect() as connection:
            connection.execute("PRAGMA journal_mode = WAL")
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS question_sets (
                    id TEXT PRIMARY KEY,
                    profile_id TEXT NOT NULL,
                    profile_snapshot TEXT NOT NULL,
                    language TEXT NOT NULL,
                    role_context TEXT,
                    candidate_name TEXT,
                    status TEXT NOT NULL DEFAULT 'draft',
                    candidate_token TEXT,
                    questions_json TEXT NOT NULL,
                    document_markdown TEXT NOT NULL,
                    generation_json TEXT NOT NULL,
                    warnings_json TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS interviews (
                    id TEXT PRIMARY KEY,
                    question_set_id TEXT NOT NULL,
                    status TEXT NOT NULL,
                    stage TEXT NOT NULL,
                    progress_json TEXT NOT NULL,
                    video_json TEXT,
                    video_path TEXT,
                    transcript_json TEXT,
                    report_json TEXT,
                    warnings_json TEXT NOT NULL,
                    error_json TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    FOREIGN KEY(question_set_id)
                        REFERENCES question_sets(id)
                        ON DELETE CASCADE
                );

                CREATE INDEX IF NOT EXISTS idx_interviews_question_set
                    ON interviews(question_set_id);
                """
            )
            columns = {
                row["name"]
                for row in connection.execute(
                    "PRAGMA table_info(question_sets)"
                ).fetchall()
            }
            if "status" not in columns:
                connection.execute(
                    "ALTER TABLE question_sets "
                    "ADD COLUMN status TEXT NOT NULL DEFAULT 'draft'"
                )
            if "candidate_token" not in columns:
                connection.execute(
                    "ALTER TABLE question_sets ADD COLUMN candidate_token TEXT"
                )

    def create_question_set(
        self,
        *,
        profile_id: str,
        profile_snapshot: dict[str, Any],
        language: str,
        role_context: str | None,
        candidate_name: str | None,
        questions: list[dict[str, Any]],
        document_markdown: str,
        generation: dict[str, Any],
        warnings: list[dict[str, Any]],
    ) -> dict[str, Any]:
        question_set_id = _id("qset_")
        created_at = _now()
        with self._lock, self._connect() as connection:
            connection.execute(
                """
                INSERT INTO question_sets (
                    id, profile_id, profile_snapshot, language, role_context,
                    candidate_name, questions_json, document_markdown,
                    generation_json, warnings_json, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    question_set_id,
                    profile_id,
                    json.dumps(profile_snapshot, ensure_ascii=False),
                    language,
                    role_context,
                    candidate_name,
                    json.dumps(questions, ensure_ascii=False),
                    document_markdown,
                    json.dumps(generation, ensure_ascii=False),
                    json.dumps(warnings, ensure_ascii=False),
                    created_at,
                ),
            )
        return {
            "schema_version": "1.0.0",
            "question_set_id": question_set_id,
            "profile_id": profile_id,
            "status": "draft",
            "candidate_token": None,
            "language": language,
            "role_context": role_context,
            "candidate_name": candidate_name,
            "questions": _normalize_questions(questions),
            "generation": generation,
            "warnings": warnings,
            "created_at": created_at,
        }

    def get_question_set(self, question_set_id: str) -> dict[str, Any] | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM question_sets WHERE id = ?",
                (question_set_id,),
            ).fetchone()
        if row is None:
            return None
        return {
            "schema_version": "1.0.0",
            "question_set_id": row["id"],
            "profile_id": row["profile_id"],
            "status": row["status"],
            "candidate_token": row["candidate_token"],
            "language": row["language"],
            "role_context": row["role_context"],
            "candidate_name": row["candidate_name"],
            "questions": _normalize_questions(json.loads(row["questions_json"])),
            "generation": json.loads(row["generation_json"]),
            "warnings": json.loads(row["warnings_json"]),
            "created_at": row["created_at"],
        }

    def get_question_set_by_token(
        self,
        candidate_token: str,
    ) -> dict[str, Any] | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT id FROM question_sets WHERE candidate_token = ?",
                (candidate_token,),
            ).fetchone()
        if row is None:
            return None
        return self.get_question_set(str(row["id"]))

    def set_publish_state(
        self,
        question_set_id: str,
        *,
        published: bool,
        candidate_token: str | None = None,
    ) -> dict[str, Any] | None:
        with self._lock, self._connect() as connection:
            cursor = connection.execute(
                """
                UPDATE question_sets
                SET status = ?, candidate_token = COALESCE(?, candidate_token)
                WHERE id = ?
                """,
                (
                    "published" if published else "draft",
                    candidate_token if published else None,
                    question_set_id,
                ),
            )
        if cursor.rowcount == 0:
            return None
        return self.get_question_set(question_set_id)

    def get_question_document(self, question_set_id: str) -> str | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT document_markdown FROM question_sets WHERE id = ?",
                (question_set_id,),
            ).fetchone()
        return None if row is None else str(row["document_markdown"])

    def has_submitted_interview(self, question_set_id: str) -> bool:
        """Return True when the question set already has a submitted session.

        Merely starting the interview (status ``created``) does not lock the
        questions.  Locking starts once a video has been uploaded or a report
        has been generated, so questions stay editable until the user actually
        submits something.
        """
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT 1 FROM interviews
                WHERE question_set_id = ?
                  AND (video_json IS NOT NULL OR report_json IS NOT NULL)
                LIMIT 1
                """,
                (question_set_id,),
            ).fetchone()
        return row is not None

    def replace_question_set_questions(
        self,
        question_set_id: str,
        questions: list[dict[str, Any]],
        document_markdown: str,
    ) -> dict[str, Any] | None:
        with self._lock, self._connect() as connection:
            cursor = connection.execute(
                """
                UPDATE question_sets
                SET questions_json = ?, document_markdown = ?
                WHERE id = ?
                """,
                (
                    json.dumps(questions, ensure_ascii=False),
                    document_markdown,
                    question_set_id,
                ),
            )
        if cursor.rowcount == 0:
            return None
        return self.get_question_set(question_set_id)

    def create_interview(self, question_set_id: str) -> dict[str, Any] | None:
        if self.get_question_set(question_set_id) is None:
            return None
        with self._lock, self._connect() as connection:
            existing = connection.execute(
                """
                SELECT id FROM interviews
                WHERE question_set_id = ?
                  AND video_json IS NULL
                  AND report_json IS NULL
                ORDER BY created_at DESC, rowid DESC
                LIMIT 1
                """,
                (question_set_id,),
            ).fetchone()
        if existing is not None:
            # Reuse an untouched session instead of piling up empty rows.
            return self.get_interview(existing["id"])
        interview_id = _id("int_")
        created_at = _now()
        with self._lock, self._connect() as connection:
            connection.execute(
                """
                INSERT INTO interviews (
                    id, question_set_id, status, stage, progress_json,
                    warnings_json, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    interview_id,
                    question_set_id,
                    "created",
                    "created",
                    json.dumps({"done": 0, "total": 0}),
                    "[]",
                    created_at,
                    created_at,
                ),
            )
        return self.get_interview(interview_id)

    def get_interview(self, interview_id: str) -> dict[str, Any] | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM interviews WHERE id = ?",
                (interview_id,),
            ).fetchone()
        if row is None:
            return None
        video = json.loads(row["video_json"]) if row["video_json"] else None
        return {
            "schema_version": "1.0.0",
            "interview_id": row["id"],
            "question_set_id": row["question_set_id"],
            "status": row["status"],
            "stage": row["stage"],
            "progress": json.loads(row["progress_json"]),
            "video": video,
            "warnings": json.loads(row["warnings_json"]),
            "error": json.loads(row["error_json"]) if row["error_json"] else None,
            "has_report": bool(row["report_json"]),
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }

    def update_interview(
        self,
        interview_id: str,
        *,
        status: str | None = None,
        stage: str | None = None,
        progress: dict[str, Any] | None = None,
        video: dict[str, Any] | None = None,
        video_path: str | None = None,
        transcript: dict[str, Any] | None = None,
        report: dict[str, Any] | None = None,
        warnings: list[dict[str, Any]] | None = None,
        error: dict[str, Any] | None | object = _MISSING,
    ) -> dict[str, Any] | None:
        assignments = ["updated_at = ?"]
        values: list[Any] = [_now()]
        if status is not None:
            assignments.append("status = ?")
            values.append(status)
        if stage is not None:
            assignments.append("stage = ?")
            values.append(stage)
        if progress is not None:
            assignments.append("progress_json = ?")
            values.append(json.dumps(progress, ensure_ascii=False))
        if video is not None:
            assignments.append("video_json = ?")
            values.append(json.dumps(video, ensure_ascii=False))
        if video_path is not None:
            assignments.append("video_path = ?")
            values.append(video_path)
        if transcript is not None:
            assignments.append("transcript_json = ?")
            values.append(json.dumps(transcript, ensure_ascii=False))
        if report is not None:
            assignments.append("report_json = ?")
            values.append(json.dumps(report, ensure_ascii=False))
        if warnings is not None:
            assignments.append("warnings_json = ?")
            values.append(json.dumps(warnings, ensure_ascii=False))
        if error is not _MISSING:
            assignments.append("error_json = ?")
            values.append(
                None if error is None else json.dumps(error, ensure_ascii=False)
            )
        values.append(interview_id)
        with self._lock, self._connect() as connection:
            connection.execute(
                f"UPDATE interviews SET {', '.join(assignments)} WHERE id = ?",
                tuple(values),
            )
        return self.get_interview(interview_id)

    def get_video_path(self, interview_id: str) -> Path | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT video_path FROM interviews WHERE id = ?",
                (interview_id,),
            ).fetchone()
        if row is None or not row["video_path"]:
            return None
        path = Path(row["video_path"])
        return path if path.exists() else None

    def get_transcript(self, interview_id: str) -> dict[str, Any] | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT transcript_json FROM interviews WHERE id = ?",
                (interview_id,),
            ).fetchone()
        if row is None or not row["transcript_json"]:
            return None
        return json.loads(row["transcript_json"])

    def get_report(self, interview_id: str) -> dict[str, Any] | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT report_json FROM interviews WHERE id = ?",
                (interview_id,),
            ).fetchone()
        if row is None or not row["report_json"]:
            return None
        return json.loads(row["report_json"])

    def interview_dir(self, interview_id: str) -> Path:
        path = self.root / "interviews" / interview_id
        path.mkdir(parents=True, exist_ok=True)
        return path

    def video_destination(self, interview_id: str, suffix: str) -> Path:
        return self.interview_dir(interview_id) / f"source{suffix}"

    def delete_interview(self, interview_id: str) -> bool:
        with self._lock, self._connect() as connection:
            cursor = connection.execute(
                "DELETE FROM interviews WHERE id = ?",
                (interview_id,),
            )
        if cursor.rowcount == 0:
            return False
        directory = self.root / "interviews" / interview_id
        if directory.exists():
            for child in sorted(directory.rglob("*"), reverse=True):
                if child.is_file() or child.is_symlink():
                    child.unlink(missing_ok=True)
                elif child.is_dir():
                    child.rmdir()
            directory.rmdir()
        return True
