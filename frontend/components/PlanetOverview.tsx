"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ScoreRing } from "./ScoreRing";
import { EvidenceList } from "./EvidenceList";
import Starfield from "./Starfield";
import {
  getModuleEvidence,
  type Assessment,
  type ModuleAssessment,
  type ModuleKey,
} from "@/lib/scoring";
import {
  authorRoleLabel,
  venueTypeLabel,
  serviceTypeLabel,
  fundingRoleLabel,
} from "@/lib/labels";
import type { Candidate, DateValue, Evidence, EvidenceStatus } from "@/lib/types";
import type { InterviewScoreRecord } from "@/lib/archive";
import {
  competencyLabel,
  scoreLabel,
  type QuestionScores,
} from "@/lib/interview";

type GetStatus = (e: Evidence) => EvidenceStatus;

/** 整体评分弹窗中可展开的板块：六大模块 + 面试评分。 */
export type OverviewSection = ModuleKey | "interview";

const INTERVIEW_SCORE_KEYS: Array<keyof QuestionScores> = [
  "evidence_specificity",
  "ownership",
  "depth",
  "consistency",
  "communication",
];

function InterviewMiniBar({
  value,
  label,
}: {
  value: number | null;
  label: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2 text-[10px]">
        <span className="text-ink/60">{label}</span>
        <span className="tabular-nums text-ink/85">
          {value != null ? value.toFixed(1) : "—"}
        </span>
      </div>
      <div className="mt-1 h-[3px] overflow-hidden rounded-full bg-ink/10">
        <div
          className="h-full rounded-full bg-gradient-to-r from-[#f4c95d] to-[#f8dfa0]"
          style={{ width: `${Math.max(0, Math.min(100, (value ?? 0) * 10))}%` }}
        />
      </div>
    </div>
  );
}

/** 面试板块详情：总分 + 每道题的五个维度细则分。 */
function InterviewDetail({
  record,
  profileId,
}: {
  record: InterviewScoreRecord;
  profileId?: string | null;
}) {
  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.22em] text-ink/55">
            Interview score
          </p>
          <h2 className="mt-1.5 text-lg font-semibold">Interview performance</h2>
          <p className="mt-1 text-xs text-ink/75">
            {record.answeredCount} of {record.totalCount} questions answered
            {record.updatedAt
              ? ` · ${new Date(record.updatedAt).toLocaleDateString()}`
              : ""}
          </p>
        </div>
        <ScoreRing
          score={record.overall}
          size={82}
          stroke={7}
          label="Score"
          variant="score"
        />
      </div>

      <div className="mt-4 space-y-3">
        {record.questions.map((question) => (
          <div
            key={question.questionId}
            className={`rounded-2xl border p-3.5 ${
              question.answered
                ? "border-ink/10 bg-white/55"
                : "border-rose-300/45 bg-rose-400/10"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-[0.18em] text-ink/55">
                  Q{String(question.order).padStart(2, "0")} ·{" "}
                  {question.competency
                    ? competencyLabel(question.competency)
                    : "Interview signal"}
                </p>
                <p className="mt-1.5 text-sm leading-relaxed text-ink/85">
                  {question.text}
                </p>
              </div>
              <div className="shrink-0 text-right">
                {question.answered ? (
                  <>
                    <span className="text-xl font-semibold tabular-nums text-accent">
                      {question.overall != null ? question.overall.toFixed(1) : "—"}
                    </span>
                    <span className="block text-[10px] text-ink/50">/10</span>
                  </>
                ) : (
                  <span className="rounded-full border border-rose-300/50 bg-rose-400/10 px-2 py-1 text-[10px] text-rose-700">
                    Not answered
                  </span>
                )}
              </div>
            </div>

            {question.answered && question.scores && (
              <div className="mt-3 grid gap-x-5 gap-y-2.5 border-t border-ink/10 pt-3 sm:grid-cols-2">
                {INTERVIEW_SCORE_KEYS.map((key) => (
                  <InterviewMiniBar
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

      {profileId && (
        <div className="mt-5 border-t border-ink/10 pt-4">
          <Link
            href={`/interview/${encodeURIComponent(profileId)}`}
            className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-accent to-accent-deep px-5 py-2.5 text-sm font-medium text-white transition hover:brightness-105"
          >
            Open full interview report
            <span aria-hidden="true">→</span>
          </Link>
        </div>
      )}
    </>
  );
}

function n(v: string | null | undefined): string {
  return v ?? "—";
}

function dateRange(start: DateValue, end: DateValue): string {
  return `${start ?? "?"} ~ ${end ?? "Present"}`;
}

function TagChips({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-3">
      <p className="text-xs text-ink/75">{label}</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {items.map((x, i) => (
          <span key={i} className="rounded-full bg-ink/10 px-2.5 py-1 text-xs text-ink/75">
            {x}
          </span>
        ))}
      </div>
    </div>
  );
}

function SimpleList({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-3">
      <p className="text-xs text-ink/75">{label}</p>
      <ul className="mt-1.5 space-y-1">
        {items.map((x, i) => (
          <li key={i} className="flex gap-2 text-sm text-ink/75">
            <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-accent/70" />
            {x}
          </li>
        ))}
      </ul>
    </div>
  );
}

function DetailBody({ m, candidate }: { m: ModuleAssessment; candidate: Candidate }) {
  const c = candidate;
  switch (m.key) {
    case "basic_info":
      return (
        <>
          <p className="text-lg font-semibold">{n(c.basic_info.name)}</p>
          <p className="mt-1 text-sm text-ink/75">
            {n(c.basic_info.position)}
            {c.basic_info.institution ? ` · ${c.basic_info.institution}` : ""}
            {c.basic_info.highest_degree ? ` · ${c.basic_info.highest_degree}` : ""}
          </p>
          <TagChips label="Research interests" items={c.basic_info.research_interests} />
          <TagChips label="Skills" items={c.basic_info.skills} />
          <SimpleList label="Strengths" items={c.basic_info.strengths} />
          {c.basic_info.to_verify.length > 0 && (
            <div className="mt-3">
              <p className="text-xs text-ink/75">Items to verify</p>
              {c.basic_info.to_verify.map((v, i) => (
                <div key={i} className="mt-2 border-t border-ink/10 pt-2 first:border-t-0">
                  <p className="text-sm text-ink/85">{v.claim}</p>
                  <p className="mt-0.5 text-xs text-ink/75">{v.reason}</p>
                </div>
              ))}
            </div>
          )}
        </>
      );
    case "education_employment":
      return (
        <>
          {c.education_employment.education.map((e, i) => (
            <div key={i} className="mt-3 border-t border-ink/10 pt-3 first:mt-0 first:border-t-0 first:pt-0">
              <p className="font-semibold">
                {n(e.degree)} · {n(e.field)}
              </p>
              <p className="mt-0.5 text-xs text-ink/75">
                {n(e.institution)} · Advisor: {n(e.advisor)}
              </p>
              <p className="text-xs text-ink/75">{dateRange(e.start_date, e.end_date)}</p>
            </div>
          ))}
          {c.education_employment.employment.map((e, i) => (
            <div key={i} className="mt-3 border-t border-ink/10 pt-3">
              <p className="font-semibold">
                {n(e.position)} · {n(e.institution)}
              </p>
              <p className="mt-0.5 text-xs text-ink/75">{dateRange(e.start_date, e.end_date)}</p>
            </div>
          ))}
        </>
      );
    case "awards_funding":
      return (
        <>
          {c.awards_funding.awards.map((a, i) => (
            <div key={i} className="mt-3 border-t border-ink/10 pt-3 first:mt-0 first:border-t-0 first:pt-0">
              <p className="font-semibold">{a.name}</p>
              <p className="mt-0.5 text-xs text-ink/75">
                {a.year ?? "?"} · Awarding body: {n(a.awarding_body)}
              </p>
            </div>
          ))}
          {c.awards_funding.funding.map((f, i) => (
            <div key={i} className="mt-3 border-t border-ink/10 pt-3">
              <p className="font-semibold">{f.project_name}</p>
              <p className="mt-0.5 text-xs text-ink/75">
                {n(f.funder)} · {fundingRoleLabel[f.role]}
                {f.amount != null ? ` · ${f.amount.toLocaleString()} ${f.currency ?? ""}` : ""}
              </p>
            </div>
          ))}
        </>
      );
    case "publications_impact":
      return (
        <>
          <p className="text-sm text-ink/75">
            Total citations: {c.publications_impact.total_citations ?? "—"}
          </p>
          {c.publications_impact.publications.map((p, i) => (
            <div key={i} className="mt-3 border-t border-ink/10 pt-3 first:mt-0 first:border-t-0 first:pt-0">
              <p className="font-semibold">{p.title}</p>
              <p className="mt-0.5 text-xs text-ink/75">
                {p.year ?? "?"} · {authorRoleLabel[p.author_role]} · {n(p.venue)} ·{" "}
                {venueTypeLabel[p.venue_type]}
                {p.ranking ? ` · ${p.ranking}` : ""}
                {p.citation_count != null ? ` · citations ${p.citation_count}` : ""}
              </p>
            </div>
          ))}
        </>
      );
    case "academic_service":
      return (
        <>
          {c.academic_service.services.map((s, i) => (
            <div key={i} className="mt-3 border-t border-ink/10 pt-3 first:mt-0 first:border-t-0 first:pt-0">
              <p className="font-semibold">{s.organization_or_venue}</p>
              <p className="mt-0.5 text-xs text-ink/75">
                {serviceTypeLabel[s.service_type]}
                {s.role ? ` · ${s.role}` : ""} · {s.start_year ?? "?"} ~ {s.end_year ?? "Present"}
              </p>
              {s.research_areas.length > 0 && (
                <p className="mt-0.5 text-xs text-ink/75">
                  Areas: {s.research_areas.join(", ")}
                </p>
              )}
            </div>
          ))}
        </>
      );
    case "overall_evaluation":
      return (
        <>
          <p className="text-sm text-ink/75">{n(c.overall_evaluation.summary)}</p>
          <SimpleList label="Strengths" items={c.overall_evaluation.strengths} />
          <SimpleList label="Risks" items={c.overall_evaluation.risks} />
          {c.overall_evaluation.dimensions.map((d, i) => (
            <div key={i} className="mt-3 border-t border-ink/10 pt-3 first:mt-0 first:border-t-0 first:pt-0">
              <p className="font-semibold">{d.dimension}</p>
              <p className="mt-0.5 text-sm text-ink/75">{d.assessment}</p>
            </div>
          ))}
        </>
      );
  }
}

export function PlanetOverview({
  candidate,
  assessment,
  interviewScore = null,
  interviewProfileId = null,
  initialSelected = null,
  onClose,
  onEvidenceClick,
  getStatus,
  scoreLoading = false,
}: {
  candidate: Candidate;
  assessment: Assessment;
  interviewScore?: InterviewScoreRecord | null;
  interviewProfileId?: string | null;
  initialSelected?: OverviewSection | null;
  onClose: () => void;
  onEvidenceClick: (e: Evidence) => void;
  getStatus: GetStatus;
  scoreLoading?: boolean;
}) {
  const [selected, setSelected] = useState<OverviewSection | null>(
    initialSelected,
  );

  // 打开评分总览时锁定页面滚动，避免滚轮滚动穿透到下层简历页；
  // 弹窗内部的滚动（如板块详情抽屉）仍可正常使用。
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  const selectedModule = selected
    ? assessment.modules.find((m) => m.key === selected) ?? null
    : null;
  const selectedEvidence =
    selected && selected !== "interview"
      ? getModuleEvidence(candidate, selected)
      : [];
  const name = candidate.basic_info.name?.trim() ?? "";
  const initial = name ? name.slice(0, 1) : "?";

  return (
    <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      <div
        className="pointer-events-auto relative flex h-[min(90vh,840px)] w-[min(96vw,1180px)] flex-col overflow-hidden rounded-3xl border border-ink/12 bg-[#eaf1f6] text-ink/90 shadow-[0_40px_140px_-40px_rgba(0,0,0,0.95)]"
      >
        <Starfield contained />
        <div className="relative z-10 flex h-full flex-col">
          {/* 顶部：标题 + 关闭 */}
          <div className="flex items-center justify-between px-6 pt-4 sm:px-8 sm:pt-5">
          <div className="flex items-baseline gap-3">
            <span className="font-display text-xl font-semibold">Candidate Overview</span>
            <span className="text-xs uppercase tracking-[0.18em] text-ink/75">
              Candidate Overview
            </span>
          </div>
          <button
            onClick={onClose}
            className="grid h-9 w-9 place-items-center rounded-full border border-ink/15 bg-ink/5 text-ink/75 transition hover:bg-ink/10 hover:text-ink"
            aria-label="Close"
          >
            ✕
          </button>
          </div>

          {/* 顶部约 1/6：大头照 + 综合评分 */}
          <div className="flex items-center justify-center gap-6 px-6 py-3 sm:px-8 sm:py-4">
          <div className="flex items-center gap-3">
            <span className="grid h-14 w-14 place-items-center rounded-full bg-gradient-to-br from-accent to-accent-deep text-2xl font-semibold text-white">
              {initial}
            </span>
            <span className="min-w-0">
              <span className="block text-base font-semibold">
                {name || "Unnamed candidate"}
              </span>
              <span className="block text-xs text-ink/75">
                {candidate.basic_info.institution ?? ""}
              </span>
            </span>
          </div>
          <div className="h-10 w-px bg-ink/[0.12]" />
          <div className="flex items-center gap-4">
            <ScoreRing score={assessment.overall} size={94} label="Score" variant="score" />
            {scoreLoading && assessment.overall == null && (
              <span className="animate-pulse text-[11px] text-accent">
                Scoring…
              </span>
            )}
          </div>
          <div className="h-10 w-px bg-ink/[0.12]" />
          <ScoreRing
            score={assessment.credibility}
            size={94}
            label="Credibility"
            variant="credibility"
          />
          <p className="max-w-[240px] text-xs leading-relaxed text-ink/75">
            Score reflects experience and output quality; credibility follows source reliability
            and evidence status, updating live as you correct labels.
          </p>
        </div>

        {/* 板块列表：一行一个板块 */}
        <div className="flex-1 overflow-y-auto px-6 sm:px-8">
          <div className="space-y-2.5 pb-4">
            {interviewScore && (
              <button
                type="button"
                onClick={() => setSelected("interview")}
                className={`flex w-full items-center gap-4 rounded-xl border px-4 py-3 text-left transition ${
                  selected === "interview"
                    ? "border-accent/50 bg-accent/[0.07]"
                    : "border-ink/[0.1] bg-ink/[0.03] hover:border-accent/40 hover:bg-ink/[0.06]"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-semibold">Interview Score</span>
                  </div>
                  <div className="mt-0.5 text-xs text-ink/75">
                    {interviewScore.answeredCount} of {interviewScore.totalCount}{" "}
                    questions answered · per-question AI assessment
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="inline-flex items-center gap-1 rounded-full border border-ink/[0.12] bg-ink/[0.06] px-2.5 py-0.5 text-xs tabular-nums">
                    <b className="text-accent">
                      {interviewScore.overall != null
                        ? interviewScore.overall.toFixed(1)
                        : "—"}
                    </b>
                    <span className="text-ink/75">Score</span>
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full border border-sky-300/[0.18] bg-sky-400/[0.08] px-2.5 py-0.5 text-xs">
                    <span className="text-sky-800">Interview</span>
                  </span>
                </div>
              </button>
            )}
            {assessment.modules.map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => setSelected(m.key)}
                className={`flex w-full items-center gap-4 rounded-xl border px-4 py-3 text-left transition ${
                  selected === m.key
                    ? "border-accent/50 bg-accent/[0.07]"
                    : "border-ink/[0.1] bg-ink/[0.03] hover:border-accent/40 hover:bg-ink/[0.06]"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-semibold">{m.title}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-ink/75">
                    {m.pros} · {m.cons}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="inline-flex items-center gap-1 rounded-full border border-ink/[0.12] bg-ink/[0.06] px-2.5 py-0.5 text-xs tabular-nums">
                    <b className="text-accent">
                      {m.score != null ? m.score.toFixed(1) : "—"}
                    </b>
                    <span className="text-ink/75">Score</span>
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full border border-sky-300/[0.18] bg-sky-400/[0.08] px-2.5 py-0.5 text-xs tabular-nums">
                    <b className="text-sky-800">{m.credibility.toFixed(1)}</b>
                    <span className="text-ink/75">Credibility</span>
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="pb-3 text-center text-[11.5px] tracking-wide text-ink/75">
          Click a <b className="font-semibold text-accent">section</b> to view details
        </div>
      </div>

      {/* 板块详情抽屉（模块或面试评分） */}
      {(selectedModule || (selected === "interview" && interviewScore)) && (
        <div
          className="absolute inset-0 z-20 flex justify-end bg-background/60"
          onClick={() => setSelected(null)}
        >
          <div
            className="glass my-5 mr-5 w-full max-w-[460px] overflow-auto rounded-2xl p-6"
            style={{
              background:
                "linear-gradient(165deg, rgba(238,241,228,0.98) 0%, rgba(224,228,210,0.99) 45%, rgba(210,214,194,0.99) 100%)",
            }}
            onClick={(ev) => ev.stopPropagation()}
          >
            {selectedModule ? (
              <>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-semibold">
                      {selectedModule.title}
                    </h2>
                    <p className="mt-1 text-xs text-ink/75">
                      Score: {selectedModule.pros} · {selectedModule.cons}
                    </p>
                    <p className="mt-1 text-xs text-sky-800">
                      Credibility: {selectedModule.credPros} ·{" "}
                      {selectedModule.credCons}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <ScoreRing
                      score={selectedModule.score}
                      size={70}
                      stroke={6}
                      label="Score"
                      variant="score"
                    />
                    <ScoreRing
                      score={selectedModule.credibility}
                      size={70}
                      stroke={6}
                      label="Credibility"
                      variant="credibility"
                    />
                  </div>
                </div>

                <div className="mt-4">
                  <DetailBody m={selectedModule} candidate={candidate} />
                </div>

                <div className="mt-5 border-t border-ink/10 pt-4">
                  <p className="text-xs text-ink/75">
                    Evidence (click to review and correct)
                  </p>
                  <EvidenceList
                    items={selectedEvidence}
                    onEvidenceClick={onEvidenceClick}
                    getStatus={getStatus}
                  />
                </div>
              </>
            ) : (
              <InterviewDetail
                record={interviewScore!}
                profileId={interviewProfileId}
              />
            )}
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
