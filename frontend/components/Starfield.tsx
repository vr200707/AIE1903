"use client";

import { useEffect, useRef } from "react";

type Star = {
  x: number;
  y: number;
  r: number;
  base: number;
  speed: number;
  twinkleSpeed: number;
  phase: number;
  vx: number;
  vy: number;
  hue: number;
  flare: boolean;
};

type Meteor = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  len: number;
};

type Layer = { stars: Star[]; depth: number };

const LAYERS: { density: number; rMin: number; rMax: number; aMin: number; aMax: number; speed: number; depth: number; flareRate: number }[] = [
  { density: 8000, rMin: 0.35, rMax: 0.8, aMin: 0.14, aMax: 0.38, speed: 0.05, depth: 5, flareRate: 0.005 },
  { density: 14000, rMin: 0.6, rMax: 1.15, aMin: 0.28, aMax: 0.6, speed: 0.1, depth: 13, flareRate: 0.01 },
  { density: 30000, rMin: 0.95, rMax: 1.9, aMin: 0.5, aMax: 1, speed: 0.2, depth: 26, flareRate: 0.024 },
];

const rand = (a: number, b: number) => a + Math.random() * (b - a);

function makeStar(w: number, h: number, cfg: (typeof LAYERS)[number], near: boolean): Star {
  return {
    x: rand(0, w),
    y: rand(0, h),
    r: rand(cfg.rMin, cfg.rMax),
    base: rand(cfg.aMin, cfg.aMax),
    speed: rand(0.6, 1.4),
    twinkleSpeed: rand(0.4, 1.5),
    phase: rand(0, Math.PI * 2),
    vx: rand(-1, 1) * cfg.speed,
    vy: rand(-1, 1) * cfg.speed,
    hue: Math.random() < (near ? 0.3 : 0.16) ? 38 : 205,
    flare: Math.random() < cfg.flareRate,
  };
}

/**
 * 深邃宇宙星河背景：三层视差星场 + 闪烁 + 流星 + 鼠标视差。
 * 纯 canvas 手写，无第三方依赖。
 *
 * `contained` 为 true 时，星场会铺满其父容器（父容器需为 relative），
 * 适合用作弹窗/卡片内部的背景；默认铺满整个视口。
 */
export default function Starfield({ contained = false }: { contained?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const root = rootRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let w = 0;
    let h = 0;
    let dpr = 1;
    let layers: Layer[] = [];
    let meteors: Meteor[] = [];
    let nextMeteor = performance.now() + rand(1800, 4200);

    // 鼠标视差目标与当前值（后者做 lerp 缓动）
    let tx = 0;
    let ty = 0;
    let cx = 0;
    let cy = 0;

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (contained && root) {
        w = root.clientWidth || window.innerWidth;
        h = root.clientHeight || window.innerHeight;
      } else {
        w = window.innerWidth;
        h = window.innerHeight;
      }
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      layers = LAYERS.map((cfg) => ({
        depth: cfg.depth,
        stars: Array.from({ length: Math.floor((w * h) / cfg.density) }, () =>
          makeStar(w, h, cfg, cfg.depth > 20),
        ),
      }));
    };

    const onPointer = (e: PointerEvent) => {
      if (contained && root) {
        const rect = root.getBoundingClientRect();
        const px = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0;
        const py = rect.height > 0 ? (e.clientY - rect.top) / rect.height : 0;
        tx = (px - 0.5) * 2;
        ty = (py - 0.5) * 2;
      } else {
        tx = (e.clientX / window.innerWidth - 0.5) * 2;
        ty = (e.clientY / window.innerHeight - 0.5) * 2;
      }
    };

    const spawnMeteor = () => {
      const fromLeft = Math.random() < 0.5;
      const speed = rand(9, 15);
      const angle = rand(0.32, 0.6);
      meteors.push({
        x: fromLeft ? rand(-0.1, 0.5) * w : rand(0.5, 1.1) * w,
        y: rand(-0.15, 0.4) * h,
        vx: (fromLeft ? 1 : -1) * Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0,
        maxLife: rand(70, 115),
        len: rand(110, 220),
      });
    };

    let raf = 0;
    const draw = (t: number) => {
      const sec = t / 1000;
      ctx.clearRect(0, 0, w, h);

      // 视差缓动
      cx += (tx - cx) * 0.045;
      cy += (ty - cy) * 0.045;

      for (const layer of layers) {
        const ox = -cx * layer.depth;
        const oy = -cy * layer.depth;
        for (const s of layer.stars) {
          // 缓慢漂移 + 边界环绕
          s.x += s.vx * s.speed;
          s.y += s.vy * s.speed;
          if (s.x < -4) s.x = w + 4;
          if (s.x > w + 4) s.x = -4;
          if (s.y < -4) s.y = h + 4;
          if (s.y > h + 4) s.y = -4;

          // 呼吸闪烁
          const tw = 0.52 + 0.48 * Math.sin(sec * s.twinkleSpeed + s.phase);
          const a = s.base * tw;
          if (a < 0.012) continue;

          const px = s.x + ox;
          const py = s.y + oy;
          const isWarm = s.hue === 38;
          const rgb = isWarm ? "255, 214, 170" : "206, 226, 255";

          ctx.beginPath();
          ctx.fillStyle = `rgba(${rgb}, ${a})`;
          ctx.arc(px, py, s.r, 0, Math.PI * 2);
          ctx.fill();

          // 亮星加一层柔光
          if (s.r > 1.3) {
            const g = ctx.createRadialGradient(px, py, 0, px, py, s.r * 6);
            g.addColorStop(0, `rgba(${rgb}, ${a * 0.5})`);
            g.addColorStop(1, `rgba(${rgb}, 0)`);
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(px, py, s.r * 6, 0, Math.PI * 2);
            ctx.fill();
          }

          // 十字星芒（呼应参考图的四角星）
          if (s.flare) {
            const len = s.r * 7 * tw;
            ctx.strokeStyle = `rgba(${rgb}, ${a * 0.7})`;
            ctx.lineWidth = 0.7;
            ctx.beginPath();
            ctx.moveTo(px - len, py);
            ctx.lineTo(px + len, py);
            ctx.moveTo(px, py - len);
            ctx.lineTo(px, py + len);
            ctx.stroke();
          }
        }
      }

      // 流星
      if (t > nextMeteor) {
        spawnMeteor();
        nextMeteor = t + rand(5200, 11000);
      }
      meteors = meteors.filter((m) => m.life < m.maxLife);
      for (const m of meteors) {
        m.life += 1;
        m.x += m.vx;
        m.y += m.vy;
        const p = m.life / m.maxLife;
        const fade = Math.sin(p * Math.PI);
        const nx = m.x - m.vx * (m.len / Math.hypot(m.vx, m.vy));
        const ny = m.y - m.vy * (m.len / Math.hypot(m.vx, m.vy));
        const g = ctx.createLinearGradient(nx, ny, m.x, m.y);
        g.addColorStop(0, "rgba(255,255,255,0)");
        g.addColorStop(1, `rgba(255, 228, 190, ${0.85 * fade})`);
        ctx.strokeStyle = g;
        ctx.lineWidth = 1.6;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(nx, ny);
        ctx.lineTo(m.x, m.y);
        ctx.stroke();

        // 头部光点
        const hg = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, 9);
        hg.addColorStop(0, `rgba(255,240,214,${0.9 * fade})`);
        hg.addColorStop(1, "rgba(255,240,214,0)");
        ctx.fillStyle = hg;
        ctx.beginPath();
        ctx.arc(m.x, m.y, 9, 0, Math.PI * 2);
        ctx.fill();
      }

      raf = requestAnimationFrame(draw);
    };

    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onPointer);
    let observer: ResizeObserver | null = null;
    if (contained && root) {
      observer = new ResizeObserver(resize);
      observer.observe(root);
    }
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onPointer);
      observer?.disconnect();
    };
  }, [contained]);

  return (
    <div
      ref={rootRef}
      className={
        contained
          ? "pointer-events-none absolute inset-0 overflow-hidden"
          : "pointer-events-none fixed inset-0 -z-10 overflow-hidden"
      }
      aria-hidden="true"
    >
      {/* 深空底色：深蓝紫，比首页更暗更“深邃” */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(130% 95% at 50% 38%, #141c40 0%, #0b1130 38%, #05081a 72%, #03050f 100%)",
        }}
      />
      {/* 银河带：斜向穿过画面的蓝紫星云 */}
      <div
        className="absolute inset-0 opacity-80"
        style={{
          background:
            "radial-gradient(75% 30% at 22% 88%, rgba(58,72,190,0.42) 0%, rgba(40,52,150,0.16) 45%, transparent 72%)," +
            "radial-gradient(60% 26% at 78% 8%, rgba(122,72,200,0.30) 0%, transparent 68%)," +
            "radial-gradient(90% 20% at 50% 58%, rgba(30,90,190,0.20) 0%, transparent 70%)",
        }}
      />
      {/* 中心冷白光晕，把标题托出来（不与橙色强调冲突） */}
      <div
        className="animate-glow-breathe absolute left-1/2 top-1/2 h-[52rem] w-[52rem] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          background:
            "radial-gradient(circle, rgba(150,180,255,0.13) 0%, rgba(120,150,240,0.05) 34%, transparent 68%)",
        }}
      />
      {/* 中心暖橙微光：作为强调色呼应首页 */}
      <div
        className="absolute left-1/2 top-1/2 h-[30rem] w-[30rem] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          background:
            "radial-gradient(circle, rgba(245,165,36,0.10) 0%, transparent 68%)",
        }}
      />
      <canvas ref={canvasRef} className="animate-fade-in-up absolute inset-0" />
      {/* 四边压暗，让内容区更聚焦 */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 100% at 50% 45%, transparent 40%, rgba(3,5,15,0.55) 100%)",
        }}
      />
    </div>
  );
}
