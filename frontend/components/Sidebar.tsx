"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useIdentity } from "./IdentityProvider";
import { useArchive } from "./ArchiveProvider";
import { ArchiveFolder } from "./ArchiveFolder";
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
  const { archives, openArchive, removeArchive, clearArchives } = useArchive();
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
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
  };

  return (
    <aside className="sticky top-0 z-20 hidden h-screen w-[220px] shrink-0 flex-col border-r border-white/[0.07] bg-white/[0.03] px-4 py-6 backdrop-blur-2xl lg:flex">
      {/* 品牌区 */}
      <Link href="/" className="mb-9 flex items-center gap-2.5 px-2">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent/15 text-sm text-accent ring-1 ring-accent/25">
          ✦
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-white">
            Candidate Profile
          </span>
          <span className="block truncate text-xs text-white/35">AIE1903 · v2.0</span>
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
                  ? "bg-white/[0.08] text-white"
                  : "text-white/45 hover:bg-white/[0.05] hover:text-white/80"
              }`}
            >
              <span className={active ? "text-accent" : "text-white/35"}>
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
          <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-white/35">
            档案库 Archive
          </span>
          <span className="flex items-center gap-2">
            {archives.length > 0 && (
              <button
                type="button"
                onClick={() => setClearConfirmOpen(true)}
                className="text-[10px] text-white/25 transition hover:text-rose-200"
              >
                Clear
              </button>
            )}
            <span className="text-[11px] tabular-nums text-white/25">
              {archives.length}
            </span>
          </span>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto pr-0.5">
          {archives.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs leading-relaxed text-white/30">
              暂无档案
              <br />
              分析完成后自动存档
            </p>
          ) : (
            archives.map((entry) => (
              <ArchiveFolder
                key={entry.id}
                entry={entry}
                onClick={() => openArchive(entry.id)}
                onDelete={() => removeFromHistory(entry.id, entry.profileId)}
              />
            ))
          )}
        </div>
      </div>

      {/* 说明位 */}
      <div className="mt-4 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-3">
        <p className="text-xs leading-relaxed text-white/40">
          Every field in this profile links back to a verifiable source.
        </p>
      </div>

      {/* 底部身份位 */}
      <div className="mt-auto flex items-center gap-3 border-t border-white/[0.07] px-2 pt-4">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-accent/70 to-accent-deep text-sm font-medium text-black">
          {initials}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm text-white/85">
            {identity?.name ?? "No candidate"}
          </span>
          <span className="block truncate text-xs text-white/35">
            {identity?.detail ?? "Upload to analyse"}
          </span>
        </span>
      </div>

      {clearConfirmOpen && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
          role="presentation"
          onClick={() => setClearConfirmOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="clear-history-title"
            className="w-full max-w-sm rounded-2xl border border-white/12 bg-[#090d20] p-5 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="text-[10px] uppercase tracking-[0.2em] text-rose-200/55">
              Archive history
            </p>
            <h2 id="clear-history-title" className="mt-2 font-display text-2xl text-white/90">
              Clear all profile history?
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-white/45">
              This removes all locally saved candidate profiles and their interview
              workspace links from this browser. Server-side data is not changed.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setClearConfirmOpen(false)}
                className="rounded-full border border-white/10 px-4 py-2 text-xs text-white/55 transition hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={clearHistory}
                className="rounded-full bg-rose-400/15 px-4 py-2 text-xs text-rose-200 transition hover:bg-rose-400/25"
              >
                Clear history
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
