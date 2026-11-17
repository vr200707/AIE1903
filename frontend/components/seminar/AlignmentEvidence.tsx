"use client";
import {useRef,useState,useEffect} from "react";
import type {Seminar} from "@/lib/seminar";
type Anchor={speaker:number;screen:number;label:string};
export default function AlignmentEvidence({session,onApply,disabled=false,active=true}:{session:Seminar;disabled?:boolean;active?:boolean;onApply:(seconds:number)=>void}) {
 const a=useRef<HTMLVideoElement>(null),b=useRef<HTMLVideoElement>(null);
 useEffect(()=>{if(!active){a.current?.pause();b.current?.pause();}},[active]);
 const [anchors,setAnchors]=useState<Anchor[]>([]);
 const [label,setLabel]=useState("");
 const [notice,setNotice]=useState("");
 function saveEvent() {
  const speaker=a.current,screen=b.current;
  if(!speaker || !screen || speaker.readyState<1 || screen.readyState<1) {
   setNotice("Wait for both videos to load, then pause each on the matching event.");return;
  }
  speaker.pause();screen.pause();
  const event={speaker:speaker.currentTime,screen:screen.currentTime,label:label.trim() || `Event ${anchors.length+1}`};
  setAnchors(xs=>[...xs,event]);setLabel("");
  setNotice(`Saved: speaker ${event.speaker.toFixed(2)}s, screen ${event.screen.toFixed(2)}s, offset ${(event.screen-event.speaker).toFixed(2)}s. Use visual reference below to apply it.`);
 }
 const offsets=anchors.map(x=>x.screen-x.speaker);
 const drift=offsets.length>1 && Math.max(...offsets)-Math.min(...offsets)>0.5;
 return <details className="rounded-xl border border-ink/20 glass-bg p-4">
 <summary className="cursor-pointer font-medium">Verify alignment using visible events</summary>
 {session.alignment_suggestion?.checkpoints?.length ? <div className="my-3 text-sm"><p>Audio checkpoints (pictures still require verification):</p>{session.alignment_suggestion.checkpoints.map((c,i)=><p key={i}>{["Beginning","Middle","End"][i]} · speaker {(c.speaker_ms/1000).toFixed(1)}s · {c.reliable && c.offset_ms !== null ? `offset ${(c.offset_ms/1000).toFixed(2)}s` : "No reliable match"}</p>)}{session.alignment_suggestion.drift_detected && <p role="alert">Offsets vary across the recording; a fixed offset may not work.</p>}</div> : null}
 <p className="my-3 text-sm">Find the same slide change or visible action in both views. Pause each video on that event, describe it, and save the pair. Check the beginning, middle and end. If the views share no visible event, visual alignment cannot be verified automatically.</p>
 <div className="grid gap-3 md:grid-cols-2">{(["speaker","screen"] as const).map(v=><div key={v}><p>{v} view</p><video ref={v==="speaker"?a:b} controls muted preload="metadata" className="aspect-video w-full bg-black" src={`/api/seminars/${session.id}/videos/${v}`} /></div>)}</div>
 <div className="my-3 flex flex-wrap gap-2"><input aria-label="Shared visual event (optional)" className="rounded border p-2" placeholder="Event name (optional)" value={label} onChange={e=>setLabel(e.target.value)}/><button type="button" className="rounded border px-3 disabled:opacity-50" disabled={disabled} onClick={saveEvent}>Save matching event</button></div>
 {notice && <p role="status" className="my-2 text-sm">{notice}</p>}
 {anchors.length>0&&<table className="w-full text-left text-sm"><thead><tr><th>Event</th><th>Speaker (s)</th><th>Screen (s)</th><th>Offset</th><th/></tr></thead><tbody>{anchors.map((x,i)=><tr key={i}><td>{x.label}</td><td>{x.speaker.toFixed(2)}</td><td>{x.screen.toFixed(2)}</td><td>{(x.screen-x.speaker).toFixed(2)}s</td><td><button onClick={()=>setAnchors(xs=>xs.filter((_,j)=>j!==i))}>Remove</button></td></tr>)}</tbody></table>}
 {drift?<p role="alert" className="mt-3 text-amber-800">The event offsets differ by more than 0.5 seconds. Recheck the events; the recordings may drift or contain cuts. One fixed offset may not align the whole recording.</p>:anchors.length>0&&<button disabled={disabled} className="mt-3 rounded-full bg-ink px-4 py-2 text-white disabled:opacity-50" onClick={()=>onApply(offsets.reduce((a,b)=>a+b,0)/offsets.length)}>Use visual reference ({(offsets.reduce((a,b)=>a+b,0)/offsets.length).toFixed(2)}s)</button>}
 <p className="mt-2 text-xs text-ink/60">These are manually verified visual references. Confirm alignment above after checking playback.</p>
 </details>;
}
