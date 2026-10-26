/**
 * 对局 HUD + 背景的三主题实现（2026-10-25 重做）——按 design/ 三原型逐个照搬排版：
 *
 *   candy  （原型 A）木牌分数卡 | 三颗星插座 | 金色计时环；下方「★线」三段进度条；
 *          底栏粉色模式糖果标签 + 黑底体力胶囊
 *   clean  （原型 B）白分数胶囊 | 关卡小圆片 | 白色计时圆钮；下方白卡星线（段尾星节点）；
 *          底栏半透明白胶囊
 *   journal（原型 C）和纸胶带贴着的分数便签 | 手写页注 | 胶带计时便签（虚线环）；
 *          虚线星线 + 三枚星章；底栏描边胶囊；页面左侧红色页边线
 *
 * 坐标：挂在 GameBootstrap.node 下，原点在屏幕中心、y 向上；纵向位置全由 HudLayout 给，
 * 长屏（> 1920）时 HUD 贴顶、底栏贴底，棋盘吃掉中间。
 */

import { Node, Graphics, Label, Color, Vec3, tween } from 'cc';
import { currentTheme, P_CANDY, P_CLEAN, P_JOURNAL, type GameTheme } from './theme';
import {
  alpha, fillV, fillLinear, fillRadial, shadow, dash, starPath, heartPath, backArrow,
  mkNode, mkGfx, mkText, type TextStyle,
} from './paint';

export interface HudLayout {
  W: number;
  H: number;
  /** 返回键所在行（与微信胶囊同高） */
  navY: number;
  /** 分数 / 星 / 计时 那一行的中心 */
  hudY: number;
  /** 星线行中心 */
  goalY: number;
  /** 棋盘下方操作提示行 */
  hintY: number;
  /** 底栏中心 */
  footerY: number;
}

export interface HudState {
  score: number;
  lines: [number, number, number];
  timeLeft: number;
  timeLimit: number;
  stamina: number;
  staminaMax: number;
}

export interface HudCallbacks {
  onBack: () => void;
  onHint: () => void;
}

const SIDE = 516;   // 屏幕左右留白后的半宽（1080/2 - 24）

/** 千分位（不用 toLocaleString：部分安卓 JS 引擎不插逗号） */
export function fmtNum(n: number): string {
  return String(Math.max(0, Math.floor(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** m:ss（计时圆环里放不下 03:00 五个字） */
export function fmtClock(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** 估算文字宽度（中文按 1 字宽、ASCII 按 0.58） */
export function estW(text: string, size: number): number {
  let w = 0;
  for (const ch of text) w += ch.charCodeAt(0) > 0x2e80 ? 1 : 0.58;
  return w * size;
}

interface StarSlot { node: Node; g: Graphics; on: boolean }
interface Seg { g: Graphics; w: number; h: number; node: Node | null; nodeG: Graphics | null; on: boolean }

export class ThemeHud {
  readonly root: Node;
  private readonly t: GameTheme;
  private readonly L: HudLayout;
  private scoreL: Label = null!;
  private timeL: Label = null!;
  private tagL: Label = null!;
  private tagG: Graphics | null = null;
  private nextL: Label | null = null;
  private energyL: Label = null!;
  private timerNode: Node = null!;
  private timerFg: Graphics = null!;
  private timerR = 80;
  private timerW = 20;
  private stars: StarSlot[] = [];
  private segs: Seg[] = [];
  private urgent = false;
  private clock = 0;
  private primed = false;
  private mode = '简单';
  private level = 1;

  constructor(parent: Node, L: HudLayout, cb: HudCallbacks) {
    this.t = currentTheme();
    this.L = L;
    this.root = mkNode(parent, 'ThemeHud', L.W, L.H);
    if (this.t.id === 'candy') this.buildCandy(cb);
    else if (this.t.id === 'clean') this.buildClean(cb);
    else this.buildJournal(cb);
  }

  destroy(): void {
    if (this.root.isValid) this.root.destroy();
  }

  setLevel(mode: string, level: number): void {
    this.mode = mode;
    this.level = level;
    this.paintTag();
    if (this.t.id === 'clean' && this.levelChip) this.paintLevelChip();
  }

  /** 每秒 / 每次得分调一次 */
  update(s: HudState): void {
    this.scoreL.string = fmtNum(s.score);
    this.timeL.string = fmtClock(s.timeLeft);
    this.energyL.string = this.t.id === 'candy' ? `${s.stamina}/${s.staminaMax}` : `体力 ${s.stamina}/${s.staminaMax}`;
    const next = s.lines.find((v) => v > s.score);
    if (this.nextL) this.nextL.string = next === undefined ? 'MAX' : fmtNum(next);

    // 星插座 / 星节点
    for (let i = 0; i < 3; i++) {
      const on = s.score >= s.lines[i]!;
      const slot = this.stars[i];
      if (slot && slot.on !== on) {
        slot.on = on;
        this.paintStar(i, on);
        if (this.primed && on) this.pop(slot.node);
      }
    }
    // 星线进度
    for (let i = 0; i < this.segs.length; i++) {
      const lo = this.t.id === 'candy' ? 0 : i === 0 ? 0 : s.lines[i - 1]!;
      const hi = s.lines[i]!;
      const k = Math.max(0, Math.min(1, (s.score - lo) / Math.max(1, hi - lo)));
      this.paintSeg(i, this.t.id === 'candy' ? Math.min(1, s.score / hi) : k, s.score >= hi);
    }
    // 计时环
    this.urgent = s.timeLeft <= 10;
    this.paintTimer(Math.max(0, Math.min(1, s.timeLeft / Math.max(1, s.timeLimit))));
    this.timeL.color = this.timeColor(s.timeLeft);
    this.primed = true;
  }

  /** 每帧：紧急时计时器脉动 */
  tick(dt: number): void {
    this.clock += dt;
    if (!this.timerNode?.isValid) return;
    if (this.urgent) {
      const k = 1 + (this.t.id === 'candy' ? 0.07 : 0.05) * (0.5 + 0.5 * Math.sin(this.clock * Math.PI * 2 / 1.0));
      this.timerNode.setScale(k, k);
      if (this.t.id === 'journal') this.timerNode.angle = Math.sin(this.clock * Math.PI * 2) * 1.2;
    } else {
      this.timerNode.setScale(1, 1);
      this.timerNode.angle = 0;
    }
  }

  /* ================================================================ 公共小件 */

  private pop(n: Node): void {
    n.setScale(0.3, 0.3);
    tween(n).to(0.22, { scale: new Vec3(1.35, 1.35, 1) }).to(0.16, { scale: new Vec3(1, 1, 1) }).start();
  }

  private timeColor(left: number): Color {
    if (this.t.id === 'candy') return left <= 10 ? new Color(255, 214, 206) : new Color(255, 255, 255);
    if (this.t.id === 'clean') return left <= 10 ? P_CLEAN.coral : P_CLEAN.ink;
    return left <= 10 ? P_JOURNAL.stamp : P_JOURNAL.ink;
  }

  private paintTimer(k: number): void {
    const g = this.timerFg;
    g.clear();
    if (k <= 0.002) return;
    const r = this.timerR;
    const a0 = Math.PI / 2;
    const a1 = a0 - Math.PI * 2 * k;   // y 向上：角度递减 = 顺时针
    g.lineWidth = this.timerW;
    g.strokeColor = this.t.id === 'candy'
      ? (this.urgent ? P_CANDY.cta : P_CANDY.gold)
      : this.t.id === 'clean' ? (this.urgent ? P_CLEAN.coral : P_CLEAN.gold) : P_JOURNAL.stamp;
    g.moveTo(0, r);
    g.arc(0, 0, r, a0, a1, true);
    g.stroke();
  }

  private paintTag(): void {
    if (!this.tagL) return;
    const text = this.t.copy.modeTag(this.mode, this.level);
    this.tagL.string = text;
    const g = this.tagG;
    if (!g) return;
    const size = this.tagL.fontSize;
    const w = Math.round(estW(text, size) + 64);
    const h = this.t.id === 'clean' ? 80 : 72;
    // 标签左端贴住左边距：节点 x 跟着宽度挪
    g.node.setPosition(-SIDE + w / 2, this.L.footerY);
    this.tagL.node.setPosition(0, this.t.id === 'candy' ? 3 : 0);
    g.clear();
    if (this.t.id === 'candy') {
      g.fillColor = P_CANDY.candyEdge;
      g.roundRect(-w / 2, -h / 2 - 11, w, h, h / 2);
      g.fill();
      g.roundRect(-w / 2, -h / 2, w, h, h / 2);
      fillV(g, h / 2, -h / 2, new Color(255, 140, 186), P_CANDY.candy);
      g.fillColor = new Color(255, 255, 255, 100);
      g.roundRect(-w / 2 + 18, h / 2 - 12, w - 36, 6, 3);
      g.fill();
    } else if (this.t.id === 'clean') {
      g.fillColor = new Color(255, 255, 255, 191);
      g.roundRect(-w / 2, -h / 2, w, h, h / 2);
      g.fill();
    } else {
      g.fillColor = P_JOURNAL.sheet;
      g.roundRect(-w / 2, -h / 2, w, h, h / 2);
      g.fill();
      g.lineWidth = 4;
      g.strokeColor = P_JOURNAL.rail;
      g.stroke();
    }
  }

  private levelChip: { g: Graphics; l: Label } | null = null;
  private paintLevelChip(): void {
    if (!this.levelChip) return;
    const text = `第 ${this.level} 关 · ${this.mode}`;
    const { g, l } = this.levelChip;
    l.string = text;
    const w = Math.round(estW(text, 36) + 110);
    const h = 96;
    g.clear();
    shadow(g, P_CLEAN.shadow, 44, 0, 22);
    g.fillColor = P_CLEAN.card;
    g.roundRect(-w / 2, -h / 2, w, h, h / 2);
    g.fill();
    shadow(g, null);
    g.fillColor = P_CLEAN.mint;
    g.circle(-w / 2 + 48, 0, 10);
    g.fill();
    l.node.setPosition(18, 0);
  }

  /** 底栏：模式标签（左）+ 提示键（中）+ 体力（右）；棋盘下操作提示 */
  private buildFooter(cb: HudCallbacks, tagStyle: TextStyle, energyStyle: TextStyle, hintStyle: TextStyle): void {
    const L = this.L;
    mkText(this.root, this.t.copy.boardHint, 0, L.hintY, 1000, hintStyle, 'BoardHint');

    this.tagG = mkGfx(this.root, 'ModeTag', 360, 80, -SIDE + 180, L.footerY);
    this.tagL = mkText(this.tagG.node, '', 0, 0, 520, tagStyle);
    this.paintTag();

    // 体力胶囊（右对齐）
    const ew = this.t.id === 'candy' ? 212 : 250;
    const eh = this.t.id === 'clean' ? 80 : 72;
    const eg = mkGfx(this.root, 'Energy', ew, eh, SIDE - ew / 2, L.footerY);
    if (this.t.id === 'candy') {
      eg.fillColor = new Color(0, 0, 0, 77);
      eg.roundRect(-ew / 2, -eh / 2, ew, eh, eh / 2);
      eg.fill();
      eg.fillColor = new Color(0, 0, 0, 50);
      eg.roundRect(-ew / 2 + 4, eh / 2 - 12, ew - 8, 8, 4);
      eg.fill();
      heartPath(eg, -ew / 2 + 46, 0, 22);
      fillV(eg, 22, -22, new Color(255, 230, 120), P_CANDY.gold);
      this.energyL = mkText(eg.node, '', 28, 0, 130, energyStyle);
    } else {
      eg.fillColor = this.t.id === 'clean' ? new Color(255, 255, 255, 191) : P_JOURNAL.sheet;
      eg.roundRect(-ew / 2, -eh / 2, ew, eh, eh / 2);
      eg.fill();
      if (this.t.id === 'journal') {
        eg.lineWidth = 4;
        eg.strokeColor = P_JOURNAL.rail;
        eg.stroke();
      }
      this.energyL = mkText(eg.node, '', 0, 0, ew - 20, energyStyle);
    }

    // 提示键（中）
    const hw = 210;
    const hh = 84;
    const hn = mkNode(this.root, 'BtnHint', hw, hh + 12, 0, L.footerY);
    const hg = hn.addComponent(Graphics);
    const txt: TextStyle = { font: this.t.font, size: 36, color: new Color(255, 255, 255), bold: true };
    if (this.t.id === 'candy') {
      hg.fillColor = P_CANDY.goEdge;
      hg.roundRect(-hw / 2, -hh / 2 - 12, hw, hh, hh / 2);
      hg.fill();
      hg.roundRect(-hw / 2, -hh / 2, hw, hh, hh / 2);
      fillV(hg, hh / 2, -hh / 2, new Color(160, 234, 128), P_CANDY.go);
      hg.fillColor = new Color(255, 255, 255, 102);
      hg.roundRect(-hw / 2 + 22, hh / 2 - 13, hw - 44, 7, 3);
      hg.fill();
      txt.shadow = { color: new Color(0, 0, 0, 72), y: 4 };
    } else if (this.t.id === 'clean') {
      shadow(hg, new Color(245, 166, 35, 102), 40, 0, 18);
      hg.roundRect(-hw / 2, -hh / 2, hw, hh, 44);
      fillV(hg, hh / 2, -hh / 2, P_CLEAN.goldBtn, P_CLEAN.gold);
      shadow(hg, null);
    } else {
      hg.fillColor = P_JOURNAL.kraftDark;
      hg.roundRect(-hw / 2, -hh / 2 - 11, hw, hh, 28);
      hg.fill();
      hg.fillColor = P_JOURNAL.kraft;
      hg.roundRect(-hw / 2, -hh / 2, hw, hh, 28);
      hg.fill();
      txt.color = P_JOURNAL.btnText;
    }
    mkText(hn, this.t.copy.hintBtn, 0, 2, hw, txt);
    hn.on(Node.EventType.TOUCH_END, () => {
      hn.setScale(0.92, 0.92);
      tween(hn).to(0.12, { scale: new Vec3(1, 1, 1) }).start();
      cb.onHint();
    }, this);
  }

  /** 返回键（导航行最左） */
  private buildBack(cb: HudCallbacks): void {
    const w = 104;
    const h = 92;
    const n = mkNode(this.root, 'BtnBack', w + 20, h + 20, -SIDE + w / 2, this.L.navY);
    const g = n.addComponent(Graphics);
    if (this.t.id === 'candy') {
      g.fillColor = P_CANDY.woodEdge;
      g.roundRect(-w / 2, -h / 2 - 9, w, h, 30);
      g.fill();
      g.roundRect(-w / 2, -h / 2, w, h, 30);
      fillV(g, h / 2, -h / 2, P_CANDY.wood, P_CANDY.woodDark);
      g.lineWidth = 6;
      g.strokeColor = P_CANDY.woodEdge;
      g.roundRect(-w / 2, -h / 2, w, h, 30);
      g.stroke();
      backArrow(g, -4, 0, 46, P_CANDY.cream, 11);
    } else if (this.t.id === 'clean') {
      shadow(g, P_CLEAN.shadow, 44, 0, 20);
      g.fillColor = P_CLEAN.card;
      g.circle(0, 0, 46);
      g.fill();
      shadow(g, null);
      backArrow(g, -4, 0, 40, P_CLEAN.ink, 9);
    } else {
      shadow(g, new Color(74, 59, 42, 46), 30, 0, 14);
      g.fillColor = P_JOURNAL.sheet;
      g.roundRect(-w / 2, -h / 2, w, h, 14);
      g.fill();
      shadow(g, null);
      g.lineWidth = 3;
      g.strokeColor = P_JOURNAL.border;
      g.roundRect(-w / 2, -h / 2, w, h, 14);
      g.stroke();
      backArrow(g, -4, -2, 40, P_JOURNAL.ink, 8);
      const tape = mkGfx(n, 'Tape', 70, 26, 0, h / 2);
      tape.node.angle = 4;
      tape.fillColor = alpha(P_JOURNAL.washiBlue, 220);
      tape.roundRect(-35, -12, 70, 24, 3);
      tape.fill();
    }
    n.on(Node.EventType.TOUCH_END, () => cb.onBack(), this);
  }

  /* ================================================================ 糖果嘉年华 */

  private buildCandy(cb: HudCallbacks): void {
    const L = this.L;
    const P = P_CANDY;
    this.buildBack(cb);

    // ---- 木牌分数卡 ----
    const pw = 310;
    const ph = 150;
    const plank = mkGfx(this.root, 'ScorePlank', pw, ph, -SIDE + pw / 2, L.hudY);
    plank.fillColor = P.woodEdge;
    plank.roundRect(-pw / 2, -ph / 2 - 11, pw, ph, 38);
    plank.fill();
    shadow(plank, new Color(0, 0, 0, 60), 20, 0, 16);
    plank.roundRect(-pw / 2, -ph / 2, pw, ph, 38);
    fillV(plank, ph / 2, -ph / 2, P.wood, P.woodDark);
    shadow(plank, null);
    plank.lineWidth = 8;
    plank.strokeColor = P.woodEdge;
    plank.roundRect(-pw / 2, -ph / 2, pw, ph, 38);
    plank.stroke();
    plank.fillColor = new Color(255, 255, 255, 64);
    plank.roundRect(-pw / 2 + 24, ph / 2 - 16, pw - 48, 7, 3);
    plank.fill();
    mkText(plank.node, this.t.copy.scoreCap, -pw / 2 + 34 + 100, 34, 200, { font: this.t.font, size: 28, color: P.capText, align: 'left' });
    this.scoreL = mkText(plank.node, '0', -pw / 2 + 34 + 125, -20, 250, {
      font: this.t.font, size: 62, color: new Color(255, 255, 255), align: 'left',
      shadow: { color: new Color(0, 0, 0, 90), y: 5 },
    });

    // ---- 三星插座 ----
    this.stars = [];
    for (let i = 0; i < 3; i++) {
      const n = mkNode(this.root, `Sock${i}`, 124, 124, (i - 1) * 128, L.hudY - 16);
      const g = n.addComponent(Graphics);
      this.stars.push({ node: n, g, on: true });
      this.paintStar(i, false);
      this.stars[i]!.on = false;
    }

    // ---- 计时圆环 ----
    this.timerR = 82;
    this.timerW = 24;
    this.timerNode = mkNode(this.root, 'Timer', 210, 210, SIDE - 102, L.hudY - 4);
    const bg = this.timerNode.addComponent(Graphics);
    bg.fillColor = new Color(60, 24, 110, 90);
    bg.circle(0, 0, 70);
    bg.fill();
    bg.lineWidth = 24;
    bg.strokeColor = new Color(0, 0, 0, 77);
    bg.circle(0, 0, 82);
    bg.stroke();
    this.timerFg = mkGfx(this.timerNode, 'Fg', 210, 210);
    this.timeL = mkText(this.timerNode, '3:00', 0, 0, 160, {
      font: this.t.font, size: 54, color: new Color(255, 255, 255), shadow: { color: new Color(0, 0, 0, 100), y: 5 },
    });

    // ---- ★线 ----
    const gs: TextStyle = { font: this.t.font, size: 30, color: P.goalText };
    mkText(this.root, this.t.copy.goalCap, -SIDE + 40, L.goalY, 100, { ...gs, align: 'left' });
    this.nextL = mkText(this.root, '', SIDE - 60, L.goalY, 140, { ...gs, align: 'right' });
    const x0 = -SIDE + 92;
    const x1 = SIDE - 140;
    const gap = 16;
    const sw = (x1 - x0 - gap * 2) / 3;
    this.segs = [];
    for (let i = 0; i < 3; i++) {
      const n = mkNode(this.root, `Tick${i}`, sw, 30, x0 + sw / 2 + i * (sw + gap), L.goalY);
      const g = n.addComponent(Graphics);
      this.segs.push({ g, w: sw, h: 28, node: null, nodeG: null, on: false });
    }

    this.buildFooter(
      cb,
      { font: this.t.font, size: 32, color: new Color(255, 255, 255), shadow: { color: new Color(150, 40, 90, 120), y: 3 } },
      { font: this.t.font, size: 38, color: new Color(255, 255, 255) },
      { font: this.t.body, size: 30, color: alpha(P.hint, 220) },
    );
  }

  /* ================================================================ 果冻乐园 */

  private buildClean(cb: HudCallbacks): void {
    const L = this.L;
    const P = P_CLEAN;
    this.buildBack(cb);

    // ---- 分数胶囊 ----
    const pw = 300;
    const ph = 124;
    const pill = mkGfx(this.root, 'ScorePill', pw, ph, -SIDE + pw / 2, L.hudY);
    shadow(pill, P.shadow, 60, 0, 26);
    pill.fillColor = P.card;
    pill.roundRect(-pw / 2, -ph / 2, pw, ph, 56);
    pill.fill();
    shadow(pill, null);
    mkText(pill.node, this.t.copy.scoreCap, -pw / 2 + 40 + 40, -4, 80, { font: this.t.font, size: 30, color: P.inkSoft, bold: true, align: 'left' });
    this.scoreL = mkText(pill.node, '0', -pw / 2 + 120 + 80, 0, 170, { font: this.t.font, size: 56, color: P.gold, bold: true, align: 'left' });

    // ---- 关卡小圆片 ----
    const chip = mkGfx(this.root, 'LevelChip', 360, 96, -20, L.hudY + 6);
    const cl = mkText(chip.node, '', 18, 0, 320, { font: this.t.font, size: 36, color: P.ink, bold: true });
    this.levelChip = { g: chip, l: cl };
    this.paintLevelChip();

    // ---- 计时圆钮 ----
    this.timerR = 70;
    this.timerW = 14;
    this.timerNode = mkNode(this.root, 'Timer', 190, 190, SIDE - 93, L.hudY);
    const tg = this.timerNode.addComponent(Graphics);
    shadow(tg, P.shadow, 60, 0, 26);
    tg.fillColor = P.card;
    tg.circle(0, 0, 93);
    tg.fill();
    shadow(tg, null);
    tg.lineWidth = 14;
    tg.strokeColor = P.ringBg;
    tg.circle(0, 0, 70);
    tg.stroke();
    this.timerFg = mkGfx(this.timerNode, 'Fg', 190, 190);
    this.timeL = mkText(this.timerNode, '3:00', 0, 0, 130, { font: this.t.font, size: 44, color: P.ink, bold: true });

    // ---- 星线白卡 ----
    const gw = SIDE * 2;
    const gh = 108;
    const card = mkGfx(this.root, 'GoalCard', gw, gh, 0, L.goalY);
    shadow(card, P.shadow, 60, 0, 26);
    card.fillColor = P.card;
    card.roundRect(-gw / 2, -gh / 2, gw, gh, 40);
    card.fill();
    shadow(card, null);
    const cap: TextStyle = { font: this.t.font, size: 30, color: P.inkSoft, bold: true };
    mkText(card.node, this.t.copy.goalCap, -gw / 2 + 40 + 40, 0, 80, { ...cap, align: 'left' });
    this.nextL = mkText(card.node, '', gw / 2 - 40 - 60, 0, 120, { ...cap, align: 'right' });
    const x0 = -gw / 2 + 140;
    const x1 = gw / 2 - 150;
    const gap = 44;
    const sw = (x1 - x0 - gap * 2) / 3;
    this.segs = [];
    this.stars = [];
    for (let i = 0; i < 3; i++) {
      const cx = x0 + sw / 2 + i * (sw + gap);
      const n = mkNode(card.node, `Seg${i}`, sw, 24, cx, 0);
      const g = n.addComponent(Graphics);
      // 段尾星节点（最后一段贴在段内右端，与原型 .seg:last-child .node 一致）
      const nx = i === 2 ? cx + sw / 2 - 36 : cx + sw / 2 + 4;
      const sn = mkNode(card.node, `Node${i}`, 80, 80, nx, 0);
      const sg = sn.addComponent(Graphics);
      this.segs.push({ g, w: sw, h: 22, node: sn, nodeG: sg, on: false });
      this.stars.push({ node: sn, g: sg, on: true });
      this.paintStar(i, false);
      this.stars[i]!.on = false;
    }

    this.buildFooter(
      cb,
      { font: this.t.font, size: 32, color: P.inkSoft, bold: true },
      { font: this.t.font, size: 32, color: P.ink, bold: true },
      { font: this.t.body, size: 30, color: P.inkSoft, bold: true },
    );
  }

  /* ================================================================ 贴纸手账 */

  private buildJournal(cb: HudCallbacks): void {
    const L = this.L;
    const P = P_JOURNAL;
    this.buildBack(cb);
    const left = -540 + 66;

    // ---- 胶带分数便签 ----
    const pw = 290;
    const ph = 150;
    const note = mkNode(this.root, 'ScoreNote', pw, ph, left + pw / 2, L.hudY);
    note.angle = 1.2;
    this.taped(note, pw, ph, P.washiPink, -2);
    mkText(note, this.t.copy.scoreCap, -pw / 2 + 36 + 60, 34, 120, { font: this.t.font, size: 28, color: P.inkSoft, align: 'left' });
    this.scoreL = mkText(note, '0', -pw / 2 + 36 + 110, -20, 220, { font: this.t.font, size: 62, color: P.ink, bold: true, align: 'left' });

    // ---- 手写页注 ----
    mkText(this.root, '今天也要把', 40, L.hudY + 28, 420, { font: this.t.font, size: 34, color: P.pencil });
    mkText(this.root, '小可爱们贴满一页呀', 40, L.hudY - 22, 420, { font: this.t.font, size: 36, color: P.ink, bold: true });

    // ---- 胶带计时便签 ----
    const tw = 212;
    this.timerR = 78;
    this.timerW = 12;
    this.timerNode = mkNode(this.root, 'Timer', tw, tw, SIDE - tw / 2, L.hudY);
    this.taped(this.timerNode, tw, tw, P.washiBlue, 3);
    const rg = mkGfx(this.timerNode, 'RingBg', tw, tw);
    rg.lineWidth = 11;
    rg.strokeColor = P.ringBg;
    dash(rg, [12, 14]);
    rg.circle(0, 0, 78);
    rg.stroke();
    this.timerFg = mkGfx(this.timerNode, 'Fg', tw, tw);
    this.timeL = mkText(this.timerNode, '3:00', 0, 0, 160, { font: this.t.font, size: 56, color: P.ink, bold: true });

    // ---- 虚线星线 + 星章 ----
    const cap: TextStyle = { font: this.t.font, size: 30, color: P.inkSoft };
    mkText(this.root, this.t.copy.goalCap, left + 40, L.goalY, 80, { ...cap, align: 'left' });
    this.nextL = mkText(this.root, '', SIDE - 60, L.goalY, 130, { ...cap, align: 'right' });
    const x0 = left + 96;
    const x1 = SIDE - 140;
    const rail = mkGfx(this.root, 'Rail', x1 - x0, 20, 0, L.goalY);
    rail.lineWidth = 8;
    rail.strokeColor = P.rail;
    dash(rail, [28, 14]);
    rail.moveTo(x0, 0);
    rail.lineTo(x1 - 40, 0);
    rail.stroke();
    this.stars = [];
    const xs = [x0 + (x1 - x0) * 0.3, x0 + (x1 - x0) * 0.62, x1 - 36];
    for (let i = 0; i < 3; i++) {
      const n = mkNode(this.root, `PStar${i}`, 80, 80, xs[i]!, L.goalY);
      const g = n.addComponent(Graphics);
      this.stars.push({ node: n, g, on: true });
      this.paintStar(i, false);
      this.stars[i]!.on = false;
    }

    this.buildFooter(
      cb,
      { font: this.t.font, size: 32, color: P.inkSoft },
      { font: this.t.font, size: 32, color: P.ink },
      { font: this.t.body, size: 32, color: P.pencil },
    );
  }

  /** 手账便签：白纸 + 细边 + 投影 + 顶部一截和纸胶带 */
  private taped(n: Node, w: number, h: number, tape: Color, tapeAngle: number): void {
    const P = P_JOURNAL;
    const g = n.addComponent(Graphics);
    shadow(g, new Color(74, 59, 42, 46), 40, 0, 17);
    g.fillColor = P.sheet;
    g.roundRect(-w / 2, -h / 2, w, h, 16);
    g.fill();
    shadow(g, null);
    g.lineWidth = 3;
    g.strokeColor = P.border;
    g.roundRect(-w / 2, -h / 2, w, h, 16);
    g.stroke();
    const tg = mkGfx(n, 'Tape', 164, 44, 0, h / 2 + 2);
    tg.node.angle = tapeAngle;
    shadow(tg, new Color(0, 0, 0, 30), 6, 0, 3);
    tg.fillColor = alpha(tape, 217);
    tg.roundRect(-82, -21, 164, 42, 5);
    tg.fill();
    shadow(tg, null);
  }

  /* ================================================================ 星 / 进度绘制 */

  private paintStar(i: number, on: boolean): void {
    const slot = this.stars[i];
    if (!slot) return;
    const g = slot.g;
    g.clear();
    if (this.t.id === 'candy') {
      const P = P_CANDY;
      const r = 60;
      if (on) {
        shadow(g, new Color(255, 201, 60, 217), 50, 0, 0);
        g.circle(0, 0, r);
        fillRadial(g, 0, 0, r, [[0, P.goldLight], [1, P.gold]], 0, r * 0.24);
        shadow(g, null);
        g.lineWidth = 8;
        g.strokeColor = new Color(0, 0, 0, 40);
        g.moveTo(-r * 0.72, -r * 0.62);
        g.arc(0, 0, r - 4, Math.PI * 1.22, Math.PI * 1.78, false);
        g.stroke();
        shadow(g, new Color(180, 100, 0, 110), 4, 0, 4);
        starPath(g, 0, -2, 38);
        g.fillColor = new Color(255, 255, 255);
        g.fill();
        shadow(g, null);
      } else {
        shadow(g, new Color(0, 0, 0, 64), 0, 0, 6);
        g.circle(0, 0, r);
        fillRadial(g, 0, 0, r, [[0, P.socketA], [1, P.socketB]], 0, r * 0.24);
        shadow(g, null);
        g.lineWidth = 9;
        g.strokeColor = new Color(0, 0, 0, 90);
        g.moveTo(r * 0.7, r * 0.6);
        g.arc(0, 0, r - 5, Math.PI * 0.22, Math.PI * 0.78, false);
        g.stroke();
        starPath(g, 0, -2, 36);
        g.fillColor = new Color(120, 96, 150, 200);
        g.fill();
      }
    } else if (this.t.id === 'clean') {
      const P = P_CLEAN;
      if (on) {
        shadow(g, new Color(245, 166, 35, 128), 22, 0, 8);
        g.fillColor = P.card;
        g.circle(0, 0, 38);
        g.fill();
        shadow(g, null);
        g.circle(0, 0, 30);
        fillV(g, 30, -30, P.goldLight, P.gold);
        starPath(g, 0, -1, 17);
        g.fillColor = new Color(255, 255, 255);
        g.fill();
      } else {
        g.fillColor = P.card;
        g.circle(0, 0, 38);
        g.fill();
        g.fillColor = P.track;
        g.circle(0, 0, 30);
        g.fill();
        starPath(g, 0, -1, 17);
        g.fillColor = P.trackStar;
        g.fill();
      }
    } else {
      const P = P_JOURNAL;
      g.fillColor = on ? P.stampSoft : P.sheet;
      g.circle(0, 0, 34);
      g.fill();
      g.lineWidth = 6;
      g.strokeColor = on ? P.stamp : P.rail;
      g.circle(0, 0, 34);
      g.stroke();
      starPath(g, 0, -1, 19);
      g.fillColor = on ? P.stamp : P.rail;
      g.fill();
      slot.node.angle = on ? 8 : 0;
    }
  }

  private paintSeg(i: number, k: number, done: boolean): void {
    const s = this.segs[i];
    if (!s) return;
    const g = s.g;
    const { w, h } = s;
    g.clear();
    if (this.t.id === 'candy') {
      if (done) shadow(g, new Color(255, 201, 60, 180), 28, 0, 0);
      g.fillColor = new Color(0, 0, 0, 82);
      g.roundRect(-w / 2, -h / 2, w, h, h / 2);
      g.fill();
      shadow(g, null);
      if (k > 0) {
        const fw = Math.max(h, w * k);
        g.roundRect(-w / 2, -h / 2, fw, h, h / 2);
        fillLinear(g, -w / 2, 0, -w / 2 + fw, 0, [[0, new Color(255, 178, 94)], [1, P_CANDY.gold]]);
        g.fillColor = new Color(255, 255, 255, 80);
        g.roundRect(-w / 2 + 6, h / 2 - 9, Math.max(0, fw - 12), 5, 2);
        g.fill();
      }
    } else {
      g.fillColor = P_CLEAN.track;
      g.roundRect(-w / 2, -h / 2, w, h, h / 2);
      g.fill();
      if (k > 0) {
        const fw = Math.max(h, w * k);
        g.roundRect(-w / 2, -h / 2, fw, h, h / 2);
        fillLinear(g, -w / 2, 0, -w / 2 + fw, 0, [[0, P_CLEAN.goldLight], [1, P_CLEAN.gold]]);
      }
    }
    s.on = done;
  }
}

/* ================================================================ 背景 */

/** 全屏主题背景（垫在最底层） */
export function buildThemeBg(parent: Node, W: number, H: number): Node {
  const t = currentTheme();
  const g = mkGfx(parent, 'ThemeBg', W, H);
  const top = H / 2;
  const bot = -H / 2;
  if (t.id === 'candy') {
    const P = P_CANDY;
    g.rect(-W / 2, bot, W, H);
    fillLinear(g, -W * 0.04, top, W * 0.04, bot, [[0, P.skyA], [0.62, P.skyB], [1, P.skyC]]);
    glow(g, -W * 0.38, top - H * 0.06, 260, new Color(255, 255, 255, 56));
    glow(g, W * 0.38, top - H * 0.14, 380, new Color(255, 177, 222, 64));
    glow(g, 0, bot - 40, 560, new Color(120, 80, 200, 128));
    // 糖豆散点（远景小彩点，增加层次）
    const dots: Array<[number, number, number, Color]> = [
      [-430, 0.30, 10, new Color(255, 214, 102, 90)], [400, 0.36, 8, new Color(255, 160, 210, 100)],
      [-470, -0.12, 7, new Color(160, 230, 255, 80)], [460, -0.2, 11, new Color(255, 214, 102, 70)],
      [-380, -0.4, 9, new Color(255, 160, 210, 70)], [420, 0.05, 6, new Color(255, 255, 255, 90)],
    ];
    for (const [x, ky, r, col] of dots) {
      g.fillColor = col;
      g.circle(x, H * ky, r);
      g.fill();
    }
  } else if (t.id === 'clean') {
    const P = P_CLEAN;
    g.rect(-W / 2, bot, W, H);
    fillLinear(g, 0, top, W * 0.03, bot, [[0, P.skyA], [0.7, P.skyB], [1, P.skyC]]);
    glow(g, W * 0.36, top - H * 0.08, 340, new Color(245, 166, 35, 36));
    glow(g, -W * 0.42, bot + H * 0.08, 440, new Color(47, 191, 143, 31));
    glow(g, -W * 0.3, top - H * 0.24, 260, new Color(255, 255, 255, 128));
    // 几朵软云
    cloud(g, -330, top - H * 0.40, 1.0);
    cloud(g, 360, top - H * 0.52, 0.8);
    cloud(g, -380, bot + H * 0.20, 0.7);
  } else {
    const P = P_JOURNAL;
    g.fillColor = P.paper;
    g.rect(-W / 2, bot, W, H);
    g.fill();
    // 纸纹格（原型 repeating-linear-gradient 4px 一格，放大到 22px 一格更像本子）
    g.lineWidth = 2;
    g.strokeColor = new Color(74, 59, 42, 12);
    for (let x = -W / 2; x <= W / 2; x += 44) { g.moveTo(x, bot); g.lineTo(x, top); }
    for (let y = bot; y <= top; y += 44) { g.moveTo(-W / 2, y); g.lineTo(W / 2, y); }
    g.stroke();
    glow(g, 0, bot - 80, 700, new Color(74, 59, 42, 26));
    // 页边红线
    g.fillColor = new Color(214, 69, 69, 64);
    g.rect(-W / 2 + 28, bot, 5, H);
    g.fill();
  }
  g.node.setSiblingIndex(0);
  return g.node;
}

function glow(g: Graphics, x: number, y: number, r: number, c: Color): void {
  g.circle(x, y, r);
  fillRadial(g, x, y, r, [[0, c], [1, alpha(c, 0)]]);
}

function cloud(g: Graphics, x: number, y: number, s: number): void {
  g.fillColor = new Color(255, 255, 255, 120);
  g.circle(x - 70 * s, y, 46 * s);
  g.fill();
  g.circle(x, y + 22 * s, 64 * s);
  g.fill();
  g.circle(x + 74 * s, y + 4 * s, 50 * s);
  g.fill();
  g.roundRect(x - 116 * s, y - 46 * s, 240 * s, 60 * s, 30 * s);
  g.fill();
}

/** 调试/测试：主题 HUD 的当前文字（不依赖渲染） */
export function hudTexts(h: ThemeHud): { score: string; time: string } {
  const any = h as unknown as { scoreL: Label; timeL: Label };
  return { score: any.scoreL.string, time: any.timeL.string };
}
