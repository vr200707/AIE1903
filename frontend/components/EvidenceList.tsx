"use client";

import type { Evidence, EvidenceStatus } from "@/lib/types";
import { EvidenceBadge } from "./EvidenceBadge";

// 证据列表：每条可点击，点击后通过 onEvidenceClick 打开证据详情弹窗
export function EvidenceList({
  items,
  onEvidenceClick,
  getStatus,
}: {
  items: Evidence[];
  onEvidenceClick?: (e: Evidence) => void;
  getStatus?: (e: Evidence) => EvidenceStatus;
}) {
  if (items.length === 0) return null;
  return (
    <ul className="mt-3 space-y-2">
      {items.map((e, i) => (
        <li key={i}>
          <button
            type="button"
            onClick={() => onEvidenceClick?.(e)}
            className="group w-full rounded-xl border border-white/10 bg-white/[0.03] p-3 text-left text-sm transition-all duration-300 hover:border-white/25 hover:bg-white/[0.08]"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-white/85">{e.source}</span>
              <EvidenceBadge
                status={getStatus ? getStatus(e) : e.evidence_status}
              />
              {e.page != null && (
                <span className="text-xs text-white/40">Page {e.page}</span>
              )}
            </div>
            <p className="mt-1.5 text-white/60">{e.evidence}</p>
            <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-xs text-white/40">
              <span>Queried: {e.query_date}</span>
              <span className="text-teal-300 opacity-0 transition-opacity group-hover:opacity-100">
                View details ↗
              </span>
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}
