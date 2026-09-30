import type { ReactNode } from "react";

// 区块：黑白 editorial 风格，大标题 + 青绿强调条，带入场动画（可错峰）
export function Section({
  title,
  hidden,
  delay = 0,
  children,
}: {
  title: string;
  hidden?: boolean;
  delay?: number;
  children: ReactNode;
}) {
  if (hidden) return null;
  return (
    <section
      className="animate-fade-in-up rounded-2xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur-xl"
      style={{ animationDelay: `${delay}s` }}
    >
      <h2 className="mb-5 flex items-center gap-3 text-2xl font-bold tracking-tight text-white">
        <span className="h-6 w-1 rounded-full bg-teal-400" />
        {title}
      </h2>
      {children}
    </section>
  );
}
