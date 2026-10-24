/**
 * 主题化辅助视觉（2026-10-25）：连击词 / 棋盘操作提示 / 首次玩法指引。
 * 全部挂在 GameBootstrap.node 下，按当前主题配色与字体。
 */

import { Node, UITransform, Layers, Graphics, Label, Color, UIOpacity, Vec3, tween } from '../../runtime/cc.js';
import { currentTheme,                } from './theme.js';

/* ================================================================ 连击词 */

let comboNode              = null;
let comboLabel               = null;
let comboOp                   = null;
let comboTimer                                       = null;

/** 显示连击词（连锁 ≥2 时调用）——按主题配色/字体，大字弹入后淡出 */
export function showComboWord(parent      , chain        )       {
  const t = currentTheme();
  const words = t.copy.combo;
  const idx = Math.min(chain - 2, words.length - 1);
  const text = words[Math.max(0, idx)] ?? words[words.length - 1] ;

  if (!comboNode || !comboNode.isValid || comboNode.parent !== parent) {
    if (comboNode && comboNode.isValid) comboNode.destroy();
    comboNode = new Node('ComboWord');
    comboNode.parent = parent;
    comboNode.layer = Layers.Enum.UI_2D;
    comboNode.addComponent(UITransform).setContentSize(600, 100);
    comboNode.setPosition(0, 80);
    comboOp = comboNode.addComponent(UIOpacity);
    comboLabel = comboNode.addComponent(Label);
    comboLabel.fontSize = 44;
    comboLabel.lineHeight = 52;
    comboLabel.horizontalAlign = 1; // CENTER
  }

  const t2 = t;
  comboLabel .fontFamily = t2.fontFamily;
  comboLabel .color = t2.id === 'candy'
    ? new Color(255, 238, 156)
    : t2.id === 'clean'
      ? new Color(34, 48, 63)
      : new Color(214, 69, 69);
  if (t2.textShadow) comboLabel .enableBold = true;
  comboLabel .string = text;

  comboNode.setPosition(0, 80);
  comboNode.setScale(0.3, 0.3);
  comboOp .opacity = 255;

  tween(comboNode )
    .to(0.22, { scale: new Vec3(1.22, 1.22, 1), position: new Vec3(0, 100, 0) })
    .to(0.1, { scale: new Vec3(1, 1, 1) })
    .delay(0.5)
    .to(0.25, { position: new Vec3(0, 130, 0) })
    .call(() => { if (comboOp) comboOp.opacity = 0; })
    .start();

  if (comboTimer) clearTimeout(comboTimer);
  comboTimer = setTimeout(() => {
    if (comboOp) comboOp.opacity = 0;
    comboTimer = null;
  }, 1100);
}

/* ================================================================ 棋盘操作提示 */

let hintNode              = null;
let hintLabel               = null;

/** 棋盘下方的常驻操作提示（按主题字体/颜色） */
export function ensureBoardHint(parent      )       {
  const t = currentTheme();
  if (hintNode && hintNode.isValid && hintNode.parent === parent) {
    hintLabel .fontFamily = t.fontFamily;
    hintLabel .string = t.copy.boardHint;
    return;
  }
  if (hintNode && hintNode.isValid) hintNode.destroy();
  hintNode = new Node('BoardHint');
  hintNode.parent = parent;
  hintNode.layer = Layers.Enum.UI_2D;
  hintNode.addComponent(UITransform).setContentSize(800, 44);
  hintNode.setPosition(0, -700);
  hintLabel = hintNode.addComponent(Label);
  hintLabel.fontSize = 24;
  hintLabel.lineHeight = 30;
  hintLabel.horizontalAlign = 1; // CENTER
  hintLabel.string = t.copy.boardHint;
}

/* ================================================================ 首次玩法指引 */

let guideShown = false;

/**
 * 首次进关的视觉指引（3 步）：碎片是什么 → 怎么拼 → 拼满了怎样。
 * 半透明遮罩 + 主题化卡片 + 「知道了」按钮。第二次进关不再弹。
 */
export function showThemeGuideOnce(parent      , onDone            )       {
  if (guideShown) { onDone(); return; }
  guideShown = true;

  const t = currentTheme();
  const overlay = new Node('ThemeGuide');
  overlay.parent = parent;
  overlay.layer = Layers.Enum.UI_2D;
  overlay.addComponent(UITransform).setContentSize(1080, 1920);
  const op = overlay.addComponent(UIOpacity);

  // 遮罩
  const mask = new Node('Mask');
  mask.parent = overlay;
  mask.layer = Layers.Enum.UI_2D;
  mask.addComponent(UITransform).setContentSize(1080, 1920);
  const mg = mask.addComponent(Graphics);
  mg.fillColor = new Color(20, 10, 40, 200);
  mg.rect(-540, -960, 1080, 1920);
  mg.fill();

  // 卡片
  const card = new Node('Card');
  card.parent = overlay;
  card.layer = Layers.Enum.UI_2D;
  card.addComponent(UITransform).setContentSize(580, 760);
  const cg = card.addComponent(Graphics);
  cg.fillColor = t.copy.cardBg;
  cg.roundRect(-290, -380, 580, 760, 28);
  cg.fill();
  cg.lineWidth = t.id === 'candy' ? 5 : 2;
  cg.strokeColor = t.copy.cardBorder;
  cg.roundRect(-290, -380, 580, 760, 28);
  cg.stroke();

  // 标题
  const title = mkLabel(card, '怎么玩', 40, t.copy.honorColor, 0, 300, 480, t);

  // 三步说明
  const steps                          = [
    ['🧩', '每块碎片是贴纸的四分之一\n（左上 / 右上 / 左下 / 右下）'],
    ['👆', '拖动碎片换位置\n同图相邻 + 位置正确 = 融合'],
    ['✨', '四块拼成完整 2×2 贴纸\n→ 消除得分 + 连锁加分！'],
  ];
  steps.forEach(([icon, text], i) => {
    const y = 160 - i * 160;
    // 图标
    const ic = mkLabel(card, icon, 44, new Color(60, 45, 30), -200, y, 80, t);
    // 文字
    const tx = mkLabel(card, text, 26, new Color(80, 60, 40), 40, y, 360, t);
    tx.horizontalAlign = 0; // LEFT
  });

  // 星线说明
  const starLine = mkLabel(card, `★ 达到星线就能通关（${'★'.repeat(3)} = 超神！）`, 22, new Color(200, 130, 20), 0, -160, 480, t);

  // 按钮
  const btn = new Node('Btn');
  btn.parent = card;
  btn.layer = Layers.Enum.UI_2D;
  btn.addComponent(UITransform).setContentSize(380, 88);
  btn.setPosition(0, -290);
  const bg = btn.addComponent(Graphics);
  bg.fillColor = t.copy.primaryFill;
  bg.roundRect(-190, -44, 380, 88, 44);
  bg.fill();
  bg.fillColor = t.copy.primaryEdge;
  bg.roundRect(-190, -44, 380, 82, 44);
  bg.fill();
  bg.fillColor = t.copy.primaryFill;
  bg.roundRect(-190, -38, 380, 76, 38);
  bg.fill();
  const bl = mkLabel(btn, '知道了，开玩！', 30, new Color(255, 255, 255), 0, 0, 360, t);
  if (t.textShadow) bl.enableBold = true;

  btn.on(Node.EventType.TOUCH_END, () => {
    tween(op).to(0.2, { opacity: 0 }).call(() => {
      overlay.destroy();
      onDone();
    }).start();
  }, btn);

  op.opacity = 0;
  tween(op).to(0.3, { opacity: 255 }).start();
}

/** 重置指引（测试用） */
export function resetGuideForTest()       {
  guideShown = false;
}

/* ---------------------------------------------------------------- 工具 */

function mkLabel(parent      , text        , size        , color       , x        , y        , w        , t           )        {
  const n = new Node('L');
  n.parent = parent;
  n.layer = Layers.Enum.UI_2D;
  n.addComponent(UITransform).setContentSize(w, size + 10);
  n.setPosition(x, y);
  const l = n.addComponent(Label);
  l.fontSize = size;
  l.lineHeight = size + 8;
  l.color = color;
  l.fontFamily = t.fontFamily;
  l.string = text;
  l.horizontalAlign = 1; // CENTER
  return l;
}
