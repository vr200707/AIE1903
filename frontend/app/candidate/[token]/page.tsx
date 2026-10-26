"use client";

import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import Starfield from "@/components/Starfield";
import {
  VideoRecorder,
  type RecorderQuestionMark,
} from "@/components/interview/VideoRecorder";
import {
  createCandidateInterview,
  formatFileSize,
  getCandidateQuestionSet,
  getInterviewSession,
  startInterviewAnalysis,
  uploadInterviewVideo,
  type CandidateQuestionSet,
  type InterviewSession,
} from "@/lib/interview";

const MAX_VIDEO_BYTES = 500 * 1024 * 1024;
const ALLOWED_VIDEO_SUFFIXES = [".mp4", ".m4v", ".mov", ".webm", ".mkv"];
const SESSION_PREFIX = "aie1903.candidate.session.v1:";

type Phase = "loading" | "ready" | "analyzing" | "submitted";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Please retry.";
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

export default function CandidatePage() {
  const routeParams = useParams<{ token: string | string[] }>();
  const token = Array.isArray(routeParams.token)
    ? routeParams.token[0]
    : routeParams.token;

  const [candidateSet, setCandidateSet] = useState<CandidateQuestionSet | null>(null);
  const [interview, setInterview] = useState<InterviewSession | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [recordedMarks, setRecordedMarks] = useState<RecorderQuestionMark[]>([]);
  const [visited, setVisited] = useState<Record<string, boolean>>({});
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{
    uploadedBytes: number;
    totalBytes: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const questions = useMemo(() => candidateSet?.questions ?? [], [candidateSet]);

  const readLocalSession = (): string | null => {
    if (typeof window === "undefined" || !token) return null;
    return window.localStorage.getItem(`${SESSION_PREFIX}${token}`);
  };

  const writeLocalSession = (interviewId: string) => {
    if (typeof window === "undefined" || !token) return;
    window.localStorage.setItem(`${SESSION_PREFIX}${token}`, interviewId);
  };

  useEffect(() => {
    if (!token) {
      setError("Missing candidate link.");
      setPhase("ready");
      return;
    }
    let active = true;

    const restore = async () => {
      try {
        const set = await getCandidateQuestionSet(token);
        if (!active) return;
        setCandidateSet(set);
        setPhase("ready");
      } catch (loadError) {
        if (!active) return;
        setError(errorText(loadError));
        setPhase("ready");
      }

      const savedInterviewId = readLocalSession();
      if (savedInterviewId) {
        try {
          const session = await getInterviewSession(savedInterviewId);
          if (!active) return;
          setInterview(session);
          if (
            session.status === "completed" ||
            session.status === "completed_with_warnings"
          ) {
            setPhase("submitted");
          } else if (session.status === "analyzing") {
            setPhase("analyzing");
          }
        } catch {
          // The saved session may belong to a restarted backend.
        }
      }
    };

    void restore();
    return () => {
      active = false;
    };
  }, [token]);

  useEffect(() => {
    if (phase !== "analyzing" || !interview?.interview_id) return;
    let active = true;
    let timer: number | undefined;

    const poll = async () => {
      try {
        const session = await getInterviewSession(interview.interview_id);
        if (!active) return;
        setInterview(session);
        if (
          session.status === "completed" ||
          session.status === "completed_with_warnings"
        ) {
          setPhase("submitted");
          return;
        }
        if (session.status === "failed") {
          setPhase("ready");
          setError(session.error?.detail ?? "Submission failed. Please try again.");
          return;
        }
        timer = window.setTimeout(poll, 1600);
      } catch {
        if (active) timer = window.setTimeout(poll, 2600);
      }
    };

    void poll();
    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [interview?.interview_id, phase]);

  const ensureInterview = async (): Promise<InterviewSession> => {
    if (interview) return interview;
    if (!token) throw new Error("Missing candidate link.");
    const session = await createCandidateInterview(token);
    setInterview(session);
    writeLocalSession(session.interview_id);
    return session;
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
    setSelectedFile(file);
    setRecordedMarks([]);
    setUploadProgress(null);
  };

  const handleRecorded = (file: File, marks: RecorderQuestionMark[]) => {
    setError(null);
    setSelectedFile(file);
    setRecordedMarks(marks);
    setUploadProgress(null);
  };

  const handleVisited = (questionId: string) => {
    setVisited((current) => ({ ...current, [questionId]: true }));
  };

  const unconfirmed = useMemo(
    () => questions.filter((question) => !visited[question.question_id]),
    [questions, visited],
  );

  const submit = async () => {
    if (!selectedFile || uploading) return;
    if (unconfirmed.length > 0) {
      setError(
        `Confirm every question was answered before submitting. ` +
          `${unconfirmed.length} question${unconfirmed.length === 1 ? " is" : "s are"} ` +
          "still unchecked.",
      );
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const session = await ensureInterview();
      const uploaded = await uploadInterviewVideo({
        interviewId: session.interview_id,
        file: selectedFile,
        marks: recordedMarks,
        onProgress: setUploadProgress,
      });
      setInterview(uploaded);
      await startInterviewAnalysis(uploaded.interview_id);
      setInterview({
        ...uploaded,
        status: "analyzing",
        stage: "queued",
        progress: { done: 0, total: 0 },
      });
      setPhase("analyzing");
    } catch (submitError) {
      setError(errorText(submitError));
    } finally {
      setUploading(false);
    }
  };

  const progressPercent = useMemo(() => {
    if (!uploadProgress || uploadProgress.totalBytes <= 0) return 0;
    return Math.round(
      (uploadProgress.uploadedBytes / uploadProgress.totalBytes) * 100,
    );
  }, [uploadProgress]);

  const suggestedMaxSeconds = useMemo(
    () => Math.max(120, questions.reduce((sum, q) => sum + q.answer_seconds, 0) + 60),
    [questions],
  );

  if (phase === "loading") {
    return (
      <div className="relative min-h-screen">
        <Starfield />
        <main className="relative mx-auto flex min-h-screen max-w-5xl items-center justify-center px-6">
          <div className="glass flex items-center gap-4 rounded-2xl px-6 py-5">
            <OrbitLoader small />
            <div>
              <p className="text-sm text-white/65">Opening your interview</p>
              <p className="mt-1 text-xs text-white/30">{token}</p>
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (!token || !candidateSet) {
    return (
      <div className="relative min-h-screen">
        <Starfield />
        <main className="relative mx-auto max-w-3xl px-6 py-24 text-center">
          <p className="text-3xl">🛰</p>
          <h1 className="mt-5 font-display text-3xl text-white/90">
            Interview link unavailable
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-white/45">
            {error ?? "This link is not valid or the interview is no longer published."}
          </p>
        </main>
      </div>
    );
  }

  if (phase === "submitted") {
    return (
      <div className="relative min-h-screen">
        <Starfield />
        <main className="relative mx-auto max-w-2xl px-6 py-24 text-center">
          <div className="glass animate-pop rounded-3xl px-8 py-12">
            <span className="mx-auto grid h-16 w-16 place-items-center rounded-full border border-emerald-300/30 bg-emerald-400/10 text-2xl text-emerald-200">
              ✓
            </span>
            <h1 className="mt-6 font-display text-3xl text-white sm:text-4xl">
              Recording received
            </h1>
            <p className="mt-4 text-sm leading-relaxed text-white/45">
              Thank you, {candidateSet.candidate_name ?? "candidate"}. Your
              one-take interview has been submitted and is being reviewed. You
              can close this page now.
            </p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-hidden text-white/90">
      <Starfield />
      <main className="relative mx-auto max-w-[1180px] px-5 py-8 sm:px-8 lg:py-12">
        <header className="animate-fade-in-up">
          <p className="text-[11px] uppercase tracking-[0.36em] text-accent/70">
            Candidate interview
          </p>
          <h1 className="mt-3 max-w-3xl font-display text-4xl leading-[1.06] text-white sm:text-5xl">
            {candidateSet.candidate_name ?? "Welcome"}
            <span className="mt-2 block text-xl italic text-accent sm:text-2xl">
              one continuous take, {questions.length} question
              {questions.length === 1 ? "" : "s"}.
            </span>
          </h1>
          {candidateSet.role_context && (
            <p className="mt-4 max-w-3xl text-sm leading-relaxed text-white/40">
              {candidateSet.role_context}
            </p>
          )}
        </header>

        {(error || phase === "analyzing") && (
          <div
            className={`mt-6 rounded-xl border px-4 py-3 text-sm ${
              error
                ? "border-rose-400/25 bg-rose-400/[0.06] text-rose-200/80"
                : "border-accent/25 bg-accent/[0.06] text-accent-soft"
            }`}
            role="status"
          >
            {phase === "analyzing" ? (
              <span className="flex items-center gap-2.5">
                <OrbitLoader small />
                Uploading and preparing your recording…
              </span>
            ) : (
              error
            )}
          </div>
        )}

        {phase === "ready" && (
          <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(300px,0.9fr)]">
            <section className="glass rounded-2xl p-5 sm:p-7">
              <p className="text-[11px] uppercase tracking-[0.22em] text-accent/60">
                Your questions
              </p>
              <h2 className="mt-2 font-display text-3xl text-white/90">
                Read them once, then press record.
              </h2>
              <ol className="mt-6 space-y-3">
                {questions.map((question, index) => (
                  <li
                    key={question.question_id}
                    className="rounded-xl border border-white/[0.07] bg-white/[0.025] px-4 py-3.5"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-mono text-[10px] text-accent/60">
                        Question {index + 1}
                      </span>
                      <span className="text-[10px] text-white/30">
                        ~{question.answer_seconds}s
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-relaxed text-white/75">
                      {question.text}
                    </p>
                  </li>
                ))}
              </ol>
            </section>

            <div className="space-y-4">
              <VideoRecorder
                questions={questions.map((question) => ({
                  id: question.question_id,
                  question: question.text,
                }))}
                onRecorded={handleRecorded}
                onVisited={handleVisited}
                maxSeconds={suggestedMaxSeconds}
                disabled={uploading}
                onError={setError}
              />

              <section className="glass rounded-2xl p-5">
                <p className="text-[11px] uppercase tracking-[0.18em] text-white/30">
                  Upload a file instead
                </p>
                <label className="mt-3 block cursor-pointer rounded-xl border border-dashed border-white/15 bg-black/15 px-4 py-6 text-center transition hover:border-accent/35 hover:bg-accent/[0.03]">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".mp4,.m4v,.mov,.webm,.mkv,video/*"
                    className="sr-only"
                    onChange={chooseFile}
                  />
                  <span className="block text-sm text-white/55">
                    {selectedFile ? selectedFile.name : "Choose a video file"}
                  </span>
                  <span className="mt-1 block text-[10px] text-white/28">
                    MP4, MOV, WebM, M4V, or MKV · up to 500 MB
                  </span>
                </label>
                {selectedFile && (
                  <p className="mt-2 text-[10px] text-white/35">
                    {formatFileSize(selectedFile.size)}
                  </p>
                )}
              </section>

              <section className="glass rounded-2xl p-5">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-white/30">
                    Answered questions
                  </p>
                  <span
                    className={`rounded-full border px-2.5 py-1 font-mono text-[10px] tabular-nums ${
                      unconfirmed.length === 0
                        ? "border-emerald-300/25 bg-emerald-400/10 text-emerald-200"
                        : "border-white/10 bg-black/20 text-white/40"
                    }`}
                  >
                    {questions.length - unconfirmed.length}/{questions.length}
                  </span>
                </div>
                <div className="mt-3 space-y-1.5">
                  {questions.map((question) => {
                    const checked = Boolean(visited[question.question_id]);
                    return (
                      <label
                        key={question.question_id}
                        className={`flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 transition ${
                          checked
                            ? "border-emerald-300/20 bg-emerald-400/[0.06]"
                            : "border-white/[0.07] bg-white/[0.02] hover:border-white/[0.14]"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(event) =>
                            setVisited((current) => ({
                              ...current,
                              [question.question_id]: event.target.checked,
                            }))
                          }
                          className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-amber-400"
                        />
                        <span className="line-clamp-2 text-xs leading-relaxed text-white/50">
                          {question.text}
                        </span>
                      </label>
                    );
                  })}
                </div>
                {unconfirmed.length === 0 && (
                  <p className="mt-3 text-[10px] text-emerald-200/60">
                    All questions confirmed — submit your recording.
                  </p>
                )}
              </section>

              {selectedFile && (
                <div className="glass rounded-2xl p-5">
                  {uploading && uploadProgress ? (
                    <div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-white/45">Uploading…</span>
                        <span className="tabular-nums text-accent-soft">
                          {progressPercent}%
                        </span>
                      </div>
                      <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/[0.07]">
                        <div
                          className="progress-fill h-full rounded-full"
                          style={{ width: `${progressPercent}%` }}
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-xs text-white/60">
                          {selectedFile.name}
                        </p>
                        <p className="mt-0.5 text-[10px] text-white/28">
                          {formatFileSize(selectedFile.size)}
                        </p>
                      </div>
                  <button
                        type="button"
                        onClick={() => {
                          setSelectedFile(null);
                          setRecordedMarks([]);
                        }}
                        className="text-xs text-white/35 transition hover:text-rose-200"
                      >
                        Remove
                      </button>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => void submit()}
                    disabled={uploading || unconfirmed.length > 0}
                    className="mt-4 w-full rounded-full bg-white px-6 py-3 text-sm font-medium text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    {uploading
                      ? "Uploading and submitting"
                      : unconfirmed.length > 0
                        ? `Confirm ${unconfirmed.length} more question${unconfirmed.length === 1 ? "" : "s"}`
                        : "Submit recording"}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

      </main>
    </div>
  );
}
