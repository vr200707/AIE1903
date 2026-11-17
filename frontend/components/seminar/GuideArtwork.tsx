/**
 * Seminar 使用说明的六步引导示意图。
 * 全部为无文字的冰川蓝线稿 SVG，英文/中文下通用，避免图片内文字的翻译问题。
 */
const STROKE = "#28657f";
const SOFT = "#6ba3bf";
const FILL = "rgba(107,163,191,0.14)";
const FILL_2 = "rgba(40,101,127,0.10)";
const SW = 3;

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 320 180" className="h-auto w-full rounded-xl border border-ink/10 bg-white/70" role="img" aria-hidden="true">
      {children}
    </svg>
  );
}

/** 1. 选择候选人：资料卡 + 头像 + 勾选 */
function CandidateArt() {
  return (
    <Frame>
      <rect x="96" y="28" width="128" height="124" rx="12" fill={FILL} stroke={SOFT} strokeWidth="2" />
      <circle cx="160" cy="66" r="20" fill="white" stroke={STROKE} strokeWidth={SW} />
      <path d="M144 96 q16 -14 32 0" fill="white" stroke={STROKE} strokeWidth={SW} strokeLinecap="round" />
      <line x1="126" y1="114" x2="194" y2="114" stroke={SOFT} strokeWidth="3" strokeLinecap="round" />
      <line x1="134" y1="128" x2="186" y2="128" stroke={SOFT} strokeWidth="3" strokeLinecap="round" />
      <circle cx="216" cy="138" r="15" fill={STROKE} />
      <path d="M209 138 l5 5 9 -10" stroke="white" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </Frame>
  );
}

/** 2. 上传双视角录像：两个视频帧 + 上传箭头 */
function VideosArt() {
  return (
    <Frame>
      <rect x="42" y="44" width="98" height="70" rx="10" fill={FILL} stroke={STROKE} strokeWidth={SW} />
      <polygon points="80,64 80,94 106,79" fill={STROKE} />
      <rect x="180" y="44" width="98" height="70" rx="10" fill={FILL_2} stroke={STROKE} strokeWidth={SW} />
      <rect x="206" y="66" width="46" height="30" rx="4" fill="white" stroke={SOFT} strokeWidth="2.5" />
      <line x1="214" y1="76" x2="244" y2="76" stroke={SOFT} strokeWidth="2.5" strokeLinecap="round" />
      <line x1="214" y1="86" x2="238" y2="86" stroke={SOFT} strokeWidth="2.5" strokeLinecap="round" />
      <path d="M160 132 V104 M149 115 l11 -11 11 11" stroke={STROKE} strokeWidth={SW} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="70" y1="138" x2="250" y2="138" stroke={SOFT} strokeWidth="2.5" strokeLinecap="round" strokeDasharray="2 8" />
    </Frame>
  );
}

/** 3. 音频对齐：两条时间轴 + 偏移滑块对齐到同一时刻 */
function AlignmentArt() {
  return (
    <Frame>
      <line x1="40" y1="62" x2="280" y2="62" stroke={SOFT} strokeWidth="3" strokeLinecap="round" />
      <rect x="96" y="52" width="44" height="20" rx="6" fill={FILL} stroke={STROKE} strokeWidth="2.5" />
      <line x1="40" y1="118" x2="280" y2="118" stroke={SOFT} strokeWidth="3" strokeLinecap="round" />
      <rect x="150" y="108" width="44" height="20" rx="6" fill={FILL_2} stroke={STROKE} strokeWidth="2.5" />
      <path d="M140 72 v28 M140 72 l-7 8 M140 72 l7 8" stroke={STROKE} strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M172 108 v-28 M172 80 l-7 8 M172 80 l7 8" stroke={STROKE} strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="156" cy="90" r="12" fill={STROKE} />
      <path d="M150 90 l4 4 8 -9" stroke="white" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </Frame>
  );
}

/** 4. 结构化分段：彩色时间线分块 */
function StructureArt() {
  const segs = [
    { x: 40, w: 52, c: "#5ea89c" },
    { x: 96, w: 96, c: "#5b97c4" },
    { x: 196, w: 48, c: "#8b7fc4" },
    { x: 248, w: 32, c: "#d3a24f" },
  ];
  return (
    <Frame>
      <line x1="40" y1="132" x2="280" y2="132" stroke={SOFT} strokeWidth="2.5" strokeLinecap="round" />
      {segs.map((s, i) => (
        <g key={i}>
          <rect x={s.x} y="58" width={s.w} height="58" rx="8" fill={s.c} fillOpacity="0.18" stroke={s.c} strokeWidth="2.5" />
          <line x1={s.x + 10} y1="76" x2={s.x + s.w - 10} y2="76" stroke={s.c} strokeWidth="3" strokeLinecap="round" />
          <line x1={s.x + 10} y1="90" x2={s.x + s.w - 16} y2="90" stroke={s.c} strokeWidth="3" strokeLinecap="round" opacity="0.6" />
        </g>
      ))}
      <circle cx="148" cy="132" r="6" fill={STROKE} />
      <line x1="148" y1="138" x2="148" y2="150" stroke={STROKE} strokeWidth="2.5" strokeLinecap="round" />
    </Frame>
  );
}

/** 5. 视觉 AI 扫描：取景框 + 扫描线 + 眼睛 */
function ScanArt() {
  return (
    <Frame>
      <rect x="66" y="34" width="188" height="112" rx="10" fill={FILL_2} stroke={SOFT} strokeWidth="2.5" />
      <path d="M66 52 v-10 a8 8 0 0 1 8 -8 h10 M236 34 h10 a8 8 0 0 1 8 8 v10 M254 128 v10 a8 8 0 0 1 -8 8 h-10 M84 146 h-10 a8 8 0 0 1 -8 -8 v-10" stroke={STROKE} strokeWidth={SW} fill="none" strokeLinecap="round" />
      <line x1="78" y1="78" x2="242" y2="78" stroke={STROKE} strokeWidth="3" strokeLinecap="round" />
      <line x1="78" y1="84" x2="242" y2="84" stroke={SOFT} strokeWidth="2" strokeLinecap="round" opacity="0.7" />
      <path d="M130 112 q30 -22 60 0 q-30 22 -60 0 Z" fill="white" stroke={STROKE} strokeWidth="2.5" strokeLinejoin="round" />
      <circle cx="160" cy="112" r="7" fill={STROKE} />
    </Frame>
  );
}

/** 6. 三维度复核：清单 + 勾选 + 结论徽章 */
function ReviewArt() {
  return (
    <Frame>
      <rect x="88" y="26" width="144" height="128" rx="12" fill={FILL} stroke={SOFT} strokeWidth="2.5" />
      {[60, 88, 116].map((y) => (
        <g key={y}>
          <circle cx="112" cy={y} r="9" fill="white" stroke={STROKE} strokeWidth="2.5" />
          <path d={`M107.5 ${y} l3.5 3.5 6 -7`} stroke={STROKE} strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <line x1="130" y1={y} x2="214" y2={y} stroke={SOFT} strokeWidth="3" strokeLinecap="round" />
        </g>
      ))}
      <circle cx="216" cy="44" r="14" fill={STROKE} />
      <path d="M209.5 44 l4.5 4.5 8.5 -9.5" stroke="white" strokeWidth="2.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </Frame>
  );
}

const ARTWORKS = [CandidateArt, VideosArt, AlignmentArt, StructureArt, ScanArt, ReviewArt];

export default function GuideArtwork({ step }: { step: number }) {
  const Art = ARTWORKS[step] ?? ARTWORKS[0];
  return <Art />;
}
