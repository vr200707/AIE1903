"use client";

export interface FilterState {
  tags: string[];
  search: string;
}

// 搜索 + 标签筛选栏：搜索词和选中标签会真正过滤下方内容，并显示命中条数
export function TagFilter({
  tags,
  filter,
  onChange,
  resultCount,
}: {
  tags: string[];
  filter: FilterState;
  onChange: (f: FilterState) => void;
  resultCount?: number;
}) {
  function toggleTag(tag: string) {
    const next = filter.tags.includes(tag)
      ? filter.tags.filter((t) => t !== tag)
      : [...filter.tags, tag];
    onChange({ ...filter, tags: next });
  }

  const hasFilter = filter.tags.length > 0 || filter.search.trim() !== "";

  return (
    <div className="rounded-2xl border border-ink/10 bg-ink/[0.05] p-4 backdrop-blur-xl">
      <div className="flex items-center gap-2">
        <svg
          viewBox="0 0 16 16"
          className="h-4 w-4 shrink-0 text-ink/75"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <circle cx="7" cy="7" r="4.5" />
          <path d="m10.5 10.5 3 3" strokeLinecap="round" />
        </svg>
        <input
          value={filter.search}
          onChange={(e) => onChange({ ...filter, search: e.target.value })}
          placeholder="Search name, institution, skill, publication…"
          className="flex-1 bg-transparent px-1 py-1.5 text-sm text-ink/90 outline-none placeholder:text-ink/75"
        />
        {hasFilter && (
          <button
            type="button"
            onClick={() => onChange({ tags: [], search: "" })}
            className="shrink-0 rounded-full border border-ink/10 px-3 py-1 text-xs text-ink/75 transition hover:border-ink/30 hover:text-ink"
          >
            Clear
          </button>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {tags.map((t) => {
          const active = filter.tags.includes(t);
          return (
            <button
              key={t}
              type="button"
              onClick={() => toggleTag(t)}
              className={`rounded-full px-3 py-1 text-sm transition-all duration-200 ${
                active
                  ? "bg-accent text-white shadow-[0_6px_16px_-8px_rgba(63,127,158,0.8)]"
                  : "bg-ink/[0.08] text-ink/75 hover:bg-ink/[0.14] hover:text-ink"
              }`}
            >
              {active ? "✓ " : ""}
              {t}
            </button>
          );
        })}
      </div>

      {hasFilter && (
        <p className="mt-3 border-t border-ink/[0.08] pt-2 text-xs text-ink/75">
          {resultCount != null
            ? `${resultCount} matching item${resultCount === 1 ? "" : "s"}`
            : "Filtering…"}
        </p>
      )}
    </div>
  );
}
