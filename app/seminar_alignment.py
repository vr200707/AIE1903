"""Local audio-envelope synchronization. Offsets are suggestions, not confirmation."""
from pathlib import Path
import numpy as np

STEP_MS = 20
MAX_AUDIO_SECONDS = 600


def estimate_envelopes(speaker, screen) -> dict:
    a=np.asarray(speaker,dtype=np.float64)
    b=np.asarray(screen,dtype=np.float64)
    unavailable={'offset_ms':None,'reliable':False,'score':0.0,
                 'message':'No reliable shared audio match. Adjust the offset manually.'}
    if min(len(a),len(b))<1500 or min(float(a.std()),float(b.std()))<1e-6:
        return unavailable
    # Correlate b against a: positive lag means the screen event occurs later.
    n=len(a)+len(b)-1
    size=1 << (n-1).bit_length()
    corr=np.fft.irfft(np.fft.rfft(b,size)*np.fft.rfft(a[::-1],size),size)[:n]
    lags=np.arange(-len(a)+1,len(b))
    lo=np.maximum(0,-lags);hi=np.minimum(len(a),len(b)-lags)
    count=hi-lo
    valid=count>=max(1500,min(len(a),len(b))//2)
    indexes=np.flatnonzero(valid)
    if not len(indexes):return unavailable
    lag=lags[indexes];x0=lo[indexes];x1=hi[indexes];y0=x0+lag;y1=x1+lag;c=count[indexes]
    def sums(values,start,end):
        prefix=np.r_[0,np.cumsum(values)]
        return prefix[end]-prefix[start]
    sa=sums(a,x0,x1);sb=sums(b,y0,y1)
    va=np.maximum(0,sums(a*a,x0,x1)-sa*sa/c)
    vb=np.maximum(0,sums(b*b,y0,y1)-sb*sb/c)
    scores=(corr[indexes]-sa*sb/c)/np.maximum(np.sqrt(va*vb),1e-12)
    best=int(np.argmax(scores));score=float(scores[best]);best_lag=int(lag[best])
    competing=scores[np.abs(lag-best_lag)>50]
    runner=float(competing.max()) if len(competing) else 0
    reliable=score>=0.55 and score-runner>=0.08
    return {'offset_ms':best_lag*STEP_MS if reliable else None,'reliable':reliable,
            'score':round(score,3),'message':('Reference estimated from shared audio. Check playback, adjust if needed, then confirm alignment.' if reliable else unavailable['message'])}


def audio_envelope(path: Path, start_seconds: float = 0, duration_seconds: int = MAX_AUDIO_SECONDS):
    import av
    rate=8000
    output=np.zeros(duration_seconds*50,dtype=np.float64)
    counts=np.zeros_like(output)
    with av.open(str(path)) as container:
        if not container.streams.audio:
            raise ValueError('This recording has no audio track.')
        stream=container.streams.audio[0]
        # Preserve audio/video relative stream offsets rather than zeroing audio.
        video=container.streams.video[0]
        origin=float((video.start_time or 0)*video.time_base)
        if start_seconds:
            container.seek(int((origin+start_seconds)*1000000))
        resampler=av.AudioResampler(format='fltp',layout='mono',rate=rate)
        for frame in container.decode(stream):
            if frame.time is not None and float(frame.time)-origin>=start_seconds+duration_seconds:break
            for converted in resampler.resample(frame):
                if converted.time is None:continue
                samples=converted.to_ndarray().reshape(-1).astype(np.float64)
                start=float(converted.time)-origin-start_seconds
                bins=np.floor((start+np.arange(len(samples))/rate)*50).astype(np.int64)
                valid=(bins>=0)&(bins<len(output))
                np.add.at(output,bins[valid],samples[valid]**2)
                np.add.at(counts,bins[valid],1)
    used=np.flatnonzero(counts)
    if not len(used):raise ValueError('No usable audio was decoded.')
    end=int(used[-1])+1
    return np.sqrt(output[:end]/np.maximum(counts[:end],1))


def estimate_offset(speaker: Path, screen: Path) -> dict:
    try:
        result=estimate_envelopes(audio_envelope(speaker),audio_envelope(screen))
        result['visual_verified']=False
        result['method']='audio_envelope'
        result['checkpoints']=[]
        if result['reliable']:
            import av
            durations=[]
            for path in (speaker,screen):
                with av.open(str(path)) as container:
                    durations.append(float(container.duration or 0)/av.time_base)
            offset=result['offset_ms']/1000
            low=max(0,-offset); high=min(durations[0],durations[1]-offset)
            for fraction in (0,0.5,1):
                start=low+max(0,high-low-90)*fraction
                if high-low<60:break
                check=estimate_envelopes(audio_envelope(speaker,start,90),audio_envelope(screen,start+offset,90))
                result['checkpoints'].append({'speaker_ms':round(start*1000),
                    'screen_ms':round((start+offset)*1000),'reliable':check['reliable'],
                    'offset_ms':result['offset_ms']+check['offset_ms'] if check['reliable'] else None})
            accepted=[x['offset_ms'] for x in result['checkpoints'] if x['reliable']]
            result['drift_detected']=len(accepted)>1 and max(accepted)-min(accepted)>500
            if result['drift_detected']:
                result.update(reliable=False,offset_ms=None,message='Audio offsets differ across the recording. Check visual events; a fixed offset may not work.')
            else:
                result['message']='Audio-only reference. Matching audio does not verify matching pictures. Check shared visual events before confirming.'
        return result
    except (ValueError, OSError) as exc:
        return {'offset_ms':None,'reliable':False,'score':0.0,
                'message':f'Automatic alignment unavailable: {exc} Set the offset manually.'}
