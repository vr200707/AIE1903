import Link from "next/link";
import { Section } from "@/components/Section";
import { evidenceStatusLabel } from "@/lib/labels";
import type { EvidenceStatus } from "@/lib/types";

const statusDesc: Record<EvidenceStatus, string> = {
  confirmed: "已核实并确认的事实，可直接采信。",
  not_found_public: "公开来源暂未查到，不等于为假，需标注待补充。",
  to_verify: "待人工核实的信息。",
  conflict: "多来源不一致，需人工仲裁。",
};

const statusOrder: EvidenceStatus[] = [
  "confirmed",
  "not_found_public",
  "to_verify",
  "conflict",
];

export default function MethodologyPage() {
  return (
    <div className="min-h-screen text-white/90">
      <header className="sticky top-0 z-10 border-b border-white/10 bg-[#06060f]/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <h1 className="flex items-center gap-2.5 text-lg font-semibold text-white">
            <span className="animate-float grid h-8 w-8 place-items-center rounded-full bg-yellow-300 text-lg shadow-lg shadow-yellow-400/40">
              ⚡
            </span>
            候选人档案分析
          </h1>
          <nav className="flex gap-4 text-sm">
            <Link
              href="/"
              className="text-white/50 transition-colors hover:text-white/90"
            >
              档案
            </Link>
            <Link href="/methodology" className="font-medium text-white/90">
              方法说明
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-6 py-8">
        {/* 1. 证据字段定义 */}
        <Section title="证据字段定义">
          <p className="text-sm text-white/70">
            每条结论都必须携带以下证据字段，用于溯源和核实：
          </p>
          <table className="mt-3 w-full text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 text-xs text-white/40">
                <th className="py-2 pr-4 font-medium">字段</th>
                <th className="py-2 pr-4 font-medium">含义</th>
                <th className="py-2 font-medium">是否必填</th>
              </tr>
            </thead>
            <tbody className="text-white/60">
              <tr className="border-b border-white/10">
                <td className="py-2 pr-4 font-mono text-xs">source</td>
                <td className="py-2 pr-4">来源名称（文件名 / 机构官网 / 文献库）</td>
                <td className="py-2">必填</td>
              </tr>
              <tr className="border-b border-white/10">
                <td className="py-2 pr-4 font-mono text-xs">source_url</td>
                <td className="py-2 pr-4">可一键打开的溯源链接，无则填 null</td>
                <td className="py-2">必填</td>
              </tr>
              <tr className="border-b border-white/10">
                <td className="py-2 pr-4 font-mono text-xs">evidence</td>
                <td className="py-2 pr-4">支持该结论的原文摘录或检索摘要</td>
                <td className="py-2">必填</td>
              </tr>
              <tr className="border-b border-white/10">
                <td className="py-2 pr-4 font-mono text-xs">evidence_status</td>
                <td className="py-2 pr-4">证据状态（见下表）</td>
                <td className="py-2">必填</td>
              </tr>
              <tr className="border-b border-white/10">
                <td className="py-2 pr-4 font-mono text-xs">query_date</td>
                <td className="py-2 pr-4">读取文档或查询来源的日期</td>
                <td className="py-2">必填</td>
              </tr>
              <tr>
                <td className="py-2 pr-4 font-mono text-xs">page / source_type / notes</td>
                <td className="py-2 pr-4">页码 / 来源类型 / 备注（可选）</td>
                <td className="py-2">可选</td>
              </tr>
            </tbody>
          </table>
        </Section>

        {/* 2. 证据状态规则 */}
        <Section title="证据状态判定规则">
          <ul className="space-y-2 text-sm text-white/60">
            {statusOrder.map((s) => (
              <li key={s} className="flex items-start gap-2">
                <span className="mt-0.5 shrink-0 rounded bg-white/10 px-2 py-0.5 text-xs text-white/70">
                  {evidenceStatusLabel[s]}
                </span>
                <span>{statusDesc[s]}</span>
              </li>
            ))}
          </ul>
        </Section>

        {/* 3. 缺失与冲突处理 */}
        <Section title="缺失与冲突处理规则">
          <ul className="list-inside list-disc space-y-2 text-sm text-white/60">
            <li>未知信息用 null 表示，展示为「—」，禁止推测补全。</li>
            <li>空数组（无教育经历 / 无奖项等）展示为「无」。</li>
            <li>证据状态为「冲突」时标红，需人工核实后再采信。</li>
            <li>公开来源查不到时标「未找到公开证据」，不直接判定为假。</li>
            <li>人工可随时修正证据状态（在证据详情弹窗中操作；修正仅保存在当前浏览器会话，刷新后恢复原始数据）。</li>
          </ul>
        </Section>

        {/* 4. 档案模块 */}
        <Section title="档案模块">
          <p className="text-sm text-white/70">
            档案由 6 大模块组成：
          </p>
          <ol className="mt-2 list-inside list-decimal space-y-1 text-sm text-white/60">
            <li>基本信息（姓名、机构、职位、研究方向、最高学位、技能、优势、待核实项）</li>
            <li>教育与工作（学位、导师、单位、时间线、职责、项目、成果）</li>
            <li>奖项与经费（奖项、资助项目、金额、PI/Co-PI/参与者）</li>
            <li>论文与影响（作者角色、会议/期刊、等级、引用量、代码仓库）</li>
            <li>学术服务（审稿人、编辑、程序委员会等）</li>
            <li>综合评价（各维度评价、优势、风险）</li>
          </ol>
        </Section>
      </main>
    </div>
  );
}
