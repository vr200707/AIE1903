import type { ReactNode } from "react";

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
  className = "",
  children,
}: {
  title: string;
  hidden?: boolean;
  delay?: number;
  art?: string;
  className?: string;
  children: ReactNode;
}) {
  if (hidden) return null;
  return (
    <section
      className={`glass rounded-2xl transition-colors duration-300 hover:bg-white/[0.09] ${className}`}
    >
      {art && (
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
      <div className="animate-pop relative p-7" style={{ animationDelay: `${delay}s` }}>
        <h2 className="mb-6 flex items-center gap-3 pr-24 text-xl font-medium tracking-tight text-white">
          <span className="h-6 w-1 shrink-0 rounded-full bg-accent" />
          {title}
        </h2>
        {children}
      </div>
    </section>
  );
}