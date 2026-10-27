"use client";

import { useEffect, useRef, useState } from "react";
import type { AnalysisProgress } from "@/lib/types";

/** 分析过程脚本：按节奏逐条吐出的 AI 思考流 */
const SCRIPT: { label: string; detail: string }[] = [
  { label: "Reading uploaded documents", detail: "CV · cover letter · research & teaching statement" },
  { label: "Segmenting document structure", detail: "4 files, 27 pages detected" },
  { label: "Extracting identity and affiliation", detail: "name · position · institution" },
  { label: "Parsing education and employment history", detail: "6 timeline entries resolved" },
  { label: "Collecting publications and venues", detail: "peer-review stage and indexing matched" },
  { label: "Verifying claims against public sources", detail: "institutional page · publisher page" },
  { label: "Cross-checking conflicts", detail: "graduation year flagged, needs human review" },
  { label: "Scoring evaluation dimensions", detail: "research · teaching · fit · standing" },
];

const REVEAL_MS = 1500;

/** 把后端真实进度映射成 0~1 的条宽比例 */
function backendProgressValue(p: AnalysisProgress): number {
  switch (p.stage) {
    case "queued":
      return 0.04;
    case "parsing":
      return 0.08;
    case "extracting":
      return 0.18;
    case "verifying_publications":
      return p.total > 0 ? 0.18 + 0.72 * (p.done / p.total) : 0.18;
    case "verifying_web_claims":
      return p.total > 0 ? 0.9 + 0.1 * (p.done / p.total) : 0.9;
    default:
      return 0.18;
  }
}

/** 后端阶段的用户可读文案 */
function backendProgressLabel(p: AnalysisProgress): string {
  switch (p.stage) {
    case "queued":
      return "Queued · waiting for a worker…";
    case "parsing":
      return "Parsing documents…";
    case "extracting":
      return "Extracting profile…";
    case "verifying_publications":
      return `Verifying publications · ${p.done}/${p.total}`;
    case "verifying_web_claims":
      return `Verifying web claims · ${p.done}/${p.total}`;
    default:
      return "Working…";
  }
}

/** 当前行打字机 */
function useTypewriter(text: string, active: boolean) {
  const [typed, setTyped] = useState("");
  useEffect(() => {
    if (!active) return;
    let i = 0;
    const id = window.setInterval(() => {
      i += 1;
      setTyped(text.slice(0, i));
      if (i >= text.length) window.clearInterval(id);
    }, 22);
    return () => window.clearInterval(id);
  }, [text, active]);
  return active ? typed : text;
}

function ThinkingRow({
  label,
  detail,
  active,
  typing,
}: {
  label: string;
  detail: string;
  active: boolean;
  typing: boolean;
}) {
  const text = useTypewriter(label, typing);
  return (
    <li className="animate-line-in flex items-start gap-3 py-2.5">
      <span
        className={
          active
            ? "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent shadow-[0_0_10px_2px_rgba(63, 127, 158,0.55)]"
            : "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-ink/25"
        }
      />
      <div className="min-w-0">
        <p className="text-sm text-ink/85">
          {text}
          {typing && (
            <span className="animate-caret ml-0.5 inline-block h-3.5 w-[2px] translate-y-0.5 bg-accent" />
          )}
        </p>
        <p className="text-xs text-ink/35">{detail}</p>
      </div>
    </li>
  );
}

/** 单页文档：扫描线自上而下，逐行"点亮" */
function DocPage({ active, rows = 14 }: { active: boolean; rows?: number }) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-ink/10 bg-ink/[0.03] px-4 py-4">
      <div className="mb-3 h-2 w-24 rounded-full bg-ink/15" />
      <div className="space-y-2">
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className="h-1.5 rounded-full bg-ink/10 transition-colors duration-500"
            style={
              active
                ? {
                    width: `${100 - ((i * 37) % 46)}%`,
                    animation: `line-in 0.4s ease ${(i * REVEAL_MS) / rows / 1000}s both`,
                    background: "rgba(63, 127, 158,0.22)",
                  }
                : { width: `${100 - ((i * 37) % 46)}%` }
            }
          />
        ))}
      </div>
      {active && (
        <div
          className="animate-scan pointer-events-none absolute inset-x-0 h-14"
          style={{
            background:
              "linear-gradient(to bottom, transparent, rgba(63, 127, 158,0.16) 55%, rgba(181, 165, 78,0.7))",
          }}
        />
      )}
    </div>
  );
}

/**
 * 分析中界面：左半屏文档逐页扫描，右半屏 AI 思考流逐条打字。
 * @param phase 后端返回的当前真实阶段（可选，会高亮显示）
 */
export default function AnalyzingStage({
  phase,
  progress: liveProgress,
}: {
  phase?: string | null;
  progress?: AnalysisProgress | null;
}) {
  const [step, setStep] = useState(0);
  const scrollerRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const id = setInterval(
      () => setStep((s) => (s >= SCRIPT.length ? s : s + 1)),
      REVEAL_MS,
    );
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    scrollerRef.current?.scrollTo({
      top: scrollerRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [step]);

  const shown = Math.min(step, SCRIPT.length);
  const livePercent = liveProgress
    ? backendProgressValue(liveProgress)
    : null;
  // 无真实进度时只推进到 12% 作为“启动”指示，避免假动画先冲到 100% 再回退
  const bootPercent = 0.02 + 0.1 * Math.min(shown / SCRIPT.length, 1);
  const target = livePercent ?? bootPercent;
  // 单调递增，切换到真实进度时只往前不会往回跳。
  // 用「调整 render 期间 state」模式替代 render 期间读写 ref。
  const [peak, setPeak] = useState(0);
  if (target > peak) {
    setPeak(target);
  }
  const progress = Math.max(target, peak);
  const progressLabel = liveProgress
    ? backendProgressLabel(liveProgress)
    : "Analysis progress";

  return (
    <div className="animate-collapse mx-auto w-full max-w-6xl">
      {/* 顶部：动态进度条 */}
      <div className="mb-5">
        <div className="mb-2 flex items-center justify-between text-xs">
          <span className="font-medium uppercase tracking-[0.25em] text-ink/35">
            {progressLabel}
          </span>
          <span className="font-mono text-accent-soft">
            {Math.round(progress * 100)}%
          </span>
        </div>
        <div className="relative h-2.5 overflow-hidden rounded-full border border-ink/15 bg-ink/[0.07]">
          <div
            className="progress-fill relative h-full rounded-full"
            style={{ width: progress > 0 ? `${Math.max(progress * 100, 3)}%` : "0%" }}
          >
            <span className="progress-dots pointer-events-none absolute inset-0 rounded-full" />
            <span className="progress-shine pointer-events-none absolute inset-0 rounded-full" />
          </div>
        </div>
      </div>

      <div className="grid w-full gap-4 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1fr)]">
        {/* 左：文档扫描 */}
        <div className="relative rounded-2xl border border-ink/10 bg-ink/[0.02] p-5 backdrop-blur-xl">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-[0.25em] text-ink/35">
              Parsing
            </p>
            <span className="flex items-center gap-1.5 text-xs text-ink/40">
              <span className="animate-ring-spin inline-block h-2.5 w-2.5 rounded-full border border-accent/30 border-t-accent" />
              page {Math.min(step + 1, 27)} / 27
            </span>
          </div>

          <div className="relative h-[19rem]">
            {/* 叠放的两页文档 */}
            <div className="absolute inset-x-3 top-2 -rotate-2 opacity-30">
              <DocPage active={false} rows={10} />
            </div>
            <div className="absolute inset-x-0 top-5">
              <DocPage active rows={15} />
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {["candidate_cv.pdf", "cover_letter.pdf", "research_statement.pdf", "teaching_statement.pdf"].map(
              (f, i) => (
                <span
                  key={f}
                  className="rounded-full border px-2.5 py-1 text-[11px] transition-colors duration-500"
                  style={{
                    borderColor: i < Math.min(step + 1, 4) ? "rgba(63, 127, 158,0.45)" : "rgba(22, 50, 74,0.14)",
                    color: i < Math.min(step + 1, 4) ? "#2c5c78" : "rgba(22, 50, 74,0.35)",
                    background: i < Math.min(step + 1, 4) ? "rgba(63, 127, 158,0.12)" : "transparent",
                  }}
                >
                  {f}
                </span>
              ),
            )}
          </div>
        </div>

        {/* 右：思考流 */}
        <div className="rounded-2xl border border-ink/10 bg-ink/[0.02] p-5 backdrop-blur-xl">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-[0.25em] text-ink/35">
              Reasoning trace
            </p>
            <span className="font-mono text-xs text-ink/30">
              {shown} / {SCRIPT.length}
            </span>
          </div>

          {phase && (
            <p className="mb-3 rounded-lg border border-accent/25 bg-accent/[0.07] px-3 py-2 text-xs text-accent-soft">
              backend · {phase}
            </p>
          )}

          <ul ref={scrollerRef} className="max-h-[16.5rem] overflow-hidden">
            {SCRIPT.slice(0, shown).map((s, i) => (
              <ThinkingRow
                key={s.label}
                label={s.label}
                detail={s.detail}
                active={i === shown - 1}
                typing={i === shown - 1}
              />
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
