"use client";

import { useEffect, useState } from "react";
import { setUiLang, useUiLang, type IntroLang } from "@/components/IntroOverlay";
import GuideArtwork from "@/components/seminar/GuideArtwork";

/** 首次访问 seminar 时自动弹出说明，关闭后写入该标记 */
export const GUIDE_SEEN_KEY = "aie1903-seminar-guide-seen";

type GuideLang = IntroLang;

const GUIDE: Record<
  GuideLang,
  {
    title: string;
    subtitle: string;
    steps: { title: string; body: string }[];
    note: string;
    close: string;
  }
> = {
  en: {
    title: "How the seminar review works",
    subtitle:
      "Six steps from raw recordings to evidence-checked presentation feedback.",
    steps: [
      {
        title: "Choose a candidate",
        body: "Pick a candidate profile you analyzed earlier and give this seminar a title. The session is saved on the server, so you can close the page and resume later.",
      },
      {
        title: "Upload two views",
        body: "Add the speaker recording and the shared-screen recording of the same event. Screen audio is optional. MP4 with H.264/AAC plays most reliably in the browser.",
      },
      {
        title: "Align the recordings",
        body: "Set the offset so that screen time = speaker time + offset (speaker 00:10 matches screen 00:13 → +3). An audio-based estimate is suggested, but always check the start, middle and end, then confirm yourself.",
      },
      {
        title: "Structure the talk",
        body: "Split the recording into logical parts — Introduction, Body, Conclusion and Q&A. Run local Whisper transcription or import SRT/VTT subtitles, then rename, split and merge parts on one saved timeline.",
      },
      {
        title: "Scan with vision AI",
        body: "Tick the parts you want analyzed. The AI samples frames from both views, joins them with transcript context and returns observations linked to evidence frames. Scanning runs in the background.",
      },
      {
        title: "Review the feedback",
        body: "Up to six key observations across three dimensions: audience orientation, gesture usage, and posture and movement. Play the synced evidence, then mark each one Confirmed, Inaccurate or Cannot determine.",
      },
    ],
    note: "AI comments describe visible presentation behavior only — never personality or hiring verdicts. Every comment can be checked against the original recordings.",
    close: "Got it",
  },
  zh: {
    title: "研讨会分析使用说明",
    subtitle: "从原始录像到带证据的演讲反馈，共六步。",
    steps: [
      {
        title: "选择候选人",
        body: "选择此前已分析的候选人档案，并为本次研讨会填写标题。会话保存在服务器，关闭页面后可随时恢复继续。",
      },
      {
        title: "上传两个视角",
        body: "上传同一场展示的演讲者录像与屏幕共享录像，屏幕录像可以没有声音。推荐使用 H.264/AAC 编码的 MP4，浏览器播放最稳定。",
      },
      {
        title: "对齐两路录像",
        body: "设置时间偏移，使 屏幕时间 = 演讲者时间 + 偏移（例如演讲者 00:10 对应屏幕 00:13 → 填 +3）。系统会给出基于音频的参考值，但务必自行核对开头、中段和结尾后再确认。",
      },
      {
        title: "结构化演讲",
        body: "把录像切分为开场、正文、结论、问答等逻辑段落。可运行本地 Whisper 转写或导入 SRT/VTT 字幕，并在同一条已保存时间线上重命名、拆分与合并段落。",
      },
      {
        title: "视觉 AI 扫描",
        body: "勾选需要分析的段落，AI 会从两个视角抽取帧画面，结合转写上下文，返回带证据帧的观察结果；扫描在后台运行，期间可继续其他操作。",
      },
      {
        title: "复核反馈",
        body: "最多呈现六个关键观察，覆盖受众导向、手势使用、姿态移动三个维度。播放同步证据录像后，将每条标记为确认、不准确或无法判断。",
      },
    ],
    note: "AI 评论只描述可见的演讲行为，不做性格或录用判断；每条评论都可用原始录像核验。",
    close: "我知道了",
  },
};

export default function GuideModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  // 弹窗内手动切换只影响本次打开，同时写入共享偏好；未切换时跟随全局语言
  const storedLang = useUiLang();
  const [override, setOverride] = useState<GuideLang | null>(null);
  const lang = override ?? storedLang;

  // ESC 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const switchLang = (next: GuideLang) => {
    setOverride(next);
    setUiLang(next);
  };

  const t = GUIDE[lang];

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t.title}
    >
      <button
        aria-label="Close guide"
        className="absolute inset-0 cursor-default bg-ink/50"
        onClick={onClose}
      />
      <div className="relative max-h-[86vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-ink/15 bg-[#f3f8fc] p-6 shadow-2xl sm:p-8">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="font-display text-2xl font-light">{t.title}</h2>
            <p className="mt-2 text-sm text-ink/70">{t.subtitle}</p>
          </div>
          <div
            role="group"
            aria-label="Language"
            className="flex shrink-0 rounded-full border border-ink/20 p-1 text-xs"
          >
            {(["en", "zh"] as const).map((code) => (
              <button
                key={code}
                onClick={() => switchLang(code)}
                aria-pressed={lang === code}
                className={`rounded-full px-3 py-1.5 transition ${
                  lang === code
                    ? "bg-ink text-white"
                    : "text-ink/70 hover:text-ink"
                }`}
              >
                {code === "en" ? "EN" : "中文"}
              </button>
            ))}
          </div>
        </div>

        <ol className="mt-6 space-y-4">
          {t.steps.map((step, i) => (
            <li key={step.title} className="flex gap-4">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/12 font-display text-sm text-accent">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="font-medium">{step.title}</h3>
                <p className="mt-1 text-sm leading-6 text-ink/75">
                  {step.body}
                </p>
                <div className="mt-3">
                  <GuideArtwork step={i} />
                </div>
              </div>
            </li>
          ))}
        </ol>

        <p className="mt-6 rounded-xl border border-accent/30 bg-accent/[0.06] p-4 text-sm leading-6 text-ink/80">
          {t.note}
        </p>

        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-full bg-ink px-6 py-2.5 text-sm text-white transition hover:bg-ink/90"
          >
            {t.close}
          </button>
        </div>
      </div>
    </div>
  );
}
