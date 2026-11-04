/**
 * 结算吊牌（从 web/ui/result.ts + web/ui.css 1106-1141 移植，2026-11-02 全量重做）
 *
 * 与 PLAY 吊牌（`界面/LevelPreview.ts`）**共用同一套骨架**：`.lp-drop` / `.lp-rope` /
 * `.lp-card` / `.lp-spacer` —— 820 宽、整屏垂直居中（牌心 y=956，含 -8px 负边距）。
 * 与 PLAY 的区别：牌高是**内容驱动**的（Web `.lp-card` 没有固定高，`height:auto`），
 * 所以这里按 Web 的块级流式布局现算：
 *
 *   内容高 = Σ(块高) + Σ(相邻 margin 折叠后的间距)   （block 兄弟margin 折叠取 max）
 *   牌高   = 78(上边距72+边框6) + 内容高 + 88(下边距82+边框6)
 *   麻绳   = 964 − 牌高/2（顶到屏幕顶、底压进牌子上缘 8px）
 *
 * 各块的行盒高：Web `line-height` 显式给的照抄（标题 84×1.12=94、分数 116×1=116），
 * `normal` 的按 **1.30** 倍字号（`docs/dump/web-settings.json` 两处 40px/normal 的元素
 * 实测内容高都是 52 → 52/40 = 1.30，与 `.home-nick` 40px→52 一致）。
 *
 * 【与 Web 的行为一致】
 *   - 不传 score 就不画得分卡（教学完成这类「没有分数可结」的弹窗）；
 *   - 按钮**按行排布、放不下自动折行**（`.rs-btn-row` flex-wrap + gap 24），宽度随文案变
 *     （`padding:20px 56px` + 3px 边框 → 固定消耗 118px）；
 *   - 置灰仍可点：Web 是 `opacity:.5` + 点击 `toast(disabledHint)`（result.ts:121-129）；
 *   - ✕ 关闭 = 隐藏吊牌 + 回主页（`onHome`）。
 *
 * ⚠️ 滚动分数用全局 `setTimeout` 分段推进（不用 `window.setTimeout` —— 小游戏没有 window；
 * 也不用 tween 的 onUpdate —— 预览 shim 未实现）。
 */

import { Node, UITransform, Graphics, Label, Color, Layers, tween, Vec3, UIOpacity, Sprite, Vec2 } from 'cc';
import { mkSprite, setSprite, WHITE, STAGE_W, STAGE_H, BLEED } from './uiPaint';
import { applyUiFont, applyUiText } from './fontUtil';

export interface ResultButton {
  text: string;
  onClick?: () => void;
  primary?: boolean;
  /** 置灰仍可点（点了弹 `disabledHint` 不执行）—— 与 GameDialog 同语义 */
  dim?: boolean;
  disabledHint?: string;
}

export interface ResultOptions {
  mode: 'win' | 'lose';
  /** emoji 占位图标（🏆 / 👑 / 💡）；传了 `stars` 时以星级优先 */
  icon?: string;
  /** 画三颗星（1~3 颗点亮），优先于 `icon` */
  stars?: number;
  title: string;
  /** 标题下方、得分上方的副文案（如「您的分数超越了 X% 的玩家」） */
  sub?: string;
  scoreLabel?: string;
  /** 不传 = 不画得分卡 */
  score?: number;
  hint?: string;
  note?: string;
  /** 按钮按行排布 */
  rows: ResultButton[][];
  /** ✕ 关闭的行为（默认等同「回主页」） */
  onHome?: () => void;
}

/* ---------------- 实测常量（1080×1920 逻辑坐标，y 向下 / Cocos 节点 y 向上） ---------------- */

/** 牌子外框宽（含 6px 边框），与 PLAY 完全一致（`docs/dump/web-preview.json`） */
const CARD_W = 820;
/** 牌心在整屏里的 y（向下坐标）= 956 → Cocos 里 y 向上（与 PLAY 同一套骨架） */
const CARD_CENTER_Y_SCREEN = 956;
const CARD_LOCAL_Y = STAGE_H / 2 - CARD_CENTER_Y_SCREEN;   // = +4
/** 内容区宽 = 820 − 2×6 边框 − 2×56 padding */
const CONTENT_W = 696;
/** 牌子上内边距（padding 72 + 边框 6）/ 下内边距（82 + 6） */
const PAD_TOP = 78;
const PAD_BOT = 88;
/** Web `line-height: normal` 的行盒系数（两处 40px 实测内容高 52 → 1.30） */
const LH_NORMAL = 1.3;
/** ✕：60×60 圆，牌内 top 22 / right 26（= CSS 16/20 + 6px 边框） */
const CLOSE_SIZE = 60;
/** 按钮：40px 行盒 52 + padding 40 + 边框 6 = 98；贴图多 6px 是 `0 6px 0` 硬下影 */
const BTN_H = 98;
const BTN_FIX_W = 118;           // padding 56×2 + border 3×2
const BTN_GAP = 24;

/** 滚动分数：总时长与缓动对齐 Web 版 rollNumber（620ms，cubic-out） */
const ROLL_MS = 620;

/* 颜色（全部取自 Web computed style / ui.css 1108-1141） */
const C_MASK = new Color(20, 12, 4, Math.round(0.34 * 255));        // rgba(20,12,4,.34)
const C_INK = new Color(107, 74, 47, 255);                          // #6B4A2F（标题/副文案/提示）
const C_STROKE = new Color(245, 197, 66, 255);                      // #F5C542（3px 金描边）
const C_LABEL = new Color(138, 106, 68, 255);                       // #8a6a44
const C_VALUE = new Color(232, 161, 0, 255);                        // #E8A100
const C_NOTE = new Color(154, 122, 85, 255);                        // #9a7a55

export class ResultPopup {
  private root: Node = null!;
  private drop: Node = null!;
  private rope: Node = null!;
  private cardShadow: Node = null!;
  private cardBg: Node = null!;
  private card: Node = null!;
  private openState = false;
  /** 滚动分数的定时器（关闭/重开时清掉，避免旧动画改新弹窗的数字） */
  private rollTimer = 0;
  /** 置灰按钮点击后的提示（Web result.ts:124 `toast(item.disabledHint)`），由挂接方注入 */
  private toastFn: ((msg: string) => void) | null = null;

  private constructor() { }

  static create(parent: Node): ResultPopup {
    const p = new ResultPopup();
    p.build(parent);
    return p;
  }

  /** 注入 toast（置灰按钮点击时弹 `disabledHint`；不注入则与 Web 一样只是不执行） */
  setToast(fn: (msg: string) => void): void {
    this.toastFn = fn;
  }

  private build(parent: Node): void {
    const root = new Node('ResultPopup');
    root.layer = Layers.Enum.UI_2D;
    root.addComponent(UITransform).setContentSize(STAGE_W, STAGE_H);
    root.parent = parent;
    root.setPosition(0, 0, 0);
    root.active = false;
    this.root = root;

    // 遮罩：rgba(20,12,4,.34)（Web `.result-preview` 的背景；点空白**不**关闭 —— Web 没挂事件）
    const mask = new Node('mask');
    mask.layer = Layers.Enum.UI_2D;
    mask.addComponent(UITransform).setContentSize(STAGE_W, STAGE_H);
    const mg = mask.addComponent(Graphics);
    mg.rect(-STAGE_W / 2, -STAGE_H / 2 - BLEED, STAGE_W, STAGE_H + BLEED * 2);   // 连窄长屏留边一起压暗
    mg.fillColor = C_MASK;
    mg.fill();
    mask.parent = root;

    // 吊落整体：麻绳 + 牌子一起下落（与 PLAY 同款 820 宽的一列）
    const drop = new Node('drop');
    drop.layer = Layers.Enum.UI_2D;
    drop.addComponent(UITransform).setContentSize(CARD_W, STAGE_H);
    drop.parent = root;
    this.drop = drop;

    // 麻绳：预烘九宫格贴图（12×64 片段），高度在 show() 里按牌高现算
    const rope = new Node('rope');
    rope.layer = Layers.Enum.UI_2D;
    rope.addComponent(UITransform).setContentSize(12, 64);
    const rs = rope.addComponent(Sprite);
    rs.sizeMode = Sprite.SizeMode.CUSTOM;
    rs.type = Sprite.Type.SLICED;
    setSprite(rs, 'fx/lp-rope');
    rope.parent = drop;
    this.rope = rope;

    // 吊牌外投影 `0 26px 64px rgba(60,40,10,.45)` → 预烘焙模糊贴图（九宫格，随牌高拉伸）
    const sh = new Node('cardShadow');
    sh.layer = Layers.Enum.UI_2D;
    sh.addComponent(UITransform).setContentSize(948, 843);
    const shs = sh.addComponent(Sprite);
    shs.sizeMode = Sprite.SizeMode.CUSTOM;
    shs.type = Sprite.Type.SLICED;
    setSprite(shs, 'fx/card-hang-shadow');
    sh.setPosition(0, CARD_LOCAL_Y - 13, 0);   // 贴图含 26 下移 → 中心比牌中心低 dy/2
    sh.parent = drop;
    this.cardShadow = sh;

    // 牌面：米色渐变 + 6px 金边 + 圆角 38 → 预烘焙九宫格贴图（一张适配任意牌高）。
    // ⚠️ 必须挂在 `drop` 上做**兄弟节点**、排在 `card` 之前：`show()` 每次都会清空 card
    //    的子节点，牌面若放进 card 会在第一次刷新时被一起销毁。
    const bg = new Node('cardBg');
    bg.layer = Layers.Enum.UI_2D;
    bg.addComponent(UITransform).setContentSize(CARD_W, 689);
    const bgs = bg.addComponent(Sprite);
    bgs.sizeMode = Sprite.SizeMode.CUSTOM;
    bgs.type = Sprite.Type.SLICED;
    setSprite(bgs, 'fx/card-hang');
    bg.setPosition(0, CARD_LOCAL_Y, 0);
    bg.parent = drop;
    this.cardBg = bg;

    const card = new Node('card');
    card.layer = Layers.Enum.UI_2D;
    card.addComponent(UITransform).setContentSize(CARD_W, 689);
    card.setPosition(0, CARD_LOCAL_Y, 0);
    card.on(Node.EventType.TOUCH_END, () => undefined); // 牌子上点不算关闭（Web 也没挂）
    card.parent = drop;
    this.card = card;
  }

  /* ---------------------------------------------------------------- 布局小件 */

  /**
   * 文本块：行盒高 = `lineHeight`（显式给的照 Web 抄）或 字号×1.30（normal）。
   * 节点按行盒高建、文字纵向居中（Cocos Label 默认在节点盒内居中）。
   */
  private textBlock(parent: Node, text: string, size: number, lineH: number, color: Color,
    w: number, opts?: { bold?: boolean; shadow?: { color: Color; dy: number } }): Label {
    const n = new Node('t');
    n.layer = Layers.Enum.UI_2D;
    n.addComponent(UITransform).setContentSize(w, lineH);
    const l = n.addComponent(Label);
    l.string = text;
    l.fontSize = size;
    l.lineHeight = lineH;
    l.color = color;
    if (opts?.bold !== false) {
      const b = l as unknown as { isBold?: boolean; enableBold?: boolean };
      b.isBold = true;
      b.enableBold = true;
    }
    if (opts?.shadow) {
      // ⚠️ 3.8.2 起走 Label 自带阴影属性（`LabelShadow` 组件已废弃）
      l.enableShadow = true;
      l.shadowColor = opts.shadow.color;
      l.shadowOffset = new Vec2(0, opts.shadow.dy);
    }
    applyUiText(l, text);
    n.parent = parent;
    return l;
  }

  /** 金描边大标题（84px，3px #F5C542）：shim 没有 LabelOutline，用八向错位文本近似 */
  private strokeTitle(parent: Node, text: string, size: number, y: number, w: number): Label[] {
    const labels: Label[] = [];
    for (const [dx, dy] of OUTLINE_DIRS(3)) {
      const l = this.textBlock(parent, text, size, Math.round(size * 1.12), C_STROKE, w);
      l.node.setPosition(dx, y + dy, 0);
      labels.push(l);
    }
    const main = this.textBlock(parent, text, size, Math.round(size * 1.12), C_INK, w,
      { shadow: { color: new Color(0, 0, 0, Math.round(0.12 * 255)), dy: -4 } });
    main.node.setPosition(0, y, 0);
    labels.push(main);
    return labels;
  }

  show(opts: ResultOptions): void {
    this.clearRoll();
    // 重绘：清空旧内容（保留 card 自身）
    for (const c of this.card.children.slice()) c.destroy();

    /* ---- 1) 先把各块的高度与间距算出来（block 流式 + margin 折叠取 max） ---- */
    interface Piece { h: number; mt: number; mb: number; place: (top: number, h: number) => void }
    const pieces: Piece[] = [];

    // 英雄区：三颗星（68px/颗 + gap 10）或 emoji 图标（150px）；两个都不传就整块不画
    if (opts.stars !== undefined || opts.icon !== undefined) {
      const heroH = opts.stars !== undefined ? 68 : 150;
      pieces.push({
        h: heroH, mt: 0, mb: 16,
        place: (top) => this.buildHero(opts, top, heroH),
      });
    }
    // 主标题 84px（行盒 94）margin 4/12。⚠️ cardY 依赖 show() 里算好的牌高，
    // 必须在 place 回调（摆内容阶段）里才算，不能在组 pieces 时就取值。
    pieces.push({ h: 94, mt: 4, mb: 12, place: (top) => { this.strokeTitle(this.card, opts.title, 84, this.cardY(top, 94), CONTENT_W); } });
    // 副文案 38px（行盒 49）margin 0/16
    if (opts.sub) {
      pieces.push({ h: 49, mt: 0, mb: 16, place: (top) => { this.textBlock(this.card, opts.sub!, 38, 49, C_INK, CONTENT_W).node.setPosition(0, this.cardY(top, 49), 0); } });
    }
    // 得分卡（不传 score 就不画）：边框 6 + padding 26/30 + 标签 47 + 分数 116(m 4+4) + 提示 44
    if (opts.score !== undefined) {
      const hasHint = !!opts.hint;
      const boxH = 6 + 26 + 30 + 47 + 124 + (hasHint ? 44 : 0);
      pieces.push({ h: boxH, mt: 8, mb: 22, place: (top) => this.buildScoreCard(opts, top, boxH) });
    }
    // 次要提示行 30px（行盒 39）margin 4/16
    if (opts.note) {
      pieces.push({ h: 39, mt: 4, mb: 16, place: (top) => { this.textBlock(this.card, opts.note!, 30, 39, C_NOTE, CONTENT_W).node.setPosition(0, this.cardY(top, 39), 0); } });
    }
    // 按钮行：高 98（放不下自动折行，行距 24）
    const rowsLayout = opts.rows.map((row) => this.layoutRow(row));
    for (const rl of rowsLayout) {
      pieces.push({ h: rl.h, mt: 8, mb: 0, place: (top) => this.placeRow(rl, top) });
    }

    let contentH = 0;
    let prevMb = 0;
    for (const p of pieces) {
      contentH += Math.max(prevMb, p.mt) + p.h;   // 相邻兄弟 margin 折叠：取 max
      prevMb = p.mb;
    }
    const cardH = PAD_TOP + contentH + PAD_BOT;

    /* ---- 2) 按牌高摆骨架（牌心恒在整屏 y=956，与 PLAY 一致） ---- */
    this.card.getComponent(UITransform)!.setContentSize(CARD_W, cardH);
    this.cardBg.getComponent(UITransform)!.setContentSize(CARD_W, cardH);
    this.cardShadow.getComponent(UITransform)!.setContentSize(948, cardH + 128 + 26);
    // 麻绳：顶到屏幕顶，底压进牌子上缘 8px（`964 − 牌高/2`；PLAY 689 → 619.5 ✓ 实测吻合）
    const ropeH = 964 - cardH / 2;
    this.rope.getComponent(UITransform)!.setContentSize(12, ropeH);
    this.rope.setPosition(0, STAGE_H / 2 - ropeH / 2, 0);

    /* ---- 3) 放内容 ---- */
    let cursor = 0;
    prevMb = 0;
    for (const p of pieces) {
      const top = cursor + Math.max(prevMb, p.mt);   // 相对内容区顶（y 向下）
      p.place(top, p.h);
      cursor = top + p.h;
      prevMb = p.mb;
    }

    /* ---- 4) ✕ 关闭 = 回主页（Web `.lp-close`，与 PLAY 同款 60×60 圆） ---- */
    this.buildClose(opts);

    this.openState = true;
    this.root.active = true;
    // 下落（照 CSS keyframes lp-drop .55s）：-170% → +6%（0.33s）→ 0（0.22s），opacity 0→1
    this.drop.setPosition(0, 1.7 * STAGE_H, 0);
    tween(this.drop).stop();
    const op = this.drop.getComponent(UIOpacity) ?? this.drop.addComponent(UIOpacity);
    op.opacity = 0;
    tween(op).stop();
    tween(this.drop)
      .to(0.33, { position: new Vec3(0, -0.06 * STAGE_H, 0) }, { easing: 'quadOut' })
      .to(0.22, { position: new Vec3(0, 0, 0) }, { easing: 'backOut' })
      .start();
    tween(op).to(0.2, { opacity: 255 }).start();
  }

  /** 「块顶（y 向下，相对内容区顶）」→「Cocos 节点 y（牌心为原点，y 向上）」 */
  private cardY(top: number, h: number): number {
    return this.card.getComponent(UITransform)!.contentSize.height / 2 - PAD_TOP - top - h / 2;
  }

  /* ---------------------------------------------------------------- 各块 */

  /** 英雄区：三颗星（点亮缩放弹入，与 Web `hero-star-in` 同手感）或 emoji 图标 */
  private buildHero(opts: ResultOptions, top: number, heroH: number): void {
    const y = this.cardY(top, heroH);
    if (opts.stars !== undefined) {
      const row = new Node('heroStars');
      row.layer = Layers.Enum.UI_2D;
      row.addComponent(UITransform).setContentSize(CONTENT_W, 68);
      row.setPosition(0, y, 0);
      row.parent = this.card;
      for (let i = 0; i < 3; i++) {
        const lit = i < opts.stars;
        const s = mkSprite(row, lit ? 'fx/hero-star-on' : 'fx/hero-star-off', 68, 68, (i - 1) * 78, 0);
        if (!lit) {
          // Web 未点亮 = `filter: grayscale(1) opacity(.28)`（灰度已烘进贴图，这里补透明度）
          (s.node.getComponent(UIOpacity) ?? s.node.addComponent(UIOpacity)).opacity = Math.round(0.28 * 255);
        } else {
          // `hero-star-in .38s`：scale .2 → 1 + 透明度 .2 → 1
          s.node.setScale(0.2, 0.2, 1);
          const op = s.node.getComponent(UIOpacity) ?? s.node.addComponent(UIOpacity);
          op.opacity = Math.round(0.2 * 255);
          tween(s.node).to(0.38, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start();
          tween(op).to(0.38, { opacity: 255 }).start();
        }
      }
    } else {
      // emoji 图标 150px + `drop-shadow(0 6px 14px rgba(180,120,30,.5))`
      this.textBlock(this.card, opts.icon ?? '', 150, 150, WHITE, CONTENT_W, {
        bold: false,
        shadow: { color: new Color(180, 120, 30, Math.round(0.5 * 255)), dy: -6 },
      }).node.setPosition(0, y, 0);
    }
  }

  /** 得分卡：696 宽九宫格切图 + 标签 / 滚动大数字 / 提示 */
  private buildScoreCard(opts: ResultOptions, top: number, boxH: number): void {
    const y = this.cardY(top, boxH);
    const box = new Node('scorebox');
    box.layer = Layers.Enum.UI_2D;
    box.addComponent(UITransform).setContentSize(CONTENT_W, boxH);
    box.setPosition(0, y, 0);
    const bs = box.addComponent(Sprite);
    bs.sizeMode = Sprite.SizeMode.CUSTOM;
    bs.type = Sprite.Type.SLICED;
    setSprite(bs, 'fx/card-score');
    box.parent = this.card;

    // 内容从卡顶往下：边框 3 + padding 26
    let t = 29;
    this.textBlock(box, opts.scoreLabel ?? '本关得分', 36, 47, C_LABEL, CONTENT_W - 48).node.setPosition(0, this.inBoxY(boxH, t, 47), 0);
    t += 47;
    // 大数字 116px 行盒 116 + margin 4/4，带 `0 4px 0 rgba(120,80,10,.25)` 阴影
    const value = this.textBlock(box, '0', 116, 116, C_VALUE, CONTENT_W - 48,
      { shadow: { color: new Color(120, 80, 10, Math.round(0.25 * 255)), dy: -4 } });
    value.node.setPosition(0, this.inBoxY(boxH, t + 4, 116), 0);
    t += 124;
    if (opts.hint) {
      this.textBlock(box, opts.hint, 34, 44, C_INK, CONTENT_W - 48).node.setPosition(0, this.inBoxY(boxH, t, 44), 0);
    }
    this.rollNumber(value, opts.score!);
  }

  /** 「盒内块顶」→ 盒内节点 y（盒心为原点） */
  private inBoxY(boxH: number, top: number, h: number): number {
    return boxH / 2 - 3 - top - h / 2;   // −3 = 边框
  }

  /* ---------------------------------------------------------------- 按钮行 */

  /**
   * 一行按钮的宽度与折行：Web `.rs-btn-row` flex + gap 24 + flex-wrap，
   * 按钮宽 = 118(固定消耗) + 文案宽。放不下就折行（行高 98、行距 24）。
   */
  private layoutRow(row: ResultButton[]): { lines: { items: ResultButton[]; ws: number[]; w: number }[]; h: number } {
    const lines: { items: ResultButton[]; ws: number[]; w: number }[] = [];
    let cur: { items: ResultButton[]; ws: number[]; w: number } = { items: [], ws: [], w: 0 };
    for (const item of row) {
      const w = BTN_FIX_W + estimateWidth(item.text, 40);
      const next = cur.items.length ? cur.w + BTN_GAP + w : w;
      if (cur.items.length && next > CONTENT_W) {
        lines.push(cur);
        cur = { items: [], ws: [], w: 0 };
      }
      cur.items.push(item);
      cur.ws.push(w);
      cur.w = cur.items.length === 1 ? w : cur.w + BTN_GAP + w;
    }
    if (cur.items.length) lines.push(cur);
    return { lines, h: lines.length * BTN_H + (lines.length - 1) * BTN_GAP };
  }

  private placeRow(rl: ReturnType<ResultPopup['layoutRow']>, top: number): void {
    const rowH = rl.h;
    let lineTop = top;
    for (const line of rl.lines) {
      const y = this.cardY(lineTop, BTN_H);
      let x = -line.w / 2;
      for (let i = 0; i < line.items.length; i++) {
        const item = line.items[i]!;
        const w = line.ws[i]!;
        const btn = new Node('btn');
        btn.layer = Layers.Enum.UI_2D;
        // 贴图本体 98 + 6px 硬下影（本体画在 canvas 顶部）→ 本体中心比贴图中心高 3：
        // 节点**下移** 3 本体中心才落在行中心，文字相对节点**上移** 3（与 tab-pill / btn-view 同一套，
        // 别写反 —— 反了按钮会整体偏高 6px）
        btn.addComponent(UITransform).setContentSize(w, BTN_H + 6);
        btn.setPosition(x + w / 2, y - 3, 0);
        // 胶囊按钮 → 九宫格切图：左右 48 是不拉伸的圆角区（Web `.rs-btn` / `.primary`）
        const bs = btn.addComponent(Sprite);
        bs.sizeMode = Sprite.SizeMode.CUSTOM;
        bs.type = Sprite.Type.SLICED;
        setSprite(bs, item.primary ? 'fx/rs-btn-primary' : 'fx/rs-btn');
        // 置灰：Web 是 `.rs-btn.dim { opacity: .5 }` —— 换的是透明度，不是换一套灰底
        if (item.dim) btn.addComponent(UIOpacity).opacity = Math.round(0.5 * 255);
        btn.parent = this.card;
        this.textBlock(btn, item.text, 40, 52, WHITE, w - 12).node.setPosition(0, 3, 0);
        btn.on(Node.EventType.TOUCH_END, () => {
          if (item.dim) {
            // 置灰仍可点：弹 disabledHint（Web result.ts:121-129）
            if (item.disabledHint) this.toastFn?.(item.disabledHint);
            return;
          }
          this.hide();
          item.onClick?.();
        });
        x += w + BTN_GAP;
      }
      lineTop += BTN_H + BTN_GAP;
    }
  }

  /** ✕：60×60 圆 #b06a3a + `0 3px 0 rgba(0,0,0,.25)`，牌内 top 22 / right 26（同 PLAY） */
  private buildClose(opts: ResultOptions): void {
    const cardH = this.card.getComponent(UITransform)!.contentSize.height;
    const x = CARD_W / 2 - 26 - CLOSE_SIZE / 2;
    const y = cardH / 2 - 22 - CLOSE_SIZE / 2;
    const n = new Node('closeBtn');
    n.layer = Layers.Enum.UI_2D;
    n.addComponent(UITransform).setContentSize(CLOSE_SIZE, CLOSE_SIZE + 3);
    n.setPosition(x, y - 1.5, 0);            // 本体中心比贴图中心高 1.5 → 节点下移 1.5
    mkSprite(n, 'fx/lp-close', CLOSE_SIZE, CLOSE_SIZE + 3);
    n.parent = this.card;
    this.textBlock(n, '✕', 34, 40, WHITE, CLOSE_SIZE, { bold: true }).node.setPosition(0, 1.5, 0);
    n.on(Node.EventType.TOUCH_END, () => {
      this.hide();
      opts.onHome?.();
    });
  }

  /* ---------------------------------------------------------------- 开/关 */

  hide(): void {
    if (!this.openState) return;
    this.openState = false;
    this.clearRoll();
    this.root.active = false;
  }

  get open(): boolean {
    return this.openState;
  }

  rootNode(): Node {
    return this.root;
  }

  destroy(): void {
    this.clearRoll();
    if (this.root?.isValid) this.root.destroy();
  }

  private clearRoll(): void {
    if (this.rollTimer) {
      clearTimeout(this.rollTimer as unknown as number);
      this.rollTimer = 0;
    }
  }

  /** 分数从 0 滚到目标值（分段 setTimeout，避免依赖 tween 的 onUpdate） */
  private rollNumber(label: Label, target: number): void {
    const steps = 24;
    let i = 0;
    const step = (): void => {
      i++;
      const t = Math.min(1, i / steps);
      const eased = 1 - Math.pow(1 - t, 3);
      if (label.node?.isValid) label.string = String(Math.round(target * eased));
      if (i < steps) this.rollTimer = setTimeout(step, ROLL_MS / steps) as unknown as number;
      else this.rollTimer = 0;
    };
    step();
  }
}

/* ------------------------------------------------------------------ 小工具 */

/** 八向错位，模拟 CSS `-webkit-text-stroke`（与 LevelPreview 同一套） */
function OUTLINE_DIRS(px: number): [number, number][] {
  const d = px;
  return [[0, d], [0, -d], [d, 0], [-d, 0], [d, d], [d, -d], [-d, d], [-d, -d]];
}

/**
 * 估算文本宽度（与 LevelPreview 同口径）：中日韩/全角 ≈ 1.0 em，拉丁与数字 ≈ 0.55 em，
 * 空格与窄标点 ≈ 0.28 em，emoji ≈ 1.4 em（照 `🔒 困难` 实测反推）。
 */
function estimateWidth(s: string, size: number): number {
  let w = 0;
  for (const ch of String(s)) {
    const c = ch.codePointAt(0) ?? 0;
    if (c >= 0x1f300 || (c >= 0x2600 && c <= 0x27bf)) w += size * 1.4;
    else if (c === 0x20) w += size * 0.28;
    else if (c > 0x2e80) w += size * 1.0;
    else if (c < 0x2000) w += size * 0.28;
    else w += size * 0.55;
  }
  return w;
}
