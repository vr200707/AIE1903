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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[80vh] w-full max-w-lg overflow-auto rounded-xl bg-white p-6 shadow-xl"
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <h3 className="text-lg font-semibold">证据详情</h3>
          <button
            onClick={onClose}
            className="text-xl leading-none text-zinc-400 hover:text-zinc-600"
            aria-label="关闭"
          >
            ×
          </button>
        </div>

        <div className="mt-4 space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-zinc-700">{e.source}</span>
            <EvidenceBadge status={status} />
          </div>

          <p className="text-zinc-600">{e.evidence}</p>

          <dl className="space-y-1 text-xs text-zinc-500">
            <div className="flex gap-2">
              <dt className="w-20 shrink-0 text-zinc-400">查询日期</dt>
              <dd>{e.query_date}</dd>
            </div>
            {e.page != null && (
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 text-zinc-400">页码</dt>
                <dd>第 {e.page} 页</dd>
              </div>
            )}
            {e.source_type && (
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 text-zinc-400">来源类型</dt>
                <dd>{e.source_type}</dd>
              </div>
            )}
            {e.notes && (
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 text-zinc-400">备注</dt>
                <dd>{e.notes}</dd>
              </div>
            )}
          </dl>

          {e.source_url && (
            <a
              href={e.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block rounded bg-blue-600 px-3 py-1.5 text-white hover:bg-blue-700"
            >
              查看原文 ↗
            </a>
          )}

          {onCorrect && (
            <div className="border-t border-zinc-100 pt-3">
              <p className="text-xs font-medium text-zinc-400">
                人工修正证据状态
              </p>
              <select
                value={status}
                onChange={(ev) => onCorrect(e, ev.target.value as EvidenceStatus)}
                className="mt-1.5 w-full rounded-lg border border-zinc-200 px-2 py-1.5 text-sm outline-none focus:border-blue-400"
              >
                {(Object.keys(evidenceStatusLabel) as EvidenceStatus[]).map(
                  (val) => (
                    <option key={val} value={val}>
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
