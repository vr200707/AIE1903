"""Timestamp-preserving frame extraction; speaker time is the shared clock."""
from __future__ import annotations
from pathlib import Path


def sample_window(path: Path, output: Path, view: str, start_ms: int, end_ms: int,
                  offset_ms: int) -> list[dict]:
    import av
    import numpy as np
    output.mkdir(parents=True, exist_ok=True)
    shift = offset_ms if view == 'screen' else 0
    source_start, source_end = start_ms + shift, end_ms + shift
    frames = []
    previous = None
    with av.open(str(path)) as container:
        stream = container.streams.video[0]
        origin = float((stream.start_time or 0) * stream.time_base)
        container.seek(max(0, int((origin + source_start / 1000) / float(stream.time_base))), stream=stream)
        next_ms = source_start
        last_kept = -10000
        for frame in container.decode(stream):
            if frame.time is None:
                continue
            source_ms = round((float(frame.time) - origin) * 1000)
            if source_ms >= source_end:
                break
            if source_ms < next_ms:
                continue
            next_ms = source_ms + 1000
            image = frame.to_image().convert('RGB')
            gray = np.asarray(image.convert('L').resize((64, 48)), dtype=np.float32)
            if float(gray.mean()) < 8 and float(gray.std()) < 5:
                continue
            # Preserve action sequences. Only deduplicate the screen, keeping a
            # periodic anchor so static slides remain available as context.
            if view == 'screen' and previous is not None and abs(gray - previous).mean() < 1 and source_ms-last_kept < 4000:
                continue
            previous = gray
            last_kept = source_ms
            image.thumbnail((960, 720))
            canonical = source_ms - shift
            frame_id = f'{view}_{canonical:010d}'
            filename = frame_id + '.jpg'
            image.save(output / filename, quality=80)
            frames.append({'id': frame_id, 'view': view, 'time_ms': canonical,
                           'source_ms': source_ms, 'filename': filename})
    return frames


def mapped_transcript(transcript: dict, audio_view: str, offset_ms: int,
                      start_ms: int, end_ms: int) -> list[dict]:
    shift = offset_ms if audio_view == 'screen' else 0
    result = []
    for segment in transcript.get('segments', []):
        start, end = segment['start_ms']-shift, segment['end_ms']-shift
        if end > start_ms and start < end_ms:
            result.append({**segment, 'start_ms': max(start_ms, start), 'end_ms': min(end_ms, end)})
    return result
