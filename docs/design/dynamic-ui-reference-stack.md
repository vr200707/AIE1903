# 动态网站 UI 参考与技术路线 / Dynamic Website UI References & Technical Direction

存档日期 / Archived: 2026-09-28

## 参考网站 / References

- [Supahero](https://supahero.io/) — Hero 区域与营销网站灵感库 / hero and marketing-site inspiration library.
- [SEESAW](https://www.seesaw.website/) — 大规模编辑型网站画廊 / large editorial website gallery.
- [Tigran Azatyan](https://tigranz.com/) — 动态设计师作品集 / motion designer portfolio.
- [SearchSystem](https://searchsystem.co/) — 设计资料与工具档案 / design-reference and tools archive.

## 已验证事实 / Verified Facts

- SEESAW 当前页面使用 Next.js，页面包中也能观察到 GSAP 与 Three.js 相关代码。This confirms a component-based React/Next.js application with animation and 3D-capable libraries in its shipped bundle; it does not prove that every visible effect uses them.
- Tigran 页面带有 Framer generator 标记，并从 Framer CDN 加载运行代码。It is a strong example that polished portfolio motion can be produced with Framer rather than a fully custom WebGL stack.
- SearchSystem 当前由 Tumblr 提供内容与页面运行层，并包含较传统的 JavaScript/jQuery 资源。Its distinctive feel therefore comes primarily from art direction, typography, layout, hover behavior, and content density—not a modern framework requirement.
- Supahero 当前是一个 hero-section collection rather than a single unified visual style. Treat it as a pattern library, not a technology reference.

## 我们真正要复刻的能力 / Capabilities to Recreate

1. 滚动编排（scroll choreography）：内容进入、固定区块、视差、横向移动、进度驱动的画面变化。
2. 动态排版（kinetic typography）：标题分行/分字出现、遮罩揭示、字距与字重变化。
3. 页面过渡（page transitions）：路由切换时的遮罩、淡入淡出、共享元素移动。
4. 指针与悬停反馈（pointer and hover feedback）：图片预览、磁吸按钮、跟随光标的局部变化。
5. 媒体叙事（media storytelling）：自动播放短视频、作品封面序列、滚动触发播放。
6. 可选的实时图形（optional real-time graphics）：粒子、着色器、3D 模型或扭曲效果。

## 推荐技术栈 / Recommended Stack

### 默认路线：最适合正式产品 / Default production route

- Next.js + TypeScript：页面、路由、SEO、图片优化和内容管理基础。
- CSS Modules 或 Tailwind CSS：版式、响应式、设计令牌；大部分视觉效果应先用 CSS 完成。
- GSAP + ScrollTrigger：复杂时间轴、滚动绑定、pin、scrub 和文字/遮罩序列。
- Lenis：只在确实需要统一平滑滚动手感时加入；与 GSAP 统一时钟。
- Motion（原 Framer Motion）：React 组件级交互、布局动画和简单路由过渡。复杂时间轴优先 GSAP，不要同一元素混用两套动画系统。
- React Three Fiber + Drei：仅用于真正需要 3D/WebGL 的一个或两个重点场景。
- Sanity、Contentful 或本地 MDX：作品与文章内容管理，根据编辑频率选择。

### 快速展示路线 / Fast showcase route

- Framer：适合品牌页、作品集、活动页和快速视觉验证。
- 优点：交付快、设计师可直接维护、常见滚动/悬停效果无需大量工程。
- 局限：复杂业务状态、深度定制 WebGL、严格性能预算或大型内容系统会更受约束。

### 不建议一开始就使用 / Avoid as the starting point

- 不要因为页面“很动态”就默认 Three.js。WebGL 增加开发、GPU、移动端发热和无障碍成本。
- 不要同时堆叠 GSAP、Motion、Anime.js、Lottie 来解决同类问题。
- 不要用全站滚动劫持制造动感；应保留键盘、触控与浏览器原生滚动预期。

## 分层实现策略 / Layered Implementation Strategy

| 层级 / Tier | 技术 / Technology | 适用效果 / Best for |
|---|---|---|
| 1 | CSS transitions, transforms, keyframes | hover、淡入、遮罩、基础排版动效 |
| 2 | GSAP + ScrollTrigger | 多段时间轴、pin、scrub、滚动叙事 |
| 3 | SVG / Canvas 2D | 路径、线条、轻量粒子与数据化视觉 |
| 4 | Three.js / React Three Fiber | 真实 3D、shader、空间场景 |
| 5 | MP4/WebM/AVIF sequence | 预渲染的电影感画面，通常比实时 3D 更稳定 |

原则 / Principle: use the lowest tier that produces the intended visual result.

## 建议的项目结构 / Suggested Architecture

```text
app/
  page.tsx
  work/[slug]/page.tsx
components/
  motion/          # reveal, marquee, magnetic button, page transition
  sections/        # hero, project grid, about, contact
  canvas/          # optional WebGL scenes only
lib/
  animation/       # GSAP registration, reduced-motion helpers
  content/         # CMS/MDX adapters
styles/
  tokens.css       # color, type, spacing, easing, duration
```

## 动效规范 / Motion System

- 先定义 3–4 条 easing 曲线、3 个时长档位和统一的 stagger 间隔，再做单个效果。
- 动画只优先使用 `transform` 与 `opacity`，减少布局重排（layout reflow）。
- 必须支持 `prefers-reduced-motion`，在低动态模式关闭 parallax、scrub、自动播放和强烈位移。
- 视频使用静音、`playsinline`、海报图和延迟加载；首屏不要同时加载多个高码率视频。
- WebGL 场景按设备能力降级：低端设备显示静态图片或预渲染视频。
- 移动端不是桌面版缩小；应重新编排内容顺序、滚动距离和媒体比例。

## 推荐落地顺序 / Recommended Delivery Sequence

1. 在 Figma/Framer 做静态视觉与关键动态分镜，明确 3–5 个“主角动效”。
2. 用 Next.js 建立真实内容和响应式版式，先不加重动效。
3. 建立 motion tokens，然后加入 CSS 与组件级交互。
4. 用 GSAP 实现两个核心滚动场景，并在真机上测性能。
5. 只有当视觉目标无法由 DOM/CSS/视频完成时，再加入 React Three Fiber。
6. 验证 Lighthouse、键盘操作、低动态模式、Safari/iOS 和中端 Android。

## 决策结论 / Decision

如果目标是可长期维护的品牌官网或产品营销站，首选 **Next.js + TypeScript + CSS/Tailwind + GSAP**，需要顺滑滚动时再加 Lenis，需要单点 3D 时才加 React Three Fiber。If the goal is a portfolio or campaign page that must launch quickly and is maintained mostly by designers, start with **Framer**.

