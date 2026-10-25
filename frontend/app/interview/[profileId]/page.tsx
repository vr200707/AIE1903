"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import Starfield from "@/components/Starfield";
import { useArchive } from "@/components/ArchiveProvider";
import { useIdentity } from "@/components/IdentityProvider";
import { EvidenceBadge } from "@/components/EvidenceBadge";
import { InterviewReportView } from "@/components/interview/InterviewReportView";
import { getProfile } from "@/lib/api";
import { getArchive } from "@/lib/archive";
import {
  clearInterviewSession,
  competencyLabel,
  createInterviewSession,
  createQuestionSet,
  formatFileSize,
  getInterviewReport,
  getInterviewSession,
  getQuestionDocument,
  getQuestionSet,
  readInterviewSession,
  startInterviewAnalysis,
  uploadInterviewVideo,
  writeInterviewSession,
  type InterviewReport,
  type InterviewSession,
  type QuestionSet,
} from "@/lib/interview";

type Phase = "questions" | "video" | "analyzing" | "report";

const MAX_VIDEO_BYTES = 500 * 1024 * 1024;
const ALLOWED_VIDEO_SUFFIXES = [".mp4", ".m4v", ".mov", ".webm", ".mkv"];
const QUESTION_COUNTS = [5, 6, 7];
const ANALYSIS_STAGES = [
  { key: "queued", label: "Preparing the recording" },
  { key: "transcribing", label: "Transcribing English audio" },
  { key: "aligning_answers", label: "Aligning answers to questions" },
  { key: "analyzing_questions", label: "Analysing evidence and delivery" },
  { key: "completed", label: "Assembling the report" },
];

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Please retry.";
}

function Stepper({
  phase,
  hasQuestions,
  hasInterview,
  hasReport,
  onChange,
}: {
  phase: Phase;
  hasQuestions: boolean;
  hasInterview: boolean;
  hasReport: boolean;
  onChange: (phase: Phase) => void;
}) {
  const items: Array<{
    phase: Phase;
    step: string;
    label: string;
    enabled: boolean;
  }> = [
    { phase: "questions", step: "01", label: "Questions", enabled: true },
    {
      phase: "video",
      step: "02",
      label: "Video",
      enabled: hasQuestions && hasInterview,
    },
    {
      phase: "report",
      step: "03",
      label: "Report",
      enabled: hasReport && hasQuestions,
    },
  ];
  const active =
    phase === "analyzing" ? 2 : phase === "report" ? 3 : phase === "video" ? 2 : 1;

  return (
    <nav
      aria-label="Interview workflow"
      className="flex items-center gap-1 rounded-full border border-white/[0.08] bg-black/20 p-1"
    >
      {items.map((item, index) => {
        const done = index + 1 < active;
        const current = index + 1 === active;
        return (
          <button
            key={item.phase}
            type="button"
            disabled={!item.enabled}
            onClick={() => onChange(item.phase)}
            className={`flex items-center gap-2 rounded-full px-3 py-2 text-[11px] transition sm:px-4 ${
              current
                ? "bg-white/[0.08] text-white"
                : done
                  ? "text-white/55 hover:bg-white/[0.04]"
                  : "text-white/25"
            } disabled:cursor-not-allowed`}
          >
            <span
              className={`font-mono text-[9px] ${
                current ? "text-accent" : done ? "text-emerald-300/60" : "text-white/20"
              }`}
            >
              {item.step}
            </span>
            <span className="hidden sm:inline">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

function OrbitLoader({ small = false }: { small?: boolean }) {
  return (
    <span
      className={`relative inline-grid shrink-0 place-items-center ${
        small ? "h-5 w-5" : "h-16 w-16"
      }`}
      aria-hidden="true"
    >
      <span className="absolute inset-0 animate-ring-spin rounded-full border border-accent/25 border-t-accent" />
      <span className="absolute inset-[18%] animate-ring-spin-rev rounded-full border border-sky-300/20 border-b-sky-300/80" />
      <span className={`${small ? "text-[9px]" : "text-xl"} text-accent-soft`}>✦</span>
    </span>
  );
}

function QuestionCard({
  question,
  index,
}: {
  question: QuestionSet["questions"][number];
  index: number;
}) {
  return (
    <article
      className="animate-pop rounded-2xl border border-white/[0.08] bg-white/[0.025] p-5 transition hover:border-white/[0.14] hover:bg-white/[0.035] sm:p-6"
      style={{ animationDelay: `${Math.min(index * 0.05, 0.3)}s` }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          <span className="font-mono text-[11px] text-accent/65">
            {String(question.order).padStart(2, "0")}
          </span>
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.18em] text-white/30">
              {competencyLabel(question.competency)}
            </p>
            <h3 className="mt-2 text-base font-medium leading-relaxed text-white/90 sm:text-lg">
              {question.text}
            </h3>
          </div>
        </div>
        <span className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-[10px] text-white/40">
          ~{question.answer_seconds}s
        </span>
      </div>

      <p className="mt-4 border-l border-accent/30 pl-3 text-xs leading-relaxed text-white/45">
        {question.why_it_matters}
      </p>

      <details className="mt-4 border-t border-white/[0.07] pt-3">
        <summary className="cursor-pointer text-[11px] text-white/35 transition hover:text-white/65">
          Evidence behind this question · {question.source_claims.length} claim
          {question.source_claims.length === 1 ? "" : "s"}
        </summary>
        <div className="mt-3 space-y-2.5">
          {question.source_claims.map((claim) => (
            <div
              key={claim.claim_id}
              className="rounded-xl border border-white/[0.06] bg-black/10 p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[10px] text-accent/60">{claim.claim_id}</span>
                {claim.evidence_statuses.map((status) => (
                  <EvidenceBadge key={status} status={status} />
                ))}
              </div>
              <p className="mt-2 text-xs leading-relaxed text-white/55">{claim.claim}</p>
              {claim.evidence.length > 0 && (
                <div className="mt-2 space-y-1.5">
                  {claim.evidence.slice(0, 2).map((item, evidenceIndex) => (
                    <p
                      key={`${claim.claim_id}-${evidenceIndex}`}
                      className="text-[11px] leading-relaxed text-white/30"
                    >
                      <span className="text-white/45">{item.source}:</span> {item.excerpt}
                    </p>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </details>
    </article>
  );
}

function AnalysisStage({ interview }: { interview: InterviewSession }) {
  const currentIndex = Math.max(
    0,
    ANALYSIS_STAGES.findIndex((item) => item.key === interview.stage),
  );
  const displayedIndex = interview.stage === "completed" ? 4 : currentIndex;

  return (
    <section className="glass relative overflow-hidden rounded-2xl px-5 py-8 sm:px-8 sm:py-10">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(245,165,36,0.08),transparent_45%)]" />
      <div className="relative grid gap-8 lg:grid-cols-[180px_minmax(0,1fr)] lg:items-center">
        <div className="flex justify-center">
          <div className="relative grid h-36 w-36 place-items-center">
            <span className="absolute inset-2 animate-ring-spin rounded-full border border-accent/20 border-t-accent/80" />
            <span className="absolute inset-8 animate-ring-spin-rev rounded-full border border-sky-300/15 border-b-sky-300/70" />
            <span className="absolute inset-[42%] rounded-full bg-accent/80 shadow-[0_0_34px_rgba(245,165,36,0.8)]" />
            <span className="animate-sparkle absolute left-1 top-4 text-sm text-accent">✦</span>
            <span
              className="animate-sparkle absolute bottom-3 right-1 text-xs text-sky-200"
              style={{ animationDelay: "1.1s" }}
            >
              ✦
            </span>
          </div>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-[0.28em] text-accent/65">
            Interview analysis
          </p>
          <h2 className="mt-3 font-display text-3xl text-white sm:text-4xl">
            Reading the recording
            <span className="block italic text-accent">against the evidence.</span>
          </h2>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-white/40">
            The video stays local. English transcription and question alignment run
            asynchronously, so you can leave this page and return later.
          </p>

          <div className="mt-6 space-y-2.5">
            {ANALYSIS_STAGES.map((stage, index) => {
              const done = index < displayedIndex;
              const active = index === displayedIndex;
              return (
                <div key={stage.key} className="flex items-center gap-3">
                  <span
                    className={`grid h-6 w-6 place-items-center rounded-full border text-[9px] ${
                      done
                        ? "border-emerald-300/25 bg-emerald-400/10 text-emerald-200"
                        : active
                          ? "border-accent/40 bg-accent/10 text-accent"
                          : "border-white/10 text-white/20"
                    }`}
                  >
                    {done ? "✓" : active ? "✦" : index + 1}
                  </span>
                  <span
                    className={`text-sm ${
                      active ? "text-white/75" : done ? "text-white/45" : "text-white/25"
                    }`}
                  >
                    {stage.label}
                  </span>
                  {active && <span className="animate-pulse text-[10px] text-accent/60">In progress</span>}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

export default function InterviewPage() {
  const routeParams = useParams<{ profileId: string | string[] }>();
  const profileId = Array.isArray(routeParams.profileId)
    ? routeParams.profileId[0]
    : routeParams.profileId;
  const { setIdentity } = useIdentity();
  const { saveArchive } = useArchive();

  const [phase, setPhase] = useState<Phase>("questions");
  const [restoring, setRestoring] = useState(true);
  const [candidateName, setCandidateName] = useState("Candidate");
  const [candidateDetail, setCandidateDetail] = useState("Interview workspace");
  const [roleContext, setRoleContext] = useState("");
  const [questionCount, setQuestionCount] = useState(6);
  const [questionSet, setQuestionSet] = useState<QuestionSet | null>(null);
  const [interview, setInterview] = useState<InterviewSession | null>(null);
  const [report, setReport] = useState<InterviewReport | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{
    uploadedBytes: number;
    totalBytes: number;
    uploadedChunks: number;
    totalChunks: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [connectionWarning, setConnectionWarning] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewUrlRef = useRef<string | null>(null);

  useEffect(() => {
    setIdentity({ name: candidateName, detail: candidateDetail });
  }, [candidateDetail, candidateName, setIdentity]);

  useEffect(
    () => () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    },
    [],
  );

  useEffect(() => {
    if (!profileId) {
      return;
    }
    let active = true;

    const restore = async () => {
      const archive = getArchive(profileId);
      if (archive) {
        setCandidateName(archive.name);
        setCandidateDetail(archive.institution || archive.position || "Interview workspace");
      }

      try {
        const profile = await getProfile({ profile_id: profileId });
        if (!active) return;
        const name = profile.candidate.basic_info.name?.trim() || archive?.name || "Candidate";
        const detail =
          profile.candidate.basic_info.institution ||
          profile.candidate.basic_info.position ||
          "Interview workspace";
        setCandidateName(name);
        setCandidateDetail(detail);
        saveArchive(profileId, profile.candidate, archive?.llm ?? null);
      } catch {
        // Archived profiles remain available after the in-memory backend restarts.
      }

      const pointer = readInterviewSession(profileId);
      if (!pointer) {
        if (active) setRestoring(false);
        return;
      }

      setRoleContext(pointer.roleContext);
      setQuestionCount(pointer.questionCount);
      try {
        const savedQuestions = await getQuestionSet(pointer.questionSetId);
        if (!active) return;
        setQuestionSet(savedQuestions);
        if (savedQuestions.candidate_name && !archive) {
          setCandidateName(savedQuestions.candidate_name);
        }

        if (pointer.interviewId) {
          const session = await getInterviewSession(pointer.interviewId);
          if (!active) return;
          setInterview(session);
          if (session.status === "analyzing") {
            setPhase("analyzing");
          } else if (
            session.status === "completed" ||
            session.status === "completed_with_warnings"
          ) {
            const savedReport = await getInterviewReport(session.interview_id);
            if (!active) return;
            setReport(savedReport);
            setPhase("report");
          } else {
            setPhase("video");
            if (session.status === "failed" && session.error) {
              setError(session.error.detail);
            }
          }
        }
      } catch {
        if (active) {
          clearInterviewSession(profileId);
          setQuestionSet(null);
          setInterview(null);
          setReport(null);
          setPhase("questions");
        }
      } finally {
        if (active) setRestoring(false);
      }
    };

    void restore();
    return () => {
      active = false;
    };
  }, [profileId, saveArchive]);

  useEffect(() => {
    if (phase !== "analyzing" || !interview?.interview_id) return;
    let active = true;
    let timer: number | undefined;
    let failures = 0;

    const poll = async () => {
      try {
        const session = await getInterviewSession(interview.interview_id);
        if (!active) return;
        failures = 0;
        setConnectionWarning(null);
        setInterview(session);
        if (
          session.status === "completed" ||
          session.status === "completed_with_warnings"
        ) {
          const nextReport = await getInterviewReport(session.interview_id);
          if (!active) return;
          setReport(nextReport);
          setPhase("report");
          return;
        }
        if (session.status === "failed") {
          setPhase("video");
          setError(session.error?.detail ?? "Interview analysis failed.");
          return;
        }
        timer = window.setTimeout(poll, 1600);
      } catch (pollError) {
        if (!active) return;
        failures += 1;
        if (failures >= 3) {
          setConnectionWarning(
            errorText(pollError) + " The page will keep trying in the background.",
          );
        }
        timer = window.setTimeout(poll, 2600);
      }
    };

    void poll();
    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [interview?.interview_id, phase]);

  const handleGenerate = async () => {
    if (!profileId || generating) return;
    setGenerating(true);
    setError(null);
    setNotice(null);
    setCopied(false);
    try {
      const nextSet = await createQuestionSet({
        profileId,
        roleContext,
        questionCount,
      });
      setQuestionSet(nextSet);
      setInterview(null);
      setReport(null);
      setPhase("questions");
      writeInterviewSession(profileId, {
        questionSetId: nextSet.question_set_id,
        interviewId: null,
        roleContext,
        questionCount,
      });
      setNotice(
        `${nextSet.questions.length} evidence-grounded questions are ready.`,
      );
    } catch (generationError) {
      setError(errorText(generationError));
    } finally {
      setGenerating(false);
    }
  };

  const handleContinueToVideo = async () => {
    if (!questionSet || !profileId) return;
    setError(null);
    if (interview?.question_set_id === questionSet.question_set_id) {
      setPhase("video");
      return;
    }
    try {
      const session = await createInterviewSession(questionSet.question_set_id);
      setInterview(session);
      writeInterviewSession(profileId, {
        questionSetId: questionSet.question_set_id,
        interviewId: session.interview_id,
        roleContext,
        questionCount,
      });
      setPhase("video");
    } catch (creationError) {
      setError(errorText(creationError));
    }
  };

  const handleCopy = async () => {
    if (!questionSet) return;
    try {
      const documentText = await getQuestionDocument(
        questionSet.question_set_id,
        "md",
      );
      await navigator.clipboard.writeText(documentText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch (copyError) {
      setError(errorText(copyError));
    }
  };

  const handleDownload = async (format: "md" | "txt") => {
    if (!questionSet) return;
    try {
      const documentText = await getQuestionDocument(
        questionSet.question_set_id,
        format,
      );
      const blob = new Blob([documentText], {
        type: format === "md" ? "text/markdown;charset=utf-8" : "text/plain;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `interview-questions-${questionSet.question_set_id}.${format}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (downloadError) {
      setError(errorText(downloadError));
    }
  };

  const chooseFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!file) return;
    const suffix = `.${file.name.split(".").pop()?.toLowerCase() ?? ""}`;
    if (!ALLOWED_VIDEO_SUFFIXES.includes(suffix)) {
      setError("Choose an MP4, MOV, WebM, M4V, or MKV video.");
      return;
    }
    if (file.size <= 0 || file.size > MAX_VIDEO_BYTES) {
      setError("The video must be non-empty and no larger than 500 MB.");
      return;
    }
    setError(null);
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    const nextPreviewUrl = URL.createObjectURL(file);
    previewUrlRef.current = nextPreviewUrl;
    setPreviewUrl(nextPreviewUrl);
    setSelectedFile(file);
    setUploadProgress(null);
  };

  const removeSelectedFile = () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
    setPreviewUrl(null);
    setSelectedFile(null);
    setUploadProgress(null);
  };

  const ensureInterview = async (): Promise<InterviewSession> => {
    if (
      interview &&
      questionSet &&
      interview.question_set_id === questionSet.question_set_id
    ) {
      return interview;
    }
    if (!questionSet) throw new Error("Generate or restore a question set first.");
    const session = await createInterviewSession(questionSet.question_set_id);
    setInterview(session);
    if (profileId) {
      writeInterviewSession(profileId, {
        questionSetId: questionSet.question_set_id,
        interviewId: session.interview_id,
        roleContext,
        questionCount,
      });
    }
    return session;
  };

  const handleUpload = async () => {
    if (!selectedFile || uploading) return;
    setUploading(true);
    setError(null);
    setNotice(null);
    try {
      const session = await ensureInterview();
      const uploaded = await uploadInterviewVideo({
        interviewId: session.interview_id,
        file: selectedFile,
        onProgress: setUploadProgress,
      });
      setInterview(uploaded);
      await startInterviewAnalysis(uploaded.interview_id);
      setInterview({
        ...uploaded,
        status: "analyzing",
        stage: "queued",
        progress: { done: 0, total: 4 },
      });
      setPhase("analyzing");
    } catch (uploadError) {
      setError(errorText(uploadError));
    } finally {
      setUploading(false);
    }
  };

  const handleAnalyzeSavedVideo = async () => {
    if (!interview || !interview.video) return;
    setError(null);
    try {
      await startInterviewAnalysis(interview.interview_id);
      setInterview({ ...interview, status: "analyzing", stage: "queued" });
      setPhase("analyzing");
    } catch (analysisError) {
      setError(errorText(analysisError));
    }
  };

  const handleNewQuestions = () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
    setPreviewUrl(null);
    if (profileId) clearInterviewSession(profileId);
    setQuestionSet(null);
    setInterview(null);
    setReport(null);
    setSelectedFile(null);
    setUploadProgress(null);
    setError(null);
    setNotice(null);
    setPhase("questions");
  };

  const progressPercent = useMemo(() => {
    if (!uploadProgress || uploadProgress.totalBytes <= 0) return 0;
    return Math.round(
      (uploadProgress.uploadedBytes / uploadProgress.totalBytes) * 100,
    );
  }, [uploadProgress]);

  if (!profileId) {
    return (
      <div className="relative min-h-screen">
        <Starfield />
        <main className="relative mx-auto max-w-3xl px-6 py-20 text-center">
          <p className="text-sm text-rose-300">Missing profile identifier.</p>
          <Link href="/" className="mt-4 inline-block text-accent-soft hover:underline">
            Return to profiles
          </Link>
        </main>
      </div>
    );
  }

  if (restoring) {
    return (
      <div className="relative min-h-screen">
        <Starfield />
        <main className="relative mx-auto flex min-h-screen max-w-5xl items-center justify-center px-6">
          <div className="glass flex items-center gap-4 rounded-2xl px-6 py-5">
            <OrbitLoader small />
            <div>
              <p className="text-sm text-white/65">Restoring interview workspace</p>
              <p className="mt-1 text-xs text-white/30">{profileId}</p>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-hidden text-white/90">
      <Starfield />
      <main className="relative mx-auto max-w-[1320px] px-5 py-6 sm:px-8 lg:px-10 lg:py-9">
        <header className="animate-fade-in-up flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="group inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-xs text-white/50 transition hover:border-accent/30 hover:text-white"
            >
              <span className="transition-transform group-hover:-translate-x-0.5">←</span>
              Profile
            </Link>
            <span className="hidden h-4 w-px bg-white/10 sm:block" />
            <span className="hidden text-[11px] uppercase tracking-[0.2em] text-white/30 sm:block">
              Interview studio
            </span>
          </div>
          <Stepper
            phase={phase}
            hasQuestions={Boolean(questionSet)}
            hasInterview={Boolean(interview)}
            hasReport={Boolean(report)}
            onChange={setPhase}
          />
        </header>

        {phase !== "report" && phase !== "analyzing" && (
          <section className="animate-reveal mt-10 grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <div>
              <p className="text-[11px] uppercase tracking-[0.36em] text-accent/70">
                Candidate interview · {candidateName}
              </p>
              <h1 className="mt-4 max-w-4xl font-display text-4xl leading-[1.04] text-white sm:text-5xl lg:text-6xl">
                {phase === "video" ? "One recording," : "Questions that earn"}
                <br />
                <span className="italic text-accent">
                  {phase === "video" ? "every answer traceable." : "their place."}
                </span>
              </h1>
              <p className="mt-5 max-w-2xl text-sm leading-relaxed text-white/42">
                {phase === "video"
                  ? "Upload the completed English interview. Every answer will be mapped back to a timestamp and the profile evidence that prompted it."
                  : "Build a compact English interview from the profile record, then map every answer back to a timestamp and its supporting evidence."}
              </p>
            </div>
            <div className="flex items-center gap-3 lg:pb-1">
              <span className="grid h-10 w-10 place-items-center rounded-full border border-accent/20 bg-accent/[0.08] text-sm text-accent">
                ✦
              </span>
              <div>
                <p className="text-xs text-white/55">{candidateDetail}</p>
                <p className="mt-0.5 font-mono text-[10px] text-white/25">{profileId}</p>
              </div>
            </div>
          </section>
        )}

        {(error || notice) && (
          <div
            className={`mt-6 rounded-xl border px-4 py-3 text-sm ${
              error
                ? "border-rose-400/25 bg-rose-400/[0.06] text-rose-200/80"
                : "border-emerald-400/20 bg-emerald-400/[0.05] text-emerald-100/65"
            }`}
            role="status"
          >
            {error ?? notice}
          </div>
        )}
        {connectionWarning && phase === "analyzing" && (
          <div className="mt-4 rounded-xl border border-amber-400/20 bg-amber-400/[0.06] px-4 py-3 text-xs text-amber-100/65">
            {connectionWarning}
          </div>
        )}

        <div className="mt-8">
          {phase === "questions" && (
            <div className="space-y-6">
              <section className="glass rounded-2xl p-5 sm:p-6">
                <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.2em] text-white/35">
                      Optional role context
                    </p>
                    <textarea
                      value={roleContext}
                      onChange={(event) => setRoleContext(event.target.value)}
                      rows={4}
                      maxLength={4000}
                      placeholder="Paste the role requirements, research priorities, or teaching expectations that should shape the questions."
                      className="mt-2 w-full resize-none rounded-xl border border-white/[0.08] bg-black/20 px-4 py-3 text-sm leading-relaxed text-white/75 outline-none placeholder:text-white/22 focus:border-accent/35"
                    />
                  </div>
                  <div className="flex flex-col justify-between gap-5">
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.2em] text-white/35">
                        Question count
                      </p>
                      <div className="mt-2 flex rounded-xl border border-white/[0.08] bg-black/20 p-1">
                        {QUESTION_COUNTS.map((count) => (
                          <button
                            key={count}
                            type="button"
                            onClick={() => setQuestionCount(count)}
                            className={`flex-1 rounded-lg px-3 py-2 text-sm tabular-nums transition ${
                              questionCount === count
                                ? "bg-accent/[0.12] text-accent-soft"
                                : "text-white/35 hover:text-white/65"
                            }`}
                          >
                            {count}
                          </button>
                        ))}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleGenerate()}
                      disabled={generating}
                      className="starfield-btn relative inline-flex items-center justify-center gap-2 overflow-hidden rounded-full border border-accent/35 px-5 py-3 text-sm text-accent-soft disabled:cursor-wait disabled:opacity-60"
                    >
                      {generating ? <OrbitLoader small /> : <span>✦</span>}
                      {generating ? "Building question set" : questionSet ? "Regenerate questions" : "Generate questions"}
                    </button>
                  </div>
                </div>
                <p className="mt-4 text-[11px] leading-relaxed text-white/25">
                  Questions use only the candidate profile and its evidence. Role context
                  is optional and never overrides the record.
                </p>
              </section>

              {generating && (
                <div className="flex items-center justify-center gap-4 py-12 text-sm text-white/40">
                  <OrbitLoader />
                  <div>
                    <p className="text-white/60">Selecting high-value claims</p>
                    <p className="mt-1 text-xs text-white/28">
                      Balancing impact, uncertainty, and interview progression.
                    </p>
                  </div>
                </div>
              )}

              {questionSet && !generating && (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.22em] text-accent/60">
                        Question set ready
                      </p>
                      <h2 className="mt-2 font-display text-3xl text-white/90">
                        A focused path through the record.
                      </h2>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void handleCopy()}
                        className="rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-2 text-xs text-white/50 transition hover:border-white/20 hover:text-white/80"
                      >
                        {copied ? "Copied" : "Copy all"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDownload("md")}
                        className="rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-2 text-xs text-white/50 transition hover:border-white/20 hover:text-white/80"
                      >
                        Download .md
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDownload("txt")}
                        className="rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-2 text-xs text-white/50 transition hover:border-white/20 hover:text-white/80"
                      >
                        .txt
                      </button>
                    </div>
                  </div>

                  {questionSet.warnings.length > 0 && (
                    <div className="rounded-xl border border-amber-400/20 bg-amber-400/[0.05] p-4">
                      {questionSet.warnings.map((item, index) => (
                        <p key={index} className="text-xs leading-relaxed text-amber-100/60">
                          {item.message}
                        </p>
                      ))}
                    </div>
                  )}

                  <div className="grid gap-3">
                    {questionSet.questions.map((question, index) => (
                      <QuestionCard key={question.question_id} question={question} index={index} />
                    ))}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-4 border-t border-white/[0.08] pt-5">
                    <p className="max-w-2xl text-xs leading-relaxed text-white/30">
                      The recording should contain one continuous English response,
                      answering the questions in order.
                    </p>
                    <button
                      type="button"
                      onClick={() => void handleContinueToVideo()}
                      className="inline-flex items-center gap-3 rounded-full bg-white px-6 py-3 text-sm font-medium text-black transition hover:bg-white/90"
                    >
                      Continue to video
                      <span aria-hidden="true">→</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {phase === "video" && questionSet && (
            <div className="space-y-6">
              <section className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(300px,0.85fr)]">
                <div className="glass rounded-2xl p-5 sm:p-7">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-accent/60">
                    Video evidence
                  </p>
                  <h2 className="mt-2 font-display text-3xl text-white/90">
                    Upload the completed interview.
                  </h2>
                  <p className="mt-2 text-sm leading-relaxed text-white/38">
                    One continuous video, in English, with the questions answered in order.
                  </p>

                  <label className="mt-6 block cursor-pointer rounded-2xl border border-dashed border-white/15 bg-black/15 p-8 text-center transition hover:border-accent/35 hover:bg-accent/[0.03]">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".mp4,.m4v,.mov,.webm,.mkv,video/*"
                      className="sr-only"
                      onChange={chooseFile}
                    />
                    <span className="mx-auto grid h-14 w-14 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-xl text-accent">
                      ↑
                    </span>
                    <span className="mt-4 block text-sm text-white/65">
                      {selectedFile ? selectedFile.name : "Choose a video file"}
                    </span>
                    <span className="mt-1 block text-[11px] text-white/28">
                      MP4, MOV, WebM, M4V, or MKV · up to 500 MB · 20 minutes
                    </span>
                  </label>

                  {selectedFile && (
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.07] bg-white/[0.025] px-4 py-3">
                      <div>
                        <p className="text-xs text-white/60">{selectedFile.name}</p>
                        <p className="mt-0.5 text-[10px] text-white/28">
                          {formatFileSize(selectedFile.size)}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={removeSelectedFile}
                        className="text-xs text-white/35 transition hover:text-rose-200"
                      >
                        Remove
                      </button>
                    </div>
                  )}

                  {uploading && uploadProgress && (
                    <div className="mt-5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-white/45">
                          Uploading chunk {uploadProgress.uploadedChunks}/
                          {uploadProgress.totalChunks}
                        </span>
                        <span className="tabular-nums text-accent-soft">{progressPercent}%</span>
                      </div>
                      <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/[0.07]">
                        <div
                          className="progress-fill h-full rounded-full"
                          style={{ width: `${progressPercent}%` }}
                        />
                      </div>
                    </div>
                  )}

                  <div className="mt-6 flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => void handleUpload()}
                      disabled={!selectedFile || uploading}
                      className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-medium text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-35"
                    >
                      {uploading ? "Uploading and preparing" : "Upload and analyse"}
                      {!uploading && <span aria-hidden="true">→</span>}
                    </button>
                    {interview?.video && !selectedFile && (
                      <button
                        type="button"
                        onClick={() => void handleAnalyzeSavedVideo()}
                        className="rounded-full border border-accent/25 bg-accent/[0.06] px-5 py-3 text-sm text-accent-soft transition hover:bg-accent/[0.1]"
                      >
                        Analyse saved video
                      </button>
                    )}
                  </div>
                </div>

                <div className="space-y-4">
                  {previewUrl ? (
                    <div className="glass overflow-hidden rounded-2xl">
                      <video
                        src={previewUrl}
                        controls
                        playsInline
                        className="aspect-video w-full bg-black"
                      />
                      <p className="px-4 py-3 text-[10px] text-white/28">
                        Local preview. The video is uploaded only when you start the analysis.
                      </p>
                    </div>
                  ) : interview?.video ? (
                    <div className="glass rounded-2xl p-5">
                      <p className="text-[11px] uppercase tracking-[0.18em] text-emerald-200/55">
                        Video on file
                      </p>
                      <p className="mt-2 text-sm text-white/65">{interview.video.filename}</p>
                      <p className="mt-1 text-xs text-white/30">
                        {formatFileSize(interview.video.size_bytes)} ·{" "}
                        {Math.round(interview.video.duration_ms / 1000)} seconds
                      </p>
                      {interview.status === "failed" && (
                        <p className="mt-3 text-xs text-rose-200/65">
                          Previous analysis failed. The stored video can be analysed again.
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="glass rounded-2xl p-5">
                      <p className="text-[11px] uppercase tracking-[0.18em] text-white/30">
                        Recording checklist
                      </p>
                      <ul className="mt-3 space-y-2.5 text-xs leading-relaxed text-white/40">
                        <li>Answer each question in the listed order.</li>
                        <li>Use clear English audio and keep the candidate visible.</li>
                        <li>Do not splice separate takes into the submitted file.</li>
                      </ul>
                    </div>
                  )}

                  <div className="glass rounded-2xl p-5">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-[11px] uppercase tracking-[0.18em] text-white/30">
                        Question set
                      </p>
                      <button
                        type="button"
                        onClick={() => setPhase("questions")}
                        className="text-[10px] text-accent-soft/60 hover:text-accent-soft"
                      >
                        Review
                      </button>
                    </div>
                    <ol className="mt-3 space-y-2">
                      {questionSet.questions.map((question) => (
                        <li key={question.question_id} className="flex gap-2.5 text-xs text-white/45">
                          <span className="font-mono text-[9px] text-white/20">
                            {String(question.order).padStart(2, "0")}
                          </span>
                          <span className="line-clamp-2">{question.text}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                </div>
              </section>
            </div>
          )}

          {phase === "analyzing" && interview && (
            <AnalysisStage interview={interview} />
          )}

          {phase === "report" && report && questionSet && (
            <InterviewReportView
              report={report}
              questionSet={questionSet}
              candidateName={candidateName}
              onNewQuestions={handleNewQuestions}
            />
          )}
        </div>
      </main>
    </div>
  );
}
