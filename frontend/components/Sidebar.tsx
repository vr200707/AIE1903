"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useIdentity } from "./IdentityProvider";

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
  const initials = (identity?.name ?? "AIE")
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

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
          const active = pathname === item.href;
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

      {/* 说明位 */}
      <div className="mt-8 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-3">
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
    </aside>
  );
}