"use client";

import { useId } from "react";

// 评分环：彩色部分从 12 点方向顺时针填充，比例为 score / 10。
// variant="score" 为暖色渐变（评分），variant="credibility" 为青蓝渐变（可信度）。
export function ScoreRing({
  score,
  size = 108,
  stroke = 8,
  label = "综合评分",
  showMax = true,
  variant = "score",
}: {
  score: number | null;
  size?: number;
  stroke?: number;
  label?: string;
  showMax?: boolean;
  variant?: "score" | "credibility";
}) {
  const gradId = useId();
  const radius = (size - stroke) / 2 - 2;
  const circumference = 2 * Math.PI * radius;
  const pct =
    typeof score === "number" ? Math.min(1, Math.max(0, score / 10)) : 0;
  const offset = circumference * (1 - pct);
  const stops =
    variant === "credibility"
      ? (
          <>
            <stop offset="0%" stopColor="#38bdf8" />
            <stop offset="55%" stopColor="#7c8cff" />
            <stop offset="100%" stopColor="#a78bfa" />
          </>
        )
      : (
          <>
            <stop offset="0%" stopColor="#4fd1c5" />
            <stop offset="58%" stopColor="#f5a524" />
            <stop offset="100%" stopColor="#ff7a5c" />
          </>
        );

  return (
    <div
      className="relative"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`${label}: ${score} / 10`}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <defs>
          <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
            {stops}
          </linearGradient>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.09)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={`url(#${gradId})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: "stroke-dashoffset 0.6s ease" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span
          className="font-semibold tabular-nums text-white"
          style={{ fontSize: Math.round(size * 0.3) }}
        >
          {typeof score === "number" ? score.toFixed(1) : "—"}
        </span>
        {showMax && (
          <span className="text-white/45" style={{ fontSize: Math.max(10, size * 0.11) }}>
            / 10
          </span>
        )}
        <span
          className="mt-0.5 uppercase tracking-[0.16em] text-white/40"
          style={{ fontSize: Math.max(9, size * 0.095) }}
        >
          {label}
        </span>
      </div>
    </div>
  );
}
