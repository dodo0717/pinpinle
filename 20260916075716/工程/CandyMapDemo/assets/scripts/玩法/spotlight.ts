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

import { Node, Graphics, Sprite, Color, UITransform, Label, Layers, UIOpacity, tween, Tween, Vec3, director, Director } from 'cc';
import { mkSprite, setSprite } from '../界面/uiPaint';
import { applyUiFont } from '../界面/fontUtil';

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
/** Web `.spot-tip` 贴图（fx/spot-tip 400×166）：本体 98（padding 22*2 + 行高 54）居中，上下各 34 是 `0 10px 24px` 的阴影留白 */
const TIP_TEX_MARGIN = 34;
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
  /** 气泡入场动画进行中（spotTipIn：layoutTip 重入时保持起始偏移，见 playTipIn） */
  private tipEntering = false;
  /** 气泡本体的目标中心 y（layoutTip 算出，playTipIn 落回这里） */
  private tipBaseY = 0;
  /** 点击回调由持有者（GameBootstrap）注入 —— 用统一入口 onTouch 判断 */
  private onTapped: (() => void) | null = null;
  /** 洞的四块「圆角补丁」：Web `.spot-hole` 是 radius 26 的圆角矩形，四块矩形围出的是直角 */
  private corners: Node[] = [];
  /** 洞外的呼吸金环（Web `spotBreath`：spread 4↔12 的 rgba(255,210,100,.55↔.18)） */
  private ring: Node = null!;
  /** 全屏拦截层：点暗区**不关闭也不透传**（Web `.spot` 是 fixed inset:0 盖住一切） */
  private blocker: Node = null!;
  /** 洞的点击热区（透明节点，尺寸=洞，show() 时按洞摆放） */
  private holeHit: Node = null!;

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

    /*
     * 全屏拦截层：Web `.spot` 是 `position:fixed; inset:0` 的遮罩，暗区点了**什么都不发生**、
     * 也落不到下面的棋盘上。Cocos 里若不加这层，触摸会穿过聚光灯落到棋盘上
     * （聚光灯开着还能拖格子）。空监听 = 吃掉事件但不做任何事。
     */
    const blocker = new Node('blocker');
    blocker.layer = Layers.Enum.UI_2D;
    blocker.addComponent(UITransform).setContentSize(DESIGN_W, DESIGN_H);
    blocker.on(Node.EventType.TOUCH_END, () => { /* 暗区：不关闭、不透传 */ });
    blocker.parent = root;
    this.blocker = blocker;

    // 压暗层：四块矩形拼"挖洞"。show() 时按洞的位置重画
    const shade = new Node('shade');
    shade.layer = Layers.Enum.UI_2D;
    shade.addComponent(UITransform).setContentSize(DESIGN_W, DESIGN_H);
    shade.addComponent(Graphics);
    shade.parent = root;
    this.shade = shade;

    /*
     * ⚠️ 四块矩形围出来的洞是**直角**，而 Web `.spot-hole` 是 `border-radius: 26` 的圆角矩形
     *    —— 每个角都少遮了一块月牙，看着就是"洞角是尖的"。这里补四块 26×26 的圆角补丁
     *    （贴图 = 填遮罩色后挖掉一个 r=26 的圆），四个角靠 scaleX/scaleY = ±1 翻转复用一张。
     */
    for (let i = 0; i < 4; i += 1) {
      const c = new Node('corner' + i);
      c.layer = Layers.Enum.UI_2D;
      c.addComponent(UITransform).setContentSize(26, 26);
      c.parent = root;
      const csp = c.addComponent(Sprite);
      csp.sizeMode = Sprite.SizeMode.CUSTOM;
      setSprite(csp, 'fx/spot-hole-corner');
      this.corners.push(c);
    }

    // 呼吸金环：九宫格环贴图，尺寸 = 洞 + 环宽 12×2
    const ring = new Node('ring');
    ring.layer = Layers.Enum.UI_2D;
    ring.addComponent(UITransform).setContentSize(200, 200);
    ring.addComponent(UIOpacity).opacity = 46;
    ring.parent = root;
    const rsp = ring.addComponent(Sprite);
    rsp.sizeMode = Sprite.SizeMode.CUSTOM;
    rsp.type = Sprite.Type.SLICED;
    setSprite(rsp, 'fx/spot-ring');
    this.ring = ring;

    // 气泡底板（先于文字加，渲染在文字下层）→ 预烘焙九宫格贴图
    //    高度随行数在 layoutTip 里重设（单行 = 本体 98 + 阴影留白 68 = 166）
    const tipBg = new Node('tipBg');
    tipBg.layer = Layers.Enum.UI_2D;
    tipBg.addComponent(UITransform).setContentSize(TIP_W, 166);
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
    applyUiFont(tl);
    tip.parent = root;
    this.tipNode = tip;

    // 「▾ 继续」圆钮（Web: 76×76 圆形 + rgba(255,200,90,.95) 底 + #7a4100 44px）
    const next = new Node('next');
    next.layer = Layers.Enum.UI_2D;
    // 贴图 108×124：本体 76 居中，四周是 `0 6px 16px` 阴影的留白
    next.addComponent(UITransform).setContentSize(NEXT_D + 32, NEXT_D + 48);
    mkSprite(next, 'fx/spot-next', NEXT_D + 32, NEXT_D + 48);
    // ⚠️ ▾ 的 Label 不能直接 addComponent 在 next 上 —— 子节点（黄圆贴图）永远渲染在
    //    父节点自身之上，字会被贴图整个盖住（实测 ▾ 消失、黄圆空白）。挂成贴图之后的
    //    兄弟子节点，才在圆的上面。
    const labelNode = new Node('label');
    labelNode.layer = Layers.Enum.UI_2D;
    labelNode.addComponent(UITransform).setContentSize(NEXT_D + 32, NEXT_D + 48);
    labelNode.parent = next;
    const nl = labelNode.addComponent(Label);
    nl.fontSize = NEXT_FONT;
    nl.lineHeight = NEXT_D;
    nl.color = NEXT_TEXT;
    nl.string = '▾';
    applyUiFont(nl);
    (nl as unknown as { horizontalAlign: number }).horizontalAlign = 1;
    (nl as unknown as { verticalAlign: number }).verticalAlign = 1;
    // ⚠️ Label 默认 overflow=NONE 会把节点尺寸改成文字大小，76×76 的圆钮会被挤成 37×96。
    //    这里改成 CLAMP(1)：保持圆钮尺寸，文字在圆里居中。
    (nl as unknown as { overflow: number }).overflow = 1;
    // ⚠️ overflow 是在 string/font 之后才设的，字体（applyUiFont 异步 ttf）首测时还是 NONE，
    //    节点已被挤成 37×96 且 CLAMP 不会还原 —— 这里显式恢复圆钮尺寸（实测必须）。
    labelNode.getComponent(UITransform)!.setContentSize(NEXT_D + 32, NEXT_D + 48);
    // 点「▾ 继续」= 继续（Web `next.addEventListener('click')`，spotlight.ts:77-83）
    next.on(Node.EventType.TOUCH_END, () => this.proceed());
    next.parent = root;
    this.nextNode = next;

    // 洞内热区：透明节点，show() 时按洞摆放。点洞内 = 继续（Web `hole.addEventListener('click')`）。
    // ⚠️ 必须最后加（最上层），否则命中会落到 blocker 上。
    const holeHit = new Node('holeHit');
    holeHit.layer = Layers.Enum.UI_2D;
    holeHit.addComponent(UITransform);
    holeHit.on(Node.EventType.TOUCH_END, () => this.proceed());
    holeHit.parent = root;
    this.holeHit = holeHit;

    // ⚠️ build 完必须整层隐藏：root 自带 opacity 0 但 active 默认 true，
    //    加了 blocker 之后若不关 active，一个**看不见的全屏拦截层**会吃掉所有触摸（开局即卡死）。
    root.active = false;
  }

  isOpen(): boolean {
    return this.open;
  }

  /** 点洞内 = 继续（洞内热区 / ▾ 按钮的监听在 build 里挂，点暗区不关闭 —— Web 同口径） */
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
   *
   * 高度随行数（Web `.spot-tip`：`padding 22px 26px` + `line-height 1.35`×40 = 54/行）：
   *   本体高 = 22*2 + 54×行数；贴图（fx/spot-tip 400×166）本体 98 居中、上下各 34 是
   *   `0 10px 24px` 的阴影留白 → 节点高 = 本体 + 68，单行时正好 166。
   */
  private layoutTip(cssTopPos: number, cx: number): void {
    const tl = this.tipNode.getComponent(Label)!;
    const force = tl as unknown as { updateRenderData?: (f: boolean) => void };
    if (typeof force.updateRenderData === 'function') force.updateRenderData(true);
    const ut = this.tipNode.getComponent(UITransform)!;
    const estimated = this.estimateLines(tl.string) * TIP_LINE;
    const textH = Math.max(ut.contentSize.height || 0, estimated);
    const bodyH = textH + TIP_PAD_V * 2;
    const h = bodyH + TIP_TEX_MARGIN * 2;

    const y = DESIGN_H / 2 - (cssTopPos + bodyH / 2);
    this.tipBaseY = y;
    // 九宫格纵向拉伸：金边（5px）都在上下 56 的固定区里，中段只有渐变底被拉长
    this.tipBg.getComponent(UITransform)!.setContentSize(TIP_W, h);
    // spotTipIn 入场中：保持起始偏移（下移 14 / 缩 0.96），由 playTipIn 落回
    const oy = this.tipEntering ? -14 : 0;
    const sc = this.tipEntering ? 0.96 : 1;
    this.tipBg.setPosition(cx, y + oy, 0);
    this.tipBg.setScale(sc, sc, 1);
    this.tipNode.setPosition(cx, y + oy, 0);
    this.tipNode.setScale(sc, sc, 1);
    if (this.tipEntering) this.playTipIn(cx);
  }

  /**
   * Web `spotTipIn .26s ease-out`（ui.css:1585）：`translateY(14px)→0 + scale(.96)→1`。
   * CSS 的 y 向下 14 → Cocos 起步 y −14（layoutTip 已摆好起点），这里落回本体位置。
   * after-draw 会再 layoutTip 一次（Label 行数只有渲染后才准），重入时从起点重播，视觉无感。
   */
  private playTipIn(cx: number): void {
    const y = this.tipBaseY;
    for (const n of [this.tipBg, this.tipNode]) {
      Tween.stopAllByTarget(n);
      tween(n)
        .to(0.26, { position: new Vec3(cx, y, 0), scale: new Vec3(1, 1, 1) }, { easing: 'sineOut' })
        .call(() => { this.tipEntering = false; })
        .start();
    }
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

    /* 洞的四角补圆角：补丁 26×26，靠 scaleX/scaleY = ±1 让"挖掉的那一角"朝向洞心 */
    const cw = right - left;
    const ch = top - bottom;
    const cpos: Array<[number, number, number, number]> = [
      [left + 13, top - 13, 1, 1],        // 左上：洞心在右下
      [right - 13, top - 13, -1, 1],      // 右上：洞心在左下
      [left + 13, bottom + 13, 1, -1],    // 左下：洞心在右上
      [right - 13, bottom + 13, -1, -1],  // 右下：洞心在左上
    ];
    for (let i = 0; i < 4; i += 1) {
      const [cx, cy, sx, sy] = cpos[i];
      this.corners[i].setPosition(cx, cy, 0);
      this.corners[i].setScale(sx, sy, 1);
    }

    /* 呼吸金环：尺寸 = 洞 + 环宽 12×2；Web `spotBreath 1.6s` → 半周期 0.8s，
     *    opacity 在 .18(46) ↔ .55(140) 之间来回（spread 4↔12 用透明度近似） */
    this.ring.getComponent(UITransform)!.setContentSize(cw + 24, ch + 24);
    this.ring.setPosition(rect.cx, rect.cy, 0);
    const rop = this.ring.getComponent(UIOpacity)!;
    tween(rop).stop();
    rop.opacity = 46;
    tween(rop)
      .repeatForever(tween(rop).to(0.8, { opacity: 140 }).to(0.8, { opacity: 46 }))
      .start();

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
    const nextY = T - (nextCssTop + NEXT_D / 2);
    this.nextNode.setPosition(rect.cx, nextY, 0);
    // Web `.spot-next.up { transform: ... rotate(180deg) }`：翻到洞上方时 ▾ 朝上
    this.nextNode.angle = flip ? 180 : 0;
    // Web `spotNext 1.2s ease-in-out infinite`：margin-top 0→10→0（往下 10 再回来），半周期 0.6s
    Tween.stopAllByTarget(this.nextNode);
    tween(this.nextNode)
      .repeatForever(
        tween(this.nextNode)
          .to(0.6, { position: new Vec3(rect.cx, nextY - 10, 0) }, { easing: 'sineInOut' })
          .to(0.6, { position: new Vec3(rect.cx, nextY, 0) }, { easing: 'sineInOut' }),
      )
      .start();

    // 洞内热区 = 洞的包围盒（含 pad）：点洞内继续；暗区由 blocker 拦截（都不关闭）
    this.holeHit.getComponent(UITransform)!.setContentSize(hx, hy);
    this.holeHit.setPosition(rect.cx, rect.cy, 0);

    this.onNextCb = opts.onNext ?? null;
    this.open = true;
    this.tipEntering = true;   // 让 layoutTip 摆出 spotTipIn 的起点并播放入场
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
    tween(this.ring.getComponent(UIOpacity)!).stop();   // 呼吸金环跟着收
    Tween.stopAllByTarget(this.nextNode);               // ▾ 的上下浮动跟着停
    for (const n of [this.tipBg, this.tipNode]) Tween.stopAllByTarget(n);
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
