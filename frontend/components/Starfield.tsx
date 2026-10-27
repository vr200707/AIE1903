"use client";

/** 首页背景图：冰山/雪山，冰川蓝调 */
export const HERO_IMAGE =
  "https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=" +
  encodeURIComponent(
    "icy glacier landscape, snow capped mountain peaks, iceberg floating in pale blue water, soft winter light, minimal editorial style, pale blue and white tones, serene, no text",
  ) +
  "&image_size=landscape_16_9";

/**
 * 冰川淡蓝背景：可选的冰山背景图 + 冰影光斑 + 飘落冰晶。
 * 无 canvas、无第三方依赖。
 *
 * `contained` 为 true 时铺满父容器（父容器需 relative），默认铺满视口。
 * `image` 传入时用背景图（首页用），否则纯冰川渐变。
 */
export default function Starfield({
  contained = false,
  image,
}: {
  contained?: boolean;
  image?: string;
}) {
  return (
    <div
      className={
        contained
          ? "pointer-events-none absolute inset-0 overflow-hidden"
          : "pointer-events-none fixed inset-0 -z-10 overflow-hidden"
      }
      aria-hidden="true"
    >
      {/* 背景图（可选） */}
      {image && (
        <img
          src={image}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}

      {/* 冰川蓝遮罩：让背景图融入冷色调，保证文字可读 */}
      <div
        className="absolute inset-0"
        style={{
          background: image
            ? "radial-gradient(120% 100% at 50% 18%, rgba(222,233,242,0.30) 0%, rgba(215,229,237,0.66) 52%, rgba(196,214,226,0.82) 100%)"
            : "radial-gradient(120% 100% at 50% 18%, #dbe6ee 0%, #d7e5ed 55%, #c4d6e2 100%)",
        }}
      />

      {/* 右侧冰山阴影 */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(38% 55% at 85% 28%, rgba(22,50,74,0.14) 0%, transparent 70%)," +
            "radial-gradient(30% 42% at 94% 66%, rgba(22,50,74,0.10) 0%, transparent 68%)," +
            "radial-gradient(26% 34% at 74% 86%, rgba(22,50,74,0.08) 0%, transparent 66%)",
        }}
      />

      {/* 柔和光斑：冰面反光 */}
      <div
        className="animate-glow-breathe absolute inset-0"
        style={{
          background:
            "radial-gradient(22% 18% at 16% 20%, rgba(255,255,255,0.38) 0%, transparent 70%)," +
            "radial-gradient(16% 14% at 62% 10%, rgba(255,255,255,0.24) 0%, transparent 70%)," +
            "radial-gradient(18% 15% at 38% 72%, rgba(255,255,255,0.16) 0%, transparent 70%)",
        }}
      />

      {/* 飘落冰晶：三个缓慢下落的亮点 */}
      <span className="animate-snow absolute left-[18%] top-[-6%] h-1.5 w-1.5 rounded-full bg-white/70" />
      <span
        className="animate-snow absolute left-[52%] top-[-6%] h-1 w-1 rounded-full bg-white/50"
        style={{ animationDelay: "3s", animationDuration: "14s" }}
      />
      <span
        className="animate-snow absolute left-[76%] top-[-6%] h-1.5 w-1.5 rounded-full bg-white/60"
        style={{ animationDelay: "6s", animationDuration: "18s" }}
      />

      {/* 中心柔光，把标题托出来 */}
      <div
        className="absolute left-1/2 top-1/2 h-[52rem] w-[52rem] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          background:
            "radial-gradient(circle, rgba(255,255,255,0.30) 0%, rgba(255,255,255,0.08) 34%, transparent 68%)",
        }}
      />
    </div>
  );
}
