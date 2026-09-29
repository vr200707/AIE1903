import Link from "next/link";
import { mockProfile } from "@/lib/mock";
import { Section } from "@/components/Section";
import { EvidenceList } from "@/components/EvidenceList";
import { EvidenceBadge } from "@/components/EvidenceBadge";
import {
  authorRoleLabel,
  venueTypeLabel,
  serviceTypeLabel,
  fundingRoleLabel,
} from "@/lib/labels";
import type { DateValue } from "@/lib/types";

// 空值兜底显示
function n(v: string | null | undefined): string {
  return v ?? "—";
}

// 日期区间（null 视为"至今"）
function dateRange(start: DateValue, end: DateValue): string {
  const s = start ?? "?";
  const e = end ?? "至今";
  return `${s} ~ ${e}`;
}

// 标签行（研究方向 / 技能 / 优势等）
function TagRow({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-4">
      <p className="text-xs font-medium text-zinc-400">{label}</p>
      <div className="mt-1.5 flex flex-wrap gap-2">
        {items.map((x) => (
          <span
            key={x}
            className="rounded-full bg-zinc-100 px-3 py-1 text-sm text-zinc-700"
          >
            {x}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function Home() {
  const c = mockProfile.candidate;

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <h1 className="text-lg font-semibold">候选人档案分析</h1>
          <nav className="flex gap-4 text-sm">
            <Link href="/" className="font-medium text-zinc-900">
              档案
            </Link>
            <Link
              href="/methodology"
              className="text-zinc-500 hover:text-zinc-900"
            >
              方法说明
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-6 px-6 py-8">
        {/* 1. 基本信息 */}
        <Section title="基本信息">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h3 className="text-xl font-bold">{n(c.basic_info.name)}</h3>
            <span className="text-zinc-500">{n(c.basic_info.position)}</span>
          </div>
          <p className="mt-1 text-sm text-zinc-500">
            {n(c.basic_info.institution)}
            {c.basic_info.highest_degree ? ` · ${c.basic_info.highest_degree}` : ""}
          </p>

          <TagRow label="研究方向" items={c.basic_info.research_interests} />
          <TagRow label="技能" items={c.basic_info.skills} />
          <TagRow label="优势" items={c.basic_info.strengths} />

          {c.basic_info.to_verify.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-medium text-zinc-400">待核实项</p>
              <ul className="mt-2 space-y-2">
                {c.basic_info.to_verify.map((v, i) => (
                  <li
                    key={i}
                    className="rounded-lg border border-zinc-100 bg-zinc-50 p-3 text-sm"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{v.claim}</span>
                      {v.evidence.map((e, j) => (
                        <EvidenceBadge key={j} status={e.evidence_status} />
                      ))}
                    </div>
                    <p className="mt-1 text-zinc-500">{v.reason}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-4">
            <p className="text-xs font-medium text-zinc-400">证据来源</p>
            <EvidenceList items={c.basic_info.evidence} />
          </div>
        </Section>

        {/* 2. 教育与工作 */}
        <Section title="教育与工作">
          <h4 className="text-sm font-semibold text-zinc-600">教育经历</h4>
          {c.education_employment.education.length === 0 ? (
            <p className="mt-2 text-sm text-zinc-400">无</p>
          ) : (
            <div className="mt-2 space-y-3">
              {c.education_employment.education.map((ed, i) => (
                <div key={i} className="rounded-lg border border-zinc-100 p-4">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-semibold">{n(ed.degree)}</span>
                    <span className="text-zinc-600">{n(ed.field)}</span>
                  </div>
                  <p className="mt-1 text-sm text-zinc-500">
                    {n(ed.institution)} · 导师：{n(ed.advisor)}
                  </p>
                  <p className="text-sm text-zinc-500">
                    {dateRange(ed.start_date, ed.end_date)}
                  </p>
                  {ed.projects.length > 0 && (
                    <p className="mt-1 text-sm text-zinc-600">
                      项目：{ed.projects.join("、")}
                    </p>
                  )}
                  {ed.outcomes.length > 0 && (
                    <p className="mt-1 text-sm text-zinc-600">
                      成果：{ed.outcomes.join("、")}
                    </p>
                  )}
                  <EvidenceList items={ed.evidence} />
                </div>
              ))}
            </div>
          )}

          <h4 className="mt-6 text-sm font-semibold text-zinc-600">工作经历</h4>
          {c.education_employment.employment.length === 0 ? (
            <p className="mt-2 text-sm text-zinc-400">无</p>
          ) : (
            <div className="mt-2 space-y-3">
              {c.education_employment.employment.map((em, i) => (
                <div key={i} className="rounded-lg border border-zinc-100 p-4">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-semibold">{n(em.position)}</span>
                    <span className="text-zinc-600">{n(em.institution)}</span>
                  </div>
                  <p className="mt-1 text-sm text-zinc-500">
                    {dateRange(em.start_date, em.end_date)}
                  </p>
                  {em.responsibilities.length > 0 && (
                    <p className="mt-1 text-sm text-zinc-600">
                      职责：{em.responsibilities.join("、")}
                    </p>
                  )}
                  {em.projects.length > 0 && (
                    <p className="mt-1 text-sm text-zinc-600">
                      项目：{em.projects.join("、")}
                    </p>
                  )}
                  {em.outcomes.length > 0 && (
                    <p className="mt-1 text-sm text-zinc-600">
                      成果：{em.outcomes.join("、")}
                    </p>
                  )}
                  <EvidenceList items={em.evidence} />
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* 3. 奖项与经费 */}
        <Section title="奖项与经费">
          <h4 className="text-sm font-semibold text-zinc-600">奖项</h4>
          {c.awards_funding.awards.length === 0 ? (
            <p className="mt-2 text-sm text-zinc-400">无</p>
          ) : (
            <div className="mt-2 space-y-3">
              {c.awards_funding.awards.map((a, i) => (
                <div key={i} className="rounded-lg border border-zinc-100 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{a.name}</span>
                    {a.year != null && (
                      <span className="text-sm text-zinc-500">{a.year}</span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-zinc-500">
                    颁发机构：{n(a.awarding_body)}
                  </p>
                  <EvidenceList items={a.evidence} />
                </div>
              ))}
            </div>
          )}

          <h4 className="mt-6 text-sm font-semibold text-zinc-600">经费</h4>
          {c.awards_funding.funding.length === 0 ? (
            <p className="mt-2 text-sm text-zinc-400">无</p>
          ) : (
            <div className="mt-2 space-y-3">
              {c.awards_funding.funding.map((f, i) => (
                <div key={i} className="rounded-lg border border-zinc-100 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{f.project_name}</span>
                    <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600">
                      {fundingRoleLabel[f.role]}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-zinc-500">
                    资助方：{n(f.funder)} · {dateRange(f.start_date, f.end_date)}
                  </p>
                  {f.amount != null && (
                    <p className="text-sm text-zinc-500">
                      金额：{f.amount.toLocaleString()} {f.currency ?? ""}
                    </p>
                  )}
                  <EvidenceList items={f.evidence} />
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* 4. 论文与影响 */}
        <Section title="论文与影响">
          <p className="text-sm text-zinc-600">
            总引用量：{c.publications_impact.total_citations ?? "—"}
            {c.publications_impact.citation_query_date
              ? `（查询日期：${c.publications_impact.citation_query_date}）`
              : ""}
          </p>

          {c.publications_impact.publications.length === 0 ? (
            <p className="mt-2 text-sm text-zinc-400">无</p>
          ) : (
            <div className="mt-3 space-y-3">
              {c.publications_impact.publications.map((p, i) => (
                <div key={i} className="rounded-lg border border-zinc-100 p-4">
                  <p className="font-semibold">{p.title}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-zinc-500">
                    {p.year != null && <span>{p.year}</span>}
                    <span>{authorRoleLabel[p.author_role]}</span>
                    <span>{n(p.venue)}</span>
                    <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600">
                      {venueTypeLabel[p.venue_type]}
                    </span>
                    {p.ranking && (
                      <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600">
                        {p.ranking}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-zinc-500">
                    {p.citation_count != null && (
                      <span>引用：{p.citation_count}</span>
                    )}
                    {p.code_repository && (
                      <a
                        href={p.code_repository}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline"
                      >
                        代码仓库 ↗
                      </a>
                    )}
                    {p.repository_stars != null && (
                      <span>Stars：{p.repository_stars}</span>
                    )}
                  </div>
                  <EvidenceList items={p.evidence} />
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* 5. 学术服务 */}
        <Section title="学术服务">
          {c.academic_service.services.length === 0 ? (
            <p className="text-sm text-zinc-400">无</p>
          ) : (
            <div className="space-y-3">
              {c.academic_service.services.map((s, i) => (
                <div key={i} className="rounded-lg border border-zinc-100 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{s.organization_or_venue}</span>
                    <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600">
                      {serviceTypeLabel[s.service_type]}
                    </span>
                    {s.role && (
                      <span className="text-sm text-zinc-500">{s.role}</span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-zinc-500">
                    {s.start_year ?? "?"} ~ {s.end_year ?? "至今"}
                  </p>
                  {s.research_areas.length > 0 && (
                    <p className="mt-1 text-sm text-zinc-600">
                      领域：{s.research_areas.join("、")}
                    </p>
                  )}
                  <EvidenceList items={s.evidence} />
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* 6. 综合评价 */}
        <Section title="综合评价">
          <p className="text-sm text-zinc-700">{n(c.overall_evaluation.summary)}</p>
          <TagRow label="优势" items={c.overall_evaluation.strengths} />
          <TagRow label="风险" items={c.overall_evaluation.risks} />

          {c.overall_evaluation.dimensions.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-medium text-zinc-400">各维度评价</p>
              <div className="mt-2 space-y-3">
                {c.overall_evaluation.dimensions.map((d, i) => (
                  <div key={i} className="rounded-lg border border-zinc-100 p-4">
                    <p className="font-semibold">{d.dimension}</p>
                    <p className="mt-1 text-sm text-zinc-600">{d.assessment}</p>
                    <EvidenceList items={d.evidence} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </Section>
      </main>
    </div>
  );
}
