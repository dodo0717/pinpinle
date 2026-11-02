/**
 * 新手教学（序章）模块（从 web/ui/tutorial.ts 移植，2026-10-30）
 *
 * 方案见 `docs/新手教学（序章）策划案.md`。这里提供四样东西，流程编排在 GameBootstrap：
 *   1. `tutorialConfig(mode)` —— 序章的关卡配置（**不走** `buildLevelConfigs()` 的随机图池）；
 *   2. `buildTutorialLayout()` —— 序章开局「3 缺 1」盘面（核心侧 `buildTutorialGrid`）；
 *   3. `TutorialDrawer` —— 首页右侧抽屉（怎么玩图解 + 重玩序章）；
 *   4. `TutorialBanner` —— 棋盘上方轻横幅（达成 1★/2★ 时 2 秒淡出，**非弹窗**）。
 *
 * ⚠️ 为什么不把序章做成「第 1 关」：180 关的编号牵动图鉴解锁（第 1~108 关逐关给图）、
 * 星线、解锁链与存档格数校验；序章是**独立关卡（level 0）**，不进这些系统。
 */

import {
  Node, Label, UITransform, Graphics, Color, Layers, UIOpacity, tween,
  Sprite, SpriteFrame, Texture2D, resources, Rect, Vec2, Vec3,
} from 'cc';
import {
  TIME_LIMIT,
  buildInitialGrid,
  buildTutorialGrid,
  type GameMode,
  type LevelConfig,
  type Grid,
  type TutorialSwapRule,
  type Rng,
} from '../核心/index';
import { TUTORIAL, TUTORIAL_VOICE } from './text';
import { mkSprite, setSprite } from '../界面/uiPaint';

/* ------------------------------------------------------------------ 序章配置 */

/**
 * 序章固定的 6 张图 = 6 只动物各 1 张「开心」（台账 ledger.ts）：
 * 猫 0、虎 6、兔 7、仓鼠 8、狗 9、熊 10。
 * 教学关要把辨识难度压到最低（ma = 1），玩家只要认脸，不用分辨同一只动物的不同表情。
 *
 * ⚠️ 图数**必须等于** `imagesPerLevel(12) = 6`：引擎初始化（assignPools）会按
 * 「图数 = (格数 − 8) ÷ 2 + 4」校验，给 3 张会直接抛错。所以序章是 6 张图 × 4 块 = 24 块的池，
 * 场上 12 块从中随机取 —— 教学第一步因此用引擎自己的「可拼提示」圈块。
 */
export const TUTORIAL_IMAGE_IDS: readonly number[] = [0, 6, 7, 8, 9, 10];

/**
 * 序章星线：三条都取 3。
 * ⚠️ 用户口径（v4.1）：**旗子旁的数字 = 过关分数**。序章过关条件就是「拼够 3 组」，
 * 所以 star1 也必须是 3 —— 否则「旗子写 1 分过关、却要拼到 3 组才结束」自相矛盾。
 * 三条线一致也不污染系统：序章**不写 progress、不进排行榜、不进图鉴星数**。
 */
export const TUTORIAL_STARS: readonly [number, number, number] = [3, 3, 3];

/** 序章种子固定：同一套盘面可复现，教学步骤才有确定的「第一步」 */
export const TUTORIAL_SEED = 20261026;

/** 序章关卡号（不是 1~180 里的任何一关） */
export const TUTORIAL_LEVEL = 0;

/** 序章关卡配置（手工构造，不走 buildLevelConfigs() —— 图池必须固定） */
export function tutorialConfig(mode: GameMode): LevelConfig {
  return {
    level: TUTORIAL_LEVEL,
    rows: 4,
    cols: 3,
    imageIds: TUTORIAL_IMAGE_IDS.slice(),
    timeLimit: TIME_LIMIT,
    star1: TUTORIAL_STARS[0],
    star2: TUTORIAL_STARS[1],
    star3: TUTORIAL_STARS[2],
    swapRule: mode === 'nightmare' ? 'adjacent' : 'any',
  };
}

/* ------------------------------------------------------------------ 「3 缺 1」盘面 */

export interface TutorialLayoutInfo {
  grid: Grid;
  /**
   * 玩家唯一能拖的那块（缺的那块）。
   * ⚠️ **不挨着缺口**（用户要求 v4.1）：简单关摆在最远处（一次远距拖动到位），
   * 困难关摆在最少 2 步处（一次挪一格，走两步才到）。
   */
  targetIndex: number;
  /** 缺口：拖到这里就拼成（简单一步到位，困难要走几步） */
  gapIndex: number;
  /** 已拼好的 3 块：找路时绕开，别让玩家把它们拖散 */
  fixed: number[];
}

/**
 * 序章开局盘面：优先手工摆出「3 缺 1」（核心侧 buildTutorialGrid）。
 * 摆不出来（图数/网格不合规、校验不过）就退回随机盘面 —— 这时 layout 为 null，
 * 教学**降级为不锁定输入**（宁可不强制，也不能把玩家卡死）。
 */
export function buildTutorialLayout(
  rows: number,
  cols: number,
  imageIds: readonly number[],
  rng: Rng,
  rule: TutorialSwapRule,
): { grid: Grid; layout: TutorialLayoutInfo | null } {
  const manual = buildTutorialGrid(rows, cols, imageIds, rng, rule);
  if (manual) {
    return {
      grid: manual.grid,
      layout: {
        grid: manual.grid,
        targetIndex: manual.targetIndex,
        gapIndex: manual.gapIndex,
        fixed: manual.fixed,
      },
    };
  }
  return { grid: buildInitialGrid(rows, cols, imageIds, rng), layout: null };
}

/** hsl → Color（图解色块兜底用，与 Web 版 `hsl(h s% l%)` 同一公式） */
function hslColor(h: number, s: number, l: number): Color {
  const sn = s / 100;
  const ln = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sn * Math.min(ln, 1 - ln);
  const f = (n: number) => ln - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return new Color(Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255), 255);
}

/* ------------------------------------------------------------------ 横幅（棋盘上方轻提示） */

/* ↓↓↓ 横幅参数逐条对齐 web/ui.css 的 `.tut-banner`（just 照抄，别凭感觉） ↓↓↓ */
/** `font-size: 42px; line-height: 1.35` */
const BANNER_FONT = 42;
const BANNER_LINE = 57;
/** `color: #ffe9b8` */
const BANNER_TEXT = new Color(255, 233, 184, 255);
/** `background: rgba(40,22,0,.82)` */
const BANNER_BG = new Color(40, 22, 0, 209);
/** `padding: 22px 44px` */
const BANNER_PAD_V = 22;
const BANNER_PAD_H = 44;
/** `max-width: 88%` —— 设计宽 1080 的 88% */
const BANNER_MAX_W = 950;
/** 入场位移：Web `transform: translate(-50%, -12px)` → `translate(-50%, 0)` */
const BANNER_RISE = 12;
/* ↑↑↑ 常量区结束 ↑↑↑ */

/**
 * 棋盘上方的轻横幅。不用 toast：toast 是全局的、会被其它提示顶掉；
 * 教学提示要钉在棋盘上方，玩家视线不用离开盘面。
 *
 * ⚠️ 一眼看上去像"反过来"了：Web 版的横幅是**深棕底 + 浅黄字**（压在意面/u盘上一眼可辨），
 *    不是米白底 —— 早期移植版画反了，这里按 CSS 还原。
 */
export class TutorialBanner {
  private root: Node = null!;
  private bg: Node = null!;
  private textNode: Node = null!;
  private label: Label = null!;
  private baseX = 0;
  private baseY = 0;
  private timer = 0;

  static create(parent: Node): TutorialBanner {
    const b = new TutorialBanner();
    b.build(parent);
    return b;
  }

  private build(parent: Node): void {
    const root = new Node('TutorialBanner');
    root.layer = Layers.Enum.UI_2D;
    root.addComponent(UITransform).setContentSize(600, BANNER_LINE + BANNER_PAD_V * 2);
    const op = root.addComponent(UIOpacity);
    op.opacity = 0;
    root.parent = parent;
    this.root = root;

    // 胶囊底板 → 预烘焙切图（九宫格：左右各 50 是不拉伸的圆角区，中间横拉）。
    //    ⚠️ 原来用 Graphics 画胶囊，圆角被三角化成硬边；横幅宽度又随文案长短变，
    //    做成九宫格正好一张图复用任意宽度，圆角也不会被拉成椭圆。
    const bg = new Node('bg');
    bg.layer = Layers.Enum.UI_2D;
    bg.addComponent(UITransform);
    const bsp = bg.addComponent(Sprite);
    bsp.sizeMode = Sprite.SizeMode.CUSTOM;
    bsp.type = Sprite.Type.SLICED;
    setSprite(bsp, 'fx/tut-banner');
    bg.parent = root;
    this.bg = bg;

    const ln = new Node('text');
    ln.layer = Layers.Enum.UI_2D;
    ln.addComponent(UITransform);
    const l = ln.addComponent(Label);
    l.fontSize = BANNER_FONT;
    l.lineHeight = BANNER_LINE;
    l.color = BANNER_TEXT;
    l.string = '';
    // ⚠️ 打包后 cc 命名空间里的枚举可能被摇掉，直接用数值：
    //    ⚠️ overflow 保持默认的 NONE(0)：Label 会把节点尺寸改成文字自身大小，
    //       横幅宽度才能跟着文案长短走（Web 的 width 就是 padding + 文字撑出来的）
    const anyLabel = l as unknown as { horizontalAlign: number; verticalAlign: number; overflow: number; enableShadow: boolean; shadowColor: Color; shadowOffset: unknown };
    anyLabel.horizontalAlign = 1;
    anyLabel.verticalAlign = 1;
    anyLabel.overflow = 0;
    // `text-shadow: 0 2px 0 rgba(0,0,0,.35)`
    anyLabel.enableShadow = true;
    anyLabel.shadowColor = new Color(0, 0, 0, 89);
    anyLabel.shadowOffset = new Vec2(0, -2);
    ln.parent = root;
    this.textNode = ln;
    this.label = l;

    root.active = false;
  }

  /** 定位（创建方把横幅钉到棋盘上方） */
  setPosition(x: number, y: number): void {
    this.baseX = x;
    this.baseY = y;
    this.root.setPosition(x, y, 0);
  }

  /** 按文字实际尺寸重画胶囊底板（宽度自适应、夹在 `max-width: 88%` 内） */
  private paint(): void {
    const force = this.label as unknown as { updateRenderData?: (f: boolean) => void };
    if (typeof force.updateRenderData === 'function') force.updateRenderData(true);
    const ut = this.textNode.getComponent(UITransform)!;
    const tw = ut.contentSize.width || 0;
    // Web 的高度由 `padding + 单行 line-height` 撑出来（101），**不跟行数走**
    const w = Math.min(tw + BANNER_PAD_H * 2, BANNER_MAX_W);
    const h = BANNER_LINE + BANNER_PAD_V * 2;

    // 只更新尺寸 —— 贴图是九宫格，本体由 Sprite 自己拉伸（圆角仍是不变的 50）
    this.bg.getComponent(UITransform)!.setContentSize(w, h);
    this.root.getComponent(UITransform)!.setContentSize(w, h);
  }

  /** 显示一句话，`ms` 后淡出（不打断操作、不吃点击） */
  show(text: string, ms = 2000): void {
    if (this.timer) clearTimeout(this.timer);
    this.label.string = text;
    this.paint();
    this.root.active = true;
    const op = this.root.getComponent(UIOpacity)!;
    op.opacity = 255;
    // 入场：从下方 12px 升到位（与 opacity 同为 .2s）
    tween(this.root).stop();
    this.root.setPosition(this.baseX, this.baseY - BANNER_RISE, 0);
    tween(this.root).to(0.2, { position: new Vec3(this.baseX, this.baseY, 0) }).start();
    this.timer = setTimeout(() => this.hide(), ms) as unknown as number;
    // Label 的真实宽度要等排版完才知道，稍后按实际宽度再画一次胶囊
    tween(this.textNode).delay(0.05).call(() => this.paint()).start();
  }

  hide(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = 0;
    }
    const op = this.root.getComponent(UIOpacity)!;
    tween(op).to(0.2, { opacity: 0 }).call(() => {
      this.root.active = false;
    }).start();
  }

  destroy(): void {
    if (this.root?.isValid) this.root.destroy();
  }
}

/* ------------------------------------------------------------------ 抽屉（首页教学面板） */

/* ↓↓↓ 常量区开始（全部照 `web/ui.css` 的 `.tut-*` 抄） ↓↓↓ */
/** `.tut-panel { width: 78% }` —— 设计宽 1080 × 78% = 842.4 → 842 */
const PANEL_W = 842;
/** 面板贴右（`right: 0`）→ 中心 x = 540 − 842/2 = 119 */
const PANEL_X = 540 - PANEL_W / 2;
/** `.tut-title` / `.tut-close` / `.tut-card-title`：#7a4100 */
const C_TITLE = new Color(122, 65, 0);
/** `.tut-status-line`（#9a6a2a）与其前置圆圈（#c8a978） */
const C_STATUS = new Color(154, 106, 42);
const C_STATUS_MARK = new Color(200, 169, 120);
/** `.tut-status-line.done`：#2f8a3f */
const C_STATUS_DONE = new Color(47, 138, 63);
/** `.tut-note-line`：#9a6a2a */
const C_NOTE = new Color(154, 106, 42);
/** `.tut-how-body`：#6d4a1c */
const C_HOW_BODY = new Color(109, 74, 28);
/** `.tut-fig-up` / `.tut-fig-cap`：#e8760f；`.tut-fig-arrow`：#c0530f */
const C_FIG_UP = new Color(232, 118, 15);
const C_FIG_ARROW = new Color(192, 83, 15);
/** `.tut-status-line`：38px × line-height 1.9 ≈ 72 */
const STATUS_LH = 72;
/** `.tut-btn` 118 高（下影 7）；`.tut-btn.ghost` 96 高（下影 5） */
const BTN_H = 118;
const BTN_GHOST_H = 96;
/** `.tut-fig-grid`：2 × 76px 单块 */
const FIG_PX = 76;
/* ↑↑↑ 常量区结束 ↑↑↑ */

export interface TutorialDrawerHandlers {
  onStartNormal: () => void;
  onStartNightmare: () => void;
  /** 抽屉关闭（用于首次自动展开后落盘 seen） */
  onClose: () => void;
}

/**
 * 首页教学抽屉（Cocos 版：全屏遮罩 + 中间面板，程序绘制灰盒）。
 * 与 Web 版同构：状态卡（简单/困难完成态）+ 按钮卡 + 图解卡 + 补充卡。
 * ⚠️ 独立组件，不进屏状态机 —— 自带遮罩。
 */
export class TutorialDrawer {
  private root: Node = null!;
  private panelWrap: Node = null!;
  private panel: Node = null!;
  /** 遮罩的透明度（Web `.tut-mask` 是 opacity 0→1 淡入） */
  private maskOpacity: UIOpacity = null!;
  /** 状态行的前置圆圈（Web 是 `.tut-status-line::before` 的 ○ / ✅） */
  private statusNormalMark: Label = null!;
  private statusNightmareMark: Label = null!;
  private statusNormal: Label = null!;
  private statusNightmare: Label = null!;
  private btnNormalLabel: Label = null!;
  private btnNightmareLabel: Label = null!;
  /** 两个按钮的 Sprite（置灰要换整套贴图，不是换个色） */
  private btnNormalSprite: Sprite = null!;
  private btnNightmareSprite: Sprite = null!;
  private btnNightmareDim = false;
  private handlers: TutorialDrawerHandlers;
  private isOpenState = false;

  private constructor(handlers: TutorialDrawerHandlers) {
    this.handlers = handlers;
  }

  static create(parent: Node, handlers: TutorialDrawerHandlers): TutorialDrawer {
    const d = new TutorialDrawer(handlers);
    d.build(parent);
    return d;
  }

  private build(parent: Node): void {
    const root = new Node('TutorialDrawer');
    root.layer = Layers.Enum.UI_2D;
    root.addComponent(UITransform).setContentSize(1080, 1920);
    root.parent = parent;
    root.setPosition(0, 0, 0);
    this.root = root;

    // 遮罩：只吃抽屉自己这一层。Web `.tut-mask` 是 `rgba(20,10,0,.45)`（原来写的纯黑 51% 偏冷）
    const mask = new Node('mask');
    mask.layer = Layers.Enum.UI_2D;
    mask.addComponent(UITransform).setContentSize(1080, 1920);
    const mg = mask.addComponent(Graphics);
    mg.rect(-540, -960, 1080, 1920);
    mg.fillColor = new Color(20, 10, 0, 115);
    mg.fill();
    mask.parent = root;
    mask.on(Node.EventType.TOUCH_END, () => this.close());
    // Web `.tut-mask` 是 opacity 0→1 淡入（.22s），这里用 UIOpacity 走同一条曲线
    this.maskOpacity = mask.addComponent(UIOpacity);
    this.maskOpacity.opacity = 0;

    // 面板：Web `.tut-panel` 是 `right:0; top:0; bottom:0; width:78%` —— 贴右侧的**全高**抽屉，
    //    不是居中的竖卡。1080 × 78% = 842.4 → 842；中心 x = 540 − 421 = 119。
    //    ⚠️ 原来这里是 940×1560 居中卡片 + 6px 描边，与 Web 完全不是一回事。
    const panelWrap = new Node('panelWrap');
    panelWrap.layer = Layers.Enum.UI_2D;
    panelWrap.addComponent(UITransform).setContentSize(PANEL_W, 1920);
    panelWrap.setPosition(540 - PANEL_W / 2, 0, 0);
    panelWrap.parent = root;
    // `-10px 0 30px rgba(80,40,0,.35)`：只在面板**左侧**露出一条软阴影（上下溢出在屏外看不见）
    mkSprite(panelWrap, 'fx/tut-panel-shadow', 40, 1920, -PANEL_W / 2 - 20, 0);
    // 面板本体：渐变 #fffaf0→#ffeccd（无圆角、无描边）
    mkSprite(panelWrap, 'fx/tut-panel', PANEL_W, 1920, 0, 0);

    const panel = new Node('panel');
    panel.layer = Layers.Enum.UI_2D;
    panel.addComponent(UITransform).setContentSize(PANEL_W, 1920);
    panel.parent = panelWrap;
    this.panel = panel;
    this.panelWrap = panelWrap;

    /* ---- 内容坐标系：panel 中心 (0,0)，Web `.tut-panel` 是 `padding: 46px 40px` ---- */
    const L0 = -PANEL_W / 2 + 40;                 // 内容左边缘 −381
    const R0 = PANEL_W / 2 - 40;                  // 内容右边缘 381
    const CW = PANEL_W - 80;                      // 内容宽 762
    const T0 = 960 - 46;                          // 内容顶 914

    /* head：`.tut-title` 56/900/#7a4100（左对齐）+ `.tut-close` 76 圆（右），mb 30 */
    const headY = T0 - 38;
    this.addText(panel, TUTORIAL.drawerTitle, 56, L0 + (CW - 96) / 2, headY, C_TITLE, CW - 96, 0);
    const closeBtn = new Node('close');
    closeBtn.layer = Layers.Enum.UI_2D;
    closeBtn.addComponent(UITransform).setContentSize(76, 76);
    closeBtn.setPosition(R0 - 38, headY, 0);
    closeBtn.parent = panel;
    mkSprite(closeBtn, 'fx/tut-close', 76, 76);
    this.addText(closeBtn, '✕', 44, 0, 0, C_TITLE, 76, 1);
    closeBtn.on(Node.EventType.TOUCH_END, () => this.close());

    /* 卡 1：状态（`.tut-status-line` 38px / 行高 1.9 / #9a6a2a，done → #2f8a3f + ✅） */
    let top = headY - 38 - 30;                              // 808
    const card1H = 28 * 2 + STATUS_LH * 2;                  // 200
    this.addCard(panel, CW, card1H, 0, top - card1H / 2, false);
    const s1 = this.addStatusLine(panel, L0 + 30, top - 28 - STATUS_LH / 2);
    this.statusNormalMark = s1[0];
    this.statusNormal = s1[1];
    const s2 = this.addStatusLine(panel, L0 + 30, top - 28 - STATUS_LH * 1.5);
    this.statusNightmareMark = s2[0];
    this.statusNightmare = s2[1];

    /* 卡 2：主按钮 118 + 次按钮 96（`.tut-btn` mb 22，主次差一档一眼可分） */
    top -= card1H + 28;                                     // 580
    const card2H = 28 * 2 + (BTN_H + 7) + 22 + (BTN_GHOST_H + 5);
    this.addCard(panel, CW, card2H, 0, top - card2H / 2, false);
    let by = top - 28 - (BTN_H + 7) / 2;
    const b1 = this.addTutButton(panel, CW - 60, BTN_H, 0, by, true, () => this.handlers.onStartNormal());
    this.btnNormalLabel = b1[1];
    this.btnNormalSprite = b1[0];
    by -= (BTN_H + 7) / 2 + 22 + (BTN_GHOST_H + 5) / 2;
    const b2 = this.addTutButton(panel, CW - 60, BTN_GHOST_H, 0, by, false, () => {
      if (this.btnNightmareDim) return;
      this.handlers.onStartNightmare();
    });
    this.btnNightmareLabel = b2[1];
    this.btnNightmareSprite = b2[0];

    /* 卡 3：怎么玩（标题 + 真实贴纸图解 + 四步说明） */
    top -= card2H + 28;                                     // 248
    const figH = FIG_PX * 2 + 26 + (36 + 2 + FIG_PX);       // 292
    const howH = 48 * 4 + 18 * 3;                           // 246
    const card3H = 28 * 2 + 46 + 22 + figH + 26 + howH;     // 688
    this.addCard(panel, CW, card3H, 0, top - card3H / 2, false);
    this.addText(panel, TUTORIAL.howTitle, 46, L0 + 30 + 300, top - 28 - 23, C_TITLE, 600, 0);
    // 图解区：整块水平居中（左列 152 + gap 22 + 箭头 48 + gap 22 + 右列 152 = 396）
    const figTop = top - 28 - 46 - 22;                      // 152
    this.addFigure(panel, TUTORIAL_IMAGE_IDS[0], 0, figTop - figH / 2);
    const hows: Array<[string, string]> = [
      ['①', TUTORIAL.how1], ['②', TUTORIAL.how2], ['③', TUTORIAL.how3], ['④', TUTORIAL.how4],
    ];
    let hy = figTop - figH - 26;                            // how 区顶
    for (const [no, body] of hows) {
      this.addHowRow(panel, no, body, L0 + 30, hy - 24);
      hy -= 48 + 18;
    }

    /* 卡 4：补充（`.tut-card-note` 虚线边 + 30px 小字） */
    top -= card3H + 28;                                     // −468
    const card4H = 28 * 2 + 51 * 3;
    this.addCard(panel, CW, card4H, 0, top - card4H / 2, true);
    this.addText(panel, TUTORIAL.noteTime, 30, L0 + 30 + (CW - 120) / 2, top - 28 - 25, C_NOTE, CW - 120, 0);
    this.addText(panel, TUTORIAL.noteStar, 30, L0 + 30 + (CW - 120) / 2, top - 28 - 25 - 51, C_NOTE, CW - 120, 0);
    this.addText(panel, TUTORIAL.noteNightmare, 30, L0 + 30 + (CW - 120) / 2, top - 28 - 25 - 102, C_NOTE, CW - 120, 0);

    root.active = false;
  }

  /** 一行文字（锚点中心）。`align`：0 = 左（Web 的标题/正文多左对齐）、1 = 居中 */
  private addText(
    parent: Node, str: string, size: number, x: number, y: number,
    color: Color, width = 860, align = 1,
  ): Label {
    const n = new Node('t');
    n.layer = Layers.Enum.UI_2D;
    n.addComponent(UITransform).setContentSize(width, size + 16);
    const l = n.addComponent(Label);
    l.fontSize = size;
    l.lineHeight = size + 12;
    l.color = color;
    l.string = str;
    // ⚠️ 打包后 cc 命名空间里的枚举可能被摇掉，直接用数值（0=LEFT / 1=CENTER / 1=CENTER）
    const any = l as unknown as { horizontalAlign: number; verticalAlign: number };
    any.horizontalAlign = align;
    any.verticalAlign = 1;
    n.parent = parent;
    n.setPosition(x, y, 0);
    return l;
  }

  /**
   * `.tut-card`：`rgba(255,255,255,.72)` 底 + 4px 边 + 圆角 28 → 预烘焙九宫格。
   * `note` = Web 的 `.tut-card-note`（虚线边 + `rgba(255,236,200,.8)` 底）。
   */
  private addCard(parent: Node, w: number, h: number, x: number, y: number, note: boolean): void {
    const n = new Node('card');
    n.layer = Layers.Enum.UI_2D;
    n.addComponent(UITransform).setContentSize(w, h);
    n.setPosition(x, y, 0);
    n.parent = parent;
    const sp = n.addComponent(Sprite);
    sp.sizeMode = Sprite.SizeMode.CUSTOM;
    sp.type = Sprite.Type.SLICED;
    setSprite(sp, note ? 'fx/tut-card-note' : 'fx/tut-card');
  }

  /** `.tut-status-line`：前置圆圈（Web 的 `::before` ○ / ✅）+ 38px 正文，返回 [圆圈, 正文] */
  private addStatusLine(parent: Node, x: number, y: number): [Label, Label] {
    const bodyW = PANEL_W - 80 - 120;                       // 内容宽减掉卡片内边距与圆圈
    const mark = this.addText(parent, '○', 40, x + 22, y, C_STATUS_MARK, 44, 1);
    const text = this.addText(parent, '', 38, x + 44 + 16 + bodyW / 2, y, C_STATUS, bodyW, 0);
    return [mark, text];
  }

  /**
   * `.tut-btn`：胶囊按钮 → 预烘焙九宫格（原来用 Graphics 画实色圆角，边缘是硬边）。
   * `primary` = 主按钮（118 高 / 46px 白字 / 橙渐变）；否则是 `.ghost`（96 高 / 40px 深棕字 / 白底描边）。
   * 贴图含硬下影 → 节点按「本体 + 下影」建高、文字下移 `dy/2` 才在本体正中。
   */
  private addTutButton(
    parent: Node, w: number, h: number, x: number, y: number,
    primary: boolean, onTap: () => void,
  ): [Sprite, Label] {
    const dy = primary ? 7 : 5;
    const n = new Node('btn');
    n.layer = Layers.Enum.UI_2D;
    n.addComponent(UITransform).setContentSize(w, h + dy);
    n.setPosition(x, y, 0);
    n.parent = parent;
    const sp = n.addComponent(Sprite);
    sp.sizeMode = Sprite.SizeMode.CUSTOM;
    sp.type = Sprite.Type.SLICED;
    setSprite(sp, primary ? 'fx/tut-btn-primary' : 'fx/tut-btn-ghost');
    const l = this.addText(n, '', primary ? 46 : 40, 0, -dy / 2,
      primary ? new Color(255, 255, 255) : new Color(138, 75, 0), w - 40, 1);
    n.on(Node.EventType.TOUCH_END, () => onTap());
    return [sp, l];
  }

  /** `.tut-how-row`：44 圆序号（切图）+ 32px 正文 */
  private addHowRow(parent: Node, no: string, body: string, x: number, y: number): void {
    const n = new Node('no');
    n.layer = Layers.Enum.UI_2D;
    n.addComponent(UITransform).setContentSize(44, 44);
    n.setPosition(x + 22, y, 0);
    n.parent = parent;
    mkSprite(n, 'fx/tut-how-no', 44, 44);
    this.addText(n, no, 28, 0, 0, new Color(255, 255, 255), 44, 1);
    const bodyW = PANEL_W - 80 - 120;
    this.addText(parent, body, 32, x + 44 + 16 + bodyW / 2, y, C_HOW_BODY, bodyW, 0);
  }

  // ⚠️ 原 `addButton()`（Graphics 画实色圆角 + 棕字）已删除：
  //    主/次按钮改用 `addTutButton()`，走 Web `.tut-btn` / `.tut-btn.ghost` 的预烘焙九宫格贴图。

  /**
   * 图解：左侧「3 缺 1 小棋盘 + 待拖块」→ 右侧「拼成发光 + ✨ +1 组」。
   * 用真实贴纸切块（与棋盘碎片同一套切法），素材缺失时退化为色块。
   */
  private addFigure(parent: Node, imageId: number, x: number, y: number): void {
    const px = FIG_PX;                                  // 单块 76（Web `.tut-fig-grid` = 2×76）
    const figH = px * 2 + 26 + (36 + 2 + px);           // 292
    const fig = new Node('fig');
    fig.layer = Layers.Enum.UI_2D;
    fig.addComponent(UITransform).setContentSize(396, figH);
    fig.parent = parent;
    fig.setPosition(x, y, 0);

    const top = figH / 2;                               // 146
    const tint = hslColor((imageId * 53 + 25) % 360, 58, 62);
    const COL1 = -122;                                  // 左列中心（152 + 22 + 48 + 22 + 152 = 396 居中）
    const COL2 = 122;                                   // 右列中心
    const gy = top - px;                                // 网格中心 y（列顶对齐）= 70

    /** 一块碎片：色块兜底 + 贴纸切块覆盖 */
    const mkPiece = (cx: number, cy: number, pos: number): void => {
      const n = new Node('p' + pos);
      n.layer = Layers.Enum.UI_2D;
      n.addComponent(UITransform).setContentSize(px, px);
      const g = n.addComponent(Graphics);
      g.rect(-px / 2, -px / 2, px, px);
      g.fillColor = tint;
      g.fill();
      n.parent = fig;
      n.setPosition(cx, cy, 0);
      this.loadStickerPiece(n, imageId, pos, px);
    };

    // 左列：「3 缺 1」—— 右下角是 `.tut-fig-gap`（虚线缺口 → 预烘焙切图）
    mkPiece(COL1 - px / 2, gy + px / 2, 0);
    mkPiece(COL1 + px / 2, gy + px / 2, 1);
    mkPiece(COL1 - px / 2, gy - px / 2, 2);
    const gap = new Node('gap');
    gap.layer = Layers.Enum.UI_2D;
    gap.addComponent(UITransform).setContentSize(px, px);
    gap.parent = fig;
    gap.setPosition(COL1 + px / 2, gy - px / 2, 0);
    mkSprite(gap, 'fx/tut-fig-gap', px, px);

    // `.tut-fig-move`：网格下方 26 处，↑ + 待拖的那块
    const moveTop = top - px * 2 - 26;                  // −32
    this.addText(fig, '↑', 36, COL1, moveTop - 18, C_FIG_UP, 60, 1);
    mkPiece(COL1, moveTop - 36 - 2 - px / 2, 3);

    // `.tut-fig-arrow`：➜ 48px，垂直居中于整块
    this.addText(fig, '➜', 48, 0, 0, C_FIG_ARROW, 60, 1);

    // 右列：拼成整图 + `.tut-fig-grid.done` 的金色发光框（切图）+ `.tut-fig-cap`
    mkPiece(COL2 - px / 2, gy + px / 2, 0);
    mkPiece(COL2 + px / 2, gy + px / 2, 1);
    mkPiece(COL2 - px / 2, gy - px / 2, 2);
    mkPiece(COL2 + px / 2, gy - px / 2, 3);
    const glow = new Node('glow');
    glow.layer = Layers.Enum.UI_2D;
    glow.addComponent(UITransform).setContentSize(px * 2, px * 2);
    glow.parent = fig;
    glow.setPosition(COL2, gy, 0);
    const gsp = glow.addComponent(Sprite);
    gsp.sizeMode = Sprite.SizeMode.CUSTOM;
    gsp.type = Sprite.Type.SLICED;
    setSprite(gsp, 'fx/tut-fig-glow');
    this.addText(fig, '✨ +1 组', 32, COL2, top - px * 2 - 12 - 22, C_FIG_UP, 240, 1);
  }

  /**
   * 加载贴纸的 2×2 切块（与棋盘碎片同一套切法：四等分取样）。
   * 失败（资源缺失）时静默 —— 保留色块兜底。
   */
  private loadStickerPiece(node: Node, imageId: number, pos: number, px: number): void {
    resources.load(`stickers/sticker_${imageId}/texture`, Texture2D, (err, tex) => {
      if (err || !tex || !node.isValid) return;
      const sf = new SpriteFrame();
      // 真 Creator 用 setTexture(Texture2D)；预览 shim 的 SpriteFrame 是占位实现（无此方法），
      // 兜底直接赋 texture —— 两条路都不影响教学功能（图解缺图只是退化为色块）
      const anySf = sf as unknown as { setTexture?: (t: Texture2D) => void; texture?: Texture2D };
      if (typeof anySf.setTexture === 'function') anySf.setTexture(tex);
      else anySf.texture = tex;
      const half = tex.width / 2;
      // pos 0=左上 1=右上 2=左下 3=右下（贴图坐标 y 向上，与棋盘一致）
      const rx = (pos % 2) * half;
      const ry = pos < 2 ? half : 0;
      sf.rect = new Rect(rx, ry, half, half);
      const sp = node.addComponent(Sprite);
      sp.sizeMode = Sprite.SizeMode.CUSTOM;
      sp.spriteFrame = sf;
      void px;
    });
  }

  isOpen(): boolean {
    return this.isOpenState;
  }

  /** 根节点（挂接方用来提到最上层 / 调整层级） */
  rootNode(): Node {
    return this.root;
  }

  open(): void {
    this.isOpenState = true;
    this.root.active = true;
    // Web：遮罩 opacity 0→1（.22s）+ 面板 `translateX(100%)` → `translateX(0)`（.24s）
    this.maskOpacity.opacity = 0;
    tween(this.maskOpacity).to(0.22, { opacity: 255 }).start();
    this.panelWrap.setPosition(PANEL_X + PANEL_W, 0, 0);
    tween(this.panelWrap).to(0.24, { position: new Vec3(PANEL_X, 0, 0) }).start();
  }

  close(): void {
    if (!this.isOpenState) return;
    this.isOpenState = false;
    this.handlers.onClose();
    tween(this.maskOpacity).to(0.22, { opacity: 0 }).start();
    tween(this.panelWrap)
      .to(0.24, { position: new Vec3(PANEL_X + PANEL_W, 0, 0) })
      .call(() => { if (this.root?.isValid) this.root.active = false; })
      .start();
  }

  /** 更新两个序章的状态行与困难按钮的可用性 */
  setStatus(normalDone: boolean, nightmareDone: boolean): void {
    this.paintStatusLine(this.statusNormalMark, this.statusNormal, normalDone,
      TUTORIAL.doneNormal, TUTORIAL.todoNormal);
    this.paintStatusLine(this.statusNightmareMark, this.statusNightmare, nightmareDone,
      TUTORIAL.doneNightmare, TUTORIAL.todoNightmare);
    // 困难序章要简单序章先达成 3 星（沿用正式关「同关简单三星」的门槛口径）。
    //    ⚠️ 置灰换的是**整套 `.tut-btn.dim` 贴图**（#d8cdbf→#b4a795），不是换个色 ——
    //    Sprite.color 是逐通道乘算，压不出 Web 那种灰。
    this.btnNightmareDim = !normalDone;
    this.btnNightmareLabel.string = normalDone ? TUTORIAL.replayNightmare : TUTORIAL.nightmareLocked;
    setSprite(this.btnNightmareSprite, normalDone ? 'fx/tut-btn-ghost' : 'fx/tut-btn-dim');
    this.btnNightmareLabel.color = normalDone ? new Color(138, 75, 0) : new Color(244, 239, 230);
    this.btnNormalLabel.string = normalDone ? TUTORIAL.replayNormal : TUTORIAL.start;
  }

  /** `.tut-status-line`（未做：○ #c8a978 + #9a6a2a 字；做了：✅ + #2f8a3f 字） */
  private paintStatusLine(mark: Label, text: Label, done: boolean, doneText: string, todoText: string): void {
    mark.string = done ? '✅' : '○';
    mark.fontSize = done ? 34 : 40;
    text.string = done ? doneText : todoText;
    text.color = done ? C_STATUS_DONE : C_STATUS;
  }

  destroy(): void {
    if (this.root?.isValid) this.root.destroy();
  }
}

/** 当前模式的语音文案（简单/困难两套，字段故意不齐 —— 取不到就是"这一步不讲"） */
export function tutorialScript(mode: GameMode): {
  rule: string;
  drag: string;
  flag: string;
  time?: string;
  timeDone?: string;
  group?: string;
} {
  return mode === 'nightmare' ? TUTORIAL_VOICE.nightmare : TUTORIAL_VOICE.normal;
}

/** 每句至少留 5 秒读完（用户口径 v4.1 第 3 条），长句按字数加时 */
export const TUTORIAL_SAY_MIN_MS = 5200;

/** 教学「说一句话」的显示时长（朗读由 speech.speak 另行触发） */
export function tutorialSayDuration(text: string): number {
  return Math.max(TUTORIAL_SAY_MIN_MS, 1200 + text.length * 190);
}
