"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { mockProfile } from "@/lib/mock";
import {
  uploadFiles,
  analyze,
  getAnalyzeStatus,
  fetchScore,
  askQuestion,
} from "@/lib/api";
import { Section, sectionArt } from "@/components/Section";
import Starfield from "@/components/Starfield";
import AnalyzingStage from "@/components/AnalyzingStage";
import CountUp from "@/components/CountUp";
import { PlanetOverview } from "@/components/PlanetOverview";
import { useIdentity } from "@/components/IdentityProvider";
import { EvidenceList } from "@/components/EvidenceList";
import { EvidenceBadge } from "@/components/EvidenceBadge";
import { EvidenceModal } from "@/components/EvidenceModal";
import { TagFilter, type FilterState } from "@/components/TagFilter";
import { useArchive } from "@/components/ArchiveProvider";
import { getArchive } from "@/lib/archive";
import { computeAssessment } from "@/lib/scoring";
import {
  authorRoleLabel,
  venueTypeLabel,
  serviceTypeLabel,
  fundingRoleLabel,
} from "@/lib/labels";
import type {
  DateValue,
  Evidence,
  EvidenceStatus,
  Candidate,
  AnalysisWarning,
  AnalysisProgress,
  LlmAssessment,
  QAResponse,
} from "@/lib/types";

// 空值兜底显示
function n(v: string | null | undefined): string {
  return v ?? "—";
}

// 日期区间（null 视为"至今"）
function dateRange(start: DateValue, end: DateValue): string {
  const s = start ?? "?";
  const e = end ?? "Present";
  return `${s} ~ ${e}`;
}

// 过滤空值，返回 string[]
function nonEmpty(xs: (string | null | undefined)[]): string[] {
  return xs.filter((x): x is string => Boolean(x));
}

// 标签行（研究方向 / 技能 / 优势等）
function TagRow({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-4">
      <p className="text-xs font-medium text-white/40">{label}</p>
      <div className="mt-1.5 flex flex-wrap gap-2">
        {items.map((x) => (
          <span
            key={x}
            className="rounded-full bg-white/10 px-3 py-1 text-sm text-white/70"
          >
            {x}
          </span>
        ))}
      </div>
    </div>
  );
}

// 文字行列表：替代小药丸，一排排列出
function BulletList({
  label,
  items,
  tone = "accent",
}: {
  label: string;
  items: string[];
  tone?: "accent" | "warn";
}) {
  if (items.length === 0) return null;
  const dot = tone === "warn" ? "bg-amber-400/70" : "bg-accent/70";
  return (
    <div className="mt-5">
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-white/35">
        {label}
      </p>
      <ul className="mt-2.5 space-y-0">
        {items.map((x, i) => (
          <li
            key={i}
            className="flex items-baseline gap-3 border-t border-white/[0.07] py-2.5 text-base leading-relaxed text-white/80 first:border-t-0 first:pt-0"
          >
            <span className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
            <span>{x}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="group inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.04] px-4 py-2 text-sm text-white/65 backdrop-blur-xl transition hover:border-accent/30 hover:text-white"
    >
      <span className="transition-transform group-hover:-translate-x-0.5">←</span>
      Back to home
    </button>
  );
}

const OVERVIEW_STARS = [
  { left: "11%", top: "26%", size: 2, delay: "0s", dur: "2.4s" },
  { left: "27%", top: "64%", size: 3, delay: "0.7s", dur: "3.1s" },
  { left: "46%", top: "20%", size: 2, delay: "1.3s", dur: "2.7s" },
  { left: "63%", top: "70%", size: 2, delay: "0.4s", dur: "3.4s" },
  { left: "80%", top: "32%", size: 3, delay: "1.9s", dur: "2.2s" },
  { left: "91%", top: "58%", size: 1.5, delay: "1.0s", dur: "2.9s" },
];

function OverviewButton({
  onClick,
  score,
}: {
  onClick: () => void;
  score: number | null;
}) {
  return (
    <button
      onClick={onClick}
      className="starfield-btn group relative inline-flex items-center gap-2 overflow-hidden rounded-full border border-accent/35 px-4 py-2 text-sm text-accent-soft"
    >
      {OVERVIEW_STARS.map((s, i) => (
        <span
          key={i}
          aria-hidden="true"
          className="sf-star pointer-events-none absolute rounded-full bg-white"
          style={{
            left: s.left,
            top: s.top,
            width: s.size,
            height: s.size,
            animationDelay: s.delay,
            animationDuration: s.dur,
          }}
        />
      ))}
      <span
        aria-hidden="true"
        className="sf-shoot pointer-events-none absolute inset-y-0 left-0 w-14 bg-gradient-to-r from-transparent via-white/50 to-transparent"
      />
      <span className="relative z-10" aria-hidden="true">✦</span>
      <span className="relative z-10">评分总览</span>
      <span className="relative z-10 inline-flex items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 text-xs font-semibold tabular-nums text-accent-soft">
        {score != null ? score.toFixed(1) : "—"}
        <span className="text-[10px] font-normal text-accent-soft/70">/10</span>
      </span>
    </button>
  );
}

export default function Home() {
  const { setIdentity } = useIdentity();
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState<string | null>(null);
  const [analysisProgress, setAnalysisProgress] =
    useState<AnalysisProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [analysisWarnings, setAnalysisWarnings] = useState<AnalysisWarning[]>([]);
  const [filter, setFilter] = useState<FilterState>({ tags: [], search: "" });
  const [selectedEvidence, setSelectedEvidence] = useState<Evidence | null>(null);
  const [corrections, setCorrections] = useState<Map<Evidence, EvidenceStatus>>(
    new Map(),
  );
  const [profileId, setProfileId] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [qaResult, setQaResult] = useState<QAResponse | null>(null);
  const [qaError, setQaError] = useState<string | null>(null);
  const [qaLoading, setQaLoading] = useState(false);
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [llmAssessment, setLlmAssessment] = useState<LlmAssessment | null>(null);
  const [scoreLoading, setScoreLoading] = useState(false);
  const { saveArchive, pendingId, clearPending } = useArchive();

  const getStatus = (e: Evidence): EvidenceStatus =>
    corrections.get(e) ?? e.evidence_status;

  // 对 mock / 已存档档案即时获取 DeepSeek 评分（后端分析已完成但评分
  // 失败时也可用它重试）。
  const refreshLlmScore = useCallback(
    async (id: string, target: Candidate) => {
      setScoreLoading(true);
      try {
        const res = await fetchScore(target);
        setLlmAssessment(res);
        saveArchive(id, target, res);
      } catch {
        // 评分失败不影响主流程：界面显示「—」并保留可信度。
      } finally {
        setScoreLoading(false);
      }
    },
    [saveArchive],
  );

  // 侧栏底部身份位跟随候选人
  useEffect(() => {
    setIdentity(
      candidate
        ? {
            name: candidate.basic_info.name ?? "Unnamed candidate",
            detail: candidate.basic_info.institution ?? "",
          }
        : null,
    );
  }, [candidate, setIdentity]);

  const correctEvidence = (target: Evidence, status: EvidenceStatus) => {
    setCorrections((prev) => {
      const next = new Map(prev);
      next.set(target, status);
      return next;
    });
  };

  const handleFiles = async (files: File[]) => {
    setLoading(true);
    setLoadingMessage("Uploading and parsing documents...");
    setAnalysisProgress(null);
    setError(null);
    setAnalysisWarnings([]);
    try {
      const { upload_id } = await uploadFiles(files);
      setLoadingMessage("Extracting profile and verifying public sources...");
      const first = await analyze(upload_id);
      if (
        first.status === "completed" ||
        first.status === "completed_with_warnings"
      ) {
        setProfileId(first.profile_id ?? null);
        setCandidate(first.candidate ?? null);
        setLlmAssessment(first.assessment ?? null);
        if (first.profile_id && first.candidate) {
          saveArchive(
            first.profile_id,
            first.candidate,
            first.assessment ?? null,
          );
          if (!first.assessment) {
            void refreshLlmScore(first.profile_id, first.candidate);
          }
        }
        setAnalysisWarnings(first.warnings ?? []);
        setOverviewOpen(true);
      } else {
        await pollAnalyze(upload_id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed. Please try again.");
    } finally {
      setLoading(false);
      setLoadingMessage(null);
    }
  };

  const pollAnalyze = async (uploadId: string) => {
    // 分析在后台运行；每 1.5s 轮询一次，最长约 10 分钟。
    for (let attempt = 0; attempt < 400; attempt += 1) {
      const res = await getAnalyzeStatus(uploadId);
      if (res.progress) setAnalysisProgress(res.progress);
      if (
        res.status === "completed" ||
        res.status === "completed_with_warnings"
      ) {
        setAnalysisProgress(null);
        setProfileId(res.profile_id ?? null);
        setCandidate(res.candidate ?? null);
        setLlmAssessment(res.assessment ?? null);
        if (res.profile_id && res.candidate) {
          saveArchive(res.profile_id, res.candidate, res.assessment ?? null);
          if (!res.assessment) {
            void refreshLlmScore(res.profile_id, res.candidate);
          }
        }
        setAnalysisWarnings(res.warnings ?? []);
        setOverviewOpen(true);
        return;
      }
      if (res.status === "failed") {
        throw new Error(
          res.error?.detail ?? "Analysis failed on the server. Please try again.",
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    throw new Error("Analysis timed out. Please try again.");
  };

  const handleAsk = async () => {
    if (!profileId || !question.trim()) return;
    setQaLoading(true);
    setQaResult(null);
    setQaError(null);
    try {
      setQaResult(await askQuestion(profileId, question.trim()));
    } catch (e) {
      setQaError(e instanceof Error ? e.message : "Q&A failed. Please try again.");
    } finally {
      setQaLoading(false);
    }
  };

  const resetToHome = () => {
    setCandidate(null);
    setProfileId(null);
    setFilter({ tags: [], search: "" });
    setSelectedEvidence(null);
    setCorrections(new Map());
    setAnalysisWarnings([]);
    setQaResult(null);
    setQaError(null);
    setQuestion("");
    setLlmAssessment(null);
    setOverviewOpen(false);
  };

  // 从侧栏档案库点击文件夹后，加载对应的已存档简历。
  useEffect(() => {
    if (!pendingId) return;
    const entry = getArchive(pendingId);
    if (entry) {
      resetToHome();
      setCandidate(entry.candidate);
      setProfileId(entry.profileId);
      setLlmAssessment(entry.llm ?? null);
      if (!entry.llm) {
        void refreshLlmScore(entry.profileId, entry.candidate);
      }
    }
    clearPending();
  }, [pendingId, clearPending, refreshLlmScore]);

  const c = candidate;

  // 评分随 candidate 与人工修正（corrections）实时重算
  const assessment = useMemo(
    () =>
      c
        ? computeAssessment(
            c,
            (e) => corrections.get(e) ?? e.evidence_status,
            llmAssessment,
          )
        : null,
    [c, corrections, llmAssessment],
  );

  // 每个模块的装饰图提示词（暗色线稿，融入星空玻璃）
  const ART = {
    basic: sectionArt(
      "minimal luminous line-art portrait silhouette of an academic in profile, blueprint contour style, deep navy blue background, thin cyan and amber glowing outlines, no text, elegant, high contrast",
    ),
    edu: sectionArt(
      "minimal luminous line-art of a graduation cap floating above an open book and a winding timeline path, blueprint contour style, deep navy blue background, thin cyan and amber glowing outlines, no text, elegant",
    ),
    awards: sectionArt(
      "minimal luminous line-art of a trophy beside a rising bar chart with an arrow, blueprint contour style, deep navy blue background, thin cyan and amber glowing outlines, no text, elegant",
    ),
    pubs: sectionArt(
      "minimal luminous line-art of a stack of academic papers with a citation network graph of connected nodes above it, blueprint contour style, deep navy blue background, thin cyan and amber glowing outlines, no text, elegant",
    ),
    service: sectionArt(
      "minimal luminous line-art of a conference review panel table with name badges and a row of chairs, blueprint contour style, deep navy blue background, thin cyan and amber glowing outlines, no text, elegant",
    ),
    eval: sectionArt(
      "minimal luminous line-art of a radar gauge with concentric rings, polygon web and a needle, blueprint contour style, deep navy blue background, thin cyan and amber glowing outlines, no text, elegant",
    ),
  };

  if (!c) {
    return (
      <div className="relative flex min-h-screen flex-col overflow-hidden text-white">
        <Starfield />

        {loading ? (
          <main className="relative flex flex-1 flex-col justify-center px-6 py-14">
            <div
              className="animate-reveal mx-auto mb-9 max-w-3xl text-center"
              style={{ animationDelay: "0.08s" }}
            >
              <p className="text-xs font-medium uppercase tracking-[0.45em] text-accent/70">
                Analyzing
              </p>
              <h2 className="mt-5 font-display text-4xl italic leading-tight sm:text-5xl">
                Building the profile
              </h2>
              <p className="mt-3 text-sm text-white/45">{loadingMessage}</p>
            </div>
            <AnalyzingStage phase={loadingMessage} progress={analysisProgress} />
          </main>
        ) : (
        <main className="relative flex flex-1 items-center justify-center px-6 py-16">
          <div className="w-full max-w-3xl text-center">
            {/* 小标：宽字距 + 星芒 */}
            <p
              className="animate-reveal flex items-center justify-center gap-3 text-xs font-medium uppercase tracking-[0.45em] text-white/45"
              style={{ animationDelay: "0.1s" }}
            >
              <span className="animate-sparkle inline-block text-accent">✦</span>
              AIE1903 · AI-assisted faculty hiring
              <span className="animate-sparkle inline-block text-accent" style={{ animationDelay: "1.2s" }}>
                ✦
              </span>
            </p>

            {/* 主标题：衬线斜体 */}
            <h2
              className="animate-reveal mt-9 font-display text-5xl leading-[1.06] tracking-tight sm:text-6xl lg:text-[5.2rem]"
              style={{ animationDelay: "0.24s" }}
            >
              Every claim,
              <br />
              <span className="italic text-accent">traced to its evidence.</span>
            </h2>

            <p
              className="animate-reveal mx-auto mt-8 max-w-xl text-base leading-relaxed text-white/45"
              style={{ animationDelay: "0.4s" }}
            >
              Upload a CV, cover letter, research statement and teaching statement.
              Get a structured candidate profile where every field links back to its source.
            </p>

            <div
              className="animate-reveal mt-11 flex flex-wrap items-center justify-center gap-4"
              style={{ animationDelay: "0.56s" }}
            >
              <label className="animate-halo group relative cursor-pointer overflow-hidden rounded-full bg-white px-9 py-3.5 text-sm font-medium text-black transition hover:bg-white/90">
                <span className="relative z-10">Choose files</span>
                <input
                  aria-label="Choose files"
                  type="file"
                  multiple
                  accept=".pdf,.docx"
                  className="absolute inset-0 cursor-pointer opacity-0"
                  onChange={(ev) => {
                    const files = Array.from(ev.target.files ?? []);
                    ev.target.value = "";
                    if (files.length > 0) void handleFiles(files);
                  }}
                />
              </label>
              <button
                onClick={() => {
                  setAnalysisWarnings([]);
                  setCandidate(mockProfile.candidate);
                  setLlmAssessment(null);
                  saveArchive("demo", mockProfile.candidate, null);
                  void refreshLlmScore("demo", mockProfile.candidate);
                  setOverviewOpen(true);
                }}
                disabled={loading}
                className="animate-sweep relative overflow-hidden rounded-full border border-white/20 px-9 py-3.5 text-sm text-white/70 transition hover:border-white/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span className="relative z-10">Load example data</span>
              </button>
            </div>

            {/* 数字步骤：宽字距 */}
            <p
              className="animate-reveal mt-16 text-xs uppercase tracking-[0.5em] text-white/30"
              style={{ animationDelay: "0.72s" }}
            >
              01 Upload&ensp;·&ensp;02 Analyze&ensp;·&ensp;03 Review
            </p>

            {error && (
              <p className="animate-reveal mt-6 text-sm text-rose-400">{error}</p>
            )}
          </div>
        </main>
        )}
      </div>
    );
  }

  // 可筛选标签（研究方向 + 技能 + 机构 + 论文等级）
  const tags = Array.from(
    new Set(
      nonEmpty([
        ...c.basic_info.research_interests,
        ...c.basic_info.skills,
        c.basic_info.institution,
        ...c.publications_impact.publications.map((p) => p.ranking),
      ]),
    ),
  );

  const basicKw = nonEmpty([
    c.basic_info.name,
    c.basic_info.institution,
    c.basic_info.position,
    c.basic_info.highest_degree,
    ...c.basic_info.research_interests,
    ...c.basic_info.skills,
    ...c.basic_info.strengths,
  ]);
  const eduKw = nonEmpty([
    ...c.education_employment.education.flatMap((e) => [
      e.degree,
      e.field,
      e.institution,
      e.advisor,
    ]),
    ...c.education_employment.employment.flatMap((e) => [e.position, e.institution]),
  ]);
  const awardsKw = nonEmpty([
    ...c.awards_funding.awards.flatMap((a) => [a.name, a.awarding_body]),
    ...c.awards_funding.funding.flatMap((f) => [f.project_name, f.funder, f.role]),
  ]);
  const pubKw = nonEmpty(
    c.publications_impact.publications.flatMap((p) => [
      p.title,
      p.venue,
      p.venue_type,
      p.ranking,
      p.author_role,
    ]),
  );
  const svcKw = nonEmpty(
    c.academic_service.services.flatMap((s) => [
      s.organization_or_venue,
      s.role,
      s.service_type,
      ...s.research_areas,
    ]),
  );
  const evalKw = nonEmpty([
    c.overall_evaluation.summary,
    ...c.overall_evaluation.strengths,
    ...c.overall_evaluation.risks,
    ...c.overall_evaluation.dimensions.flatMap((d) => [d.dimension, d.assessment]),
  ]);

  const terms = [...filter.tags, filter.search]
    .filter(Boolean)
    .map((t) => t.toLowerCase());
  const matches = (kw: string[]) =>
    terms.length === 0 ||
    kw.some((k) => terms.some((t) => k.toLowerCase().includes(t)));

  const evidenceCount =
    c.basic_info.evidence.length +
    c.education_employment.education.reduce((s, e) => s + e.evidence.length, 0) +
    c.education_employment.employment.reduce((s, e) => s + e.evidence.length, 0) +
    c.awards_funding.awards.reduce((s, a) => s + a.evidence.length, 0) +
    c.awards_funding.funding.reduce((s, f) => s + f.evidence.length, 0) +
    c.publications_impact.publications.reduce((s, p) => s + p.evidence.length, 0) +
    c.academic_service.services.reduce((s, sv) => s + sv.evidence.length, 0);

  const kpis = [
    { label: "Publications", value: c.publications_impact.publications.length },
    { label: "Total citations", value: c.publications_impact.total_citations ?? 0 },
    { label: "Evidence items", value: evidenceCount },
    { label: "Evaluation dimensions", value: c.overall_evaluation.dimensions.length },
  ];

  return (
    <div className="relative min-h-screen text-white/90">
      <Starfield />
      <main className="mx-auto max-w-6xl space-y-5 px-8 py-10">
        <div
          className="animate-pop flex items-center justify-between gap-4"
          style={{ animationDelay: "0.05s" }}
        >
          <BackButton onClick={resetToHome} />
          <OverviewButton
            onClick={() => setOverviewOpen(true)}
            score={assessment?.overall ?? null}
          />
        </div>
        {analysisWarnings.length > 0 && (
          <div
            className="animate-fade-in-up rounded-lg border border-amber-400/30 bg-amber-400/[0.08] p-4 text-sm"
            role="status"
          >
            <p className="font-semibold text-amber-200">
              Analysis completed with warnings
            </p>
            <ul className="mt-2 space-y-1 text-amber-100/75">
              {analysisWarnings.map((item, index) => (
                <li key={`${item.code}-${index}`}>
                  {item.source ? `${item.source}: ` : ""}
                  {item.message}
                  {item.retryable ? " You can retry the analysis." : ""}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="animate-pop" style={{ animationDelay: "0.05s" }}>
          <TagFilter tags={tags} filter={filter} onChange={setFilter} />
        </div>

        {/* KPI 概览条 */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {kpis.map((k) => (
            <div
              key={k.label}
              className="glass rounded-2xl transition-colors duration-300 hover:bg-white/[0.09]"
            >
              <div className="animate-pop px-5 py-4">
                <p className="text-3xl font-semibold tracking-tight text-white">
                  <CountUp value={k.value} />
                </p>
                <p className="mt-1 text-sm text-white/45">{k.label}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Bento 网格 */}
        <div className="grid items-start gap-4 lg:grid-cols-12">
        {/* 1. 基本信息 */}
        <Section title="Basic Information" art={ART.basic} hidden={!matches(basicKw)} delay={0.1} className="lg:col-span-5">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h3 className="text-2xl font-semibold tracking-tight">{n(c.basic_info.name)}</h3>
            <span className="text-white/50">{n(c.basic_info.position)}</span>
          </div>
          <p className="mt-1 text-sm text-white/50">
            {n(c.basic_info.institution)}
            {c.basic_info.highest_degree ? ` · ${c.basic_info.highest_degree}` : ""}
          </p>

          <TagRow label="Research interests" items={c.basic_info.research_interests} />
          <TagRow label="Skills" items={c.basic_info.skills} />
          <BulletList label="Strengths" items={c.basic_info.strengths} />

          {c.basic_info.to_verify.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-medium text-white/40">Items to verify</p>
              <ul className="mt-2 space-y-4">
                {c.basic_info.to_verify.map((v, i) => (
                  <li
                    key={i}
                    className="border-t border-white/[0.09] pt-4 first:border-t-0 first:pt-0"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-white/85">{v.claim}</span>
                      {v.evidence.map((e, j) => (
                        <EvidenceBadge key={j} status={e.evidence_status} />
                      ))}
                    </div>
                    <p className="mt-1 text-white/50">{v.reason}</p>
                    <EvidenceList
                      items={v.evidence}
                      onEvidenceClick={setSelectedEvidence}
                      getStatus={getStatus}
                    />
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-4">
            <p className="text-xs font-medium text-white/40">Evidence sources</p>
            <EvidenceList
              items={c.basic_info.evidence}
              onEvidenceClick={setSelectedEvidence}
              getStatus={getStatus}
            />
          </div>
        </Section>

        {/* 2. 教育与工作 */}
        <Section title="Education & Work" art={ART.edu} hidden={!matches(eduKw)} delay={0.15} className="lg:col-span-7">
          <h4 className="text-sm font-semibold text-white/70">Education</h4>
          {c.education_employment.education.length === 0 ? (
            <p className="mt-2 text-sm text-white/40">None</p>
          ) : (
            <div className="mt-2">
              {c.education_employment.education.map((ed, i) => (
                <div key={i} className="mt-4 border-t border-white/[0.09] pt-4 first:mt-0 first:border-t-0 first:pt-0">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-semibold">{n(ed.degree)}</span>
                    <span className="text-white/70">{n(ed.field)}</span>
                  </div>
                  <p className="mt-1 text-sm text-white/50">
                    {n(ed.institution)} · Advisor: {n(ed.advisor)}
                  </p>
                  <p className="text-sm text-white/50">
                    {dateRange(ed.start_date, ed.end_date)}
                  </p>
                  {ed.projects.length > 0 && (
                    <p className="mt-1 text-sm text-white/70">
                      Projects: {ed.projects.join(", ")}
                    </p>
                  )}
                  {ed.outcomes.length > 0 && (
                    <p className="mt-1 text-sm text-white/70">
                      Outcomes: {ed.outcomes.join(", ")}
                    </p>
                  )}
                  <EvidenceList items={ed.evidence} onEvidenceClick={setSelectedEvidence} getStatus={getStatus} />
                </div>
              ))}
            </div>
          )}

          <h4 className="mt-6 text-sm font-semibold text-white/70">Work experience</h4>
          {c.education_employment.employment.length === 0 ? (
            <p className="mt-2 text-sm text-white/40">None</p>
          ) : (
            <div className="mt-2">
              {c.education_employment.employment.map((em, i) => (
                <div key={i} className="mt-4 border-t border-white/[0.09] pt-4 first:mt-0 first:border-t-0 first:pt-0">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-semibold">{n(em.position)}</span>
                    <span className="text-white/70">{n(em.institution)}</span>
                  </div>
                  <p className="mt-1 text-sm text-white/50">
                    {dateRange(em.start_date, em.end_date)}
                  </p>
                  {em.responsibilities.length > 0 && (
                    <p className="mt-1 text-sm text-white/70">
                      Responsibilities: {em.responsibilities.join(", ")}
                    </p>
                  )}
                  {em.projects.length > 0 && (
                    <p className="mt-1 text-sm text-white/70">
                      Projects: {em.projects.join(", ")}
                    </p>
                  )}
                  {em.outcomes.length > 0 && (
                    <p className="mt-1 text-sm text-white/70">
                      Outcomes: {em.outcomes.join(", ")}
                    </p>
                  )}
                  <EvidenceList items={em.evidence} onEvidenceClick={setSelectedEvidence} getStatus={getStatus} />
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* 3. 奖项与经费 */}
        <Section title="Awards & Funding" art={ART.awards} hidden={!matches(awardsKw)} delay={0.2} className="lg:col-span-5">
          <h4 className="text-sm font-semibold text-white/70">Awards</h4>
          {c.awards_funding.awards.length === 0 ? (
            <p className="mt-2 text-sm text-white/40">None</p>
          ) : (
            <div className="mt-2">
              {c.awards_funding.awards.map((a, i) => (
                <div key={i} className="mt-4 border-t border-white/[0.09] pt-4 first:mt-0 first:border-t-0 first:pt-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{a.name}</span>
                    {a.year != null && (
                      <span className="text-sm text-white/50">{a.year}</span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-white/50">
                    Awarding body: {n(a.awarding_body)}
                  </p>
                  <EvidenceList items={a.evidence} onEvidenceClick={setSelectedEvidence} getStatus={getStatus} />
                </div>
              ))}
            </div>
          )}

          <h4 className="mt-6 text-sm font-semibold text-white/70">Funding</h4>
          {c.awards_funding.funding.length === 0 ? (
            <p className="mt-2 text-sm text-white/40">None</p>
          ) : (
            <div className="mt-2">
              {c.awards_funding.funding.map((f, i) => (
                <div key={i} className="mt-4 border-t border-white/[0.09] pt-4 first:mt-0 first:border-t-0 first:pt-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{f.project_name}</span>
                    <span className="rounded bg-white/10 px-1.5 py-0.5 text-xs text-white/70">
                      {fundingRoleLabel[f.role]}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-white/50">
                    Funder: {n(f.funder)} · {dateRange(f.start_date, f.end_date)}
                  </p>
                  {f.amount != null && (
                    <p className="text-sm text-white/50">
                      Amount: {f.amount.toLocaleString()} {f.currency ?? ""}
                    </p>
                  )}
                  <EvidenceList items={f.evidence} onEvidenceClick={setSelectedEvidence} getStatus={getStatus} />
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* 4. 论文与影响 */}
        <Section title="Publications & Impact" art={ART.pubs} hidden={!matches(pubKw)} delay={0.25} className="lg:col-span-7">
          <p className="text-sm text-white/70">
            Total citations: {c.publications_impact.total_citations ?? "—"}
            {c.publications_impact.citation_query_date
              ? ` (queried: ${c.publications_impact.citation_query_date})`
              : ""}
          </p>

          {c.publications_impact.publications.length === 0 ? (
            <p className="mt-2 text-sm text-white/40">None</p>
          ) : (
            <div className="mt-3">
              {c.publications_impact.publications.map((p, i) => (
                <div key={i} className="mt-4 border-t border-white/[0.09] pt-4 first:mt-0 first:border-t-0 first:pt-0">
                  <p className="font-semibold">{p.title}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-white/50">
                    {p.year != null && <span>{p.year}</span>}
                    <span>{authorRoleLabel[p.author_role]}</span>
                    <span>{n(p.venue)}</span>
                    <span className="rounded bg-white/10 px-1.5 py-0.5 text-xs text-white/70">
                      {venueTypeLabel[p.venue_type]}
                    </span>
                    {p.ranking && (
                      <span className="rounded bg-white/10 px-1.5 py-0.5 text-xs text-white/70">
                        {p.ranking}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-white/50">
                    {p.citation_count != null && <span>Citations: {p.citation_count}</span>}
                    {p.code_repository && (
                      <a
                        href={p.code_repository}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-teal-300 hover:underline"
                      >
                        Code repository ↗
                      </a>
                    )}
                    {p.repository_stars != null && <span>Stars：{p.repository_stars}</span>}
                  </div>
                  <EvidenceList items={p.evidence} onEvidenceClick={setSelectedEvidence} getStatus={getStatus} />
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* 5. 学术服务 */}
        <Section title="Academic Service" art={ART.service} hidden={!matches(svcKw)} delay={0.3} className="lg:col-span-5">
          {c.academic_service.services.length === 0 ? (
            <p className="text-sm text-white/40">None</p>
          ) : (
            <div>
              {c.academic_service.services.map((s, i) => (
                <div key={i} className="mt-4 border-t border-white/[0.09] pt-4 first:mt-0 first:border-t-0 first:pt-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{s.organization_or_venue}</span>
                    <span className="rounded bg-white/10 px-1.5 py-0.5 text-xs text-white/70">
                      {serviceTypeLabel[s.service_type]}
                    </span>
                    {s.role && <span className="text-sm text-white/50">{s.role}</span>}
                  </div>
                  <p className="mt-1 text-sm text-white/50">
                    {s.start_year ?? "?"} ~ {s.end_year ?? "Present"}
                  </p>
                  {s.research_areas.length > 0 && (
                    <p className="mt-1 text-sm text-white/70">
                      Areas: {s.research_areas.join(", ")}
                    </p>
                  )}
                  <EvidenceList items={s.evidence} onEvidenceClick={setSelectedEvidence} getStatus={getStatus} />
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* 6. 综合评价 */}
        <Section title="Overall Evaluation" art={ART.eval} hidden={!matches(evalKw)} delay={0.35} className="lg:col-span-7">
          <p className="text-sm text-white/70">{n(c.overall_evaluation.summary)}</p>
          <BulletList label="Strengths" items={c.overall_evaluation.strengths} />
          <BulletList label="Risks" items={c.overall_evaluation.risks} tone="warn" />

          {c.overall_evaluation.dimensions.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-medium text-white/40">Dimension evaluations</p>
              <div className="mt-2">
                {c.overall_evaluation.dimensions.map((d, i) => (
                  <div key={i} className="mt-4 border-t border-white/[0.09] pt-4 first:mt-0 first:border-t-0 first:pt-0">
                    <p className="font-semibold">{d.dimension}</p>
                    <p className="mt-1 text-sm text-white/70">{d.assessment}</p>
                    <EvidenceList items={d.evidence} onEvidenceClick={setSelectedEvidence} getStatus={getStatus} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </Section>
        </div>

        {/* 7. 基于证据的问答（加分项，需真实后端） */}
        {profileId && (
          <Section title="Evidence-based Q&A" delay={0.4} className="lg:col-span-12">
            <div className="flex gap-2">
              <input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Ask a question, such as: What is the candidate's total citation count?"
                className="flex-1 rounded-lg border border-white/10 bg-white/[0.05] px-3 py-1.5 text-sm text-white/90 outline-none placeholder:text-white/40 focus:border-teal-400/50"
              />
              <button
                onClick={handleAsk}
                disabled={qaLoading || !question.trim()}
                className="rounded-lg bg-gradient-to-r from-teal-400 to-cyan-400 px-4 py-1.5 text-sm text-white transition-opacity disabled:opacity-50"
              >
                {qaLoading ? "Thinking..." : "Ask"}
              </button>
            </div>
            {qaResult && (
              <div className="mt-3 border-l-2 border-accent/40 pl-4 text-base leading-relaxed text-white/80">
                <div className="flex items-center gap-2">
                  <span className="font-medium">Answer</span>
                  <span className="rounded bg-white/10 px-1.5 py-0.5 text-xs text-white/70">
                    Confidence: {qaResult.confidence}
                  </span>
                </div>
                <p className="mt-2 text-sm text-white/70">{qaResult.answer}</p>
                <p className="mt-3 text-xs font-medium text-white/40">Supporting evidence</p>
                <EvidenceList
                  items={qaResult.evidence}
                  onEvidenceClick={setSelectedEvidence}
                  getStatus={getStatus}
                />
              </div>
            )}
            {qaError && <p className="mt-2 text-sm text-rose-300">{qaError}</p>}
          </Section>
        )}
      </main>

      {overviewOpen && c && assessment && (
        <PlanetOverview
          candidate={c}
          assessment={assessment}
          onClose={() => setOverviewOpen(false)}
          onEvidenceClick={setSelectedEvidence}
          getStatus={getStatus}
          scoreLoading={scoreLoading}
        />
      )}

      <EvidenceModal
        evidence={selectedEvidence}
        onClose={() => setSelectedEvidence(null)}
        onCorrect={correctEvidence}
        getStatus={getStatus}
      />
    </div>
  );
}
