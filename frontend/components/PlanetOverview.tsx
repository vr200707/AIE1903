"use client";

import { useEffect, useState } from "react";
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

type GetStatus = (e: Evidence) => EvidenceStatus;

const PLANET_LAYOUT: Record<ModuleKey, { x: number; y: number; size: number }> = {
  basic_info: { x: 16, y: 34, size: 132 },
  education_employment: { x: 27, y: 75, size: 110 },
  awards_funding: { x: 44, y: 31, size: 154 },
  publications_impact: { x: 64, y: 71, size: 124 },
  academic_service: { x: 80, y: 39, size: 106 },
  overall_evaluation: { x: 83, y: 85, size: 118 },
};

// 行星不抠图：用径向遮罩把照片羽化成球体，边缘自然融进星空，避免硬切边。
const PLANET_MASK =
  "radial-gradient(circle at 50% 50%, #000 0%, #000 56%, rgba(0,0,0,0.45) 72%, rgba(0,0,0,0) 82%)";
const SATURN_MASK =
  "radial-gradient(ellipse 50% 46% at 50% 50%, #000 0%, #000 58%, rgba(0,0,0,0.45) 78%, rgba(0,0,0,0) 92%)";

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
      <p className="text-xs text-white/40">{label}</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {items.map((x, i) => (
          <span key={i} className="rounded-full bg-white/10 px-2.5 py-1 text-xs text-white/75">
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
      <p className="text-xs text-white/40">{label}</p>
      <ul className="mt-1.5 space-y-1">
        {items.map((x, i) => (
          <li key={i} className="flex gap-2 text-sm text-white/70">
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
          <p className="mt-1 text-sm text-white/60">
            {n(c.basic_info.position)}
            {c.basic_info.institution ? ` · ${c.basic_info.institution}` : ""}
            {c.basic_info.highest_degree ? ` · ${c.basic_info.highest_degree}` : ""}
          </p>
          <TagChips label="研究方向 Research interests" items={c.basic_info.research_interests} />
          <TagChips label="技能 Skills" items={c.basic_info.skills} />
          <SimpleList label="优势 Strengths" items={c.basic_info.strengths} />
          {c.basic_info.to_verify.length > 0 && (
            <div className="mt-3">
              <p className="text-xs text-white/40">待核实项 Items to verify</p>
              {c.basic_info.to_verify.map((v, i) => (
                <div key={i} className="mt-2 border-t border-white/10 pt-2 first:border-t-0">
                  <p className="text-sm text-white/85">{v.claim}</p>
                  <p className="mt-0.5 text-xs text-white/55">{v.reason}</p>
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
            <div key={i} className="mt-3 border-t border-white/10 pt-3 first:mt-0 first:border-t-0 first:pt-0">
              <p className="font-semibold">
                {n(e.degree)} · {n(e.field)}
              </p>
              <p className="mt-0.5 text-xs text-white/55">
                {n(e.institution)} · 导师 Advisor: {n(e.advisor)}
              </p>
              <p className="text-xs text-white/55">{dateRange(e.start_date, e.end_date)}</p>
            </div>
          ))}
          {c.education_employment.employment.map((e, i) => (
            <div key={i} className="mt-3 border-t border-white/10 pt-3">
              <p className="font-semibold">
                {n(e.position)} · {n(e.institution)}
              </p>
              <p className="mt-0.5 text-xs text-white/55">{dateRange(e.start_date, e.end_date)}</p>
            </div>
          ))}
        </>
      );
    case "awards_funding":
      return (
        <>
          {c.awards_funding.awards.map((a, i) => (
            <div key={i} className="mt-3 border-t border-white/10 pt-3 first:mt-0 first:border-t-0 first:pt-0">
              <p className="font-semibold">{a.name}</p>
              <p className="mt-0.5 text-xs text-white/55">
                {a.year ?? "?"} · 颁发机构 Awarding body: {n(a.awarding_body)}
              </p>
            </div>
          ))}
          {c.awards_funding.funding.map((f, i) => (
            <div key={i} className="mt-3 border-t border-white/10 pt-3">
              <p className="font-semibold">{f.project_name}</p>
              <p className="mt-0.5 text-xs text-white/55">
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
          <p className="text-sm text-white/70">
            总引用 Total citations: {c.publications_impact.total_citations ?? "—"}
          </p>
          {c.publications_impact.publications.map((p, i) => (
            <div key={i} className="mt-3 border-t border-white/10 pt-3 first:mt-0 first:border-t-0 first:pt-0">
              <p className="font-semibold">{p.title}</p>
              <p className="mt-0.5 text-xs text-white/55">
                {p.year ?? "?"} · {authorRoleLabel[p.author_role]} · {n(p.venue)} ·{" "}
                {venueTypeLabel[p.venue_type]}
                {p.ranking ? ` · ${p.ranking}` : ""}
                {p.citation_count != null ? ` · 引用 ${p.citation_count}` : ""}
              </p>
            </div>
          ))}
        </>
      );
    case "academic_service":
      return (
        <>
          {c.academic_service.services.map((s, i) => (
            <div key={i} className="mt-3 border-t border-white/10 pt-3 first:mt-0 first:border-t-0 first:pt-0">
              <p className="font-semibold">{s.organization_or_venue}</p>
              <p className="mt-0.5 text-xs text-white/55">
                {serviceTypeLabel[s.service_type]}
                {s.role ? ` · ${s.role}` : ""} · {s.start_year ?? "?"} ~ {s.end_year ?? "Present"}
              </p>
              {s.research_areas.length > 0 && (
                <p className="mt-0.5 text-xs text-white/55">
                  领域 Areas: {s.research_areas.join(", ")}
                </p>
              )}
            </div>
          ))}
        </>
      );
    case "overall_evaluation":
      return (
        <>
          <p className="text-sm text-white/70">{n(c.overall_evaluation.summary)}</p>
          <SimpleList label="优势 Strengths" items={c.overall_evaluation.strengths} />
          <SimpleList label="风险 Risks" items={c.overall_evaluation.risks} />
          {c.overall_evaluation.dimensions.map((d, i) => (
            <div key={i} className="mt-3 border-t border-white/10 pt-3 first:mt-0 first:border-t-0 first:pt-0">
              <p className="font-semibold">{d.dimension}</p>
              <p className="mt-0.5 text-sm text-white/70">{d.assessment}</p>
            </div>
          ))}
        </>
      );
  }
}

export function PlanetOverview({
  candidate,
  assessment,
  onClose,
  onEvidenceClick,
  getStatus,
  scoreLoading = false,
}: {
  candidate: Candidate;
  assessment: Assessment;
  onClose: () => void;
  onEvidenceClick: (e: Evidence) => void;
  getStatus: GetStatus;
  scoreLoading?: boolean;
}) {
  const [selected, setSelected] = useState<ModuleKey | null>(null);

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
  const selectedEvidence = selected ? getModuleEvidence(candidate, selected) : [];
  const name = candidate.basic_info.name?.trim() ?? "";
  const initial = name ? name.slice(0, 1) : "?";

  return (
    <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      <div
        className="pointer-events-auto relative flex h-[min(90vh,840px)] w-[min(96vw,1180px)] flex-col overflow-hidden rounded-3xl border border-white/12 bg-[#05081a] text-white/90 shadow-[0_40px_140px_-40px_rgba(0,0,0,0.95)]"
      >
        <Starfield contained />
        <div className="relative z-10 flex h-full flex-col">
          {/* 顶部：标题 + 关闭 */}
          <div className="flex items-center justify-between px-6 pt-4 sm:px-8 sm:pt-5">
          <div className="flex items-baseline gap-3">
            <span className="font-display text-xl font-semibold">候选人画像总览</span>
            <span className="text-xs uppercase tracking-[0.18em] text-white/40">
              Candidate Overview
            </span>
          </div>
          <button
            onClick={onClose}
            className="grid h-9 w-9 place-items-center rounded-full border border-white/15 bg-white/5 text-white/70 transition hover:bg-white/10 hover:text-white"
            aria-label="关闭"
          >
            ✕
          </button>
          </div>

          {/* 顶部约 1/6：大头照 + 综合评分 */}
          <div className="flex items-center justify-center gap-6 px-6 py-3 sm:px-8 sm:py-4">
          <div className="flex items-center gap-3">
            <span className="grid h-14 w-14 place-items-center rounded-full bg-gradient-to-br from-accent-soft to-accent-deep text-2xl font-semibold text-black">
              {initial}
            </span>
            <span className="min-w-0">
              <span className="block text-base font-semibold">
                {name || "Unnamed candidate"}
              </span>
              <span className="block text-xs text-white/45">
                {candidate.basic_info.institution ?? ""}
              </span>
            </span>
          </div>
          <div className="h-10 w-px bg-white/[0.12]" />
          <div className="flex items-center gap-4">
            <ScoreRing score={assessment.overall} size={94} label="评分" variant="score" />
            {scoreLoading && assessment.overall == null && (
              <span className="animate-pulse text-[11px] text-accent-soft">
                AI 评分中…
              </span>
            )}
          </div>
          <div className="h-10 w-px bg-white/[0.12]" />
          <ScoreRing
            score={assessment.credibility}
            size={94}
            label="可信度"
            variant="credibility"
          />
          <p className="max-w-[240px] text-xs leading-relaxed text-white/45">
            评分由 DeepSeek 按经历与成果质量打分；可信度按来源可靠性与证据状态
            规则计算，修改证据标签后实时更新。
          </p>
        </div>

        {/* 星球散落区 */}
        <div className="relative flex-1">
          {assessment.modules.map((m) => {
            const p = PLANET_LAYOUT[m.key];
            return (
              <button
                key={m.key}
                type="button"
                onClick={() => setSelected(m.key)}
                className="group absolute h-0 w-0 cursor-pointer border-0 bg-transparent p-0"
                style={{ left: `${p.x}%`, top: `${p.y}%` }}
              >
                <div
                  className="absolute -translate-x-1/2 -translate-y-1/2"
                  style={{ width: p.size, height: p.size }}
                >
                  <div
                    aria-hidden
                    className="absolute inset-0 rounded-full"
                    style={{
                      background: `radial-gradient(circle at 50% 50%, ${m.glow} 0%, transparent 62%)`,
                      filter: "blur(18px)",
                      opacity: 0.85,
                    }}
                  />
                  <img
                    src={`/planets/${m.planet}.png`}
                    alt={m.title}
                    className="relative h-full w-full transition-transform duration-300 group-hover:scale-[1.04]"
                    style={{
                      objectFit: m.planet === "saturn" ? "contain" : "cover",
                      WebkitMaskImage: m.planet === "saturn" ? SATURN_MASK : PLANET_MASK,
                      WebkitMaskSize: "100% 100%",
                      WebkitMaskRepeat: "no-repeat",
                      WebkitMaskPosition: "center",
                      maskImage: m.planet === "saturn" ? SATURN_MASK : PLANET_MASK,
                      maskSize: "100% 100%",
                      maskRepeat: "no-repeat",
                      maskPosition: "center",
                    }}
                  />
                </div>
                <div
                  className="absolute w-[224px] text-center"
                  style={{ top: p.size / 2 + 12, transform: "translateX(-50%)" }}
                >
                  <div className="text-[15px] font-semibold">
                    {m.title}
                    <span className="mt-0.5 block text-[10.5px] font-medium uppercase tracking-[0.08em] text-white/40">
                      {m.titleEn}
                    </span>
                  </div>
                  <div className="mt-1 text-xs leading-relaxed text-white/50">
                    {m.pros} · {m.cons}
                  </div>
                  <div className="mt-1.5 flex items-center justify-center gap-1.5">
                    <span className="inline-flex items-center gap-1 rounded-full border border-white/[0.12] bg-white/[0.06] px-2.5 py-0.5 text-xs tabular-nums">
                      <b className="text-accent-soft">
                        {m.score != null ? m.score.toFixed(1) : "—"}
                      </b>
                      <span className="text-white/40">评分</span>
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full border border-sky-300/[0.18] bg-sky-400/[0.08] px-2.5 py-0.5 text-xs tabular-nums">
                      <b className="text-sky-300">{m.credibility.toFixed(1)}</b>
                      <span className="text-white/40">可信度</span>
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        <div className="pb-3 text-center text-[11.5px] tracking-wide text-white/40">
          点击任意 <b className="font-semibold text-accent-soft">星球</b> 查看该板块全部细节
        </div>
      </div>

      {/* 板块详情抽屉 */}
      {selectedModule && (
        <div
          className="absolute inset-0 z-20 flex justify-end bg-black/60"
          onClick={() => setSelected(null)}
        >
          <div
            className="glass my-5 mr-5 w-full max-w-[460px] overflow-auto rounded-2xl p-6"
            style={{
              background:
                "linear-gradient(165deg, rgba(24,33,70,0.97) 0%, rgba(12,17,38,0.98) 45%, rgba(5,8,20,0.99) 100%)",
            }}
            onClick={(ev) => ev.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">
                  {selectedModule.title}
                  <span className="ml-2 text-xs uppercase tracking-[0.12em] text-white/40">
                    {selectedModule.titleEn}
                  </span>
                </h2>
                <p className="mt-1 text-xs text-white/50">
                  评分点评：{selectedModule.pros} · {selectedModule.cons}
                </p>
                <p className="mt-1 text-xs text-sky-300/80">
                  可信度：{selectedModule.credPros} · {selectedModule.credCons}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <ScoreRing
                  score={selectedModule.score}
                  size={70}
                  stroke={6}
                  label="评分"
                  variant="score"
                />
                <ScoreRing
                  score={selectedModule.credibility}
                  size={70}
                  stroke={6}
                  label="可信度"
                  variant="credibility"
                />
              </div>
            </div>

            <div className="mt-4">
              <DetailBody m={selectedModule} candidate={candidate} />
            </div>

            <div className="mt-5 border-t border-white/10 pt-4">
              <p className="text-xs text-white/40">
                证据来源 Evidence（点击可查看并修正状态）
              </p>
              <EvidenceList
                items={selectedEvidence}
                onEvidenceClick={onEvidenceClick}
                getStatus={getStatus}
              />
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
