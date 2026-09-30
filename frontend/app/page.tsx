"use client";

import { useState } from "react";
import Link from "next/link";
import { mockProfile } from "@/lib/mock";
import { uploadFiles, analyze, askQuestion } from "@/lib/api";
import { Section } from "@/components/Section";
import { EvidenceList } from "@/components/EvidenceList";
import { EvidenceBadge } from "@/components/EvidenceBadge";
import { EvidenceModal } from "@/components/EvidenceModal";
import { TagFilter, type FilterState } from "@/components/TagFilter";
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

function Header() {
  return (
    <header className="sticky top-0 z-10 border-b border-white/10 bg-[#06060f]/70 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <h1 className="flex items-center gap-2.5 text-lg font-semibold text-white">
          <span className="animate-float grid h-8 w-8 place-items-center rounded-full bg-yellow-300 text-lg shadow-lg shadow-yellow-400/40">
            ⚡
          </span>
          Candidate Profile Analysis
          <span className="rounded-full bg-teal-400/20 px-2.5 py-0.5 text-xs font-semibold text-teal-300">
            v2.0
          </span>
        </h1>
        <nav className="flex gap-4 text-sm">
          <Link href="/" className="font-medium text-white/90">
            Profile
          </Link>
          <Link
            href="/methodology"
            className="text-white/50 transition-colors hover:text-white/90"
          >
            Methodology
          </Link>
        </nav>
      </div>
    </header>
  );
}

export default function Home() {
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  const getStatus = (e: Evidence): EvidenceStatus =>
    corrections.get(e) ?? e.evidence_status;

  const correctEvidence = (target: Evidence, status: EvidenceStatus) => {
    setCorrections((prev) => {
      const next = new Map(prev);
      next.set(target, status);
      return next;
    });
  };

  const handleFiles = async (files: File[]) => {
    setLoading(true);
    setError(null);
    try {
      const { upload_id } = await uploadFiles(files);
      const { profile_id, candidate } = await analyze(upload_id);
      setProfileId(profile_id);
      setCandidate(candidate);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed. Please try again.");
    } finally {
      setLoading(false);
    }
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
    setQaResult(null);
    setQaError(null);
    setQuestion("");
  };

  const c = candidate;

  if (!c) {
    return (
      <div className="relative flex min-h-screen flex-col overflow-hidden bg-black text-white">
        {/* 黑白教师照片背景 */}
        <img
          src="https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=black%20and%20white%20photo%20of%20a%20university%20professor%20teaching%20in%20a%20lecture%20hall%2C%20dramatic%20lighting%2C%20monochrome&image_size=landscape_16_9"
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-50"
        />
        {/* 暗色遮罩：左侧渐暗，保证文字可读 */}
        <div className="absolute inset-0 bg-gradient-to-r from-black via-black/70 to-black/20" />

        <Header />

        <main className="relative flex flex-1 flex-col justify-center px-8 py-12 sm:px-12 lg:px-20">
          <div className="animate-fade-in-up max-w-3xl text-left">
            {/* 小标：宽字距 */}
            <p className="text-xs font-medium uppercase tracking-[0.45em] text-white/50">
              AIE1903 · AI-assisted faculty hiring workflow
            </p>

            {/* 超大标题 */}
            <h2 className="mt-8 text-5xl font-bold leading-[1.05] tracking-tight sm:text-6xl lg:text-8xl">
              Candidate Profile Analysis
              <br />
              <span className="text-teal-400">Upload</span>
              and review
            </h2>

            <p className="mt-8 max-w-xl text-base text-white/50 sm:text-lg">
              Upload CV, cover letter, research statement, and teaching statement to generate a structured, evidence-grounded candidate profile.
            </p>

            <div className="mt-12 flex flex-wrap items-center gap-5">
              <label className="animate-float cursor-pointer rounded-full bg-white px-9 py-3.5 text-sm font-medium text-black shadow-lg shadow-black/40 transition hover:bg-white/85">
                Choose files
                <input
                  type="file"
                  multiple
                  accept=".pdf,.docx"
                  className="hidden"
                  onChange={(ev) => {
                    const files = Array.from(ev.target.files ?? []);
                    if (files.length > 0) handleFiles(files);
                  }}
                />
              </label>
              <button
                onClick={() => setCandidate(mockProfile.candidate)}
                className="animate-float rounded-full border border-white/20 px-9 py-3.5 text-sm text-white/70 transition hover:bg-white/10"
                style={{ animationDelay: "0.3s" }}
              >
                Load example data
              </button>
            </div>

            {/* 数字步骤：宽字距 */}
            <p className="mt-16 text-xs uppercase tracking-[0.5em] text-white/30">
              01 Upload&ensp;·&ensp;02 Analyze&ensp;·&ensp;03 Profile
            </p>

            {loading && (
              <p className="mt-6 text-sm text-white/50">Analyzing, please wait...</p>
            )}
            {error && <p className="mt-6 text-sm text-rose-400">{error}</p>}
          </div>
        </main>
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

  return (
    <div className="min-h-screen text-white/90">
      <Header />

      <main className="mx-auto max-w-7xl space-y-6 px-6 py-8">
        <div className="animate-fade-in-up flex items-center justify-between">
          <button
            onClick={resetToHome}
            className="group inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.05] px-4 py-2 text-sm text-white/70 backdrop-blur transition hover:bg-white/10 hover:text-white"
          >
            <span className="transition-transform group-hover:-translate-x-0.5">←</span>
            Back to home
          </button>
        </div>
        <div className="animate-fade-in-up" style={{ animationDelay: "0.05s" }}>
          <TagFilter tags={tags} filter={filter} onChange={setFilter} />
        </div>

        <div className="space-y-6">
        {/* 1. 基本信息 */}
        <Section title="Basic Information" hidden={!matches(basicKw)} delay={0.1}>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h3 className="text-xl font-bold">{n(c.basic_info.name)}</h3>
            <span className="text-white/50">{n(c.basic_info.position)}</span>
          </div>
          <p className="mt-1 text-sm text-white/50">
            {n(c.basic_info.institution)}
            {c.basic_info.highest_degree ? ` · ${c.basic_info.highest_degree}` : ""}
          </p>

          <TagRow label="Research interests" items={c.basic_info.research_interests} />
          <TagRow label="Skills" items={c.basic_info.skills} />
          <TagRow label="Strengths" items={c.basic_info.strengths} />

          {c.basic_info.to_verify.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-medium text-white/40">Items to verify</p>
              <ul className="mt-2 space-y-2">
                {c.basic_info.to_verify.map((v, i) => (
                  <li
                    key={i}
                    className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm"
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
        <Section title="Education & Work" hidden={!matches(eduKw)} delay={0.15}>
          <h4 className="text-sm font-semibold text-white/70">Education</h4>
          {c.education_employment.education.length === 0 ? (
            <p className="mt-2 text-sm text-white/40">None</p>
          ) : (
            <div className="mt-2 space-y-3">
              {c.education_employment.education.map((ed, i) => (
                <div key={i} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
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
            <div className="mt-2 space-y-3">
              {c.education_employment.employment.map((em, i) => (
                <div key={i} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
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
        <Section title="Awards & Funding" hidden={!matches(awardsKw)} delay={0.2}>
          <h4 className="text-sm font-semibold text-white/70">Awards</h4>
          {c.awards_funding.awards.length === 0 ? (
            <p className="mt-2 text-sm text-white/40">None</p>
          ) : (
            <div className="mt-2 space-y-3">
              {c.awards_funding.awards.map((a, i) => (
                <div key={i} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
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
            <div className="mt-2 space-y-3">
              {c.awards_funding.funding.map((f, i) => (
                <div key={i} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
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
        <Section title="Publications & Impact" hidden={!matches(pubKw)} delay={0.25}>
          <p className="text-sm text-white/70">
            Total citations: {c.publications_impact.total_citations ?? "—"}
            {c.publications_impact.citation_query_date
              ? ` (queried: ${c.publications_impact.citation_query_date})`
              : ""}
          </p>

          {c.publications_impact.publications.length === 0 ? (
            <p className="mt-2 text-sm text-white/40">None</p>
          ) : (
            <div className="mt-3 space-y-3">
              {c.publications_impact.publications.map((p, i) => (
                <div key={i} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
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
        <Section title="Academic Service" hidden={!matches(svcKw)} delay={0.3}>
          {c.academic_service.services.length === 0 ? (
            <p className="text-sm text-white/40">None</p>
          ) : (
            <div className="space-y-3">
              {c.academic_service.services.map((s, i) => (
                <div key={i} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
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
        <Section title="Overall Evaluation" hidden={!matches(evalKw)} delay={0.35}>
          <p className="text-sm text-white/70">{n(c.overall_evaluation.summary)}</p>
          <TagRow label="Strengths" items={c.overall_evaluation.strengths} />
          <TagRow label="Risks" items={c.overall_evaluation.risks} />

          {c.overall_evaluation.dimensions.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-medium text-white/40">Dimension evaluations</p>
              <div className="mt-2 space-y-3">
                {c.overall_evaluation.dimensions.map((d, i) => (
                  <div key={i} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
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
          <Section title="Evidence-based Q&A" delay={0.4}>
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
              <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
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

      <EvidenceModal
        evidence={selectedEvidence}
        onClose={() => setSelectedEvidence(null)}
        onCorrect={correctEvidence}
        getStatus={getStatus}
      />
    </div>
  );
}
