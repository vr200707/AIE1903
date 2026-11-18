"use client";
/* Saved frames are evidence endpoints, not optimized website assets. */
/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import {reviewHighlights,sentenceGestures} from "@/lib/seminar-review";
import {lastUnlockedStep,availableStep,workflowSteps} from "@/lib/seminar-workflow";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useArchive } from "@/components/ArchiveProvider";
import SegmentEditor from "@/components/seminar/SegmentEditor";
import {groups,groupNames,sharedPart} from "@/lib/seminar-parts";
import AlignmentEvidence from "@/components/seminar/AlignmentEvidence";
import DualVideoPlayer from "@/components/seminar/DualVideoPlayer";
import PolarBear from "@/components/seminar/PolarBear";
import Starfield, { HERO_IMAGE } from "@/components/Starfield";
import GuideModal, { GUIDE_SEEN_KEY } from "@/components/seminar/GuideModal";
import { seminarRequest, uploadSeminarVideo, timecode, type Seminar, type View,
  type Observation, type Dimension, type ReviewStatus, type SeminarPart } from "@/lib/seminar";

const dimensions: Record<Dimension,string> = {audience_orientation:"Audience orientation",gesture_usage:"Gesture usage",posture_movement:"Posture and movement"};
const input="rounded-lg border border-ink/20 bg-white/80 px-3 py-2 text-sm transition focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:opacity-50";
const button="rounded-full bg-ink px-5 py-2 text-sm text-white transition hover:bg-ink/90 disabled:opacity-40";

export default function SeminarPage() {
  const {archives}=useArchive();
  const [files,setFiles]=useState<Partial<Record<View,File>>>({});
  const [omitScreen,setOmitScreen]=useState(false);
  const [record,setRecord]=useState<Seminar|null>(null);
  const [candidate,setCandidate]=useState("");
  const [title,setTitle]=useState("");
  const [offset,setOffset]=useState("0");
  const [step,setStep]=useState(0);
  const [partSelection,setPartSelection]=useState<string[]>([]);
  const [partsDirty,setPartsDirty]=useState(false);
  const [audio,setAudio]=useState<View|"none">("speaker");
  const [busy,setBusy]=useState("");
  const [error,setError]=useState("");
  const [offsetToast,setOffsetToast]=useState<{text:string; reliable:boolean}|null>(null);
  const [seek,setSeek]=useState<{ms:number;nonce:number}|null>(null);
  const [selected,setSelected]=useState<string|null>(null);
  const [gestureNotes,setGestureNotes]=useState(false);
  const [dimension,setDimension]=useState<Dimension|"all">("all");
  // 首次访问自动弹出说明：用 external store 读取 localStorage，避免 effect 内 setState
  const guideUnseen=useSyncExternalStore(
    onChange=>{window.addEventListener("storage",onChange);return()=>window.removeEventListener("storage",onChange);},
    ()=>!window.localStorage.getItem(GUIDE_SEEN_KEY),
    ()=>false,
  );
  const [guideDismissed,setGuideDismissed]=useState(false);
  const [manualGuideOpen,setManualGuideOpen]=useState(false);
  const guideOpen=manualGuideOpen||(guideUnseen&&!guideDismissed);
  const closeGuide=useCallback(()=>{
    setManualGuideOpen(false);
    setGuideDismissed(true);
    window.localStorage.setItem(GUIDE_SEEN_KEY,"1");
  },[]);
  // 北极熊庆祝信号：关键任务成功时递增，触发跳跃与开心表情
  const [celebrateNonce,setCelebrateNonce]=useState(0);
  const cheer=useCallback(()=>setCelebrateNonce(n=>n+1),[]);
  const running=record?.status==="analyzing";
  const preparing=record?.outline_job?.status==="running";
  const locked=Boolean(busy)||running||preparing;
  const wasRunningRef=useRef(false);
  useEffect(()=>{
    if(wasRunningRef.current && !running) cheer();
    wasRunningRef.current=running;
  },[running,cheer]);
  const draftOffset=Number(offset);
  const aligned=Boolean(record?.videos.speaker && (record.recordings_submitted ?? record.aligned) && (!record.videos.screen || (record.aligned && Math.round(draftOffset*1000)===record.offset_ms)));
  const currentId=record?.id;
  const refresh=useCallback(async()=>{window.dispatchEvent(new Event("seminars-updated"));},[]);
  useEffect(()=>{
    let cancelled=false;
    queueMicrotask(()=>{if(!cancelled)setCandidate(new URLSearchParams(window.location.search).get("profile_id") ?? "");});
    return()=>{cancelled=true;};
  },[]);
  useEffect(()=>{
    if(!currentId || (!running&&!preparing)) return;
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
  },[currentId,running,preparing,refresh]);
  useEffect(()=>{
    let cancelled=false;
    async function restore() {
      const params=new URLSearchParams(window.location.search),id=params.get("session");
      if(!id)return;
      try {
        const saved=await seminarRequest<Seminar>(`/${id}`);
        if(cancelled)return;
        setRecord(saved);setOffset(String(saved.offset_ms/1000));
        const requested=params.has("step")?Number(params.get("step")):lastUnlockedStep(saved);
        const maximum=lastUnlockedStep(saved);
        setStep(availableStep(requested,maximum,workflowSteps(saved)));
      }catch(e){if(!cancelled)setError(String(e));}
    }
    restore();
    return()=>{cancelled=true;};
  },[]);
  useEffect(()=>{
    if(!currentId||running||preparing||partsDirty||busy)return;
    let cancelled=false;
    const sync=async()=>{
      try {
        const updated=await seminarRequest<Seminar>(`/${currentId}`);
        if(!cancelled)setRecord(updated);
      } catch { /* Keep the loaded workspace on transient connection errors. */ }
    };
    sync();
    const timer=setInterval(sync,5000);
    window.addEventListener("focus",sync);
    return()=>{cancelled=true;clearInterval(timer);window.removeEventListener("focus",sync);};
  },[currentId,running,preparing,partsDirty,busy]);
  function go(next:number,item:Seminar|null=record) {
    next=availableStep(next,item===record&&(Object.keys(files).length||omitScreen)?1:lastUnlockedStep(item,item===record?Boolean(aligned):Boolean(item?.aligned),item===record?partsDirty:false),workflowSteps(item));
    setStep(next);
    const url=new URL(window.location.href);url.searchParams.set("step",String(next));
    if(item)url.searchParams.set("session",item.id);
    window.history.pushState(null,"",url);
    window.scrollTo({top:0,behavior:"smooth"});
  }
  const steps=["Candidate","Videos","Alignment","Structure","Scan","Review"];
  const visibleSteps=workflowSteps(record);
  const position=visibleSteps.indexOf(step);
  const maximumStep=Object.keys(files).length || omitScreen ? 1 : lastUnlockedStep(record,Boolean(aligned),partsDirty);
  function reachable(index:number) { return index>=0 && index<=maximumStep && visibleSteps.includes(index); }
  useEffect(()=>{
    const clamp=()=>{
      const url=new URL(window.location.href);
      const requested=Number(url.searchParams.get("step")??0);
      const safe=availableStep(requested,maximumStep,workflowSteps(record));
      setStep(safe);
      if(requested!==safe){url.searchParams.set("step",String(safe));window.history.replaceState(null,"",url);}
    };
    window.addEventListener("popstate",clamp);
    let cancelled=false;
    if(step>maximumStep)queueMicrotask(()=>{if(!cancelled){setStep(maximumStep);const url=new URL(window.location.href);url.searchParams.set("step",String(maximumStep));window.history.replaceState(null,"",url);}});
    return()=>{cancelled=true;window.removeEventListener("popstate",clamp);};
  },[maximumStep,step,record]);
  async function saveParts(parts:SeminarPart[]) {
    if(!record)return;
    setBusy("Saving parts…");setError("");
    try {const saved=await seminarRequest<Seminar>(`/${record.id}/parts`,"PUT",{revision:record.segments_revision??0,parts});setRecord(saved);setPartsDirty(false);setPartSelection([]);}
    catch(e){setError(String(e));throw e;}finally{setBusy("");}
  }
  useEffect(()=>{
    if(!offsetToast)return;
    const timer=setTimeout(()=>setOffsetToast(null),3000);
    return()=>clearTimeout(timer);
  },[offsetToast]);
  function notifyOffset(item: Seminar) {
    const suggestion=item.alignment_suggestion;
    if(!suggestion)return;
    setOffsetToast({reliable:suggestion.reliable,text:suggestion.reliable
      ? `Audio reference: ${(suggestion.offset_ms! / 1000).toFixed(2)}s. Visual alignment is not verified; adjust if needed.`
      : suggestion.message});
  }
  function open(item: Seminar) {
    if (item.aligned) setOffsetToast(null);
    else notifyOffset(item);
    setRecord(item);setOffset(String((!item.aligned && item.alignment_suggestion?.reliable ? item.alignment_suggestion.offset_ms ?? item.offset_ms : item.offset_ms)/1000));setSelected(null);setSeek(null);setError("");

  }
  async function act(label: string, work: ()=>Promise<void>) {
    setBusy(label);setError("");
    try {await work();}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy("");}
  }
  async function submitRecordings() {
    if(!record || (!files.speaker&&!record.videos.speaker))return;
    await act("Submitting recordings…",async()=>{
      let uploaded=record;
      for(const view of ["speaker","screen"] as const) {
        const file=files[view];
        if(file && !(view==="screen"&&omitScreen)) {
          uploaded=await uploadSeminarVideo(record.id,view,file,p=>setBusy(`Uploading ${view}: ${p}%`));
          setRecord(uploaded);
        }
      }
      const submitted=await seminarRequest<Seminar>(`/${record.id}/videos/submit`,"POST",{include_screen:!omitScreen});
      open(submitted);setFiles({});setOmitScreen(false);setPartsDirty(false);setPartSelection([]);setAudio("speaker");
      if(submitted.videos.screen) {
        go(2,submitted);
        setBusy("Estimating audio alignment…");
        open(await seminarRequest<Seminar>(`/${submitted.id}/alignment/estimate`,"POST"));
      } else go(3,submitted);
      cheer();await refresh();
    });
  }
  function evidence(item:Observation) {
    setSelected(item.id);setSeek(previous=>({ms:item.start_ms,nonce:(previous?.nonce ?? 0)+1}));
    document.getElementById("recordings")?.scrollIntoView({behavior:"smooth",block:"start"});
  }
  const selectedObservation=record?.observations.find(o=>o.id===selected);
  const selectedFrames=selectedObservation ? record?.frames.filter(f=>selectedObservation.frame_ids.includes(f.id)).sort((a,b)=>a.time_ms-b.time_ms):[];
  const highlights=reviewHighlights(record?.observations??[]);
  const shown=highlights.filter(o=>dimension==="all"||o.dimension===dimension);

  return (
    <div className="relative min-h-screen text-ink">
      <Starfield image={HERO_IMAGE} calm />
      <GuideModal open={guideOpen} onClose={closeGuide} />
      <PolarBear step={step} stepTitle={steps[step]} position={position} total={visibleSteps.length} working={running||preparing} celebrate={celebrateNonce} />
      <main className="seminar-main w-full max-w-7xl space-y-6 px-5 py-8 md:px-10 lg:mr-auto lg:max-w-[calc(100%-17rem)] xl:ml-14 2xl:ml-24">
    {offsetToast && <div role="status" aria-live="polite" className={`fixed right-5 top-5 z-50 max-w-sm animate-pop rounded-xl border px-5 py-4 text-sm shadow-xl ${offsetToast.reliable ? "border-teal-600/30 bg-teal-50 text-teal-950" : "border-amber-500/40 bg-amber-50 text-amber-950"}`}>
      {offsetToast.text}
    </div>}
    <header className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/" className="inline-flex items-center gap-2 rounded-full border border-ink/20 glass-bg px-4 py-2 text-sm font-medium transition hover:border-accent/50 hover:text-accent">
          <span aria-hidden="true">←</span> Back to candidate profiles
        </Link>
        <button type="button" onClick={()=>setManualGuideOpen(true)} className="rounded-full border border-ink/20 glass-bg px-4 py-2 text-sm transition hover:border-accent/50 hover:text-accent">How it works</button>
      </div>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h1 className="break-words text-4xl font-semibold sm:text-5xl">{archives.find(a=>a.profileId===(step===0?candidate:record?.profile_id))?.name ?? "Seminar Analysis"}</h1>
          {(step===0?title.trim():record?.title) && <p className="mt-2 break-words text-lg text-ink/75">{step===0?title.trim():record?.title}</p>}
        </div>
        <nav aria-label="Step navigation" className="flex w-fit max-w-full shrink-0 items-center gap-2 self-end rounded-xl border border-ink/15 glass-bg p-2 shadow-sm lg:self-start">
          <button className="rounded-full bg-ink px-3 py-2 text-xs text-white disabled:opacity-40" disabled={step===0||Boolean(busy)} onClick={()=>go(visibleSteps[position-1])}>← Previous</button>
          <span title={partsDirty?"Save your part edits before scanning":undefined} className="whitespace-nowrap px-1 text-center text-xs text-ink/60">{steps[step]} · {position+1}/{visibleSteps.length}{partsDirty?" *":""}</span>
          <button className="rounded-full bg-ink px-3 py-2 text-xs text-white disabled:opacity-40" disabled={step===5||Boolean(busy)||!reachable(visibleSteps[position+1])} onClick={()=>go(visibleSteps[position+1])}>Next →</button>
        </nav>
      </div>
    </header>
    {error && <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-800">{error}</p>}
    {busy && <p role="status" className="text-sm">{busy}</p>}
    <nav aria-label="Seminar workflow" className="flex flex-wrap gap-2">{visibleSteps.map((i,order)=><button key={steps[i]} aria-current={step===i?"step":undefined} disabled={!reachable(i)||Boolean(busy)} onClick={()=>go(i)} className={`rounded-full border px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-30 ${step===i?"border-ink bg-ink text-white":"border-ink/20 glass-bg transition hover:border-accent/40 hover:text-ink"}`}>{!reachable(i)?"🔒 ":""}{order+1}. {steps[i]}</button>)}</nav>
    {(running||preparing)&&<p role="status" className="rounded-xl glass-bg p-3 text-sm">{preparing?record?.outline_job?.message:`Scanning · ${record?.progress.done}/${record?.progress.total} batches. You can move between steps while this runs.`}</p>}
    <section hidden={step!==0} className="rounded-2xl border border-ink/15 glass-bg p-5">
      <h2 className="font-semibold">1. Choose a candidate and seminar</h2>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs">Candidate<select className={input} value={candidate} disabled={locked} onChange={e=>setCandidate(e.target.value)}>
          <option value="">Choose saved candidate…</option>{archives.map(a=><option key={a.profileId} value={a.profileId}>{a.name}</option>)}
        </select></label>
        <label className="flex flex-col gap-1 text-xs">Seminar title<input className={input} value={title} placeholder="Enter a seminar title" required maxLength={200} disabled={locked} onChange={e=>setTitle(e.target.value)} /></label>
        <button className={button} disabled={locked||!archives.find(a=>a.profileId===candidate)?.name?.trim()||!title.trim()} onClick={()=>act("Creating seminar…",async()=>{
          const created=await seminarRequest<Seminar>("","POST",{profile_id:candidate,title:title.trim()});open(created);setFiles({});setOmitScreen(false);setPartsDirty(false);go(1,created);await refresh();cheer();
        })}>Create seminar</button>
      </div>
      {archives.length===0 && <p className="mt-3 text-sm text-ink/70">Analyze a candidate’s documents first to create a linked seminar.</p>}

    </section>
    {record && <>
      <section hidden={step!==1} className="rounded-2xl border border-ink/15 glass-bg p-5">
        <h2 className="font-semibold">2. Add presentation recordings</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">{(["speaker","screen"] as const).map(view=>{
          const video=view==="screen"&&omitScreen?undefined:record.videos[view];
          const pending=files[view];
          return <div key={view} className="flex flex-col gap-3 rounded-xl border border-dashed border-ink/25 bg-white/55 p-5">
            <div>
              <p className="font-medium">{view==="speaker"?"Speaker recording · Required":"Shared-screen recording · Optional"}</p>
              <p className="mt-1 text-xs text-ink/60">{view==="speaker"?"Camera view showing the presenter":"Optional slide or screen-share view"}</p>
            </div>
            {pending ? <div className="rounded-lg border border-accent/30 px-3 py-2.5 text-sm">{pending.name} · Ready to submit</div> : video ? (
              <div className="flex items-center gap-2 rounded-lg border border-accent/30 bg-accent/[0.08] px-3 py-2.5 text-sm">
                <span aria-hidden="true" className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-xs text-white">✓</span>
                <span className="min-w-0 flex-1 truncate font-medium">{video.display_name}</span>
                <span className="shrink-0 text-xs text-ink/60">{timecode(video.duration_ms)}</span>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-ink/20 bg-ink/[0.03] px-3 py-2.5 text-sm text-ink/50">No file selected — click the button below to choose one</div>
            )}
            <label aria-disabled={locked} className={`inline-flex w-fit cursor-pointer items-center gap-2 rounded-full bg-ink px-6 py-2.5 text-sm font-medium text-white transition hover:bg-ink/90 ${locked?"pointer-events-none opacity-40":""}`}>
              <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <path d="M8 11V2m0 0L4.5 5.5M8 2l3.5 3.5" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M2 11.5V13a1.5 1.5 0 001.5 1.5h9A1.5 1.5 0 0014 13v-1.5" strokeLinecap="round" />
              </svg>
              {pending || video ? "Replace video" : "Choose video file"}
              <input aria-label={`Upload ${view} recording`} type="file" accept=".mp4,.m4v,.mov,.webm,.mkv" disabled={locked} className="hidden"
                onChange={e=>{const file=e.target.files?.[0];e.target.value="";if(file){setFiles(previous=>({...previous,[view]:file}));if(view==="screen")setOmitScreen(false);}}} />
            </label>
            {(pending || (view==="screen"&&video)) && <button className="w-fit text-sm underline" disabled={locked} onClick={()=>{setFiles(previous=>{const next={...previous};delete next[view];return next;});if(view==="screen")setOmitScreen(true);}}>Remove {view==="screen"?"screen recording":"selected file"}</button>}
          </div>;
        })}</div>
        <p className="mt-3 text-xs text-ink/60">Speaker recording is required. Shared-screen recording is optional. Files are uploaded only when you submit. Speaker-only sessions skip alignment. Replacing a recording resets its analysis. MP4 with H.264/AAC is recommended for browser playback.</p>
        <button className={`${button} mt-4 disabled:cursor-not-allowed`} disabled={locked||(!files.speaker&&!record.videos.speaker)} onClick={submitRecordings}>Submit recordings</button>
      </section>
      {record.videos.speaker && <>
        {record.videos.screen &&
        <section hidden={step!==2} id="recordings" className="scroll-mt-4 space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="mr-auto"><h2 className="font-semibold">3. Align the recordings</h2><p className="mt-1 text-xs text-ink/70">Screen time = speaker time + offset. Check the start, middle and end before confirming.</p></div>
            <label className="flex flex-col gap-1 text-xs">Screen offset (seconds)<input type="number" step="0.1" className={`${input} w-32`} value={offset} disabled={locked} onChange={e=>setOffset(e.target.value)} /></label>
            <button className={button} disabled={locked} onClick={()=>act("Estimating audio alignment…",async()=>{
              const estimated=await seminarRequest<Seminar>(`/${record.id}/alignment/estimate`,"POST");
              setRecord(estimated);notifyOffset(estimated);
              if(estimated.alignment_suggestion?.reliable) setOffset(String(estimated.alignment_suggestion.offset_ms!/1000));
            })}>Estimate offset</button>
            <button className={button} disabled={locked||!Number.isFinite(draftOffset)||offset===""} onClick={()=>act("Saving alignment…",async()=>{
              const saved=await seminarRequest<Seminar>(`/${record.id}/alignment`,"POST",{offset_ms:Math.round(draftOffset*1000)});open(saved);setPartsDirty(false);setPartSelection([]);go(3,saved);cheer();
            })}>{aligned?"Alignment confirmed":"Confirm alignment"}</button>
          </div>
          <p className="text-xs text-ink/60">Example: speaker 00:10 matches screen 00:13 → offset +3. Changing alignment clears previous analysis.</p>
          <AlignmentEvidence key={`alignment-evidence:${record.id}:${record.videos.speaker.filename}:${record.videos.screen.filename}`} session={record} active={step===2} disabled={locked} onApply={seconds=>setOffset(String(Math.round(seconds*1000)/1000))} />
          <DualVideoPlayer key={`alignment-player:${record.id}:${record.videos.speaker.filename}:${record.videos.screen.filename}`} session={record} active={step===2} offset={Number.isFinite(draftOffset)?draftOffset:0} seek={seek} />
        </section>}
        <div hidden={step!==3}>
          <SegmentEditor key={`unified:${record.id}:${record.segments_revision??0}`} session={record} locked={Boolean(locked)} active={step===3} onDirty={setPartsDirty} onSave={saveParts}
            onPrepare={(script,generate)=>act("Starting transcript preparation…",async()=>setRecord(await seminarRequest<Seminar>(`/${record.id}/outline`,"POST",{script,generate})))}
            onImport={(content,view)=>act("Importing subtitles…",async()=>setRecord(await seminarRequest<Seminar>(`/${record.id}/transcript`,"PUT",{content,view})))} />
        </div>
        <section hidden={step!==4} className="rounded-2xl border border-ink/15 glass-bg p-5">
          <h2 className="font-semibold">{visibleSteps.indexOf(4)+1}. Choose parts to scan</h2>
          <p className="mt-2 text-sm text-ink/70">Choose any combination of saved parts. {record.videos.screen?"Only footage shared by both recordings is scanned. Parts crossing its edges are clipped to the shared range.":"The selected parts of the speaker recording will be scanned."}</p>
          <div className="my-4 grid gap-4 sm:grid-cols-2">{groups.map(group=>{const parts=(record.segments??[]).filter(p=>p.group===group),available=parts.filter(p=>sharedPart(p,record.overlap));return <div key={group} className={`rounded-xl border p-4 ${parts.length?"border-ink/20 glass-bg":"border-dashed border-slate-300 bg-slate-100/60 text-slate-500"}`}><label className="flex items-center gap-2 font-medium"><input type="checkbox" disabled={locked||!available.length} checked={Boolean(available.length)&&available.every(p=>partSelection.includes(p.id))} onChange={e=>setPartSelection(ids=>e.target.checked?[...new Set([...ids,...available.map(p=>p.id)])]:ids.filter(id=>!available.some(p=>p.id===id)))}/>{groupNames[group]}</label>{!parts.length&&<p className="mt-2 text-xs">Optional · not present</p>}{parts.map(p=>{const range=sharedPart(p,record.overlap);return <label key={p.id} className="mt-3 flex items-start gap-2 text-sm"><input type="checkbox" disabled={locked||!range} checked={partSelection.includes(p.id)} onChange={e=>setPartSelection(ids=>e.target.checked?[...ids,p.id]:ids.filter(id=>id!==p.id))}/><span>{p.title}<span className="block text-xs text-ink/60">{timecode(p.start_ms)}–{timecode(p.end_ms)}{!range?" · outside shared footage":range[0]!==p.start_ms||range[1]!==p.end_ms?` · scan ${timecode(range[0])}–${timecode(range[1])}`:""}</span></span></label>;})}</div>;})}</div>
          <p className="mb-4 text-sm">{partSelection.length} parts selected · {timecode((record.segments??[]).filter(p=>partSelection.includes(p.id)).reduce((sum,p)=>{const r=sharedPart(p,record.overlap);return sum+(r?r[1]-r[0]:0);},0))} of footage</p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs">Transcript source<select className={input} value={audio} disabled={locked} onChange={e=>setAudio(e.target.value as View|"none")}>
              <option value="speaker">Speaker transcript (reuse if prepared)</option>{record.videos.screen&&<option value="screen">Screen audio</option>}<option value="none">No transcript (visual only)</option>
            </select></label>
            <button className={button} disabled={locked||!aligned||!partSelection.length||partsDirty} onClick={()=>act("Starting selected-part scan…",async()=>{
              setRecord(await seminarRequest<Seminar>(`/${record.id}/scan-parts`,"POST",{revision:record.segments_revision??0,part_ids:partSelection,audio_view:audio}));
              setSelected(null);await refresh();
            })}>{running?"Scanning…":"Scan selected parts"}</button>
          </div>
          {record.overlap && <p className="mt-3 text-xs text-ink/70">{record.videos.screen?"Shared range":"Speaker range"}: {timecode(record.overlap[0])}–{timecode(record.overlap[1])}. A successful rescan replaces observations inside that window.</p>}
          <p aria-live="polite" className="mt-4 text-sm">Status: {record.status.replaceAll("_"," ")} · {record.stage.replaceAll("_"," ")} {record.progress.total>0 && `· ${record.progress.done}/${record.progress.total} batches`}</p>
          {running && <progress className="mt-2 w-full" max={record.progress.total||1} value={record.progress.done} />}
          {record.error && <p role="alert" className="mt-3 text-sm text-red-700">{record.error}</p>}
          {record.warnings.length>0 && <details className="mt-3 text-sm"><summary>{record.warnings.length} scan note(s)</summary><ul className="mt-2 list-disc space-y-1 pl-5">{record.warnings.map((w,i)=><li key={i}>{w}</li>)}</ul></details>}
        </section>
      </>}
      <section hidden={step!==5} className="space-y-4">
        {step===5 && record.videos.speaker&&<DualVideoPlayer session={record} offset={record.offset_ms/1000} seek={seek}/>}
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">{visibleSteps.indexOf(5)+1}. Key presentation feedback</h2><select className={input} aria-label="Filter by analysis dimension" value={dimension} onChange={e=>setDimension(e.target.value as Dimension|"all")}>
          <option value="all">All dimensions</option>{Object.entries(dimensions).map(([key,label])=><option key={key} value={key}>{label}</option>)}
        </select></div>
        <p className="text-xs text-ink/65">Up to 6 key observations, with similar repeated actions omitted and at most 2 per dimension. AI comments are tentative observations of presentation behavior, not personality or hiring assessments. Check the frames and original recordings.</p>
        {selectedObservation && <div className="rounded-2xl border border-accent/40 glass-bg p-4"><h3 className="font-medium">Evidence · {timecode(selectedObservation.start_ms)}–{timecode(selectedObservation.end_ms)}</h3>
          <div className="mt-3 flex gap-3 overflow-x-auto pb-2">{selectedFrames?.map(frame=><figure key={frame.id} className="w-64 shrink-0">
            <a href={`/api/seminars/${record.id}/frames/${frame.id}`} target="_blank" rel="noreferrer"><img alt={`${frame.view} view at ${timecode(frame.source_ms)}`} src={`/api/seminars/${record.id}/frames/${frame.id}`} className="aspect-video w-full rounded bg-black object-contain" /></a>
            <figcaption className="mt-1 text-xs">{frame.view} · source {timecode(frame.source_ms)} · shared {timecode(frame.time_ms)}</figcaption>
          </figure>)}</div>
        </div>}
        {record.error&&<p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{record.error}</p>}
        {record.warnings.length>0&&<details className="rounded-xl bg-amber-50 p-3 text-sm"><summary>{record.warnings.length} scan notes</summary>{record.warnings.map((w,i)=><p key={i}>{w}</p>)}</details>}
        {shown.length===0 && <p className="rounded-xl border border-dashed border-ink/20 p-6 text-sm text-ink/65">No observations to display yet. Choose saved parts to scan, or check scan notes if no action could be supported.</p>}
        <div className="grid gap-4 xl:grid-cols-2">{shown.map(item=><article key={item.id} className="rounded-2xl border border-ink/15 glass-bg p-5">
          <div className="flex justify-between gap-3 text-xs text-ink/65"><span>{dimensions[item.dimension]}</span><span>{timecode(item.start_ms)}–{timecode(item.end_ms)}</span></div>
          <p className="mt-2 text-xs text-ink/60">{(record.segments??[]).filter(p=>p.start_ms<=item.start_ms&&p.end_ms>item.start_ms).map(p=>`${groupNames[p.group]} · ${p.title}`).join(", ")}</p><h3 className="mt-3 font-medium">Visible action</h3><p className="mt-1 text-sm leading-6">{item.observed_action}</p>
          <h4 className="mt-3 text-xs font-semibold uppercase tracking-wider text-ink/60">AI comment</h4><p className="mt-1 text-sm leading-6">{item.comment}</p>
          <div className="mt-4 flex flex-wrap items-center gap-3"><button className={button} disabled={!aligned} onClick={()=>evidence(item)}>View evidence</button>
            <label className="text-xs">Review<select aria-label={`Review observation at ${timecode(item.start_ms)}`} className={`${input} ml-1`} value={item.review_status} disabled={locked} onChange={e=>{
              const review_status=e.target.value as ReviewStatus;act("Saving review…",async()=>setRecord(await seminarRequest<Seminar>(`/${record.id}/observations/${item.id}`,"PATCH",{review_status})));
            }}><option value="pending">Pending</option><option value="confirmed">Confirmed</option><option value="inaccurate">Inaccurate</option><option value="uncertain">Cannot determine</option></select></label>
          </div>
        </article>)}</div>
        {record.observations.length>0&&<details className="rounded-xl border border-ink/15 p-4"><summary className="cursor-pointer text-sm">All saved observations ({record.observations.length}) · review history</summary>
          <p className="mt-2 text-xs text-ink/60">Inspect omitted observations or change a previous review decision.</p>
          <div className="mt-3 max-h-80 space-y-3 overflow-y-auto">{record.observations.map(item=><div key={item.id} className="rounded-lg glass-bg p-3 text-sm"><p>{timecode(item.start_ms)} · {item.observed_action}</p><div className="mt-2 flex items-center gap-3"><button className="text-xs underline" disabled={!aligned} onClick={()=>evidence(item)}>View evidence</button><select aria-label={`Saved review ${item.id}`} className={input} value={item.review_status} disabled={locked} onChange={e=>{const review_status=e.target.value as ReviewStatus;act("Saving review…",async()=>setRecord(await seminarRequest<Seminar>(`/${record.id}/observations/${item.id}`,"PATCH",{review_status})));}}><option value="pending">Pending</option><option value="confirmed">Confirmed</option><option value="inaccurate">Inaccurate</option><option value="uncertain">Cannot determine</option></select></div></div>)}</div>
        </details>}
        {record.transcript.length>0 && <details className="rounded-2xl border border-ink/15 p-5"><summary className="cursor-pointer font-medium">Transcript context ({record.transcript.length} segments)</summary>
          <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" role="switch" checked={gestureNotes} onChange={e=>setGestureNotes(e.target.checked)}/>Gesture notes</label>
          {gestureNotes&&<p className="mt-2 text-xs text-ink/60">Notes use overlapping visual evidence from the scan. They describe the surrounding interval, not necessarily the exact spoken word. No additional API requests.</p>}
          <div className="mt-3 max-h-80 space-y-2 overflow-y-auto">{record.transcript.map((segment,i)=><button key={`${segment.segment_id}-${i}`} disabled={!aligned} onClick={()=>setSeek(previous=>({ms:segment.start_ms,nonce:(previous?.nonce ?? 0)+1}))} className={`block w-full rounded p-2 text-left text-sm ${segment.uncertain?"bg-amber-100":"glass-bg"}`}>
            <span className="mr-3 text-xs">{timecode(segment.start_ms)}</span>{segment.text}{segment.uncertain?" · ASR uncertain":""}
            {gestureNotes&&<span className="mt-2 block border-l-2 border-teal-500/40 pl-3 text-xs text-ink/70">Gesture: {sentenceGestures(segment,record.observations).map(o=>o.observed_action).join("; ")||"No supported gesture description for this interval."}</span>}
          </button>)}</div>
        </details>}
      </section>
    </>}

    </main>
    </div>
  );
}
