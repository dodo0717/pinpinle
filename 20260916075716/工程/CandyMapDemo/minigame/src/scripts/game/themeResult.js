/**
 * 主题化结算弹窗（2026-10-25 重做）：三套各自照搬 design/ 原型的版式，不再共用一张卡片。
 *
 *   candy  （原型 A）奶油圆角卡 + 金光爆发 + 三星逐颗砸落 + 斜体大字头衔 + 结算表 + 彩带雨（3★）
 *          失败：摇摆闹钟 + 金色续命大圆钮（外圈 10 秒倒计时环）
 *   clean  （原型 B）底部 sheet 升起 + 虚线弧上三颗星 + 金线描弧 + 头衔徽章 + 结算表
 *          失败：sheet + 续命行（倒计时环 + 说明 + 免费广告标）+ 薄荷绿按钮
 *   journal（原型 C）歪贴的拍立得 + 和纸胶带 + 红色印章盖下 + 手写结算
 *          失败：歪贴的手账页 + 虚线续命卡
 *
 * 续命倒计时 10 秒，走完视同放弃（原型同款，制造「再拼一下」的紧迫感）。
 * 续命用掉之后再失败 → `canRevive=false`：不再出现续命入口，换成「再来一局 / 回地图」。
 */

import { Node, Graphics, Label, Color, Vec3, tween, UIOpacity, EventTouch } from '../../runtime/cc.js';
import { currentTheme, P_CANDY, P_CLEAN, P_JOURNAL,                } from './theme.js';
import {
  alpha, fillV, fillLinear, fillRadial, shadow, dash, starPath, playPath,
  mkNode, mkGfx, mkText, onFrame, screenH,                
} from './paint.js';
import { fmtNum, estW } from './themeHud.js';

                          
                
                
                          
                   
                     
                     
                
                    
 

                                       
                     
                     
 

                           
                     
               
                                        
                     
                    
 

                                
                       
                       
                      
 

const REVIVE_WAIT = 10;

/* ================================================================ 入口 */

export function showThemeWin(parent      , info         , cb                      )       {
  const t = currentTheme();
  if (t.id === 'clean') return winClean(parent, t, info, cb);
  if (t.id === 'journal') return winJournal(parent, t, info, cb);
  return winCandy(parent, t, info, cb);
}

export function showThemeFail(parent      , info          , cb               )       {
  const t = currentTheme();
  if (t.id === 'clean') return failClean(parent, t, info, cb);
  if (t.id === 'journal') return failJournal(parent, t, info, cb);
  return failCandy(parent, t, info, cb);
}

/* ================================================================ 公共 */

                                                                   

function overlay(parent      , t           , name        )          {
  const H = screenH();
  const root = mkNode(parent, name, 1080, H);
  const op = root.addComponent(UIOpacity);
  const mask = mkGfx(root, 'Mask', 1080, H);
  mask.fillColor = t.mask;
  mask.rect(-540, -H / 2, 1080, H);
  mask.fill();
  // 吞掉遮罩上的触摸：不然点空白处会穿透到下面的棋盘
  const block = (e            )       => { e.propagationStopped = true; };
  mask.node.on(Node.EventType.TOUCH_START, block);
  mask.node.on(Node.EventType.TOUCH_END, block);
  op.opacity = 0;
  tween(op).to(0.22, { opacity: 255 }).start();
  let closing = false;
  return {
    root,
    close: (then) => {
      if (closing) return;
      closing = true;
      tween(op).to(0.15, { opacity: 0 }).call(() => { root.destroy(); then(); }).start();
    },
  };
}

                                           

/** 主题按钮（按下缩一下，松手触发） */
function button(parent      , t           , kind         , text        , x        , y        , w        , h        , onTap            )       {
  const n = mkNode(parent, 'Btn', w, h + 16, x, y);
  const g = n.addComponent(Graphics);
  const st            = { font: t.font, size: Math.round(h * 0.34), color: new Color(255, 255, 255), bold: t.id !== 'candy' };
  let ty = 0;
  if (t.id === 'candy') {
    const P = P_CANDY;
    const [face, edge, top] = kind === 'primary'
      ? [P.go, P.goEdge, new Color(160, 234, 128)]
      : kind === 'alt' ? [P.cta, P.ctaEdge, new Color(255, 140, 120)] : [P.ghost, P.ghostEdge, new Color(206, 199, 220)];
    const r = Math.min(54, h / 2);
    g.fillColor = edge;
    g.roundRect(-w / 2, -h / 2 - 16, w, h, r);
    g.fill();
    g.roundRect(-w / 2, -h / 2, w, h, r);
    fillV(g, h / 2, -h / 2, top, face);
    g.fillColor = new Color(255, 255, 255, 102);
    g.roundRect(-w / 2 + 30, h / 2 - 16, w - 60, 8, 4);
    g.fill();
    st.shadow = { color: new Color(0, 0, 0, 72), y: 5 };
    if (kind === 'ghost') st.size = Math.round(h * 0.3);
    ty = 3;
  } else if (t.id === 'clean') {
    const P = P_CLEAN;
    if (kind === 'ghost') {
      st.color = P.inkSoft;
      st.size = Math.round(h * 0.32);
      st.bold = true;
    } else {
      const [a, b, glow] = kind === 'primary'
        ? [P.goldBtn, P.gold, new Color(245, 166, 35, 102)]
        : [new Color(82, 214, 170), P.mint, new Color(47, 191, 143, 90)];
      shadow(g, glow, 50, 0, 22);
      g.roundRect(-w / 2, -h / 2, w, h, 50);
      fillV(g, h / 2, -h / 2, a, b);
      shadow(g, null);
    }
  } else {
    const P = P_JOURNAL;
    if (kind === 'ghost') {
      g.fillColor = P.sheet;
      g.roundRect(-w / 2, -h / 2, w, h, 28);
      g.fill();
      g.lineWidth = 4;
      g.strokeColor = P.rail;
      dash(g, [14, 10]);
      g.roundRect(-w / 2, -h / 2, w, h, 28);
      g.stroke();
      dash(g, []);
      st.color = P.inkSoft;
      st.size = Math.round(h * 0.3);
    } else {
      g.fillColor = P.kraftDark;
      g.roundRect(-w / 2, -h / 2 - 11, w, h, 28);
      g.fill();
      g.fillColor = kind === 'alt' ? P.stamp : P.kraft;
      g.roundRect(-w / 2, -h / 2, w, h, 28);
      g.fill();
      st.color = P.btnText;
    }
  }
  mkText(n, text, 0, ty, w - 24, st);
  let fired = false;
  n.on(Node.EventType.TOUCH_START, () => n.setScale(0.95, 0.95));
  n.on(Node.EventType.TOUCH_CANCEL, () => n.setScale(1, 1));
  n.on(Node.EventType.TOUCH_END, () => {
    n.setScale(1, 1);
    if (fired) return;
    fired = true;
    onTap();
  });
  return n;
}

/** 弹入：缩小 → 略过冲 → 归位 */
function popIn(n      , delay = 0, from = 0.7)       {
  n.setScale(from, from);
  tween(n).delay(delay).to(0.2, { scale: new Vec3(1.05, 1.05, 1) }).to(0.12, { scale: new Vec3(1, 1, 1) }).start();
}

/** 结算表（三主题通用骨架，样式按主题） */
function tally(parent      , t           , info         , y        , w        )       {
  const h = 290;
  const g = mkGfx(parent, 'Tally', w, h, 0, y);
  const candy = t.id === 'candy';
  g.fillColor = candy ? P_CANDY.tally : P_CLEAN.tally;
  g.roundRect(-w / 2, -h / 2, w, h, 44);
  g.fill();
  if (candy) {
    // 内凹阴影感：上沿一道暗边
    g.fillColor = new Color(160, 110, 30, 40);
    g.roundRect(-w / 2 + 4, h / 2 - 14, w - 8, 10, 5);
    g.fill();
  }
  const ink = candy ? P_CANDY.ink : P_CLEAN.ink;
  const soft = candy ? P_CANDY.ink : P_CLEAN.inkSoft;
  const row = (k        , v        , yy        , st                    )       => {
    mkText(g.node, k, -w / 2 + 40 + 150, yy, 300, { font: t.font, size: 38, color: soft, align: 'left', bold: !candy, ...st });
    mkText(g.node, v, w / 2 - 40 - 170, yy, 340, { font: t.font, size: 40, color: ink, align: 'right', bold: !candy, ...st });
  };
  row(t.copy.winScore, fmtNum(info.score), 95, {});
  row(t.copy.winStickers, `${info.stickers} 张`, 30, {});
  // 分隔线
  g.lineWidth = 5;
  g.strokeColor = candy ? P_CANDY.dash : P_CLEAN.line;
  if (candy) dash(g, [14, 10]);
  g.moveTo(-w / 2 + 34, -18);
  g.lineTo(w / 2 - 34, -18);
  g.stroke();
  dash(g, []);
  const totalColor = candy ? P_CANDY.total : P_CLEAN.gold;
  const totalText = fmtNum(info.totalScore);
  const badgeW = info.isNewBest ? 150 : 0;
  mkText(g.node, t.copy.winTotal, -w / 2 + 40 + 150, -80, 300, { font: t.font, size: 46, color: candy ? P_CANDY.total : P_CLEAN.ink, align: 'left', bold: !candy });
  mkText(g.node, totalText, w / 2 - 40 - badgeW - 160, -80, 320, { font: t.font, size: 54, color: totalColor, align: 'right', bold: !candy });
  if (info.isNewBest) {
    const bw = 136;
    const bg = mkGfx(g.node, 'Best', bw, 56, w / 2 - 40 - bw / 2, -80);
    if (candy) {
      bg.fillColor = P_CANDY.goldDark;
      bg.roundRect(-bw / 2, -34, bw, 56, 28);
      bg.fill();
      bg.fillColor = P_CANDY.gold;
    } else {
      bg.fillColor = P_CLEAN.mint;
    }
    bg.roundRect(-bw / 2, -28, bw, 56, 28);
    bg.fill();
    mkText(bg.node, t.copy.newBest, 0, 0, bw, { font: t.font, size: 30, color: new Color(255, 255, 255), bold: !candy });
    popIn(bg.node, 1.5, 0.2);
  }
}

/** 倒计时环（续命用）：每帧重画，走完回调一次 */
function countdownRing(n      , r        , width        , color       , bg       , bgDash                 , label              , onDone            )       {
  const base = mkGfx(n, 'RingBg', r * 2 + width, r * 2 + width);
  base.lineWidth = width;
  base.strokeColor = bg;
  if (bgDash) dash(base, bgDash);
  base.circle(0, 0, r);
  base.stroke();
  const fg = mkGfx(n, 'RingFg', r * 2 + width, r * 2 + width);
  let elapsed = 0;
  let done = false;
  onFrame(n, (dt) => {
    if (done) return;
    elapsed += dt;
    const k = Math.max(0, 1 - elapsed / REVIVE_WAIT);
    fg.clear();
    if (k > 0.002) {
      fg.lineWidth = width;
      fg.strokeColor = color;
      fg.moveTo(0, r);
      fg.arc(0, 0, r, Math.PI / 2, Math.PI / 2 - Math.PI * 2 * k, true);
      fg.stroke();
    }
    if (label) label.string = String(Math.ceil(REVIVE_WAIT - elapsed));
    if (k <= 0) { done = true; onDone(); }
  });
}

/* ================================================================ 糖果嘉年华 */

function winCandy(parent      , t           , info         , cb                      )       {
  const P = P_CANDY;
  const ov = overlay(parent, t, 'ThemeWin');
  const W = 860;
  const H = 1080;
  const cy = 40;

  // 金光爆发（卡片后面）
  goldBurst(ov.root, cy + 400, P.gold, 0.8);

  // 卡片
  const card = mkNode(ov.root, 'Card', W, H, 0, cy);
  const g = card.addComponent(Graphics);
  shadow(g, new Color(0, 0, 0, 102), 70, 0, 50);
  g.fillColor = new Color(0, 0, 0, 64);
  g.roundRect(-W / 2, -H / 2 - 36, W, H, 72);
  g.fill();
  shadow(g, null);
  g.roundRect(-W / 2, -H / 2, W, H, 72);
  fillV(g, H / 2, -H / 2, P.cardA, P.cardB);
  g.lineWidth = 11;
  g.strokeColor = P.cardBorder;
  g.roundRect(-W / 2, -H / 2, W, H, 72);
  g.stroke();
  popIn(card);

  // 三星砸落
  for (let i = 0; i < 3; i++) {
    const on = i < info.stars;
    const x = (i - 1) * 200;
    const y = 390 + (i === 1 ? 26 : 0);
    const sn = mkNode(card, `Star${i}`, 200, 200, x, y);
    const sg = sn.addComponent(Graphics);
    const R = i === 1 ? 92 : 80;
    if (on) {
      shadow(sg, new Color(160, 100, 0, 90), 0, 0, 11);
      starPath(sg, 0, 0, R, 0.5);
      fillV(sg, R, -R, P.goldLight, P.gold);
      shadow(sg, null);
      sg.lineWidth = 7;
      sg.strokeColor = P.goldDark;
      starPath(sg, 0, 0, R, 0.5);
      sg.stroke();
      sg.fillColor = new Color(255, 255, 255, 130);
      sg.ellipse(-R * 0.22, R * 0.28, R * 0.16, R * 0.1);
      sg.fill();
      const op = sn.addComponent(UIOpacity);
      op.opacity = 0;
      sn.setPosition(x, y + 320);
      sn.setScale(0.4, 0.4);
      const d = 0.25 + i * 0.22;
      tween(op).delay(d).to(0.1, { opacity: 255 }).start();
      tween(sn).delay(d)
        .to(0.3, { position: new Vec3(x, y - 16, 0), scale: new Vec3(1.3, 1.3, 1), angle: 6 })
        .to(0.1, { position: new Vec3(x, y + 16, 0), scale: new Vec3(0.96, 0.96, 1), angle: 0 })
        .to(0.1, { position: new Vec3(x, y, 0), scale: new Vec3(1, 1, 1) })
        .start();
    } else {
      starPath(sg, 0, 0, R, 0.5);
      sg.fillColor = new Color(190, 172, 150, 90);
      sg.fill();
    }
  }

  // 荣誉头衔（斜体大字从 2.4 倍砸进来）
  const honor = mkText(card, t.copy.honor[Math.max(0, 3 - info.stars)] ?? t.copy.honor[2], 0, 230, 760, {
    font: t.font, size: 116, color: P.cta, italic: true, shadow: { color: new Color(255, 217, 176), y: 9 },
  });
  const hop = honor.node.addComponent(UIOpacity);
  hop.opacity = 0;
  honor.node.setScale(2.4, 2.4);
  honor.node.angle = 6;
  tween(hop).delay(0.75).to(0.15, { opacity: 255 }).start();
  tween(honor.node).delay(0.75)
    .to(0.28, { scale: new Vec3(0.94, 0.94, 1), angle: -2 })
    .to(0.16, { scale: new Vec3(1, 1, 1), angle: 0 })
    .start();

  tally(card, t, info, 10, 740);

  button(card, t, 'primary', t.copy.nextLevel, 0, -290, 740, 150, () => ov.close(cb.onNext));
  button(card, t, 'ghost', t.copy.backToMap, 0, -450, 740, 116, () => ov.close(cb.onBack));

  if (info.stars >= 3) confetti(ov.root);
  return ov.root;
}

/**
 * 金光爆发：12 道光芒从中心放大淡出（原只在糖果主题，2026-10-27 评审 P2-1 抽出来三套共用）。
 * `delay` 对齐各主题星星落下的时刻。
 */
function goldBurst(parent      , y        , color       , delay        )       {
  const burst = mkGfx(parent, 'Burst', 700, 700, 0, y);
  burst.fillColor = alpha(color, 230);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const L = i % 2 ? 260 : 340;
    burst.moveTo(Math.cos(a - 0.09) * 60, Math.sin(a - 0.09) * 60);
    burst.lineTo(Math.cos(a) * L, Math.sin(a) * L);
    burst.lineTo(Math.cos(a + 0.09) * 60, Math.sin(a + 0.09) * 60);
    burst.close();
    burst.fill();
  }
  const bop = burst.node.addComponent(UIOpacity);
  bop.opacity = 0;
  burst.node.setScale(0.3, 0.3);
  tween(bop).delay(delay).to(0.05, { opacity: 255 }).to(0.75, { opacity: 0 }).start();
  tween(burst.node).delay(delay).to(0.8, { scale: new Vec3(1.6, 1.6, 1), angle: 28 }).start();
}

/**
 * 低端机减半彩带（评审 P2-1）：微信 benchmarkLevel 1~50，越小越差；拿不到按中端处理。
 * -1 / 0 是「无法判断」，也按中端。
 */
function confettiCount()         {
  try {
    const wx = (globalThis                ).wx;
    const info = wx?.getSystemInfoSync?.();
    const lv = Number(info?.benchmarkLevel);
    if (Number.isFinite(lv) && lv > 0 && lv < 15) return 30;
  } catch { /* 拿不到按默认 */ }
  return 60;
}

function confetti(parent      , palette          )       {
  const H = screenH();
  const cols = palette ?? [P_CANDY.gold, P_CANDY.candy, P_CANDY.go, new Color(110, 200, 255), new Color(255, 255, 255), new Color(190, 140, 255)];
  const count = confettiCount();
  for (let i = 0; i < count; i++) {
    const w = 22 + Math.random() * 14;
    const h = 34 + Math.random() * 16;
    const x = -520 + Math.random() * 1040;
    const g = mkGfx(parent, 'Confetti', w, h, x, H / 2 + 40);
    g.fillColor = cols[i % cols.length] ;
    g.rect(-w / 2, -h / 2, w, h);
    g.fill();
    g.node.angle = Math.random() * 180;
    const dur = 1.8 + Math.random() * 1.6;
    tween(g.node)
      .delay(0.5 + Math.random() * 0.9)
      .to(dur, { position: new Vec3(x + (Math.random() - 0.5) * 240, -H / 2 - 60, 0), angle: g.node.angle + 680 })
      .call(() => g.node.destroy())
      .start();
  }
}

function failCandy(parent      , t           , info          , cb               )       {
  const P = P_CANDY;
  const ov = overlay(parent, t, 'ThemeFail');
  const W = 820;
  const H = info.canRevive ? 1040 : 760;
  const card = mkNode(ov.root, 'Card', W, H, 0, 30);
  const g = card.addComponent(Graphics);
  shadow(g, new Color(0, 0, 0, 102), 70, 0, 50);
  g.fillColor = new Color(0, 0, 0, 64);
  g.roundRect(-W / 2, -H / 2 - 36, W, H, 72);
  g.fill();
  shadow(g, null);
  g.roundRect(-W / 2, -H / 2, W, H, 72);
  fillV(g, H / 2, -H / 2, P.cardA, P.cardB);
  g.lineWidth = 11;
  g.strokeColor = P.failBorder;
  g.roundRect(-W / 2, -H / 2, W, H, 72);
  g.stroke();
  popIn(card);

  const top = H / 2;
  const face = mkText(card, '⏰', 0, top - 130, 220, { font: t.font, size: 150, color: new Color(255, 255, 255) });
  let clock = 0;
  onFrame(face.node, (dt) => { clock += dt; face.node.angle = Math.sin(clock * Math.PI * 2 / 1.2) * 6; });
  mkText(card, t.copy.failTitle, 0, top - 270, 740, { font: t.font, size: 76, color: P.ink });
  mkText(card, info.canRevive ? t.copy.failSub(info.need) : t.copy.failFinalSub, 0, top - 350, 740, { font: t.font, size: 36, color: P.ink });

  if (info.canRevive) {
    const giveUp = ()       => ov.close(cb.onGiveUp);
    const ring = mkNode(card, 'Revive', 420, 420, 0, -40);
    countdownRing(ring, 182, 22, P.gold, new Color(0, 0, 0, 30), null, null, giveUp);
    const core = mkNode(ring, 'Core', 260, 260);
    const cg = core.addComponent(Graphics);
    cg.fillColor = P.goldDark;
    cg.circle(0, -16, 128);
    cg.fill();
    cg.circle(0, 0, 128);
    fillRadial(cg, 0, 0, 128, [[0, P.goldLight], [1, P.gold]], 0, 40);
    shadow(cg, new Color(180, 100, 0, 90), 0, 0, 5);
    playPath(cg, 8, 0, 92);
    cg.fillColor = new Color(255, 255, 255);
    cg.fill();
    shadow(cg, null);
    mkText(ring, t.copy.reviveTitle(info.reviveSec), 0, -230, 400, { font: t.font, size: 34, color: P.total });
    let clk = 0;
    onFrame(core, (dt) => { clk += dt; const k = 1 + 0.06 * (0.5 + 0.5 * Math.sin(clk * Math.PI / 0.9)); core.setScale(k, k); });
    let fired = false;
    core.on(Node.EventType.TOUCH_END, () => { if (!fired) { fired = true; ov.close(cb.onRevive); } });
    mkText(card, t.copy.reviveAd(info.reviveSec), 0, -330, 740, { font: t.font, size: 32, color: P.adNote });
    button(card, t, 'ghost', t.copy.giveUp, 0, -440, 740, 116, giveUp);
  } else {
    button(card, t, 'primary', t.copy.retry, 0, -100, 740, 150, () => ov.close(cb.onRetry));
    button(card, t, 'ghost', t.copy.backToMap, 0, -270, 740, 116, () => ov.close(cb.onGiveUp));
  }
  return ov.root;
}

/* ================================================================ 果冻乐园 */

/** 底部 sheet：圆角顶 + 抓手条 + 从屏幕下沿弹起 */
function sheet(ov         , h        )                              {
  const SH = screenH();
  const y = -SH / 2 + h / 2;
  const n = mkNode(ov.root, 'Sheet', 1080, h, 0, y - h);
  const g = n.addComponent(Graphics);
  shadow(g, new Color(34, 48, 63, 72), 90, 0, -40);
  g.fillColor = P_CLEAN.card;
  g.roundRect(-540, -h / 2 - 80, 1080, h + 80, 90);
  g.fill();
  shadow(g, null);
  g.fillColor = P_CLEAN.grab;
  g.roundRect(-62, h / 2 - 42, 124, 14, 7);
  g.fill();
  tween(n).to(0.38, { position: new Vec3(0, y + 24, 0) }).to(0.16, { position: new Vec3(0, y, 0) }).start();
  return { node: n, top: h / 2 };
}

/** 二次贝塞尔上一点 */
function qpt(t        , p0          , c          , p1          )                   {
  const u = 1 - t;
  return [u * u * p0[0]  + 2 * u * t * c[0]  + t * t * p1[0] , u * u * p0[1]  + 2 * u * t * c[1]  + t * t * p1[1] ];
}

function winClean(parent      , t           , info         , cb                      )       {
  const P = P_CLEAN;
  const ov = overlay(parent, t, 'ThemeWin');
  const { node: sh, top } = sheet(ov, 1260);

  // 虚线弧 + 金线描弧 + 三颗弧线星
  const ay = top - 250;
  const p0 = [-300, -120];
  const c = [0, 250];
  const p1 = [300, -120];
  const arcBg = mkGfx(sh, 'Arc', 700, 340, 0, ay);
  arcBg.lineWidth = 8;
  arcBg.strokeColor = P.line;
  dash(arcBg, [4, 20]);
  arcBg.moveTo(p0[0] , p0[1] );
  arcBg.quadraticCurveTo(c[0] , c[1] , p1[0] , p1[1] );
  arcBg.stroke();
  const arcFg = mkGfx(sh, 'ArcGold', 700, 340, 0, ay);
  let el = 0;
  onFrame(arcFg.node, (dt) => {
    el += dt;
    const k = Math.max(0, Math.min(1, (el - 0.35) / 1.0));
    if (k <= 0) return;
    arcFg.clear();
    arcFg.lineWidth = 9;
    arcFg.strokeColor = P.gold;
    const steps = Math.max(2, Math.round(40 * k));
    arcFg.moveTo(p0[0] , p0[1] );
    for (let i = 1; i <= steps; i++) {
      const [x, y] = qpt((i / steps) * k, p0, c, p1);
      arcFg.lineTo(x, y);
    }
    arcFg.stroke();
  });
  const pos                          = [[-232, -116], [0, 118], [232, -116]];
  for (let i = 0; i < 3; i++) {
    const on = i < info.stars;
    const [x, y] = pos[i] ;
    const sn = mkNode(sh, `ArcStar${i}`, 160, 160, x, ay + y);
    const g = sn.addComponent(Graphics);
    if (on) {
      shadow(g, new Color(245, 166, 35, 115), 40, 0, 16);
      g.circle(0, 0, 76);
      fillV(g, 76, -76, P.goldLight, P.gold);
      shadow(g, null);
      starPath(g, 0, -2, 42);
      g.fillColor = new Color(255, 255, 255);
      g.fill();
      sn.setScale(0, 0);
      tween(sn).delay(0.45 + i * 0.35).to(0.32, { scale: new Vec3(1.25, 1.25, 1) }).to(0.16, { scale: new Vec3(1, 1, 1) }).start();
    } else {
      g.fillColor = P.track;
      g.circle(0, 0, 76);
      g.fill();
      starPath(g, 0, -2, 42);
      g.fillColor = P.trackStar;
      g.fill();
    }
  }

  // 头衔徽章
  const honorText = t.copy.honor[Math.max(0, 3 - info.stars)] ?? t.copy.honor[2];
  const bw = Math.round(estW(honorText, 44) + 110);
  const badge = mkGfx(sh, 'Honor', bw, 96, 0, top - 470);
  badge.roundRect(-bw / 2, -48, bw, 96, 48);
  if (info.stars >= 3) fillLinear(badge, -bw / 2, 0, bw / 2, 0, [[0, P.honor3A], [1, P.goldBtn]]);
  else { badge.fillColor = P.goldSoft; badge.fill(); }
  mkText(badge.node, honorText, 0, 0, bw, { font: t.font, size: 44, color: info.stars >= 3 ? P.honorText3 : P.honorText, bold: true });
  const bop = badge.node.addComponent(UIOpacity);
  bop.opacity = 0;
  badge.node.setPosition(0, top - 494);
  tween(bop).delay(1.35).to(0.3, { opacity: 255 }).start();
  tween(badge.node).delay(1.35).to(0.3, { position: new Vec3(0, top - 470, 0) }).start();

  tally(sh, t, info, top - 700, 740);
  button(sh, t, 'primary', t.copy.nextLevel, 0, top - 960, 940, 150, () => ov.close(cb.onNext));
  button(sh, t, 'ghost', t.copy.backToMap, 0, top - 1110, 940, 110, () => ov.close(cb.onBack));
  // 3★ 庆祝（评审 P2-1）：光芒在三星弧后面放大，彩带用果冻配色
  if (info.stars >= 3) {
    goldBurst(ov.root, top - 330, P.goldLight, 1.1);
    confetti(ov.root, [P.gold, P.goldLight, P.mint, P.mintSoft, new Color(255, 255, 255)]);
  }
  return ov.root;
}

function failClean(parent      , t           , info          , cb               )       {
  const P = P_CLEAN;
  const ov = overlay(parent, t, 'ThemeFail');
  const { node: sh, top } = sheet(ov, info.canRevive ? 1130 : 880);

  const icon = mkGfx(sh, 'Icon', 240, 240, 0, top - 200);
  icon.fillColor = P.coralSoft;
  icon.circle(0, 0, 118);
  icon.fill();
  mkText(icon.node, '⏳', 0, 0, 200, { font: t.font, size: 104, color: P.ink });
  mkText(sh, t.copy.failTitle, 0, top - 380, 900, { font: t.font, size: 62, color: P.ink, bold: true });
  mkText(sh, info.canRevive ? t.copy.failSub(info.need) : t.copy.failFinalSub, 0, top - 455, 900, { font: t.font, size: 36, color: P.inkSoft });

  if (info.canRevive) {
    const giveUp = ()       => ov.close(cb.onGiveUp);
    const rw = 940;
    const rh = 260;
    const row = mkGfx(sh, 'ReviveRow', rw, rh, 0, top - 650);
    row.fillColor = P.tally;
    row.roundRect(-rw / 2, -rh / 2, rw, rh, 56);
    row.fill();
    const ringN = mkNode(row.node, 'Ring', 220, 220, -rw / 2 + 140, 0);
    const cnt = mkText(ringN, '10', 0, 0, 120, { font: t.font, size: 44, color: P.coral, bold: true });
    countdownRing(ringN, 84, 16, P.coral, P.line, null, cnt, giveUp);
    cnt.node.setSiblingIndex(ringN.children.length - 1);
    const tx = -rw / 2 + 270;
    mkText(row.node, t.copy.reviveTitle(info.reviveSec), tx + 250, 72, 500, { font: t.font, size: 42, color: P.ink, bold: true, align: 'left' });
    mkText(row.node, t.copy.reviveSub, tx + 250, -4, 500, { font: t.font, size: 32, color: P.inkSoft, align: 'left', lineHeight: 44 });
    const ad = t.copy.reviveAd(info.reviveSec);
    const aw = Math.round(estW(ad, 28) + 50);
    const chip = mkGfx(row.node, 'Ad', aw, 52, tx + aw / 2, -88);
    chip.fillColor = P.adBg;
    chip.roundRect(-aw / 2, -26, aw, 52, 26);
    chip.fill();
    mkText(chip.node, ad, 0, 0, aw, { font: t.font, size: 28, color: P.adText, bold: true });
    button(sh, t, 'alt', t.copy.reviveBtn(info.reviveSec), 0, top - 870, 940, 150, () => ov.close(cb.onRevive));
    button(sh, t, 'ghost', t.copy.giveUp, 0, top - 1020, 940, 110, giveUp);
  } else {
    button(sh, t, 'primary', t.copy.retry, 0, top - 620, 940, 150, () => ov.close(cb.onRetry));
    button(sh, t, 'ghost', t.copy.backToMap, 0, top - 770, 940, 110, () => ov.close(cb.onGiveUp));
  }
  return ov.root;
}

/* ================================================================ 贴纸手账 */

/** 和纸胶带 */
function tape(parent      , x        , y        , w        , h        , angle        , col       )       {
  const g = mkGfx(parent, 'Tape', w, h, x, y);
  g.node.angle = angle;
  shadow(g, new Color(0, 0, 0, 38), 8, 0, 3);
  g.fillColor = alpha(col, 230);
  g.roundRect(-w / 2, -h / 2, w, h, 5);
  g.fill();
  shadow(g, null);
}

function winJournal(parent      , t           , info         , cb                      )       {
  const P = P_JOURNAL;
  const ov = overlay(parent, t, 'ThemeWin');
  const W = 840;
  const H = 1010;
  const card = mkNode(ov.root, 'Polaroid', W, H, 0, 30);
  card.angle = 2.5;
  const g = card.addComponent(Graphics);
  shadow(g, new Color(0, 0, 0, 90), 80, 0, 44);
  g.fillColor = new Color(255, 255, 255);
  g.roundRect(-W / 2, -H / 2, W, H, 12);
  g.fill();
  shadow(g, null);
  tape(card, 0, H / 2 + 4, 260, 62, -3, P.washiBlue);
  // 进场：从下方歪着滑上来
  const op = card.addComponent(UIOpacity);
  op.opacity = 0;
  card.setPosition(0, -140);
  card.setScale(0.8, 0.8);
  tween(op).to(0.3, { opacity: 255 }).start();
  tween(card).to(0.38, { position: new Vec3(0, 44, 0), scale: new Vec3(1.03, 1.03, 1) }).to(0.16, { position: new Vec3(0, 30, 0), scale: new Vec3(1, 1, 1) }).start();

  // 照片区
  const pw = W - 80;
  const ph = 580;
  const py = H / 2 - 40 - ph / 2;
  const photo = mkGfx(card, 'Photo', pw, ph, 0, py);
  photo.fillColor = P.paperDeep;
  photo.rect(-pw / 2, -ph / 2, pw, ph);
  photo.fill();
  photo.lineWidth = 3;
  photo.strokeColor = P.border;
  photo.rect(-pw / 2, -ph / 2, pw, ph);
  photo.stroke();
  const pets = ['🐰', '🐶', '🐱'];
  pets.forEach((p, i) => {
    const l = mkText(photo.node, p, (i - 1) * 160, 140, 160, { font: t.font, size: 118, color: P.ink });
    l.node.setScale(0, 0);
    l.node.angle = -30;
    tween(l.node).delay(0.2 + i * 0.15).to(0.3, { scale: new Vec3(1.15, 1.15, 1), angle: 6 }).to(0.14, { scale: new Vec3(1, 1, 1), angle: 0 }).start();
  });
  for (let i = 0; i < 3; i++) {
    const on = i < info.stars;
    const sn = mkGfx(photo.node, `S${i}`, 90, 90, (i - 1) * 96, 0);
    starPath(sn, 0, 0, 38, 0.5);
    sn.fillColor = on ? P.stamp : P.starOff;
    sn.fill();
    if (on) {
      sn.node.setScale(0, 0);
      sn.node.angle = -40;
      tween(sn.node).delay(0.55 + i * 0.2).to(0.3, { scale: new Vec3(1.35, 1.35, 1), angle: 8 }).to(0.16, { scale: new Vec3(1, 1, 1), angle: 0 }).start();
    }
  }
  mkText(photo.node, `第 ${info.level} 关 · ${info.modeLabel}模式`, 0, -110, pw - 40, { font: t.font, size: 42, color: P.pencil });

  // 印章（右下，从 2.6 倍砸下来）
  const seal = mkNode(photo.node, 'Seal', 260, 260, pw / 2 - 150, -ph / 2 + 140);
  seal.angle = -14;
  const sg = seal.addComponent(Graphics);
  sg.fillColor = new Color(255, 251, 244, 110);
  sg.circle(0, 0, 122);
  sg.fill();
  sg.lineWidth = 9;
  sg.strokeColor = P.stamp;
  sg.circle(0, 0, 122);
  sg.stroke();
  sg.lineWidth = 4;
  sg.strokeColor = alpha(P.stamp, 130);
  sg.circle(0, 0, 104);
  sg.stroke();
  const honor = t.copy.honor[Math.max(0, 3 - info.stars)] ?? t.copy.honor[2];
  mkText(seal, honor, 0, 0, 220, { font: t.font, size: honor.length > 2 ? 58 : 76, color: P.stamp, bold: true });
  const sop = seal.addComponent(UIOpacity);
  sop.opacity = 0;
  seal.setScale(2.6, 2.6);
  tween(sop).delay(0.95).to(0.2, { opacity: 235 }).start();
  tween(seal).delay(0.95).to(0.22, { scale: new Vec3(0.92, 0.92, 1) }).to(0.12, { scale: new Vec3(1, 1, 1) }).start();

  // 拍立得下沿：本局 / 累计
  const uy = py - ph / 2 - 80;
  const soft            = { font: t.font, size: 34, color: P.inkSoft, align: 'left' };
  const num            = { font: t.font, size: 50, color: P.ink, bold: true, align: 'left' };
  mkText(card, t.copy.winScore, -pw / 2 + 40, uy, 80, soft);
  mkText(card, fmtNum(info.score), -pw / 2 + 90 + 120, uy, 240, num);
  mkText(card, t.copy.winTotal, 20 + 40, uy, 80, soft);
  mkText(card, fmtNum(info.totalScore), 70 + 120, uy, 240, num);
  if (info.isNewBest) {
    const bw = 120;
    const b = mkGfx(card, 'Best', bw, 46, pw / 2 - bw / 2, uy + 34);
    b.lineWidth = 4;
    b.strokeColor = P.stamp;
    b.roundRect(-bw / 2, -21, bw, 42, 21);
    b.stroke();
    mkText(b.node, t.copy.newBest, 0, 0, bw, { font: t.font, size: 26, color: P.stamp, bold: true });
  }

  const by = -H / 2 + 44 + 66;
  const bw2 = (pw - 26) / 2;
  button(card, t, 'ghost', t.copy.backToMap, -bw2 / 2 - 13, by, bw2, 132, () => ov.close(cb.onBack));
  button(card, t, 'primary', t.copy.nextLevel, bw2 / 2 + 13, by, bw2, 132, () => ov.close(cb.onNext));
  // 3★ 庆祝（评审 P2-1）：印章盖下时金光一闪，彩带用和纸胶带的颜色
  if (info.stars >= 3) {
    goldBurst(ov.root, 200, new Color(255, 214, 120), 0.95);
    confetti(ov.root, [P.washiPink, P.washiBlue, P.stamp, P.paperDeep, new Color(255, 214, 120)]);
  }
  return ov.root;
}

function failJournal(parent      , t           , info          , cb               )       {
  const P = P_JOURNAL;
  const ov = overlay(parent, t, 'ThemeFail');
  const W = 800;
  const H = info.canRevive ? 1000 : 720;
  const page = mkNode(ov.root, 'Page', W, H, 0, 30);
  page.angle = -1.5;
  const g = page.addComponent(Graphics);
  shadow(g, new Color(0, 0, 0, 90), 80, 0, 44);
  g.fillColor = P.sheet;
  g.roundRect(-W / 2, -H / 2, W, H, 22);
  g.fill();
  shadow(g, null);
  g.lineWidth = 3;
  g.strokeColor = P.border;
  g.roundRect(-W / 2, -H / 2, W, H, 22);
  g.stroke();
  tape(page, -W / 2 + 190, H / 2 + 2, 210, 54, 4, P.washiPink);
  popIn(page);

  const top = H / 2;
  mkText(page, '✏️', 0, top - 120, 200, { font: t.font, size: 120, color: P.ink });
  mkText(page, t.copy.failTitle, 0, top - 250, 740, { font: t.font, size: 66, color: P.ink, bold: true });
  mkText(page, info.canRevive ? t.copy.failSub(info.need) : t.copy.failFinalSub, 0, top - 350, 720, {
    font: t.font, size: 34, color: P.inkSoft, lineHeight: 52,
  });

  const by = -H / 2 + 50 + 66;
  const bw = (W - 110 - 26) / 2;
  if (info.canRevive) {
    const giveUp = ()       => ov.close(cb.onGiveUp);
    const cw = W - 110;
    const ch = 250;
    const rc = mkGfx(page, 'ReviveCard', cw, ch, 0, -40);
    rc.fillColor = P.paperDeep;
    rc.roundRect(-cw / 2, -ch / 2, cw, ch, 28);
    rc.fill();
    rc.lineWidth = 4;
    rc.strokeColor = P.rail;
    dash(rc, [14, 10]);
    rc.roundRect(-cw / 2, -ch / 2, cw, ch, 28);
    rc.stroke();
    dash(rc, []);
    const ringN = mkNode(rc.node, 'Ring', 190, 190, -cw / 2 + 120, 0);
    const cnt = mkText(ringN, '10', 0, 0, 120, { font: t.font, size: 46, color: P.stamp, bold: true });
    countdownRing(ringN, 70, 14, P.stamp, P.starOff, [12, 12], cnt, giveUp);
    cnt.node.setSiblingIndex(ringN.children.length - 1);
    const tx = -cw / 2 + 240;
    mkText(rc.node, t.copy.reviveTitle(info.reviveSec), tx + 210, 70, 420, { font: t.font, size: 40, color: P.ink, bold: true, align: 'left' });
    mkText(rc.node, t.copy.reviveSub, tx + 210, -2, 420, { font: t.font, size: 30, color: P.inkSoft, align: 'left', lineHeight: 42 });
    const ad = t.copy.reviveAd(info.reviveSec);
    const aw = Math.round(estW(ad, 26) + 44);
    const chip = mkGfx(rc.node, 'Ad', aw, 46, tx + aw / 2, -84);
    chip.fillColor = P.kraft;
    chip.roundRect(-aw / 2, -23, aw, 46, 23);
    chip.fill();
    mkText(chip.node, ad, 0, 0, aw, { font: t.font, size: 26, color: new Color(255, 255, 255), bold: true });
    button(page, t, 'ghost', t.copy.giveUp, -bw / 2 - 13, by, bw, 132, giveUp);
    button(page, t, 'primary', t.copy.reviveBtn(info.reviveSec), bw / 2 + 13, by, bw, 132, () => ov.close(cb.onRevive));
  } else {
    button(page, t, 'ghost', t.copy.backToMap, -bw / 2 - 13, by, bw, 132, () => ov.close(cb.onGiveUp));
    button(page, t, 'primary', t.copy.retry, bw / 2 + 13, by, bw, 132, () => ov.close(cb.onRetry));
  }
  return ov.root;
}
