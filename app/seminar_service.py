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


def recover_interrupted() -> None:
    with store.lock:
        for record in store.list_sessions():
            if record['status'] == 'analyzing' and record['id'] not in active:
                record.update(status='failed', stage='interrupted', error='Analysis was interrupted by a server restart. Retry the scan.')
                store.save(record)


def start_scan(session_id: str, start_ms: int, end_ms: int, audio_view: str, *, ranges=None, part_ids=None, revision=None) -> dict:
    with store.lock:
        record = store.read(session_id)
        if record['status'] == 'analyzing':
            return record
        if record.get('outline_job',{}).get('status')=='running':
            raise ValueError('Wait for transcript preparation to finish.')
        if not record['aligned'] or record.get('uploads'):
            raise ValueError('Finish both uploads and confirm alignment before scanning.')
        low, high = record['overlap']
        if not low <= start_ms < end_ms <= high:
            raise ValueError('Select a range within the overlapping recordings.')
        ranges = ranges or [(start_ms,end_ms)]
        if any(not low <= a < b <= high for a,b in ranges) or any(a[1] > b[0] for a,b in zip(ranges,ranges[1:])):
            raise ValueError("Selected ranges must be ordered, nonoverlapping and inside the shared video range.")
        vision_config()
        if len(active) >= 2:
            raise ValueError('Two scans are already running. Please try again shortly.')
        record.update(status='analyzing', stage='preparing', error=None, warnings=[],
                      progress={'done':0,'total':sum((b-a+WINDOW_MS-1)//WINDOW_MS for a,b in ranges)},
                      scan={'start_ms':start_ms,'end_ms':end_ms,'audio_view':audio_view,'ranges':ranges,'part_ids':part_ids or [],'segments_revision':revision})
        store.save(record)
        active.add(session_id)
        try:
            executor.submit(run_scan, session_id, start_ms, end_ms, audio_view, ranges)
        except Exception:
            active.discard(session_id)
            record.update(status='failed',error='Could not queue scan. Please retry.')
            store.save(record)
            raise
        return record


def run_scan(session_id: str, start_ms: int, end_ms: int, audio_view: str, ranges=None) -> None:
    try:
        record = store.read(session_id)
        folder = store.directory(session_id)
        ranges = ranges or [(start_ms,end_ms)]
        warnings = []
        transcript = []
        if audio_view == 'speaker' and record.get('full_transcript'):
            transcript=[c for c in record['full_transcript'] if any(c['end_ms']>a and c['start_ms']<b for a,b in ranges)]
        elif audio_view != 'none':
            record['stage'] = 'transcribing'
            store.save(record)
            try:
                transcript = mapped_transcript(transcribe_video(folder / record['videos'][audio_view]['filename']),
                                               audio_view, record['offset_ms'], start_ms, end_ms)
            except Exception as exc:
                warnings.append(f'Transcript unavailable ({type(exc).__name__}); visual review continues. Select another audio track or scan without transcript.')
        else:
            warnings.append('Transcript omitted by reviewer; comments use visual evidence only.')
        transcript=[c for c in transcript if any(c['end_ms']>a and c['start_ms']<b for a,b in ranges)]
        # Each run has its own frames. Existing observations remain until a window
        # succeeds; a failed retry cannot erase earlier reviewed observations.
        run_id = uuid.uuid4().hex
        frames_dir = folder / 'frames' / run_id
        successful = 0
        prior_ids = {o["id"] for o in record["observations"]}
        successful_ranges: list[list[int]] = []
        windows=[(a,min(a+WINDOW_MS,end)) for start,end in ranges for a in range(start,end,WINDOW_MS)]
        for index, (window_start,window_end) in enumerate(windows):
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
                    for observation in observations:
                        observation['part_ids']=[p['id'] for p in record.get('segments',[]) if p['start_ms']<=observation['start_ms']<p['end_ms']]
                        observation['segments_revision']=record.get('segments_revision',0)
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
                # Merge consecutive successful coverage so events straddling a
                # batch boundary are replaced, but failed gaps retain old reviews.
                if observations is not None:
                    if successful_ranges and successful_ranges[-1][1] == window_start:
                        successful_ranges[-1][1] = window_end
                    else:
                        successful_ranges.append([window_start, window_end])
                    latest['observations'] = [o for o in latest['observations']
                        if o['id'] not in prior_ids or not any(
                            low <= o['start_ms'] and o['end_ms'] < high
                            for low, high in successful_ranges)] + observations
                latest['frames'].extend(frames)
                latest['transcript'] = [s for s in latest['transcript']
                    if not any(s['end_ms']>a and s['start_ms']<b for a,b in ranges)] + transcript
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
