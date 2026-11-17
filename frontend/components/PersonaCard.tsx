import type { Persona, PersonaDimension } from "@/lib/persona";

/** 雷达轴使用短标签，完整名称在右侧维度列表中展示。 */
const AXIS_LABELS: Record<PersonaDimension["key"], string> = {
  academic_influence: "Influence",
  research_output: "Output",
  funding_awards: "Funding",
  service_collaboration: "Service",
  career_trajectory: "Trajectory",
  risk_control: "Risk Ctrl",
};

const LEVEL_CLASS: Record<PersonaDimension["level"], string> = {
  Exceptional: "bg-accent/15 text-accent-deep",
  Outstanding: "bg-accent/15 text-accent-deep",
  Strong: "bg-sky-100 text-sky-800",
  Developing: "bg-amber-100 text-amber-800",
  Emerging: "bg-ink/10 text-ink/60",
};

/** 纯手写 SVG 六维雷达图，不引入任何图表依赖。 */
function Radar({ dimensions }: { dimensions: PersonaDimension[] }) {
  const cx = 132;
  const cy = 124;
  const R = 78;
  const angle = (i: number) => ((-90 + i * 60) * Math.PI) / 180;
  const point = (i: number, r: number): [number, number] => [
    cx + r * Math.cos(angle(i)),
    cy + r * Math.sin(angle(i)),
  ];
  const polygon = (ratio: number) =>
    dimensions
      .map((_, i) => point(i, R * ratio).map((n) => n.toFixed(1)).join(","))
      .join(" ");
  const dataPolygon = dimensions
    .map((d, i) => point(i, (R * d.score) / 100).map((n) => n.toFixed(1)).join(","))
    .join(" ");

  return (
    <svg viewBox="0 0 264 248" className="mx-auto h-auto w-full max-w-[280px]" role="img" aria-label="Six-dimension persona radar chart">
      {/* 刻度环 */}
      {[0.25, 0.5, 0.75, 1].map((ratio) => (
        <polygon
          key={ratio}
          points={polygon(ratio)}
          fill="none"
          stroke="rgba(22,50,74,0.14)"
          strokeWidth="1"
        />
      ))}
      {/* 轴线 */}
      {dimensions.map((_, i) => {
        const [x, y] = point(i, R);
        return (
          <line
            key={i}
            x1={cx}
            y1={cy}
            x2={x}
            y2={y}
            stroke="rgba(22,50,74,0.12)"
            strokeWidth="1"
          />
        );
      })}
      {/* 数据面 */}
      <polygon
        points={dataPolygon}
        fill="rgba(40,101,127,0.22)"
        stroke="#28657f"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      {/* 顶点与轴标签 */}
      {dimensions.map((d, i) => {
        const [dx, dy] = point(i, (R * d.score) / 100);
        const [lx, ly] = point(i, R + 19);
        const cos = Math.cos(angle(i));
        const anchor = cos > 0.3 ? "start" : cos < -0.3 ? "end" : "middle";
        return (
          <g key={d.key}>
            <circle cx={dx} cy={dy} r="3.4" fill="#1f5871" />
            <text
              x={lx}
              y={ly + 3.5}
              textAnchor={anchor}
              className="fill-ink/70"
              fontSize="11"
              fontWeight="600"
            >
              {AXIS_LABELS[d.key]}
            </text>
          </g>
        );
      })}
      <text x={cx} y={cy + 4} textAnchor="middle" className="fill-accent" fontSize="13" fontWeight="700">
        {Math.round(dimensions.reduce((n, d) => n + d.score, 0) / dimensions.length)}
      </text>
    </svg>
  );
}

/**
 * 结果顶部的面试官人物画像总览卡：
 * 雷达图 + 六维评分条与依据 + 人物标签 + 面试关注点/风险信号。
 */
export default function PersonaCard({
  persona,
  name,
  position,
  institution,
}: {
  persona: Persona;
  name: string;
  position: string | null;
  institution: string | null;
}) {
  const meta = [position, institution].filter(Boolean).join(" · ");
  return (
    <section className="glass animate-reveal rounded-3xl p-6 md:p-7" aria-label="Interviewer persona overview">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-accent">
            Interviewer Persona
          </p>
          <h2 className="mt-2 break-words font-display text-2xl font-semibold tracking-tight">
            {name}
          </h2>
          {meta && <p className="mt-1 text-sm text-ink/65">{meta}</p>}
        </div>
        {/* 靶心线稿装饰，低透明度融入玻璃卡 */}
        <svg viewBox="0 0 48 48" className="mt-1 h-11 w-11 shrink-0 text-accent/35" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="24" cy="24" r="18" />
          <circle cx="24" cy="24" r="10" />
          <circle cx="24" cy="24" r="2.6" fill="currentColor" stroke="none" />
          <line x1="24" y1="2" x2="24" y2="10" strokeLinecap="round" />
          <line x1="24" y1="38" x2="24" y2="46" strokeLinecap="round" />
          <line x1="2" y1="24" x2="10" y2="24" strokeLinecap="round" />
          <line x1="38" y1="24" x2="46" y2="24" strokeLinecap="round" />
        </svg>
      </div>

      <p className="mt-3 max-w-3xl text-base leading-7 text-ink/80">{persona.headline}</p>

      <div className="mt-6 grid gap-7 lg:grid-cols-[280px_minmax(0,1fr)]">
        <div>
          <Radar dimensions={persona.dimensions} />
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {persona.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full border border-accent/25 bg-accent/[0.08] px-3 py-1 text-xs font-medium text-accent-deep"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>

        <div className="grid content-start gap-x-6 gap-y-4 sm:grid-cols-2">
          {persona.dimensions.map((d) => (
            <div key={d.key}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold">{d.label}</p>
                <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${LEVEL_CLASS[d.level]}`}>
                  {d.level} · {d.score}
                </span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink/10">
                <div
                  className={`h-full rounded-full ${d.score < 40 ? "bg-amber-500" : "bg-accent"}`}
                  style={{ width: `${d.score}%` }}
                />
              </div>
              <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-ink/60">
                {d.basis.join(" · ")}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6 grid gap-4 border-t border-ink/10 pt-5 md:grid-cols-2">
        <div>
          <p className="text-sm font-semibold text-accent-deep">Suggested interview focus</p>
          <ul className="mt-2 space-y-2">
            {persona.interviewFocus.map((item) => (
              <li key={item} className="flex gap-2 text-sm leading-6 text-ink/80">
                <span aria-hidden="true" className="mt-0.5 shrink-0 text-accent">→</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-sm font-semibold text-amber-800">Risk signals</p>
          <ul className="mt-2 space-y-2">
            {persona.riskSignals.map((item) => (
              <li key={item} className="flex gap-2 text-sm leading-6 text-ink/80">
                <span aria-hidden="true" className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-amber-200 text-[11px] font-bold text-amber-800">!</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
