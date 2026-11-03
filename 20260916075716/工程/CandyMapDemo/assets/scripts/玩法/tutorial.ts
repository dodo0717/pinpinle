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
  Node, Label, UITransform, Graphics, Color, Layers, UIOpacity, tween, Tween,
  Sprite, SpriteFrame, Texture2D, resources, Rect, Vec2, Vec3, ScrollView, Mask,
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
import {
  mkSprite, setSprite, mkFx, mkBackButton, mkTitle, paintScreenBg, maskStencil, fillVGrad,
} from '../界面/uiPaint';
import { applyUiFont } from '../界面/fontUtil';

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

/* ↓↓↓ 常量区开始（2026-11-03 外壳改版：与排行榜/图鉴统一 —— 蓝天整屏 + 金框大卡 + 滚动内容） ↓↓↓ */
/**
 * ⚠️ 2026-11-03 用户要求：教学抽屉原来照 Web `.tut-*` 抄的是「贴右全高米黄抽屉」，
 *    与排行榜/图鉴/设置的「蓝天整屏 + 金框大卡」风格不一致 —— 现在统一成后者
 *    （与 Web 分叉：Web 端教学抽屉仍是米黄抽屉，这是用户指定的 Cocos 端专属改版）。
 *    内容与交互**全部保留**：状态卡 / 重玩按钮 / 怎么玩图解 / 补充说明，仅容器变长卡+滚动。
 */
/** 大卡：1026×1404，屏顶 226 —— 与排行榜卡完全同尺寸同位置（`LeaderboardScreen.ts:69-71`） */
const CARD_W = 1026;
const CARD_H = 1404;
const CARD_TOP = 226;
/** 卡中心（Cocos y 向上）：960 − (226 + 1404/2) = 32 */
const CARD_CY = 960 - (CARD_TOP + CARD_H / 2);
/** 金框让开 50px（Web `frame.png` 边框宽 45~55）—— 内容视口两侧再让 10 → 906 宽（同排行榜行宽） */
const VIEW_W = 906;
/** 滚动视口高：卡 1404 − 上让 58（图鉴 padding-top 58 同款）− 下让 82 */
const VIEW_H = 1264;
/** 内容总高：状态卡 258 + 按钮卡 374 + 图解卡 806 + 说明卡 187 + 3×24 间距 */
const CH = 1697;
/** 内容左缘（视口 906 宽、内边距 30） */
const L0 = -VIEW_W / 2 + 30;
/** `.tut-title` / 卡片标题：#7a4100 */
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
 * 首页教学抽屉 → **2026-11-03 改版为「教学页」**（与排行榜/图鉴统一风格）：
 * 蓝天整屏 + 左上返回钮 + 白字描边标题 + 金框大卡（1026×1404，卡内滚动）。
 * 内容仍是原来四块：状态卡（简单/困难完成态）+ 重玩按钮卡 + 怎么玩图解卡 + 补充说明卡。
 * ⚠️ 独立组件，不进屏状态机 —— 自带整屏根节点。
 */
export class TutorialDrawer {
  private root: Node = null!;
  /** 整页淡入淡出用（原遮罩的 UIOpacity 改挂在根上） */
  private rootOpacity: UIOpacity = null!;
  /** 滚动内容容器（四块内容都挂这里） */
  private content: Node = null!;
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
    this.rootOpacity = root.addComponent(UIOpacity);
    this.rootOpacity.opacity = 0;

    // 整屏蓝天渐变 + 预烘贴图（`fx/sky-screen`）—— 与排行榜/图鉴/设置同一口味的页底
    paintScreenBg(root);

    // 左上返回钮（150×150 @(44,38)）：`collection/back` 切图 + 棕圆兜底，点击 = 关闭
    mkBackButton(root, new Color(199, 139, 89, 255), new Color(216, 165, 112, 255),
      () => this.close(), 'collection/back');

    // 顶部标题：96px 白字 + 深棕描边（`mkTitle` 与图鉴/排行榜完全同款）
    mkTitle(root, TUTORIAL.drawerTitle);

    // 外投影（排行榜同款预烘贴图 1166×1570，中心比卡低 13）
    mkFx(root, 'CardShadow', 'ui/fx/shadow-card-lb', 1166, 1570, 0, CARD_CY - 13);

    // 金框大卡（1026×1404）：预烘蓝渐变卡底（`fx/card-col`，图鉴同款）+ Graphics 兜底 + frame 切图
    const card = new Node('card');
    card.layer = Layers.Enum.UI_2D;
    card.addComponent(UITransform).setContentSize(CARD_W, CARD_H);
    card.setPosition(0, CARD_CY, 0);
    card.parent = root;
    mkSprite(card, 'fx/card-col', CARD_W, CARD_H);
    const cg = card.addComponent(Graphics);
    // 兜底渐变（缺图时）与图鉴 `paintCard` 同参数：#5ea0e9→#8dbcf0→#c3e2fb，mid 55%
    this.paintCardBg(cg);

    // 卡内滚动视口（Mask 裁剪；真引擎可滚，预览 shim 只裁不滚）
    const svNode = new Node('scroll');
    svNode.layer = Layers.Enum.UI_2D;
    svNode.addComponent(UITransform).setContentSize(VIEW_W, VIEW_H);
    // 视口顶 = 卡顶 − 58 → 相对卡中心向上 (CARD_H/2 − 58 − VIEW_H/2) = 12
    svNode.setPosition(0, CARD_H / 2 - 58 - VIEW_H / 2, 0);
    svNode.parent = card;
    const sv = svNode.addComponent(ScrollView);
    sv.vertical = true;
    sv.horizontal = false;
    const mask = svNode.addComponent(Mask);
    mask.type = Mask.Type.GRAPHICS_STENCIL;
    const mg = maskStencil(mask, svNode);
    mg.roundRect(-VIEW_W / 2, -VIEW_H / 2, VIEW_W, VIEW_H, 40);
    mg.fill();

    const content = new Node('content');
    content.layer = Layers.Enum.UI_2D;
    content.addComponent(UITransform).setContentSize(VIEW_W, CH);
    content.parent = svNode;
    sv.content = content;
    // 初始滚到顶部：content 顶边贴视口顶边
    content.setPosition(0, VIEW_H / 2 - CH / 2, 0);
    this.content = content;

    // 金框切图**最后**加：盖在内容之上（中空框只压住贴边的几 px，图鉴同款口径）
    mkSprite(card, 'leaderboard/frame', CARD_W, CARD_H);

    /* ---- 内容坐标系：content 中心 (0,0)，高 1697。四块自上而下 ---- */

    /* 状态卡（906×258）：两行状态，行距 76（相对卡中心 ±38） */
    this.addCard(content, VIEW_W, 258, 0, 719, false);
    const s1 = this.addStatusLine(content, L0 + 30, 757);
    this.statusNormalMark = s1[0];
    this.statusNormal = s1[1];
    const s2 = this.addStatusLine(content, L0 + 30, 681);
    this.statusNightmareMark = s2[0];
    this.statusNightmare = s2[1];

    /* 按钮卡（906×374）：主按钮 118 高 + 次按钮 96 高 */
    this.addCard(content, VIEW_W, 374, 0, 379, false);
    const b1 = this.addTutButton(content, VIEW_W - 60, 118, 0, 454, true, () => this.handlers.onStartNormal());
    this.btnNormalLabel = b1[1];
    this.btnNormalSprite = b1[0];
    const b2 = this.addTutButton(content, VIEW_W - 60, 96, 0, 325, false, () => {
      if (this.btnNightmareDim) return;
      this.handlers.onStartNightmare();
    });
    this.btnNightmareLabel = b2[1];
    this.btnNightmareSprite = b2[0];

    /* 怎么玩图解卡（906×806）：标题 + 图解 + 四行说明 */
    this.addCard(content, VIEW_W, 806, 0, -234, false);
    this.addText(content, TUTORIAL.howTitle, 46, 0, 139, C_TITLE, 846, 0);
    this.addFigure(content, TUTORIAL_IMAGE_IDS[0], 0, -44);
    const hows: Array<[string, string]> = [
      ['①', TUTORIAL.how1], ['②', TUTORIAL.how2], ['③', TUTORIAL.how3], ['④', TUTORIAL.how4],
    ];
    const howY = [-246, -336, -450, -540];
    for (let i = 0; i < hows.length; i += 1) {
      this.addHowRow(content, hows[i][0], hows[i][1], L0, howY[i]);
    }

    /* 补充说明卡（846×187，虚线边） */
    const NOTE_W = 846;
    this.addCard(content, NOTE_W, 187, 0, -755, true);
    this.addText(content, TUTORIAL.noteTime, 30, 0, -703, C_NOTE, NOTE_W - 60, 0);
    this.addText(content, TUTORIAL.noteStar, 30, 0, -754, C_NOTE, NOTE_W - 60, 0);
    this.addText(content, TUTORIAL.noteNightmare, 30, 0, -805, C_NOTE, NOTE_W - 60, 0);

    root.active = false;
  }

  /** 卡底兜底渐变（图鉴 `paintCard` 同款）：预烘贴图 `fx/card-col` 缺图时由它兜住 */
  private paintCardBg(g: Graphics): void {
    g.clear();
    fillVGrad(g, CARD_W, CARD_H,
      new Color(94, 160, 233, 255), new Color(141, 188, 240, 255), new Color(195, 226, 251, 255),
      0.55, 118, 40);
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
    // Web 的教学面板文字字重全部在 600~900（fs38/700 状态行、fs32/600 正文、fs56/900 标题），
    //    Cocos Label 默认 400 → 视觉明显偏细，统一开粗体近似
    l.isBold = true;
    // ⚠️ 字体：教学模块此前一直用 Cocos 默认字体，与 Web（PingFang SC / 微软雅黑）不是一套字形
    applyUiFont(l);
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
    // `.tut-card` 自带投影 `0 6px 16px rgba(120,70,10,.12)`（实测 computedStyle）——
    //    投影是兄弟节点且**先加**（渲染在卡片下），节点按「形状 + blur 留白」建、下移 dy/2
    if (!note) {
      const sh = new Node('csh');
      sh.layer = Layers.Enum.UI_2D;
      sh.addComponent(UITransform).setContentSize(w + 32, h + 32);
      sh.setPosition(x, y - 6, 0);
      sh.parent = parent;
      const ss = sh.addComponent(Sprite);
      ss.sizeMode = Sprite.SizeMode.CUSTOM;
      ss.type = Sprite.Type.SLICED;
      setSprite(ss, 'fx/card-shadow');
    }
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
    const bodyW = VIEW_W - 120;                             // 内容宽减掉卡片内边距与圆圈
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
    const bodyW = VIEW_W - 120;
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

    // `.tut-fig-grid` 自带投影 `0 4px 10px rgba(90,50,0,.25)`（实测 computedStyle，两列都有）
    //    —— 阴影贴图必须是**兄弟节点且先加**，否则会被贴纸盖住
    for (const col of [COL1, COL2]) {
      const sh = new Node('gsh');
      sh.layer = Layers.Enum.UI_2D;
      sh.addComponent(UITransform).setContentSize(172, 176);
      sh.parent = fig;
      sh.setPosition(col, gy - (col === COL2 ? 49 : 0) - 2, 0);
      mkSprite(sh, 'fx/grid-shadow', 172, 176);
    }

    // 左列：「3 缺 1」—— 右下角是 `.tut-fig-gap`（`4px **dashed** rgba(255,255,255,.9)` + rgba(60,35,0,.45) 底 + 圆角 8）
    //    ⚠️ 上一轮我只 dump 了 border 的**颜色**就断定是实线、把贴图重烘成实线 —— 是误改。
    //       CSS 原文（ui.css:1452）明确是 dashed，现已改回虚线。教训：dump 要连 borderStyle 一起看。
    mkPiece(COL1 - px / 2, gy + px / 2, 0);
    mkPiece(COL1 + px / 2, gy + px / 2, 1);
    mkPiece(COL1 - px / 2, gy - px / 2, 2);
    const gap = new Node('gap');
    gap.layer = Layers.Enum.UI_2D;
    gap.addComponent(UITransform).setContentSize(px, px);
    gap.parent = fig;
    gap.setPosition(COL1 + px / 2, gy - px / 2, 0);
    mkSprite(gap, 'fx/tut-fig-gap', px, px);

    // `.tut-fig-move`：网格下方实测间距 38（↑ 顶 833 − 网格底 795），↑ + 待拖的那块
    const moveTop = top - px * 2 - 38;
    this.addText(fig, '↑', 36, COL1, moveTop - 18, C_FIG_UP, 60, 1);
    mkPiece(COL1, moveTop - 36 - 2 - px / 2, 3);

    // `.tut-fig-arrow`：➜ 48px，垂直居中于整块
    this.addText(fig, '➜', 48, 0, 0, C_FIG_ARROW, 60, 1);

    // 右列：⚠️ 实测 done 列比左列低（692 vs 643）；按 Web 的 flex 居中推算是 −41.5（不是 −49）
    const gy2 = gy - 41.5;
    mkPiece(COL2 - px / 2, gy2 + px / 2, 0);
    mkPiece(COL2 + px / 2, gy2 + px / 2, 1);
    mkPiece(COL2 - px / 2, gy2 - px / 2, 2);
    mkPiece(COL2 + px / 2, gy2 - px / 2, 3);
    const glow = new Node('glow');
    glow.layer = Layers.Enum.UI_2D;
    glow.addComponent(UITransform).setContentSize(px * 2, px * 2);
    glow.parent = fig;
    glow.setPosition(COL2, gy2, 0);
    const gsp = glow.addComponent(Sprite);
    gsp.sizeMode = Sprite.SizeMode.CUSTOM;
    gsp.type = Sprite.Type.SLICED;
    setSprite(gsp, 'fx/tut-fig-glow');
    this.addText(fig, '✨ +1 组', 32, COL2, -82, C_FIG_UP, 240, 1);
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
    // 整页淡入 0.22s（原来是遮罩淡入 + 面板右侧滑入；改整屏页后统一为淡入淡出）
    this.rootOpacity.opacity = 0;
    tween(this.rootOpacity).to(0.22, { opacity: 255 }).start();
  }

  close(): void {
    if (!this.isOpenState) return;
    this.isOpenState = false;
    this.handlers.onClose();
    tween(this.rootOpacity)
      .to(0.22, { opacity: 0 })
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

/* ------------------------------------------------------------------ 序章进度点 + 跳过按钮 */
/* ↓↓↓ 常量区开始（照 `web/ui.css` 的 `.tut-progress` / `.tut-skip` 抄） ↓↓↓ */
/** `.tut-progress`：left 50% / top 196 → 三颗 34px、间距 16 → 步距 50 */
const PROG_TOP = 196;
const PROG_D = 34;
const PROG_GAP = 16;
const PROG_N = 3;
/** `.tut-skip`：right 36 / top 210 / height 84 / padding 0 34 / 38px / #ffe9b8 */
const SKIP_RIGHT = 36;
const SKIP_TOP = 210;
const SKIP_H = 84;
const SKIP_PAD_H = 34;
const SKIP_FS = 38;
const C_SKIP_TEXT = new Color(255, 233, 184);
/* ↑↑↑ 常量区结束 ↑↑↑ */

/**
 * 序章的「三颗进度点 + 跳过教学」（`web/main.ts:652-673`）。
 *
 * 进度点是零文字的「还差几组」信号：每拼成 1 组亮一颗
 * （Web `setTutorialProgress(Math.min(3, score))`，main.ts:974）。
 * ⚠️ Cocos 端原本完全没有这两个元件（只有埋点事件名 `tutorial_skip`，没有 UI）—— 补上。
 */
export class TutorialHud {
  private root: Node = null!;
  private dots: Sprite[] = [];

  static create(parent: Node, onSkip: () => void): TutorialHud {
    const h = new TutorialHud();
    h.build(parent, onSkip);
    return h;
  }

  private build(parent: Node, onSkip: () => void): void {
    const root = new Node('TutorialHud');
    root.layer = Layers.Enum.UI_2D;
    root.addComponent(UITransform).setContentSize(1080, 1920);
    root.parent = parent;
    root.setPosition(0, 0, 0);
    root.active = false;                       // 只有序章进行中才显示
    this.root = root;

    // 进度点：容器 top 196、高 34 → 中心 y = 960 − (196 + 17) = 747
    const dots = new Node('progress');
    dots.layer = Layers.Enum.UI_2D;
    dots.addComponent(UITransform).setContentSize(PROG_D * PROG_N + PROG_GAP * (PROG_N - 1), PROG_D);
    dots.setPosition(0, 960 - (PROG_TOP + PROG_D / 2), 0);
    dots.parent = root;
    const step = PROG_D + PROG_GAP;
    for (let i = 0; i < PROG_N; i += 1) {
      const n = new Node('i' + i);
      n.layer = Layers.Enum.UI_2D;
      n.addComponent(UITransform).setContentSize(PROG_D, PROG_D);
      n.setPosition((i - 1) * step, 0, 0);
      n.parent = dots;
      const sp = n.addComponent(Sprite);
      sp.sizeMode = Sprite.SizeMode.CUSTOM;
      setSprite(sp, 'fx/tut-progress-off');
      this.dots.push(sp);
    }

    // 跳过按钮：84 高胶囊 → 九宫格切图（左右各 42 是不拉伸的圆角区），宽度按文案 + padding 0 34
    const w = TUTORIAL.skip.length * SKIP_FS + SKIP_PAD_H * 2;
    const skip = new Node('skip');
    skip.layer = Layers.Enum.UI_2D;
    skip.addComponent(UITransform).setContentSize(w, SKIP_H);
    skip.setPosition(540 - SKIP_RIGHT - w / 2, 960 - (SKIP_TOP + SKIP_H / 2), 0);
    skip.parent = root;
    const ss = skip.addComponent(Sprite);
    ss.sizeMode = Sprite.SizeMode.CUSTOM;
    ss.type = Sprite.Type.SLICED;
    setSprite(ss, 'fx/tut-skip');
    const ln = new Node('t');
    ln.layer = Layers.Enum.UI_2D;
    ln.addComponent(UITransform).setContentSize(w, SKIP_H);
    const l = ln.addComponent(Label);
    l.fontSize = SKIP_FS;
    l.lineHeight = SKIP_H;
    l.color = C_SKIP_TEXT;
    l.string = TUTORIAL.skip;
    ln.parent = skip;
    skip.on(Node.EventType.TOUCH_END, () => onSkip());
  }

  show(): void {
    this.root.active = true;
    this.setProgress(0);
  }

  hide(): void {
    this.root.active = false;
  }

  /**
   * 每拼成 1 组亮一颗（Web `.tut-progress i.on`）。
   * ⚠️ 亮起的贴图是 76×76（四周留给 `0 0 14px rgba(255,190,60,.9)` 的发光），未亮的是 34×34，
   *    所以换图要连节点尺寸一起改；`.on` 的 `scale(1.18)` 也照抄。
   * Web `.tut-progress i` 有 `transition: ... .25s ease`（ui.css:1612）→ 缩放用 0.25s tween
   * 平滑过渡（贴图本身没法渐变，尺寸切换瞬间、缩放平滑 —— 视觉主体是那 1.18 的弹一下）。
   */
  setProgress(n: number): void {
    for (let i = 0; i < this.dots.length; i += 1) {
      const on = i < n;
      const sp = this.dots[i];
      const node = sp.node;
      node.getComponent(UITransform)!.setContentSize(on ? 76 : PROG_D, on ? 76 : PROG_D);
      setSprite(sp, on ? 'fx/tut-progress-on' : 'fx/tut-progress-off');
      Tween.stopAllByTarget(node);
      const cur = node.scale.x;
      node.setScale(cur, cur, 1);
      tween(node).to(0.25, { scale: new Vec3(on ? 1.18 : 1, on ? 1.18 : 1, 1) }).start();
    }
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
