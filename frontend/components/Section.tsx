"use client";

import { useState, type ReactNode } from "react";

// 模块装饰图：AI 生成的暗色线稿，融进玻璃卡片右上角
export function sectionArt(prompt: string): string {
  return `https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=${encodeURIComponent(
    prompt,
  )}&image_size=square`;
}

// 区块：玻璃面板 + 暖橙强调条 + 右上角装饰图。
// 注意：进场动效必须放在内层——filter 会成为 backdrop root，
// 与外层的 backdrop-filter 冲突导致毛玻璃失效。
export function Section({
  title,
  hidden,
  delay = 0,
  art,
  collapsible = true,
  className = "",
  id,
  children,
}: {
  title: string;
  hidden?: boolean;
  delay?: number;
  art?: string;
  collapsible?: boolean;
  className?: string;
  id?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);

  if (hidden) return null;

  return (
    <section
      id={id}
      className={`glass rounded-2xl transition-all duration-300 hover:bg-ink/[0.08] hover:shadow-[0_22px_44px_-26px_rgba(22, 50, 74,0.42)] ${className}`}
    >
      {art && open && (
        <img
          src={art}
          alt=""
          aria-hidden="true"
          className="animate-drift-in pointer-events-none absolute right-4 top-4 h-24 w-24 rounded-2xl object-cover opacity-40 mix-blend-luminosity"
          style={{
            maskImage:
              "radial-gradient(circle at 62% 38%, #000 30%, rgba(0,0,0,0.35) 58%, transparent 78%)",
            WebkitMaskImage:
              "radial-gradient(circle at 62% 38%, #000 30%, rgba(0,0,0,0.35) 58%, transparent 78%)",
          }}
        />
      )}
      <div className="relative">
        <button
          type="button"
          onClick={() => collapsible && setOpen((v) => !v)}
          aria-expanded={!collapsible ? true : open}
          aria-controls={`section-${title.replace(/\W+/g, "-").toLowerCase()}`}
          className={`flex w-full items-center gap-3 px-7 pt-6 text-left ${
            open ? "pr-28 pb-0" : "pr-7 pb-6"
          }`}
        >
          <span className="h-6 w-1 shrink-0 rounded-full bg-accent" />
          <h2 className="flex-1 text-2xl font-medium tracking-tight text-ink">
            {title}
          </h2>
          {collapsible && (
            <span
              className={`grid h-7 w-7 shrink-0 place-items-center rounded-full border border-ink/10 bg-ink/5 text-ink/60 transition-transform duration-300 ${
                open ? "rotate-0" : "-rotate-90"
              }`}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <path
                  d="M2.5 4.5L7 9l4.5-4.5"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          )}
        </button>
        {open && (
          <div
            id={`section-${title.replace(/\W+/g, "-").toLowerCase()}`}
            className="animate-pop p-7 pt-6"
            style={{ animationDelay: `${delay}s` }}
          >
            {children}
          </div>
        )}
      </div>
    </section>
  );
}
