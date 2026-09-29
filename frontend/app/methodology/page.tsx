import Link from "next/link";
import { Section } from "@/components/Section";
import { evidenceStatusLabel } from "@/lib/labels";
import type { EvidenceStatus } from "@/lib/types";

const statusDesc: Record<EvidenceStatus, string> = {
  confirmed: "Verified and confirmed facts that can be used directly.",
  not_found_public: "No public source found yet. This does not mean the claim is false.",
  to_verify: "Information that requires human verification.",
  conflict: "Multiple sources disagree and require human arbitration.",
};

const statusOrder: EvidenceStatus[] = [
  "confirmed",
  "not_found_public",
  "to_verify",
  "conflict",
];

export default function MethodologyPage() {
  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <h1 className="text-lg font-semibold">Candidate Profile Analysis</h1>
          <nav className="flex gap-4 text-sm">
            <Link href="/" className="text-zinc-500 hover:text-zinc-900">
              Profile
            </Link>
            <Link href="/methodology" className="font-medium text-zinc-900">
              Methodology
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-6 px-6 py-8">
        {/* 1. 证据字段定义 */}
        <Section title="Evidence Field Definitions">
          <p className="text-sm text-zinc-600">
            Every conclusion must include the following evidence fields for provenance and verification:
          </p>
          <table className="mt-3 w-full text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-xs text-zinc-400">
                <th className="py-2 pr-4 font-medium">Field</th>
                <th className="py-2 pr-4 font-medium">Meaning</th>
                <th className="py-2 font-medium">Required</th>
              </tr>
            </thead>
            <tbody className="text-zinc-600">
              <tr className="border-b border-zinc-100">
                <td className="py-2 pr-4 font-mono text-xs">source</td>
                <td className="py-2 pr-4">Source name, such as a file, institution website, or database.</td>
                <td className="py-2">Required</td>
              </tr>
              <tr className="border-b border-zinc-100">
                <td className="py-2 pr-4 font-mono text-xs">source_url</td>
                <td className="py-2 pr-4">Openable provenance URL, or null when unavailable.</td>
                <td className="py-2">Required</td>
              </tr>
              <tr className="border-b border-zinc-100">
                <td className="py-2 pr-4 font-mono text-xs">evidence</td>
                <td className="py-2 pr-4">Supporting quotation or search-result summary.</td>
                <td className="py-2">Required</td>
              </tr>
              <tr className="border-b border-zinc-100">
                <td className="py-2 pr-4 font-mono text-xs">evidence_status</td>
                <td className="py-2 pr-4">Evidence status, defined below.</td>
                <td className="py-2">Required</td>
              </tr>
              <tr className="border-b border-zinc-100">
                <td className="py-2 pr-4 font-mono text-xs">query_date</td>
                <td className="py-2 pr-4">Date on which the document or source was queried.</td>
                <td className="py-2">Required</td>
              </tr>
              <tr>
                <td className="py-2 pr-4 font-mono text-xs">page / source_type / notes</td>
                <td className="py-2 pr-4">Page number, source type, and notes.</td>
                <td className="py-2">Optional</td>
              </tr>
            </tbody>
          </table>
        </Section>

        {/* 2. 证据状态规则 */}
        <Section title="Evidence Status Rules">
          <ul className="space-y-2 text-sm text-zinc-600">
            {statusOrder.map((s) => (
              <li key={s} className="flex items-start gap-2">
                <span className="mt-0.5 shrink-0 rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700">
                  {evidenceStatusLabel[s]}
                </span>
                <span>{statusDesc[s]}</span>
              </li>
            ))}
          </ul>
        </Section>

        {/* 3. 缺失与冲突处理 */}
        <Section title="Missing and Conflicting Information">
          <ul className="list-inside list-disc space-y-2 text-sm text-zinc-600">
            <li>Unknown information is represented as null or displayed as &quot;—&quot;. Do not infer missing values.</li>
            <li>Empty arrays are displayed as &quot;None&quot;.</li>
            <li>Conflicting evidence is marked in red and must be reviewed before use.</li>
            <li>A missing public source is displayed as &quot;Not found publicly&quot;, not as proof that the claim is false.</li>
            <li>Evidence status can be corrected manually from the detail dialog. Corrections are session-only and reset after refresh.</li>
          </ul>
        </Section>

        {/* 4. 档案模块 */}
        <Section title="Profile Modules">
          <p className="text-sm text-zinc-600">
            The profile consists of six modules:
          </p>
          <ol className="mt-2 list-inside list-decimal space-y-1 text-sm text-zinc-600">
            <li>Basic Information: name, institution, position, research interests, highest degree, skills, strengths, and items to verify</li>
            <li>Education and Work: degrees, advisors, institutions, timeline, responsibilities, projects, and outcomes</li>
            <li>Awards and Funding: awards, funded projects, amounts, and PI/Co-PI/participant roles</li>
            <li>Publications and Impact: author roles, venues, rankings, citations, and code repositories</li>
            <li>Academic Service: reviewer, editor, program committee, and similar roles</li>
            <li>Overall Evaluation: dimension assessments, strengths, and risks</li>
          </ol>
        </Section>
      </main>
    </div>
  );
}
