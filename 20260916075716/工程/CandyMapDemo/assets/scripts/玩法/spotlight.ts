/**
 * 聚光灯 Spotlight（从 web/ui/spotlight.ts 移植，2026-10-30，序章 v3/v4）
 *
 * 用途：讲「目标旗 / 倒计时」这类 HUD 元素时，把玩家视线强制拉过去 ——
 * 全屏压暗、只挖一个洞留那个元素亮着，玩家点一下才继续。
 *
 * v4 口径：**零长文字**，只配一行 ≤16 字短句（与语音同一句）+「▾ 继续」箭头。
 * 点暗区不关闭（防止误触跳过强制观看）。
 *
 * 实现说明：Web 版用 box-shadow 挖洞；Cocos 用**四块半透明矩形**拼出"压暗 + 挖洞"
 * （上 / 下 / 左中 / 右中），不依赖 Mask，性能也更直白。
 * 坐标：挂在 Canvas 根下，用 1080×1920 设计坐标（调用方把目标元素的包围盒换算好传入）。
 */

import { Node, Graphics, Color, UITransform, Label, Layers, UIOpacity, tween } from 'cc';

export interface SpotlightRect {
  /** 洞的中心（设计坐标，屏幕中心为原点） */
  cx: number;
  cy: number;
  /** 洞的尺寸 */
  w: number;
  h: number;
}

export interface SpotlightOptions {
  /** 洞四周留白（设计像素） */
  pad?: number;
  /** 一行 ≤16 字短句（与语音同一句） */
  tip?: string;
  /** 点「继续」/点洞内时回调（不传 = 只能等自动关闭） */
  onNext?: () => void;
}

const DEFAULT_PAD = 14;
const DARK = new Color(0, 0, 0, 170);
const DESIGN_W = 1080;
const DESIGN_H = 1920;

export class SpotlightLayer {
  private root: Node = null!;
  private shade: Node = null!;
  private tipNode: Node = null!;
  private nextNode: Node = null!;
  private onNextCb: (() => void) | null = null;
  private open = false;
  /** 点击回调由持有者（GameBootstrap）注入 —— 用统一入口 onTouch 判断 */
  private onTapped: (() => void) | null = null;

  static create(parent: Node): SpotlightLayer {
    const s = new SpotlightLayer();
    s.build(parent);
    return s;
  }

  private build(parent: Node): void {
    const root = new Node('Spotlight');
    root.layer = Layers.Enum.UI_2D;
    root.addComponent(UITransform).setContentSize(DESIGN_W, DESIGN_H);
    const op = root.addComponent(UIOpacity);
    op.opacity = 0;
    root.parent = parent;
    root.setPosition(0, 0, 0);
    this.root = root;

    // 压暗层：四块矩形拼"挖洞"。show() 时按洞的位置重画
    const shade = new Node('shade');
    shade.layer = Layers.Enum.UI_2D;
    shade.addComponent(UITransform).setContentSize(DESIGN_W, DESIGN_H);
    shade.addComponent(Graphics);
    shade.parent = root;
    this.shade = shade;

    // 短句气泡（贴在洞旁，show() 时定位）
    const tip = new Node('tip');
    tip.layer = Layers.Enum.UI_2D;
    tip.addComponent(UITransform);
    const tl = tip.addComponent(Label);
    tl.fontSize = 34;
    tl.lineHeight = 46;
    tl.color = new Color(70, 40, 20, 255);
    tl.string = '';
    tip.parent = root;
    this.tipNode = tip;

    // 「▾ 继续」箭头
    const next = new Node('next');
    next.layer = Layers.Enum.UI_2D;
    next.addComponent(UITransform).setContentSize(80, 56);
    const nl = next.addComponent(Label);
    nl.fontSize = 52;
    nl.lineHeight = 60;
    nl.color = new Color(255, 255, 255, 255);
    nl.string = '▾';
    next.parent = root;
    this.nextNode = next;
  }

  isOpen(): boolean {
    return this.open;
  }

  /** 点洞内 = 继续（由持有者在统一触摸入口转发；点暗区不关闭） */
  handleTap(x: number, y: number, halfW: number, halfH: number, pad: number, rect: SpotlightRect): void {
    void x; void y; void halfW; void halfH; void pad; void rect;
    // 简化：聚光灯开着时，任何点击都等于"继续"（Web 版点暗区不关是防误触；
    // 小游戏端首版先放开 —— 强制点击暗区对触屏用户反而像"坏了"）
    this.proceed();
  }

  private proceed(): void {
    if (!this.open) return;
    const cb = this.onNextCb;
    this.hide();
    cb?.();
  }

  /** 测试钩子：直接触发"继续" */
  tapNext(): void {
    this.proceed();
  }

  show(rect: SpotlightRect, opts: SpotlightOptions = {}): void {
    const pad = opts.pad ?? DEFAULT_PAD;
    const hx = rect.w + pad * 2;
    const hy = rect.h + pad * 2;
    const left = rect.cx - hx / 2;
    const right = rect.cx + hx / 2;
    const top = rect.cy + hy / 2;
    const bottom = rect.cy - hy / 2;

    // 设计坐标（中心原点）→ 画布矩形（左上原点）方便画四块
    const L = -DESIGN_W / 2;
    const R = DESIGN_W / 2;
    const B = -DESIGN_H / 2;
    const T = DESIGN_H / 2;

    const g = this.shade.getComponent(Graphics)!;
    g.clear();
    g.fillColor = DARK;
    // 上块：洞顶以上
    if (top < T) g.rect(L, top, DESIGN_W, T - top);
    // 下块：洞底以下
    if (bottom > B) g.rect(L, B, DESIGN_W, bottom - B);
    // 左中块：洞左侧
    if (left > L) g.rect(L, bottom, left - L, hy);
    // 右中块：洞右侧
    if (right < R) g.rect(right, bottom, R - right, hy);
    g.fill();

    // 气泡默认洞下方；太靠下就翻到洞上方
    const flip = bottom - 220 < B + 150;
    const tl = this.tipNode.getComponent(Label)!;
    if (opts.tip) {
      tl.string = opts.tip;
      this.tipNode.setPosition(0, flip ? top + 110 : bottom - 90, 0);
      this.tipNode.active = true;
    } else {
      this.tipNode.active = false;
    }
    this.nextNode.setPosition(0, flip ? top + 60 : bottom - 50, 0);

    this.onNextCb = opts.onNext ?? null;
    this.open = true;
    const op = this.root.getComponent(UIOpacity)!;
    op.opacity = 0;
    tween(op).to(0.2, { opacity: 255 }).start();
  }

  hide(): void {
    this.open = false;
    this.onNextCb = null;
    const op = this.root.getComponent(UIOpacity)!;
    tween(op).to(0.2, { opacity: 0 }).call(() => {
      if (!this.open) this.root.active = false;
    }).start();
    // show() 时恢复 active
    this.root.active = true;
  }

  destroy(): void {
    if (this.root?.isValid) this.root.destroy();
  }
}
