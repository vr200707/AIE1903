"""Atomic local records for the single-process course demo."""
from __future__ import annotations
import json
import os
import re
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from dotenv import load_dotenv

lock = threading.RLock()


def root() -> Path:
    load_dotenv(Path(__file__).resolve().parents[1] / ".env")
    return Path(os.getenv('SEMINAR_DATA_DIR', str(Path(__file__).resolve().parents[1] / '.cache' / 'seminars')))


def directory(session_id: str) -> Path:
    if not re.fullmatch(r'sem_[0-9a-f]{32}', session_id):
        raise ValueError('Invalid seminar ID.')
    return root() / session_id


def read(session_id: str) -> dict:
    with lock:
        return json.loads((directory(session_id) / 'session.json').read_text())


def save(record: dict) -> None:
    with lock:
        folder = directory(record['id'])
        folder.mkdir(parents=True, exist_ok=True)
        record['updated_at'] = datetime.now(timezone.utc).isoformat()
        temporary = folder / 'session.json.tmp'
        temporary.write_text(json.dumps(record, ensure_ascii=False), encoding='utf-8')
        temporary.replace(folder / 'session.json')


def create(profile_id: str, title: str) -> dict:
    record = {'id': 'sem_' + uuid.uuid4().hex, 'profile_id': profile_id, 'title': title,
              'videos': {}, 'uploads': {}, 'offset_ms': 0, 'aligned': False,
              'status': 'created', 'stage': 'upload', 'progress': {'done': 0, 'total': 0},
              'warnings': [], 'error': None, 'frames': [], 'observations': [], 'transcript': []}
    save(record)
    return record


def list_sessions(profile_id: str | None = None) -> list[dict]:
    with lock:
        records = []
        for path in root().glob('sem_*/session.json'):
            try:
                record = read(path.parent.name)
            except (OSError, ValueError):
                continue
            if profile_id is None or record['profile_id'] == profile_id:
                records.append(record)
        return sorted(records, key=lambda r: r['updated_at'], reverse=True)


def overlap(speaker_ms: int, screen_ms: int, offset_ms: int) -> tuple[int, int]:
    start, end = max(0, -offset_ms), min(speaker_ms, screen_ms - offset_ms)
    if end <= start:
        raise ValueError('The recordings do not overlap at this offset.')
    return start, end


def invalidate(record: dict) -> None:
    record.update(frames=[], observations=[], transcript=[], warnings=[], error=None,
                  status='ready' if record['aligned'] else 'created', stage='alignment',
                  progress={'done': 0, 'total': 0})
