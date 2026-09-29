import Link from "next/link";

export default function MethodologyPage() {
  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <h1 className="text-lg font-semibold">候选人档案分析</h1>
          <nav className="flex gap-4 text-sm">
            <Link href="/" className="text-zinc-500 hover:text-zinc-900">
              档案
            </Link>
            <Link href="/methodology" className="font-medium text-zinc-900">
              方法说明
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-8">
        <div className="rounded-xl border border-zinc-200 bg-white p-6">
          <h2 className="text-xl font-bold">方法说明</h2>
          <p className="mt-3 text-sm text-zinc-500">
            此处将展示字段定义、评分规则、缺失与冲突处理规则（D4 由赵越提供内容后填充）。
          </p>
        </div>
      </main>
    </div>
  );
}
