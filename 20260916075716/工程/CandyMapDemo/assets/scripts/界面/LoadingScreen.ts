/**
 * 启动加载页 —— 照抄 Web 版 `#loading`（`web/index.html:444` + `web/ui.css:1319-1348`）。
 *
 * 视觉三件套（与 Web 逐项对齐）：
 *   1. 整页背景图 `ui/loading/bg.jpg`（cover 铺满，不留黑边）；
 *   2. 底部槽式进度条：920×148，距底 170px（1080×1920 坐标 → 中心 y = −716），
 *      槽内芯左右缩进 30 / 上下缩进 22（Web `.loading-clip` 的 inset），填充是橙黄条；
 *   3. 条内百分比：46px / 900 / 白色，带 0 3px 0 rgba(140,70,20,.65) 投影。
 *
 * 行为（与 Web `main.ts:3754-3782` 同口径）：
 *   - 进度**只增不减**（多目录并行预热时累计值会抖动，回退看着像卡住）；
 *   - **最短展示 1.2s**，避免本地缓存下「一闪而过」；
 *   - 100% 后 0.5s 淡出再销毁（Web `transition: opacity .5s`）。
 *
 * ⚠️ 不用 tween（预览 shim 未实现），一律 `setTimeout` 分段推进，与 `ResultPopup` 同一做法。
 */

import { Node, UITransform, Graphics, Label, Color, Layers, Sprite, SpriteFrame, UIOpacity, sys, resources } from 'cc';
import { STAGE_W, STAGE_H, mkText } from './uiPaint';
import { applyUiText } from './fontUtil';

/* ── 几何：全部来自 Web ui.css 的 1080×1920 CSS 盒 ── */
const BAR_W = 920;
const BAR_H = 148;
/** 条心 y：CSS `bottom:170px; height:148` → 底边 1920−170=1750，中心 1750−74=1676 → 960−1676 */
const BAR_CY = -716;
const SLOT_R = 74;
/** 内芯 = 槽 inset 左右 30 / 上下 22（Web `.loading-clip`） */
const CLIP_W = BAR_W - 60;
const CLIP_H = BAR_H - 44;
const CLIP_R = 52;
const NUM_FS = 46;

const MIN_SHOW_MS = 1200;
const FADE_MS = 500;

const C_SLOT = new Color(91, 58, 28, 255);        // 槽体深棕
const C_SLOT_EDGE = new Color(220, 173, 98, 255); // 金边（与项目金框同色）
const C_CLIP = new Color(46, 27, 11, 255);        // 内芯（更深的槽底）
const C_FILL = new Color(255, 176, 46, 255);      // bar-fill 主色
const C_FILL_TOP = new Color(255, 216, 130, 255); // 填充顶部高光
const C_NUM = new Color(255, 255, 255, 255);
const C_NUM_SHADOW = new Color(140, 70, 20, 165);

export class LoadingScreen {
  private root: Node = null!;
  private bar: Node = null!;
  private fillG: Graphics = null!;
  private num: Label = null!;
  private value = 0;
  private closing = false;
  private readonly startedAt = Date.now();

  private constructor() { }

  static create(parent: Node): LoadingScreen {
    const s = new LoadingScreen();
    s.build(parent);
    return s;
  }

  rootNode(): Node { return this.root; }

  /** 设置进度（0~100，只增不减 —— 回退看着像卡死） */
  setProgress(p: number): void {
    if (!this.root?.isValid) return;
    const v = Math.max(this.value, Math.min(100, Math.round(p)));
    if (v === this.value) return;
    this.value = v;
    this.paintFill(v);
    if (this.num?.isValid) applyUiText(this.num, `${v}%`, 'bold');
  }

  /** 补到 100% → 等够最短展示时长 → 淡出销毁 */
  async finish(): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    this.setProgress(100);
    // 静态首屏 DOM（build-templates 里那份）此刻交棒：它盖在 canvas 上，
    // 不摘掉的话场景内的加载页永远被挡住 —— 但**只在 100% 时摘**，
    // 否则玩家会看到「DOM 显示 90% → 突然变成场景的 3%」。
    this.removeBootDom();
    const wait = Math.max(0, MIN_SHOW_MS - (Date.now() - this.startedAt));
    if (wait > 0) await new Promise<void>((r) => setTimeout(r, wait));
    this.fadeOut();
  }

  destroy(): void {
    this.removeBootDom();   // 兜底：finish 没走完就销毁时，别把 DOM 加载页留在页面上
    if (this.root?.isValid) this.root.destroy();
  }

  /** 摘掉 web 构建模板里的静态首屏（小游戏没有 DOM，直接跳过） */
  private removeBootDom(): void {
    if (!sys.isBrowser) return;
    try {
      const doc = (globalThis as { document?: Document }).document;
      const el = doc?.getElementById('boot-loading');
      if (!el) return;
      el.classList.add('done');
      setTimeout(() => { el.parentNode?.removeChild(el); }, 450);
    } catch {
      /* DOM 被宿主改过 / 摸不到 document：不影响游戏 */
    }
  }

  /* ---------------------------------------------------------------- 构建 */

  private build(parent: Node): void {
    const root = new Node('LoadingScreen');
    root.layer = Layers.Enum.UI_2D;
    root.addComponent(UITransform).setContentSize(STAGE_W, STAGE_H);
    root.parent = parent;
    root.setPosition(0, 0, 0);
    root.addComponent(UIOpacity);
    this.root = root;

    // 兜底底色：背景图是异步加载的（约 700KB），读不到时也不能是黑洞
    const fallback = new Node('fallbackSky');
    fallback.layer = Layers.Enum.UI_2D;
    fallback.addComponent(UITransform).setContentSize(STAGE_W, STAGE_H);
    fallback.parent = root;
    const fg = fallback.addComponent(Graphics);
    fg.fillColor = new Color(111, 169, 234, 255);   // SKY_B
    fg.rect(-STAGE_W / 2, -STAGE_H / 2, STAGE_W, STAGE_H);
    fg.fill();

    this.buildBg(root);
    this.buildBar(root);
  }

  /** 整页背景：`ui/loading/bg.jpg` 按 cover 铺满（与 CSS `center / cover` 同义） */
  private buildBg(root: Node): void {
    const n = new Node('bg');
    n.layer = Layers.Enum.UI_2D;
    n.addComponent(UITransform).setContentSize(STAGE_W, STAGE_H);
    n.parent = root;
    const sp = n.addComponent(Sprite);
    sp.sizeMode = Sprite.SizeMode.CUSTOM;
    sp.trim = false;
    resources.load('ui/loading/bg', SpriteFrame, (err, sf) => {
      if (err || !sf || !n.isValid) return;   // 读不到就留兜底色，不挡加载流程
      sp.spriteFrame = sf;
      // cover：等比放大到「两边都不留空」
      const k = Math.max(STAGE_W / sf.width, STAGE_H / sf.height);
      n.getComponent(UITransform)!.setContentSize(sf.width * k, sf.height * k);
    });
  }

  /** 槽 + 内芯（静态，一次画完）+ 填充（动态重绘）+ 百分比 */
  private buildBar(root: Node): void {
    const bar = new Node('bar');
    bar.layer = Layers.Enum.UI_2D;
    bar.addComponent(UITransform).setContentSize(BAR_W, BAR_H);
    bar.parent = root;
    bar.setPosition(0, BAR_CY, 0);
    this.bar = bar;

    const g = bar.addComponent(Graphics);
    // 槽体 + 金边
    g.fillColor = C_SLOT;
    g.roundRect(-BAR_W / 2, -BAR_H / 2, BAR_W, BAR_H, SLOT_R);
    g.fill();
    g.lineWidth = 6;
    g.strokeColor = C_SLOT_EDGE;
    g.roundRect(-BAR_W / 2 + 3, -BAR_H / 2 + 3, BAR_W - 6, BAR_H - 6, SLOT_R - 3);
    g.stroke();
    // 内芯（填充区域的地面）
    g.fillColor = C_CLIP;
    g.roundRect(-CLIP_W / 2, -CLIP_H / 2, CLIP_W, CLIP_H, CLIP_R);
    g.fill();

    const fill = new Node('fill');
    fill.layer = Layers.Enum.UI_2D;
    fill.addComponent(UITransform).setContentSize(CLIP_W, CLIP_H);
    fill.parent = bar;
    this.fillG = fill.addComponent(Graphics);
    this.paintFill(this.value);

    // 百分比：深棕投影 + 白字（Web 的 text-shadow 0 3px 0）
    mkText(bar, '0%', NUM_FS, 0, -3, C_NUM_SHADOW, CLIP_W, true, 'center');
    this.num = mkText(bar, '0%', NUM_FS, 0, 0, C_NUM, CLIP_W, true, 'center');
    applyUiText(this.num, '0%', 'bold');
  }

  private paintFill(p: number): void {
    const g = this.fillG;
    if (!g?.isValid) return;
    g.clear();
    const w = Math.round((CLIP_W * p) / 100);
    if (w <= 0) return;
    const r = Math.min(CLIP_R, w / 2);
    const x = -CLIP_W / 2 + w / 2;
    g.fillColor = C_FILL;
    g.roundRect(x - w / 2, -CLIP_H / 2, w, CLIP_H, r);
    g.fill();
    // 顶部高光：切图 bar-fill 是上亮下深的橙黄渐变，这里用一条细亮带近似
    if (w > 24) {
      g.fillColor = C_FILL_TOP;
      g.roundRect(x - w / 2 + 8, CLIP_H / 2 - 26, w - 16, 12, 6);
      g.fill();
    }
  }

  private fadeOut(): void {
    const op = this.root?.getComponent(UIOpacity);
    if (!op) { this.destroy(); return; }
    const steps = 10;
    for (let i = 1; i <= steps; i++) {
      setTimeout(() => {
        if (op.isValid) op.opacity = Math.round(255 * (1 - i / steps));
      }, (FADE_MS / steps) * i);
    }
    setTimeout(() => this.destroy(), FADE_MS + 30);
  }
}
