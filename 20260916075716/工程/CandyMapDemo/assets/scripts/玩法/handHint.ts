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

/** 演示一次的完整时长（ms），与 Web 版 CSS `tut-slide` 周期保持一致 */
export const HAND_HINT_MS = 1600;

/** 单程滑动时长（ms）—— 手指从缺块滑到缺口 */
const SLIDE_MS = 0.9;
/** 落位金光停留 + 淡出（ms） */
const FLASH_MS = 0.45;

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

    const hand = new Node('hand');
    hand.layer = Layers.Enum.UI_2D;
    const ht = hand.addComponent(UITransform);
    ht.setContentSize(96, 96);
    const hl = hand.addComponent(Label);
    hl.string = '👆';
    hl.fontSize = 72;
    hl.lineHeight = 96;
    hand.parent = root;
    this.hand = hand;

    const flash = new Node('flash');
    flash.layer = Layers.Enum.UI_2D;
    flash.addComponent(UITransform).setContentSize(140, 140);
    const fg = flash.addComponent(Graphics);
    fg.circle(0, 0, 58);
    fg.fillColor = new Color(255, 214, 90, 200);
    fg.fill();
    fg.strokeColor = new Color(255, 240, 180, 255);
    fg.lineWidth = 6;
    fg.stroke();
    const fo = flash.addComponent(UIOpacity);
    fo.opacity = 0;
    flash.parent = root;
    this.flash = flash;
  }

  isPlaying(): boolean {
    return this.playing;
  }

  /** 挂到棋盘并循环演示。`from`/`to` 为棋盘局部坐标（格子中心） */
  play(from: Vec3, to: Vec3): void {
    this.stop();
    this.playing = true;
    this.root.setPosition(from.x, from.y, 0);
    this.flash.setPosition(to.x - from.x, to.y - from.y, 0);
    this.root.getComponent(UIOpacity)!.opacity = 255;
    tween(this.hand)
      .repeatForever(
        tween(this.hand)
          .to(SLIDE_MS, { position: new Vec3(to.x - from.x, to.y - from.y, 0) }, { easing: 'sineInOut' })
          .call(() => this.flashOnce())
          .delay(FLASH_MS)
          .to(0.001, { position: Vec3.ZERO })
          .delay(0.2)
          .start(),
      )
      .start();
  }

  /** 落位金光：亮起再淡出（预演"拼成了"） */
  private flashOnce(): void {
    const fo = this.flash.getComponent(UIOpacity)!;
    fo.opacity = 255;
    tween(fo).delay(FLASH_MS * 0.5).to(FLASH_MS * 0.5, { opacity: 0 }).start();
  }

  /** 停止并隐藏（玩家上手 / 教学步完成） */
  stop(): void {
    this.playing = false;
    tween(this.hand).stop();
    tween(this.flash.getComponent(UIOpacity)!).stop();
    this.root.getComponent(UIOpacity)!.opacity = 0;
  }

  /** 彻底销毁（关卡重建时） */
  destroy(): void {
    if (this.root?.isValid) this.root.destroy();
  }
}
