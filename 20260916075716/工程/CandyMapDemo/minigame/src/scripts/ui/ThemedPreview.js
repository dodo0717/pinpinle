/**
 * 点关卡弹出的「关卡详情」窗口 —— 第 2 / 3 / 4 关各一款（2026-10-25），与对局三主题一一对应：
 *
 *   第 2 关 candy  「糖果嘉年华」：两条糖果彩带吊着一块奶油金边牌子从上方落下；
 *                   粉色糖果横幅写关卡号，三颗星插座显示本模式最好成绩，奶油结算表列三条星线，
 *                   糖果胶囊选模式，绿色立体大按钮「开始挑战」。
 *   第 3 关 clean  「果冻乐园」：白色底部 sheet 从下方升起（Royal Match 式）；
 *                   薄荷小标签 + 大号关卡号，弧线三星，分段控件选模式，浅蓝目标卡，金色「开始」。
 *   第 4 关 journal「贴纸手账」：一张歪贴的手账纸从上方飘下、两角和纸胶带；
 *                   手写关卡号，三枚红色星章，虚线引导的星线清单，牛皮纸标签选模式，「开贴」。
 *
 * 第 1 关和第 5 关起仍用原来的吊牌（MapBootstrap.buildPreview）。
 * 只管画与转发点击：模式切换 / 体力 / 进关全部回调给 MapBootstrap（与原吊牌同一套规则）。
 */

import { Node, Graphics, Color, Vec3, tween, UIOpacity, EventTouch } from '../../runtime/cc.js';
import { P_CANDY, P_CLEAN, P_JOURNAL, FONT_CANDY, FONT_HAND, FONT_SANS,              } from '../game/theme.js';
import { alpha, fillV, fillRadial, shadow, dash, starPath, mkNode, mkGfx, mkText, screenH,                } from '../game/paint.js';
import { estW } from '../game/themeHud.js';
                                            

                              
                   
                                  
                                           
                                 
                   
                                                                     
                     
                                                
               
                                    
                         
 

const MODES             = ['normal', 'nightmare'];
const MODE_NAME                           = { normal: '简单', nightmare: '困难' };
const WHITE = new Color(255, 255, 255);

/** 点按：按下缩一下、抬手触发，并吞掉事件（不让它穿到遮罩上把窗口关了） */
function tap(n      , fn            , scale = 0.95)       {
  n.on(Node.EventType.TOUCH_START, (e            ) => { e.propagationStopped = true; n.setScale(scale, scale); });
  n.on(Node.EventType.TOUCH_CANCEL, () => n.setScale(1, 1));
  n.on(Node.EventType.TOUCH_END, (e            ) => { e.propagationStopped = true; n.setScale(1, 1); fn(); });
}

/** 卡片自身吞触摸：点卡片空白处不关窗口 */
function swallow(n      )       {
  const stop = (e            )       => { e.propagationStopped = true; };
  n.on(Node.EventType.TOUCH_START, stop);
  n.on(Node.EventType.TOUCH_END, stop);
}

function bestCaption(stars        , lead        )         {
  return stars > 0 ? `${lead} ${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}` : '还没有通关，冲一冲！';
}

export class ThemedPreview {
                   parent      ;
                   host             ;
          root              = null;
          dyn              = null;
          paintDyn                                  = null;
          holder              = null;
          level = 1;

  constructor(parent      , host             ) {
    this.parent = parent;
    this.host = host;
  }

  get open()          {
    return !!this.root?.isValid;
  }

  show(level        , theme         )       {
    this.hide();
    this.level = level;
    const H = screenH();
    const root = mkNode(this.parent, 'ThemedPreview', 1080, H);
    root.setSiblingIndex(this.host.siblingIndex());
    this.root = root;
    const op = root.addComponent(UIOpacity);
    const mask = mkGfx(root, 'Mask', 1080, H);
    mask.fillColor = theme === 'candy' ? new Color(30, 10, 60, 170)
      : theme === 'clean' ? new Color(24, 38, 52, 110) : new Color(74, 59, 42, 140);
    mask.rect(-540, -H / 2, 1080, H);
    mask.fill();
    // 点遮罩空白处关闭（与原吊牌一致）
    mask.node.on(Node.EventType.TOUCH_START, (e            ) => { e.propagationStopped = true; });
    mask.node.on(Node.EventType.TOUCH_END, (e            ) => { e.propagationStopped = true; this.hide(); });
    op.opacity = 0;
    tween(op).to(0.18, { opacity: 255 }).start();

    if (theme === 'clean') this.buildClean(root, H);
    else if (theme === 'journal') this.buildJournal(root, H);
    else this.buildCandy(root, H);
    this.repaint();
  }

  hide()       {
    if (this.root?.isValid) this.root.destroy();
    this.root = null;
    this.dyn = null;
    this.holder = null;
    this.paintDyn = null;
  }

  /** 模式相关的部分（最好成绩、星线、模式按钮）整块重画 */
          repaint()       {
    if (!this.holder || !this.paintDyn) return;
    if (this.dyn?.isValid) this.dyn.destroy();
    this.dyn = mkNode(this.holder, 'Dyn', 10, 10);
    this.paintDyn(this.dyn);
  }

          choose(m          )       {
    if (m === this.host.mode()) return;
    if (this.host.pickMode(m)) this.repaint();
  }

          modeState(m          )                                                 {
    const locked = m === 'nightmare' && !this.host.canHard(this.level);
    return { on: m === this.host.mode(), locked, text: locked ? `🔒 ${MODE_NAME[m]}` : MODE_NAME[m] };
  }

  /* ================================================================ 糖果嘉年华 */

          buildCandy(root      , H        )       {
    const P = P_CANDY;
    const W = 860;
    const CH = 1090;   // 10-25：原 980，模式胶囊和「开始挑战」重叠
    const top = CH / 2;
    const drop = mkNode(root, 'Drop', W, H);

    // 两条粉白斜纹糖果彩带，从屏幕顶吊着牌子
    const strapLen = H / 2 - top + 60;
    for (const sx of [-270, 270]) {
      const s = mkGfx(drop, 'Strap', 30, strapLen, sx, top - 20 + strapLen / 2);
      const L = strapLen;
      s.fillColor = WHITE;
      s.roundRect(-15, -L / 2, 30, L, 8);
      s.fill();
      s.fillColor = P.candy;
      for (let y = -L / 2; y < L / 2 - 20; y += 40) {
        s.moveTo(-15, y);
        s.lineTo(15, y + 16);
        s.lineTo(15, y + 34);
        s.lineTo(-15, y + 18);
        s.close();
        s.fill();
      }
    }

    const card = mkNode(drop, 'Card', W, CH);
    swallow(card);
    const g = card.addComponent(Graphics);
    shadow(g, new Color(0, 0, 0, 110), 70, 0, 50);
    g.fillColor = new Color(0, 0, 0, 64);
    g.roundRect(-W / 2, -CH / 2 - 34, W, CH, 72);
    g.fill();
    shadow(g, null);
    g.roundRect(-W / 2, -CH / 2, W, CH, 72);
    fillV(g, CH / 2, -CH / 2, P.cardA, P.cardB);
    g.lineWidth = 11;
    g.strokeColor = P.cardBorder;
    g.roundRect(-W / 2, -CH / 2, W, CH, 72);
    g.stroke();

    // 粉色糖果横幅（压在牌子上沿）
    const bw = 600;
    const bh = 150;
    const ban = mkGfx(card, 'Banner', bw, bh, 0, top - 24);
    ban.fillColor = P.candyEdge;
    ban.roundRect(-bw / 2, -bh / 2 - 14, bw, bh, bh / 2);
    ban.fill();
    ban.roundRect(-bw / 2, -bh / 2, bw, bh, bh / 2);
    fillV(ban, bh / 2, -bh / 2, new Color(255, 150, 192), P.candy);
    ban.fillColor = new Color(255, 255, 255, 110);
    ban.roundRect(-bw / 2 + 40, bh / 2 - 22, bw - 80, 10, 5);
    ban.fill();
    mkText(ban.node, `第 ${this.level} 关`, 0, 4, bw - 40, {
      font: FONT_CANDY, size: 92, color: WHITE, outline: P.candyEdge, outlineWidth: 5,
      shadow: { color: new Color(120, 20, 60, 120), y: 6 },
    });
    mkText(card, '🍬 糖果嘉年华', 0, top - 150, 600, { font: FONT_CANDY, size: 40, color: P.ink });

    // 开始挑战
    const pw = 680;
    const ph = 150;
    const play = mkNode(card, 'Play', pw, ph + 20, 0, -CH / 2 + 125);
    const pg = play.addComponent(Graphics);
    pg.fillColor = P.goEdge;
    pg.roundRect(-pw / 2, -ph / 2 - 16, pw, ph, 54);
    pg.fill();
    pg.roundRect(-pw / 2, -ph / 2, pw, ph, 54);
    fillV(pg, ph / 2, -ph / 2, new Color(160, 234, 128), P.go);
    pg.fillColor = new Color(255, 255, 255, 102);
    pg.roundRect(-pw / 2 + 30, ph / 2 - 16, pw - 60, 8, 4);
    pg.fill();
    mkText(play, '开始挑战 ▶', 0, 3, pw, { font: FONT_CANDY, size: 64, color: WHITE, shadow: { color: new Color(0, 0, 0, 72), y: 5 } });
    tap(play, () => this.host.play());

    this.closeBtn(card, W / 2 - 46, top - 46, new Color(107, 63, 24));

    this.holder = card;
    this.paintDyn = (d) => {
      const mode = this.host.mode();
      const best = this.host.bestStars(mode, this.level);
      // 三颗星插座（与第 2 关 HUD 同款）
      for (let i = 0; i < 3; i++) {
        const sg = mkGfx(d, `Sock${i}`, 140, 140, (i - 1) * 150, top - 280 + (i === 1 ? 14 : 0));
        const on = i < best;
        const r = 62;
        if (on) {
          shadow(sg, new Color(255, 201, 60, 217), 46, 0, 0);
          sg.circle(0, 0, r);
          fillRadial(sg, 0, 0, r, [[0, P.goldLight], [1, P.gold]], 0, r * 0.24);
          shadow(sg, null);
          starPath(sg, 0, -2, 38);
          sg.fillColor = WHITE;
          sg.fill();
        } else {
          sg.circle(0, 0, r);
          fillRadial(sg, 0, 0, r, [[0, P.socketA], [1, P.socketB]], 0, r * 0.24);
          starPath(sg, 0, -2, 36);
          sg.fillColor = new Color(120, 96, 150, 200);
          sg.fill();
        }
      }
      mkText(d, bestCaption(best, '最好成绩'), 0, top - 385, 700, { font: FONT_CANDY, size: 34, color: P.total });

      // 星线表
      const lines = this.host.lines(mode, this.level);
      const tw = 700;
      const th = 240;
      const tb = mkGfx(d, 'Tally', tw, th, 0, top - 545);
      tb.fillColor = P.tally;
      tb.roundRect(-tw / 2, -th / 2, tw, th, 40);
      tb.fill();
      tb.fillColor = new Color(160, 110, 30, 40);
      tb.roundRect(-tw / 2 + 4, th / 2 - 14, tw - 8, 10, 5);
      tb.fill();
      if (lines) {
        lines.forEach((v, i) => {
          const y = 76 - i * 76;
          for (let k = 0; k <= i; k++) {
            starPath(tb, -tw / 2 + 56 + k * 40, y, 17, 0.5);
            tb.fillColor = P.gold;
            tb.fill();
          }
          mkText(tb.node, `${i + 1} 星线`, -tw / 2 + 200 + 90, y, 180, { font: FONT_CANDY, size: 38, color: P.ink, align: 'left' });
          mkText(tb.node, `${v} 张`, tw / 2 - 40 - 110, y, 220, { font: FONT_CANDY, size: 44, color: P.total, align: 'right' });
          if (i < 2) {
            tb.lineWidth = 3;
            tb.strokeColor = P.dash;
            dash(tb, [12, 9]);
            tb.moveTo(-tw / 2 + 30, y - 38);
            tb.lineTo(tw / 2 - 30, y - 38);
            tb.stroke();
            dash(tb, []);
          }
        });
      }

      // 模式糖果胶囊
      MODES.forEach((m, i) => {
        const st = this.modeState(m);
        const w = 300;
        const h = 104;
        const n = mkNode(d, `Mode_${m}`, w, h + 16, i === 0 ? -165 : 165, top - 735);
        const mg = n.addComponent(Graphics);
        const [face, edge, hi] = st.locked
          ? [new Color(170, 165, 180), new Color(130, 125, 140), new Color(195, 190, 205)]
          : st.on ? [P.candy, P.candyEdge, new Color(255, 150, 192)] : [P.ghost, P.ghostEdge, new Color(206, 199, 220)];
        mg.fillColor = edge;
        mg.roundRect(-w / 2, -h / 2 - 12, w, h, h / 2);
        mg.fill();
        mg.roundRect(-w / 2, -h / 2, w, h, h / 2);
        fillV(mg, h / 2, -h / 2, hi, face);
        if (st.on) {
          mg.lineWidth = 6;
          mg.strokeColor = P.gold;
          mg.roundRect(-w / 2 - 3, -h / 2 - 3, w + 6, h + 6, h / 2 + 3);
          mg.stroke();
        }
        mkText(n, st.text, 0, 3, w - 20, { font: FONT_CANDY, size: 46, color: WHITE, shadow: { color: new Color(0, 0, 0, 64), y: 4 } });
        tap(n, () => this.choose(m));
      });
    };

    // 落下：上方 → 冲过头 → 回弹
    drop.setPosition(0, H);
    tween(drop).to(0.32, { position: new Vec3(0, -40, 0) }).to(0.14, { position: new Vec3(0, 14, 0) }).to(0.1, { position: new Vec3(0, 0, 0) }).start();
  }

  /* ================================================================ 果冻乐园 */

          buildClean(root      , H        )       {
    const P = P_CLEAN;
    const SH = 1220;
    const y0 = -H / 2 + SH / 2;
    const sheet = mkNode(root, 'Sheet', 1080, SH, 0, y0 - SH);
    swallow(sheet);
    const g = sheet.addComponent(Graphics);
    shadow(g, new Color(34, 48, 63, 72), 90, 0, -40);
    g.fillColor = P.card;
    g.roundRect(-540, -SH / 2 - 80, 1080, SH + 80, 90);
    g.fill();
    shadow(g, null);
    g.fillColor = P.grab;
    g.roundRect(-62, SH / 2 - 42, 124, 14, 7);
    g.fill();
    const top = SH / 2;

    // 薄荷小标签 + 大号关卡号
    const tag = '果冻乐园';
    const tw = Math.round(estW(tag, 32) + 90);
    const chip = mkGfx(sheet, 'Chip', tw, 64, 0, top - 110);
    chip.fillColor = P.mintSoft;
    chip.roundRect(-tw / 2, -32, tw, 64, 32);
    chip.fill();
    chip.fillColor = P.mint;
    chip.circle(-tw / 2 + 34, 0, 9);
    chip.fill();
    mkText(chip.node, tag, 14, 0, tw - 40, { font: FONT_SANS, size: 32, color: P.mint, bold: true });
    mkText(sheet, `第 ${this.level} 关`, 0, top - 210, 900, { font: FONT_SANS, size: 92, color: P.ink, bold: true });

    // 开始 / 稍后再说
    const play = mkNode(sheet, 'Play', 940, 170, 0, top - 1010);
    const pg = play.addComponent(Graphics);
    shadow(pg, new Color(245, 166, 35, 102), 50, 0, 22);
    pg.roundRect(-470, -75, 940, 150, 50);
    fillV(pg, 75, -75, P.goldBtn, P.gold);
    shadow(pg, null);
    mkText(play, '开始', 0, 0, 900, { font: FONT_SANS, size: 60, color: WHITE, bold: true });
    tap(play, () => this.host.play(), 0.97);
    const later = mkNode(sheet, 'Later', 600, 90, 0, top - 1150);
    mkText(later, '稍后再说', 0, 0, 600, { font: FONT_SANS, size: 38, color: P.inkSoft, bold: true });
    tap(later, () => this.hide());

    this.holder = sheet;
    this.paintDyn = (d) => {
      const mode = this.host.mode();
      const best = this.host.bestStars(mode, this.level);
      // 弧线三星
      const pos                          = [[-170, -10], [0, 26], [170, -10]];
      pos.forEach(([x, y], i) => {
        const sg = mkGfx(d, `Star${i}`, 150, 150, x, top - 370 + y);
        if (i < best) {
          shadow(sg, new Color(245, 166, 35, 115), 36, 0, 14);
          sg.circle(0, 0, 66);
          fillV(sg, 66, -66, P.goldLight, P.gold);
          shadow(sg, null);
          starPath(sg, 0, -2, 36);
          sg.fillColor = WHITE;
          sg.fill();
        } else {
          sg.fillColor = P.track;
          sg.circle(0, 0, 66);
          sg.fill();
          starPath(sg, 0, -2, 36);
          sg.fillColor = P.trackStar;
          sg.fill();
        }
      });
      mkText(d, bestCaption(best, '最好成绩'), 0, top - 480, 900, { font: FONT_SANS, size: 34, color: P.inkSoft, bold: true });

      // 分段控件选模式
      const sw = 760;
      const sh = 112;
      const seg = mkGfx(d, 'Segment', sw, sh, 0, top - 600);
      seg.fillColor = P.track;
      seg.roundRect(-sw / 2, -sh / 2, sw, sh, sh / 2);
      seg.fill();
      MODES.forEach((m, i) => {
        const st = this.modeState(m);
        const half = sw / 2 - 10;
        const n = mkNode(seg.node, `Mode_${m}`, half, sh - 16, i === 0 ? -sw / 4 + 2 : sw / 4 - 2, 0);
        if (st.on) {
          const kg = n.addComponent(Graphics);
          shadow(kg, new Color(34, 48, 63, 46), 16, 0, 6);
          kg.fillColor = WHITE;
          kg.roundRect(-half / 2, -(sh - 16) / 2, half, sh - 16, (sh - 16) / 2);
          kg.fill();
          shadow(kg, null);
        }
        mkText(n, st.text, 0, 0, half - 20, {
          font: FONT_SANS, size: 42, bold: true,
          color: st.locked ? P.trackStar : st.on ? P.gold : P.inkSoft,
        });
        tap(n, () => this.choose(m), 0.97);
      });

      // 目标卡（三条星线）
      const lines = this.host.lines(mode, this.level);
      const cw = 940;
      const chh = 250;
      const cardG = mkGfx(d, 'Goal', cw, chh, 0, top - 800);
      cardG.fillColor = P.tally;
      cardG.roundRect(-cw / 2, -chh / 2, cw, chh, 44);
      cardG.fill();
      if (lines) {
        lines.forEach((v, i) => {
          const y = 80 - i * 80;
          for (let k = 0; k <= i; k++) {
            starPath(cardG, -cw / 2 + 60 + k * 42, y, 18, 0.5);
            cardG.fillColor = P.gold;
            cardG.fill();
          }
          mkText(cardG.node, `${i + 1} 星线`, -cw / 2 + 210 + 100, y, 200, { font: FONT_SANS, size: 38, color: P.inkSoft, bold: true, align: 'left' });
          mkText(cardG.node, `${v} 张`, cw / 2 - 50 - 120, y, 240, { font: FONT_SANS, size: 46, color: P.ink, bold: true, align: 'right' });
          if (i < 2) {
            cardG.fillColor = P.line;
            cardG.rect(-cw / 2 + 36, y - 41, cw - 72, 2);
            cardG.fill();
          }
        });
      }
    };

    // 升起：屏幕下沿 → 冲过头 → 落定
    tween(sheet).to(0.36, { position: new Vec3(0, y0 + 24, 0) }).to(0.16, { position: new Vec3(0, y0, 0) }).start();
  }

  /* ================================================================ 贴纸手账 */

          buildJournal(root      , H        )       {
    const P = P_JOURNAL;
    const W = 840;
    const CH = 1130;   // 10-25：原 1020，牛皮纸模式标签和「开贴」重叠
    const top = CH / 2;
    const page = mkNode(root, 'Page', W, CH);
    swallow(page);
    const g = page.addComponent(Graphics);
    shadow(g, new Color(0, 0, 0, 90), 80, 0, 44);
    g.fillColor = P.sheet;
    g.roundRect(-W / 2, -CH / 2, W, CH, 22);
    g.fill();
    shadow(g, null);
    // 点阵底纹 + 红色页边线
    g.fillColor = P.dots;
    for (let y = -CH / 2 + 40; y < CH / 2 - 20; y += 52) {
      for (let x = -W / 2 + 96; x < W / 2 - 20; x += 52) {
        g.circle(x, y, 3);
        g.fill();
      }
    }
    g.fillColor = new Color(214, 69, 69, 70);
    g.rect(-W / 2 + 62, -CH / 2 + 10, 4, CH - 20);
    g.fill();
    g.lineWidth = 3;
    g.strokeColor = P.border;
    g.roundRect(-W / 2, -CH / 2, W, CH, 22);
    g.stroke();
    for (const [x, a, col] of [[-W / 2 + 140, -8, P.washiPink], [W / 2 - 140, 7, P.washiBlue]]         ) {
      const t = mkGfx(page, 'Tape', 220, 58, x, top + 2);
      t.node.angle = a;
      shadow(t, new Color(0, 0, 0, 38), 8, 0, 3);
      t.fillColor = alpha(col, 225);
      t.roundRect(-110, -29, 220, 58, 5);
      t.fill();
      shadow(t, null);
    }

    const hand = (size        , color       , extra                     = {})            => ({ font: FONT_HAND, size, color, ...extra });
    mkText(page, `第 ${this.level} 关`, 0, top - 130, 700, hand(100, P.ink, { bold: true }));
    mkText(page, '贴纸手账 · 今天也把这一页贴满吧', 0, top - 215, 720, hand(36, P.pencil));

    // 开贴
    const pw = 640;
    const ph = 140;
    const play = mkNode(page, 'Play', pw, ph + 20, 0, -CH / 2 + 115);
    const pg = play.addComponent(Graphics);
    pg.fillColor = P.kraftDark;
    pg.roundRect(-pw / 2, -ph / 2 - 12, pw, ph, 30);
    pg.fill();
    pg.fillColor = P.kraft;
    pg.roundRect(-pw / 2, -ph / 2, pw, ph, 30);
    pg.fill();
    mkText(play, '开贴 ▶', 0, 2, pw, hand(62, P.btnText, { bold: true }));
    tap(play, () => this.host.play());

    this.closeBtn(page, W / 2 - 60, top - 62, P.stamp, true);

    this.holder = page;
    this.paintDyn = (d) => {
      const mode = this.host.mode();
      const best = this.host.bestStars(mode, this.level);
      // 三枚星章
      for (let i = 0; i < 3; i++) {
        const on = i < best;
        const sg = mkGfx(d, `Stamp${i}`, 140, 140, (i - 1) * 160, top - 345);
        sg.node.angle = on ? [-10, 6, -4][i]  : 0;
        sg.fillColor = on ? P.stampSoft : P.sheet;
        sg.circle(0, 0, 58);
        sg.fill();
        sg.lineWidth = 7;
        sg.strokeColor = on ? P.stamp : P.rail;
        if (!on) dash(sg, [12, 10]);
        sg.circle(0, 0, 58);
        sg.stroke();
        dash(sg, []);
        starPath(sg, 0, -2, 32, 0.5);
        sg.fillColor = on ? P.stamp : P.rail;
        sg.fill();
      }
      mkText(d, bestCaption(best, '这页最好'), 0, top - 445, 720, hand(36, P.pencil));

      // 星线清单（虚线引导）
      const lines = this.host.lines(mode, this.level);
      if (lines) {
        const lg = mkGfx(d, 'Lines', W, 260, 0, top - 600);
        lines.forEach((v, i) => {
          const y = 76 - i * 76;
          mkText(lg.node, `${'★'.repeat(i + 1)} ${i + 1} 星线`, -W / 2 + 110 + 140, y, 280, hand(40, P.ink, { align: 'left' }));
          mkText(lg.node, `${v} 张`, W / 2 - 70 - 90, y, 180, hand(46, P.stamp, { bold: true, align: 'right' }));
          lg.lineWidth = 4;
          lg.strokeColor = P.rail;
          dash(lg, [6, 10]);
          lg.moveTo(-W / 2 + 400, y - 4);
          lg.lineTo(W / 2 - 270, y - 4);
          lg.stroke();
          dash(lg, []);
        });
      }

      // 牛皮纸模式标签
      MODES.forEach((m, i) => {
        const st = this.modeState(m);
        const w = 280;
        const h = 100;
        const n = mkNode(d, `Mode_${m}`, w, h + 12, i === 0 ? -160 : 160, top - 790);
        n.angle = i === 0 ? -2 : 2;
        const mg = n.addComponent(Graphics);
        if (st.on) {
          mg.fillColor = P.kraftDark;
          mg.roundRect(-w / 2, -h / 2 - 8, w, h, 26);
          mg.fill();
          mg.fillColor = P.kraft;
          mg.roundRect(-w / 2, -h / 2, w, h, 26);
          mg.fill();
        } else {
          mg.fillColor = P.sheet;
          mg.roundRect(-w / 2, -h / 2, w, h, 26);
          mg.fill();
          mg.lineWidth = 4;
          mg.strokeColor = P.rail;
          dash(mg, [14, 10]);
          mg.roundRect(-w / 2, -h / 2, w, h, 26);
          mg.stroke();
          dash(mg, []);
        }
        mkText(n, st.text, 0, 0, w - 20, hand(46, st.on ? P.btnText : st.locked ? P.rail : P.inkSoft, { bold: true }));
        tap(n, () => this.choose(m));
      });
    };

    // 飘下：从上方歪着落下，转正到 -1.5°
    page.setPosition(0, H * 0.9);
    page.angle = -8;
    tween(page).to(0.38, { position: new Vec3(0, -20, 0), angle: 1 }).to(0.16, { position: new Vec3(0, 0, 0), angle: -1.5 }).start();
  }

  /* ================================================================ 公共 */

          closeBtn(parent      , x        , y        , color       , ring = false)       {
    const n = mkNode(parent, 'Close', 96, 96, x, y);
    const g = n.addComponent(Graphics);
    if (ring) {
      g.fillColor = P_JOURNAL.sheet;
      g.circle(0, 0, 32);
      g.fill();
      g.lineWidth = 5;
      g.strokeColor = color;
      g.circle(0, 0, 32);
      g.stroke();
      mkText(n, '✕', 0, 1, 60, { font: FONT_SANS, size: 34, color, bold: true });
    } else {
      g.fillColor = new Color(0, 0, 0, 64);
      g.circle(0, -4, 32);
      g.fill();
      g.fillColor = color;
      g.circle(0, 0, 32);
      g.fill();
      mkText(n, '✕', 0, 1, 60, { font: FONT_SANS, size: 34, color: WHITE, bold: true });
    }
    tap(n, () => this.hide(), 0.9);
  }
}
