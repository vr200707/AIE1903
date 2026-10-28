"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { mockProfile } from "@/lib/mock";
import {
  uploadFiles,
  analyze,
  getAnalyzeStatus,
  fetchScore,
  askQuestion,
} from "@/lib/api";
import { Section } from "@/components/Section";
import Starfield, { HERO_IMAGE } from "@/components/Starfield";
import AnalyzingStage from "@/components/AnalyzingStage";
import CountUp from "@/components/CountUp";
import {
  PlanetOverview,
  type OverviewSection,
} from "@/components/PlanetOverview";
import { useIdentity } from "@/components/IdentityProvider";
import { EvidenceList } from "@/components/EvidenceList";
import { EvidenceBadge } from "@/components/EvidenceBadge";
import { EvidenceModal } from "@/components/EvidenceModal";
import { TagFilter, type FilterState } from "@/components/TagFilter";
import { useArchive } from "@/components/ArchiveProvider";
import { useQaHistory } from "@/components/QaHistoryProvider";
import { getArchive } from "@/lib/archive";
import { computeAssessment } from "@/lib/scoring";
import {
  authorRoleLabel,
  venueTypeLabel,
  serviceTypeLabel,
  fundingRoleLabel,
} from "@/lib/labels";
import type {
  DateValue,
  Evidence,
  EvidenceStatus,
  Candidate,
  AnalysisWarning,
  AnalysisProgress,
  LlmAssessment,
  QAResponse,
} from "@/lib/types";

// 空值兜底显示
function n(v: string | null | undefined): string {
  return v ?? "—";
}

// 日期区间（null 视为"至今"）
function dateRange(start: DateValue, end: DateValue): string {
  const s = start ?? "?";
  const e = end ?? "Present";
  return `${s} ~ ${e}`;
}

// 过滤空值，返回 string[]
function nonEmpty(xs: (string | null | undefined)[]): string[] {
  return xs.filter((x): x is string => Boolean(x));
}

// 搜索/标签过滤：把多个字段拼成一段可检索文本，命中搜索词与任一标签才算匹配
function matchesFilter(
  q: string,
  tags: string[],
  ...fields: (string | null | undefined)[]
): boolean {
  const query = q.trim().toLowerCase();
  const lowerTags = tags.map((t) => t.toLowerCase());
  const hay = fields.filter((f): f is string => Boolean(f)).join(" ").toLowerCase();
  const bySearch = !query || hay.includes(query);
  const byTag = lowerTags.length === 0 || lowerTags.some((t) => hay.includes(t));
  return bySearch && byTag;
}

// 标签行（研究方向 / 技能 / 优势等）
function TagRow({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-4">
      <p className="text-xs font-medium text-ink/75">{label}</p>
      <div className="mt-1.5 flex flex-wrap gap-2">
        {items.map((x) => (
          <span
            key={x}
            className="rounded-full bg-ink/10 px-3 py-1 text-sm text-ink/75"
          >
            {x}
          </span>
        ))}
      </div>
    </div>
  );
}

// 文字行列表：替代小药丸，一排排列出
function BulletList({
  label,
  items,
  tone = "accent",
}: {
  label: string;
  items: string[];
  tone?: "accent" | "warn";
}) {
  if (items.length === 0) return null;
  const dot = tone === "warn" ? "bg-amber-400/70" : "bg-accent/70";
  return (
    <div className="mt-5">
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-ink/75">
        {label}
      </p>
      <ul className="mt-2.5 space-y-0">
        {items.map((x, i) => (
          <li
            key={i}
            className="flex items-baseline gap-3 border-t border-ink/[0.07] py-2.5 text-base leading-relaxed text-ink/80 first:border-t-0 first:pt-0"
          >
            <span className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
            <span>{x}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="group inline-flex items-center gap-2 rounded-full border border-ink/12 bg-ink/[0.04] px-4 py-2 text-sm text-ink/75 backdrop-blur-xl transition hover:border-accent/30 hover:text-ink"
    >
      <span className="transition-transform group-hover:-translate-x-0.5">←</span>
      Back to home
    </button>
  );
}

const OVERVIEW_STARS = [
  { left: "11%", top: "26%", size: 2, delay: "0s", dur: "2.4s" },
  { left: "27%", top: "64%", size: 3, delay: "0.7s", dur: "3.1s" },
  { left: "46%", top: "20%", size: 2, delay: "1.3s", dur: "2.7s" },
  { left: "63%", top: "70%", size: 2, delay: "0.4s", dur: "3.4s" },
  { left: "80%", top: "32%", size: 3, delay: "1.9s", dur: "2.2s" },
  { left: "91%", top: "58%", size: 1.5, delay: "1.0s", dur: "2.9s" },
];

function OverviewButton({
  onClick,
  score,
}: {
  onClick: () => void;
  score: number | null;
}) {
  return (
    <button
      onClick={onClick}
      className="starfield-btn group relative inline-flex items-center gap-2 overflow-hidden rounded-full border border-accent/35 px-4 py-2 text-sm text-accent"
    >
      {OVERVIEW_STARS.map((s, i) => (
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
      <span
        aria-hidden="true"
        className="sf-shoot pointer-events-none absolute inset-y-0 left-0 w-14 bg-gradient-to-r from-transparent via-accent/45 to-transparent"
      />
      <span className="relative z-10" aria-hidden="true">✦</span>
      <span className="relative z-10">Overview</span>
      <span className="relative z-10 inline-flex items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 text-xs font-semibold tabular-nums text-accent">
        {score != null ? score.toFixed(1) : "—"}
        <span className="text-[10px] font-normal text-accent">/10</span>
      </span>
    </button>
  );
}

function InterviewButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group inline-flex items-center gap-2 rounded-full border border-ink/12 bg-ink/[0.04] px-4 py-2 text-sm text-ink/75 transition hover:border-accent/35 hover:bg-accent/[0.06] hover:text-accent"
    >
      <svg
        viewBox="0 0 16 16"
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        aria-hidden="true"
      >
        <rect x="2" y="4" width="9" height="8" rx="1.5" />
        <path d="m11 6.5 3-1.5v6l-3-1.5" strokeLinejoin="round" />
      </svg>
      Prepare interview
      <span className="text-accent transition-transform group-hover:translate-x-0.5">
        →
      </span>
    </button>
  );
}

function HeroIntro() {
  return (
    <div className="hero-intro-overlay" aria-hidden="true">
      <img src={HERO_IMAGE} alt="" className="hero-intro-glacier" />
      <span className="hero-intro-sweep" />
    </div>
  );
}

function ScrollHint() {
  return (
    <div className="animate-scroll-hint mt-14 flex flex-col items-center gap-2 text-ink/75">
      <span className="text-[11px] uppercase tracking-[0.35em]">Scroll</span>
      <svg
        viewBox="0 0 16 16"
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        aria-hidden="true"
      >
        <path d="M3 6l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

function StepImage({ src, alt }: { src: string; alt: string }) {
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);

  // 图片可能在 React 水合完成之前就已加载完毕,onLoad 永远不会再触发,
  // 此时直接读取 complete 标记,避免图片一直停在 opacity-0。
  useEffect(() => {
    if (imgRef.current?.complete) {
      setLoaded(true);
    }
  }, []);

  return (
    <div className="step-float relative aspect-[16/10] w-full overflow-hidden rounded-3xl border border-ink/10 bg-ink/[0.05] shadow-[0_30px_60px_-32px_rgba(22,50,74,0.5)]">
      {!loaded && (
        <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-accent/15 via-accent/5 to-background" />
      )}
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        onLoad={() => setLoaded(true)}
        onError={() => setLoaded(true)}
        className={`h-full w-full object-cover transition-opacity duration-700 ${
          loaded ? "opacity-100" : "opacity-0"
        }`}
      />
    </div>
  );
}

const STEPS = [
  {
    num: "01",
    title: "Upload",
    text: "Drop in a CV, cover letter, research statement and teaching statement. We parse the documents and prepare them for analysis.",
    img: "/screenshots/upload.png",
  },
  {
    num: "02",
    title: "Analyze",
    text: "AI extracts a structured profile and verifies every claim against public sources, linking each field back to its evidence.",
    img: "/screenshots/analyze.png",
  },
  {
    num: "03",
    title: "Review",
    text: "Review a six-dimension evaluation with evidence-grounded scoring, credibility, and an AI assistant for Q&A and interview prep.",
    img: "/screenshots/review.png",
  },
];

function StepSection({ step }: { step: (typeof STEPS)[number] }) {
  const ref = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisible(true);
          io.disconnect();
        }
      },
      { threshold: 0.3 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <section
      ref={ref}
      className="snap-align flex min-h-screen items-center px-8 py-16"
    >
      <div className="mx-auto grid w-full max-w-6xl items-center gap-10 lg:grid-cols-2">
        <div className={visible ? "animate-reveal" : "opacity-0"}>
          <p className="font-display text-7xl font-light leading-none text-accent">
            {step.num}
          </p>
          <h2 className="mt-4 font-display text-5xl font-light tracking-tight sm:text-6xl">
            {step.title}
          </h2>
          <p className="mt-5 max-w-xl text-3xl leading-relaxed text-ink/80">
            {step.text}
          </p>
        </div>
        <div
          className={`${visible ? "animate-reveal" : "opacity-0"} relative`}
          style={{ animationDelay: "0.15s" }}
        >
          <StepImage src={step.img} alt={step.title} />
        </div>
      </div>
    </section>
  );
}

let introPlayed = false;

export default function Home() {
  const router = useRouter();
  const { setIdentity } = useIdentity();
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState<string | null>(null);
  const [analysisProgress, setAnalysisProgress] =
    useState<AnalysisProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [analysisWarnings, setAnalysisWarnings] = useState<AnalysisWarning[]>([]);
  const [filter, setFilter] = useState<FilterState>({ tags: [], search: "" });
  const [selectedEvidence, setSelectedEvidence] = useState<Evidence | null>(null);
  const [corrections, setCorrections] = useState<Map<Evidence, EvidenceStatus>>(
    new Map(),
  );
  const [profileId, setProfileId] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [qaResult, setQaResult] = useState<QAResponse | null>(null);
  const [qaError, setQaError] = useState<string | null>(null);
  const [qaLoading, setQaLoading] = useState(false);
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [overviewSelect, setOverviewSelect] =
    useState<OverviewSection | null>(null);
  const [llmAssessment, setLlmAssessment] = useState<LlmAssessment | null>(null);
  const [scoreLoading, setScoreLoading] = useState(false);
  const {
    saveArchive,
    pendingId,
    clearPending,
    pendingInterviewId,
    clearPendingInterview,
    archives,
  } = useArchive();
  const { addAnswer, history: qaHistory } = useQaHistory();
  const [loadedArchiveId, setLoadedArchiveId] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<string>("basic");

  // 开场动画只在整页首次加载时播放一次，之后「返回首页」直接显示内容
  const [introDone] = useState(() => {
    // SSR 始终按“首次访问”渲染（与客户端首帧一致，避免 hydration 不一致）；
    // 客户端首次渲染时读取模块级标志，只有真正的新会话才播开场。
    if (typeof window === "undefined") return false;
    const done = introPlayed;
    introPlayed = true;
    return done;
  });
  const playIntro = !introDone;
  const delay = (base: string) => (playIntro ? base : "0s");

  const getStatus = (e: Evidence): EvidenceStatus =>
    corrections.get(e) ?? e.evidence_status;

  // 对 mock / 已存档档案即时获取 DeepSeek 评分（后端分析已完成但评分
  // 失败时也可用它重试）。
  const refreshLlmScore = useCallback(
    async (id: string, target: Candidate) => {
      setScoreLoading(true);
      try {
        const res = await fetchScore(target);
        setLlmAssessment(res);
        saveArchive(id, target, res);
      } catch {
        // 评分失败不影响主流程：界面显示「—」并保留可信度。
      } finally {
        setScoreLoading(false);
      }
    },
    [saveArchive],
  );

  // 侧栏底部身份位跟随候选人
  useEffect(() => {
    setIdentity(
      candidate
        ? {
            name: candidate.basic_info.name ?? "Unnamed candidate",
            detail: candidate.basic_info.institution ?? "",
          }
        : null,
    );
  }, [candidate, setIdentity]);

  const correctEvidence = (target: Evidence, status: EvidenceStatus) => {
    setCorrections((prev) => {
      const next = new Map(prev);
      next.set(target, status);
      return next;
    });
  };

  const handleFiles = async (files: File[]) => {
    setLoading(true);
    setLoadingMessage("Uploading and parsing documents...");
    setAnalysisProgress(null);
    setError(null);
    setAnalysisWarnings([]);
    try {
      const { upload_id } = await uploadFiles(files);
      setLoadingMessage("Extracting profile and verifying public sources...");
      const first = await analyze(upload_id);
      if (
        first.status === "completed" ||
        first.status === "completed_with_warnings"
      ) {
        setProfileId(first.profile_id ?? null);
        setCandidate(first.candidate ?? null);
        setLlmAssessment(first.assessment ?? null);
        if (first.profile_id && first.candidate) {
          saveArchive(
            first.profile_id,
            first.candidate,
            first.assessment ?? null,
          );
          if (!first.assessment) {
            void refreshLlmScore(first.profile_id, first.candidate);
          }
        }
        setAnalysisWarnings(first.warnings ?? []);
      } else {
        await pollAnalyze(upload_id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed. Please try again.");
    } finally {
      setLoading(false);
      setLoadingMessage(null);
    }
  };

  const pollAnalyze = async (uploadId: string) => {
    // 分析在后台运行；每 1.5s 轮询一次，最长约 10 分钟。
    for (let attempt = 0; attempt < 400; attempt += 1) {
      const res = await getAnalyzeStatus(uploadId);
      if (res.progress) setAnalysisProgress(res.progress);
      if (
        res.status === "completed" ||
        res.status === "completed_with_warnings"
      ) {
        setAnalysisProgress(null);
        setProfileId(res.profile_id ?? null);
        setCandidate(res.candidate ?? null);
        setLlmAssessment(res.assessment ?? null);
        if (res.profile_id && res.candidate) {
          saveArchive(res.profile_id, res.candidate, res.assessment ?? null);
          if (!res.assessment) {
            void refreshLlmScore(res.profile_id, res.candidate);
          }
        }
        setAnalysisWarnings(res.warnings ?? []);
        return;
      }
      if (res.status === "failed") {
        throw new Error(
          res.error?.detail ?? "Analysis failed on the server. Please try again.",
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    throw new Error("Analysis timed out. Please try again.");
  };

  const handleAsk = async () => {
    if (!profileId || !question.trim()) return;
    setQaLoading(true);
    setQaResult(null);
    setQaError(null);
    try {
      const res = await askQuestion(profileId, question.trim());
      setQaResult(res);
      addAnswer(question.trim(), res);
    } catch (e) {
      setQaError(e instanceof Error ? e.message : "Q&A failed. Please try again.");
    } finally {
      setQaLoading(false);
    }
  };

  const resetToHome = () => {
    setCandidate(null);
    setProfileId(null);
    setFilter({ tags: [], search: "" });
    setSelectedEvidence(null);
    setCorrections(new Map());
    setAnalysisWarnings([]);
    setQaResult(null);
    setQaError(null);
    setQuestion("");
    setLlmAssessment(null);
    setOverviewOpen(false);
    setOverviewSelect(null);
  };

  // 从侧栏档案库点击文件夹后，加载对应的已存档简历。
  // render 期间只更新本组件 state；clearPending 更新的是 ArchiveProvider 的 state，只能在 effect 里做。
  if (pendingId && pendingId !== loadedArchiveId) {
    const entry = getArchive(pendingId);
    setLoadedArchiveId(pendingId);
    if (entry) {
      setCandidate(entry.candidate);
      setProfileId(entry.profileId);
      setLlmAssessment(entry.llm ?? null);
      setFilter({ tags: [], search: "" });
      setSelectedEvidence(null);
      setCorrections(new Map());
      setAnalysisWarnings([]);
      setQaResult(null);
      setQaError(null);
      setQuestion("");
      setOverviewOpen(false);
      setOverviewSelect(null);
      if (!entry.llm) {
        void refreshLlmScore(entry.profileId, entry.candidate);
      }
    }
  }

  // 消费完 pendingId 信号后清空它
  useEffect(() => {
    if (pendingId) clearPending();
  }, [pendingId, clearPending]);

  // 从侧栏档案库点击「Interview」分数后，加载对应档案并直接打开
  // 整体评分弹窗、选中面试板块（而非单独的小弹窗）。
  if (pendingInterviewId && pendingInterviewId !== loadedArchiveId) {
    const entry = getArchive(pendingInterviewId);
    setLoadedArchiveId(pendingInterviewId);
    if (entry) {
      setCandidate(entry.candidate);
      setProfileId(entry.profileId);
      setLlmAssessment(entry.llm ?? null);
      setFilter({ tags: [], search: "" });
      setSelectedEvidence(null);
      setCorrections(new Map());
      setAnalysisWarnings([]);
      setQaResult(null);
      setQaError(null);
      setQuestion("");
      setOverviewSelect("interview");
      setOverviewOpen(true);
      if (!entry.llm) {
        void refreshLlmScore(entry.profileId, entry.candidate);
      }
    }
  }

  useEffect(() => {
    if (pendingInterviewId) clearPendingInterview();
  }, [pendingInterviewId, clearPendingInterview]);

  const c = candidate;

  // 当前档案的面试评分（来自档案库，上传视频分析完成后写入）
  const currentArchiveEntry = useMemo(
    () =>
      profileId
        ? archives.find((entry) => entry.profileId === profileId) ?? null
        : null,
    [archives, profileId],
  );

  // 评分随 candidate 与人工修正（corrections）实时重算
  const assessment = useMemo(
    () =>
      c
        ? computeAssessment(
            c,
            (e) => corrections.get(e) ?? e.evidence_status,
            llmAssessment,
          )
        : null,
    [c, corrections, llmAssessment],
  );

  if (!c) {
    return (
      <div className="relative h-screen snap-scroll overflow-y-auto text-ink">
        <Starfield image={HERO_IMAGE} />

        {loading ? (
          <main className="relative flex min-h-screen flex-col justify-center px-6 py-14">
            <div
              className="animate-reveal mx-auto mb-9 max-w-3xl text-center"
              style={{ animationDelay: "0.08s" }}
            >
              <p className="text-xs font-medium uppercase tracking-[0.45em] text-accent">
                Analyzing
              </p>
              <h2 className="mt-5 font-display text-4xl font-light leading-tight sm:text-5xl">
                Building the profile
              </h2>
              <p className="mt-3 text-sm text-ink/75">{loadingMessage}</p>
            </div>
            <AnalyzingStage phase={loadingMessage} progress={analysisProgress} />
          </main>
        ) : (
          <>
            {playIntro && <HeroIntro />}

            <section className="snap-align relative flex min-h-screen flex-col items-center justify-center px-6 py-16">
              <div className="w-full max-w-3xl text-center">
            {/* 小标：宽字距 + 星芒 */}
            <p
              className="animate-reveal flex items-center justify-center gap-3 text-xs font-medium uppercase tracking-[0.45em] text-ink/75"
              style={{ animationDelay: delay("2.1s") }}
            >
              <span className="animate-sparkle inline-block text-accent">✦</span>
              AIE1903 · AI-assisted faculty hiring
              <span className="animate-sparkle inline-block text-accent" style={{ animationDelay: "1.2s" }}>
                ✦
              </span>
            </p>

            {/* 主标题：几何轻体 */}
            <h2
              className="animate-reveal mt-9 font-display text-5xl font-light leading-[1.06] tracking-tight sm:text-6xl lg:text-[5.2rem]"
              style={{ animationDelay: delay("2.35s") }}
            >
              Every claim,
              <br />
              <span className="italic text-accent">traced to its evidence.</span>
            </h2>

            <p
              className="animate-reveal mx-auto mt-8 max-w-xl text-base leading-relaxed text-ink/75"
              style={{ animationDelay: delay("2.55s") }}
            >
              Upload a CV, cover letter, research statement and teaching statement.
              Get a structured candidate profile where every field links back to its source.
            </p>

            <div
              className="animate-reveal mt-11 flex flex-wrap items-center justify-center gap-4"
              style={{ animationDelay: delay("2.7s") }}
            >
              <label className="animate-halo group relative cursor-pointer overflow-hidden rounded-full bg-ink px-9 py-3.5 text-sm font-medium text-white transition hover:bg-ink/90">
                <span className="relative z-10">Choose files</span>
                <input
                  aria-label="Choose files"
                  type="file"
                  multiple
                  accept=".pdf,.docx"
                  className="absolute inset-0 cursor-pointer opacity-0"
                  onChange={(ev) => {
                    const files = Array.from(ev.target.files ?? []);
                    ev.target.value = "";
                    if (files.length > 0) void handleFiles(files);
                  }}
                />
              </label>
              <button
                onClick={() => {
                  setAnalysisWarnings([]);
                  setCandidate(mockProfile.candidate);
                  setProfileId("demo");
                  setLlmAssessment(null);
                  saveArchive("demo", mockProfile.candidate, null);
                  void refreshLlmScore("demo", mockProfile.candidate);
                }}
                disabled={loading}
                className="animate-sweep relative overflow-hidden rounded-full border border-ink/20 px-9 py-3.5 text-sm text-ink/75 transition hover:border-ink/40 hover:text-ink disabled:cursor-not-allowed disabled:opacity-75"
              >
                <span className="relative z-10">Load example data</span>
              </button>
            </div>

            <ScrollHint />

            {error && (
              <p className="animate-reveal mt-6 text-sm text-rose-800">{error}</p>
            )}
              </div>
            </section>

            {STEPS.map((step) => (
              <StepSection key={step.num} step={step} />
            ))}
          </>
        )}
      </div>
    );
  }

  // 可筛选标签（研究方向 + 技能 + 机构 + 论文等级）
  const tags = Array.from(
    new Set(
      nonEmpty([
        ...c.basic_info.research_interests,
        ...c.basic_info.skills,
        c.basic_info.institution,
        ...c.publications_impact.publications.map((p) => p.ranking),
      ]),
    ),
  );

  const evidenceCount =
    c.basic_info.evidence.length +
    c.education_employment.education.reduce((s, e) => s + e.evidence.length, 0) +
    c.education_employment.employment.reduce((s, e) => s + e.evidence.length, 0) +
    c.awards_funding.awards.reduce((s, a) => s + a.evidence.length, 0) +
    c.awards_funding.funding.reduce((s, f) => s + f.evidence.length, 0) +
    c.publications_impact.publications.reduce((s, p) => s + p.evidence.length, 0) +
    c.academic_service.services.reduce((s, sv) => s + sv.evidence.length, 0);

  const kpis = [
    { label: "Publications", value: c.publications_impact.publications.length },
    { label: "Total citations", value: c.publications_impact.total_citations ?? 0 },
    { label: "Evidence items", value: evidenceCount },
    { label: "Evaluation dimensions", value: c.overall_evaluation.dimensions.length },
  ];

  // 搜索 + 标签过滤：对每个列表条目按可检索字段过滤，让搜索真正有用途
  const q = filter.search;
  const activeTags = filter.tags;
  const hasFilter = q.trim() !== "" || activeTags.length > 0;
  const match = (...fields: (string | null | undefined)[]) =>
    matchesFilter(q, activeTags, ...fields);

  const interests = c.basic_info.research_interests.filter((x) => match(x));
  const skills = c.basic_info.skills.filter((x) => match(x));
  const strengths = c.basic_info.strengths.filter((x) => match(x));
  const toVerify = c.basic_info.to_verify.filter((v) => match(v.claim, v.reason));
  const education = c.education_employment.education.filter((e) =>
    match(e.degree, e.field, e.institution, e.advisor, ...e.projects, ...e.outcomes),
  );
  const employment = c.education_employment.employment.filter((e) =>
    match(e.position, e.institution, ...e.responsibilities, ...e.projects, ...e.outcomes),
  );
  const awards = c.awards_funding.awards.filter((a) =>
    match(a.name, a.awarding_body, a.year != null ? String(a.year) : null),
  );
  const funding = c.awards_funding.funding.filter((f) =>
    match(f.project_name, f.funder, f.role),
  );
  const publications = c.publications_impact.publications.filter((p) =>
    match(
      p.title,
      p.venue,
      p.ranking,
      p.year != null ? String(p.year) : null,
      venueTypeLabel[p.venue_type],
    ),
  );
  const services = c.academic_service.services.filter((s) =>
    match(s.organization_or_venue, s.role, ...s.research_areas),
  );
  const evalStrengths = c.overall_evaluation.strengths.filter((x) => match(x));
  const evalRisks = c.overall_evaluation.risks.filter((x) => match(x));
  const dimensions = c.overall_evaluation.dimensions.filter((d) =>
    match(d.dimension, d.assessment),
  );

  const resultCount =
    interests.length +
    skills.length +
    strengths.length +
    toVerify.length +
    education.length +
    employment.length +
    awards.length +
    funding.length +
    publications.length +
    services.length +
    evalStrengths.length +
    evalRisks.length +
    dimensions.length;
  const emptyText = hasFilter ? "No matching items" : "None";

  return (
    <div className="relative min-h-screen text-ink/90">
      <Starfield image={HERO_IMAGE} />
      <main className="mx-auto max-w-6xl space-y-5 px-8 py-10">
        <div
          className="animate-pop flex items-center justify-between gap-4"
          style={{ animationDelay: "0.05s" }}
        >
          <BackButton onClick={resetToHome} />
          <div className="flex flex-wrap items-center justify-end gap-2">
            {profileId && (
              <InterviewButton
                onClick={() =>
                  router.push(`/interview/${encodeURIComponent(profileId)}`)
                }
              />
            )}
            <OverviewButton
              onClick={() => {
                setOverviewSelect(null);
                setOverviewOpen(true);
              }}
              score={assessment?.overall ?? null}
            />
          </div>
        </div>
        {analysisWarnings.length > 0 && (
          <div
            className="animate-fade-in-up rounded-lg border border-amber-400/30 bg-amber-400/[0.08] p-4 text-sm"
            role="status"
          >
            <p className="font-semibold text-amber-800">
              Analysis completed with warnings
            </p>
            <ul className="mt-2 space-y-1 text-amber-800">
              {analysisWarnings.map((item, index) => (
                <li key={`${item.code}-${index}`}>
                  {item.source ? `${item.source}: ` : ""}
                  {item.message}
                  {item.retryable ? " You can retry the analysis." : ""}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="animate-pop" style={{ animationDelay: "0.05s" }}>
          <TagFilter
            tags={tags}
            filter={filter}
            onChange={setFilter}
            resultCount={resultCount}
          />
        </div>

        {/* KPI 概览条 */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {kpis.map((k) => (
            <div
              key={k.label}
              className="glass rounded-2xl transition-all duration-300 hover:bg-ink/[0.08] hover:shadow-[0_22px_44px_-26px_rgba(22, 50, 74,0.42)]"
            >
              <div className="animate-pop px-5 py-4">
                <p className="font-display text-3xl font-light tabular-nums tracking-tight text-ink">
                  <CountUp value={k.value} />
                </p>
                <p className="mt-1 text-sm text-ink/75">{k.label}</p>
              </div>
            </div>
          ))}
        </div>

        {/* 模块导航 */}
        <div className="flex flex-wrap gap-2">
          {[
            { key: "basic", label: "Basic Info", icon: "01" },
            { key: "edu", label: "Education", icon: "02" },
            { key: "awards", label: "Awards", icon: "03" },
            { key: "pubs", label: "Publications", icon: "04" },
            { key: "service", label: "Service", icon: "05" },
            { key: "eval", label: "Evaluation", icon: "06" },
          ].map((t) => {
            const active = activeSection === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setActiveSection(t.key)}
                className={`group relative flex items-center gap-2 overflow-hidden rounded-full px-4 py-2.5 text-base transition-all duration-300 ${
                  active
                    ? "bg-accent text-white shadow-[0_12px_28px_-12px_rgba(63,127,158,0.85)]"
                    : "bg-ink/[0.06] text-ink/75 hover:bg-ink/[0.12] hover:text-ink"
                }`}
              >
                <span
                  className={`font-mono text-xs tabular-nums transition-colors ${
                    active ? "text-white" : "text-ink/75 group-hover:text-ink/75"
                  }`}
                >
                  {t.icon}
                </span>
                {t.label}
                {active && (
                  <span className="absolute inset-x-3 bottom-1 h-0.5 rounded-full bg-white/60" />
                )}
              </button>
            );
          })}
        </div>

        {/* 模块内容（按 tab 切换显示） */}
        <div>
        {/* 1. 基本信息 */}
        <Section title="Basic Information" hidden={activeSection !== "basic"} delay={0.1} className="lg:col-span-5">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h3 className="text-2xl font-semibold tracking-tight">{n(c.basic_info.name)}</h3>
            <span className="text-ink/75">{n(c.basic_info.position)}</span>
          </div>
          <p className="mt-1 text-sm text-ink/75">
            {n(c.basic_info.institution)}
            {c.basic_info.highest_degree ? ` · ${c.basic_info.highest_degree}` : ""}
          </p>

          <TagRow label="Research interests" items={interests} />
          <TagRow label="Skills" items={skills} />
          <BulletList label="Strengths" items={strengths} />

          {toVerify.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-medium text-ink/75">Items to verify</p>
              <ul className="mt-2 space-y-4">
                {toVerify.map((v, i) => (
                  <li
                    key={i}
                    className="border-t border-ink/[0.09] pt-4 first:border-t-0 first:pt-0"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-ink/85">{v.claim}</span>
                      {v.evidence.map((e, j) => (
                        <EvidenceBadge key={j} status={e.evidence_status} />
                      ))}
                    </div>
                    <p className="mt-1 text-ink/75">{v.reason}</p>
                    <EvidenceList
                      items={v.evidence}
                      onEvidenceClick={setSelectedEvidence}
                      getStatus={getStatus}
                    />
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-4">
            <p className="text-xs font-medium text-ink/75">Evidence sources</p>
            <EvidenceList
              items={c.basic_info.evidence}
              onEvidenceClick={setSelectedEvidence}
              getStatus={getStatus}
            />
          </div>
        </Section>

        {/* 2. 教育与工作 */}
        <Section title="Education & Work" hidden={activeSection !== "edu"} delay={0.15} className="lg:col-span-7">
          <h4 className="text-lg font-semibold text-ink/80">Education</h4>
          {education.length === 0 ? (
            <p className="mt-2 text-sm text-ink/75">{emptyText}</p>
          ) : (
            <div className="mt-2">
              {education.map((ed, i) => (
                <div key={i} className="mt-4 border-t border-ink/[0.09] pt-4 first:mt-0 first:border-t-0 first:pt-0">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-semibold">{n(ed.degree)}</span>
                    <span className="text-ink/75">{n(ed.field)}</span>
                  </div>
                  <p className="mt-1 text-sm text-ink/75">
                    {n(ed.institution)} · Advisor: {n(ed.advisor)}
                  </p>
                  <p className="text-sm text-ink/75">
                    {dateRange(ed.start_date, ed.end_date)}
                  </p>
                  {ed.projects.length > 0 && (
                    <p className="mt-1 text-sm text-ink/75">
                      Projects: {ed.projects.join(", ")}
                    </p>
                  )}
                  {ed.outcomes.length > 0 && (
                    <p className="mt-1 text-sm text-ink/75">
                      Outcomes: {ed.outcomes.join(", ")}
                    </p>
                  )}
                  <EvidenceList items={ed.evidence} onEvidenceClick={setSelectedEvidence} getStatus={getStatus} />
                </div>
              ))}
            </div>
          )}

          <h4 className="mt-6 text-lg font-semibold text-ink/80">Work experience</h4>
          {employment.length === 0 ? (
            <p className="mt-2 text-sm text-ink/75">{emptyText}</p>
          ) : (
            <div className="mt-2">
              {employment.map((em, i) => (
                <div key={i} className="mt-4 border-t border-ink/[0.09] pt-4 first:mt-0 first:border-t-0 first:pt-0">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-semibold">{n(em.position)}</span>
                    <span className="text-ink/75">{n(em.institution)}</span>
                  </div>
                  <p className="mt-1 text-sm text-ink/75">
                    {dateRange(em.start_date, em.end_date)}
                  </p>
                  {em.responsibilities.length > 0 && (
                    <p className="mt-1 text-sm text-ink/75">
                      Responsibilities: {em.responsibilities.join(", ")}
                    </p>
                  )}
                  {em.projects.length > 0 && (
                    <p className="mt-1 text-sm text-ink/75">
                      Projects: {em.projects.join(", ")}
                    </p>
                  )}
                  {em.outcomes.length > 0 && (
                    <p className="mt-1 text-sm text-ink/75">
                      Outcomes: {em.outcomes.join(", ")}
                    </p>
                  )}
                  <EvidenceList items={em.evidence} onEvidenceClick={setSelectedEvidence} getStatus={getStatus} />
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* 3. 奖项与经费 */}
        <Section title="Awards & Funding" hidden={activeSection !== "awards"} delay={0.2} className="lg:col-span-5">
          <h4 className="text-lg font-semibold text-ink/80">Awards</h4>
          {awards.length === 0 ? (
            <p className="mt-2 text-sm text-ink/75">{emptyText}</p>
          ) : (
            <div className="mt-2">
              {awards.map((a, i) => (
                <div key={i} className="mt-4 border-t border-ink/[0.09] pt-4 first:mt-0 first:border-t-0 first:pt-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{a.name}</span>
                    {a.year != null && (
                      <span className="text-sm text-ink/75">{a.year}</span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-ink/75">
                    Awarding body: {n(a.awarding_body)}
                  </p>
                  <EvidenceList items={a.evidence} onEvidenceClick={setSelectedEvidence} getStatus={getStatus} />
                </div>
              ))}
            </div>
          )}

          <h4 className="mt-6 text-lg font-semibold text-ink/80">Funding</h4>
          {funding.length === 0 ? (
            <p className="mt-2 text-sm text-ink/75">{emptyText}</p>
          ) : (
            <div className="mt-2">
              {funding.map((f, i) => (
                <div key={i} className="mt-4 border-t border-ink/[0.09] pt-4 first:mt-0 first:border-t-0 first:pt-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{f.project_name}</span>
                    <span className="rounded bg-ink/10 px-1.5 py-0.5 text-xs text-ink/75">
                      {fundingRoleLabel[f.role]}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-ink/75">
                    Funder: {n(f.funder)} · {dateRange(f.start_date, f.end_date)}
                  </p>
                  {f.amount != null && (
                    <p className="text-sm text-ink/75">
                      Amount: {f.amount.toLocaleString()} {f.currency ?? ""}
                    </p>
                  )}
                  <EvidenceList items={f.evidence} onEvidenceClick={setSelectedEvidence} getStatus={getStatus} />
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* 4. 论文与影响 */}
        <Section title="Publications & Impact" hidden={activeSection !== "pubs"} delay={0.25} className="lg:col-span-7">
          <p className="text-sm text-ink/75">
            Total citations: {c.publications_impact.total_citations ?? "—"}
            {c.publications_impact.citation_query_date
              ? ` (queried: ${c.publications_impact.citation_query_date})`
              : ""}
          </p>

          {publications.length === 0 ? (
            <p className="mt-2 text-sm text-ink/75">{emptyText}</p>
          ) : (
            <div className="mt-3">
              {publications.map((p, i) => (
                <div key={i} className="mt-4 border-t border-ink/[0.09] pt-4 first:mt-0 first:border-t-0 first:pt-0">
                  <p className="font-semibold">{p.title}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink/75">
                    {p.year != null && <span>{p.year}</span>}
                    <span>{authorRoleLabel[p.author_role]}</span>
                    <span>{n(p.venue)}</span>
                    <span className="rounded bg-ink/10 px-1.5 py-0.5 text-xs text-ink/75">
                      {venueTypeLabel[p.venue_type]}
                    </span>
                    {p.ranking && (
                      <span className="rounded bg-ink/10 px-1.5 py-0.5 text-xs text-ink/75">
                        {p.ranking}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-ink/75">
                    {p.citation_count != null && <span>Citations: {p.citation_count}</span>}
                    {p.code_repository && (
                      <a
                        href={p.code_repository}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent hover:underline"
                      >
                        Code repository ↗
                      </a>
                    )}
                    {p.repository_stars != null && <span>Stars: {p.repository_stars}</span>}
                  </div>
                  <EvidenceList items={p.evidence} onEvidenceClick={setSelectedEvidence} getStatus={getStatus} />
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* 5. 学术服务 */}
        <Section title="Academic Service" hidden={activeSection !== "service"} delay={0.3} className="lg:col-span-5">
          {services.length === 0 ? (
            <p className="text-sm text-ink/75">{emptyText}</p>
          ) : (
            <div>
              {services.map((s, i) => (
                <div key={i} className="mt-4 border-t border-ink/[0.09] pt-4 first:mt-0 first:border-t-0 first:pt-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{s.organization_or_venue}</span>
                    <span className="rounded bg-ink/10 px-1.5 py-0.5 text-xs text-ink/75">
                      {serviceTypeLabel[s.service_type]}
                    </span>
                    {s.role && <span className="text-sm text-ink/75">{s.role}</span>}
                  </div>
                  <p className="mt-1 text-sm text-ink/75">
                    {s.start_year ?? "?"} ~ {s.end_year ?? "Present"}
                  </p>
                  {s.research_areas.length > 0 && (
                    <p className="mt-1 text-sm text-ink/75">
                      Areas: {s.research_areas.join(", ")}
                    </p>
                  )}
                  <EvidenceList items={s.evidence} onEvidenceClick={setSelectedEvidence} getStatus={getStatus} />
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* 6. 综合评价 */}
        <Section title="Overall Evaluation" hidden={activeSection !== "eval"} delay={0.35} className="lg:col-span-7">
          <p className="text-sm text-ink/75">{n(c.overall_evaluation.summary)}</p>
          <BulletList label="Strengths" items={evalStrengths} />
          <BulletList label="Risks" items={evalRisks} tone="warn" />

          {dimensions.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-medium text-ink/75">Dimension evaluations</p>
              <div className="mt-2">
                {dimensions.map((d, i) => (
                  <div key={i} className="mt-4 border-t border-ink/[0.09] pt-4 first:mt-0 first:border-t-0 first:pt-0">
                    <p className="font-semibold">{d.dimension}</p>
                    <p className="mt-1 text-sm text-ink/75">{d.assessment}</p>
                    <EvidenceList items={d.evidence} onEvidenceClick={setSelectedEvidence} getStatus={getStatus} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </Section>
        </div>

        {/* AI Q&A（内联显示，随页面滚动） */}
        <Section title="AI Q&A" id="section-qa" delay={0.4}>
          <div className="flex gap-2">
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                // 输入法(IME)组合输入期间按 Enter 只是确认候选词/上屏,不应提交问题
                const native = e.nativeEvent as KeyboardEvent;
                const composing = native.isComposing || native.keyCode === 229;
                if (e.key === "Enter" && !composing) void handleAsk();
              }}
              placeholder="Ask a question about this candidate…"
              className="min-w-0 flex-1 rounded-lg border border-ink/10 bg-ink/[0.05] px-3 py-2 text-sm text-ink/90 outline-none placeholder:text-ink/75 focus:border-accent/50"
            />
            <button
              onClick={handleAsk}
              disabled={qaLoading || !question.trim()}
              className="rounded-lg bg-accent px-4 py-2 text-sm text-white transition-opacity disabled:opacity-75"
            >
              {qaLoading ? "Thinking…" : "Ask"}
            </button>
          </div>

          {qaError && <p className="mt-3 text-sm text-rose-800">{qaError}</p>}

          {qaResult && (
            <div className="mt-4 border-l-2 border-accent/40 pl-4">
              <div className="flex items-center gap-2">
                <span className="font-medium">Answer</span>
                <span className="rounded bg-ink/10 px-1.5 py-0.5 text-xs text-ink/75">
                  Confidence: {qaResult.confidence}
                </span>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-ink/80">{qaResult.answer}</p>
              {qaResult.evidence.length > 0 && (
                <>
                  <p className="mt-3 text-xs font-medium text-ink/75">Supporting evidence</p>
                  <EvidenceList
                    items={qaResult.evidence}
                    onEvidenceClick={setSelectedEvidence}
                    getStatus={getStatus}
                  />
                </>
              )}
            </div>
          )}

          {qaHistory.length > 0 && (
            <div className="mt-6">
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-ink/75">
                History
              </p>
              <div className="mt-2">
                {qaHistory.map((item) => (
                  <div
                    key={item.id}
                    className="mt-3 border-t border-ink/[0.08] pt-3 first:mt-0 first:border-t-0 first:pt-0"
                  >
                    <p className="font-medium text-ink/85">Q: {item.question}</p>
                    <p className="mt-1 text-sm leading-relaxed text-ink/75">
                      A: {item.answer}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Section>

      </main>

      {overviewOpen && c && assessment && (
        <PlanetOverview
          candidate={c}
          assessment={assessment}
          interviewScore={currentArchiveEntry?.interviewScore ?? null}
          interviewProfileId={profileId}
          initialSelected={overviewSelect}
          onClose={() => setOverviewOpen(false)}
          onEvidenceClick={setSelectedEvidence}
          getStatus={getStatus}
          scoreLoading={scoreLoading}
        />
      )}

      <EvidenceModal
        evidence={selectedEvidence}
        onClose={() => setSelectedEvidence(null)}
        onCorrect={correctEvidence}
        getStatus={getStatus}
      />

    </div>
  );
}
