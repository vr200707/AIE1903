"""Bounded asynchronous scanning with durable partial evidence and safe retries."""
from __future__ import annotations
from concurrent.futures import ThreadPoolExecutor
import uuid
from app import seminar_store as store
from app.interview_media import transcribe_video
from app.seminar_media import sample_window, mapped_transcript
from app.seminar_analysis import analyze_window, ground_observations, vision_config

executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix='seminar')
active: set[str] = set()
WINDOW_MS = 8000
MAX_SCAN_MS = 120000  # A deliberate preview budget, displayed before paid calls.


def recover_interrupted() -> None:
    with store.lock:
        for record in store.list_sessions():
            if record['status'] == 'analyzing' and record['id'] not in active:
                record.update(status='failed', stage='interrupted', error='Analysis was interrupted by a server restart. Retry the scan.')
                store.save(record)


def start_scan(session_id: str, start_ms: int, end_ms: int, audio_view: str) -> dict:
    with store.lock:
        record = store.read(session_id)
        if record['status'] == 'analyzing':
            return record
        if not record['aligned'] or record.get('uploads'):
            raise ValueError('Finish both uploads and confirm alignment before scanning.')
        low, high = record['overlap']
        if not low <= start_ms < end_ms <= high or end_ms-start_ms > MAX_SCAN_MS:
            raise ValueError('Select an overlapping range of at most 120 seconds.')
        vision_config()
        if len(active) >= 2:
            raise ValueError('Two scans are already running. Please try again shortly.')
        record.update(status='analyzing', stage='preparing', error=None, warnings=[],
                      progress={'done':0,'total':(end_ms-start_ms+WINDOW_MS-1)//WINDOW_MS},
                      scan={'start_ms':start_ms,'end_ms':end_ms,'audio_view':audio_view})
        store.save(record)
        active.add(session_id)
        try:
            executor.submit(run_scan, session_id, start_ms, end_ms, audio_view)
        except Exception:
            active.discard(session_id)
            record.update(status='failed',error='Could not queue scan. Please retry.')
            store.save(record)
            raise
        return record


def run_scan(session_id: str, start_ms: int, end_ms: int, audio_view: str) -> None:
    try:
        record = store.read(session_id)
        folder = store.directory(session_id)
        warnings = []
        transcript = []
        if audio_view != 'none':
            record['stage'] = 'transcribing'
            store.save(record)
            try:
                transcript = mapped_transcript(transcribe_video(folder / record['videos'][audio_view]['filename']),
                                               audio_view, record['offset_ms'], start_ms, end_ms)
            except Exception as exc:
                warnings.append(f'Transcript unavailable ({type(exc).__name__}); visual review continues. Select another audio track or scan without transcript.')
        else:
            warnings.append('Transcript omitted by reviewer; comments use visual evidence only.')
        # Each run has its own frames. Existing observations remain until a window
        # succeeds; a failed retry cannot erase earlier reviewed observations.
        run_id = uuid.uuid4().hex
        frames_dir = folder / 'frames' / run_id
        successful = 0
        for index, window_start in enumerate(range(start_ms, end_ms, WINDOW_MS)):
            window_end = min(window_start+WINDOW_MS, end_ms)
            record['stage'] = 'scanning'
            frames = []
            for view in ('speaker', 'screen'):
                frames += sample_window(folder / record['videos'][view]['filename'], frames_dir,
                                        view, window_start, window_end, record['offset_ms'])
            # Include run in IDs so saved evidence remains unambiguous across scans.
            for frame in frames:
                frame['id'] = run_id + '_' + frame['id']
            supported = sum(f['view']=='speaker' for f in frames) >= 2
            observations = None
            if supported:
                context = [s for s in transcript if s['end_ms']>window_start and s['start_ms']<window_end]
                try:
                    raw = analyze_window(frames, frames_dir, context)
                    observations, rejected = ground_observations(raw, frames)
                    successful += 1
                    if rejected:
                        warnings.append(f'{window_start/1000:g}s: discarded {rejected} unsupported observation(s).')
                except Exception as exc:
                    warnings.append(f'{window_start/1000:g}s: visual model failed ({type(exc).__name__}). Check model image support, key, endpoint, and quota; retry this range.')
            else:
                warnings.append(f'{window_start/1000:g}s: fewer than two informative speaker frames; skipped.')
            for frame in frames:
                frame['filename'] = run_id + '/' + frame['filename']
            with store.lock:
                latest = store.read(session_id)
                # Replace only observations wholly inside a successful window.
                if observations is not None:
                    latest['observations'] = [o for o in latest['observations']
                        if not (window_start <= o['start_ms'] and o['end_ms'] < window_end)] + observations
                latest['frames'].extend(frames)
                latest['transcript'] = [s for s in latest['transcript']
                    if s['end_ms'] <= start_ms or s['start_ms'] >= end_ms] + transcript
                latest.update(stage='scanning', progress={'done': index+1, 'total': record['progress']['total']}, warnings=warnings)
                latest['observations'].sort(key=lambda o:o['start_ms'])
                store.save(latest)
                record = latest
        record.update(status=('completed_with_warnings' if warnings else 'completed') if successful else 'failed',
                      stage='review', error=None if successful else 'No visual batch succeeded. Evidence is saved; check warnings and retry.')
        store.save(record)
    except Exception as exc:
        with store.lock:
            record = store.read(session_id)
            record.update(status='failed', stage='error', error=f'Scan could not finish ({type(exc).__name__}). Saved evidence is retained.')
            store.save(record)
    finally:
        with store.lock:
            active.discard(session_id)
