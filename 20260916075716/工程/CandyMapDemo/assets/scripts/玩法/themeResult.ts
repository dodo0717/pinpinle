/**
 * 主题化结算弹窗（2026-10-24）：通关 / 失败按当前主题画，照抄 design/ 三原型布局。
 *   candy  「糖果嘉年华」—— 奶油卡 + 三星砸落 + 超神斜体大字 + 结算表
 *   clean  「果冻乐园」—— 白底sheet + 弧线三星 + 金徽章 + 结算表
 *   journal「贴纸手账」—— 拍立得白框 + 红章 + 楷体结算
 *
 * 失败/续命共用同一条路径，按主题换文案与配色。
 */

import { Node, UITransform, Layers, Graphics, Label, Color, UIOpacity, Vec3, tween } from 'cc';
import { currentTheme, type GameTheme } from './theme';

/** 结算数据 */
export interface WinInfo {
  stars: number;          // 0~3
  score: number;          // 本局得分
  stickers: number;       // 拼好贴纸数
  totalScore: number;     // 累计总分
  isNewBest: boolean;
}

export interface ThemeResultCallbacks {
  onNext: () => void;
  onBack: () => void;
}

/** 通关弹窗（按主题画） */
export function showThemeWin(parent: Node, info: WinInfo, cb: ThemeResultCallbacks): Node {
  const t = currentTheme();
  const overlay = new Node('ThemeWin');
  overlay.parent = parent;
  overlay.layer = Layers.Enum.UI_2D;
  overlay.addComponent(UITransform).setContentSize(1080, 1920);
  const op = overlay.addComponent(UIOpacity);

  // ---- 遮罩 ----
  const mask = new Node('Mask');
  mask.parent = overlay;
  mask.layer = Layers.Enum.UI_2D;
  mask.addComponent(UITransform).setContentSize(1080, 1920);
  const mg = mask.addComponent(Graphics);
  mg.fillColor = new Color(30, 10, 60, 160);
  mg.rect(-540, -960, 1080, 1920);
  mg.fill();

  // ---- 卡片 ----
  const card = new Node('Card');
  card.parent = overlay;
  card.layer = Layers.Enum.UI_2D;
  card.addComponent(UITransform).setContentSize(560, 720);
  card.setPosition(0, 0);
  const cg = card.addComponent(Graphics);
  drawCard(cg, t, 560, 720);

  const yTop = 260;

  // ---- 三星 ----
  for (let i = 0; i < 3; i++) {
    const star = new Node(`Star${i}`);
    star.parent = card;
    star.layer = Layers.Enum.UI_2D;
    star.addComponent(UITransform).setContentSize(100, 100);
    const x = (i - 1) * 130;
    const y = yTop - (t.id === 'clean' ? Math.abs(i - 1) * 46 : 0);
    star.setPosition(x, y);
    const l = star.addComponent(Label);
    l.fontSize = 84;
    l.lineHeight = 90;
    l.fontFamily = t.fontFamily;
    l.string = '★';
    if (i < info.stars) {
      l.color = new Color(255, 201, 60);
      // 砸落动画
      const delay = 0.18 + i * 0.22;
      star.setPosition(x, y + 320);
      star.setScale(0.3, 0.3);
      tween(star).delay(delay).to(0.32, { position: new Vec3(x, y, 0), scale: new Vec3(1.18, 1.18, 1) })
        .to(0.1, { scale: new Vec3(1, 1, 1) }).start();
    } else {
      l.color = new Color(200, 200, 200, 90);
    }
  }

  // ---- 荣誉头衔 ----
  const honor = new Node('Honor');
  honor.parent = card;
  honor.layer = Layers.Enum.UI_2D;
  honor.addComponent(UITransform).setContentSize(480, 80);
  honor.setPosition(0, yTop - 120);
  const hl = honor.addComponent(Label);
  hl.fontSize = t.copy.honorFontSize;
  hl.lineHeight = t.copy.honorFontSize + 8;
  hl.fontFamily = t.fontFamily;
  hl.color = t.copy.honorColor;
  hl.string = t.copy.honor[Math.max(0, info.stars - 1)] ?? t.copy.honor[0]!;
  if (t.id === 'candy') hl.enableBold = true;
  // 弹入
  honor.setScale(2.2, 2.2);
  tween(honor).delay(0.85).to(0.28, { scale: new Vec3(0.95, 0.95, 1) })
    .to(0.1, { scale: new Vec3(1, 1, 1) }).start();

  // ---- 结算表 ----
  const rows: Array<[string, string]> = [
    [t.copy.winScore, info.score.toLocaleString()],
    [t.copy.winStickers, info.stickers + ' 张'],
    [t.copy.winTotal, info.totalScore.toLocaleString() + (info.isNewBest ? ` (${t.copy.newBest})` : '')],
  ];
  rows.forEach((row, i) => {
    const y = yTop - 220 - i * 56;
    const [k, v] = row;
    const left = new Node('K');
    left.parent = card;
    left.layer = Layers.Enum.UI_2D;
    left.addComponent(UITransform).setContentSize(200, 50);
    left.setPosition(-140, y);
    const kl = left.addComponent(Label);
    kl.fontSize = 26;
    kl.lineHeight = 32;
    kl.fontFamily = t.fontFamily;
    kl.color = new Color(120, 90, 50);
    kl.string = k;
    kl.horizontalAlign = 1; // LEFT=0 CENTER=1 RIGHT=2 → 用字符串也行，这里用枚举值

    const right = new Node('V');
    right.parent = card;
    right.layer = Layers.Enum.UI_2D;
    right.addComponent(UITransform).setContentSize(220, 50);
    right.setPosition(130, y);
    const vl = right.addComponent(Label);
    vl.fontSize = i === 2 ? 34 : 28;
    vl.lineHeight = 36;
    vl.fontFamily = t.fontFamily;
    vl.color = i === 2 ? t.copy.honorColor : new Color(60, 45, 30);
    vl.string = v;
  });

  // 表底色
  const tally = new Node('TallyBg');
  tally.parent = card;
  tally.layer = Layers.Enum.UI_2D;
  tally.addComponent(UITransform).setContentSize(480, 180);
  tally.setPosition(0, yTop - 220 - 56);
  const tg = tally.addComponent(Graphics);
  tg.fillColor = t.copy.tallyBg;
  tg.roundRect(-240, -90, 480, 180, 18);
  tg.fill();
  card.setSiblingIndex(card.getSiblingIndex() - 1); // tally 在文字后面 → 把 tally 移到 card 的子级最前面（最先画）
  // 实际上 setSiblingIndex 只影响同级 z 序。把 tally 提到 card 子级的最底（最先画 = 被后面文字盖住）：
  tally.setSiblingIndex(0);
  // 星星和 honor 也要在 tally 上面 → 把它们移到最后
  for (let i = 0; i < 3; i++) card.getChildByName(`Star${i}`)?.setSiblingIndex(card.children.length - 1);
  honor.setSiblingIndex(card.children.length - 1);

  // ---- 按钮 ----
  mkBtn(card, t, t.copy.nextLevel, 0, -260, 420, 92, true, () => {
    overlay.destroy();
    cb.onNext();
  });
  mkBtn(card, t, t.copy.backToMap, 0, -360, 420, 72, false, () => {
    overlay.destroy();
    cb.onBack();
  });

  // 淡入
  op.opacity = 0;
  tween(op).to(0.25, { opacity: 255 }).start();
  return overlay;
}

/** 失败 / 续命弹窗 */
export function showThemeFail(
  parent: Node,
  needScore: number,
  onRevive: () => void,
  onGiveUp: () => void,
): Node {
  const t = currentTheme();
  const overlay = new Node('ThemeFail');
  overlay.parent = parent;
  overlay.layer = Layers.Enum.UI_2D;
  overlay.addComponent(UITransform).setContentSize(1080, 1920);
  const op = overlay.addComponent(UIOpacity);

  const mask = new Node('Mask');
  mask.parent = overlay;
  mask.layer = Layers.Enum.UI_2D;
  mask.addComponent(UITransform).setContentSize(1080, 1920);
  const mg = mask.addComponent(Graphics);
  mg.fillColor = new Color(30, 10, 60, 160);
  mg.rect(-540, -960, 1080, 1920);
  mg.fill();

  const card = new Node('Card');
  card.parent = overlay;
  card.layer = Layers.Enum.UI_2D;
  card.addComponent(UITransform).setContentSize(500, 580);
  card.setPosition(0, 0);
  const cg = card.addComponent(Graphics);
  drawCard(cg, t, 500, 580);

  // ---- 标题 ----
  const title = new Node('Title');
  title.parent = card;
  title.layer = Layers.Enum.UI_2D;
  title.addComponent(UITransform).setContentSize(420, 70);
  title.setPosition(0, 200);
  const tl = title.addComponent(Label);
  tl.fontSize = 42;
  tl.lineHeight = 48;
  tl.fontFamily = t.fontFamily;
  tl.color = t.copy.honorColor;
  tl.string = t.copy.failTitle;

  // ---- 副标题 ----
  const sub = new Node('Sub');
  sub.parent = card;
  sub.layer = Layers.Enum.UI_2D;
  sub.addComponent(UITransform).setContentSize(420, 50);
  sub.setPosition(0, 130);
  const sl = sub.addComponent(Label);
  sl.fontSize = 24;
  sl.lineHeight = 30;
  sl.fontFamily = t.fontFamily;
  sl.color = new Color(120, 90, 50);
  sl.string = t.copy.failSub(needScore);

  // ---- 续命按钮（大） ----
  mkBtn(card, t, t.copy.reviveBtn, 0, 10, 420, 92, true, () => {
    overlay.destroy();
    onRevive();
  });

  // ---- 广告标签 ----
  const ad = new Node('Ad');
  ad.parent = card;
  ad.layer = Layers.Enum.UI_2D;
  ad.addComponent(UITransform).setContentSize(380, 36);
  ad.setPosition(0, -56);
  const al = ad.addComponent(Label);
  al.fontSize = 20;
  al.lineHeight = 26;
  al.fontFamily = t.fontFamily;
  al.color = new Color(160, 120, 50);
  al.string = t.copy.reviveAd;

  // ---- 放弃按钮 ----
  mkBtn(card, t, t.copy.giveUp, 0, -140, 420, 72, false, () => {
    overlay.destroy();
    onGiveUp();
  });

  op.opacity = 0;
  tween(op).to(0.25, { opacity: 255 }).start();
  return overlay;
}

/* ---------------------------------------------------------------- 内部 */

/** 画主题卡片底板 */
function drawCard(g: Graphics, t: GameTheme, w: number, h: number): void {
  // 投影
  g.fillColor = new Color(0, 0, 0, 50);
  g.roundRect(-w / 2, -h / 2 - 10, w, h, 30);
  g.fill();
  // 主体
  g.fillColor = t.copy.cardBg;
  g.roundRect(-w / 2, -h / 2, w, h, 28);
  g.fill();
  // 边框
  g.lineWidth = t.id === 'candy' ? 5 : 2;
  g.strokeColor = t.copy.cardBorder;
  g.roundRect(-w / 2, -h / 2, w, h, 28);
  g.stroke();
  // journal：拍立得内框
  if (t.id === 'journal') {
    g.lineWidth = 2;
    g.strokeColor = new Color(203, 185, 153, 120);
    g.roundRect(-w / 2 + 14, -h / 2 + 14, w - 28, h - 28, 18);
    g.stroke();
  }
}

/** 画按钮 */
function mkBtn(
  parent: Node, t: GameTheme, text: string,
  x: number, y: number, w: number, h: number,
  primary: boolean, onTap: () => void,
): Node {
  const n = new Node('Btn');
  n.parent = parent;
  n.layer = Layers.Enum.UI_2D;
  n.addComponent(UITransform).setContentSize(w, h);
  n.setPosition(x, y);
  const g = n.addComponent(Graphics);
  const fill = primary ? t.copy.primaryFill : t.copy.secondaryFill;
  const edge = primary ? t.copy.primaryEdge : new Color(fill.r - 30, fill.g - 30, fill.b - 30);
  // 底边（按压立体感）
  g.fillColor = edge;
  g.roundRect(-w / 2, -h / 2, w, h, h / 2);
  g.fill();
  // 面板
  g.fillColor = fill;
  g.roundRect(-w / 2, -h / 2 + 6, w, h - 6, h / 2);
  g.fill();
  // 文字
  const l = new Node('Txt');
  l.parent = n;
  l.layer = Layers.Enum.UI_2D;
  l.addComponent(UITransform).setContentSize(w - 20, h);
  l.setPosition(0, 3);
  const label = l.addComponent(Label);
  label.fontSize = primary ? 32 : 26;
  label.lineHeight = primary ? 38 : 32;
  label.fontFamily = t.fontFamily;
  label.color = primary ? new Color(255, 255, 255) : new Color(120, 90, 50);
  label.string = text;
  if (primary && t.textShadow) label.enableBold = true;

  n.on(Node.EventType.TOUCH_END, () => { onTap(); }, n);
  return n;
}
