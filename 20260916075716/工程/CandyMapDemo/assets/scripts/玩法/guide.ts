/**
 * 新手引导 —— 对应 web/ui/guide.ts（§14 五步）。
 *
 * 五步是**事件驱动**的，不是定时器：玩家第一次拖动之后才讲「拼成整张就消除」，
 * 在他还没动手时讲这个等于没讲。所以这里的 `show` 只负责显示，
 * 「什么时候显示第几步」由 `GameBootstrap` 按局内事件决定。
 */

import { _decorator, Component, Node, Graphics, UITransform, Label, Color, Layers, HorizontalTextAlignment, VerticalTextAlignment, UIOpacity, tween } from 'cc';
const { ccclass } = _decorator;

const BAR_W = 968;   // web .guide left/right 56
const BAR_H = 130;
const BAR_Y = -560;

@ccclass('GuideBar')
export class GuideBar extends Component {
  private bar: Node = null!;
  private label: Label = null!;
  private op: UIOpacity = null!;
  /** 一条还在屏上时，下一条排队等（原版 500ms 重试） */
  private queueTimer: ReturnType<typeof setTimeout> | null = null;
  private showing = false;

  onLoad(): void {
    this.bar = new Node('GuideBar');
    this.bar.parent = this.node;
    this.bar.layer = Layers.Enum.UI_2D;
    this.bar.addComponent(UITransform).setContentSize(BAR_W, BAR_H);
    this.bar.setPosition(0, this.y);
    this.bar.active = false;

    this.bar.addComponent(Graphics);

    const tn = new Node('Text');
    tn.parent = this.bar;
    tn.layer = Layers.Enum.UI_2D;
    tn.addComponent(UITransform).setContentSize(BAR_W - 60, BAR_H - 20);
    const l = tn.addComponent(Label);
    l.fontSize = 30;
    l.lineHeight = 40;
    l.color = new Color(255, 255, 255, 255);
    l.horizontalAlign = HorizontalTextAlignment.CENTER;
    l.verticalAlign = VerticalTextAlignment.CENTER;
    this.label = l;
    this.paintBar();

    this.op = this.bar.addComponent(UIOpacity);
  }

  /** 纵向位置跟着对局排版走（长屏时棋盘下沿会变） */
  setY(y: number): void {
    this.y = y;
    if (this.bar) this.bar.setPosition(0, y);
  }
  private y = BAR_Y;

  /**
   * 第 1 关按 web 原型画（web .guide：深棕 rgba(74,59,42,.94)、圆角 32、36px 粗白字）；
   * 其他关保持原来的橙色条。
   */
  setWeb(on: boolean): void {
    this.web = on;
    if (this.bar) this.paintBar();
  }
  private web = false;

  private paintBar(): void {
    const g = this.bar.getComponent(Graphics)!;
    g.clear();
    g.fillColor = this.web ? new Color(74, 59, 42, 240) : new Color(255, 176, 62, 245);
    g.roundRect(-BAR_W / 2, -BAR_H / 2, BAR_W, BAR_H, this.web ? 32 : 28);
    g.fill();
    if (this.label) {
      this.label.fontSize = this.web ? 36 : 30;
      this.label.lineHeight = this.web ? 46 : 40;
      (this.label as Label & { enableBold?: boolean }).enableBold = this.web;
    }
  }

  onDestroy(): void {
    if (this.queueTimer !== null) clearTimeout(this.queueTimer);
  }

  /** 排队显示：上一条还在屏上就延后重试，不打断正在读的那条 */
  show(text: string, ms = 4500): void {
    if (this.showing) {
      if (this.queueTimer !== null) return;
      this.queueTimer = setTimeout(() => {
        this.queueTimer = null;
        this.show(text, ms);
      }, 500);
      return;
    }
    this.showing = true;
    this.bar.active = true;
    this.label.string = text;
    this.op.opacity = 0;
    tween(this.op).to(0.2, { opacity: 255 }).start();
    this.queueTimer = setTimeout(() => {
      this.queueTimer = null;
      this.hide();
    }, ms);
  }

  hide(): void {
    if (!this.showing) return;
    this.showing = false;
    if (this.queueTimer !== null) { clearTimeout(this.queueTimer); this.queueTimer = null; }
    tween(this.op).to(0.2, { opacity: 0 }).call(() => { this.bar.active = false; }).start();
  }
}
