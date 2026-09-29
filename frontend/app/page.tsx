import Link from "next/link";
import { mockProfile } from "@/lib/mock";
import type { EvidenceStatus } from "@/lib/types";

// 证据状态 → 中文文案与颜色（后续 D3 会抽成组件复用）
const statusLabel: Record<EvidenceStatus, string> = {
  confirmed: "已确认",
  not_found_public: "未找到公开证据",
  to_verify: "待核实",
  conflict: "冲突",
};

const statusColor: Record<EvidenceStatus, string> = {
  confirmed: "bg-green-100 text-green-700",
  not_found_public: "bg-amber-100 text-amber-700",
  to_verify: "bg-blue-100 text-blue-700",
  conflict: "bg-red-100 text-red-700",
};

// 档案的 6 大模块（D2 逐个实现）
const MODULES = [
  { key: "basic_info", name: "基本信息", done: true },
  { key: "education_employment", name: "教育与工作", done: false },
  { key: "awards_funding", name: "奖项与经费", done: false },
  { key: "publications_impact", name: "论文与影响", done: false },
  { key: "academic_service", name: "学术服务", done: false },
  { key: "overall_evaluation", name: "综合评价", done: false },
];

export default function Home() {
  const { basic_info } = mockProfile.candidate;

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

      <main className="mx-auto max-w-4xl px-6 py-8">
        {/* 基本信息（D1 先实现，验证「类型→mock→渲染」链路） */}
        <section className="rounded-xl border border-zinc-200 bg-white p-6">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="text-2xl font-bold">{basic_info.name ?? "未提供姓名"}</h2>
            <span className="text-zinc-500">{basic_info.position ?? ""}</span>
          </div>
          <p className="mt-1 text-sm text-zinc-500">
            {basic_info.institution ?? ""}
            {basic_info.highest_degree ? ` · ${basic_info.highest_degree}` : ""}
          </p>

          {basic_info.research_interests.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-medium text-zinc-400">研究方向</p>
              <div className="mt-1 flex flex-wrap gap-2">
                {basic_info.research_interests.map((x) => (
                  <span
                    key={x}
                    className="rounded-full bg-zinc-100 px-3 py-1 text-sm"
                  >
                    {x}
                  </span>
                ))}
              </div>
            </div>
          )}

          {basic_info.skills.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-medium text-zinc-400">技能</p>
              <div className="mt-1 flex flex-wrap gap-2">
                {basic_info.skills.map((x) => (
                  <span
                    key={x}
                    className="rounded-full bg-zinc-100 px-3 py-1 text-sm"
                  >
                    {x}
                  </span>
                ))}
              </div>
            </div>
          )}

          {basic_info.to_verify.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-medium text-zinc-400">待核实项</p>
              <ul className="mt-2 space-y-2">
                {basic_info.to_verify.map((v) => (
                  <li
                    key={v.claim}
                    className="rounded-lg border border-zinc-100 bg-zinc-50 p-3 text-sm"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{v.claim}</span>
                      {v.evidence.map((e, i) => (
                        <span
                          key={i}
                          className={`rounded px-1.5 py-0.5 text-xs ${statusColor[e.evidence_status]}`}
                        >
                          {statusLabel[e.evidence_status]}
                        </span>
                      ))}
                    </div>
                    <p className="mt-1 text-zinc-500">{v.reason}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        {/* 模块清单：D1 骨架，D2 逐个实现 */}
        <section className="mt-6 rounded-xl border border-zinc-200 bg-white p-6">
          <h3 className="text-sm font-semibold text-zinc-500">档案模块</h3>
          <ul className="mt-3 divide-y divide-zinc-100">
            {MODULES.map((m) => (
              <li
                key={m.key}
                className="flex items-center justify-between py-3 text-sm"
              >
                <span>{m.name}</span>
                <span
                  className={`rounded px-2 py-0.5 text-xs ${
                    m.done
                      ? "bg-green-100 text-green-700"
                      : "bg-zinc-100 text-zinc-400"
                  }`}
                >
                  {m.done ? "已实现" : "待实现"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}
