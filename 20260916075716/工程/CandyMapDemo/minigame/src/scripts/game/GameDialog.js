/**
 * 通用弹窗 —— 结算 / 荣誉 / 失败 / 续命 / 确认共用（对应 web/ui/dialog.ts）。
 *
 * 现为程序绘制占位版；美术底板到货后把面板换成 Sprite 即可，
 * 排版逻辑（标题 / 星级 / 正文行 / 按钮行）不用动。
 *
 * 2026-10-23：面板高度改为**按内容计算**、按钮**每行最多两个**。
 * 之前固定 720×560、按钮排一行：排行榜 10 行字溢出卡片，设置页 4 个按钮（总宽 1112）
 * 直接排到卡片外面。遮罩也改成吞掉触摸，免得弹窗开着时手指还能拖动底下的地图。
 */

import { _decorator, Component, Node, Graphics, UITransform, Label, Color, Layers, HorizontalTextAlignment, VerticalTextAlignment, EventTouch } from '../../runtime/cc.js';
const { ccclass } = _decorator;

                               
               
                      
                          
                    
                           
                     
 

const PANEL_W = 820;
const PAD_TOP = 56;
const PAD_BOTTOM = 52;
const HERO_H = 96;
const TITLE_H = 66;
const STARS_H = 60;
const LINE_H = 46;
const GAP_BEFORE_BTNS = 30;
const BTN_W = 330;
const BTN_H = 96;
const BTN_GAP = 24;
const BTNS_PER_ROW = 2;
/** 遮罩画得比任何手机屏都大：FIXED_WIDTH 下可视高度会超过 1920 */
const MASK_W = 2400;
const MASK_H = 4800;

export class GameDialog extends Component {
          panel       = null ;
          closed = false;

  onLoad()       {
    this.node.active = false;
  }

  /**
   * @param title 标题
   * @param lines 正文行
   * @param buttons 按钮（每行两个，自动换行）
   * @param stars  0 表示不显示星级行（失败 / 续命弹窗不需要）
   * @param hero   顶部大图标文字（🏆 / 👑 / 🎉），空则不显示
   */
  show(
    title        ,
    lines          ,
    buttons                ,
    stars = 0,
    hero = '',
  )       {
    this.closed = false;
    this.node.removeAllChildren();
    this.node.active = true;

    const mask = new Node('Mask');
    mask.parent = this.node;
    mask.layer = Layers.Enum.UI_2D;
    mask.addComponent(UITransform).setContentSize(MASK_W, MASK_H);
    const mg = mask.addComponent(Graphics);
    mg.fillColor = new Color(0, 0, 0, 150);
    mg.rect(-MASK_W / 2, -MASK_H / 2, MASK_W, MASK_H);
    mg.fill();
    // 吞掉落在遮罩（含面板空白处）上的触摸：弹窗是模态的
    const swallow = (e            )       => { e.propagationStopped = true; };
    mask.on(Node.EventType.TOUCH_START, swallow, this);
    mask.on(Node.EventType.TOUCH_MOVE, swallow, this);
    mask.on(Node.EventType.TOUCH_END, swallow, this);

    // 先算面板高度，再从上往下排
    const rows = Math.ceil(buttons.length / BTNS_PER_ROW);
    const contentH =
      (hero ? HERO_H : 0) + TITLE_H + (stars > 0 ? STARS_H : 0) + lines.length * LINE_H;
    const btnsH = rows > 0 ? GAP_BEFORE_BTNS + rows * BTN_H + (rows - 1) * BTN_GAP : 0;
    const panelH = PAD_TOP + contentH + btnsH + PAD_BOTTOM;

    this.panel = new Node('Panel');
    this.panel.parent = this.node;
    this.panel.layer = Layers.Enum.UI_2D;
    this.panel.addComponent(UITransform).setContentSize(PANEL_W, panelH);
    const pg = this.panel.addComponent(Graphics);
    pg.fillColor = new Color(60, 40, 10, 90);
    pg.roundRect(-PANEL_W / 2, -panelH / 2 - 16, PANEL_W, panelH, 38);
    pg.fill();
    pg.fillColor = new Color(255, 248, 231, 255);
    pg.roundRect(-PANEL_W / 2, -panelH / 2, PANEL_W, panelH, 38);
    pg.fill();
    pg.lineWidth = 6;
    pg.strokeColor = new Color(245, 197, 66, 255);
    pg.roundRect(-PANEL_W / 2, -panelH / 2, PANEL_W, panelH, 38);
    pg.stroke();

    let y = panelH / 2 - PAD_TOP;
    if (hero) {
      this.text(hero, 72, 0, y - HERO_H / 2, new Color(255, 176, 62), PANEL_W - 80);
      y -= HERO_H;
    }
    this.text(title, 46, 0, y - TITLE_H / 2, new Color(107, 74, 47), PANEL_W - 80);
    y -= TITLE_H;

    if (stars > 0) {
      this.text(starRow(stars), 52, 0, y - STARS_H / 2, new Color(255, 196, 48), PANEL_W - 80);
      y -= STARS_H;
    }

    for (const s of lines) {
      this.text(s, 30, 0, y - LINE_H / 2, new Color(110, 90, 70, 255), PANEL_W - 80);
      y -= LINE_H;
    }

    if (rows > 0) y -= GAP_BEFORE_BTNS;
    for (let r = 0; r < rows; r++) {
      const row = buttons.slice(r * BTNS_PER_ROW, (r + 1) * BTNS_PER_ROW);
      const by = y - BTN_H / 2;
      row.forEach((b, i) => this.button(b, (i - (row.length - 1) / 2) * (BTN_W + BTN_GAP), by));
      y -= BTN_H + BTN_GAP;
    }
  }

  /** 确认框：两个按钮，第二个为主按钮 */
  confirm(title        , lines          , yesText        , noText        , onYes            )       {
    this.show(title, lines, [
      { text: noText, onClick: () => {} },
      { text: yesText, onClick: onYes, primary: true },
    ]);
  }

  hide()       {
    if (this.closed) return;
    this.closed = true;
    this.node.active = false;
  }

  /** 一行文字：超宽就缩小字号，不换行、不溢出面板 */
          text(s        , size        , x        , y        , color       , w        )       {
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
    l.enableWrapText = false;
    l.overflow = Label.Overflow.SHRINK;
  }

          button(b              , x        , y        )       {
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
      this.text(b.text, 34, x, y, new Color(150, 142, 132, 255), BTN_W - 30);
      // 置灰按钮也要吞掉触摸，不能点穿到遮罩外
      n.on(Node.EventType.TOUCH_END, (e            ) => { e.propagationStopped = true; }, this);
      return;
    }
    if (b.primary) {
      g.fillColor = new Color(255, 176, 62, 255);
      g.roundRect(-BTN_W / 2, -BTN_H / 2, BTN_W, BTN_H, BTN_H / 2);
      g.fill();
      this.text(b.text, 34, x, y, new Color(255, 255, 255, 255), BTN_W - 30);
    } else {
      g.fillColor = new Color(255, 255, 255, 255);
      g.roundRect(-BTN_W / 2, -BTN_H / 2, BTN_W, BTN_H, BTN_H / 2);
      g.fill();
      g.lineWidth = 4;
      g.strokeColor = new Color(255, 176, 62, 255);
      g.roundRect(-BTN_W / 2, -BTN_H / 2, BTN_W, BTN_H, BTN_H / 2);
      g.stroke();
      this.text(b.text, 34, x, y, new Color(150, 100, 40, 255), BTN_W - 30);
    }
    n.on(Node.EventType.TOUCH_END, (e            ) => {
      e.propagationStopped = true;
      if (this.closed) return;
      this.hide();
      b.onClick();
    }, this);
  }
}

function starRow(stars        )         {
  const n = Math.max(0, Math.min(3, Math.floor(stars)));
  return '★'.repeat(n) + '☆'.repeat(3 - n);
}
