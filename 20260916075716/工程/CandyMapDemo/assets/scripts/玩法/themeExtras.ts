/**
 * 主题化辅助视觉（2026-10-25 重做）：连击词 / 首次玩法指引。
 * 棋盘下方的常驻操作提示已并入 themeHud（随 HUD 一起按主题重建，不再单独维护位置）。
 *
 *   连击词：candy 金黄斜体大字 + 橙色投影（原型 A .combo-word）
 *           clean 白胶囊 + 墨色粗体（原型 B）
 *           journal 淡粉胶囊 + 红虚线框 + 手写字、微微歪着（原型 C）
 */

import { Node, Graphics, Color, UIOpacity, Vec3, tween, EventTouch } from 'cc';
import { currentTheme, P_CANDY, P_CLEAN, P_JOURNAL } from './theme';
import { fillV, shadow, dash, mkNode, mkGfx, mkText, screenH, type TextStyle } from './paint';
import { estW } from './themeHud';

/* ================================================================ 连击词 */

let comboNode: Node | null = null;

/** 显示连击词（连锁 ≥2 时调用）。y = 棋盘上部的位置（GameBootstrap 按布局给） */
export function showComboWord(parent: Node, chain: number, y = 300): void {
  const t = currentTheme();
  const words = t.copy.combo;
  const text = words[Math.max(0, Math.min(chain - 2, words.length - 1))]!;

  if (comboNode && comboNode.isValid) comboNode.destroy();
  const n = mkNode(parent, 'ComboWord', 800, 200, 0, y);
  comboNode = n;
  const op = n.addComponent(UIOpacity);

  if (t.id === 'candy') {
    mkText(n, text, 0, 0, 800, {
      font: t.font, size: 120, color: new Color(255, 238, 156), italic: true,
      outline: new Color(179, 84, 30), outlineWidth: 6,
      shadow: { color: new Color(255, 150, 60, 230), blur: 40 },
    });
  } else {
    const st: TextStyle = t.id === 'clean'
      ? { font: t.font, size: 64, color: P_CLEAN.ink, bold: true }
      : { font: t.font, size: 80, color: P_JOURNAL.ink, bold: true };
    const w = Math.round(estW(text, st.size) + 120);
    const h = t.id === 'clean' ? 128 : 136;
    const g = mkGfx(n, 'Pill', w, h);
    if (t.id === 'clean') {
      shadow(g, new Color(34, 48, 63, 46), 50, 0, 22);
      g.fillColor = P_CLEAN.card;
      g.roundRect(-w / 2, -h / 2, w, h, h / 2);
      g.fill();
      shadow(g, null);
    } else {
      g.fillColor = P_JOURNAL.stampSoft;
      g.roundRect(-w / 2, -h / 2, w, h, h / 2);
      g.fill();
      g.lineWidth = 6;
      g.strokeColor = P_JOURNAL.stamp;
      dash(g, [16, 10]);
      g.roundRect(-w / 2, -h / 2, w, h, h / 2);
      g.stroke();
      dash(g, []);
      n.angle = 3;
    }
    mkText(n, text, 0, 0, w, st);
  }

  // 弹入（0.3 → 1.25 → 1）→ 停一下 → 上飘淡出
  n.setScale(0.3, 0.3);
  tween(n)
    .to(0.2, { scale: new Vec3(1.25, 1.25, 1) })
    .to(0.12, { scale: new Vec3(1, 1, 1) })
    .delay(0.35)
    .to(0.3, { position: new Vec3(0, y + 80, 0) })
    .start();
  tween(op).delay(0.67).to(0.3, { opacity: 0 }).call(() => { if (n.isValid) n.destroy(); }).start();
}

/* ================================================================ 首次玩法指引 */

const GUIDE_KEY = 'pinpin.themeGuide';

function guideSeen(): boolean {
  try {
    const wx = (globalThis as { wx?: any }).wx;
    if (wx && typeof wx.getStorageSync === 'function') return wx.getStorageSync(GUIDE_KEY) === '1';
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    return !!ls && ls.getItem(GUIDE_KEY) === '1';
  } catch {
    return false;
  }
}

function markGuideSeen(): void {
  try {
    const wx = (globalThis as { wx?: any }).wx;
    if (wx && typeof wx.setStorageSync === 'function') { wx.setStorageSync(GUIDE_KEY, '1'); return; }
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    if (ls) ls.setItem(GUIDE_KEY, '1');
  } catch { /* 存不上就每次冷启动再看一遍 */ }
}

let guideShownThisRun = false;

/**
 * 首次进关的视觉指引（3 步）：碎片是什么 → 怎么拼 → 拼满了怎样。
 * 只在**首次安装后第一次进关**弹（落盘记住），弹着的时候不开表 —— onDone 才开始。
 */
export function showThemeGuideOnce(parent: Node, onDone: () => void): void {
  if (guideShownThisRun || guideSeen()) { onDone(); return; }
  guideShownThisRun = true;

  const t = currentTheme();
  const H = screenH();
  const overlay = mkNode(parent, 'ThemeGuide', 1080, H);
  const op = overlay.addComponent(UIOpacity);
  const mask = mkGfx(overlay, 'Mask', 1080, H);
  mask.fillColor = t.mask;
  mask.rect(-540, -H / 2, 1080, H);
  mask.fill();
  const block = (e: EventTouch): void => { e.propagationStopped = true; };
  mask.node.on(Node.EventType.TOUCH_START, block);
  mask.node.on(Node.EventType.TOUCH_END, block);

  const W = 860;
  const CH = 1060;
  const card = mkNode(overlay, 'Card', W, CH);
  const g = card.addComponent(Graphics);
  const ink = t.id === 'candy' ? P_CANDY.ink : t.id === 'clean' ? P_CLEAN.ink : P_JOURNAL.ink;
  const soft = t.id === 'candy' ? new Color(150, 110, 60) : t.id === 'clean' ? P_CLEAN.inkSoft : P_JOURNAL.inkSoft;
  const accent = t.id === 'candy' ? P_CANDY.cta : t.id === 'clean' ? P_CLEAN.gold : P_JOURNAL.stamp;
  if (t.id === 'candy') {
    g.fillColor = new Color(0, 0, 0, 64);
    g.roundRect(-W / 2, -CH / 2 - 30, W, CH, 70);
    g.fill();
    g.roundRect(-W / 2, -CH / 2, W, CH, 70);
    fillV(g, CH / 2, -CH / 2, P_CANDY.cardA, P_CANDY.cardB);
    g.lineWidth = 11;
    g.strokeColor = P_CANDY.cardBorder;
    g.roundRect(-W / 2, -CH / 2, W, CH, 70);
    g.stroke();
  } else if (t.id === 'clean') {
    shadow(g, new Color(34, 48, 63, 60), 80, 0, 30);
    g.fillColor = P_CLEAN.card;
    g.roundRect(-W / 2, -CH / 2, W, CH, 70);
    g.fill();
    shadow(g, null);
  } else {
    card.angle = -1;
    shadow(g, new Color(0, 0, 0, 80), 70, 0, 36);
    g.fillColor = P_JOURNAL.sheet;
    g.roundRect(-W / 2, -CH / 2, W, CH, 22);
    g.fill();
    shadow(g, null);
    g.lineWidth = 3;
    g.strokeColor = P_JOURNAL.border;
    g.roundRect(-W / 2, -CH / 2, W, CH, 22);
    g.stroke();
    const tp = mkGfx(card, 'Tape', 240, 58, 0, CH / 2);
    tp.node.angle = -3;
    tp.fillColor = new Color(P_JOURNAL.washiPink.r, P_JOURNAL.washiPink.g, P_JOURNAL.washiPink.b, 225);
    tp.roundRect(-120, -29, 240, 58, 5);
    tp.fill();
  }

  mkText(card, t.copy.guideTitle, 0, CH / 2 - 110, 700, { font: t.font, size: 76, color: accent, bold: t.id !== 'candy' });

  t.copy.guideSteps.forEach(([title, sub], i) => {
    const y = CH / 2 - 270 - i * 190;
    // 序号圆片
    const dot = mkGfx(card, 'No', 100, 100, -W / 2 + 110, y);
    dot.fillColor = accent;
    dot.circle(0, 0, 44);
    dot.fill();
    mkText(dot.node, String(i + 1), 0, 0, 90, { font: t.font, size: 52, color: new Color(255, 255, 255), bold: true });
    mkText(card, title, 70, y + 30, 600, { font: t.font, size: 46, color: ink, bold: t.id !== 'candy', align: 'left' });
    mkText(card, sub, 70, y - 34, 600, { font: t.body, size: 34, color: soft, align: 'left' });
  });

  mkText(card, '★ 达到星线就能通关，三颗星 = 超神', 0, -CH / 2 + 290, 760, { font: t.body, size: 34, color: soft });

  // 按钮
  const bw = 660;
  const bh = 140;
  const btn = mkNode(card, 'Btn', bw, bh + 16, 0, -CH / 2 + 140);
  const bg = btn.addComponent(Graphics);
  const btxt: TextStyle = { font: t.font, size: 50, color: new Color(255, 255, 255), bold: t.id !== 'candy' };
  if (t.id === 'candy') {
    bg.fillColor = P_CANDY.goEdge;
    bg.roundRect(-bw / 2, -bh / 2 - 16, bw, bh, 54);
    bg.fill();
    bg.roundRect(-bw / 2, -bh / 2, bw, bh, 54);
    fillV(bg, bh / 2, -bh / 2, new Color(160, 234, 128), P_CANDY.go);
    btxt.shadow = { color: new Color(0, 0, 0, 72), y: 5 };
  } else if (t.id === 'clean') {
    shadow(bg, new Color(245, 166, 35, 102), 50, 0, 22);
    bg.roundRect(-bw / 2, -bh / 2, bw, bh, 50);
    fillV(bg, bh / 2, -bh / 2, P_CLEAN.goldBtn, P_CLEAN.gold);
    shadow(bg, null);
  } else {
    bg.fillColor = P_JOURNAL.kraftDark;
    bg.roundRect(-bw / 2, -bh / 2 - 11, bw, bh, 28);
    bg.fill();
    bg.fillColor = P_JOURNAL.kraft;
    bg.roundRect(-bw / 2, -bh / 2, bw, bh, 28);
    bg.fill();
    btxt.color = P_JOURNAL.btnText;
  }
  mkText(btn, t.copy.guideBtn, 0, 3, bw, btxt);

  let closed = false;
  btn.on(Node.EventType.TOUCH_END, () => {
    if (closed) return;
    closed = true;
    markGuideSeen();
    tween(op).to(0.2, { opacity: 0 }).call(() => {
      overlay.destroy();
      onDone();
    }).start();
  }, btn);

  op.opacity = 0;
  tween(op).to(0.25, { opacity: 255 }).start();
  card.setScale(0.8, 0.8);
  tween(card).to(0.22, { scale: new Vec3(1.04, 1.04, 1) }).to(0.12, { scale: new Vec3(1, 1, 1) }).start();
}

/** 重置指引（测试用） */
export function resetGuideForTest(): void {
  guideShownThisRun = false;
}
