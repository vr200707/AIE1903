import type { Evidence } from "@/lib/types";
import { EvidenceBadge } from "./EvidenceBadge";

// 证据列表：展示每条证据的来源、状态、原文摘录、查询日期与溯源链接
export function EvidenceList({ items }: { items: Evidence[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="mt-3 space-y-2">
      {items.map((e, i) => (
        <li
          key={i}
          className="rounded-lg border border-zinc-100 bg-zinc-50 p-3 text-sm"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-zinc-700">{e.source}</span>
            <EvidenceBadge status={e.evidence_status} />
            {e.page != null && (
              <span className="text-xs text-zinc-400">第 {e.page} 页</span>
            )}
          </div>
          <p className="mt-1.5 text-zinc-600">{e.evidence}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-zinc-400">
            {e.source_url && (
              <a
                href={e.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline"
              >
                查看来源 ↗
              </a>
            )}
            <span>查询日期：{e.query_date}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}
