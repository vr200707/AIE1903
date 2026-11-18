"use client";
import {useRef,useState} from "react";
import DualVideoPlayer from "./DualVideoPlayer";
import {timecode,type Seminar,type SeminarPart,type PartGroup} from "@/lib/seminar";
import {groups,groupNames,splitPart,mergeBoundary,moveBoundary} from "@/lib/seminar-parts";

const button="rounded-full bg-ink px-4 py-2 text-sm text-white transition hover:bg-ink/90 disabled:opacity-40";
const input="rounded-lg border border-ink/20 bg-white px-3 py-2 text-sm transition focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/20";
const panel="rounded-2xl border border-ink/15 glass-bg p-5";
const colors:Record<PartGroup,string>={introduction:"border-teal-300 bg-teal-50/70",body:"border-sky-300 bg-sky-50/70",conclusion:"border-violet-300 bg-violet-50/70",other:"border-amber-300 bg-amber-50/70"};

/** 编号板块标题：让 Structure 工作区的每个区域职责一目了然 */
function BlockTitle({index,title}:{index:number;title:string}) {
 return <div className="mb-4 flex items-start gap-3">
  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/12 font-display text-sm text-accent">{index}</span>
  <div className="min-w-0">
   <h3 className="font-semibold">{title}</h3>
  </div>
 </div>;
}

export default function SegmentEditor({session,locked,active,onSave,onPrepare,onImport,onDirty}:{session:Seminar;locked:boolean;active:boolean;onSave:(parts:SeminarPart[])=>Promise<void>;onPrepare:(script:string,generate:boolean)=>void;onImport:(content:string,view:"speaker"|"screen")=>void;onDirty:(dirty:boolean)=>void}) {
 const [parts,setParts]=useState<SeminarPart[]>(session.segments??[]);
 const [history,setHistory]=useState<SeminarPart[][]>([]);
 const [selection,setSelection]=useState<string|null>(parts[0]?.id??null);
 const [boundary,setBoundary]=useState<number|null>(null);
 const [boundaryTime,setBoundaryTime]=useState("");
 const [seek,setSeek]=useState<{ms:number;nonce:number}|null>(null);
 const [playhead,setPlayhead]=useState(0);
 const [script,setScript]=useState(session.script_context??"");
 const [source,setSource]=useState<"speaker"|"screen">("speaker");
 const [error,setError]=useState("");
 const [dirty,setDirty]=useState(false);
 const [confirmRegenerate,setConfirmRegenerate]=useState(false);
 const [timingHelpOpen,setTimingHelpOpen]=useState(false);
 const drag=useRef<{y:number;time:number;index:number;scale:number;next:number}|null>(null);
 const duration=session.videos.speaker?.duration_ms??0;
 const selected=parts.find(p=>p.id===selection)??parts[0];
 const transcriptScroll=useRef<HTMLDivElement>(null);
 const displayed=parts;
 const cues=(session.full_transcript??[]).filter(c=>selected && c.end_ms>selected.start_ms&&c.start_ms<selected.end_ms);
 function change(next:SeminarPart[]) {setHistory(h=>[...h.slice(-49),parts]);setParts(next);setDirty(true);onDirty(true);setError("");}
 function safely(work:()=>void){try{work();setError("");}catch(e){setError(e instanceof Error?e.message:String(e));}}
 function jump(ms:number){setSeek(s=>({ms,nonce:(s?.nonce??0)+1}));}
 function choose(p:SeminarPart){setSelection(p.id);setBoundary(null);setPlayhead(p.start_ms);jump(p.start_ms);if(transcriptScroll.current)transcriptScroll.current.scrollTop=0;}
 function addGroup(group:PartGroup) {
  if(!parts.length){const p={id:crypto.randomUUID(),group,title:groupNames[group],summary:"",start_ms:0,end_ms:duration};change([p]);setSelection(p.id);return;}
  const target=selected??parts[0];const at=playhead>target.start_ms&&playhead<target.end_ms?playhead:Math.round((target.start_ms+target.end_ms)/2);
  const id=crypto.randomUUID();change(splitPart(parts,target.id,at,id,group));setSelection(id);jump(at);
 }
 return <section className="space-y-5">
  <div><h2 className="text-xl font-semibold">{session.videos.screen?4:3}. Structure the presentation</h2><p className="mt-2 text-sm text-ink/70">AI-generated sections appear directly in this timeline. Select any part or cut to edit the AI result. Every section is optional. Grey dashed cards mean no content has been assigned yet.</p></div>
  {error&&<p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}

  {/* 板块 ①：转写与字幕来源 */}
  <details className={`${panel} group`} open={!session.full_transcript?.length}>
   <BlockTitle index={1} title="Transcript source" />
   <summary className="-mt-2 cursor-pointer font-medium">Transcript & AI sections {session.full_transcript?.length?`· ${session.full_transcript.length} timed cues`:""}</summary>
   <div className="my-3 flex flex-wrap items-center gap-3">
    <p className="text-sm text-ink/70">Import SRT/VTT subtitles or transcribe the speaker audio to time the sections.</p>
    <button type="button" onClick={()=>setTimingHelpOpen(v=>!v)} aria-expanded={timingHelpOpen} className="text-xs font-medium text-accent underline underline-offset-2 transition hover:text-ink/70">How timing works</button>
   </div>
   {timingHelpOpen && <p className="mb-3 rounded-lg bg-ink/[0.04] px-3 py-2 text-xs leading-5 text-ink/65">Long recordings are prepared in the background. An untimed script can guide topics, but timing always comes from subtitles or audio transcription.</p>}
   <div className="flex flex-wrap items-center gap-3">
    <label className="text-sm">Subtitle timeline <select className={input} disabled={locked} value={source} onChange={e=>setSource(e.target.value as "speaker"|"screen")}><option value="speaker">Speaker</option>{session.videos.screen&&<option value="screen">Screen (apply offset)</option>}</select></label>
    {session.full_transcript?.length ? (
     <div className="flex items-center gap-2 rounded-lg border border-accent/30 bg-accent/[0.08] px-3 py-2.5 text-sm">
      <span aria-hidden="true" className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-xs text-white">✓</span>
      <span className="font-medium">{session.full_transcript.length} timed cues</span>
      <span className="text-xs text-ink/60">subtitles ready</span>
     </div>
    ) : (
     <div className="rounded-lg border border-dashed border-ink/20 bg-ink/[0.03] px-3 py-2.5 text-sm text-ink/50">No subtitles selected</div>
    )}
    <label aria-disabled={locked} className={`inline-flex w-fit cursor-pointer items-center gap-2 rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-white transition hover:bg-ink/90 ${locked?"pointer-events-none opacity-40":""}`}>
     <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M8 11V2m0 0L4.5 5.5M8 2l3.5 3.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2 11.5V13a1.5 1.5 0 001.5 1.5h9A1.5 1.5 0 0014 13v-1.5" strokeLinecap="round" />
     </svg>
     {session.full_transcript?.length ? "Replace subtitles" : "Choose subtitle file"}
     <input aria-label="Import subtitles" type="file" accept=".srt,.vtt" disabled={locked} className="hidden" onChange={async e=>{const file=e.target.files?.[0];e.target.value="";if(file){if(file.size>1000000){setError("Subtitle file exceeds 1 MB.");return;}try{onImport(await file.text(),source);}catch{setError("Could not read subtitle file.");}}}}/>
    </label>
   </div>
   <label className="mt-3 block text-sm">Optional script context<textarea value={script} maxLength={100000} disabled={locked} onChange={e=>setScript(e.target.value)} placeholder="Paste an untimed script if you have one…" className={`${input} mt-1 block min-h-24 w-full`} /></label>
   <div className="mt-3 flex flex-wrap gap-3"><button className={button} disabled={locked} onClick={()=>{if(parts.length)setConfirmRegenerate(true);else onPrepare(script,true);}}>{parts.length?"Regenerate AI sections":session.full_transcript?.length?"Generate AI sections":"Transcribe & generate AI sections"}</button><button className={input} disabled={locked} onClick={()=>onPrepare(script,false)}>Prepare transcript only</button></div>
   {session.outline_job&&<p role={session.outline_job.status==="failed"?"alert":"status"} className={`mt-4 rounded-xl p-3 text-sm ${session.outline_job.status==="failed"?"bg-red-50 text-red-800":"bg-white/60"}`}>{session.outline_job.status==="running"&&<span aria-hidden="true" className="seminar-hourglass mr-2 inline-block">⌛</span>}{session.outline_job.message}</p>}
   {session.outline_job?.status==="running" && Boolean(session.outline_job.total) && <progress aria-label="Audio chunks transcribed" className="mt-2 w-full" max={session.outline_job.total} value={session.outline_job.done??0} />}
   {confirmRegenerate&&<div role="alert" className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm"><p>Regenerating will replace the current timeline, including manual edits.</p><div className="mt-3 flex gap-2"><button className={button} disabled={locked} onClick={()=>{setConfirmRegenerate(false);onPrepare(script,true);}}>Regenerate & replace timeline</button><button className={input} onClick={()=>setConfirmRegenerate(false)}>Cancel</button></div></div>}
  </details>

  {/* 板块 ②：四个段落分组概览 */}
  <div className={panel}>
   <BlockTitle index={2} title="Section overview" />
   <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{groups.map(group=>{const items=displayed.filter(p=>p.group===group);return <div key={group} data-group={group} data-empty={!items.length} className={`rounded-xl border-2 p-3 ${items.length?colors[group]:"border-dashed border-slate-300 bg-slate-100/60 text-slate-500"}`}><p className="font-medium">{groupNames[group]}</p><p className="mt-1 text-xs">{items.length?`${items.length} part${items.length===1?"":"s"} · ${timecode(items.reduce((n,p)=>n+p.end_ms-p.start_ms,0))}`:"Optional · not present"}</p><button className="mt-3 text-sm underline disabled:opacity-40" disabled={locked} onClick={()=>safely(()=>addGroup(group))}>+ Add part</button></div>;})}</div>
  </div>

  {/* 板块 ③：时间线与同步预览 */}
  <div className={`${panel} grid gap-5 lg:grid-cols-[minmax(240px,1fr)_minmax(0,2fr)]`}>
   <div>
    <BlockTitle index={3} title="Speaker timeline" />
    <div className="mb-3 text-xs text-ink/60">Total duration: {timecode(duration)}</div>
    <div className="max-h-[65vh] overflow-y-auto pr-2" aria-label="Presentation parts timeline">
     {!displayed.length&&<p className="rounded-xl border-2 border-dashed border-slate-300 p-6 text-sm text-slate-500">No parts yet. Generate AI sections or add an optional section above.</p>}
     {displayed.map((p,i)=><div key={p.id}>
      {i>0&&<button disabled={locked} aria-label={`Cut at ${timecode(p.start_ms)}`} className={`my-1 flex w-full touch-none items-center gap-2 py-2 text-xs ${boundary===i?"font-bold text-teal-800":"text-ink/60"}`} onClick={()=>{setBoundary(i);setBoundaryTime(String(p.start_ms/1000));jump(p.start_ms);}}
       onPointerDown={e=>{if(locked)return;const left=parts[i-1];drag.current={y:e.clientY,time:p.start_ms,index:i,scale:(p.end_ms-left.start_ms)/(Math.max(70,(left.end_ms-left.start_ms)/duration*850)+Math.max(70,(p.end_ms-p.start_ms)/duration*850)),next:p.start_ms};e.currentTarget.setPointerCapture(e.pointerId);}}
       onPointerMove={e=>{const d=drag.current;if(!d)return;d.next=Math.round(Math.max(parts[i-1].start_ms+1,Math.min(p.end_ms-1,d.time+(e.clientY-d.y)*d.scale)));setBoundary(i);setBoundaryTime(String(d.next/1000));}}
       onPointerUp={()=>{const d=drag.current;drag.current=null;if(d&&d.next!==d.time)safely(()=>change(moveBoundary(parts,d.index,d.next)));}}
       onPointerCancel={()=>{drag.current=null;}}><span className="h-px flex-1 bg-current"/>✂ {timecode(p.start_ms)}<span className="h-px flex-1 bg-current"/></button>}
      <button type="button" aria-pressed={selected?.id===p.id} onClick={()=>choose(p)} style={{minHeight:Math.max(70,(p.end_ms-p.start_ms)/duration*850)}} className={`flex w-full flex-col justify-center rounded-xl border-l-4 p-3 text-left ${colors[p.group]} ${selected?.id===p.id?"ring-2 ring-ink/60":""}`}><span className="text-xs uppercase tracking-wide text-ink/60">{groupNames[p.group]} · {timecode(p.start_ms)}–{timecode(p.end_ms)}</span><span className="mt-1 text-sm font-medium">{p.title}</span></button>
     </div>)}
    </div>
   </div>
   <div>
    <BlockTitle index={4} title={session.videos.screen?"Synced preview":"Speaker preview"} />
    <DualVideoPlayer session={session} offset={session.offset_ms/1000} seek={seek} onTime={setPlayhead} active={active}/>
    <p className="mt-3 text-xs text-ink/60">{session.videos.screen?"Shared playback":"Speaker playback"}: {timecode(session.overlap?.[0]??0)}–{timecode(session.overlap?.[1]??duration)}. {session.videos.screen?"Parts outside this range remain in the outline; scanning uses only the overlapping footage.":"Scanning uses the selected parts of the speaker recording."}</p>
   </div>
  </div>

  {/* 板块 ④：段落/切点编辑与保存 */}
  <div className={panel}>
   <BlockTitle index={5} title="Edit part or cut" />
   {boundary!==null&&parts[boundary]?<><p className="text-sm">{parts[boundary-1].title} → {parts[boundary].title}</p><label className="block text-sm">Speaker time (seconds) <input type="number" step="0.001" className={input} value={boundaryTime} disabled={locked} onChange={e=>setBoundaryTime(e.target.value)}/></label><div className="mt-3 flex flex-wrap gap-2"><button className={button} disabled={locked||!boundaryTime.trim()} onClick={()=>safely(()=>{change(moveBoundary(parts,boundary,Math.round(Number(boundaryTime)*1000)));jump(Number(boundaryTime)*1000);})}>Move cut</button><button className={input} disabled={locked} onClick={()=>safely(()=>{const id=parts[boundary-1].id;change(mergeBoundary(parts,boundary));setBoundary(null);setSelection(id);})}>Remove cut & merge</button></div><p className="mt-2 text-xs text-ink/60">A merged part keeps the left part’s section; you can change it afterwards.</p></>:selected?<><div className="flex flex-wrap items-end gap-3"><label className="block text-sm">Title<input className={`${input} mt-1 w-full`} maxLength={200} value={selected.title} disabled={locked} onChange={e=>change(parts.map(p=>p.id===selected.id?{...p,title:e.target.value}:p))}/></label><label className="block text-sm">Section<select className={`${input} ml-2`} value={selected.group} disabled={locked} onChange={e=>change(parts.map(p=>p.id===selected.id?{...p,group:e.target.value as PartGroup}:p))}>{groups.map(g=><option key={g} value={g}>{groupNames[g]}</option>)}</select></label></div><p className="mt-3 text-sm">{timecode(selected.start_ms)}–{timecode(selected.end_ms)} · Playhead {timecode(playhead)}</p><div className="mt-3"><button className={button} disabled={locked||playhead<=selected.start_ms||playhead>=selected.end_ms} onClick={()=>safely(()=>{change(splitPart(parts,selected.id,playhead,crypto.randomUUID()));setBoundary(null);})}>+ Split at playhead</button></div>{selected.summary&&<p className="mt-3 text-sm text-ink/70">{selected.summary}</p>}</>:<p className="text-sm">Choose a part or add a section to begin.</p>}
   <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-ink/10 pt-4"><button className={input} disabled={locked||!history.length} onClick={()=>{setParts(history[history.length-1]);setHistory(h=>h.slice(0,-1));setBoundary(null);setDirty(true);onDirty(true);}}>↶ Undo</button><button className={button} disabled={locked||!dirty||parts.some(p=>!p.title.trim())} onClick={async()=>{try{await onSave(parts);setDirty(false);onDirty(false);}catch(e){setError(String(e));}}}>Save parts</button><span className="text-xs text-ink/60">{dirty?"Unsaved edits — save before scanning":"Saved"}</span></div>
  </div>

  {/* 板块 ⑤：当前段落的转写明细 */}
  <details className={panel} open>
   <BlockTitle index={6} title="Transcript of the selected part" />
   <summary className="-mt-2 cursor-pointer text-sm font-medium">{selected?`${selected.title} · Transcript`:"Transcript"} · {cues.length} cues</summary>
   <div ref={transcriptScroll} className="mt-3 max-h-64 overflow-y-auto">{cues.map(c=><button key={c.segment_id} className="mb-2 block w-full rounded p-2 text-left text-sm hover:bg-white" onClick={()=>jump(c.start_ms)}><span className="mr-2 text-xs text-ink/50">{timecode(c.start_ms)}</span>{c.text}{c.uncertain?" · ASR uncertain":""}</button>)}{!cues.length&&<p className="text-sm text-ink/50">No transcript for this part yet.</p>}</div>
  </details>
 </section>;
}
