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

import { Node, Graphics, Sprite, Color, UITransform, Label, Layers, UIOpacity, tween, director, Director } from 'cc';
import { mkSprite, setSprite } from '../界面/uiPaint';

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
/** Web `.spot-hole` 的挖洞压暗：`rgba(12, 6, 0, .74)`（原来写成纯黑 67%，偏冷也偏重） */
const DARK = new Color(12, 6, 0, 189);
/** `.spot-tip` 贴图高：本体 98（line 54 + padding 22*2）居中，四周 34 是 `0 10px 24px` 的留白 */
const TIP_BG_H = 166;
const DESIGN_W = 1080;
const DESIGN_H = 1920;

/* ↓↓↓ 以下常量逐条对齐 web/ui.css 的 .spot-tip / .spot-next（不要凭感觉改） ↓↓↓ */
/** 气泡宽度：Web 是 `Math.min(360, innerWidth - 32)`，设计坐标下取 360 */
const TIP_W = 360;
/** 内边距：Web `padding: 22px 26px`（上下的和左右的不是同一个数） */
const TIP_PAD_V = 22;
const TIP_PAD_H = 26;
/** 圆角：Web `border-radius: 22px` */
const TIP_R = 22;
/** 字号 / 行高：Web `font-size: 40px; line-height: 1.35` */
const TIP_FONT = 40;
const TIP_LINE = 54;
/** 文字色 #6d3f00 */
const TIP_TEXT = new Color(109, 63, 0, 255);
/** 渐变底两色：#fff8e6（上）→ #ffe6b8（下） */
const TIP_TOP = new Color(255, 248, 230, 255);
const TIP_BOTTOM = new Color(255, 230, 184, 255);
/** 描边：Web `border: 5px solid rgba(190,130,50,.8)` */
const TIP_BORDER = new Color(190, 130, 50, 204);
const TIP_BORDER_W = 5;
/** 「▾ 继续」圆钮：Web `76×76 / background rgba(255,200,90,.95) / color #7a4100 / 44px` */
const NEXT_D = 76;
const NEXT_BG = new Color(255, 200, 90, 242);
const NEXT_TEXT = new Color(122, 65, 0, 255);
const NEXT_FONT = 44;
/* ↑↑↑ 常量区结束 ↑↑↑ */

export class SpotlightLayer {
  private root: Node = null!;
  private shade: Node = null!;
  /** 气泡底板（`.spot-tip` 的渐变底 + 描边，随文字行数变形） */
  private tipBg: Node = null!;
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

    // 气泡底板（先于文字加，渲染在文字下层）→ 预烘焙九宫格贴图
    const tipBg = new Node('tipBg');
    tipBg.layer = Layers.Enum.UI_2D;
    tipBg.addComponent(UITransform).setContentSize(TIP_W, TIP_BG_H);
    tipBg.parent = root;
    const tsp = tipBg.addComponent(Sprite);
    tsp.sizeMode = Sprite.SizeMode.CUSTOM;
    tsp.type = Sprite.Type.SLICED;
    setSprite(tsp, 'fx/spot-tip');
    this.tipBg = tipBg;

    // 短句气泡（贴在洞旁，show() 时按文字行数重画底板）
    const tip = new Node('tip');
    tip.layer = Layers.Enum.UI_2D;
    tip.addComponent(UITransform).setContentSize(TIP_W - TIP_PAD_H * 2, TIP_LINE);
    const tl = tip.addComponent(Label);
    tl.fontSize = TIP_FONT;
    tl.lineHeight = TIP_LINE;
    tl.color = TIP_TEXT;
    tl.string = '';
    // ⚠️ 打包后 cc 命名空间里的枚举可能被摇掉（CameraProjection 就是这么没的），
    //    这里直接用数值：HorizontalAlign/VerticalAlign.CENTER = 1、Overflow.RESIZE_HEIGHT = 3
    (tl as unknown as { horizontalAlign: number }).horizontalAlign = 1;
    (tl as unknown as { verticalAlign: number }).verticalAlign = 1;
    (tl as unknown as { overflow: number }).overflow = 3;
    tip.parent = root;
    this.tipNode = tip;

    // 「▾ 继续」圆钮（Web: 76×76 圆形 + rgba(255,200,90,.95) 底 + #7a4100 44px）
    const next = new Node('next');
    next.layer = Layers.Enum.UI_2D;
    // 贴图 108×124：本体 76 居中，四周是 `0 6px 16px` 阴影的留白
    next.addComponent(UITransform).setContentSize(NEXT_D + 32, NEXT_D + 48);
    mkSprite(next, 'fx/spot-next', NEXT_D + 32, NEXT_D + 48);
    const nl = next.addComponent(Label);
    nl.fontSize = NEXT_FONT;
    nl.lineHeight = NEXT_D;
    nl.color = NEXT_TEXT;
    nl.string = '▾';
    (nl as unknown as { horizontalAlign: number }).horizontalAlign = 1;
    (nl as unknown as { verticalAlign: number }).verticalAlign = 1;
    // ⚠️ Label 默认 overflow=NONE 会把节点尺寸改成文字大小，76×76 的圆钮会被挤成 37×96。
    //    这里改成 CLAMP(1)：保持圆钮尺寸，文字在圆里居中。
    (nl as unknown as { overflow: number }).overflow = 1;
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

  /**
   * 按字符宽度估算要排几行（全角算一个字宽、半角算半个）。
   *
   * ⚠️ 遍历字符串必须用 `Array.from`：构建器会把 `[...text]` 降级成 `[].concat(text)`，
   *    对迭代器语义是错的（库里 poolGen.ts 踩过同一个坑）。
   */
  private estimateLines(text: string): number {
    const maxW = TIP_W - TIP_PAD_H * 2;
    let lineW = 0;
    let lines = 1;
    for (const ch of Array.from(text)) {
      const cw = (ch.codePointAt(0) ?? 0) > 255 ? TIP_FONT : TIP_FONT * 0.5;
      if (lineW + cw > maxW) {
        lines++;
        lineW = cw;
      } else {
        lineW += cw;
      }
    }
    return Math.max(1, lines);
  }

  /**
   * 气泡水平夹取：Web `Math.min(Math.max(16, center - w/2), innerWidth - w - 16)`
   * —— 气泡靠边时不再往外顶。
   */
  private clampTipX(centerX: number): number {
    const min = -DESIGN_W / 2 + 16 + TIP_W / 2;
    const max = DESIGN_W / 2 - 16 - TIP_W / 2;
    return Math.min(Math.max(centerX, min), max);
  }

  /**
   * 画气泡底板并按文字行数摆好位置。
   *
   * Label 要换行到第几行，**渲染之后**才写回 contentSize —— 过早读到的是上一状态
   * （实测：即使挂在 Director.EVENT_AFTER_DRAW 上，拿到的还是旧值）。
   * 所以高度取「实测值与估算值的较大者」，宁可底板略高，也不能包不住文字漏出来。
   */
  private layoutTip(cssTopPos: number, cx: number): void {
    const tl = this.tipNode.getComponent(Label)!;
    const force = tl as unknown as { updateRenderData?: (f: boolean) => void };
    if (typeof force.updateRenderData === 'function') force.updateRenderData(true);
    const ut = this.tipNode.getComponent(UITransform)!;
    const estimated = this.estimateLines(tl.string) * TIP_LINE;
    const textH = Math.max(ut.contentSize.height || 0, estimated);
    const h = textH + TIP_PAD_V * 2;
    const w = TIP_W;
    const r = TIP_R;
    const hx = w / 2;
    const hy = h / 2;

    // 气泡本体 → 预烘焙九宫格（渐变 #fff8e6→#ffe6b8 + 5px 金边 + 圆角 22 + `0 10px 24px` 阴影）。
    //    ⚠️ 原来用 Graphics：渐变只能靠「上半块 + 下半块」两截逼近（中间一条硬接缝），
    //    阴影是一块**不透明的实心圆角矩形**（Web 是高斯模糊），圆角也是三角化硬边。
    //    贴图 400×166 里本体只有 98 高居中，四周是留给阴影的透明边 → 节点按 166 高建即可。
    void hy; void r;

    const y = DESIGN_H / 2 - (cssTopPos + h / 2);
    // 节点高度用贴图的 166（本体 98 居中，四周是阴影留白），宽度随文案 → 九宫格横向拉伸
    this.tipBg.getComponent(UITransform)!.setContentSize(w, TIP_BG_H);
    this.tipBg.setPosition(cx, y, 0);
    this.tipNode.setPosition(cx, y, 0);
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

    // ⚠️ 下面这一段是 Web `spotlight.ts:96-113` 的逐行搬运：CSS 用「左上原点、y 向下」，
    //    这里先换算成 CSS 的 top/left 算完，再翻回 Cocos 的中心坐标，避免自己另起一套。
    const cssTop = T - top;      // 洞顶到屏幕上边缘
    const cssBottom = T - bottom;
    const below = cssBottom + 24;
    const flip = below > DESIGN_H - 150;   // 太靠下就翻到洞上方

    if (opts.tip) {
      this.tipNode.getComponent(Label)!.string = opts.tip;
      this.tipNode.active = true;
      this.tipBg.active = true;
      const tipCssTop = flip ? Math.max(70, cssTop - 104) : cssBottom + 96;
      const tipCx = this.clampTipX(rect.cx);
      this.layoutTip(tipCssTop, tipCx);
      // Label 的真实行数只有**渲染之后**才写回 contentSize（实测：下一帧读到的还是上一状态），
      // 所以这里挂在 Director.EVENT_AFTER_DRAW 上重画一次底板。
      // ⚠️ 枚举常量同样可能被摇掉，取不到就用字面量 'after-draw'。
      const afterDraw = (Director as unknown as { EVENT_AFTER_DRAW?: string }).EVENT_AFTER_DRAW ?? 'after-draw';
      director.once(afterDraw, () => this.layoutTip(tipCssTop, tipCx));
    } else {
      this.tipNode.active = false;
      this.tipBg.active = false;
    }
    const nextCssTop = flip ? Math.max(12, cssTop - 96) : below;
    this.nextNode.setPosition(rect.cx, T - (nextCssTop + NEXT_D / 2), 0);

    this.onNextCb = opts.onNext ?? null;
    this.open = true;
    // ⚠️ 必须在这里把整层点亮：`hide()` 会把它置为 false，而 tween 只改透明度。
    //    少了这一行，聚光灯**永远不显示**（只听得到横幅的文字独白）。
    this.root.active = true;
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
