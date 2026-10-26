/**
 * 第 1 关（原样式 classic）的结算 / 续命 / 失败弹窗 —— 照搬 web 原型 `web/ui/result.ts`（2026-10-25）：
 *
 *   一块带麻绳的奶油牌子从屏幕上方「吊下来」（整屏垂直居中，宽 820），
 *   顶部英雄图标（👑 / 🏆 / 三颗星 / ⏰ / 💡）→ 金描边大标题 → 副文案 →
 *   得分卡（标签 + 从 0 滚上去的大号分数 + 辅助文案）→ 次要提示 → 按钮行（绿=主、灰=次）。
 *   右上角 ✕ = 返回主页（统一逃生口）。
 *
 * 样式数值全部取自 web/ui.css 的 .lp-* / .rs-*；数据与按钮由 GameBootstrap 按 web/main.ts 的
 * showHonorDialog / showReviveDialog / showFailDialog 同口径组装。
 */

import { Node, Graphics, Label, Color, Vec3, tween, UIOpacity, EventTouch } from 'cc';
import { hex, fillV, shadow, starPath, mkNode, mkGfx, mkText, onFrame, screenH, type TextStyle } from './paint';
import { estW } from './themeHud';
import { FONT_SANS } from './theme';

export interface WebButton {
  label: string;
  primary?: boolean;
  /** 置灰仍可点：点了只弹 disabledHint，不关弹窗（web dialog 同语义） */
  dim?: boolean;
  disabledHint?: string;
  onClick: () => void;
}

export interface WebResultOptions {
  mode: 'win' | 'lose';
  /** emoji 图标（👑 / 🏆 / ⏰ / 💡） */
  icon?: string;
  /** 传了就画三颗星（点亮前 N 颗），优先于 icon */
  stars?: number;
  title: string;
  sub?: string;
  scoreLabel: string;
  score: number;
  hint?: string;
  note?: string;
  rows: WebButton[][];
  onHome: () => void;
  /** 置灰按钮的提示走对局的 toast */
  toast: (text: string) => void;
}

const BROWN = hex('#6B4A2F');
const GOLD_EDGE = hex('#F5C542');
const W = 820;
const PAD_X = 56;
const INNER = W - 2 * PAD_X;

export function showWebResult(parent: Node, o: WebResultOptions): Node {
  const H = screenH();
  const root = mkNode(parent, 'WebResult', 1080, H);
  const op = root.addComponent(UIOpacity);
  const mask = mkGfx(root, 'Mask', 1080, H);
  mask.fillColor = new Color(20, 12, 4, 87);
  mask.rect(-540, -H / 2, 1080, H);
  mask.fill();
  const block = (e: EventTouch): void => { e.propagationStopped = true; };
  mask.node.on(Node.EventType.TOUCH_START, block);
  mask.node.on(Node.EventType.TOUCH_END, block);

  let closed = false;
  const close = (then?: () => void): void => {
    if (closed) return;
    closed = true;
    root.destroy();
    then?.();
  };

  /* ---------- 先排版（自上而下累加高度），再画底板 ---------- */
  const drop = mkNode(root, 'Drop', W, H);
  const card = mkNode(drop, 'Card', W, 100);
  const items: Array<{ h: number; place: (yTop: number) => void }> = [];
  const add = (h: number, place: (yTop: number) => void): void => { items.push({ h, place }); };

  // 英雄图标
  if (o.stars !== undefined) {
    const lit = o.stars;
    add(72 + 16, (y) => {
      for (let i = 0; i < 3; i++) {
        const sn = mkGfx(card, `HeroStar${i}`, 80, 80, (i - 1) * 82, y - 36);
        starPath(sn, 0, -2, 34, 0.48);
        if (i < lit) {
          shadow(sn, new Color(180, 120, 30, 128), 14, 0, 6);
          fillV(sn, 34, -34, hex('#FFE27A'), hex('#F5B100'));
          shadow(sn, null);
          sn.lineWidth = 3;
          sn.strokeColor = hex('#E09A00');
          starPath(sn, 0, -2, 34, 0.48);
          sn.stroke();
          sn.node.setScale(0.2, 0.2);
          sn.node.angle = 40;
          tween(sn.node).delay(0.35 + i * 0.12).to(0.38, { scale: new Vec3(1, 1, 1), angle: 0 }).start();
        } else {
          sn.fillColor = new Color(120, 110, 100, 72);
          sn.fill();
        }
      }
    });
  } else if (o.icon) {
    add(150 + 16, (y) => {
      const t = mkText(card, o.icon!, 0, y - 75, 220, { font: FONT_SANS, size: 150, color: new Color(255, 255, 255), lineHeight: 160 });
      t.node.setScale(1.9, 1.9);
      const top = t.node.addComponent(UIOpacity);
      top.opacity = 0;
      tween(top).delay(0.3).to(0.2, { opacity: 255 }).start();
      tween(t.node).delay(0.3).to(0.46, { scale: new Vec3(1, 1, 1) }).start();
    });
  }

  // 标题：84px 棕字 + 3px 金描边（web -webkit-text-stroke）
  const titleLines = wrap(o.title, 84, INNER);
  add(4 + titleLines.length * 94 + 12, (y) => {
    mkText(card, titleLines.join('\n'), 0, y - 4 - titleLines.length * 47, INNER, {
      font: FONT_SANS, size: 84, color: BROWN, bold: true, lineHeight: 94,
      outline: GOLD_EDGE, outlineWidth: 3, shadow: { color: new Color(0, 0, 0, 31), y: 4 },
    });
  });

  if (o.sub) {
    const lines = wrap(o.sub, 38, INNER);
    add(lines.length * 52 + 16, (y) => {
      mkText(card, lines.join('\n'), 0, y - lines.length * 26, INNER, { font: FONT_SANS, size: 38, color: BROWN, bold: true, lineHeight: 52 });
    });
  }

  // 得分卡
  const hintLines = o.hint ? wrap(o.hint, 34, INNER - 48) : [];
  const scH = 26 + 46 + 4 + 116 + 4 + hintLines.length * 46 + 30;
  add(8 + scH + 22, (y) => {
    const top = y - 8;
    const sc = mkGfx(card, 'ScoreCard', INNER, scH, 0, top - scH / 2);
    sc.roundRect(-INNER / 2, -scH / 2, INNER, scH, 28);
    fillV(sc, scH / 2, -scH / 2, hex('#FFFDF6'), hex('#FBEFD2'));
    sc.lineWidth = 3;
    sc.strokeColor = hex('#EAD08A');
    sc.roundRect(-INNER / 2, -scH / 2, INNER, scH, 28);
    sc.stroke();
    let yy = scH / 2 - 26;
    mkText(sc.node, o.scoreLabel, 0, yy - 23, INNER, { font: FONT_SANS, size: 36, color: hex('#8a6a44'), bold: true });
    yy -= 46 + 4;
    const value = mkText(sc.node, '0', 0, yy - 58, INNER, {
      font: FONT_SANS, size: 116, color: hex('#E8A100'), bold: true, lineHeight: 120,
      shadow: { color: new Color(120, 80, 10, 64), y: 4 },
    });
    roll(value, o.score);
    yy -= 116 + 4;
    if (hintLines.length) {
      mkText(sc.node, hintLines.join('\n'), 0, yy - hintLines.length * 23, INNER - 48, { font: FONT_SANS, size: 34, color: BROWN, bold: true, lineHeight: 46 });
    }
  });

  if (o.note) {
    const lines = wrap(o.note, 30, INNER);
    add(4 + lines.length * 42 + 16, (y) => {
      mkText(card, lines.join('\n'), 0, y - 4 - lines.length * 21, INNER, { font: FONT_SANS, size: 30, color: hex('#9a7a55'), lineHeight: 42 });
    });
  }

  // 按钮行（宽度跟文字走，web padding 20px 56px + 3px 边）
  const BH = 40 * 1.25 + 40 + 6;
  for (const row of o.rows) {
    add(8 + BH + 6 + 16, (y) => {
      const ws = row.map((b) => Math.ceil(estW(b.label, 40)) + 112 + 6);
      const total = ws.reduce((a, b) => a + b, 0) + 24 * (row.length - 1);
      let x = -total / 2;
      row.forEach((b, i) => {
        const bw = ws[i]!;
        button(card, b, x + bw / 2, y - 8 - BH / 2, bw, BH, () => {
          if (b.dim) { if (b.disabledHint) o.toast(b.disabledHint); return; }
          close(b.onClick);
        });
        x += bw + 24;
      });
    });
  }

  const contentH = items.reduce((a, it) => a + it.h, 0);
  const CH = 72 + contentH + 82;
  // 牌子整屏垂直居中，绳子从屏顶垂到牌子上沿
  const cardY = 0;
  card.setPosition(0, cardY);
  const g = card.addComponent(Graphics);
  shadow(g, new Color(60, 40, 10, 115), 64, 0, 26);
  g.roundRect(-W / 2, -CH / 2, W, CH, 38);
  fillV(g, CH / 2, -CH / 2, hex('#FFF8E7'), hex('#fdeccb'));
  shadow(g, null);
  g.lineWidth = 6;
  g.strokeColor = GOLD_EDGE;
  g.roundRect(-W / 2 + 3, -CH / 2 + 3, W - 6, CH - 6, 35);
  g.stroke();
  let y = CH / 2 - 72;
  for (const it of items) { it.place(y); y -= it.h; }

  const ropeTop = H / 2;
  const ropeBottom = cardY + CH / 2 + 8;
  const rope = mkGfx(drop, 'Rope', 12, ropeTop - ropeBottom, 0, (ropeTop + ropeBottom) / 2);
  const rh = ropeTop - ropeBottom;
  rope.fillColor = hex('#7a4f29');
  rope.roundRect(-6, -rh / 2, 12, rh, 6);
  rope.fill();
  rope.fillColor = hex('#c98a4f');
  rope.rect(-2, -rh / 2 + 2, 4, rh - 4);
  rope.fill();
  rope.node.setSiblingIndex(0);

  // ✕ 关闭 = 返回主页
  const cx = mkNode(card, 'Close', 80, 80, W / 2 - 20 - 30, CH / 2 - 16 - 30);
  const cg = cx.addComponent(Graphics);
  cg.fillColor = new Color(0, 0, 0, 64);
  cg.circle(0, -3, 30);
  cg.fill();
  cg.fillColor = hex('#b06a3a');
  cg.circle(0, 0, 30);
  cg.fill();
  mkText(cx, '✕', 0, 1, 60, { font: FONT_SANS, size: 34, color: new Color(255, 255, 255), bold: true });
  cx.on(Node.EventType.TOUCH_END, () => close(o.onHome));

  // 吊下来：-170% → +6% → 0（web @keyframes lp-drop .55s）
  drop.setPosition(0, H * 1.2);
  tween(drop)
    .to(0.33, { position: new Vec3(0, -H * 0.04, 0) })
    .to(0.22, { position: new Vec3(0, 0, 0) })
    .start();
  op.opacity = 0;
  tween(op).to(0.2, { opacity: 255 }).start();
  return root;
}

function button(parent: Node, b: WebButton, x: number, y: number, w: number, h: number, onTap: () => void): void {
  const n = mkNode(parent, 'Btn', w, h + 10, x, y);
  const g = n.addComponent(Graphics);
  const r = h / 2;
  g.fillColor = b.primary ? new Color(20, 120, 40, 128) : new Color(0, 0, 0, 56);
  g.roundRect(-w / 2, -h / 2 - 6, w, h, r);
  g.fill();
  g.roundRect(-w / 2, -h / 2, w, h, r);
  if (b.primary) fillV(g, h / 2, -h / 2, hex('#6BE36B'), hex('#37B84A'));
  else { g.fillColor = hex('#5A5A5A'); g.fill(); }
  g.lineWidth = 3;
  g.strokeColor = b.primary ? hex('#2f9e42') : hex('#D9A227');
  g.roundRect(-w / 2 + 1.5, -h / 2 + 1.5, w - 3, h - 3, r - 1.5);
  g.stroke();
  const st: TextStyle = { font: FONT_SANS, size: 40, color: new Color(255, 255, 255), bold: true };
  mkText(n, b.label, 0, 0, w, st);
  if (b.dim) n.addComponent(UIOpacity).opacity = 128;
  n.on(Node.EventType.TOUCH_START, () => n.setScale(0.97, 0.97));
  n.on(Node.EventType.TOUCH_CANCEL, () => n.setScale(1, 1));
  n.on(Node.EventType.TOUCH_END, () => { n.setScale(1, 1); onTap(); });
}

/** 大号分数：从 0 滚到目标值（web rollNumber，620ms ease-out cubic） */
function roll(l: Label, target: number): void {
  let t = 0;
  onFrame(l.node, (dt) => {
    if (t >= 1) return;
    t = Math.min(1, t + dt / 0.62);
    const k = 1 - Math.pow(1 - t, 3);
    l.string = String(Math.round(target * k));
  });
}

/** 按估算宽度折行（Label 在纯代码运行时不自动换行） */
function wrap(text: string, size: number, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const ch of para) {
      if (line && estW(line + ch, size) > maxW) { out.push(line); line = ''; }
      line += ch;
    }
    out.push(line);
  }
  return out;
}
