/**
 * 第 1 关（原样式 classic）的对局界面 —— 照搬 web 原型 `web/index.html #screen-game`（2026-10-25）：
 *
 *   奶油底 → 深蓝卡片（#0058B0，10px 金边 #D9A227，圆角 52，四周留 8）
 *     └ 顶部「赛场计分条」（高 240，天空蓝渐变 + 金细边，圆角 26）：
 *         [← 返回]  [🚩 目标分]  [翻牌两位数得分]  [🕒 03:00]
 *     └ 棋盘：透明底 + 极淡白边，碎片 2px 白边、融合组外沿描蜜金色
 *
 * 列宽按 web 的 grid（auto 1fr auto 1fr，gap 18，padding 16）算死，见 COL_*。
 * 微信里计分条整条下移到胶囊行之下（web 没有胶囊）；棋盘吃掉剩下的高度。
 */

import { Node, Graphics, Label, Color, Vec3, tween, UIOpacity } from '../../runtime/cc.js';
import {
  hex, alpha, fillV, fillRadial, shadow, rrect4, mkNode, mkGfx, mkText, onFrame, screenH, screenInsets,
                 
} from './paint.js';
import { FONT_SANS } from './theme.js';

/** web 原型色板（index.html :root + #screen-game） */
export const WEB = {
  cream: hex('#fff7ec'),
  cream2: hex('#fdeed8'),
  creamTop: hex('#fffdf6'),
  honey: hex('#e0a94a'),
  honeySoft: hex('#f6d9a0'),
  ink: hex('#4a3b2a'),
  inkSoft: hex('#9c8768'),
  card: hex('#0058B0'),
  cardBorder: hex('#D9A227'),
  skyA: hex('#5cb0ef'),
  skyB: hex('#3d8fd8'),
  gold: hex('#FFD24A'),
  timerText: hex('#FFE9B0'),
  warn: hex('#ffcc66'),
  danger: hex('#ff8080'),
  exit: hex('#6B4A2F'),
  exitEdge: hex('#4A3321'),
};

/** 数字字体：web 用 Bahnschrift / DIN，手机上没有就落到系统粗体 */
const NUM_FONT = `"Bahnschrift","DIN Alternate",${FONT_SANS}`;

const CARD_MARGIN = 8;
const CARD_BORDER = 10;
const BAR_H = 240;
const BAR_W = 1080 - 2 * (CARD_MARGIN + CARD_BORDER);   // 1044

// grid: auto(84) 1fr auto(246) 1fr，gap 18，padding 16 → 1fr = 314
const PAD = 16;
const GAP = 18;
const EXIT_W = 84;
const SCORE_W = 246;
const FR = (BAR_W - 2 * PAD - 3 * GAP - EXIT_W - SCORE_W) / 2;
const X0 = -BAR_W / 2 + PAD;
const COL_EXIT = X0 + EXIT_W / 2;
const COL_GOAL = X0 + EXIT_W + GAP + FR / 2;
const COL_SCORE = X0 + EXIT_W + GAP + FR + GAP + SCORE_W / 2;
const TIMER_RIGHT = BAR_W / 2 - PAD;

                            
            
               
                   
                      
                     
                 
 

export function webLayout()            {
  const H = screenH();
  const ins = screenInsets();
  const innerTop = H / 2 - CARD_MARGIN - CARD_BORDER;
  const wx = !!(globalThis                    ).wx;
  // 微信：计分条右端的计时会压到胶囊，整条让到胶囊行之下
  const barTop = wx ? Math.min(innerTop, ins.contentTop) : innerTop;
  const barY = barTop - BAR_H / 2;
  return {
    H,
    barY,
    boardTop: barTop - BAR_H - 10,
    boardBottom: Math.max(-H / 2 + CARD_MARGIN + CARD_BORDER, ins.bottom),
    innerW: BAR_W,
  };
}

                                                                                              

export class WebHud {
           root      ;
                   L           ;
          goalFlag       = null ;
          goalL        = null ;
          goalValue = -1;
          timer       = null ;
          timerOp            = null ;
          timeL        = null ;
          scorePanel       = null ;
          flaps         = [];
          danger = false;
          clock = 0;

  constructor(parent      , onBack            ) {
    this.L = webLayout();
    const L = this.L;
    this.root = mkNode(parent, 'WebHud', 1080, L.H);
    this.buildBackdrop();
    this.buildBar(onBack);
    onFrame(this.root, (dt) => this.tick(dt));
  }

  destroy()       {
    if (this.root.isValid) this.root.destroy();
  }

  /** 得分面板中心（本节点坐标，飘字落点） */
  get scoreAnchor()       {
    return new Vec3(COL_SCORE, this.L.barY, 0);
  }

  update(score        , goal        , timeLeft        )       {
    // 翻牌只显示两位（web 同口径：score % 100）
    const disp = ((score % 100) + 100) % 100;
    this.setDigit(this.flaps[0] , Math.floor(disp / 10) % 10);
    this.setDigit(this.flaps[1] , disp % 10);
    if (goal !== this.goalValue) {
      this.goalValue = goal;
      this.goalL.string = String(goal);
      this.layoutGoal();
    }
    const s = Math.max(0, Math.floor(timeLeft));
    this.timeL.string = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    this.timeL.color = s <= 10 ? WEB.danger : s <= 60 ? WEB.warn : WEB.timerText;
    this.danger = s <= 10;
  }

  /** 飘字落到分数上那一刻，分数轻弹一下（web #hud-score.bump） */
  bump()       {
    const n = this.scorePanel;
    n.setScale(1, 1);
    tween(n).to(0.12, { scale: new Vec3(1.14, 1.14, 1) }).to(0.14, { scale: new Vec3(1, 1, 1) }).start();
  }

  /* ---------------------------------------------------------------- 内部 */

          tick(dt        )       {
    this.clock += dt;
    // 剩 10 秒：计时整体闪（web @keyframes pulse：50% 透明度 .45，周期 .8s）
    this.timerOp.opacity = this.danger
      ? Math.round(255 * (1 - 0.55 * (0.5 - 0.5 * Math.cos((this.clock / 0.8) * Math.PI * 2))))
      : 255;
  }

          buildBackdrop()       {
    const { H } = this.L;
    // 奶油底（radial-gradient 120% 80% at 50% 0%）
    const bg = mkGfx(this.root, 'Cream', 1080, H);
    bg.rect(-540, -H / 2, 1080, H);
    fillRadial(bg, 0, H / 2, H * 0.9, [[0, WEB.creamTop], [0.45, WEB.cream], [1, WEB.cream2]]);
    // 深蓝卡片 + 10px 金边
    const w = 1080 - 2 * CARD_MARGIN;
    const h = H - 2 * CARD_MARGIN;
    const card = mkGfx(this.root, 'GameCard', w, h);
    shadow(card, new Color(0, 0, 0, 89), 50, 0, 18);
    card.fillColor = WEB.card;
    card.roundRect(-w / 2, -h / 2, w, h, 52);
    card.fill();
    shadow(card, null);
    card.lineWidth = CARD_BORDER;
    card.strokeColor = WEB.cardBorder;
    card.roundRect(-w / 2 + CARD_BORDER / 2, -h / 2 + CARD_BORDER / 2, w - CARD_BORDER, h - CARD_BORDER, 52 - CARD_BORDER / 2);
    card.stroke();
    card.lineWidth = 2;
    card.strokeColor = new Color(255, 255, 255, 20);
    card.roundRect(-w / 2 + CARD_BORDER + 1, -h / 2 + CARD_BORDER + 1, w - 2 * CARD_BORDER - 2, h - 2 * CARD_BORDER - 2, 42);
    card.stroke();
  }

          buildBar(onBack            )       {
    const { barY } = this.L;
    const bar = mkGfx(this.root, 'Topbar', BAR_W, BAR_H, 0, barY);
    shadow(bar, new Color(0, 60, 120, 89), 18, 0, 6);
    bar.roundRect(-BAR_W / 2, -BAR_H / 2, BAR_W, BAR_H, 26);
    fillV(bar, BAR_H / 2, -BAR_H / 2, WEB.skyA, WEB.skyB);
    shadow(bar, null);
    // inset 高光（上沿一道亮）
    bar.fillColor = new Color(255, 255, 255, 60);
    rrect4(bar, -BAR_W / 2 + 2, BAR_H / 2 - 14, BAR_W - 4, 12, [24, 24, 0, 0]);
    bar.fill();
    bar.lineWidth = 2;
    bar.strokeColor = new Color(255, 210, 74, 179);
    bar.roundRect(-BAR_W / 2, -BAR_H / 2, BAR_W, BAR_H, 26);
    bar.stroke();

    this.buildExit(bar.node, onBack);
    this.buildGoal(bar.node);
    this.buildScore(bar.node);
    this.buildTimer(bar.node);
  }

          buildExit(parent      , onBack            )       {
    const s = EXIT_W;
    const n = mkNode(parent, 'Exit', s + 20, s + 20, COL_EXIT, 0);
    const g = n.addComponent(Graphics);
    g.fillColor = WEB.exitEdge;
    g.roundRect(-s / 2, -s / 2 - 4, s, s, 18);
    g.fill();
    g.fillColor = WEB.exit;
    g.roundRect(-s / 2, -s / 2, s, s, 18);
    g.fill();
    g.lineWidth = 2;
    g.strokeColor = new Color(255, 255, 255, 20);
    g.roundRect(-s / 2 + 1, -s / 2 + 1, s - 2, s - 2, 17);
    g.stroke();
    mkText(n, '←', 0, 2, s, { font: FONT_SANS, size: 44, color: WEB.timerText, bold: true });
    n.on(Node.EventType.TOUCH_START, () => n.setPosition(COL_EXIT, -2));
    n.on(Node.EventType.TOUCH_CANCEL, () => n.setPosition(COL_EXIT, 0));
    n.on(Node.EventType.TOUCH_END, () => { n.setPosition(COL_EXIT, 0); onBack(); });
  }

  /** 目标线：旗帜 + 1 星线分数（web .hud-goal，svg 60×72 逐点换算成 y 向上） */
          buildGoal(parent      )       {
    const f = mkNode(parent, 'Flag', 60, 72, COL_GOAL, 0);
    const g = f.addComponent(Graphics);
    shadow(g, new Color(0, 40, 90, 102), 3, 0, 3);
    g.fillColor = hex('#f1f4f9');
    g.roundRect(-20, -30, 6, 58, 3);
    g.fill();
    g.moveTo(-14, 22);
    g.lineTo(20, 6);
    g.lineTo(-14, -10);
    g.close();
    g.fillColor = hex('#ff5b4a');
    g.fill();
    shadow(g, null);
    g.lineWidth = 2;
    g.strokeColor = hex('#d83b2c');
    g.stroke();
    g.moveTo(-14, 22);
    g.lineTo(4, 13);
    g.lineTo(-14, 4);
    g.close();
    g.fillColor = new Color(255, 255, 255, 71);
    g.fill();
    g.circle(-17, 28, 7);
    g.fillColor = WEB.gold;
    g.fill();
    g.lineWidth = 1.5;
    g.strokeColor = hex('#caa12f');
    g.stroke();
    this.goalFlag = f;
    this.goalL = mkText(parent, '0', COL_GOAL, 0, 220, {
      font: NUM_FONT, size: 66, color: WEB.gold, bold: true, align: 'left',
      shadow: { color: new Color(0, 0, 0, 255), y: 2 },
    });
  }

  /** 旗帜 + 数字整体在列内居中（数字位数会变） */
          layoutGoal()       {
    const numW = String(this.goalValue).length * 66 * 0.56;
    const total = 60 + 12 + numW;
    const left = COL_GOAL - total / 2;
    this.goalFlag.setPosition(left + 30, 0);
    // 左对齐 Label：节点中心 = 文字左端 + 半宽
    this.goalL.node.setPosition(left + 72 + 110, 0);
  }

  /** 翻牌式两位数计分面板（web .hud-score / .flap） */
          buildScore(parent      )       {
    const w = SCORE_W;
    const h = 128 + 28 + 6;
    const p = mkNode(parent, 'Score', w, h, COL_SCORE, 0);
    const g = p.addComponent(Graphics);
    g.lineWidth = 2;
    g.strokeColor = new Color(255, 210, 74, 46);
    g.roundRect(-w / 2 - 2, -h / 2 - 2, w + 4, h + 4, 18);
    g.stroke();
    g.roundRect(-w / 2, -h / 2, w, h, 16);
    fillV(g, h / 2, -h / 2, hex('#0c2e57'), hex('#07203f'));
    // 内凹：上沿一圈暗
    g.fillColor = new Color(0, 0, 0, 70);
    rrect4(g, -w / 2 + 3, h / 2 - 16, w - 6, 13, [13, 13, 0, 0]);
    g.fill();
    g.lineWidth = 3;
    g.strokeColor = new Color(255, 255, 255, 64);
    g.roundRect(-w / 2 + 1.5, -h / 2 + 1.5, w - 3, h - 3, 15);
    g.stroke();
    this.scorePanel = p;
    this.flaps = [-52, 52].map((x) => this.buildFlap(p, x));
  }

          buildFlap(parent      , x        )       {
    const fw = 92;
    const fh = 128;
    const n = mkNode(parent, 'Flap', fw, fh, x, 0);
    const g = n.addComponent(Graphics);
    g.fillColor = new Color(0, 0, 0, 102);
    g.roundRect(-fw / 2, -fh / 2 - 3, fw, fh, 12);
    g.fill();
    g.fillColor = hex('#0a2444');
    g.roundRect(-fw / 2, -fh / 2, fw, fh, 12);
    g.fill();
    g.fillColor = hex('#163a64');
    rrect4(g, -fw / 2, 0, fw, fh / 2, [12, 12, 0, 0]);
    g.fill();
    g.lineWidth = 2;
    g.strokeColor = new Color(0, 0, 0, 102);
    g.roundRect(-fw / 2 + 1, -fh / 2 + 1, fw - 2, fh - 2, 11);
    g.stroke();
    const face = mkNode(n, 'Face', fw, fh);
    const label = mkText(face, '0', 0, 0, fw, {
      font: NUM_FONT, size: 90, color: WEB.gold, bold: true,
      shadow: { color: new Color(255, 210, 74, 115), blur: 12 },
    });
    // 中缝画在数字上面（web .flap::after）
    const seam = mkGfx(n, 'Seam', fw, 4);
    seam.fillColor = new Color(0, 0, 0, 140);
    seam.rect(-fw / 2, -1.5, fw, 3);
    seam.fill();
    return { face, label, value: 0, flipping: false, pending: 0 };
  }

  /** 翻牌：旧数字转走（scaleY → 0）→ 换字 → 新数字转回 */
          setDigit(f      , d        )       {
    f.pending = d;
    if (f.flipping || f.value === d) return;
    f.flipping = true;
    tween(f.face)
      .to(0.13, { scale: new Vec3(1, 0.02, 1) })
      .call(() => { f.value = f.pending; f.label.string = String(f.pending); })
      .to(0.13, { scale: new Vec3(1, 1, 1) })
      .call(() => {
        f.flipping = false;
        if (f.pending !== f.value) this.setDigit(f, f.pending);
      })
      .start();
  }

  /** 倒计时：🕒 + mm:ss，整组靠右（web .hud-timer justify-self:end） */
          buildTimer(parent      )       {
    const numW = 170;
    const total = 54 + 12 + numW;
    const cx = TIMER_RIGHT - total / 2;
    this.timer = mkNode(parent, 'Timer', total, 90, cx, 0);
    this.timerOp = this.timer.addComponent(UIOpacity);
    mkText(this.timer, '🕒', -total / 2 + 27, 0, 70, { font: FONT_SANS, size: 54, color: new Color(255, 255, 255) });
    this.timeL = mkText(this.timer, '03:00', total / 2 - numW / 2, 0, numW, {
      font: NUM_FONT, size: 60, color: WEB.timerText, bold: true, align: 'right',
      shadow: { color: new Color(0, 0, 0, 255), y: 2 },
    }             );
  }
}

export { alpha };
