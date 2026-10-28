"use client";

import { useState } from "react";
import type { ArchiveEntry } from "@/lib/archive";

const STARS = [
  { left: "12%", top: "30%", size: 2, delay: "0s", dur: "2.6s" },
  { left: "78%", top: "22%", size: 1.5, delay: "0.8s", dur: "3.0s" },
  { left: "24%", top: "74%", size: 1.5, delay: "1.4s", dur: "2.2s" },
  { left: "85%", top: "66%", size: 2, delay: "0.4s", dur: "3.4s" },
  { left: "55%", top: "12%", size: 1.5, delay: "1.9s", dur: "2.8s" },
];

/** 星空质感文件夹：标签页 + 主体，中间显示姓名与总分。 */
export function ArchiveFolder({
  entry,
  onClick,
  onOpenInterview,
  onDelete,
}: {
  entry: ArchiveEntry;
  onClick: () => void;
  onOpenInterview?: () => void;
  onDelete?: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const interviewScore = entry.interviewScore ?? null;

  return (
    <div className="archive-folder group relative">
      <span className="folder-tab" aria-hidden="true" />
      <div
        className="folder-body relative w-full overflow-hidden text-left"
      >
        <span
          aria-hidden="true"
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(130% 140% at 50% 0%, #eaf1f6 0%, #dce8f0 48%, #d7e5ed 100%)",
          }}
        />
        {STARS.map((s, i) => (
          <span
            key={i}
            aria-hidden="true"
            className="sf-star pointer-events-none absolute rounded-full bg-ink"
            style={{
              left: s.left,
              top: s.top,
              width: s.size,
              height: s.size,
              animationDelay: s.delay,
              animationDuration: s.dur,
            }}
          />
        ))}
        <button
          type="button"
          onClick={onClick}
          className="relative z-10 flex w-full cursor-pointer flex-col items-center justify-center gap-1 px-9 pb-3 pt-4"
          title={`${entry.name}${entry.institution ? ` · ${entry.institution}` : ""}`}
        >
          <span className="line-clamp-1 w-full text-center text-[13px] font-semibold leading-tight text-ink/90">
            {entry.name}
          </span>
          <span className="inline-flex items-baseline gap-1 text-accent">
            <b className="text-lg font-semibold leading-none tabular-nums">
              {(entry.score ?? entry.credibility).toFixed(1)}
            </b>
            <span className="text-[10px] font-normal text-accent">
              /10 · {entry.score != null ? "Score" : "Credibility"}
            </span>
          </span>
        </button>

        {interviewScore && onOpenInterview && (
          <button
            type="button"
            onClick={onOpenInterview}
            title="View per-question interview score"
            className="relative z-10 mx-2 mb-2 flex w-[calc(100%-16px)] cursor-pointer items-center justify-center gap-1.5 rounded-full border border-accent/20 bg-accent/[0.07] px-2 py-1 text-[10px] font-medium text-accent transition hover:border-accent/40 hover:bg-accent/[0.12]"
          >
            <svg
              viewBox="0 0 16 16"
              className="h-3 w-3"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              aria-hidden="true"
            >
              <rect x="5" y="2.2" width="6" height="8.3" rx="2.4" />
              <path d="M3.6 7.2v3M12.4 7.2v3M8 13.3v.8" strokeLinecap="round" />
            </svg>
            Interview{" "}
            <b className="tabular-nums">
              {interviewScore.overall != null
                ? interviewScore.overall.toFixed(1)
                : "—"}
            </b>
            <span className="text-accent/70 tabular-nums">
              · {interviewScore.answeredCount}/{interviewScore.totalCount}
            </span>
          </button>
        )}
      </div>

      {onDelete && !confirming && (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="absolute right-2 top-3 z-20 grid h-8 w-8 place-items-center rounded-md text-ink/75 opacity-100 transition hover:bg-rose-400/10 hover:text-rose-800 focus:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
          aria-label={`Remove ${entry.name} from history`}
          title="Remove from history"
        >
          <svg
            viewBox="0 0 16 16"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            aria-hidden="true"
          >
            <path d="M3.5 4.5h9M6 4.5V3h4v1.5M5 6.2l.5 6.3h5l.5-6.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}

      {confirming && (
        <div className="absolute inset-x-1 bottom-1 top-[12px] z-30 flex flex-col justify-center rounded-md border border-rose-300/20 bg-[#eaf1f6]/95 px-3 py-2 shadow-xl">
          <p className="text-center text-[11px] text-ink/75">Remove from history?</p>
          <div className="mt-2 flex justify-center gap-1.5">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-md border border-ink/10 px-3 py-1.5 text-xs text-ink/75 transition hover:text-ink/90"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirming(false);
                onDelete?.();
              }}
              className="rounded-md bg-rose-400/15 px-3 py-1.5 text-xs text-rose-800 transition hover:bg-rose-400/25"
            >
              Remove
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
