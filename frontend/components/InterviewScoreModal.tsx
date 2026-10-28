"use client";

import { useEffect } from "react";
import Link from "next/link";
import type { ArchiveEntry } from "@/lib/archive";
import {
  competencyLabel,
  scoreLabel,
  type QuestionScores,
} from "@/lib/interview";

const SCORE_KEYS: Array<keyof QuestionScores> = [
  "evidence_specificity",
  "ownership",
  "depth",
  "consistency",
  "communication",
];

function MiniBar({ value, label }: { value: number | null; label: string }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2 text-[10px]">
        <span className="text-[#aebfd0]">{label}</span>
        <span className="tabular-nums text-[#d9e5ef]">
          {value != null ? value.toFixed(1) : "—"}
        </span>
      </div>
      <div className="mt-1 h-[3px] overflow-hidden rounded-full bg-white/[0.08]">
        <div
          className="h-full rounded-full bg-gradient-to-r from-[#f4c95d] to-[#f8dfa0]"
          style={{ width: `${Math.max(0, Math.min(100, (value ?? 0) * 10))}%` }}
        />
      </div>
    </div>
  );
}

/** 面试评分详情弹窗：总分 + 每道题细则分，点击可跳转完整面试报告。 */
export function InterviewScoreModal({
  entry,
  onClose,
}: {
  entry: ArchiveEntry | null;
  onClose: () => void;
}) {
  const record = entry?.interviewScore ?? null;

  // 弹窗打开时锁定背后的页面滚动，滚动只发生在弹窗内部。
  useEffect(() => {
    if (!record) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [record]);

  if (!entry || !record) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-[#07111d]/60 p-4 backdrop-blur-md"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${entry.name} interview score details`}
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[88vh] w-[min(96vw,720px)] flex-col overflow-hidden rounded-3xl border border-[#5a7c94]/25 bg-[#0d1826] text-[#e7f0f7] shadow-[0_48px_140px_-32px_rgba(0,0,0,0.9)]"
      >
        {/* 头部：姓名 + 面试总分 */}
        <div className="shrink-0 border-b border-white/[0.07] bg-white/[0.03] px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.24em] text-[#8fa9bd]">
                Interview score · {entry.name}
              </p>
              <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-4xl font-semibold tabular-nums text-[#f4c95d]">
                  {record.overall != null ? record.overall.toFixed(1) : "—"}
                </span>
                <span className="text-sm text-[#8fa9bd]">/ 10 overall</span>
                <span className="rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[11px] text-[#c3d4e2]">
                  {record.answeredCount} of {record.totalCount} questions answered
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/10 text-lg leading-none text-[#8fa9bd] transition hover:border-white/25 hover:text-white"
              aria-label="Close interview score"
            >
              ×
            </button>
          </div>
        </div>

        {/* 题目细则列表 */}
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4 sm:px-6">
          {record.questions.map((question) => (
            <div
              key={question.questionId}
              className={`rounded-2xl border p-4 ${
                question.answered
                  ? "border-white/[0.07] bg-white/[0.035]"
                  : "border-rose-300/15 bg-rose-400/[0.04]"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-[#8fa9bd]">
                    Q{String(question.order).padStart(2, "0")} ·{" "}
                    {question.competency
                      ? competencyLabel(question.competency)
                      : "Interview signal"}
                  </p>
                  <p className="mt-1.5 text-sm leading-relaxed text-[#dbe6ef]">
                    {question.text}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  {question.answered ? (
                    <>
                      <span className="text-xl font-semibold tabular-nums text-[#f4c95d]">
                        {question.overall != null
                          ? question.overall.toFixed(1)
                          : "—"}
                      </span>
                      <span className="block text-[10px] text-[#8fa9bd]">/10</span>
                    </>
                  ) : (
                    <span className="rounded-full border border-rose-300/20 bg-rose-400/10 px-2 py-1 text-[10px] text-rose-200">
                      Not answered
                    </span>
                  )}
                </div>
              </div>

              {question.answered && question.scores && (
                <div className="mt-3 grid gap-x-5 gap-y-2.5 border-t border-white/[0.06] pt-3 sm:grid-cols-2">
                  {SCORE_KEYS.map((key) => (
                    <MiniBar
                      key={key}
                      value={question.scores?.[key] ?? null}
                      label={scoreLabel(key)}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* 底部：打开完整报告 */}
        <div className="shrink-0 border-t border-white/[0.07] bg-white/[0.03] px-6 py-4">
          <Link
            href={`/interview/${encodeURIComponent(entry.profileId)}`}
            onClick={onClose}
            className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#f4c95d] to-[#e8b64d] px-5 py-2.5 text-sm font-medium text-[#172535] transition hover:brightness-105"
          >
            Open full interview report
            <span aria-hidden="true">→</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
