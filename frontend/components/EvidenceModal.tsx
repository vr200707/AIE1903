"use client";

import type { Evidence, EvidenceStatus } from "@/lib/types";
import { EvidenceBadge } from "./EvidenceBadge";
import { evidenceStatusLabel } from "@/lib/labels";

// 证据详情弹窗：展示完整证据 + 支持人工修正证据状态
export function EvidenceModal({
  evidence,
  onClose,
  onCorrect,
  getStatus,
}: {
  evidence: Evidence | null;
  onClose: () => void;
  onCorrect?: (e: Evidence, status: EvidenceStatus) => void;
  getStatus?: (e: Evidence) => EvidenceStatus;
}) {
  if (!evidence) return null;
  const e = evidence;
  const status = getStatus ? getStatus(e) : e.evidence_status;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[80vh] w-full max-w-lg overflow-auto rounded-2xl border border-white/10 bg-[#0d0d1a]/90 p-6 shadow-2xl backdrop-blur-xl"
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <h3 className="text-lg font-semibold text-white/90">证据详情</h3>
          <button
            onClick={onClose}
            className="text-xl leading-none text-white/50 transition-colors hover:text-white/90"
            aria-label="关闭"
          >
            ×
          </button>
        </div>

        <div className="mt-4 space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-white/85">{e.source}</span>
            <EvidenceBadge status={status} />
          </div>

          <p className="text-white/60">{e.evidence}</p>

          <dl className="space-y-1 text-xs text-white/40">
            <div className="flex gap-2">
              <dt className="w-20 shrink-0">查询日期</dt>
              <dd>{e.query_date}</dd>
            </div>
            {e.page != null && (
              <div className="flex gap-2">
                <dt className="w-20 shrink-0">页码</dt>
                <dd>第 {e.page} 页</dd>
              </div>
            )}
            {e.source_type && (
              <div className="flex gap-2">
                <dt className="w-20 shrink-0">来源类型</dt>
                <dd>{e.source_type}</dd>
              </div>
            )}
            {e.notes && (
              <div className="flex gap-2">
                <dt className="w-20 shrink-0">备注</dt>
                <dd>{e.notes}</dd>
              </div>
            )}
          </dl>

          {e.source_url && (
            <a
              href={e.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block rounded-lg bg-gradient-to-r from-teal-400 to-cyan-400 px-3 py-1.5 text-white transition-opacity hover:opacity-90"
            >
              查看原文 ↗
            </a>
          )}

          {onCorrect && (
            <div className="border-t border-white/10 pt-3">
              <p className="text-xs font-medium text-white/40">
                人工修正证据状态
              </p>
              <select
                value={status}
                onChange={(ev) => onCorrect(e, ev.target.value as EvidenceStatus)}
                className="mt-1.5 w-full rounded-lg border border-white/10 bg-white/[0.05] px-2 py-1.5 text-sm text-white/90 outline-none focus:border-teal-400/50"
              >
                {(Object.keys(evidenceStatusLabel) as EvidenceStatus[]).map(
                  (val) => (
                    <option key={val} value={val} className="bg-[#0d0d1a]">
                      {evidenceStatusLabel[val]}
                    </option>
                  ),
                )}
              </select>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
