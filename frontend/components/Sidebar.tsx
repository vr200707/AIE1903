"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useIdentity } from "./IdentityProvider";
import { useArchive } from "./ArchiveProvider";
import { ArchiveFolder } from "./ArchiveFolder";
import { useQaHistory } from "./QaHistoryProvider";
import {
  clearAllInterviewSessions,
  clearInterviewSession,
} from "@/lib/interview";

const NAV = [
  {
    href: "/",
    label: "Profile",
    icon: (
      <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="8" cy="5" r="2.6" />
        <path d="M2.8 13.4c.6-2.6 2.7-4 5.2-4s4.6 1.4 5.2 4" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    href: "/methodology",
    label: "Methodology",
    icon: (
      <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M3 2.6h7.2L13 5.4v8H3z" strokeLinejoin="round" />
        <path d="M5.4 8h5.2M5.4 10.6h5.2" strokeLinecap="round" />
      </svg>
    ),
  },
];

/** 左侧导航栏：品牌区 + 页面导航 + 底部身份位。玻璃质感，与背景同色。 */
export default function Sidebar() {
  const pathname = usePathname();
  const { identity } = useIdentity();
  const {
    archives,
    openArchive,
    openInterviewOverview,
    removeArchive,
    clearArchives,
  } = useArchive();
  const { history: qaHistory, clearHistory: clearQaHistory } = useQaHistory();
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [expandedQa, setExpandedQa] = useState<string | null>(null);
  const [mobileArchiveOpen, setMobileArchiveOpen] = useState(false);
  const initials = (identity?.name ?? "AIE")
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

  const removeFromHistory = (id: string, profileId: string) => {
    removeArchive(id);
    clearInterviewSession(profileId);
  };

  const clearHistory = () => {
    clearAllInterviewSessions();
    clearArchives();
    setClearConfirmOpen(false);
    setMobileArchiveOpen(false);
  };

  const archiveItems = (
    onOpen: (id: string) => void,
    onInterview: (id: string) => void,
  ) =>
    archives.length === 0 ? (
      <p className="px-2 py-6 text-center text-xs leading-relaxed text-ink/75">
        No archives yet
        <br />
        Saved automatically after analysis
      </p>
    ) : (
      archives.map((entry) => (
        <ArchiveFolder
          key={entry.id}
          entry={entry}
          onClick={() => onOpen(entry.id)}
          onOpenInterview={
            entry.interviewScore ? () => onInterview(entry.id) : undefined
          }
          onDelete={() => removeFromHistory(entry.id, entry.profileId)}
        />
      ))
    );

  const showInterviewScore = (id: string) => {
    setMobileArchiveOpen(false);
    openInterviewOverview(id);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setMobileArchiveOpen(true)}
        className="fixed right-4 top-4 z-30 flex items-center gap-2 rounded-full border border-ink/15 bg-[#eaf1f6]/95 px-3.5 py-2 text-xs text-ink/80 shadow-lg backdrop-blur-xl transition hover:border-accent/40 hover:text-ink lg:hidden"
        aria-label="Open archive"
      >
        <svg
          viewBox="0 0 16 16"
          className="h-4 w-4 text-accent"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path d="M2 3.5h5l1.2 1.7H14v7.3H2z" strokeLinejoin="round" />
        </svg>
        Archive
        <span className="rounded-full bg-ink/10 px-1.5 py-0.5 tabular-nums">
          {archives.length}
        </span>
      </button>

      {mobileArchiveOpen && (
        <div
          className="fixed inset-0 z-40 bg-background/65 backdrop-blur-sm lg:hidden"
          role="presentation"
          onClick={() => setMobileArchiveOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="mobile-archive-title"
            className="absolute inset-y-0 right-0 flex w-[min(88vw,360px)] flex-col border-l border-ink/12 bg-[#eaf1f6] p-4 text-ink shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-ink/10 pb-3">
              <div>
                <h2 id="mobile-archive-title" className="font-display text-lg text-ink">
                  Archive
                </h2>
                <p className="mt-0.5 text-[11px] text-ink/75">
                  Use the folder action to remove a saved profile
                </p>
              </div>
              <button
                type="button"
                onClick={() => setMobileArchiveOpen(false)}
                className="grid h-8 w-8 place-items-center rounded-full border border-ink/10 text-ink/75 transition hover:bg-ink/10 hover:text-ink"
                aria-label="Close archive"
              >
                ✕
              </button>
            </div>
            {archives.length > 0 && (
              <button
                type="button"
                onClick={() => setClearConfirmOpen(true)}
                className="mt-3 self-end rounded-full border border-rose-300/35 px-3 py-1 text-[11px] text-rose-800 transition hover:bg-rose-400/10"
              >
                Clear all
              </button>
            )}
            <div className="mt-3 flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto">
              {archiveItems(
                (id) => {
                  setMobileArchiveOpen(false);
                  openArchive(id);
                },
                showInterviewScore,
              )}
            </div>
          </div>
        </div>
      )}

    <aside className="sticky top-0 z-20 hidden h-screen w-[220px] shrink-0 flex-col border-r border-ink/[0.07] bg-ink/[0.03] px-4 py-6 backdrop-blur-2xl lg:flex">
      {/* 品牌区 */}
      <Link href="/" className="mb-9 flex items-center gap-2.5 px-2">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent/15 text-sm text-accent ring-1 ring-accent/25">
          ✦
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-ink">
            Candidate Profile
          </span>
          <span className="block truncate text-xs text-ink/75">AIE1903 · v2.0</span>
        </span>
      </Link>

      {/* 导航 */}
      <nav className="flex flex-col gap-1">
        {NAV.map((item) => {
          const active =
            item.href === "/"
              ? pathname === "/" || pathname.startsWith("/interview")
              : pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors duration-200 ${
                active
                  ? "bg-ink/[0.08] text-ink"
                  : "text-ink/75 hover:bg-ink/[0.05] hover:text-ink/80"
              }`}
            >
              <span className={active ? "text-accent" : "text-ink/75"}>
                {item.icon}
              </span>
              {item.label}
              {active && (
                <span className="ml-auto h-1.5 w-1.5 rounded-full bg-accent" />
              )}
            </Link>
          );
        })}
      </nav>

      {/* 档案库：所有分析完成的 CV */}
      <div className="mt-6 flex min-h-0 flex-1 flex-col">
        <div className="mb-2 flex shrink-0 items-center justify-between px-2">
          <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-ink/75">
            Archive
          </span>
          <span className="flex items-center gap-2">
            {archives.length > 0 && (
              <button
                type="button"
                onClick={() => setClearConfirmOpen(true)}
                className="rounded-md px-2 py-1 text-sm text-ink/75 transition hover:bg-rose-400/10 hover:text-rose-800"
              >
                Clear
              </button>
            )}
            <span className="text-[11px] tabular-nums text-ink/75">
              {archives.length}
            </span>
          </span>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto pr-0.5">
          {archiveItems(openArchive, showInterviewScore)}
        </div>
      </div>

      {/* AI Q&A 历史 */}
      <div className="mt-4 shrink-0">
        <div className="mb-2 flex items-center justify-between px-2">
          <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-ink/75">
            AI Q&A
          </span>
          {qaHistory.length > 0 && (
            <button
              type="button"
              onClick={clearQaHistory}
              className="rounded-md px-2 py-1 text-sm text-ink/75 transition hover:bg-rose-400/10 hover:text-rose-800"
            >
              Clear
            </button>
          )}
        </div>
        {qaHistory.length === 0 ? (
          <p className="px-2 py-2 text-center text-xs text-ink/75">
            No questions yet
          </p>
        ) : (
          <div className="max-h-40 overflow-y-auto pr-0.5">
            {qaHistory.map((item) => (
              <div key={item.id} className="mb-1.5">
                <button
                  type="button"
                  onClick={() =>
                    setExpandedQa(expandedQa === item.id ? null : item.id)
                  }
                  className="w-full rounded-lg border border-ink/10 bg-ink/[0.03] px-2.5 py-2 text-left text-xs text-ink/80 transition hover:bg-ink/[0.06]"
                >
                  {item.question}
                </button>
                {expandedQa === item.id && (
                  <div className="mt-1 rounded-lg border-l-2 border-accent/40 bg-ink/[0.03] px-2.5 py-2 text-xs leading-relaxed text-ink/75">
                    {item.answer}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 底部身份位 */}
      <div className="mt-auto flex items-center gap-3 border-t border-ink/[0.07] px-2 pt-4">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-accent to-accent-deep text-sm font-medium text-white">
          {initials}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm text-ink/85">
            {identity?.name ?? "No candidate"}
          </span>
          <span className="block truncate text-xs text-ink/75">
            {identity?.detail ?? "Upload to analyse"}
          </span>
        </span>
      </div>

      {clearConfirmOpen && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-background/60 p-4"
          role="presentation"
          onClick={() => setClearConfirmOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="clear-history-title"
            className="w-full max-w-sm rounded-2xl border border-ink/12 bg-[#eaf1f6] p-5 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="text-[10px] uppercase tracking-[0.2em] text-rose-800">
              Archive history
            </p>
            <h2 id="clear-history-title" className="mt-2 font-display text-2xl text-ink/90">
              Clear all profile history?
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-ink/75">
              This removes all locally saved candidate profiles and their interview
              workspace links from this browser. Server-side data is not changed.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setClearConfirmOpen(false)}
                className="rounded-full border border-ink/10 px-4 py-2 text-xs text-ink/75 transition hover:text-ink"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={clearHistory}
                className="rounded-full bg-rose-400/15 px-4 py-2 text-xs text-rose-800 transition hover:bg-rose-400/25"
              >
                Clear history
              </button>
            </div>
          </div>
        </div>
      )}

    </aside>
    </>
  );
}
