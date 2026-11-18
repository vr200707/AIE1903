"use client";

import { useEffect, useState } from "react";
import type { CvImage } from "@/lib/types";

/**
 * 候选人姓名旁的 CV 内嵌图片画廊：
 * 缩略图横向排列，点击打开灯箱查看原图；图片加载失败时自动隐藏，不留破图。
 */
export default function CvImageGallery({ images }: { images: CvImage[] }) {
  const [active, setActive] = useState<number | null>(null);
  const [broken, setBroken] = useState<Set<number>>(new Set());

  // ESC 关闭灯箱，左右方向键切换
  useEffect(() => {
    if (active === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setActive(null);
      if (e.key === "ArrowRight") setActive((i) => (i === null ? i : (i + 1) % images.length));
      if (e.key === "ArrowLeft")
        setActive((i) => (i === null ? i : (i - 1 + images.length) % images.length));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, images.length]);

  if (images.length === 0) return null;
  const visible = images.filter((_, i) => !broken.has(i));
  if (visible.length === 0) return null;

  return (
    <div aria-label="Images extracted from the CV documents">
      <div className="flex flex-wrap gap-2.5">
        {images.map((image, i) =>
          broken.has(i) ? null : (
            <button
              key={image.filename}
              type="button"
              onClick={() => setActive(i)}
              aria-label={`View CV image ${i + 1} of ${images.length}`}
              className="group relative h-32 w-32 overflow-hidden rounded-xl border border-ink/15 bg-ink/[0.04] shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-accent/50 hover:shadow-lg sm:h-36 sm:w-36"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={image.url}
                alt={`CV image ${i + 1}`}
                loading="lazy"
                className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                onError={() =>
                  setBroken((prev) => {
                    const next = new Set(prev);
                    next.add(i);
                    return next;
                  })
                }
              />
              <span className="absolute bottom-1 right-1 rounded-full bg-ink/65 px-1.5 py-0.5 text-[10px] font-medium text-white opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                {i + 1}/{images.length}
              </span>
            </button>
          ),
        )}
      </div>

      {active !== null && images[active] && (
        <div
          className="fixed inset-0 z-[70] grid place-items-center bg-ink/60 p-6 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="CV image preview"
          onClick={() => setActive(null)}
        >
          <button
            type="button"
            aria-label="Close preview"
            className="absolute right-5 top-5 grid h-10 w-10 place-items-center rounded-full bg-white/90 text-lg text-ink shadow-lg transition hover:bg-white"
            onClick={() => setActive(null)}
          >
            ×
          </button>
          {images.length > 1 && (
            <>
              <button
                type="button"
                aria-label="Previous image"
                className="absolute left-5 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-xl text-ink shadow-lg transition hover:bg-white"
                onClick={(e) => {
                  e.stopPropagation();
                  setActive((i) => (i === null ? i : (i - 1 + images.length) % images.length));
                }}
              >
                ←
              </button>
              <button
                type="button"
                aria-label="Next image"
                className="absolute right-5 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-xl text-ink shadow-lg transition hover:bg-white"
                onClick={(e) => {
                  e.stopPropagation();
                  setActive((i) => (i === null ? i : (i + 1) % images.length));
                }}
              >
                →
              </button>
            </>
          )}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={images[active].url}
            alt={`CV image ${active + 1} of ${images.length}`}
            className="max-h-[82vh] max-w-[86vw] rounded-2xl bg-white object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
          <p className="absolute bottom-5 left-1/2 -translate-x-1/2 rounded-full bg-white/90 px-4 py-1.5 text-xs font-medium text-ink/80 shadow">
            {active + 1} / {images.length} · extracted from the uploaded CV
          </p>
        </div>
      )}
    </div>
  );
}
