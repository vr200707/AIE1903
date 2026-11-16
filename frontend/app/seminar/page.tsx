"use client";
/* Saved frames are evidence endpoints, not optimized website assets. */
/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useArchive } from "@/components/ArchiveProvider";
import DualVideoPlayer from "@/components/seminar/DualVideoPlayer";
import { seminarRequest, uploadSeminarVideo, timecode, type Seminar, type Summary, type View,
  type Observation, type Dimension, type ReviewStatus } from "@/lib/seminar";

const dimensions: Record<Dimension,string> = {audience_orientation:"Audience orientation",gesture_usage:"Gesture usage",posture_movement:"Posture and movement"};
const input="rounded-lg border border-ink/20 bg-white/80 px-3 py-2 text-sm disabled:opacity-50";
const button="rounded-full bg-ink px-5 py-2 text-sm text-white disabled:opacity-40";

export default function SeminarPage() {
  const {archives}=useArchive();
  const [sessions,setSessions]=useState<Summary[]>([]);
  const [record,setRecord]=useState<Seminar|null>(null);
  const [candidate,setCandidate]=useState("");
  const [title,setTitle]=useState("Research presentation");
  const [offset,setOffset]=useState("0");
  const [start,setStart]=useState("0");
  const [end,setEnd]=useState("60");
  const [audio,setAudio]=useState<View|"none">("speaker");
  const [busy,setBusy]=useState("");
  const [error,setError]=useState("");
  const [seek,setSeek]=useState<{ms:number;nonce:number}|null>(null);
  const [selected,setSelected]=useState<string|null>(null);
  const [dimension,setDimension]=useState<Dimension|"all">("all");
  const running=record?.status==="analyzing";
  const locked=Boolean(busy)||running;
  const draftOffset=Number(offset);
  const aligned=record?.aligned && Math.round(draftOffset*1000)===record.offset_ms;
  const currentId=record?.id;
  const refresh=useCallback(async()=>setSessions(await seminarRequest<Summary[]>()),[]);
  useEffect(()=>{
    let cancelled=false;
    seminarRequest<Summary[]>().then(items=>{if(!cancelled){setSessions(items);setCandidate(new URLSearchParams(window.location.search).get("profile_id") ?? "");}}).catch(e=>{if(!cancelled)setError(String(e));});
    return()=>{cancelled=true;};
  },[]);
  useEffect(()=>{
    if(!currentId || !running) return;
    let cancelled=false;
    const timer=setInterval(async()=>{
      try {
        const updated=await seminarRequest<Seminar>(`/${currentId}`);
        if(cancelled)return;
        setRecord(updated);
        if(updated.status!=="analyzing")await refresh();
      } catch(e){if(!cancelled)setError(String(e));}
    },1500);
    return()=>{cancelled=true;clearInterval(timer);};
  },[currentId,running,refresh]);
  function open(item: Seminar) {
    setRecord(item);setOffset(String(item.offset_ms/1000));setSelected(null);setSeek(null);setError("");
    const low=(item.overlap?.[0] ?? 0)/1000, high=(item.overlap?.[1] ?? 60000)/1000;
    setStart(String(low));setEnd(String(Math.min(high,low+60)));
  }
  async function act(label: string, work: ()=>Promise<void>) {
    setBusy(label);setError("");
    try {await work();}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy("");}
  }
  async function upload(view: View,file:File) {
    if(!record)return;
    await act(`Uploading ${view}…`,async()=>{
      open(await uploadSeminarVideo(record.id,view,file,p=>setBusy(`Uploading ${view}: ${p}%`)));await refresh();
    });
  }
  function evidence(item:Observation) {
    setSelected(item.id);setSeek(previous=>({ms:item.start_ms,nonce:(previous?.nonce ?? 0)+1}));
    document.getElementById("recordings")?.scrollIntoView({behavior:"smooth",block:"start"});
  }
  const selectedObservation=record?.observations.find(o=>o.id===selected);
  const selectedFrames=selectedObservation ? record?.frames.filter(f=>selectedObservation.frame_ids.includes(f.id)).sort((a,b)=>a.time_ms-b.time_ms):[];
  const shown=record?.observations.filter(o=>dimension==="all"||o.dimension===dimension) ?? [];

  return <main className="mx-auto max-w-7xl space-y-6 px-5 py-8 text-ink md:px-10">
    <header className="pr-16">
      <p className="text-xs uppercase tracking-[.2em] text-ink/60">Project 3 · Candidate presentation</p>
      <h1 className="mt-2 text-3xl font-semibold">Seminar Analysis</h1>
      <p className="mt-3 max-w-3xl text-sm leading-6 text-ink/75">Review a candidate’s research talk or teaching demonstration. Align two views, find visible presenter actions, and check every AI comment against the original recordings.</p>
      <Link href="/" className="mt-2 inline-block text-sm underline">Back to candidate profiles</Link>
    </header>
    {error && <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-800">{error}</p>}
    {busy && <p role="status" className="text-sm">{busy}</p>}
    <section className="rounded-2xl border border-ink/15 bg-white/50 p-5">
      <h2 className="font-semibold">1. Choose a candidate and seminar</h2>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs">Candidate<select className={input} value={candidate} disabled={locked} onChange={e=>setCandidate(e.target.value)}>
          <option value="">Choose saved candidate…</option>{archives.map(a=><option key={a.profileId} value={a.profileId}>{a.name}</option>)}
        </select></label>
        <label className="flex flex-col gap-1 text-xs">Seminar title<input className={input} value={title} maxLength={200} disabled={locked} onChange={e=>setTitle(e.target.value)} /></label>
        <button className={button} disabled={locked||!candidate||!title.trim()} onClick={()=>act("Creating seminar…",async()=>{
          open(await seminarRequest<Seminar>("","POST",{profile_id:candidate,title:title.trim()}));await refresh();
        })}>Create seminar</button>
      </div>
      {archives.length===0 && <p className="mt-3 text-sm text-ink/70">Analyze a candidate’s documents first to create a linked seminar.</p>}
      <label className="mt-4 flex max-w-xl flex-col gap-1 text-xs">Resume a saved seminar<select className={input} disabled={locked} value={record?.id ?? ""} onChange={e=>{
        const id=e.target.value;if(id)act("Loading seminar…",async()=>open(await seminarRequest<Seminar>(`/${id}`)));
      }}><option value="">Select a seminar…</option>{sessions.map(s=><option key={s.id} value={s.id}>{archives.find(a=>a.profileId===s.profile_id)?.name ?? s.profile_id} · {s.title} · {s.status}</option>)}</select></label>
    </section>
    {record && <>
      <section className="rounded-2xl border border-ink/15 bg-white/50 p-5">
        <h2 className="font-semibold">2. Add two views of the same presentation</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">{(["speaker","screen"] as const).map(view=><label key={view} className="rounded-xl border border-dashed border-ink/25 p-4 text-sm">
          <span className="font-medium">{view==="speaker"?"Speaker recording":"Shared-screen recording"}</span>
          <span className="my-2 block text-xs text-ink/70">{record.videos[view]?.display_name ?? "No video uploaded"}{record.videos[view] ? ` · ${timecode(record.videos[view]!.duration_ms)}`:""}</span>
          <input aria-label={`Upload ${view} recording`} type="file" accept=".mp4,.m4v,.mov,.webm,.mkv" disabled={locked} className="block w-full text-xs"
            onChange={e=>{const file=e.target.files?.[0];e.target.value="";if(file)upload(view,file);}} />
        </label>)}</div>
        <p className="mt-3 text-xs text-ink/60">Screen audio is optional. Replacing either recording resets alignment and its analysis. MP4 with H.264/AAC is recommended for browser playback.</p>
      </section>
      {record.videos.speaker && record.videos.screen && <>
        <section id="recordings" className="scroll-mt-4 space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="mr-auto"><h2 className="font-semibold">3. Align the recordings</h2><p className="mt-1 text-xs text-ink/70">Screen time = speaker time + offset. Check the start, middle and end before confirming.</p></div>
            <label className="flex flex-col gap-1 text-xs">Screen offset (seconds)<input type="number" step="0.1" className={`${input} w-32`} value={offset} disabled={locked} onChange={e=>setOffset(e.target.value)} /></label>
            <button className={button} disabled={locked||!Number.isFinite(draftOffset)||offset===""} onClick={()=>act("Saving alignment…",async()=>{
              open(await seminarRequest<Seminar>(`/${record.id}/alignment`,"POST",{offset_ms:Math.round(draftOffset*1000)}));
            })}>{aligned?"Alignment confirmed":"Confirm alignment"}</button>
          </div>
          <p className="text-xs text-ink/60">Example: speaker 00:10 matches screen 00:13 → offset +3. Changing alignment clears previous analysis.</p>
          <DualVideoPlayer key={record.id+record.videos.speaker.filename+record.videos.screen.filename} session={record} offset={Number.isFinite(draftOffset)?draftOffset:0} seek={seek} />
        </section>
        <section className="rounded-2xl border border-ink/15 bg-white/50 p-5">
          <h2 className="font-semibold">4. Scan a short range</h2>
          <p className="mt-2 text-sm text-ink/70">Choose up to 120 seconds per scan. Sampled images are sent to the configured vision provider and may incur API charges. Scan further ranges to build the review.</p>
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs">Start (speaker seconds)<input className={`${input} w-32`} type="number" min="0" step="0.1" value={start} disabled={locked} onChange={e=>setStart(e.target.value)} /></label>
            <label className="flex flex-col gap-1 text-xs">End (speaker seconds)<input className={`${input} w-32`} type="number" min="0" step="0.1" value={end} disabled={locked} onChange={e=>setEnd(e.target.value)} /></label>
            <label className="flex flex-col gap-1 text-xs">Transcript source<select className={input} value={audio} disabled={locked} onChange={e=>setAudio(e.target.value as View|"none")}>
              <option value="speaker">Speaker audio</option><option value="screen">Screen audio</option><option value="none">No transcript (visual only)</option>
            </select></label>
            <button className={button} disabled={locked||!aligned||!start||!end} onClick={()=>act("Starting scan…",async()=>{
              setRecord(await seminarRequest<Seminar>(`/${record.id}/scan`,"POST",{start_ms:Math.round(Number(start)*1000),end_ms:Math.round(Number(end)*1000),audio_view:audio}));
              setSelected(null);await refresh();
            })}>{running?"Scanning…":"Start visual scan"}</button>
          </div>
          {record.overlap && <p className="mt-3 text-xs text-ink/70">Shared range: {timecode(record.overlap[0])}–{timecode(record.overlap[1])}. A successful rescan replaces observations inside that window.</p>}
          <p aria-live="polite" className="mt-4 text-sm">Status: {record.status.replaceAll("_"," ")} · {record.stage.replaceAll("_"," ")} {record.progress.total>0 && `· ${record.progress.done}/${record.progress.total} batches`}</p>
          {running && <progress className="mt-2 w-full" max={record.progress.total||1} value={record.progress.done} />}
          {record.error && <p role="alert" className="mt-3 text-sm text-red-700">{record.error}</p>}
          {record.warnings.length>0 && <details className="mt-3 text-sm"><summary>{record.warnings.length} scan note(s)</summary><ul className="mt-2 list-disc space-y-1 pl-5">{record.warnings.map((w,i)=><li key={i}>{w}</li>)}</ul></details>}
        </section>
      </>}
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">5. Review observations and evidence</h2><select className={input} aria-label="Filter by analysis dimension" value={dimension} onChange={e=>setDimension(e.target.value as Dimension|"all")}>
          <option value="all">All dimensions</option>{Object.entries(dimensions).map(([key,label])=><option key={key} value={key}>{label}</option>)}
        </select></div>
        <p className="text-xs text-ink/65">AI comments are tentative observations of presentation behavior, not personality or hiring assessments. Check the frames and both original recordings.</p>
        {selectedObservation && <div className="rounded-2xl border border-accent/40 bg-white/60 p-4"><h3 className="font-medium">Evidence · {timecode(selectedObservation.start_ms)}–{timecode(selectedObservation.end_ms)}</h3>
          <div className="mt-3 flex gap-3 overflow-x-auto pb-2">{selectedFrames?.map(frame=><figure key={frame.id} className="w-64 shrink-0">
            <a href={`/api/seminars/${record.id}/frames/${frame.id}`} target="_blank" rel="noreferrer"><img alt={`${frame.view} view at ${timecode(frame.source_ms)}`} src={`/api/seminars/${record.id}/frames/${frame.id}`} className="aspect-video w-full rounded bg-black object-contain" /></a>
            <figcaption className="mt-1 text-xs">{frame.view} · source {timecode(frame.source_ms)} · shared {timecode(frame.time_ms)}</figcaption>
          </figure>)}</div>
        </div>}
        {shown.length===0 && <p className="rounded-xl border border-dashed border-ink/20 p-6 text-sm text-ink/65">No observations to display. Align both views and scan a range, or check scan notes if no action could be supported.</p>}
        <div className="grid gap-4 xl:grid-cols-2">{shown.map(item=><article key={item.id} className="rounded-2xl border border-ink/15 bg-white/60 p-5">
          <div className="flex justify-between gap-3 text-xs text-ink/65"><span>{dimensions[item.dimension]}</span><span>{timecode(item.start_ms)}–{timecode(item.end_ms)}</span></div>
          <h3 className="mt-3 font-medium">Visible action</h3><p className="mt-1 text-sm leading-6">{item.observed_action}</p>
          <h4 className="mt-3 text-xs font-semibold uppercase tracking-wider text-ink/60">AI comment</h4><p className="mt-1 text-sm leading-6">{item.comment}</p>
          <div className="mt-4 flex flex-wrap items-center gap-3"><button className={button} disabled={!aligned} onClick={()=>evidence(item)}>View evidence</button>
            <label className="text-xs">Review<select aria-label={`Review observation at ${timecode(item.start_ms)}`} className={`${input} ml-1`} value={item.review_status} disabled={locked} onChange={e=>{
              const review_status=e.target.value as ReviewStatus;act("Saving review…",async()=>setRecord(await seminarRequest<Seminar>(`/${record.id}/observations/${item.id}`,"PATCH",{review_status})));
            }}><option value="pending">Pending</option><option value="confirmed">Confirmed</option><option value="inaccurate">Inaccurate</option><option value="uncertain">Cannot determine</option></select></label>
          </div>
        </article>)}</div>
        {record.transcript.length>0 && <details className="rounded-2xl border border-ink/15 p-5"><summary className="cursor-pointer font-medium">Transcript context ({record.transcript.length} segments)</summary>
          <div className="mt-3 max-h-80 space-y-2 overflow-y-auto">{record.transcript.map((segment,i)=><button key={`${segment.segment_id}-${i}`} disabled={!aligned} onClick={()=>setSeek(previous=>({ms:segment.start_ms,nonce:(previous?.nonce ?? 0)+1}))} className={`block w-full rounded p-2 text-left text-sm ${segment.uncertain?"bg-amber-100":"bg-white/60"}`}>
            <span className="mr-3 text-xs">{timecode(segment.start_ms)}</span>{segment.text}{segment.uncertain?" · ASR uncertain":""}
          </button>)}</div>
        </details>}
      </section>
    </>}
  </main>;
}
