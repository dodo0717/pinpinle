/**
 * 通用弹窗 —— 结算 / 荣誉 / 失败 / 续命 / 确认共用（对应 web/ui/dialog.ts）。
 *
 * 现为程序绘制占位版；美术底板到货后把面板换成 Sprite 即可，
 * 排版逻辑（标题 / 星级 / 正文行 / 按钮行）不用动。
 */

import { _decorator, Component, Node, Graphics, UITransform, Label, Color, Layers, HorizontalTextAlignment, VerticalTextAlignment } from 'cc';
const { ccclass } = _decorator;

export interface DialogButton {
  text: string;
  onClick: () => void;
  /** 主按钮（高亮）；次要按钮走描边样式 */
  primary?: boolean;
  /** 置灰不可点（例如今日广告次数已用完） */
  disabled?: boolean;
}

const PANEL_W = 720;
const PANEL_H = 560;
const BTN_W = 260;
const BTN_H = 96;

@ccclass('GameDialog')
export class GameDialog extends Component {
  private panel: Node = null!;
  private closed = false;

  onLoad(): void {
    this.node.active = false;
  }

  /**
   * @param title 标题
   * @param lines 正文行
   * @param buttons 按钮（1~2 个为宜）
   * @param stars  0 表示不显示星级行（失败 / 续命弹窗不需要）
   * @param hero   顶部大图标文字（🏆 / 👑 / 🎉），空则不显示
   */
  show(
    title: string,
    lines: string[],
    buttons: DialogButton[],
    stars = 0,
    hero = '',
  ): void {
    this.closed = false;
    this.node.removeAllChildren();
    this.node.active = true;

    const mask = new Node('Mask');
    mask.parent = this.node;
    mask.layer = Layers.Enum.UI_2D;
    mask.addComponent(UITransform).setContentSize(1080, 1920);
    const mg = mask.addComponent(Graphics);
    mg.fillColor = new Color(0, 0, 0, 150);
    mg.rect(-540, -960, 1080, 1920);
    mg.fill();

    this.panel = new Node('Panel');
    this.panel.parent = this.node;
    this.panel.layer = Layers.Enum.UI_2D;
    this.panel.addComponent(UITransform).setContentSize(PANEL_W, PANEL_H);
    const pg = this.panel.addComponent(Graphics);
    pg.fillColor = new Color(255, 246, 230, 255);
    pg.roundRect(-PANEL_W / 2, -PANEL_H / 2, PANEL_W, PANEL_H, 36);
    pg.fill();

    let y = PANEL_H / 2 - 70;
    if (hero) {
      this.text(hero, 72, 0, y - 20, new Color(255, 176, 62), 640);
      y -= 90;
    }
    this.text(title, 44, 0, y, new Color(90, 50, 25), 640);
    y -= 60;

    if (stars > 0) {
      this.text(starRow(stars), 52, 0, y, new Color(255, 196, 48), 640);
      y -= 56;
    }

    for (const s of lines) {
      this.text(s, 28, 0, y, new Color(110, 90, 70, 255), 620);
      y -= 44;
    }

    const n = buttons.length;
    buttons.forEach((b, i) => this.button(b, (i - (n - 1) / 2) * (BTN_W + 24), -PANEL_H / 2 + 70));
  }

  /** 确认框：两个按钮，第二个为主按钮 */
  confirm(title: string, lines: string[], yesText: string, noText: string, onYes: () => void): void {
    this.show(title, lines, [
      { text: noText, onClick: () => {} },
      { text: yesText, onClick: onYes, primary: true },
    ]);
  }

  hide(): void {
    if (this.closed) return;
    this.closed = true;
    this.node.active = false;
  }

  private text(s: string, size: number, x: number, y: number, color: Color, w: number): void {
    const n = new Node('Text');
    n.parent = this.panel;
    n.layer = Layers.Enum.UI_2D;
    n.addComponent(UITransform).setContentSize(w, size + 12);
    n.setPosition(x, y);
    const l = n.addComponent(Label);
    l.string = s;
    l.fontSize = size;
    l.lineHeight = size + 8;
    l.color = color;
    l.horizontalAlign = HorizontalTextAlignment.CENTER;
    l.verticalAlign = VerticalTextAlignment.CENTER;
  }

  private button(b: DialogButton, x: number, y: number): void {
    const n = new Node('Btn_' + b.text);
    n.parent = this.panel;
    n.layer = Layers.Enum.UI_2D;
    n.addComponent(UITransform).setContentSize(BTN_W, BTN_H);
    n.setPosition(x, y);

    const g = n.addComponent(Graphics);
    if (b.disabled) {
      g.fillColor = new Color(206, 198, 188, 255);
      g.roundRect(-BTN_W / 2, -BTN_H / 2, BTN_W, BTN_H, BTN_H / 2);
      g.fill();
      this.text(b.text, 32, x, y, new Color(150, 142, 132, 255), BTN_W);
      return;
    }
    if (b.primary) {
      g.fillColor = new Color(255, 176, 62, 255);
      g.roundRect(-BTN_W / 2, -BTN_H / 2, BTN_W, BTN_H, BTN_H / 2);
      g.fill();
      this.text(b.text, 32, x, y, new Color(255, 255, 255, 255), BTN_W);
    } else {
      g.fillColor = new Color(255, 255, 255, 255);
      g.roundRect(-BTN_W / 2, -BTN_H / 2, BTN_W, BTN_H, BTN_H / 2);
      g.fill();
      g.lineWidth = 4;
      g.strokeColor = new Color(255, 176, 62, 255);
      g.roundRect(-BTN_W / 2, -BTN_H / 2, BTN_W, BTN_H, BTN_H / 2);
      g.stroke();
      this.text(b.text, 32, x, y, new Color(150, 100, 40, 255), BTN_W);
    }
    n.on(Node.EventType.TOUCH_END, () => {
      if (this.closed) return;
      this.hide();
      b.onClick();
    }, this);
  }
}

function starRow(stars: number): string {
  const n = Math.max(0, Math.min(3, Math.floor(stars)));
  return '★'.repeat(n) + '☆'.repeat(3 - n);
}
