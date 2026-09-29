"use client";

export interface FilterState {
  tags: string[];
  search: string;
}

// 标签筛选栏：关键词搜索 + 可点击标签（研究方向/技能/机构/论文等级等）
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
    <div className="rounded-xl border border-zinc-200 bg-white p-4">
      <div className="flex items-center gap-2">
        <input
          value={filter.search}
          onChange={(e) => onChange({ ...filter, search: e.target.value })}
          placeholder="Search name, institution, skill, publication..."
          className="flex-1 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm outline-none focus:border-blue-400"
        />
        {hasFilter && (
          <button
            onClick={() => onChange({ tags: [], search: "" })}
            className="text-sm text-zinc-500 hover:text-zinc-700"
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
            className={`rounded-full px-3 py-1 text-sm transition ${
              filter.tags.includes(t)
                ? "bg-blue-600 text-white"
                : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"
            }`}
          >
            {t}
          </button>
        ))}
      </div>
    </div>
  );
}
