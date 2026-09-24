/**
 * Toast —— 对应 web/ui/dom.ts 的 toast / fmtMMSS / starText / heartRow。
 *
 * Cocos 里没有 DOM，所以用一个常驻在最顶层的 Node 自己画。
 * 挂在 Canvas 下、siblingIndex 拉到最高，保证不被任何面板盖住。
 */

import { _decorator, Component, Node, Graphics, UITransform, Label, Color, Layers, HorizontalTextAlignment, VerticalTextAlignment, Vec3, tween } from 'cc';
const { ccclass } = _decorator;

const DESIGN_W = 1080;
const DESIGN_H = 1920;

/** 同屏最多叠几条（原版是队列，这里简化为上限 + 顶掉最老的） */
const MAX_TOASTS = 3;

@ccclass('ToastLayer')
export class ToastLayer extends Component {
  private layer: Node = null!;
  private pool: Node[] = [];
  private busy: Node[] = [];

  onLoad(): void {
    this.layer = new Node('ToastLayer');
    this.layer.parent = this.node;
    this.layer.layer = Layers.Enum.UI_2D;
    this.layer.addComponent(UITransform).setContentSize(DESIGN_W, DESIGN_H);
    this.layer.setSiblingIndex(9999);
  }

  /**
   * 弹一条提示。
   *
   * `ms` 是停留时长；多行用 `\n` 分隔（原版 toast 支持 `lines.join('\n')`）。
   * 走原生 Node 而不是 Label 组件自带排版，是因为要统一圆角底板 + 自动换行宽度。
   */
  show(text: string, ms = 1800): void {
    if (!this.layer) return;
    if (this.busy.length >= MAX_TOASTS) {
      const oldest = this.busy.shift()!;
      this.recycle(oldest);
    }
    const n = this.take();
    const lines = text.split('\n');
    this.fill(n, lines);
    this.busy.push(n);

    tween(n)
      .to(0.18, { scale: new Vec3(1, 1, 1) })
      .delay(ms / 1000)
      .to(0.25, { scale: new Vec3(1, 0.8, 1) })
      .call(() => {
        this.recycle(n);
        const i = this.busy.indexOf(n);
        if (i >= 0) this.busy.splice(i, 1);
      })
      .start();
  }

  private take(): Node {
    const n = this.pool.pop() ?? this.create();
    n.parent = this.layer;
    n.active = true;
    n.setScale(0.8, 0.8, 1);
    n.setSiblingIndex(this.layer.children.length - 1);
    return n;
  }

  private recycle(n: Node): void {
    tween(n).stop();
    n.active = false;
    n.removeAllChildren();
    this.pool.push(n);
  }

  private create(): Node {
    const n = new Node('Toast');
    n.layer = Layers.Enum.UI_2D;
    n.addComponent(UITransform).setContentSize(880, 120);
    return n;
  }

  /** 按行数决定底板高度，文字居中；行多时底板跟着长高 */
  private fill(n: Node, lines: string[]): void {
    n.removeAllChildren();
    const perLine = 42;
    const h = 60 + lines.length * perLine;
    const t = n.getComponent(UITransform)!;
    t.setContentSize(880, h);

    const g = n.addComponent(Graphics);
    g.fillColor = new Color(38, 30, 24, 235);
    g.roundRect(-440, -h / 2, 880, h, 24);
    g.fill();

    const label = new Node('Text');
    label.parent = n;
    label.layer = Layers.Enum.UI_2D;
    label.addComponent(UITransform).setContentSize(820, h - 20);
    const l = label.addComponent(Label);
    l.string = lines.join('\n');
    l.fontSize = 30;
    l.lineHeight = perLine;
    l.color = new Color(255, 246, 230, 255);
    l.horizontalAlign = HorizontalTextAlignment.CENTER;
    l.verticalAlign = VerticalTextAlignment.CENTER;
  }
}

/** 秒 → mm:ss（纯函数，原在 web/ui/dom.ts） */
export function fmtMMSS(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** 星级文本（★☆☆） */
export function starText(stars: number): string {
  const n = Math.max(0, Math.min(3, Math.floor(stars)));
  return '★'.repeat(n) + '☆'.repeat(3 - n);
}

/** 体力条文本（❤️ 8/10） */
export function heartRow(available: number, max: number): string {
  const full = '❤️'.repeat(Math.max(0, Math.min(available, max)));
  const empty = '🖤'.repeat(Math.max(0, max - available));
  return `${full}${empty} ${available}/${max}`;
}
