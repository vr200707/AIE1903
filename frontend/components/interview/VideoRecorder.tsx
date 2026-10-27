"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
} from "react";

export interface RecorderQuestion {
  id: string;
  question: string;
}

export interface RecorderQuestionMark {
  question_id: string;
  start_ms: number;
}

export interface VideoRecorderProps {
  questions: RecorderQuestion[];
  onRecorded: (file: File, marks: RecorderQuestionMark[]) => void;
  onVisited?: (questionId: string) => void;
  maxSeconds?: number;
  disabled?: boolean;
  onError?: (message: string) => void;
}

type RecorderState = "idle" | "starting" | "recording" | "reviewing" | "submitted";

function formatClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function VideoRecorder({
  questions,
  onRecorded,
  onVisited,
  maxSeconds = 600,
  disabled = false,
  onError,
}: VideoRecorderProps) {
  const [state, setState] = useState<RecorderState>("idle");
  const [questionIndex, setQuestionIndex] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const startedAtRef = useRef<number>(0);
  const recordedBlobRef = useRef<Blob | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const marksRef = useRef<RecorderQuestionMark[]>([]);

  const currentQuestion = questions[questionIndex] ?? null;
  const lastQuestionIndex = Math.max(0, questions.length - 1);

  const cleanupDevices = useCallback(() => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
    recorderRef.current = null;
  }, []);

  const releasePreview = useCallback(() => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setPreviewUrl(null);
  }, []);

  const stopRecording = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
  }, []);

  useEffect(
    () => () => {
      cleanupDevices();
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
      }
    },
    [cleanupDevices],
  );

  useEffect(() => {
    if (state !== "recording") return;
    timerRef.current = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAtRef.current) / 1000);
      setElapsedSeconds(elapsed);
      if (elapsed >= maxSeconds) {
        stopRecording();
      }
    }, 250);
    return () => {
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [state, maxSeconds, stopRecording]);

  const startRecording = async () => {
    if (disabled || state === "starting" || state === "recording") return;
    setState("starting");
    setPermissionError(null);
    setQuestionIndex(0);
    chunksRef.current = [];
    marksRef.current =
      questions.length > 0
        ? [{ question_id: questions[0].id, start_ms: 0 }]
        : [];
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error(
          "This browser does not support camera and microphone capture.",
        );
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: true,
      });
      mediaStreamRef.current = stream;
      const mimeType = [
        "video/webm;codecs=vp9,opus",
        "video/webm;codecs=vp8,opus",
        "video/webm",
        "",
      ].find((candidate) => candidate && MediaRecorder.isTypeSupported(candidate));
      const recorder = new MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
      });
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const type =
          recorder.mimeType || "video/webm";
        const blob = new Blob(chunksRef.current, { type });
        recordedBlobRef.current = blob;
        if (previewUrlRef.current) {
          URL.revokeObjectURL(previewUrlRef.current);
        }
        const url = URL.createObjectURL(blob);
        previewUrlRef.current = url;
        setPreviewUrl(url);
        cleanupDevices();
        setState("reviewing");
      };
      recorder.start(1000);
      startedAtRef.current = Date.now();
      setElapsedSeconds(0);
      setState("recording");
      onVisited?.(questions[0]?.id ?? "");
    } catch (startError) {
      cleanupDevices();
      const message =
        startError instanceof Error
          ? startError.message
          : "Could not start the camera or microphone.";
      setPermissionError(message);
      onError?.(message);
      setState("idle");
    }
  };

  const goNextQuestion = () => {
    const next = questionIndex + 1;
    const nextQuestion = questions[next];
    if (nextQuestion) {
      setQuestionIndex(next);
      const elapsedMs = Math.max(0, Date.now() - startedAtRef.current);
      marksRef.current.push({
        question_id: nextQuestion.id,
        start_ms: elapsedMs,
      });
      onVisited?.(nextQuestion.id);
    } else {
      stopRecording();
    }
  };

  const restart = () => {
    releasePreview();
    recordedBlobRef.current = null;
    setFileName(null);
    setQuestionIndex(0);
    setElapsedSeconds(0);
    void startRecording();
  };

  const submit = (event: MouseEvent<HTMLButtonElement>) => {
    const blob = recordedBlobRef.current;
    if (!blob) return;
    const timestamp = new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d+Z$/, "Z");
    const extension = blob.type.includes("mp4") ? "mp4" : "webm";
    const file = new File(
      [blob],
      `interview-recording-${timestamp}.${extension}`,
      { type: blob.type || "video/webm" },
    );
    setFileName(file.name);
    setState("submitted");
    onRecorded(file, marksRef.current);
    event.currentTarget.blur();
  };

  const removeSubmission = () => {
    releasePreview();
    recordedBlobRef.current = null;
    setFileName(null);
    setQuestionIndex(0);
    setElapsedSeconds(0);
    setState("idle");
  };

  const remainingSeconds = Math.max(0, maxSeconds - elapsedSeconds);

  return (
    <section className="glass rounded-2xl p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-accent">
            Record in the browser
          </p>
          <p className="mt-1 text-[10px] text-ink/75">
            One continuous take — the questions appear on screen as you answer.
          </p>
        </div>
        {(state === "recording" || state === "starting") && (
          <span className="flex items-center gap-1.5 rounded-full border border-rose-300/25 bg-rose-400/10 px-2.5 py-1">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-rose-300" />
            <span className="font-mono text-[10px] text-rose-800">REC</span>
          </span>
        )}
      </div>

      {questions.length === 0 && (
        <p className="mt-4 text-xs text-ink/75">
          No questions are available to record.
        </p>
      )}

      {state === "idle" && questions.length > 0 && (
        <div className="mt-4">
          {permissionError && (
            <p className="mb-3 rounded-lg border border-rose-300/25 bg-rose-400/[0.06] px-3 py-2 text-xs leading-relaxed text-rose-800">
              {permissionError}
            </p>
          )}
          <button
            type="button"
            onClick={() => void startRecording()}
            disabled={disabled}
            className="flex w-full items-center justify-center gap-2.5 rounded-full border border-accent/35 bg-accent/[0.08] px-5 py-3 text-sm text-accent transition hover:bg-accent/[0.14] disabled:cursor-not-allowed disabled:opacity-75"
          >
            <span className="h-2.5 w-2.5 rounded-full bg-rose-300" />
            Start recording
          </button>
          <p className="mt-2 text-center text-[10px] text-ink/75">
            Camera and microphone permission is required.
          </p>
        </div>
      )}

      {state === "starting" && (
        <div className="mt-4 flex items-center justify-center gap-3 py-6 text-xs text-ink/75">
          <span className="relative grid h-6 w-6 place-items-center">
            <span className="absolute inset-0 animate-ring-spin rounded-full border border-accent/25 border-t-accent" />
          </span>
          Starting camera and microphone…
        </div>
      )}

      {state === "recording" && currentQuestion && (
        <div className="mt-4">
          <div className="rounded-xl border border-ink/[0.08] bg-background/25 px-4 py-4">
            <div className="flex items-center justify-between gap-3">
              <span className="font-mono text-[10px] text-accent">
                Question {questionIndex + 1} of {questions.length}
              </span>
              <span className="font-mono text-[10px] tabular-nums text-ink/75">
                {formatClock(elapsedSeconds)} / {formatClock(maxSeconds)}
              </span>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-ink/85">
              {currentQuestion.question}
            </p>
            <div className="mt-4 flex items-center justify-between gap-3">
              <span className="text-[10px] text-ink/75">
                Answer out loud, then continue.
              </span>
              <span className="text-[10px] tabular-nums text-accent">
                {formatClock(remainingSeconds)} left
              </span>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={goNextQuestion}
              className="flex-1 rounded-full bg-ink px-4 py-2.5 text-xs font-medium text-white transition hover:bg-ink/90"
            >
              {questionIndex < lastQuestionIndex
                ? "Next question →"
                : "Finish recording"}
            </button>
            <button
              type="button"
              onClick={stopRecording}
              className="rounded-full border border-rose-300/30 bg-rose-400/[0.07] px-4 py-2.5 text-xs text-rose-800 transition hover:bg-rose-400/[0.14]"
            >
              Stop
            </button>
          </div>
          <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-ink/10">
            <div
              className="h-full rounded-full bg-rose-400 transition-[width] duration-200 ease-linear"
              style={{
                width: `${Math.min(100, (elapsedSeconds / maxSeconds) * 100)}%`,
              }}
            />
          </div>
        </div>
      )}

      {state === "reviewing" && previewUrl && (
        <div className="mt-4">
          <video
            src={previewUrl}
            controls
            playsInline
            className="aspect-video w-full rounded-xl bg-background"
          />
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={restart}
              disabled={disabled}
              className="flex-1 rounded-full border border-ink/12 bg-ink/[0.03] px-4 py-2.5 text-xs text-ink/75 transition hover:border-ink/25 hover:text-ink/85 disabled:cursor-not-allowed disabled:opacity-75"
            >
              Record again
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={disabled}
              className="flex-1 rounded-full bg-emerald-300 px-4 py-2.5 text-xs font-medium text-ink transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-75"
            >
              Use this recording
            </button>
          </div>
        </div>
      )}

      {state === "submitted" && fileName && (
        <div className="mt-4 rounded-xl border border-emerald-300/20 bg-emerald-400/[0.05] px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs text-emerald-800">Recording ready</p>
              <p className="mt-0.5 truncate text-[10px] text-ink/75">{fileName}</p>
            </div>
            <button
              type="button"
              onClick={removeSubmission}
              disabled={disabled}
              className="text-[10px] text-ink/75 transition hover:text-rose-800 disabled:cursor-not-allowed disabled:opacity-75"
            >
              Remove
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
