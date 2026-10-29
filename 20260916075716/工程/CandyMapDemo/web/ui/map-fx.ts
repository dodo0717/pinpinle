/**
 * ⚠️ 本文件当前**停用**（2026-10-29 用户要求"动画这块先放着"）—— 没有任何地方 import 它，
 *    运行时不产生任何动效。等美术的新动效素材到位后再接回，接回方法见
 *    `map.ts` 里 `track.appendChild(bg)` 上方的注释（要一并加回 townFx 变量与 destroy 块，
 *    否则切世界重建 DOM 时旧的 rAF 循环会空转泄漏）。
 *
 * 小镇地图的**程序化动效**（2026-10-29）。
 *
 * 背景：用户要求"角色、风车、喷水池动起来"。AI 生成的整张动效视频与底图
 * 是**两次独立生成、构图对不上**（帧差验证过），直接铺会把节点位置带错；
 * 而全画面序列帧体积/内存都不可行（24 帧 ≈ 44MB 纹理）。
 * 所以走**零素材程序化**：粒子 + 光效全部由 canvas 画出来 ——
 *   ① 云影：大块柔光缓慢平移（画面"呼吸感"的主要来源）；
 *   ② 樱花瓣：全图飘落（小镇 = 樱花主题）；
 *   ③ 喷泉水花：水滴抛物线粒子（位置对准底图右下的喷泉）；
 *   ④ 水面波光：河面/池塘上的闪烁光点；
 *   ⑤ 光尘：全图稀疏的暖色亮点。
 *
 * 角色/风车的"真动作"需要序列帧或抠图（这轮先不做，见 README 待办）。
 *
 * 实现要点：
 *   - 挂在 `.map-bg` 里（底图之上、节点之下），坐标与节点同一套 stage px，
 *     自动跟随 track 的 fitScale 缩放与滚动，不需要单独处理；
 *   - canvas 内部用 **0.5 倍分辨率**（1536×5462 全分辨率 = 33MB 位图内存，手机吃不消；
 *     粒子本来就是柔光，半分辨率毫无观感差异），ctx.scale(0.5) 一次性搞定；
 *   - `destroy()` 必须 cancel rAF —— `buildWorld` 每次 render 都会重建 DOM，
 *     不销毁的话旧循环会一直空转（引用着已移除的 canvas）。
 */

export interface MapFx {
  /** 停掉动画循环并移除 canvas（buildWorld 重建前必须调） */
  destroy(): void;
}

/** stage 坐标：底图铺满轨道，归一化坐标直接乘这两个数 */
const STAGE_W = 1536;
const H_DEFAULT = 5462;
/** canvas 内部分辨率系数（0.5 = 半分辨率，内存减 75%） */
const RES = 0.5;

/** 底图上的特征点（归一化坐标，按 1080×3840 底图目视标定） */
const FOUNTAIN = { x: 0.833, y: 0.758 };   // 右下喷泉口
const WATER = { x0: 0.02, y0: 0.775, x1: 0.52, y1: 0.995 }; // 左下河面+池塘

interface Petal { x: number; y: number; vy: number; amp: number; ph: number; size: number; tone: number }
interface Spark { x: number; y: number; ph: number; period: number; size: number }
interface Drop { x: number; y: number; vx: number; vy: number; life: number }
interface Glint { x: number; y: number; ph: number; period: number; size: number }
interface Cloud { x: number; y: number; r: number; v: number; a: number }

export interface TownFxOptions {
  /**
   * 是否画**按底图坐标定位**的粒子（喷泉水花 / 水面波光）。
   * ⚠️ 小镇改用**动效视频**当背景后要传 `false` —— 视频与那张高清底图是两次独立生成、
   * 构图不同，按旧坐标画的喷泉会飘到错误的位置。全局效果（云影/花瓣/光尘）不受影响。
   */
  located?: boolean;
  /** 轨道总高（stage px）：单屏世界必须传，否则粒子按两屏高度分布、画到画布外 */
  height?: number;
}

export function mountTownFx(bg: HTMLElement, opts?: TownFxOptions): MapFx {
  const located = opts?.located ?? true;
  /** 轨道总高：两屏 5462 / 单屏（视频当背景）2731 —— 必须跟实际轨道一致，否则粒子画到画布外 */
  const H = opts?.height ?? STAGE_H_DEFAULT;
  const canvas = document.createElement('canvas');
  canvas.className = 'map-fx';
  canvas.width = Math.round(STAGE_W * RES);
  canvas.height = Math.round(H * RES);
  bg.appendChild(canvas);
  const g = canvas.getContext('2d');
  if (!g) return { destroy() { canvas.remove(); } };
  g.scale(RES, RES);

  const rand = (lo: number, hi: number): number => lo + Math.random() * (hi - lo);

  /* ---- 粒子初始状态 ---- */
  const petals: Petal[] = Array.from({ length: 18 }, () => ({
    x: rand(0, STAGE_W), y: rand(0, H),
    vy: rand(26, 52), amp: rand(16, 42), ph: rand(0, 7),
    size: rand(5, 10), tone: Math.random(),
  }));
  const sparks: Spark[] = Array.from({ length: 14 }, () => ({
    x: rand(30, STAGE_W - 30), y: rand(60, H - 60),
    ph: rand(0, 7), period: rand(2.2, 4.5), size: rand(2, 3.6),
  }));
  const glints: Glint[] = Array.from({ length: 18 }, () => ({
    x: rand(WATER.x0, WATER.x1) * STAGE_W,
    y: rand(WATER.y0, WATER.y1) * H,
    ph: rand(0, 7), period: rand(1.6, 3.2), size: rand(2, 5),
  }));
  const clouds: Cloud[] = Array.from({ length: 3 }, (_, i) => ({
    x: rand(0, STAGE_W), y: H * (0.18 + i * 0.3),
    r: rand(240, 400), v: rand(7, 13), a: rand(0.05, 0.085),
  }));
  const drops: Drop[] = [];
  const FX = FOUNTAIN.x * STAGE_W;
  const FY = FOUNTAIN.y * H;
  let dropAcc = 0;

  let raf = 0;
  let last = performance.now();
  const tick = (now: number): void => {
    const dt = Math.min(0.05, (now - last) / 1000); // 切后台回来不跳变
    last = now;
    const t = now / 1000;
    g.clearRect(0, 0, STAGE_W, H);

    /* ① 云影（最先画，垫底） */
    for (const c of clouds) {
      c.x += c.v * dt;
      if (c.x - c.r > STAGE_W) c.x = -c.r;
      const grad = g.createRadialGradient(c.x, c.y, 0, c.x, c.y, c.r);
      grad.addColorStop(0, `rgba(255,255,255,${c.a})`);
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(c.x - c.r, c.y - c.r, c.r * 2, c.r * 2);
    }

    /* ② 樱花瓣 */
    for (const p of petals) {
      p.y += p.vy * dt;
      if (p.y > H + 12) { p.y = -12; p.x = rand(0, STAGE_W); }
      const x = p.x + Math.sin(t * 0.9 + p.ph) * p.amp;
      const rot = t * 1.3 + p.ph;
      g.save();
      g.translate(x, p.y);
      g.rotate(rot);
      g.fillStyle = p.tone < 0.6 ? 'rgba(255,205,222,0.75)' : 'rgba(255,244,248,0.85)';
      g.beginPath();
      g.ellipse(0, 0, p.size, p.size * 0.45, 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }

    /* ③ 喷泉水花（需要底图坐标 → 视频模式下跳过） */
    if (located) {
      dropAcc += dt * 15;
      while (dropAcc >= 1 && drops.length < 26) {
        dropAcc -= 1;
        drops.push({
          x: FX + rand(-14, 14), y: FY + rand(-6, 6),
          vx: rand(-55, 55), vy: rand(-320, -230), life: rand(0.7, 1.1),
        });
      }
      for (let i = drops.length - 1; i >= 0; i--) {
        const d = drops[i]!;
        d.life -= dt;
        d.vy += 560 * dt;
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        if (d.life <= 0 || d.y > FY + 90) { drops.splice(i, 1); continue; }
        g.fillStyle = `rgba(234,246,255,${Math.max(0, Math.min(0.85, d.life)).toFixed(2)})`;
        g.beginPath();
        g.arc(d.x, d.y, rand(2.2, 3.4), 0, Math.PI * 2);
        g.fill();
      }
    }

    /* ④ 水面波光（同上，需要底图坐标） */
    if (located) {
      for (const w of glints) {
        const a = Math.pow(Math.max(0, Math.sin(t * (Math.PI * 2 / w.period) + w.ph)), 3) * 0.55;
        if (a < 0.02) continue;
        g.fillStyle = `rgba(255,255,255,${a.toFixed(2)})`;
        g.beginPath();
        g.ellipse(w.x, w.y, w.size * 2.2, w.size * 0.7, 0, 0, Math.PI * 2);
        g.fill();
      }
    }

    /* ⑤ 光尘 */
    for (const s of sparks) {
      const a = Math.pow(Math.max(0, Math.sin(t * (Math.PI * 2 / s.period) + s.ph)), 3) * 0.8;
      if (a < 0.03) continue;
      g.fillStyle = `rgba(255,246,201,${a.toFixed(2)})`;
      g.beginPath();
      g.arc(s.x, s.y, s.size, 0, Math.PI * 2);
      g.fill();
    }

    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  return {
    destroy(): void {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      canvas.remove();
    },
  };
}
