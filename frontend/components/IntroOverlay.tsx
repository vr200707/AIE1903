"use client";
/* 开场背景为远程图片资源，不使用 next/image 优化 */
/* eslint-disable @next/next/no-img-element */

import { useEffect, useSyncExternalStore } from "react";
import { HERO_IMAGE } from "./Starfield";

export type IntroLang = "en" | "zh";

/** 语言偏好与 GuideModal 共用同一个 localStorage key */
export const LANG_KEY = "aie1903-lang";

/**
 * 同标签页语言变更事件。原生 storage 事件只在其他标签页触发，
 * 本标签页写入偏好后需要手动广播，useUiLang 才能即时刷新。
 */
const LANG_EVENT = "aie1903-lang-changed";

function subscribeStorage(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(LANG_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(LANG_EVENT, onChange);
  };
}

function getLangSnapshot(): IntroLang {
  return window.localStorage.getItem(LANG_KEY) === "zh" ? "zh" : "en";
}

/** 读取共享语言偏好；SSR/水合期固定英文，避免首帧文本不一致 */
export function useUiLang(): IntroLang {
  return useSyncExternalStore(subscribeStorage, getLangSnapshot, () => "en");
}

/**
 * 写入共享语言偏好并广播给当前标签页的所有 useUiLang 订阅者。
 * 偏好持久化在 localStorage，即下次访问与其他双语组件的默认语言。
 */
export function setUiLang(lang: IntroLang) {
  window.localStorage.setItem(LANG_KEY, lang);
  window.dispatchEvent(new Event(LANG_EVENT));
}

/**
 * 开场动画文案固定英文：该品牌化片头不跟随语言偏好切换；
 * 中文等其他语言仅用于使用说明弹窗与北极熊引导等应用内组件。
 */
const INTRO_COPY = {
  eyebrow: "AIE1903 · AI-ASSISTED FACULTY HIRING",
  title: "Every claim, traced to its evidence.",
  lines: [
    "AI parses CVs, cover letters, research and teaching statements into a structured candidate profile.",
    "Each claim is verified against public web sources and linked back to its original evidence.",
    "Six-dimension scoring with credibility checks, plus an AI assistant for Q&A and interview prep.",
    "Seminar review aligns two recordings, spots visible presentation actions, and keeps every AI comment human-checkable.",
  ],
  skip: "Click anywhere to skip",
};

/** 与 globals.css 中 .intro-overlay 的动画总时长保持一致 */
const TOTAL_MS = 6800;

export default function IntroOverlay({ onFinish }: { onFinish: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onFinish, TOTAL_MS);
    return () => window.clearTimeout(timer);
  }, [onFinish]);

  const t = INTRO_COPY;

  return (
    <div
      className="intro-overlay"
      role="presentation"
      aria-hidden="true"
      onClick={onFinish}
    >
      <img src={HERO_IMAGE} alt="" className="intro-glacier" />
      <div className="intro-scrim" />
      <div className="intro-content">
        <p className="intro-eyebrow">{t.eyebrow}</p>
        <h2 className="intro-title">{t.title}</h2>
        <ul className="intro-lines">
          {t.lines.map((line, i) => (
            <li
              key={line}
              className="intro-line"
              style={{ animationDelay: `${1.85 + i * 0.7}s` }}
            >
              {line}
            </li>
          ))}
        </ul>
      </div>
      <p className="intro-skip">{t.skip}</p>
    </div>
  );
}
