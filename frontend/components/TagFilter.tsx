"use client";

export interface FilterState {
  tags: string[];
  search: string;
}

// 标签筛选栏：关键词搜索 + 可点击标签
export function TagFilter({
  tags,
  filter,
  onChange,
}: {
  tags: string[];
  filter: FilterState;
  onChange: (f: FilterState) => void;
}) {
  function toggleTag(tag: string) {
    const next = filter.tags.includes(tag)
      ? filter.tags.filter((t) => t !== tag)
      : [...filter.tags, tag];
    onChange({ ...filter, tags: next });
  }

  const hasFilter = filter.tags.length > 0 || filter.search !== "";

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-4 backdrop-blur-xl">
      <div className="flex items-center gap-2">
        <input
          value={filter.search}
          onChange={(e) => onChange({ ...filter, search: e.target.value })}
          placeholder="Search name, institution, skill, publication..."
          className="flex-1 rounded-lg border border-white/10 bg-white/[0.05] px-3 py-1.5 text-sm text-white/90 outline-none placeholder:text-white/40 focus:border-teal-400/50"
        />
        {hasFilter && (
          <button
            onClick={() => onChange({ tags: [], search: "" })}
            className="text-sm text-white/50 transition-colors hover:text-white/90"
          >
            Clear
          </button>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {tags.map((t) => (
          <button
            key={t}
            onClick={() => toggleTag(t)}
            className={`rounded-full px-3 py-1 text-sm transition-all duration-300 ${
              filter.tags.includes(t)
                ? "bg-gradient-to-r from-teal-400 to-cyan-400 text-white"
                : "bg-white/10 text-white/70 hover:bg-white/15"
            }`}
          >
            {t}
          </button>
        ))}
      </div>
    </div>
  );
}
