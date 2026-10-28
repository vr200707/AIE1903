"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  InterviewConfidence,
  InterviewReport,
  InterviewTranscript,
  QuestionResult,
  QuestionScores,
  QuestionSet,
  TranscriptSegment,
} from "@/lib/interview";
import {
  competencyLabel,
  formatFileSize,
  formatTimecode,
  getInterviewClips,
  getInterviewTranscript,
  interviewClipUrl,
  interviewVideoUrl,
  scoreLabel,
} from "@/lib/interview";

const SCORE_KEYS: Array<keyof QuestionScores> = [
  "evidence_specificity",
  "ownership",
  "depth",
  "consistency",
  "communication",
];

function confidenceClass(value: InterviewConfidence): string {
  if (value === "high") return "bg-emerald-400";
  if (value === "medium") return "bg-amber-300";
  return "bg-rose-300";
}

function SegmentLinks({
  segments,
  onSeek,
}: {
  segments: TranscriptSegment[];
  onSeek: (milliseconds: number) => void;
}) {
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {segments.map((segment) => (
        <button
          key={segment.segment_id}
          type="button"
          onClick={() => onSeek(segment.start_ms)}
          className="inline-flex items-center gap-1.5 rounded-full border border-ink/10 bg-ink/[0.04] px-2.5 py-1 text-[11px] text-ink/75 transition hover:border-accent/35 hover:text-accent"
          title={segment.text}
        >
          <span className="h-1 w-1 rounded-full bg-accent/75" />
          {formatTimecode(segment.start_ms)}
        </button>
      ))}
    </div>
  );
}

function ScoreBar({ value, label }: { value: number | null; label: string }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="text-ink/75">{label}</span>
        <span className="font-medium tabular-nums text-ink/75">
          {value != null ? value.toFixed(1) : "—"}
        </span>
      </div>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-ink/[0.07]">
        <div
          className="h-full rounded-full bg-gradient-to-r from-accent-deep via-accent to-accent-soft"
          style={{ width: `${Math.max(0, Math.min(100, (value ?? 0) * 10))}%` }}
        />
      </div>
    </div>
  );
}

function QuestionDetail({
  result,
  questionSet,
  clipUrl,
  onSeek,
}: {
  result: QuestionResult;
  questionSet: QuestionSet;
  clipUrl: string | null;
  onSeek: (milliseconds: number) => void;
}) {
  const question = questionSet.questions.find(
    (item) => item.question_id === result.question_id,
  );
  const scoreCount = SCORE_KEYS.filter((key) => result.scores[key] != null).length;

  return (
    <article className="glass animate-fade-in-up rounded-2xl p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] uppercase tracking-[0.2em] text-accent">
            Question {String(result.order).padStart(2, "0")} ·{" "}
            {competencyLabel(result.competency)}
          </p>
          <h3 className="mt-2 max-w-3xl text-lg font-medium leading-relaxed text-ink/90">
            {result.question}
          </h3>
        </div>
        <div className="flex items-center gap-3 rounded-full border border-ink/10 bg-background/20 px-3 py-2">
          <span className={`h-2 w-2 rounded-full ${confidenceClass(result.confidence)}`} />
          <span className="text-xs capitalize text-ink/75">
            {result.confidence} confidence
          </span>
          <span className="h-4 w-px bg-ink/10" />
          <span className="text-lg font-semibold tabular-nums text-accent">
            {result.score_overall != null ? result.score_overall.toFixed(1) : "—"}
          </span>
        </div>
      </div>

      {result.answer_window && (
        <div className="mt-4 space-y-3">
          {clipUrl ? (
            <div className="overflow-hidden rounded-xl border border-ink/[0.08] bg-background/25">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink/[0.07] px-3 py-2">
                <p className="text-[10px] uppercase tracking-[0.16em] text-accent">
                  Extracted answer clip
                </p>
                <span className="font-mono text-[10px] text-ink/75">
                  {formatTimecode(result.answer_window.start_ms)}–
                  {formatTimecode(result.answer_window.end_ms)}
                </span>
              </div>
              <video
                src={clipUrl}
                controls
                playsInline
                preload="metadata"
                className="aspect-video w-full bg-background"
              />
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => onSeek(result.answer_window!.start_ms)}
            className="inline-flex items-center gap-2 rounded-full border border-accent/25 bg-accent/[0.07] px-3 py-1.5 text-xs text-accent transition hover:bg-accent/[0.12]"
          >
            <span className="grid h-5 w-5 place-items-center rounded-full border border-accent/35 text-[9px]">
              ▶
            </span>
            {clipUrl ? "Open in full recording" : "Play answer"} ·{" "}
            {formatTimecode(result.answer_window.start_ms)}–
            {formatTimecode(result.answer_window.end_ms)}
          </button>
        </div>
      )}

      <p className="mt-5 border-l border-accent/35 pl-4 text-sm leading-relaxed text-ink/75">
        {result.summary}
      </p>

      <div className="mt-5 grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {SCORE_KEYS.map((key) => (
          <ScoreBar key={key} value={result.scores[key]} label={scoreLabel(key)} />
        ))}
      </div>
      {scoreCount === 0 && (
        <p className="mt-3 text-xs text-ink/75">
          Scores are unavailable, but the transcript and grounded findings remain usable.
        </p>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-ink/75">
            What held up
          </p>
          {result.strengths.length === 0 ? (
            <p className="mt-2 text-sm text-ink/75">No grounded strength was extracted.</p>
          ) : (
            <div className="mt-2 space-y-3">
              {result.strengths.map((item, index) => (
                <div
                  key={`${item.text}-${index}`}
                  className="border-t border-ink/[0.07] pt-3 first:border-t-0 first:pt-0"
                >
                  <p className="text-sm leading-relaxed text-emerald-800">{item.text}</p>
                  <SegmentLinks segments={item.supporting_segments} onSeek={onSeek} />
                </div>
              ))}
            </div>
          )}
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-ink/75">
            What needs scrutiny
          </p>
          {result.concerns.length === 0 ? (
            <p className="mt-2 text-sm text-ink/75">No grounded concern was extracted.</p>
          ) : (
            <div className="mt-2 space-y-3">
              {result.concerns.map((item, index) => (
                <div
                  key={`${item.text}-${index}`}
                  className="border-t border-ink/[0.07] pt-3 first:border-t-0 first:pt-0"
                >
                  <p className="text-sm leading-relaxed text-amber-800">{item.text}</p>
                  <SegmentLinks segments={item.supporting_segments} onSeek={onSeek} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {result.missing_details.length > 0 && (
        <div className="mt-6 border-t border-ink/[0.08] pt-4">
          <p className="text-[11px] uppercase tracking-[0.18em] text-ink/75">
            Missing detail
          </p>
          <ul className="mt-2 grid gap-2 text-sm text-ink/75 sm:grid-cols-2">
            {result.missing_details.map((item, index) => (
              <li key={`${item}-${index}`} className="flex gap-2">
                <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-rose-300/70" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}

      {question && question.source_claims.length > 0 && (
        <details className="mt-6 border-t border-ink/[0.08] pt-4">
          <summary className="cursor-pointer text-xs text-ink/75 transition hover:text-ink/75">
            Profile claims behind this question
          </summary>
          <div className="mt-3 space-y-2">
            {question.source_claims.map((claim) => (
              <div
                key={claim.claim_id}
                className="rounded-xl border border-ink/[0.07] bg-background/10 px-3 py-2.5"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[10px] uppercase tracking-[0.16em] text-accent">
                    {claim.claim_id}
                  </span>
                  {claim.evidence_statuses.map((status) => (
                    <span
                      key={status}
                      className="rounded-full border border-ink/10 bg-ink/[0.04] px-2 py-0.5 text-[10px] text-ink/75"
                    >
                      {status.replaceAll("_", " ")}
                    </span>
                  ))}
                </div>
                <p className="mt-1 text-xs leading-relaxed text-ink/75">{claim.claim}</p>
              </div>
            ))}
          </div>
        </details>
      )}

      {result.transcript_segments.length > 0 && (
        <details className="mt-4 border-t border-ink/[0.08] pt-4">
          <summary className="cursor-pointer text-xs text-ink/75 transition hover:text-ink/75">
            Answer transcript · {result.transcript_segments.length} timestamped segments
          </summary>
          <div className="mt-3 space-y-1">
            {result.transcript_segments.map((segment) => (
              <button
                key={segment.segment_id}
                type="button"
                onClick={() => onSeek(segment.start_ms)}
                className={`flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-ink/[0.04] ${
                  segment.uncertain ? "bg-amber-400/[0.06]" : ""
                }`}
              >
                <span className="w-12 shrink-0 pt-0.5 font-mono text-[10px] text-accent">
                  {formatTimecode(segment.start_ms)}
                </span>
                <span
                  className={`min-w-0 flex-1 text-xs leading-relaxed ${
                    segment.uncertain ? "text-amber-800" : "text-ink/75"
                  }`}
                >
                  {segment.text}
                </span>
                {segment.uncertain && (
                  <span className="shrink-0 rounded-full border border-amber-300/30 bg-amber-400/10 px-2 py-0.5 text-[9px] uppercase tracking-[0.12em] text-amber-800">
                    review
                  </span>
                )}
              </button>
            ))}
          </div>
        </details>
      )}
    </article>
  );
}

export function InterviewReportView({
  report,
  questionSet,
  candidateName,
  onNewQuestions,
}: {
  report: InterviewReport;
  questionSet: QuestionSet;
  candidateName: string;
  onNewQuestions: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [clipAvailability, setClipAvailability] = useState<Record<string, boolean>>(
    {},
  );
  const [transcript, setTranscript] = useState<InterviewTranscript | null>(null);
  const firstAnswered =
    report.question_results.find((item) => item.answered)?.question_id ??
    report.question_results[0]?.question_id ??
    null;
  const [selectedId, setSelectedId] = useState<string | null>(firstAnswered);

  const selected = useMemo(
    () =>
      report.question_results.find((item) => item.question_id === selectedId) ??
      report.question_results[0] ??
      null,
    [report.question_results, selectedId],
  );
  const answeredCount = report.question_results.filter((item) => item.answered).length;
  const averageScore = useMemo(() => {
    const scores = report.question_results
      .map((item) => item.score_overall)
      .filter((value): value is number => value != null);
    if (scores.length === 0) return null;
    return scores.reduce((sum, value) => sum + value, 0) / scores.length;
  }, [report.question_results]);
  const metrics = report.communication_profile.metrics;

  useEffect(() => {
    let active = true;
    getInterviewClips(report.interview_id)
      .then(({ clips }) => {
        if (!active) return;
        const availability: Record<string, boolean> = {};
        for (const clip of clips) {
          availability[clip.question_id] = clip.available;
        }
        setClipAvailability(availability);
      })
      .catch(() => {
        // Clip listing is optional; the full recording still works.
      });
    return () => {
      active = false;
    };
  }, [report.interview_id]);

  useEffect(() => {
    let active = true;
    getInterviewTranscript(report.interview_id)
      .then((value) => {
        if (active) setTranscript(value);
      })
      .catch(() => {
        // The full transcript is optional; per-question segments remain.
      });
    return () => {
      active = false;
    };
  }, [report.interview_id]);

  const seek = (milliseconds: number) => {
    const player = videoRef.current;
    if (!player) return;
    player.currentTime = milliseconds / 1000;
    void player.play().catch(() => {});
  };

  const selectQuestion = (item: QuestionResult) => {
    setSelectedId(item.question_id);
    if (item.answer_window) seek(item.answer_window.start_ms);
  };

  return (
    <div className="space-y-6">
      {report.warnings.length > 0 && (
        <div className="rounded-xl border border-amber-400/25 bg-amber-400/[0.07] p-4">
          <p className="text-sm font-medium text-amber-800">
            Report completed with {report.warnings.length} warning
            {report.warnings.length === 1 ? "" : "s"}
          </p>
          <div className="mt-2 space-y-1">
            {report.warnings.map((item, index) => (
              <p key={`${item.code}-${index}`} className="text-xs leading-relaxed text-amber-800">
                {item.source ? `${item.source}: ` : ""}
                {item.message}
              </p>
            ))}
          </div>
        </div>
      )}

      {answeredCount < report.question_results.length && (
        <div className="rounded-xl border border-rose-400/25 bg-rose-400/[0.07] p-4">
          <p className="text-sm font-medium text-rose-800">
            Incomplete coverage · {answeredCount} of {report.question_results.length}{" "}
            questions located
          </p>
          <p className="mt-1 text-xs leading-relaxed text-rose-800">
            The recording did not yield a locatable answer for the following
            questions. Re-record or upload a complete take before treating this
            report as final.
          </p>
          <ul className="mt-2 space-y-1">
            {report.question_results
              .filter((item) => !item.answered)
              .map((item) => (
                <li key={item.question_id} className="flex gap-2.5 text-xs text-rose-800">
                  <span className="font-mono text-[10px] text-rose-800">
                    {String(item.order).padStart(2, "0")}
                  </span>
                  <span className="line-clamp-2">{item.question}</span>
                </li>
              ))}
          </ul>
        </div>
      )}

      <section className="animate-reveal grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div>
          <p className="text-[11px] uppercase tracking-[0.34em] text-accent">
            Interview evidence · {candidateName}
          </p>
          <h1 className="mt-4 max-w-3xl font-display text-4xl leading-[1.05] text-ink sm:text-5xl">
            Answers, measured
            <br />
            <span className="italic text-accent">against the record.</span>
          </h1>
          <p className="mt-5 max-w-2xl text-sm leading-relaxed text-ink/75">
            Every finding below points back to a timestamped transcript segment.
            Use the inventory as the source of truth, not the prose summary.
          </p>
        </div>
        <button
          type="button"
          onClick={onNewQuestions}
          className="animate-sweep relative self-start overflow-hidden rounded-full border border-ink/15 px-5 py-2.5 text-sm text-ink/75 transition hover:border-accent/35 hover:text-ink lg:self-auto"
        >
          <span className="relative z-10">Build another question set</span>
        </button>
      </section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "Questions", value: report.question_results.length },
          { label: "Answers located", value: `${answeredCount}/${report.question_results.length}` },
          { label: "Average answer score", value: averageScore != null ? averageScore.toFixed(1) : "—" },
          { label: "Video length", value: formatTimecode(report.video.duration_ms) },
        ].map((item) => (
          <div key={item.label} className="glass rounded-xl px-4 py-4">
            <p className="text-2xl font-semibold tabular-nums text-ink/90">{item.value}</p>
            <p className="mt-1 text-xs text-ink/75">{item.label}</p>
          </div>
        ))}
      </div>

      <section className="grid gap-5 border-y border-ink/[0.08] py-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,0.7fr)]">
        <div>
          <p className="text-[11px] uppercase tracking-[0.2em] text-ink/75">
            Overall read
          </p>
          <p className="mt-3 font-display text-xl leading-relaxed text-ink/80 sm:text-2xl">
            {report.overall_report.summary}
          </p>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-emerald-800">
              Strengths
            </p>
            <div className="mt-2 space-y-2">
              {report.overall_report.strengths.length === 0 ? (
                <p className="text-xs text-ink/75">No synthesized strength.</p>
              ) : (
                report.overall_report.strengths.map((item, index) => (
                  <p key={index} className="text-xs leading-relaxed text-ink/75">
                    <span className="mr-1 text-emerald-800">+</span>
                    {item.text}
                  </p>
                ))
              )}
            </div>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-amber-800">
              Risks
            </p>
            <div className="mt-2 space-y-2">
              {report.overall_report.risks.length === 0 ? (
                <p className="text-xs text-ink/75">No synthesized risk.</p>
              ) : (
                report.overall_report.risks.map((item, index) => (
                  <p key={index} className="text-xs leading-relaxed text-ink/75">
                    <span className="mr-1 text-amber-800">!</span>
                    {item.text}
                  </p>
                ))
              )}
            </div>
          </div>
        </div>
      </section>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(310px,0.75fr)]">
        <div className="space-y-5">
          <div className="glass overflow-hidden rounded-2xl">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink/[0.08] px-4 py-3 sm:px-5">
              <div>
                <p className="text-sm font-medium text-ink/80">{report.video.filename}</p>
                <p className="mt-0.5 text-[11px] text-ink/75">
                  {formatFileSize(report.video.size_bytes)} ·{" "}
                  {formatTimecode(report.video.duration_ms)} · local evidence
                </p>
              </div>
              <span className="rounded-full border border-emerald-300/15 bg-emerald-400/[0.07] px-2.5 py-1 text-[10px] uppercase tracking-[0.15em] text-emerald-800">
                Timestamp linked
              </span>
            </div>
            <video
              ref={videoRef}
              controls
              playsInline
              preload="metadata"
              className="aspect-video w-full bg-background"
              src={interviewVideoUrl(report.interview_id)}
            />
          </div>

          {selected && (
            <QuestionDetail
              result={selected}
              questionSet={questionSet}
              clipUrl={
                clipAvailability[selected.question_id]
                  ? interviewClipUrl(report.interview_id, selected.question_id)
                  : null
              }
              onSeek={seek}
            />
          )}
        </div>

        <aside className="xl:sticky xl:top-6">
          <div className="glass overflow-hidden rounded-2xl">
            <div className="border-b border-ink/[0.08] px-4 py-4">
              <p className="text-[11px] uppercase tracking-[0.2em] text-accent">
                Timestamp inventory
              </p>
              <p className="mt-1 text-xs text-ink/75">Select a question to seek the video.</p>
            </div>
            <div className="max-h-[62vh] overflow-y-auto p-2">
              {report.timestamp_inventory.map((item) => {
                const result = report.question_results.find(
                  (entry) => entry.question_id === item.question_id,
                );
                const active = item.question_id === selected?.question_id;
                return (
                  <button
                    key={item.question_id}
                    type="button"
                    disabled={!item.answered || !result}
                    onClick={() => result && selectQuestion(result)}
                    className={`mb-1.5 w-full rounded-xl border px-3 py-3 text-left transition last:mb-0 ${
                      active
                        ? "border-accent/30 bg-accent/[0.08]"
                        : "border-transparent hover:border-ink/10 hover:bg-ink/[0.04]"
                    } disabled:cursor-not-allowed disabled:opacity-75`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span className="flex min-w-0 gap-2.5">
                        <span className="pt-0.5 font-mono text-[10px] text-ink/75">
                          {String(item.order).padStart(2, "0")}
                        </span>
                        <span className="line-clamp-2 text-xs leading-relaxed text-ink/75">
                          {result?.question ?? "Question unavailable"}
                        </span>
                      </span>
                      <span className="shrink-0 font-mono text-[10px] text-accent">
                        {formatTimecode(item.start_ms)}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center gap-2 pl-[26px]">
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${confidenceClass(item.alignment_confidence)}`}
                      />
                      <span className="text-[10px] capitalize text-ink/75">
                        {item.answered
                          ? `${item.alignment_confidence} alignment`
                          : "Answer not located"}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </aside>
      </div>

      {transcript && transcript.segments.length > 0 && (
        <section className="glass rounded-2xl p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.2em] text-accent">
                Full transcript
              </p>
              <h2 className="mt-1 font-display text-2xl text-ink/85">
                Every word, timestamped.
              </h2>
            </div>
            <div className="flex items-center gap-2 rounded-full border border-ink/10 bg-background/20 px-3 py-2 text-xs text-ink/75">
              <span className="h-2 w-2 rounded-full bg-amber-300" />
              {transcript.segments.filter((item) => item.uncertain).length}{" "}
              wording
              {transcript.segments.filter((item) => item.uncertain).length === 1
                ? ""
                : "s"}{" "}
              to review
            </div>
          </div>
          <p className="mt-2 text-xs text-ink/75">
            Amber rows are segments the speech model itself marked uncertain
            (low word confidence or suspected non-speech). Listen before
            trusting the wording.
          </p>
          <div className="mt-4 max-h-[46vh] divide-y divide-white/[0.04] overflow-y-auto rounded-xl border border-ink/[0.06] bg-background/15">
            {transcript.segments.map((segment) => (
              <button
                key={segment.segment_id}
                type="button"
                onClick={() => seek(segment.start_ms)}
                className={`flex w-full items-start gap-3 px-3 py-2 text-left transition hover:bg-ink/[0.04] ${
                  segment.uncertain ? "bg-amber-400/[0.06]" : ""
                }`}
              >
                <span className="w-12 shrink-0 pt-0.5 font-mono text-[10px] text-accent">
                  {formatTimecode(segment.start_ms)}
                </span>
                <span
                  className={`min-w-0 flex-1 text-xs leading-relaxed ${
                    segment.uncertain ? "text-amber-800" : "text-ink/75"
                  }`}
                >
                  {segment.text}
                </span>
                {segment.uncertain && (
                  <span className="shrink-0 rounded-full border border-amber-300/30 bg-amber-400/10 px-2 py-0.5 text-[9px] uppercase tracking-[0.12em] text-amber-800">
                    review
                  </span>
                )}
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div className="glass rounded-2xl p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[11px] uppercase tracking-[0.2em] text-ink/75">
                Communication profile
              </p>
              <h2 className="mt-2 font-display text-2xl text-ink/85">
                Measured delivery, not personality.
              </h2>
            </div>
            <span className="rounded-full border border-ink/10 px-2.5 py-1 text-[10px] text-ink/75">
              Descriptive
            </span>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-3">
            {[
              {
                label: "Articulation",
                value:
                  metrics.articulation_rate_wpm != null
                    ? `${metrics.articulation_rate_wpm.toFixed(0)} wpm`
                    : "—",
              },
              { label: "Speech ratio", value: `${Math.round(metrics.speech_ratio * 100)}%` },
              { label: "Long pauses", value: metrics.long_pause_count },
              {
                label: "Filler rate",
                value: `${metrics.filler_rate_per_100_words.toFixed(1)} / 100w`,
              },
              { label: "Coverage", value: `${Math.round(metrics.coverage_ratio * 100)}%` },
              {
                label: "Vocal variance",
                value:
                  metrics.volume_variability_db != null
                    ? `${metrics.volume_variability_db.toFixed(1)} dB`
                    : "—",
              },
            ].map((item) => (
              <div key={item.label}>
                <p className="text-lg font-semibold tabular-nums text-ink/80">{item.value}</p>
                <p className="mt-0.5 text-[11px] text-ink/75">{item.label}</p>
              </div>
            ))}
          </div>
          <div className="mt-5 space-y-2 border-t border-ink/[0.08] pt-4">
            {report.communication_profile.interpretations.map((item, index) => (
              <p key={index} className="text-xs leading-relaxed text-ink/75">
                <span className="text-ink/75">{item.dimension}:</span> {item.observation}
              </p>
            ))}
          </div>
          <div className="mt-4 border-t border-ink/[0.08] pt-4">
            <p className="text-[10px] uppercase tracking-[0.18em] text-ink/75">
              Interpretation limits
            </p>
            {report.communication_profile.caveats.map((item, index) => (
              <p key={index} className="mt-1.5 text-[11px] leading-relaxed text-ink/75">
                {item}
              </p>
            ))}
          </div>
        </div>

        <div className="glass rounded-2xl p-5 sm:p-6">
          <p className="text-[11px] uppercase tracking-[0.2em] text-ink/75">
            Suggested follow-up
          </p>
          <h2 className="mt-2 font-display text-2xl text-ink/85">
            Probe what remains thin.
          </h2>
          {report.overall_report.recommended_follow_up_questions.length === 0 ? (
            <p className="mt-4 text-sm text-ink/75">
              No additional question was generated for this report.
            </p>
          ) : (
            <ol className="mt-4 space-y-3">
              {report.overall_report.recommended_follow_up_questions.map(
                (item, index) => (
                  <li
                    key={`${item}-${index}`}
                    className="flex gap-3 border-t border-ink/[0.07] pt-3 text-sm leading-relaxed text-ink/75 first:border-t-0 first:pt-0"
                  >
                    <span className="font-mono text-[10px] text-accent">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    {item}
                  </li>
                ),
              )}
            </ol>
          )}
          <p className="mt-6 border-t border-ink/[0.08] pt-4 text-[11px] leading-relaxed text-ink/75">
            This report supports human review. It intentionally provides no hire or
            no-hire recommendation.
          </p>
        </div>
      </section>
    </div>
  );
}
