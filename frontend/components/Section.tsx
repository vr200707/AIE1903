import type { ReactNode } from "react";

export function Section({
  title,
  hidden,
  children,
}: {
  title: string;
  hidden?: boolean;
  children: ReactNode;
}) {
  if (hidden) return null;
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-6">
      <h2 className="mb-4 text-base font-semibold text-zinc-800">{title}</h2>
      {children}
    </section>
  );
}
