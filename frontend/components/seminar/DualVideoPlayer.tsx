"use client";
import { useEffect, useRef, useState } from "react";
import { overlapSeconds, synchronizedTimes } from "@/lib/seminar-timing";
import { timecode, type Seminar } from "@/lib/seminar";

type Seek = {ms: number; nonce: number};
export default function DualVideoPlayer({session, offset, seek, onTime, active=true}: {session: Seminar; offset: number; seek: Seek | null; onTime?:(ms:number)=>void; active?:boolean}) {
  const speaker = useRef<HTMLVideoElement>(null);
  const screen = useRef<HTMLVideoElement>(null);
  const wanted = useRef(false);
  const busy = useRef(false);
  const requestedPosition = useRef<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [message, setMessage] = useState("");
  const [audio, setAudio] = useState<"speaker" | "screen">("speaker");
  const bounds = overlapSeconds((session.videos.speaker?.duration_ms ?? 0)/1000,
    (session.videos.screen?.duration_ms ?? 0)/1000, offset);
  const low = bounds?.[0] ?? 0, high = bounds?.[1] ?? 0;

  useEffect(() => {
    const a=speaker.current, b=screen.current;
    if (!a || !b || high<=low) return;
    a.pause(); b.pause(); wanted.current=false;
    const times=synchronizedTimes((seek?.ms ?? low*1000)/1000,offset,[low,high]);
    requestedPosition.current=times[0];
    // Show the selected part's time even before metadata/timeupdate arrives.
    let cancelled=false;
    queueMicrotask(()=>{if(!cancelled){setTime(times[0]);setPlaying(false);}});
    if(a.readyState>=1) a.currentTime=times[0];
    if(b.readyState>=1) b.currentTime=times[1];
    return()=>{cancelled=true;};
  }, [seek, offset, low, high]);

  useEffect(() => {
    const a=speaker.current, b=screen.current;
    if(!a || !b || high<=low || !active) return;
    const tick = () => {
      if(!wanted.current || busy.current) return;
      if(a.currentTime>=high-0.04) {
        wanted.current=false; a.pause(); b.pause(); setPlaying(false); return;
      }
      if(a.readyState<3 || b.readyState<3 || a.seeking || b.seeking) {
        a.pause(); b.pause(); setPlaying(false); return;
      }
      const target=a.currentTime+offset;
      if(Math.abs(b.currentTime-target)>0.18) {
        a.pause(); b.pause(); b.currentTime=target; return;
      }
      if(a.paused || b.paused) {
        busy.current=true;
        Promise.all([a.play(),b.play()]).then(()=>{
          if(!wanted.current) {a.pause();b.pause();return;}
          setPlaying(true); setMessage("");
        }).catch(()=>{wanted.current=false;a.pause();b.pause();setPlaying(false);setMessage("Playback could not start. Check the video format and try Play again.");})
          .finally(()=>{busy.current=false;});
      }
    };
    const timer=setInterval(tick,150);
    const wait=()=>{if(wanted.current){a.pause();b.pause();setPlaying(false);}};
    const stop=()=>{wanted.current=false;a.pause();b.pause();setPlaying(false);};
    a.addEventListener("waiting",wait);b.addEventListener("waiting",wait);
    a.addEventListener("ended",stop);b.addEventListener("ended",stop);
    return()=>{clearInterval(timer);wanted.current=false;a.pause();b.pause();
      a.removeEventListener("waiting",wait);b.removeEventListener("waiting",wait);a.removeEventListener("ended",stop);b.removeEventListener("ended",stop);};
  },[offset,low,high,active]);

  function jump(t: number) {
    if(!bounds || !speaker.current || !screen.current) return;
    const times=synchronizedTimes(t,offset,bounds);
    requestedPosition.current=times[0];
    if(speaker.current.readyState>=1) speaker.current.currentTime=times[0];
    if(screen.current.readyState>=1) screen.current.currentTime=times[1];
    setTime(times[0]);
  }
  return <section className="rounded-2xl border border-ink/15 glass-bg p-4" aria-label="Synchronized seminar recordings">
    <div className="grid gap-4 md:grid-cols-2">
      {(["speaker","screen"] as const).map(view=><div key={view}>
        <p className="mb-2 text-sm font-medium">{view==="speaker"?"Speaker view":"Shared-screen view"}</p>
        <video ref={view==="speaker"?speaker:screen} className="aspect-video w-full rounded-lg bg-black" playsInline preload="auto"
          src={`/api/seminars/${session.id}/videos/${view}?v=${session.videos[view]?.filename}`}
          muted={view!==audio} onLoadedMetadata={()=>{
            const player=view==="speaker"?speaker.current:screen.current;
            if(player && bounds) {
              const times=synchronizedTimes(requestedPosition.current ?? (seek?.ms ?? low*1000)/1000,offset,bounds);
              player.currentTime=times[view==="speaker"?0:1];
            }
          }} onTimeUpdate={view==="speaker"?()=>{const t=speaker.current?.currentTime ?? 0;setTime(t);onTime?.(Math.round(t*1000));}:undefined}
          onPause={view==="speaker"?()=>setPlaying(false):undefined}
          onError={()=>setMessage("This video cannot be played in this browser. Convert it to MP4 (H.264/AAC) and upload again.")} />
      </div>)}
    </div>
    {!bounds ? <p role="alert" className="mt-3 text-red-700">No overlap at this offset. Adjust the time difference.</p> : <>
      <input aria-label="Shared playback timeline" type="range" min={low} max={high} step={0.05} value={Math.max(low,Math.min(high,time))}
        onChange={e=>jump(Number(e.target.value))} className="mt-5 w-full" />
      <div className="mt-2 flex flex-wrap items-center gap-4 text-sm">
        <button className="rounded-full bg-ink px-5 py-2 text-white" onClick={()=>{
          if(wanted.current){wanted.current=false;speaker.current?.pause();screen.current?.pause();setPlaying(false);}
          else {if(time>=high-0.05)jump(low);wanted.current=true;setMessage("");}
        }}>{playing?"Pause both":"Play both"}</button>
        <span>Speaker {timecode(time*1000)} · Screen {timecode((time+offset)*1000)}</span>
        <label className="ml-auto">Listen to <select className="ml-2 rounded border p-1" value={audio} onChange={e=>setAudio(e.target.value as "speaker"|"screen")}>
          <option value="speaker">Speaker audio</option><option value="screen">Screen audio</option>
        </select></label>
      </div>
    </>}
    {message && <p role="status" className="mt-3 text-sm text-ink/70">{message}</p>}
  </section>;
}
