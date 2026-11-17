"""Two-worker, checkpointed ASR with nonoverlapping ownership of padded chunks."""
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import json
import os
from pathlib import Path
import threading
import numpy as np
from app.interview_media import _decode_audio, _model_config, _segment_uncertain

RATE = 16000
CHUNK_SECONDS = 240
PADDING_SECONDS = 2
_model = None
_model_key = None
_model_lock = threading.Lock()


def get_model():
    global _model, _model_key
    config = _model_config()
    with _model_lock:
        if _model_key != config:
            from faster_whisper import WhisperModel
            name, device, compute, folder = config
            _model = WhisperModel(name, device=device, compute_type=compute,
                download_root=folder, num_workers=2,
                cpu_threads=max(1, min(4, (os.cpu_count() or 2)//2)))
            _model_key = config
        return _model


def chunk_bounds(audio, duration_ms):
    """Move four-minute cuts to the quietest nearby 200ms interval."""
    total = min(duration_ms, round(len(audio)*1000/RATE))
    cuts = [0]
    target = CHUNK_SECONDS*1000
    while target < total:
        candidates = range(max(cuts[-1]+1000,target-5000), min(total-1000,target+5000)+1,200)
        candidates = list(candidates)
        if not candidates: break
        cut = min(candidates,key=lambda ms:float(np.mean(np.square(audio[int(ms*RATE/1000):int((ms+200)*RATE/1000)]))))
        cuts.append(cut);target += CHUNK_SECONDS*1000
    cuts.append(total)
    return list(zip(cuts,cuts[1:]))


def transcribe_chunk(model, audio, start_ms, end_ms, total_ms):
    source_start=max(0,start_ms-PADDING_SECONDS*1000)
    source_end=min(total_ms,end_ms+PADDING_SECONDS*1000)
    segments, _ = model.transcribe(audio[int(source_start*RATE/1000):int(source_end*RATE/1000)],
        language='en',vad_filter=True,beam_size=1,word_timestamps=True,
        vad_parameters={'min_silence_duration_ms':500},condition_on_previous_text=True)
    result=[]
    for segment in segments:
        words=getattr(segment,'words',None)
        if words:
            # Both workers may hear the boundary words. Each word belongs to
            # exactly one core interval according to its global midpoint.
            owned=[w for w in words if start_ms <= source_start+(w.start+w.end)*500 < end_ms]
            if not owned:continue
            text=''.join(w.word for w in owned).strip()
            start=source_start+round(owned[0].start*1000)
            end=source_start+round(owned[-1].end*1000)
        else:
            start=source_start+round(segment.start*1000)
            end=source_start+round(segment.end*1000)
            if not start_ms <= (start+end)/2 < end_ms:continue
            text=str(segment.text or '').strip()
        start=max(start_ms,start);end=min(end_ms,end)
        if text and end>start:
            result.append(dict(start_ms=start,end_ms=end,text=text,
                uncertain=_segment_uncertain(getattr(segment,'avg_logprob',None),getattr(segment,'no_speech_prob',None))))
    return result


def transcribe_chunked(path: Path, duration_ms: int, checkpoint_dir: Path, progress=None):
    if progress:progress(0,0,[], 'Loading speech model and decoding audio…')
    model=get_model()
    audio=_decode_audio(path)
    # _decode_audio returns samples beginning at the audio stream's origin.
    # Convert to speaker video time before slicing or assigning timestamps.
    import av
    with av.open(str(path)) as container:
        a=container.streams.audio[0];v=container.streams.video[0]
        delta=round((float((a.start_time or 0)*a.time_base)-float((v.start_time or 0)*v.time_base))*RATE)
    if delta>0:audio=np.pad(audio,(delta,0))
    elif delta<0:audio=audio[-delta:]
    bounds=chunk_bounds(audio,duration_ms)
    if not bounds or bounds[-1][1]<=0:raise ValueError('No audio could be decoded.')
    stat=path.stat()
    fingerprint=hashlib.sha256(json.dumps([str(path.resolve()),stat.st_size,stat.st_mtime_ns,
        _model_config(),bounds,'chunk-asr-v1-beam1-words-pad2'],sort_keys=True).encode()).hexdigest()
    folder=checkpoint_dir/fingerprint;folder.mkdir(parents=True,exist_ok=True)
    results={}
    for i in range(len(bounds)):
        try:results[i]=json.loads((folder/f'{i}.json').read_text())
        except (OSError,ValueError):pass
    def notify(message=None):
        cues=[dict(c,segment_id=f'chunk_{i}_{j}') for i in sorted(results) for j,c in enumerate(results[i])]
        if progress:progress(len(results),len(bounds),cues,message or f'Transcribing audio: {len(results)}/{len(bounds)} chunks saved · up to 2 in parallel')
        return cues
    notify()
    failures=[]
    with ThreadPoolExecutor(max_workers=2,thread_name_prefix='seminar-asr') as pool:
        jobs={pool.submit(transcribe_chunk,model,audio,a,b,bounds[-1][1]):i for i,(a,b) in enumerate(bounds) if i not in results}
        for job in as_completed(jobs):
            i=jobs[job]
            try:
                result=job.result()
                temporary=folder/f'{i}.tmp';temporary.write_text(json.dumps(result,ensure_ascii=False));temporary.replace(folder/f'{i}.json')
                results[i]=result;notify()
            except Exception:
                failures.append(i)
    if failures:raise ValueError(f'{len(failures)} audio chunk(s) failed. Retry to resume; {len(results)}/{len(bounds)} completed chunks are saved.')
    cues=notify('Transcript chunks complete. Merging timestamps…')
    if not cues:raise ValueError('No English speech detected in the recording.')
    return {'segments':cues}
