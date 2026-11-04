/**
 * 关卡详情 / 开始弹窗（PLAY UI，2026-10-31 按 Web 实测逐元素重做）
 *
 * 点地图节点后，一块带麻绳的牌子从屏幕上方「吊下来」—— 这是盖在地图之上的**浮层**
 * （不是「另一屏」），地图照旧在底下，关掉只是收起，地图不重建。
 *
 * 【数值来源】`docs/dump/web-preview.json`（`node tools/ui-dump.mjs --probe web-preview --click=".node"`，
 * 视口 1080×1886 让 `#stage` 正好等于 1080×1920；未经四舍五入的实测值直接抄在这里）：
 *   遮罩 rgba(20,12,4,.34)        牌宽 820 / 牌高 689 / 牌心 y=956（整屏居中，含 -8px 负边距）
 *   麻绳 12×619.5（贴着牌子上缘再压进 8px）   ✕ 60×60 @ 牌内右上 (top22,right26)
 *   关卡号 96px #6B4A2F + 3px #F5C542 描边，牌内 top=78
 *   难度钮 206×94 @ 牌心两侧 ∓115，row y 中心 874.5（牌内 top=216），gap 24
 *   星级 52px #6B4A2F（数字 60px #E8A100，分隔符 #C9A86a，两侧 margin 34）
 *   Play 378.52×138 @ 牌内 bottom=88，半径 69，渐变 #6BE36B→#37B84A
 *   下落：translateY -170% → 6% → 0，.55s cubic-bezier(.18,.9,.32,1.25)，opacity 0→1
 *
 * 【与 Web 的行为一致】点空白 / ✕ 关闭（牌子上点不算）；困难模式门槛 = 该关简单模式已 3 星，
 * 未达门槛 → 按钮置灰 + 🔒 + `disabled`，点了也不切；`open()` 时若当前是困难但没资格 → 退回简单。
 *
 * 【手段差异（视觉对齐、手段不同）】
 *   - 描边：shim 没有 `LabelOutline`（真引擎有），关卡号的 3px 金描边用**八向错位文本**近似；
 *   - 文字阴影：用 Label 自带阴影属性（3.8.2 起 `LabelShadow` 组件已废弃）；
 *   - CSS `letter-spacing:2px`（Play 文案）无法表达，字宽用估算值排布（见 `estimateWidth`）；
 *   - CSS keyframes 三段用两段 tween 近似（0.33s quadOut 到 +6%，再 0.22s backOut 回 0）。
 *
 * 【毛边根治（2026-11-02）】麻绳（6 条色带 + 三角化圆角）、✕（Graphics `circle()` 硬边圆）
 *   改预烘贴图 `fx/lp-rope` / `fx/lp-close`；全部文字套 HarmonyOS Sans SC（含 emoji 的
 *   文案走 `applyUiText` 自动还原系统字体）；⚠️ 顺手修了一处方向写反的老 bug：
 *   带硬下影的切图（Play 钮 dy=8、难度钮 dy=6）节点应**下移** dy/2、文字上移 dy/2
 *   （本体画在 canvas 顶部 → 本体中心比贴图中心高 dy/2；与 tab-pill 的 offY=-3 同一套），
 *   原来写成上移/下移，按钮整体偏高 8px/6px。
 */

import { Node, UITransform, Graphics, Label, Color, Layers, UIOpacity, Sprite, tween, Vec2, Vec3 } from 'cc';
import { mkFx, mkSprite, setSprite, BLEED } from './uiPaint';
import { applyUiFont, applyUiText } from './fontUtil';

export type LevelMode = 'normal' | 'nightmare';

export interface LevelPreviewHandlers {
  /** 取某关在某模式下的星线 [s1, s2, s3]（拿不到返回 undefined） */
  starLines: (level: number, mode: LevelMode) => readonly [number, number, number] | undefined;
  /** 用户在弹窗内切换难度 */
  onMode: (mode: LevelMode) => void;
  /** 该关能不能选困难（先简单 3 星）；false 时困难按钮置灰，点了也不切 */
  canNightmare: (level: number) => boolean;
  /** 关闭弹窗（点空白 / 关闭按钮） */
  onClose: () => void;
  /** 点 Play：以选中模式进入该关 */
  onPlay: (level: number, mode: LevelMode) => void;
}

const MODE_LABEL: Record<LevelMode, string> = { normal: '简单', nightmare: '困难' };

/* ---------------- 实测常量（1080×1920 逻辑坐标，y 向下 / Cocos 节点 y 向上） ---------------- */

const STAGE_W = 1080;
const STAGE_H = 1920;
/** 牌子外框（含 6px 边框） */
const CARD_W = 820;
const CARD_H = 689;
/** 牌子中心在**整屏**里的 y（向下坐标）= 956 → Cocos 里 y 向上 */
const CARD_CENTER_Y_SCREEN = 956;
const CARD_LOCAL_Y = STAGE_H / 2 - CARD_CENTER_Y_SCREEN;   // = +4
/** 麻绳：宽 12，从屏幕顶垂到牌子上缘并压进 8px（Web `.lp-card` 的 margin-top: -8px） */
const ROPE_W = 12;
const ROPE_H = 619.5;
/** 牌子的内容区宽度 = 820 − 2×6 边框 − 2×56 padding = 696（实测 `.lp-level` / `.lp-stars` 的宽） */
const CONTENT_W = 696;
/** ✕：60×60，牌内边距 top 22 / right 26（= CSS 16/20 + 6px 边框） */
const CLOSE_SIZE = 60;
/** 关卡号：96px，牌内 top 78（= padding 72 + 6px 边框），行高 96（line-height:1） */
const LEVEL_FS = 96;
/** 难度钮：`padding:18px 60px` + `border:3px` → 横向固定消耗 126px（60+60+3+3），剩下的是文案宽度 */
const MODE_PAD_W = 126;
const MODE_W = 206;              // 「简单 / 困难」两个字时的实测宽（40px 字 → 文案 80）
const MODE_H = 94;
const MODE_GAP = 24;
/** 难度行中心在牌内的 y（牌内 top 216，行高 94） */
const MODE_ROW_Y = CARD_H / 2 - 216 - MODE_H / 2;
/** 星级行：52px，数字 60px，牌内 row top 338，行盒高 79（实测，含 60px 数字的行高） */
const STAR_ROW_H = 79;
const STAR_ROW_TOP = 338;
const STAR_FS = 52;
const STAR_NUM_FS = 60;
const STAR_SEP_MARGIN = 34;
/** Play：378.52×138，牌内 bottom 88（= padding 82 + 6px 边框） */
const PLAY_W = 378.52;
const PLAY_H = 138;
const PLAY_FS = 62;

/* 颜色（全部取自 Web computed style） */
const C_MASK = new Color(20, 12, 4, Math.round(0.34 * 255));       // rgba(20,12,4,.34)
const C_CARD_TOP = new Color(255, 248, 231, 255);                   // #FFF8E7
const C_CARD_BOT = new Color(253, 236, 203, 255);                   // #fdeccb
const C_CARD_BORDER = new Color(245, 197, 66, 255);                 // #F5C542
const C_CARD_SHADOW = new Color(60, 40, 10, Math.round(0.45 * 255));// 0 26px 64px rgba(60,40,10,.45)
const C_ROPE_A = new Color(122, 79, 41, 255);                       // #7a4f29（左右两侧）
const C_ROPE_B = new Color(201, 138, 79, 255);                      // #c98a4f（45% 处）
const C_CLOSE_BG = new Color(176, 106, 58, 255);                    // #b06a3a
const C_LEVEL = new Color(107, 74, 47, 255);                        // #6B4A2F
const C_LEVEL_STROKE = new Color(245, 197, 66, 255);                // #F5C542（3px 描边）
const C_MODE_OFF = new Color(90, 90, 90, 255);                      // #5A5A5A
const C_MODE_ON = new Color(255, 107, 53, 255);                     // #FF6B35
const C_MODE_LOCK_BG = new Color(74, 74, 74, 255);                  // #4A4A4A
const C_MODE_LOCK_TEXT = new Color(216, 216, 216, 255);             // #d8d8d8
const C_MODE_BORDER = new Color(217, 162, 39, 255);                 // #D9A227
const C_MODE_LOCK_BORDER = new Color(138, 138, 138, 255);           // #8a8a8a
const C_STAR_TEXT = new Color(107, 74, 47, 255);                    // #6B4A2F
const C_STAR_NUM = new Color(232, 161, 0, 255);                     // #E8A100
const C_STAR_SEP = new Color(201, 168, 106, 255);                   // #C9A86a
const C_PLAY_TOP = new Color(107, 227, 107, 255);                   // #6BE36B
const C_PLAY_BOT = new Color(55, 184, 74, 255);                     // #37B84A
const C_PLAY_SHADOW = new Color(20, 120, 40, Math.round(0.5 * 255));// 0 8px 0 rgba(20,120,40,.5)
const C_WHITE = new Color(255, 255, 255, 255);
const C_DARK25 = new Color(0, 0, 0, Math.round(0.25 * 255));
const C_DARK22 = new Color(0, 0, 0, Math.round(0.22 * 255));

export class LevelPreview {
  private root: Node = null!;
  private drop: Node = null!;
  private dropOpacity: UIOpacity = null!;
  private levelLabels: Label[] = [];
  private starParts: { node: Node; label: Label; kind: 'text' | 'num' | 'sep' }[] = [];
  private modeNodes: Record<LevelMode, Node> = null!;
  private modeLabels: Record<LevelMode, Label> = null!;
  private h: LevelPreviewHandlers;
  private level = 0;
  private curMode: LevelMode = 'normal';
  private openState = false;

  private constructor(handlers: LevelPreviewHandlers) {
    this.h = handlers;
  }

  static create(parent: Node, handlers: LevelPreviewHandlers): LevelPreview {
    const p = new LevelPreview(handlers);
    p.build(parent);
    return p;
  }

  /* ---------------------------------------------------------------- 搭 */

  private build(parent: Node): void {
    const root = new Node('LevelPreview');
    root.layer = Layers.Enum.UI_2D;
    root.addComponent(UITransform).setContentSize(STAGE_W, STAGE_H);
    root.parent = parent;
    root.setPosition(0, 0, 0);
    root.active = false;
    this.root = root;

    // 遮罩：rgba(20,12,4,.34)，点它 = 关闭（牌子上点不算）
    const mask = new Node('mask');
    mask.layer = Layers.Enum.UI_2D;
    mask.addComponent(UITransform).setContentSize(STAGE_W, STAGE_H);
    const mg = mask.addComponent(Graphics);
    mg.rect(-STAGE_W / 2, -STAGE_H / 2 - BLEED, STAGE_W, STAGE_H + BLEED * 2);   // 连窄长屏留边一起压暗
    mg.fillColor = C_MASK;
    mg.fill();
    mask.parent = root;
    mask.on(Node.EventType.TOUCH_END, () => this.close());

    // 吊落整体：麻绳 + 牌子一起下落（宽 820 的那一列）
    const drop = new Node('drop');
    drop.layer = Layers.Enum.UI_2D;
    drop.addComponent(UITransform).setContentSize(CARD_W, STAGE_H);
    drop.parent = root;
    this.drop = drop;
    this.dropOpacity = drop.addComponent(UIOpacity);

    this.buildRope(drop);
    const card = this.buildCard(drop);
    this.buildClose(card);
    this.buildLevelNumber(card);
    this.buildModes(card);
    this.buildStars(card);
    this.buildPlay(card);
  }

  /**
   * 麻绳：12px 宽的竖线，横向渐变 #7a4f29 → #c98a4f(45%) → #7a4f29，圆角 6，
   * `inset 0 0 0 1px rgba(0,0,0,.18)`。
   * ⚠️ 原来用 Graphics：渐变拆 6 条色带（12px 宽里塞 6 条 2px 台阶）+ 三角化圆角 → 毛边。
   *    改预烘贴图 `fx/lp-rope`（12×64 片段，九宫格 [8,8,6,6]：上下是圆角端头、中间是
   *    带内描边的直边，纵向拉伸不变形 —— 结算吊牌的绳子更高，同一张贴图直接复用）。
   */
  private buildRope(drop: Node): void {
    const rope = new Node('rope');
    rope.layer = Layers.Enum.UI_2D;
    rope.addComponent(UITransform).setContentSize(ROPE_W, ROPE_H);
    // 顶到屏幕顶（y=+960），底到牌子上缘再压进 8px
    rope.setPosition(0, STAGE_H / 2 - ROPE_H / 2, 0);
    const s = rope.addComponent(Sprite);
    s.sizeMode = Sprite.SizeMode.CUSTOM;
    s.type = Sprite.Type.SLICED;
    setSprite(s, 'fx/lp-rope');
    rope.parent = drop;
  }

  /**
   * 牌子：820×689，米色渐变 + 6px #F5C542 边框 + 半径 38 + `0 26px 64px` 阴影。
   * ⚠️ 牌面与阴影都改**预烘焙贴图**：原来用 24 条色带近似渐变、5 层同心圆角矩形近似模糊，
   *    前者是横向条带、后者是同心台阶，加上圆角三角化硬边 —— 正是「材质不一样 + 毛边」的来源。
   */
  private buildCard(drop: Node): Node {
    // 外投影贴图 948x843（= 820x689 + 2*64，再留 26 的下移），中心比牌中心低 13（dy/2）
    mkFx(drop, 'cardShadow', 'fx/shadow-card-lp', 948, 843, 0, CARD_LOCAL_Y - 13);

    const card = new Node('card');
    card.layer = Layers.Enum.UI_2D;
    card.addComponent(UITransform).setContentSize(CARD_W, CARD_H);
    card.setPosition(0, CARD_LOCAL_Y, 0);
    mkSprite(card, 'fx/card-lp', CARD_W, CARD_H);
    card.parent = drop;
    // 牌子上点不算关闭：吃掉事件
    card.on(Node.EventType.TOUCH_END, () => undefined);
    return card;
  }

  /** ✕：60×60 圆 #b06a3a + `0 3px 0 rgba(0,0,0,.25)`，牌内 top 22 / right 26。
   *  ⚠️ 原来是 Graphics `circle()`（三角化多边形 = 硬边圆）→ 预烘贴图 `fx/lp-close`
   *     （60×63：本体 60 画在顶部、下方 3 是硬投影）→ 节点下移 1.5、✕ 上移 1.5。 */
  private buildClose(card: Node): void {
    const x = CARD_W / 2 - 26 - CLOSE_SIZE / 2;                        // 牌内右边距 26
    const y = CARD_H / 2 - 22 - CLOSE_SIZE / 2;                        // 牌内上边距 22
    const n = new Node('closeBtn');
    n.layer = Layers.Enum.UI_2D;
    n.addComponent(UITransform).setContentSize(CLOSE_SIZE, CLOSE_SIZE + 3);
    n.setPosition(x, y - 1.5, 0);            // 本体中心比贴图中心高 1.5 → 节点下移 1.5
    mkSprite(n, 'fx/lp-close', CLOSE_SIZE, CLOSE_SIZE + 3);
    n.parent = card;
    mkLabel(n, '✕', 34, 0, 1.5, C_WHITE, CLOSE_SIZE, true);
    n.on(Node.EventType.TOUCH_END, () => this.close());
  }

  /**
   * 关卡号：96px/800 #6B4A2F，牌内 top 78。
   * 金描边 3px #F5C542 —— shim 没有 LabelOutline，用**八向错位**的同字文本垫在下面近似。
   */
  private buildLevelNumber(card: Node): void {
    const y = CARD_H / 2 - 78 - LEVEL_FS / 2;
    for (const [dx, dy] of OUTLINE_DIRS(3)) {
      this.levelLabels.push(mkLabel(card, '', LEVEL_FS, dx, y + dy, C_LEVEL_STROKE, CONTENT_W, true));
    }
    this.levelLabels.push(mkLabel(card, '', LEVEL_FS, 0, y, C_LEVEL, CONTENT_W, true));
    const main = this.levelLabels[this.levelLabels.length - 1];
    // 全项目 UI 字体统一 HarmonyOS Sans SC（「第 N 关」无 emoji，可以直接套）
    for (const l of this.levelLabels) applyUiFont(l);
    // ⚠️ 3.8.2 起走 Label 自带的阴影属性（`LabelShadow` 的 color/offset 已废弃）
    main.enableShadow = true;
    main.shadowColor = new Color(0, 0, 0, Math.round(0.12 * 255));   // 0 4px 0 rgba(0,0,0,.12)
    main.shadowOffset = new Vec2(0, -4);
  }

  /**
   * 难度行：两个胶囊（40px 字），间距 24，牌内 top 216。
   * ⚠️ 宽度是**随文案变的**：Web 的按钮是 `padding:18px 60px` 撑开的，未锁时都是 206×94；
   * 但「🔒 困难」（有 emoji）会撑到 **272.84**，整行重新居中 —— 所以宽度与位置要在 `syncModes` 里重算。
   */
  private buildModes(card: Node): void {
    this.modeNodes = {} as Record<LevelMode, Node>;
    this.modeLabels = {} as Record<LevelMode, Label>;
    for (const m of ['normal', 'nightmare'] as LevelMode[]) {
      const n = new Node('mode-' + m);
      n.layer = Layers.Enum.UI_2D;
      n.addComponent(UITransform).setContentSize(MODE_W, MODE_H);
      n.setPosition(0, MODE_ROW_Y, 0);
      // ⚠️ 不要在这个节点上挂 Graphics（哪怕空的）：实测构建包里同节点挂着 Graphics 时
      //    Sprite 不渲染 —— 胶囊底图（fx/mode-on/off/lock）全部消失，只剩文字裸在牌面上。
      //    胶囊已改九宫格切图（见 syncModes），程序绘制不再需要，这里干脆不加。
      n.parent = card;
      this.modeLabels[m] = mkLabel(n, MODE_LABEL[m], 40, 0, 0, C_WHITE, MODE_W - 12, true);
      applyUiFont(this.modeLabels[m]);
      n.on(Node.EventType.TOUCH_END, () => this.pick(m));
      this.modeNodes[m] = n;
    }
  }

  /**
   * 星级行：`1星 <b>1</b> 分 | 3星 <b>5</b> 分`，52px / 数字 60px 金色、分隔符灰色 margin 34。
   * Cocos 没有富文本行内混排，所以按估算字宽把片段排成一行（整体居中）。
   */
  private buildStars(card: Node): void {
    const rowY = CARD_H / 2 - STAR_ROW_TOP - STAR_ROW_H / 2;
    const row = new Node('stars');
    row.layer = Layers.Enum.UI_2D;
    row.addComponent(UITransform).setContentSize(CONTENT_W, STAR_ROW_H);
    row.setPosition(0, rowY, 0);
    row.parent = card;
    this.starParts = [];
    // 片段：文本用 52px、数字用 60px 金色
    const specs: { text: string; kind: 'text' | 'num' | 'sep'; color: Color; size: number }[] = [
      { text: '1星 ', kind: 'text', color: C_STAR_TEXT, size: STAR_FS },
      { text: '', kind: 'num', color: C_STAR_NUM, size: STAR_NUM_FS },
      { text: ' 分', kind: 'text', color: C_STAR_TEXT, size: STAR_FS },
      { text: '|', kind: 'sep', color: C_STAR_SEP, size: STAR_FS },
      { text: '3星 ', kind: 'text', color: C_STAR_TEXT, size: STAR_FS },
      { text: '', kind: 'num', color: C_STAR_NUM, size: STAR_NUM_FS },
      { text: ' 分', kind: 'text', color: C_STAR_TEXT, size: STAR_FS },
    ];
    for (const s of specs) {
      const part = mkLabel(row, s.text, s.size, 0, 0, s.color, s.size * 6, false);
      applyUiFont(part);
      this.starParts.push({ node: part.node, label: part, kind: s.kind });
    }
  }

  /** Play：378.52×138 胶囊，牌内 bottom 88，渐变 #6BE36B→#37B84A + 0 8px 0 阴影 */
  private buildPlay(card: Node): void {
    const y = -CARD_H / 2 + 88 + PLAY_H / 2;
    const n = new Node('play');
    n.layer = Layers.Enum.UI_2D;
    // 贴图 378x146：多出的 8px 是 Web `0 8px 0 rgba(20,120,40,.5)` 的硬边下影
    //（本体画在 canvas 顶部）→ 本体中心比贴图中心高 4：节点**下移** 4 本体中心才落在 y，
    // 文字相对节点**上移** 4（与 tab-pill / btn-view 同一套，反了按钮会整体偏高 8px）
    n.addComponent(UITransform).setContentSize(PLAY_W, PLAY_H + 8);
    n.setPosition(0, y - 4, 0);
    // 胶囊按钮 → 九宫格切图（左右各 69 是唯一不拉伸的圆角区），渐变不再拆条带
    const bs = n.addComponent(Sprite);
    bs.sizeMode = Sprite.SizeMode.CUSTOM;
    bs.type = Sprite.Type.SLICED;
    setSprite(bs, 'fx/btn-play');
    n.parent = card;
    const playLabel = mkLabel(n, 'Play', PLAY_FS, 0, 4, C_WHITE, PLAY_W, true);
    applyUiFont(playLabel);
    n.on(Node.EventType.TOUCH_END, () => {
      if (!this.openState) return;
      this.h.onPlay(this.level, this.curMode);
    });
  }

  /* ---------------------------------------------------------------- 状态刷新 */

  private pick(m: LevelMode): void {
    if (m === this.curMode) return;
    if (m === 'nightmare' && !this.h.canNightmare(this.level)) return;   // 门槛
    this.curMode = m;
    this.syncModes();
    this.renderStars();
    this.h.onMode(m);
  }

  /** 重画难度钮（含宽度 / 位置重排）：选中 #FF6B35 / 未选 #5A5A5A / 未达门槛 #4A4A4A + 🔒 */
  private syncModes(): void {
    const canHard = this.h.canNightmare(this.level);
    const locked = !canHard;
    const widths: Record<LevelMode, number> = {
      normal: MODE_PAD_W + modeTextWidth(MODE_LABEL.normal),
      nightmare: MODE_PAD_W + modeTextWidth(locked ? `🔒 ${MODE_LABEL.nightmare}` : MODE_LABEL.nightmare),
    };
    const total = widths.normal + MODE_GAP + widths.nightmare;
    const xs: Record<LevelMode, number> = {
      normal: -total / 2 + widths.normal / 2,
      nightmare: total / 2 - widths.nightmare / 2,
    };
    for (const m of ['normal', 'nightmare'] as LevelMode[]) {
      const n = this.modeNodes[m];
      const w = widths[m];
      // 贴图 206x100（多出 6px 是 `0 6px 0` 的硬边下影，本体画在 canvas 顶部）
      // → 本体中心比贴图中心高 3：节点**下移** 3、文字相对节点**上移** 3
      n.getComponent(UITransform)!.setContentSize(w, MODE_H + 6);
      n.setPosition(xs[m], MODE_ROW_Y - 3, 0);
      this.modeLabels[m].node.getComponent(UITransform)!.setContentSize(w - 12, MODE_H);
      this.modeLabels[m].node.setPosition(0, 3, 0);
      const isLocked = m === 'nightmare' && locked;
      const on = m === this.curMode;
      // 胶囊（Web `.lp-mode`）→ 九宫格切图：未选 #5A5A5A / 选中 #FF6B35 / 门槛未达 #4A4A4A（无下影）
      //    ⚠️ 原来三种状态都是 Graphics 硬画，圆角三角化 + 下影是纯色矩形（Web 是 0 6px 0 的硬边，勉强算对）
      const ms = n.getComponent(Sprite) ?? n.addComponent(Sprite);
      ms.sizeMode = Sprite.SizeMode.CUSTOM;
      ms.type = Sprite.Type.SLICED;
      setSprite(ms, isLocked ? 'fx/mode-lock' : on ? 'fx/mode-on' : 'fx/mode-off');
      // ⚠️ 锁定态文案带 🔒 —— 走 applyUiText：含 emoji 时自动把字体还原成系统默认
      //    （HarmonyOS Sans 是纯中文字体，不含 emoji 字形，硬套会变豆腐块）
      applyUiText(this.modeLabels[m], isLocked ? `🔒 ${MODE_LABEL[m]}` : MODE_LABEL[m]);
      this.modeLabels[m].color = isLocked ? C_MODE_LOCK_TEXT : C_WHITE;
      const op = n.getComponent(UIOpacity) ?? n.addComponent(UIOpacity);
      op.opacity = isLocked ? Math.round(0.85 * 255) : 255;
    }
  }

  /** 星级：按估算字宽重排一行，整体居中 */
  private renderStars(): void {
    const line = this.h.starLines(this.level, this.curMode);
    if (!line) {
      for (const p of this.starParts) p.label.string = '';
      return;
    }
    const values = [String(line[0]), String(line[2])];
    let vi = 0;
    for (const p of this.starParts) if (p.kind === 'num') p.label.string = values[vi++] ?? '';
    // 先量：各片段宽度 + 分隔符两侧 34px margin
    let total = 0;
    for (const p of this.starParts) {
      let w = estimateWidth(p.label.string, p.label.fontSize);
      if (p.kind === 'sep') w += STAR_SEP_MARGIN * 2;
      total += w;
    }
    let x = -total / 2;
    for (const p of this.starParts) {
      let w = estimateWidth(p.label.string, p.label.fontSize);
      if (p.kind === 'sep') {
        x += STAR_SEP_MARGIN;
        p.node.setPosition(x + w / 2, 0, 0);
        x += w + STAR_SEP_MARGIN;
      } else {
        p.node.setPosition(x + w / 2, 0, 0);
        x += w;
      }
    }
  }

  /* ---------------------------------------------------------------- 开/关 */

  open(level: number, currentMode: LevelMode): void {
    this.level = level;
    // 当前是困难但这一关其实没达门槛（存档被改过等边界情况）→ 退回简单，不给进
    this.curMode = currentMode === 'nightmare' && !this.h.canNightmare(level) ? 'normal' : currentMode;
    for (const l of this.levelLabels) l.string = `第 ${level} 关`;
    this.syncModes();
    this.renderStars();

    this.openState = true;
    this.root.active = true;
    // 下落（照 CSS keyframes）：-170% → +6%（0.33s）→ 0（0.22s），opacity 0→1
    this.drop.setPosition(0, 1.7 * STAGE_H, 0);   // translateY(-170%)：Cocos 里向上为正 → +1.7×1920
    this.dropOpacity.opacity = 0;
    tween(this.drop).stop();
    tween(this.dropOpacity).stop();
    tween(this.drop)
      .to(0.33, { position: new Vec3(0, -0.06 * STAGE_H, 0) }, { easing: 'quadOut' })
      .to(0.22, { position: new Vec3(0, 0, 0) }, { easing: 'backOut' })
      .start();
    tween(this.dropOpacity).to(0.2, { opacity: 255 }).start();
  }

  close(): void {
    if (!this.openState) return;
    this.openState = false;
    this.root.active = false;
    this.h.onClose();
  }

  isOpen(): boolean {
    return this.openState;
  }

  /** 根节点（挂接方用来提到最上层 / 调整层级） */
  rootNode(): Node {
    return this.root;
  }

  destroy(): void {
    if (this.root?.isValid) this.root.destroy();
  }
}

/* ------------------------------------------------------------------ 小工具 */

/** 八向错位，模拟 CSS `-webkit-text-stroke` */
function OUTLINE_DIRS(px: number): [number, number][] {
  const d = px;
  return [[0, d], [0, -d], [d, 0], [-d, 0], [d, d], [d, -d], [-d, d], [-d, -d]];
}

function lerpColor(a: Color, b: Color, t: number): Color {
  return new Color(
    Math.round(a.r + (b.r - a.r) * t),
    Math.round(a.g + (b.g - a.g) * t),
    Math.round(a.b + (b.b - a.b) * t),
    Math.round(a.a + (b.a - a.a) * t),
  );
}

/**
 * 估算文本宽度（Cocos Label 拿不到排版后的实际宽度，shim 更没有 `overflow=NONE` 自适应）。
 * 口径：中日韩 / 全角 ≈ 1.0 em，拉丁字母与数字 ≈ 0.55 em，空格与窄标点 ≈ 0.28 em，
 *      emoji（0x1F300 起 / 杂项符号）≈ **1.4 em** —— 这条是照 `🔒 困难` 实测反推的
 *      （Web 实测该按钮 272.84 宽 → 文案部分 146.84 ≈ 80 + 空格 10 + emoji 57）。
 */
function estimateWidth(s: string, size: number): number {
  let w = 0;
  for (const ch of String(s)) {
    const c = ch.codePointAt(0) ?? 0;
    if (c >= 0x1f300 || (c >= 0x2600 && c <= 0x27bf)) w += size * 1.4;   // emoji
    else if (c === 0x20) w += size * 0.28;
    else if (c > 0x2e80) w += size * 1.0;                                // 中日韩 / 全角
    else if (c < 0x2000) w += size * 0.28;
    else w += size * 0.55;
  }
  return w;
}

/** 难度钮文案宽度（40px 字） */
function modeTextWidth(text: string): number {
  return estimateWidth(text, 40);
}

function mkLabel(parent: Node, text: string, size: number, x: number, y: number, color: Color, w: number, bold: boolean): Label {
  const n = new Node('t');
  n.layer = Layers.Enum.UI_2D;
  n.addComponent(UITransform).setContentSize(w, size + 16);
  const l = n.addComponent(Label);
  l.string = text;
  l.fontSize = size;
  l.lineHeight = size + 8;
  l.color = color;
  if (bold) {
    const b = l as unknown as { isBold?: boolean; enableBold?: boolean };
    b.isBold = true;
    b.enableBold = true;
  }
  n.parent = parent;
  n.setPosition(x, y, 0);
  return l;
}
