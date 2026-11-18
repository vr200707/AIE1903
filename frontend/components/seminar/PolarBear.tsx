"use client";

import { useEffect, useRef, useState } from "react";
import { useUiLang, setUiLang } from "@/components/IntroOverlay";

/** 每个工作流步骤对应的引导提示（中英双语，跟随全局语言偏好） */
const TIPS: Record<"en" | "zh", string[]> = {
  en: [
    "Pick a saved candidate profile and give this seminar session a title.",
    "Choose the required speaker recording and an optional screen recording, then click Submit recordings.",
    "Adjust the offset until both recordings show the same moment, then confirm.",
    "Split the talk into logical parts. Whisper transcription or SRT/VTT import can build the timeline for you.",
    "Choose the parts to scan — vision AI reviews the available recordings and saves evidence frames in the background.",
    "Play the synced evidence, then mark each observation Confirmed, Inaccurate or Cannot determine.",
  ],
  zh: [
    "选择一个已保存的候选人档案，并为本次研讨会填写标题。",
    "选择必填的演讲者录像和选填的屏幕录像，然后点击 Submit recordings 提交。",
    "调整时间偏移，直到两路录像显示同一时刻，然后确认对齐。",
    "把演讲拆成逻辑段落；可用 Whisper 转写或导入 SRT/VTT 字幕自动生成时间线。",
    "勾选要扫描的段落——视觉 AI 会同时观察两个视角，并在后台保存证据帧。",
    "播放同步证据，然后把每条观察标记为确认、不准确或无法判断。",
  ],
};

const WORKING_TIP = {
  en: "AI analysis is running in the background — you can still move between steps while it works.",
  zh: "AI 正在后台分析中——这段时间你仍然可以在各步骤之间切换操作。",
};

const CHEER_TIP = {
  en: "Nice work! One step closer to the full review — well done!",
  zh: "做得好！离完整复核又近了一步，继续加油！",
};

const LANG_HINT = {
  en: "Click the bear to switch language — your choice is saved as the default.",
  zh: "点击北极熊即可切换语言，选择会自动保存为默认语言。",
};

const LANG_LABEL = { en: "EN", zh: "中文" } as const;

/** 瞳孔在眼白内可移动的最大屏幕像素距离 */
const MAX_PUPIL_PX = 3.5;
/** 眼白半径（SVG 用户单位），用于把屏幕像素换算成 SVG 位移 */
const EYE_R_USER = 9.5;
/** 庆祝动画总时长（与 CSS .bear-jump 的 1.15s × 2 对齐） */
const CHEER_MS = 2400;

type Mood = "idle" | "working" | "celebrating";

/**
 * 右侧北极熊向导：
 * - 待机时身体摇摆、呼吸、眨眼，瞳孔随鼠标光标移动（不越出眼白）
 * - 分析进行中变为专注表情并流汗
 * - 关键任务成功时举手跳跃，切换为开心表情
 */
export default function PolarBear({
  step,
  stepTitle,
  position = step,
  total = 6,
  working = false,
  celebrate = 0,
}: {
  step: number;
  stepTitle: string;
  position?: number;
  total?: number;
  working?: boolean;
  /** 每次递增该值即触发一次庆祝跳跃 */
  celebrate?: number;
}) {
  const eyeRefs = useRef<(SVGCircleElement | null)[]>([]);
  const pupilRefs = useRef<(SVGGElement | null)[]>([]);
  const [bubbleOpen, setBubbleOpen] = useState(true);
  const lang = useUiLang();
  // 已结束庆祝的信号值：渲染期推导是否正在庆祝，effect 只负责定时回置（避免 effect 内同步 setState）
  const [settledNonce, setSettledNonce] = useState(0);
  const cheering = celebrate > settledNonce;
  useEffect(() => {
    if (!cheering) return;
    const timer = window.setTimeout(() => setSettledNonce(celebrate), CHEER_MS);
    return () => window.clearTimeout(timer);
  }, [celebrate, cheering]);

  const mood: Mood = cheering ? "celebrating" : working ? "working" : "idle";

  // 瞳孔跟随鼠标：按眼球中心向量裁剪位移半径
  useEffect(() => {
    let raf = 0;
    const onMove = (e: MouseEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        eyeRefs.current.forEach((eye, i) => {
          const pupil = pupilRefs.current[i];
          if (!eye || !pupil) return;
          const rect = eye.getBoundingClientRect();
          const cx = rect.left + rect.width / 2;
          const cy = rect.top + rect.height / 2;
          const dx = e.clientX - cx;
          const dy = e.clientY - cy;
          const dist = Math.hypot(dx, dy) || 1;
          const moved = Math.min(dist, MAX_PUPIL_PX);
          // 屏幕像素 → SVG 用户单位，保证不同缩放下瞳孔都不越过眼白
          const scale = (EYE_R_USER * 2) / rect.width;
          const tx = (dx / dist) * moved * scale;
          const ty = (dy / dist) * moved * scale;
          pupil.setAttribute("transform", `translate(${tx.toFixed(2)} ${ty.toFixed(2)})`);
        });
      });
    };
    window.addEventListener("mousemove", onMove);
    return () => {
      window.removeEventListener("mousemove", onMove);
      cancelAnimationFrame(raf);
    };
  }, []);

  const tipText = cheering
    ? CHEER_TIP[lang]
    : working
      ? WORKING_TIP[lang]
      : TIPS[lang][step] ?? TIPS[lang][0];

  // 点击北极熊：中英切换并写入共享偏好（持久化为默认语言，全站双语组件同步刷新）
  const toggleLang = () => setUiLang(lang === "zh" ? "en" : "zh");
  const bearAriaLabel =
    lang === "zh" ? "切换为英文（并设为默认语言）" : "Switch to Chinese (saved as default)";

  return (
    <aside
      aria-label="Seminar guide"
      className="fixed bottom-5 right-5 z-30 hidden w-64 flex-col items-end lg:flex xl:w-72"
    >
      {bubbleOpen ? (
        <div className="pointer-events-auto relative mb-3 w-full rounded-2xl border border-ink/15 bg-white p-4 shadow-xl">
          <button
            type="button"
            onClick={() => setBubbleOpen(false)}
            aria-label="Hide tip"
            className="absolute right-2.5 top-2.5 flex h-6 w-6 items-center justify-center rounded-full text-ink/50 transition hover:bg-ink/5 hover:text-ink"
          >
            ×
          </button>
          <p className="text-xs font-semibold uppercase tracking-wider text-accent">
            {lang === "zh" ? `第 ${position + 1}/${total} 步` : `Step ${position + 1}/${total}`} · {stepTitle}
          </p>
          <p className="mt-2 pr-6 text-sm leading-6 text-ink/80">{tipText}</p>
          <p className="mt-2.5 flex items-center gap-1.5 border-t border-ink/10 pt-2.5 text-xs leading-5 text-accent-deep">
            <span aria-hidden="true" className="grid h-4.5 w-4.5 shrink-0 place-items-center rounded-full bg-accent/12 text-[10px] font-bold">
              {LANG_LABEL[lang]}
            </span>
            {LANG_HINT[lang]}
          </p>
          <span className="absolute -bottom-2 right-12 h-4 w-4 rotate-45 border-b border-r border-ink/15 bg-white" />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setBubbleOpen(true)}
          className="pointer-events-auto mb-3 rounded-full border border-ink/15 bg-white px-4 py-2 text-sm shadow-lg transition hover:border-accent/50 hover:text-accent"
        >
          {lang === "zh" ? "提示 ?" : "Tips ?"}
        </button>
      )}

      {/* 当前语言指示药丸：与点击熊身等效，便于发现可点击切换 */}
      <button
        type="button"
        onClick={toggleLang}
        title={bearAriaLabel}
        aria-label={bearAriaLabel}
        className="pointer-events-auto mb-2 flex items-center gap-1.5 rounded-full border border-accent/30 bg-white/90 px-3 py-1.5 text-xs font-semibold text-accent-deep shadow-lg backdrop-blur transition hover:border-accent/60 hover:bg-accent/[0.08]"
      >
        <span aria-hidden="true">🌐</span>
        {LANG_LABEL[lang]}
        <span className="font-normal text-ink/55">· {lang === "zh" ? "点击切换 EN" : "Tap for 中文"}</span>
      </button>

      <button
        type="button"
        onClick={toggleLang}
        title={bearAriaLabel}
        aria-label={bearAriaLabel}
        className="pointer-events-auto block cursor-pointer rounded-full border-0 bg-transparent p-0 transition-transform duration-300 hover:scale-[1.03] active:scale-95"
      >
      <svg
        viewBox="0 0 220 250"
        className={`w-44 drop-shadow-xl xl:w-52 bear-svg ${
          mood === "celebrating" ? "bear-celebrate" : mood === "working" ? "bear-working" : ""
        }`}
        role="img"
        aria-label="Cute polar bear guide whose eyes follow your cursor"
      >
        <defs>
          <radialGradient id="bearFur" cx="42%" cy="28%" r="85%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="65%" stopColor="#f3f9fd" />
            <stop offset="100%" stopColor="#dceaf4" />
          </radialGradient>
          <radialGradient id="bearBelly" cx="50%" cy="35%" r="80%">
            <stop offset="0%" stopColor="#f4f9fd" />
            <stop offset="100%" stopColor="#dceaf4" />
          </radialGradient>
          <linearGradient id="bearScarf" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#357895" />
            <stop offset="100%" stopColor="#1f5871" />
          </linearGradient>
        </defs>

        {/* 地面阴影（跳跃时同步收缩） */}
        <ellipse className="bear-shadow" cx="110" cy="234" rx="72" ry="10" fill="rgba(22,50,74,0.12)" />

        {/* 外层：庆祝跳跃；内层：待机摇摆 —— 分层避免 transform 互相覆盖。
            类名常驻，动画由父级 .bear-celebrate 门控，确保每次庆祝都重新触发 */}
        <g className="bear-jump">
          <g className="bear-idle">
            <g className="bear-breathe">
              {/* 小尾巴 */}
              <circle cx="172" cy="150" r="10" fill="url(#bearFur)" stroke="#cfdfec" strokeWidth="1.5" />
              {/* 手臂 */}
              <ellipse className="bear-arm bear-arm-l" cx="52" cy="170" rx="13" ry="26" fill="url(#bearFur)" stroke="#cfdfec" strokeWidth="2" />
              <ellipse className="bear-arm bear-arm-r" cx="168" cy="170" rx="13" ry="26" fill="url(#bearFur)" stroke="#cfdfec" strokeWidth="2" />
              {/* 身体 */}
              <ellipse cx="110" cy="176" rx="64" ry="56" fill="url(#bearFur)" stroke="#cddfed" strokeWidth="2" />
              <ellipse cx="110" cy="190" rx="38" ry="36" fill="url(#bearBelly)" />
              {/* 脚掌与爪垫 */}
              <ellipse cx="76" cy="220" rx="20" ry="13" fill="url(#bearFur)" stroke="#cddfed" strokeWidth="2" />
              <ellipse cx="144" cy="220" rx="20" ry="13" fill="url(#bearFur)" stroke="#cddfed" strokeWidth="2" />
              <ellipse cx="76" cy="222" rx="9" ry="6" fill="#d3e4f0" />
              <ellipse cx="144" cy="222" rx="9" ry="6" fill="#d3e4f0" />
              {/* 围巾 */}
              <path d="M46 140 Q110 162 174 140 L174 154 Q110 176 46 154 Z" fill="url(#bearScarf)" />
              <path d="M148 150 L172 156 L164 192 L146 186 Z" fill="#1f5871" />
              <path d="M150 158 L168 163 M149 170 L166 175 M148 182 L163 187" stroke="#6ba3bf" strokeWidth="1.5" strokeLinecap="round" />
              {/* 耳朵 */}
              <circle cx="70" cy="50" r="15" fill="url(#bearFur)" stroke="#cddfed" strokeWidth="2" />
              <circle cx="150" cy="50" r="15" fill="url(#bearFur)" stroke="#cddfed" strokeWidth="2" />
              <circle cx="70" cy="51" r="8" fill="#d3e4f0" />
              <circle cx="150" cy="51" r="8" fill="#d3e4f0" />
              {/* 头 */}
              <circle cx="110" cy="92" r="54" fill="url(#bearFur)" stroke="#cddfed" strokeWidth="2" />
              {/* 腮红 */}
              <circle cx="70" cy="108" r="7" fill="#f4d9e2" opacity="0.75" />
              <circle cx="150" cy="108" r="7" fill="#f4d9e2" opacity="0.75" />

              {/* 普通眼睛（眼白 + 可动瞳孔 + 眨眼眼睑） */}
              <g className="bear-eye-normal">
                <circle
                  ref={(el) => {
                    eyeRefs.current[0] = el;
                  }}
                  cx="90"
                  cy="86"
                  r={EYE_R_USER}
                  fill="#ffffff"
                  stroke="#b9d0e0"
                  strokeWidth="1.5"
                />
                <circle
                  ref={(el) => {
                    eyeRefs.current[1] = el;
                  }}
                  cx="130"
                  cy="86"
                  r={EYE_R_USER}
                  fill="#ffffff"
                  stroke="#b9d0e0"
                  strokeWidth="1.5"
                />
                <g
                  ref={(el) => {
                    pupilRefs.current[0] = el;
                  }}
                >
                  <circle cx="90" cy="86" r="5" fill="#16324a" />
                  <circle cx="88.2" cy="84.2" r="1.7" fill="#ffffff" />
                </g>
                <g
                  ref={(el) => {
                    pupilRefs.current[1] = el;
                  }}
                >
                  <circle cx="130" cy="86" r="5" fill="#16324a" />
                  <circle cx="128.2" cy="84.2" r="1.7" fill="#ffffff" />
                </g>
                {/* 眼睑：与头部同色，周期性 scaleY 实现眨眼 */}
                <ellipse className="bear-eyelid" cx="90" cy="86" rx="9.5" ry="9.5" fill="#f3f9fd" />
                <ellipse className="bear-eyelid delay" cx="130" cy="86" rx="9.5" ry="9.5" fill="#f3f9fd" />
              </g>

              {/* 庆祝时的弯弯笑眼 ^_^ */}
              <g className="bear-eye-happy" stroke="#16324a" strokeWidth="2.6" fill="none" strokeLinecap="round">
                <path d="M81 87 Q90 79 99 87" />
                <path d="M121 87 Q130 79 139 87" />
              </g>

              {/* 工作时的汗滴 */}
              <path
                className="bear-sweat"
                d="M160 62 q5 7 0 11 q-5 -4 0 -11 Z"
                fill="#7fb6d4"
                stroke="#5d9bbd"
                strokeWidth="1"
              />

              {/* 口鼻区 */}
              <ellipse cx="110" cy="113" rx="27" ry="21" fill="#e6f1f8" stroke="#d3e2ee" strokeWidth="1.5" />
              <ellipse cx="110" cy="101" rx="7.5" ry="5.5" fill="#16324a" />
              <ellipse cx="107.5" cy="99.2" rx="2.2" ry="1.4" fill="rgba(255,255,255,0.55)" />
              <path className="bear-mouth-normal" d="M110 106.5 L110 114 M110 114 Q103 120 98 115 M110 114 Q117 120 122 115" stroke="#16324a" strokeWidth="2" fill="none" strokeLinecap="round" />
              <path className="bear-mouth-working" d="M101 116 Q110 113 119 116" stroke="#16324a" strokeWidth="2" fill="none" strokeLinecap="round" />
              {/* 庆祝时张开的开心嘴 */}
              <g className="bear-mouth-happy">
                <path d="M99 111 Q110 128 121 111 Q110 117 99 111 Z" fill="#16324a" />
                <path d="M104 120 Q110 125 116 120 Q110 123 104 120 Z" fill="#e88aa0" />
              </g>
            </g>
          </g>
        </g>
      </svg>
      </button>
    </aside>
  );
}
