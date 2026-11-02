/**
 * 滑动演示动画（从 web/ui/handHint.ts 移植，2026-10-30）
 *
 * 用户要求："不要用文字教学，要强制教用户拖动，只有拖动这碎片可以操作，动画模拟滑动"。
 *
 *   手指落在目标块中心 → 沿直线滑到缺口中心 → 落位金光一闪（拼合预演）→ 淡出复位 → 循环
 *
 * ⚠️ 玩家一按就停：`stop()` 由棋盘的 pointerdown 调，动画不再打扰操作。
 * ⚠️ 坐标是**挂载父节点（棋盘）的局部坐标** —— 调用方（GameBootstrap 教学步）用
 *    BoardView 的格子换算给出，与 Web 版「offsetLeft/offsetTop 同一坐标系」等效。
 *
 * 素材：手指用 emoji 👆 Label（零素材，与 Web 版一致）；金光用 Graphics 画圆 + 透明度 tween。
 */

import { Node, Label, UITransform, Graphics, Color, UIOpacity, tween, Vec3, Layers } from 'cc';
import { mkSprite } from '../界面/uiPaint';
import { applyUiFont } from '../界面/fontUtil';

/** 演示一次的完整时长（ms），与 Web 版 `tutSlide` / `tutFlash` 的 1.6s 周期一致 */
export const HAND_HINT_MS = 1600;

export class HandHint {
  private root: Node = null!;
  private hand: Node = null!;
  private flash: Node = null!;
  private playing = false;
  /** 常驻但隐藏；play() 挂到棋盘、stop() 摘除，避免反复创建销毁 */
  private parent: Node = null!;

  /** 创建并常驻（不显示）。`parent` 通常是棋盘容器节点（与格子同一坐标系） */
  static create(parent: Node): HandHint {
    const h = new HandHint();
    h.parent = parent;
    h.build();
    return h;
  }

  private build(): void {
    const root = new Node('HandHint');
    root.layer = Layers.Enum.UI_2D;
    root.addComponent(UITransform);
    const op = root.addComponent(UIOpacity);
    op.opacity = 0;
    root.parent = this.parent;
    root.setPosition(0, 0, 0);
    this.root = root;

    // 手指：Web `.tut-hand` 是 52×52 的**白圆角块**（圆角 50% 50% 46% 46%）+ 外阴影 + 底部 inset，
    //    ☝ 是叠在上面的 34px 字形（`.tut-hand-tip`）。原来这里只有一个 72px 的 👆 emoji。
    const hand = new Node('hand');
    hand.layer = Layers.Enum.UI_2D;
    hand.addComponent(UITransform).setContentSize(90, 96);   // 贴图含外阴影，比本体大一圈
    hand.parent = root;
    // Web `.tut-hand` 是 `left:-26 / top:-34`、本体 52×52 → 本体中心相对容器 (−26+26, −34+26) = (0,−8)，
    //    CSS y 向下 → Cocos y = **+8**（手心比格心略高）
    hand.setPosition(0, 8, 0);
    hand.addComponent(UIOpacity);
    mkSprite(hand, 'fx/tut-hand', 90, 96);
    const tip = new Node('tip');
    tip.layer = Layers.Enum.UI_2D;
    tip.addComponent(UITransform).setContentSize(40, 40);
    const tl = tip.addComponent(Label);
    // ⚠️ Web `.tut-hand-tip` 是 **👆**（backhand index pointing up），不是 ☝ —— 之前写错了
    tl.string = '👆';
    tl.fontSize = 34;
    tl.lineHeight = 40;
    tip.parent = hand;
    // Web `left:6 / top:2`：字形 34×34 → 中心相对本体中心 (−3, −7) → Cocos (3, 7)
    tip.setPosition(3, 7, 0);
    applyUiFont(tl);
    this.hand = hand;

    // 金光：Web `.tut-flash` 是 110×110 的**径向渐变**（中心 #ffe282 → 边缘透明）。
    //    ⚠️ 原来用 Graphics 画实心圆 + 描边 —— 一块硬边圆饼，和 Web 的柔和光斑完全不同。
    const flash = new Node('flash');
    flash.layer = Layers.Enum.UI_2D;
    flash.addComponent(UITransform).setContentSize(110, 110);
    flash.parent = root;
    mkSprite(flash, 'fx/tut-flash', 110, 110);
    const fo = flash.addComponent(UIOpacity);
    fo.opacity = 0;
    this.flash = flash;
  }

  isPlaying(): boolean {
    return this.playing;
  }

  /** 挂到棋盘并循环演示。`from`/`to` 为棋盘局部坐标（格子中心） */
  play(from: Vec3, to: Vec3): void {
    this.stop();
    // ⚠️ 自愈挂载（Web 不需要、Cocos 必须）：`BoardView.build()` 每次建盘都会
    //    `this.node.removeAllChildren()` 清旧格子，把常驻在棋盘节点里的这根手指一起摘下
    //    → 手指从此 parent=NULL，`playing=true` 却永远不渲染（2026-11-02 实测：
    //    tutHand.playing=true、root.parent=NULL、全场景搜不到 HandHint 节点）。
    //    Web 的 `.tut-hand` 挂在 `#board`，格重建只清 `.cell`，所以没这问题。
    if (this.parent?.isValid && this.root.parent !== this.parent) this.root.parent = this.parent;
    this.playing = true;
    this.root.setPosition(from.x, from.y, 0);
    this.flash.setPosition(to.x - from.x, to.y - from.y, 0);
    this.root.getComponent(UIOpacity)!.opacity = 255;

    /*
     * Web `tutSlide 1.6s ease-in-out infinite`（ui.css:1536）关键帧 → 秒：
     *   0%   op0
     *   8%   0.128s  op1 + scale1
     *   20%  0.320s  scale .9（按下）
     *   55%  0.880s  位移到目标（仍 .9）
     *   68%  1.088s  scale1（抬起）
     *   80%  1.280s  op0
     *   82%  1.312s  复位到起点
     *   100% 1.600s  op1
     * ⚠️ 之前只做了「位移 + 停顿」，没有按下 scale、也没有淡入淡出，动作看着发死。
     */
    const dest = new Vec3(to.x - from.x, to.y - from.y, 0);
    const hop = this.hand.getComponent(UIOpacity)!;

    tween(this.hand)
      .repeatForever(
        tween(this.hand)
          .set({ position: Vec3.ZERO, scale: new Vec3(1, 1, 1) })
          .delay(0.128)
          .to(0.192, { scale: new Vec3(0.9, 0.9, 1) })
          .to(0.56, { position: dest }, { easing: 'sineInOut' })
          .to(0.208, { scale: new Vec3(1, 1, 1) })
          .delay(0.192)
          .delay(0.32)                      // 补齐到 1.6s，保证与下面两条时间轴同周期
          .start(),
      )
      .start();

    tween(hop)
      .repeatForever(
        tween(hop)
          .set({ opacity: 0 })
          .to(0.128, { opacity: 255 })
          .delay(0.96)                      // 8% → 68%
          .to(0.192, { opacity: 0 })        // 68% → 80%
          .delay(0.032)                     // → 82%
          .to(0.288, { opacity: 255 })      // 82% → 100%
          .start(),
      )
      .start();

    /* Web `tutFlash 1.6s`：0/50% op0 scale .6 → 62% op1 scale 1.05 → 78/100% op0 scale 1.2 */
    const fo = this.flash.getComponent(UIOpacity)!;
    tween(fo)
      .repeatForever(
        tween(fo)
          .set({ opacity: 0 })
          .delay(0.88)
          .to(0.112, { opacity: 255 })
          .to(0.256, { opacity: 0 })
          .delay(0.352)
          .start(),
      )
      .start();
    tween(this.flash)
      .repeatForever(
        tween(this.flash)
          .set({ scale: new Vec3(0.6, 0.6, 1) })
          .delay(0.88)
          .to(0.368, { scale: new Vec3(1.2, 1.2, 1) })
          .delay(0.352)
          .start(),
      )
      .start();
  }

  /** 停止并隐藏（玩家上手 / 教学步完成） */
  stop(): void {
    this.playing = false;
    tween(this.hand).stop();
    tween(this.hand.getComponent(UIOpacity)!).stop();
    tween(this.flash).stop();
    tween(this.flash.getComponent(UIOpacity)!).stop();
    this.root.getComponent(UIOpacity)!.opacity = 0;
  }

  /** 彻底销毁（关卡重建时） */
  destroy(): void {
    if (this.root?.isValid) this.root.destroy();
  }
}
