"use client";

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
}: {
  entry: ArchiveEntry;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="archive-folder group block w-full text-left"
      title={`${entry.name}${entry.institution ? ` · ${entry.institution}` : ""}`}
    >
      <span className="folder-tab" aria-hidden="true" />
      <span className="folder-body relative block overflow-hidden">
        <span
          aria-hidden="true"
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(130% 140% at 50% 0%, #17234f 0%, #0b1130 48%, #05081a 100%)",
          }}
        />
        {STARS.map((s, i) => (
          <span
            key={i}
            aria-hidden="true"
            className="sf-star pointer-events-none absolute rounded-full bg-white"
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
        <span className="relative z-10 flex h-full flex-col items-center justify-center gap-1 px-3 py-4">
          <span className="line-clamp-1 w-full text-center text-[13px] font-semibold leading-tight text-white/90">
            {entry.name}
          </span>
          <span className="inline-flex items-baseline gap-1 text-accent-soft">
            <b className="text-lg font-semibold leading-none tabular-nums">
              {(entry.score ?? entry.credibility).toFixed(1)}
            </b>
            <span className="text-[10px] font-normal text-accent-soft/70">
              /10 · {entry.score != null ? "评分" : "可信度"}
            </span>
          </span>
        </span>
      </span>
    </button>
  );
}
