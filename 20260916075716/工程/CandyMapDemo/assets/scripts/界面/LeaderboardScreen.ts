/**
 * 排行榜整屏（从 web/ui/leaderboard.ts 移植，**2026-10-31 按 Web 实测逐元素重排**）
 *
 * 结构：整屏蓝天 + 棕返回圆钮 + 白字描边标题 → 一张 1026×1404 的金框大卡。
 * 卡内自上而下 = 胶囊双 Tab（总分榜 / 关卡榜）→ 关卡步进器（仅关卡榜，整行下推 85px）
 * → 我的成绩条（排名 / 分数 / 星数）→ 金银铜奖杯领奖台 → 表头条 → 榜单行（可滚动、裁剪）
 * → 分页器（每页 20 名）→ **「挑战本关」通栏按钮**（仅关卡榜，产品硬要求）。
 *
 * 【数值来源】`docs/dump/web-leaderboard.json`（总分榜）与 `web-leaderboard-level.json`（关卡榜）；
 * 颜色来源是 `web/art/leaderboard/*.png` 在页面里 canvas 采样的**真实均色**（不是目测）：
 *   屏底渐变 #3f83d8→#6fa9ea(42%)→#a9d0f5     卡内渐变 #4e97e8→#7fb4ee(55%)→#b8dcfb
 *   金框 #c79651（frame）   Tab 选/未选 #f98639 / #383542   表头条 #e7c39e
 *   行 #f5d7b9（我 #fedb79）  奖杯 金#c38c45 银#9a878c 铜#ab674f
 *   底座 红#bf5c54 / 橙#d37330  装饰 丝带 #54a661/#5270ce/#eeb031、星 #ecb755
 * ⚠️ 卡片圆角 118 —— 竖向渐变必须**按每行在圆角内的实际宽度**画（见 `fillVGrad`），
 *    否则方角填充会溢出圆角，卡片看着是方的。
 *
 * ⚠️ 「挑战本关」只在关卡榜出现；置灰时按钮上直接写原因（Web 同口径），点了走 `onHint` 提示。
 * ⚠️ 本机玩家那一行黄色高亮（`ROW_MINE`）。
 *
 * 【手段差异（视觉对齐、手段不同）】
 *   - **切图优先、程序绘制兜底**（与图鉴 / 设置两屏同口径）：`mkSprite` 把 `web/art/leaderboard/*.png`
 *     铺在程序绘制的底之上；加载失败时就只剩程序绘制的底，不会开天窗。
 *     已接切图：back / header / frame / tab-on / tab-off / row / row-mine / medal-1~4 /
 *     avatar-1~3 / cup-gold,silver,bronze / podium-red,orange / ribbon×3 / star。
 *     程序绘制只用于**切图里没有的东西**（分页翻页钮、挑战本关、名次数字圆牌、表头三道竖分隔线）
 *   - 标题的 96px 描边用**八向错位文本**（shim 没有 `LabelOutline`）；行内数字的细节描边用
 *     `LabelShadow`（shim 不画，真引擎会画）
 *   - 关卡下拉 `<select>` → 同尺寸胶囊 + 文本（shim 没有下拉控件），◀▶ 步进保留
 *   - 卡片/按钮的 `box-shadow` 用低透明同心圆角矩形近似高斯模糊
 *   - 列表用 `ScrollView` + `Mask` 裁剪（shim 里不滚动，只裁剪到首屏；真引擎可滚）
 *
 * 数据口径在 `leaderboardModel.ts`（可单测）。
 */

import { Node, UITransform, Graphics, Label, Color, Layers, ScrollView, Mask, UIOpacity, Vec2, Sprite } from 'cc';
import { LEADERBOARD } from '../玩法/text';
import { mkSprite, setSprite, fitContain, maskStencil } from './uiPaint';
import {
  LEADERBOARD_PAGE_SIZE,
  LEADERBOARD_MAX_LEVEL,
  avatarIndexOf,
  buildTotalBoard,
  mockRowScores,
  pageCountOf,
  clampPage,
  pageRows,
  type LeaderboardRow,
  type LeaderboardView,
} from './leaderboardModel';

export interface LeaderboardHandlers {
  onBack: () => void;
  /** 「挑战本关」：进该关（由调用方决定是直接进还是先吊关卡牌） */
  onChallenge: (level: number) => void;
  /** 取某关的榜单数据（由调用方用核心层 `boardSnapshot` 组装） */
  view: (level: number) => LeaderboardView;
  /** 我在**全服总分榜**上的真实累计分：简单 / 困难各自累加各模式所有关卡的本关最高分 */
  myTotals: () => { simple: number; hard: number };
  /** 我的累计星数（两套进度之和，与图鉴解锁同源口径） */
  myStars: () => number;
  /** 置灰按钮被点 / 空榜等场景的轻提示（Web 版走 toast） */
  onHint: (msg: string) => void;
}

/* ------------------------------------------------------------------ 布局常量（Web 实测，1080×1920、y 从顶向下） */

/** 卡片：屏幕 (27,226)，1026×1404 → 节点位置 (0, +32) */
const CARD_W = 1026;
const CARD_H = 1404;
const CARD_TOP = 226;
/** 卡片圆角 118；金框让开 50px（Web `frame.png` 的边框宽度 45~55） */
const CARD_R = 118;
const CARD_FRAME = 50;

/** 顶栏：返回钮 150×150 @(44,38)；标题 96px 居中，盒中心 y=113 */
const BACK_SIZE = 150;
const BACK_X = 44;
const BACK_Y = 38;
const TITLE_FS = 96;
const TITLE_CY = 113;

/** 双 Tab：340×122，中心间距 383（gap 43） */
const TAB_W = 340;
const TAB_H = 122;
const TAB_X = 191.5;
const TAB_FS = 64;

/** 关卡步进器（仅关卡榜）：906×74，◀/▶ 70×70 圆、下拉胶囊 272×70 */
const META_W = 906;
const META_H = 74;
const STEP_SIZE = 70;
const STEP_X = 187;
const SELECT_W = 272;
const SELECT_H = 70;
const CTRL_FS = 40;

/** 我的成绩条：886×151.55，三格等分 283.33 */
const MINE_W = 886;
const MINE_H = 151.55;
const MINE_CELL_W = 283.33;
/** 三格是容器内的内容区（`padding: 10px 18px`），比外壳矮 20px —— 与 Web 的盒对齐 */
const MINE_CELL_H = 131.55;
const MINE_K_FS = 30;
const MINE_V_FS = 88;
const MINE_K_DY = 49.3;
const MINE_V_DY = -16.5;

/** 领奖台：906×274；银(左) / 金(中，抬高) / 铜(右) */
const PODIUM_W = 906;
const PODIUM_H = 274;
const PODIUM_SPEC = [
  // cupGap: 杯底压进底座的像素（Web `margin-bottom: -5 / -13`）
  { pos: 'silver', x: -312.8, w: 280.47, h: 207.58, cupW: 118, cupH: 135.58, baseH: 77, cupGap: -5 },
  { pos: 'gold', x: 0, w: 333.06, h: 273.55, cupW: 170, cupH: 181.55, baseH: 105, cupGap: -13 },
  { pos: 'bronze', x: 312.8, w: 280.47, h: 207.58, cupW: 118, cupH: 135.58, baseH: 77, cupGap: -5 },
] as const;

/** 表头条：906×79 */
const HEAD_W = 906;
const HEAD_H = 79;
const HEAD_FS = 42;

/** 榜单：行 906×96、间距 14（pitch 110）。关卡榜时列表矮 197px（让给步进器与挑战钮） */
const LIST_W = 906;
const LIST_H_TOTAL = 437.45;
const LIST_H_LEVEL = 240.45;
const ROW_H = 96;
const ROW_PITCH = 110;
const ROW_R = 44;

/** 分页器：906×74，翻页钮 227.33×66 */
const PAGER_W = 906;
const PAGER_H = 74;
const PAGE_BTN_W = 227.33;
const PAGE_BTN_H = 66;
const PAGE_BTN_X = 268.2;
const PAGE_FS = 38;
const PAGE_LABEL_FS = 43;

/** 「挑战本关」：832×104 */
const CHALLENGE_W = 832;
const CHALLENGE_H = 104;
const CHALLENGE_FS = 48;

/**
 * 卡片内的局部 y（Cocos 里 y 向上）= CARD_H/2 − (y_screen − CARD_TOP)。
 * 关卡榜多一行步进器（74 + margin-top 11 = 85），所以它下面的整块要下移 85。
 */
const localY = (yScreen: number): number => CARD_H / 2 - (yScreen - CARD_TOP);

/** tabs / 步进器 / 我的成绩条 / 领奖台 / 表头条，按各自盒子的实测中心换算 */
const Y = {
  tab: localY(368),                 // 340×122 盒中心 y=368
  meta: localY(483),                // 906×74 盒中心
  mine: localY(522.78),             // 886×151.55 盒中心
  podium: localY(751.55),           // 906×274 盒中心
  head: localY(944.05),             // 906×79 盒中心（总分榜）
  pagerTotal: localY(1505),         // 总分榜
  pagerLevel: localY(1393),         // 关卡榜
  challenge: localY(1490),          // 832×104 盒中心（关卡榜）
  /** 列表顶边（盒子顶，不是中心）—— 高度会变，定位要靠顶边 */
  listTopTotal: localY(1010.55),
  listTopLevel: localY(1095.55),
  /** 步进器把下面整块下推的距离 */
  metaPush: 85,
};

/**
 * 表头与行列：局部 x（相对卡内容中心 540）。
 * ⚠️ 三栏数字取**行内**列中心（593 / 729 / 881）—— 表头自己的盒中心是 587（差 2px 是 Web 自身
 * 的 padding/border 造成的），表头与行共用一组值，视觉上表头才压在数字列正上方。
 * 昵称列：表头盒 274 宽且左对齐（含 `padding-left:16`）；行内昵称起点在头像右侧。
 */
const COL = { rank: -363, nameBox: -148, nameLeft: -285, simple: 53, hard: 189, total: 341 };
/** 表头三道竖分隔线的位置：Web 是 `.h-*` 的 `border-left` + `margin-left:-11`（盒左 525/661/797） */
const COL_HEAD_LINE = [-23, 113, 249];
const COL_W = { rank: 100, nameBox: 274, name: 188, simple: 124, hard: 124, total: 156 };
/** 行内元素的局部 x（名次徽章 / 头像 / 昵称） */
const ROW_X = { badge: -369, avatar: -265, nameLeft: -209 };

/* ------------------------------------------------------------------ 颜色（切图实测均色） */

const SKY_A = new Color(63, 131, 216, 255);      // #3f83d8
const SKY_B = new Color(111, 169, 234, 255);     // #6fa9ea
const SKY_C = new Color(169, 208, 245, 255);     // #a9d0f5

const CARD_A = new Color(78, 151, 232, 255);     // #4e97e8
const CARD_B = new Color(127, 180, 238, 255);    // #7fb4ee
const CARD_C = new Color(184, 220, 251, 255);    // #b8dcfb
const FRAME_GOLD = new Color(199, 150, 81, 255); // #c79651（frame 均色）
const FRAME_EDGE = new Color(220, 173, 98, 255); // #dcad62（frame 亮边）
const CARD_SHADOW_C = new Color(20, 55, 120, Math.round(0.35 * 255));

const BACK_BG = new Color(131, 72, 47, 255);     // #83482f（back 均色）
const BACK_GLYPH = new Color(245, 191, 93, 255); // #f5bf5d（back 中心，箭头色）
const TITLE_STROKE = new Color(90, 45, 10, Math.round(0.55 * 255));

const TAB_ON = new Color(249, 134, 57, 255);     // #f98639
const TAB_OFF = new Color(56, 53, 66, 255);      // #383542
const TAB_EDGE = new Color(255, 255, 255, Math.round(0.22 * 255));

/** 半透明深蓝控件底（步进器 / 下拉 / 翻页钮）：rgba(40,70,120,.5) */
const CTRL_BG = new Color(40, 70, 120, 128);
const CTRL_TEXT = new Color(255, 248, 230, 255); // #fff8e6

const MINE_A = new Color(30, 56, 102, 219);      // rgba(30,56,102,.86)
const MINE_B = new Color(18, 34, 68, 235);       // rgba(18,34,68,.92)
const MINE_LINE = new Color(255, 201, 94, 230);  // rgba(255,201,94,.9)
const MINE_SPLIT = new Color(255, 201, 94, 89);  // rgba(255,201,94,.35)
const MINE_K = new Color(207, 224, 245, 255);    // #cfe0f5
const MINE_V_RANK = new Color(255, 233, 176, 255); // #ffe9b0
const MINE_V_SCORE = new Color(255, 213, 74, 255); // #ffd54a
const MINE_V_STAR = new Color(255, 224, 102, 255); // #ffe066

const PODIUM_RED = new Color(191, 92, 84, 255);     // #bf5c54
const PODIUM_ORANGE = new Color(211, 115, 48, 255); // #d37330
const CUP_GOLD = new Color(195, 140, 69, 255);      // #c38c45
const CUP_SILVER = new Color(154, 135, 140, 255);   // #9a878c
const CUP_BRONZE = new Color(171, 103, 79, 255);    // #ab674f
const BASE_NUM = new Color(255, 217, 78, 255);      // #ffd94e
const RIBBON = [
  new Color(84, 166, 97, 255),   // #54a661 绿
  new Color(82, 112, 206, 255),  // #5270ce 蓝
  new Color(238, 176, 49, 255),  // #eeb031 金
];
const STAR_C = new Color(236, 183, 85, 255);   // #ecb755

const HEAD_BG = new Color(231, 195, 158, 255);  // #e7c39e
const HEAD_TEXT = new Color(124, 74, 18, 255);  // #7c4a12
const HEAD_LINE = new Color(160, 110, 50, 89);  // rgba(160,110,50,.35)

const ROW_BG = new Color(245, 215, 185, 255);   // #f5d7b9
const ROW_MINE_BG = new Color(254, 219, 121, 255); // #fedb79
const NAME_TEXT = new Color(95, 58, 18, 255);   // #5f3a12
const C_SIMPLE = new Color(46, 164, 79, 255);   // #2ea44f
const C_HARD = new Color(240, 138, 36, 255);    // #f08a24
const C_TOTAL = new Color(245, 184, 0, 255);    // #f5b800
const RANK_A = new Color(143, 168, 200, 255);   // #8fa8c8
const RANK_B = new Color(95, 118, 148, 255);    // #5f7694
/** medal-1~4 的均色（盾牌主体） */
const MEDAL = [
  new Color(216, 132, 127, 255),
  new Color(233, 165, 82, 255),
  new Color(175, 140, 170, 255),
  new Color(118, 168, 202, 255),
];
const MEDAL_NUM = new Color(255, 207, 67, 255); // #ffcf43
/** medal-1~4 的原图尺寸（4 张都在 131~132 × 154~156 之间，取代表值算 contain 比例） */
const MEDAL_IW = 131;
const MEDAL_IH = 154;
/** avatar-1~3 的均色 */
const AVATAR = [
  new Color(115, 87, 81, 255),
  new Color(163, 121, 79, 255),
  new Color(158, 114, 95, 255),
];
const EMPTY_TEXT = new Color(238, 246, 255, 255); // #eef6ff
const WHITE = new Color(255, 255, 255, 255);

/** Web 的 `.dim` = opacity .38；`.lb-challenge.dim` = opacity .62 */
const OP_DIM = Math.round(0.38 * 255);
const OP_DIM_BIG = Math.round(0.62 * 255);

interface Btn {
  node: Node;
  label: Label;
  /** 底图（Tab 的 on/off 靠换 SpriteFrame；没有切图时为 null） */
  sprite: Sprite | null;
  /** 置灰（Web 的 .dim：整体半透明，仍可点 → 点了走提示） */
  setDim: (dim: boolean) => void;
  setText: (s: string) => void;
}

export class LeaderboardScreen {
  private root: Node = null!;
  private h: LeaderboardHandlers;

  private curLevel = 1;
  private maxLevel = LEADERBOARD_MAX_LEVEL;
  private tab: 'total' | 'level' = 'total';
  private page = 1;

  private tabBtns: Record<'total' | 'level', Btn> = null!;
  private meta: Node = null!;
  private stepLabel: Label = null!;
  private stepPrev: Btn = null!;
  private stepNext: Btn = null!;
  private mineCells: Node = null!;
  /** 成绩条的外壳（深蓝渐变 + inset 金边）：只建一次，别每次刷新都 addComponent */
  private mineShell: Node = null!;
  private podium: Node = null!;
  private head: Node = null!;
  private scroll: Node = null!;
  private maskG: Graphics = null!;
  private content: Node = null!;
  private pager: Node = null!;
  private pageLabel: Label = null!;
  private pagePrev: Btn = null!;
  private pageNext: Btn = null!;
  private challengeBtn: Btn = null!;

  private constructor(handlers: LeaderboardHandlers) {
    this.h = handlers;
  }

  static create(parent: Node, handlers: LeaderboardHandlers): LeaderboardScreen {
    const s = new LeaderboardScreen(handlers);
    s.build(parent);
    return s;
  }

  /* ------------------------------------------------------------ 骨架 */

  private build(parent: Node): void {
    const root = new Node('LeaderboardScreen');
    root.layer = Layers.Enum.UI_2D;
    root.addComponent(UITransform).setContentSize(1080, 1920);
    root.parent = parent;
    root.setPosition(0, 0, 0);
    root.active = false;
    this.root = root;

    // 整屏蓝天渐变（屏底是 .screen.leaderboard 的 background，卡下面露出来的那部分）
    const bg = new Node('bg');
    bg.layer = Layers.Enum.UI_2D;
    bg.addComponent(UITransform).setContentSize(1080, 1920);
    fillVGrad(bg.addComponent(Graphics), 1080, 1920, SKY_A, SKY_B, SKY_C, 0.42, 0, 40);
    bg.parent = root;

    // 顶栏：150×150 返回钮（`leaderboard/back.png` 切图，兜底是棕圆 + ‹）+ 96px 白字描边标题
    const back = new Node('back');
    back.layer = Layers.Enum.UI_2D;
    back.addComponent(UITransform).setContentSize(BACK_SIZE, BACK_SIZE);
    back.setPosition(BACK_X + BACK_SIZE / 2 - 540, 960 - (BACK_Y + BACK_SIZE / 2), 0);
    const bgc = back.addComponent(Graphics);
    bgc.circle(0, 0, BACK_SIZE / 2);
    bgc.fillColor = BACK_BG;
    bgc.fill();
    bgc.lineWidth = 6;
    bgc.strokeColor = BACK_GLYPH;
    bgc.circle(0, 0, BACK_SIZE / 2 - 3);
    bgc.stroke();
    back.parent = root;
    mkSprite(back, 'leaderboard/back', BACK_SIZE, BACK_SIZE);
    back.on(Node.EventType.TOUCH_END, () => this.h.onBack());

    // 标题：白色 96px + 深棕描边（八向错位文本近似，shim 没有 LabelOutline）
    const ty = 960 - TITLE_CY;
    for (const [dx, dy] of OUTLINE_8) {
      mkText(root, LEADERBOARD.title, TITLE_FS, dx, ty + dy, TITLE_STROKE, 900, true, 'center');
    }
    mkText(root, LEADERBOARD.title, TITLE_FS, 0, ty, WHITE, 900, true, 'center');

    const card = new Node('card');
    card.layer = Layers.Enum.UI_2D;
    card.addComponent(UITransform).setContentSize(CARD_W, CARD_H);
    card.setPosition(0, 960 - (CARD_TOP + CARD_H / 2), 0);
    this.paintCard(card.addComponent(Graphics));
    card.parent = root;

    // 双 Tab：总分榜（左）/ 关卡榜（右）
    // 初始态 = 总分榜选中 → 左 on / 右 off；切页签时由 `setTabArt` 换 SpriteFrame
    this.tabBtns = {
      total: this.mkCapsule(card, LEADERBOARD.tabTotal, -TAB_X, Y.tab, () => this.setTab('total'), TAB_W, TAB_H, TAB_FS, 'leaderboard/tab-on'),
      level: this.mkCapsule(card, LEADERBOARD.tabLevel, TAB_X, Y.tab, () => this.setTab('level'), TAB_W, TAB_H, TAB_FS, 'leaderboard/tab-off'),
    };

    // 关卡步进器（仅关卡榜）
    this.meta = new Node('meta');
    this.meta.layer = Layers.Enum.UI_2D;
    this.meta.addComponent(UITransform).setContentSize(META_W, META_H);
    this.meta.setPosition(0, Y.meta, 0);
    this.meta.parent = card;
    this.stepPrev = this.mkRound(this.meta, '◀', -STEP_X, 0, () => this.render(this.curLevel - 1, this.maxLevel), STEP_SIZE, CTRL_FS);
    // 先胶囊后文字：同层节点按加入顺序绘制，先加的在下
    this.selectShell(this.meta, 0, 0);
    this.stepLabel = mkText(this.meta, '', CTRL_FS, 0, 0, CTRL_TEXT, SELECT_W, true, 'center');
    this.stepNext = this.mkRound(this.meta, '▶', STEP_X, 0, () => this.render(this.curLevel + 1, this.maxLevel), STEP_SIZE, CTRL_FS);

    // 我的成绩条（三格等分）：外壳常驻，三格每次刷新重建
    this.mineCells = new Node('mine');
    this.mineCells.layer = Layers.Enum.UI_2D;
    this.mineCells.addComponent(UITransform).setContentSize(MINE_W, MINE_H);
    this.mineCells.setPosition(0, Y.mine, 0);
    this.mineCells.parent = card;
    this.mineShell = new Node('shell');
    this.mineShell.layer = Layers.Enum.UI_2D;
    this.mineShell.addComponent(UITransform).setContentSize(MINE_W, MINE_H);
    this.mineShell.parent = this.mineCells;
    const msg = this.mineShell.addComponent(Graphics);
    msg.fillColor = new Color(10, 22, 42, Math.round(0.35 * 255));
    msg.roundRect(-MINE_W / 2, -MINE_H / 2 - 6, MINE_W, MINE_H, 44);
    msg.fill();
    fillVGrad(msg, MINE_W, MINE_H, MINE_A, MINE_A, MINE_B, 0.5, 44, 12);
    msg.lineWidth = 4;
    msg.strokeColor = MINE_LINE;
    msg.roundRect(-MINE_W / 2 + 2, -MINE_H / 2 + 2, MINE_W - 4, MINE_H - 4, 42);
    msg.stroke();

    // 领奖台（含常驻的丝带 / 星星装饰）
    this.podium = new Node('podium');
    this.podium.layer = Layers.Enum.UI_2D;
    this.podium.addComponent(UITransform).setContentSize(PODIUM_W, PODIUM_H);
    this.podium.setPosition(0, Y.podium, 0);
    this.podium.parent = card;
    this.paintDecor(this.podium);

    // 表头条（卡片局部坐标，放在 body 之外单独跟随）
    const head = new Node('thead');
    head.layer = Layers.Enum.UI_2D;
    head.addComponent(UITransform).setContentSize(HEAD_W, HEAD_H);
    head.setPosition(0, Y.head, 0);
    head.parent = card;
    this.paintHead(head.addComponent(Graphics));
    // `header.png` 在文字之前加（文字要压在切图上）
    mkSprite(head, 'leaderboard/header', HEAD_W, HEAD_H);
    mkText(head, LEADERBOARD.colRank, HEAD_FS, COL.rank, 0, HEAD_TEXT, COL_W.rank, true, 'center');
    // 昵称列：盒宽 274 与 Web 一致，文字左对齐（Web `.lb-c-name` 的 padding-left 16）
    mkText(head, LEADERBOARD.colName, HEAD_FS, COL.nameBox, 0, HEAD_TEXT, COL_W.nameBox, true, 'left');
    mkText(head, LEADERBOARD.colSimple, HEAD_FS, COL.simple, 0, HEAD_TEXT, COL_W.simple, true, 'center');
    mkText(head, LEADERBOARD.colHard, HEAD_FS, COL.hard, 0, HEAD_TEXT, COL_W.hard, true, 'center');
    mkText(head, LEADERBOARD.colTotal, HEAD_FS, COL.total, 0, HEAD_TEXT, COL_W.total, true, 'center');
    this.head = head;

    // 榜单行：ScrollView + Mask 裁剪（shim 里不滚动，只裁剪到首屏；真引擎可滚）
    this.scroll = new Node('list');
    this.scroll.layer = Layers.Enum.UI_2D;
    this.scroll.addComponent(UITransform).setContentSize(LIST_W, LIST_H_TOTAL);
    this.scroll.setPosition(0, Y.listTopTotal - LIST_H_TOTAL / 2, 0);
    this.scroll.parent = card;
    const sv = this.scroll.addComponent(ScrollView);
    sv.vertical = true;
    sv.horizontal = false;
    const mask = this.scroll.addComponent(Mask);
    mask.type = Mask.Type.GRAPHICS_STENCIL;
    this.maskG = maskStencil(mask, this.scroll);
    this.paintMask(LIST_H_TOTAL);
    const content = new Node('content');
    content.layer = Layers.Enum.UI_2D;
    content.addComponent(UITransform).setContentSize(LIST_W, ROW_H);
    content.parent = this.scroll;
    sv.content = content;
    this.content = content;

    // 分页器
    this.pager = new Node('pager');
    this.pager.layer = Layers.Enum.UI_2D;
    this.pager.addComponent(UITransform).setContentSize(PAGER_W, PAGER_H);
    this.pager.setPosition(0, Y.pagerTotal, 0);
    this.pager.parent = card;
    // Web `.lb-pager` 是 `padding: 6px 0 2px` → 内容中心比盒中心低 2px
    const py = -2;
    this.pagePrev = this.mkCapsule(this.pager, LEADERBOARD.prevPage, -PAGE_BTN_X, py, () => this.goPage(this.page - 1), PAGE_BTN_W, PAGE_BTN_H, PAGE_FS);
    this.pageLabel = mkText(this.pager, '', PAGE_LABEL_FS, 0, py, CTRL_TEXT, 245, true, 'center');
    this.pageNext = this.mkCapsule(this.pager, LEADERBOARD.nextPage, PAGE_BTN_X, py, () => this.goPage(this.page + 1), PAGE_BTN_W, PAGE_BTN_H, PAGE_FS);

    // 「挑战本关」通栏按钮（仅关卡榜）
    this.challengeBtn = this.mkCapsule(card, LEADERBOARD.challenge, 0, Y.challenge, () => this.onChallengeTap(), CHALLENGE_W, CHALLENGE_H, CHALLENGE_FS);

    // 金框切图**最后**加：Web 的 `.lb-card::before` 是 `z-index: 9`，框盖在所有内容之上
    mkSprite(card, 'leaderboard/frame', CARD_W, CARD_H);
  }

  /* ------------------------------------------------------------ 绘制（卡片 / 表头 / 装饰） */

  /**
   * 卡片：**卡内蓝渐变铺满整卡** —— 金框是 `leaderboard/frame.png` 切图，
   * 在 `build()` 最后以子节点形式加进来（Web 的 `.lb-card::before` 是 `z-index:9`，盖在内容之上）。
   */
  private paintCard(g: Graphics): void {
    g.clear();
    // box-shadow 0 26px 70px rgba(20,55,120,.35)：5 层低透明同心圆角矩形
    for (let i = 4; i >= 0; i--) {
      const spread = (i / 4) * 70;
      g.fillColor = new Color(CARD_SHADOW_C.r, CARD_SHADOW_C.g, CARD_SHADOW_C.b, Math.round(CARD_SHADOW_C.a * (0.15 + 0.055 * (4 - i))));
      g.roundRect(
        -CARD_W / 2 - spread, -CARD_H / 2 - spread - 26,
        CARD_W + spread * 2, CARD_H + spread * 2, CARD_R + spread,
      );
      g.fill();
    }
    fillVGrad(g, CARD_W, CARD_H, CARD_A, CARD_B, CARD_C, 0.55, CARD_R, 40);
  }

  /** 表头条：米色胶囊条（兜底，`header.png` 由 `build()` 铺在上面）+ 三道竖分隔线 */
  private paintHead(g: Graphics): void {
    g.clear();
    g.fillColor = HEAD_BG;
    g.roundRect(-HEAD_W / 2, -HEAD_H / 2, HEAD_W, HEAD_H, HEAD_H / 2);
    g.fill();
    // 三道竖线是 Web 的 CSS `border-left`，切图里没有 → 仍要程序画
    const lineH = HEAD_H * 0.76;
    for (const x of COL_HEAD_LINE) {
      g.fillColor = HEAD_LINE;
      g.roundRect(x - 3, -lineH / 2, 6, lineH, 3);
      g.fill();
    }
  }

  /**
   * 领奖台的常驻装饰：3 条丝带 + 3 颗星，全用 `web/art/leaderboard` 切图。
   * Web 的 `.lb-deco` **只给 width**，高度按原图比例；旋转用节点 `angle`（CSS `rotate()` 同向）。
   */
  private paintDecor(box: Node): void {
    // 绿 ribbon-green 146×267 → 107 宽 / 蓝 ribbon-blue 147×214 → 80 宽 / 金 ribbon-gold 208×163 → 91 宽
    const ribbons: Array<[number, number, number, number, number, string]> = [
      [21 + 107 / 2, 48 + (107 * 267 / 146) / 2, 107, 107 * 267 / 146, 0, 'ribbon-green'],
      [PODIUM_W - (37 + 80 / 2), 80 + (80 * 214 / 147) / 2, 80, 80 * 214 / 147, 18, 'ribbon-blue'],
      [PODIUM_W - (155 + 91 / 2), 6 + (91 * 163 / 208) / 2, 91, 91 * 163 / 208, -14, 'ribbon-gold'],
    ];
    for (const [cx, cyTop, w, h, deg, art] of ribbons) {
      const sp = mkSprite(box, `leaderboard/${art}`, w, h, cx - PODIUM_W / 2, PODIUM_H / 2 - cyTop);
      sp.node.angle = deg;
    }
    // 星 star 139×134：59 @left139,top171 / 43 @left256,top21 / 48 @right256,top176
    const stars: Array<[number, number, number]> = [
      [139 + 59 / 2, 171 + (59 * 134 / 139) / 2, 59],
      [256 + 43 / 2, 21 + (43 * 134 / 139) / 2, 43],
      [PODIUM_W - (256 + 48 / 2), 176 + (48 * 134 / 139) / 2, 48],
    ];
    for (const [cx, cyTop, w] of stars) {
      mkSprite(box, 'leaderboard/star', w, w * 134 / 139, cx - PODIUM_W / 2, PODIUM_H / 2 - cyTop);
    }
  }

  /** 列表裁剪区（高度会随页签变） */
  private paintMask(h: number): void {
    const g = this.maskG;
    g.clear();
    g.rect(-LIST_W / 2, -h / 2, LIST_W, h);
    g.fill();
  }

  /* ------------------------------------------------------------ 小控件 */

  /**
   * 胶囊按钮（Tab / 翻页 / 挑战本关）。
   * @param art 切图（如 `leaderboard/tab-on`）；给了就铺在兜底之上、文字之下（Web 同层次）
   */
  private mkCapsule(
    parent: Node, text: string, x: number, y: number, onTap: () => void,
    w: number, h: number, fontSize: number, art?: string,
  ): Btn {
    const node = new Node('btn');
    node.layer = Layers.Enum.UI_2D;
    node.addComponent(UITransform).setContentSize(w, h);
    node.setPosition(x, y, 0);
    node.parent = parent;
    const g = node.addComponent(Graphics);
    const paint = (fill: Color): void => {
      g.clear();
      g.roundRect(-w / 2, -h / 2, w, h, h / 2);
      g.fillColor = fill;
      g.fill();
      // 切图有一圈内高光
      g.lineWidth = 4;
      g.strokeColor = TAB_EDGE;
      g.roundRect(-w / 2 + 2, -h / 2 + 2, w - 4, h - 4, h / 2 - 2);
      g.stroke();
    };
    paint(TAB_ON);
    const sprite = art ? mkSprite(node, art, w, h) : null;
    const label = mkText(node, text, fontSize, 0, 0, WHITE, Math.max(80, w - 40), true, 'center');
    const op = node.addComponent(UIOpacity);
    node.on(Node.EventType.TOUCH_END, onTap);
    return {
      node, label, sprite,
      setDim: (dim: boolean) => { op.opacity = dim ? OP_DIM_BIG : 255; },
      setText: (s: string) => { label.string = s; },
    };
  }

  /** 圆形小钮（关卡步进 ◀/▶）：半透明深蓝底 */
  private mkRound(parent: Node, text: string, x: number, y: number, onTap: () => void, size: number, fontSize: number): Btn {
    const node = new Node('btn');
    node.layer = Layers.Enum.UI_2D;
    node.addComponent(UITransform).setContentSize(size, size);
    node.setPosition(x, y, 0);
    node.parent = parent;
    const g = node.addComponent(Graphics);
    g.circle(0, 0, size / 2);
    g.fillColor = CTRL_BG;
    g.fill();
    const label = mkText(node, text, fontSize, 0, 2, CTRL_TEXT, size, true, 'center');
    const op = node.addComponent(UIOpacity);
    node.on(Node.EventType.TOUCH_END, onTap);
    return {
      // 圆钮没有切图（Web 也是纯 CSS 画的）→ sprite 恒为 null
      node, label, sprite: null,
      setDim: (dim: boolean) => { op.opacity = dim ? OP_DIM : 255; },
      setText: (s: string) => { label.string = s; },
    };
  }

  /** 关卡下拉（Web 是 `<select>`，shim 没有下拉控件 → 同尺寸胶囊 + 文本，◀▶ 步进保留） */
  private selectShell(parent: Node, x: number, y: number): void {
    const n = new Node('select');
    n.layer = Layers.Enum.UI_2D;
    n.addComponent(UITransform).setContentSize(SELECT_W, SELECT_H);
    n.setPosition(x, y, 0);
    const g = n.addComponent(Graphics);
    g.roundRect(-SELECT_W / 2, -SELECT_H / 2, SELECT_W, SELECT_H, SELECT_H / 2);
    g.fillColor = CTRL_BG;
    g.fill();
    n.parent = parent;
  }

  /* ------------------------------------------------------------ 渲染 */

  /** 切到某一关并重绘（`maxLevel` 省略时用核心层的关卡上限） */
  render(level: number, maxLevel: number = this.maxLevel): void {
    this.maxLevel = Math.max(1, maxLevel);
    this.curLevel = Math.min(Math.max(1, level), this.maxLevel);
    this.page = 1; // 换关 / 打开回到第 1 页
    this.stepLabel.string = LEADERBOARD.header(this.curLevel);
    this.stepPrev.setDim(this.curLevel <= 1);
    this.stepNext.setDim(this.curLevel >= this.maxLevel);
    this.refresh();
  }

  private setTab(tab: 'total' | 'level'): void {
    if (this.tab === tab) return;
    this.tab = tab;
    this.page = 1; // 换榜回到第 1 页
    this.refresh();
  }

  private goPage(next: number): void {
    const rows = this.currentRows();
    const target = clampPage(next, rows.length);
    if (target === this.page) return;
    this.page = target;
    this.renderRows(rows);
    this.renderPager(rows.length);
  }

  private onChallengeTap(): void {
    const view = this.h.view(this.curLevel);
    if (view.challenge.dim) {
      this.h.onHint(view.challenge.hint);
      return;
    }
    this.h.onChallenge(this.curLevel);
  }

  /** 当前页签的**全量**行（领奖台与「我的排名」看全量，列表才按页切） */
  private currentRows(): LeaderboardRow[] {
    if (this.tab === 'total') {
      // 每次重算：打完一关分数就变了，缓存会显示上一次的累计分
      return buildTotalBoard(this.h.myTotals());
    }
    const view = this.h.view(this.curLevel);
    return view.rows.map((r) => {
      if (r.mine) {
        return { ...r, simple: view.myScores.simple, hard: view.myScores.hard, total: view.myScores.simple + view.myScores.hard };
      }
      return { ...r, ...mockRowScores(r.score, view.mode) };
    });
  }

  /**
   * 页签切换时**布局也要跟着变**：关卡榜多一行步进器（整块下推 85px），
   * 且列表矮 197px（让给步进器 85 + 挑战钮 112），分页器与挑战钮位置随之改。
   */
  private applyTabLayout(): void {
    const isLevel = this.tab === 'level';
    this.meta.active = isLevel;
    this.challengeBtn.node.active = isLevel;
    // 步进器下面的整块（成绩条 / 领奖台 / 表头条 / 列表顶）下移 85
    this.mineCells.setPosition(0, Y.mine - (isLevel ? Y.metaPush : 0), 0);
    this.podium.setPosition(0, Y.podium - (isLevel ? Y.metaPush : 0), 0);
    this.head.setPosition(0, Y.head - (isLevel ? Y.metaPush : 0), 0);
    const lh = isLevel ? LIST_H_LEVEL : LIST_H_TOTAL;
    const top = isLevel ? Y.listTopLevel : Y.listTopTotal;
    this.scroll.getComponent(UITransform)!.setContentSize(LIST_W, lh);
    this.scroll.setPosition(0, top - lh / 2, 0);
    this.paintMask(lh);
    this.pager.setPosition(0, isLevel ? Y.pagerLevel : Y.pagerTotal, 0);
  }

  private refresh(): void {
    const rows = this.currentRows();
    const isLevel = this.tab === 'level';

    this.applyTabLayout();
    // Tab：选中/未选换成 `tab-on` / `tab-off` 两张切图（Web 直接换 background-image）
    const setTabArt = (b: Btn, on: boolean): void => {
      if (b.sprite) setSprite(b.sprite, `leaderboard/tab-${on ? 'on' : 'off'}`);
      else this.repaintCapsule(b.node, on ? TAB_ON : TAB_OFF);
    };
    setTabArt(this.tabBtns.total, !isLevel);
    setTabArt(this.tabBtns.level, isLevel);

    this.renderMine(rows);
    this.renderPodium(rows);
    this.renderRows(rows);
    this.renderPager(rows.length);

    if (isLevel) {
      const view = this.h.view(this.curLevel);
      const dim = view.challenge.dim;
      this.challengeBtn.setText(dim ? view.challenge.hint : LEADERBOARD.challenge);
      this.challengeBtn.setDim(dim);
    }
  }

  private repaintCapsule(node: Node, fill: Color): void {
    const t = node.getComponent(UITransform)!;
    const w = t.width, h = t.height;
    const g = node.getComponent(Graphics)!;
    g.clear();
    g.roundRect(-w / 2, -h / 2, w, h, h / 2);
    g.fillColor = fill;
    g.fill();
    g.lineWidth = 4;
    g.strokeColor = TAB_EDGE;
    g.roundRect(-w / 2 + 2, -h / 2 + 2, w - 4, h - 4, h / 2 - 2);
    g.stroke();
  }

  /** 我的成绩单：三格等分（排名 / 分数 / 星数），标签 30px 小字 + 数值 88px 大字 */
  private renderMine(rows: LeaderboardRow[]): void {
    // 只清三格与分隔线，外壳（mineShell）留着
    for (const c of this.mineCells.children.slice()) if (c !== this.mineShell) c.destroy();

    const isLevel = this.tab === 'level';
    const mine = rows.find((r) => r.mine);
    const stars = this.h.myStars();
    let score = 0;
    if (isLevel) {
      const view = this.h.view(this.curLevel);
      score = view.myRank != null ? view.boardBest : view.personalBest;
    } else {
      const t = this.h.myTotals();
      score = t.simple + t.hard;
    }
    const cells: Array<[string, string, Color]> = [
      [LEADERBOARD.mineRankLabel, LEADERBOARD.rankValue(mine ? mine.rank : 0), MINE_V_RANK],
      [isLevel ? LEADERBOARD.mineLevelScoreLabel : LEADERBOARD.mineScoreLabel, LEADERBOARD.scoreValue(score), MINE_V_SCORE],
      [LEADERBOARD.mineStarsLabel, LEADERBOARD.starsValue(stars), MINE_V_STAR],
    ];
    cells.forEach(([label, value, vColor], i) => {
      const x = (i - 1) * MINE_CELL_W;
      const box = new Node('cell' + i);
      box.layer = Layers.Enum.UI_2D;
      box.addComponent(UITransform).setContentSize(MINE_CELL_W, MINE_CELL_H);
      box.setPosition(x, 0, 0);
      box.parent = this.mineCells;
      // 格间竖分隔线（不占布局）
      if (i > 0) {
        const sp = new Node('split');
        sp.layer = Layers.Enum.UI_2D;
        sp.addComponent(UITransform).setContentSize(3, MINE_H * 0.76);
        sp.setPosition(x - MINE_CELL_W / 2, 0, 0);
        const sg = sp.addComponent(Graphics);
        sg.roundRect(-1.5, -MINE_H * 0.38, 3, MINE_H * 0.76, 1.5);
        sg.fillColor = MINE_SPLIT;
        sg.fill();
        sp.parent = this.mineCells;
      }
      mkText(box, label, MINE_K_FS, 0, MINE_K_DY, MINE_K, MINE_CELL_W, true, 'center');
      mkText(box, value, MINE_V_FS, 0, MINE_V_DY, vColor, MINE_CELL_W, true, 'center');
    });
  }

  /** 领奖台：银(左) / 金(中，抬高并写「1」) / 铜(右)，底座上站奖杯 */
  private renderPodium(rows: LeaderboardRow[]): void {
    // 装饰是常驻的，只清三个领奖位
    for (const c of this.podium.children.slice()) if (c.name.indexOf('podium') === 0) c.destroy();
    for (let i = 0; i < PODIUM_SPEC.length; i++) {
      const spec = PODIUM_SPEC[i]!;
      const row = rows[i];
      const item = new Node('podium' + i);
      item.layer = Layers.Enum.UI_2D;
      item.addComponent(UITransform).setContentSize(spec.w, spec.h);
      // ⚠️ Web 的领奖台是 `align-items: flex-end` —— **底部对齐**（冠军个子高，所以往上长）
      item.setPosition(spec.x, spec.h / 2 - PODIUM_H / 2, 0);
      item.parent = this.podium;
      if (!row) continue;

      const baseTop = -spec.h / 2 + spec.baseH;   // 底座顶面（item 内）
      // 底座
      const base = new Node('base');
      base.layer = Layers.Enum.UI_2D;
      base.addComponent(UITransform).setContentSize(spec.w, spec.baseH);
      base.setPosition(0, -spec.h / 2 + spec.baseH / 2, 0);
      const bg = base.addComponent(Graphics);
      bg.roundRect(-spec.w / 2, -spec.baseH / 2, spec.w, spec.baseH, 16);
      bg.fillColor = i === 1 ? PODIUM_RED : PODIUM_ORANGE;
      bg.fill();
      base.parent = item;
      // 底座切图：Web `.lb-base` 的 `background: center / 100% 100%`（冠军红 / 亚季军橙）
      mkSprite(base, `leaderboard/${i === 1 ? 'podium-red' : 'podium-orange'}`, spec.w, spec.baseH);
      // 只有冠军底座写「1」52px 金色（Web `.lb-base-num`，压在切图之上）
      if (i === 1) mkText(base, '1', 52, 0, -spec.baseH / 2 + 40, BASE_NUM, 120, true, 'center');

      // 奖杯：杯底压进底座 cupGap（= Web 的 `margin-bottom: -5 / -13`），向上坐标要 +cupGap
      const cup = new Node('cup');
      cup.layer = Layers.Enum.UI_2D;
      cup.addComponent(UITransform).setContentSize(spec.cupW, spec.cupH);
      cup.setPosition(0, baseTop + spec.cupGap + spec.cupH / 2, 0);
      cup.parent = item;
      // 先程序画一个简杯兜底，再压 `cup-*.png` 切图（Web `.lb-cup` 只给 width，高按原图比例）
      drawCup(
        cup.addComponent(Graphics),
        i === 1 ? CUP_GOLD : i === 0 ? CUP_SILVER : CUP_BRONZE,
        spec.cupH, spec.cupW,
      );
      mkSprite(cup, `leaderboard/cup-${spec.pos}`, spec.cupW, spec.cupH);
    }
  }

  private renderRows(rows: LeaderboardRow[]): void {
    const shown = pageRows(rows, this.page);
    const listH = shown.length === 0 ? ROW_H : shown.length * ROW_PITCH - (ROW_PITCH - ROW_H);
    const ct = this.content.getComponent(UITransform)!;
    ct.setContentSize(LIST_W, listH);
    // content 顶边贴住列表顶（Web 的滚动初始位置）
    const svH = this.scroll.getComponent(UITransform)!.height;
    this.content.setPosition(0, svH / 2 - listH / 2, 0);

    for (const c of this.content.children.slice()) c.destroy();
    if (shown.length === 0) {
      const empty = new Node('empty');
      empty.layer = Layers.Enum.UI_2D;
      empty.addComponent(UITransform).setContentSize(LIST_W, ROW_H);
      empty.parent = this.content;
      mkText(empty, LEADERBOARD.empty, 52, 0, 0, EMPTY_TEXT, LIST_W, true, 'center');
      return;
    }

    const top = listH / 2 - ROW_H / 2;
    shown.forEach((row, i) => {
      const item = new Node('row' + i);
      item.layer = Layers.Enum.UI_2D;
      item.addComponent(UITransform).setContentSize(LIST_W, ROW_H);
      item.setPosition(0, top - i * ROW_PITCH, 0);
      const g = item.addComponent(Graphics);
      g.roundRect(-LIST_W / 2, -ROW_H / 2, LIST_W, ROW_H, ROW_R);
      g.fillColor = row.mine ? ROW_MINE_BG : ROW_BG;
      g.fill();
      item.parent = this.content;
      // 行底切图：Web `.lb-row` 的 `background: center / 100% 100%`（我 → `row-mine.png`）
      mkSprite(item, `leaderboard/row${row.mine ? '-mine' : ''}`, LIST_W, ROW_H);

      // 名次：1-4 名盾牌徽章，其后数字圆牌
      if (row.rank >= 1 && row.rank <= 4) {
        const badge = new Node('medal');
        badge.layer = Layers.Enum.UI_2D;
        badge.addComponent(UITransform).setContentSize(84, 94);
        badge.setPosition(ROW_X.badge, 0, 0);
        badge.parent = item;
        drawShield(badge.addComponent(Graphics), MEDAL[row.rank - 1]!, 84, 94);
        // 盾牌切图：Web `.lb-medal` 是 `object-fit: contain`（131×154 进 84×94 → 实际 80×94）
        const [mw, mh] = fitContain(MEDAL_IW, MEDAL_IH, 84, 94);
        mkSprite(badge, `leaderboard/medal-${row.rank}`, mw, mh);
        mkText(badge, String(row.rank), 46, 0, -6, MEDAL_NUM, 84, true, 'center');
      } else {
        const rk = new Node('rank');
        rk.layer = Layers.Enum.UI_2D;
        rk.addComponent(UITransform).setContentSize(80, 80);
        rk.setPosition(ROW_X.badge, 0, 0);
        const rg = rk.addComponent(Graphics);
        fillVGrad(rg, 80, 80, RANK_A, RANK_A, RANK_B, 0.5, 40, 8);
        rk.parent = item;
        mkText(rk, String(row.rank), 46, 0, 2, WHITE, 80, true, 'center');
      }

      // 头像：84×84 圆（Web 是切图，这里用切图实测均色 + 昵称首字）
      const av = new Node('avatar');
      av.layer = Layers.Enum.UI_2D;
      av.addComponent(UITransform).setContentSize(84, 84);
      av.setPosition(ROW_X.avatar, 0, 0);
      const ag = av.addComponent(Graphics);
      ag.circle(0, 0, 42);
      ag.fillColor = AVATAR[avatarIndexOf(row.name)]!;
      ag.fill();
      av.parent = item;
      mkText(av, row.name.slice(0, 1), 40, 0, 2, WHITE, 84, true, 'center');
      // 头像切图最后加：Web `.lb-name .av` 是 `background: cover` 的 84×84 圆，切图盖住兜底的圆与首字
      mkSprite(av, `leaderboard/avatar-${avatarIndexOf(row.name) + 1}`, 84, 84);

      mkText(item, row.name, 48, ROW_X.nameLeft + COL_W.name / 2, 0, NAME_TEXT, COL_W.name, true, 'center');
      const cSimple = mkText(item, String(row.simple ?? 0), 48, COL.simple, 0, C_SIMPLE, COL_W.simple, true, 'center');
      const cHard = mkText(item, String(row.hard ?? 0), 48, COL.hard, 0, C_HARD, COL_W.hard, true, 'center');
      const cTotal = mkText(item, String(row.total ?? row.score), 54, COL.total, 0, C_TOTAL, COL_W.total, true, 'center');
      // 行内数字的白描边 / 投影（shim 不画，真引擎会画）
      for (const [lb, dy] of [[cSimple, -3], [cHard, -3], [cTotal, -5]] as Array<[Label, number]>) {
        // ⚠️ 3.8.2 起走 Label 自带的阴影属性（`LabelShadow` 的 color/offset 已废弃）
        lb.enableShadow = true;
        lb.shadowColor = new Color(255, 255, 255, Math.round(0.6 * 255));
        lb.shadowOffset = new Vec2(0, dy);
      }
    });
  }

  private renderPager(count: number): void {
    const pages = pageCountOf(count);
    this.page = clampPage(this.page, count);
    this.pageLabel.string = LEADERBOARD.page(this.page, pages);
    this.pagePrev.setDim(this.page <= 1);
    this.pageNext.setDim(this.page >= pages);
  }

  /* ------------------------------------------------------------ 开关 */

  show(): void { this.root.active = true; }
  hide(): void { this.root.active = false; }
  rootNode(): Node { return this.root; }
  destroy(): void { if (this.root?.isValid) this.root.destroy(); }

  /** 当前页签（预览/调试用；`level` 页签才有「挑战本关」） */
  currentTab(): 'total' | 'level' { return this.tab; }
  /** 每页行数（《通关及排名》§七：20）—— 与数据层同一常量，避免两处分叉 */
  static get pageSize(): number { return LEADERBOARD_PAGE_SIZE; }
}

/* ------------------------------------------------------------------ 绘制小工具 */

/** 八向错位（模拟 CSS 的文字描边） */
const OUTLINE_8: Array<[number, number]> = [[0, 6], [0, -6], [6, 0], [-6, 0], [5, 5], [5, -5], [-5, 5], [-5, -5]];

function mkText(
  parent: Node, text: string, size: number, x: number, y: number, color: Color, w: number,
  bold: boolean, align: 'center' | 'left',
): Label {
  const n = new Node('t');
  n.layer = Layers.Enum.UI_2D;
  n.addComponent(UITransform).setContentSize(w, size + 14);
  const l = n.addComponent(Label);
  l.string = text;
  l.fontSize = size;
  l.lineHeight = size + 10;
  l.color = color;
  if (bold) {
    const b = l as unknown as { isBold?: boolean; enableBold?: boolean };
    b.isBold = true;
    b.enableBold = true;
  }
  if (align === 'left') l.horizontalAlign = 0; // HorizontalTextAlignment.LEFT
  n.parent = parent;
  n.setPosition(x, y, 0);
  return l;
}

/** 三段渐变取色（t=0 顶 → t=1 底，midAt 处取中段色） */
function gradColor(top: Color, mid: Color, bot: Color, t: number, midAt: number): Color {
  if (t <= midAt) return lerpColor(top, mid, midAt === 0 ? 0 : t / midAt);
  return lerpColor(mid, bot, (t - midAt) / (1 - midAt));
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
 * 圆角矩形内的竖向渐变。
 * ⚠️ 每一条带都按「该行在圆角内的实际半宽」收窄 —— 否则矩形条带会溢出圆角，
 *    卡片看着是方角的（圆角 118 的大卡尤其明显）。
 */
function fillVGrad(
  g: Graphics, w: number, h: number, top: Color, mid: Color, bot: Color,
  midAt: number, r: number, bands: number,
): void {
  const lim = h / 2 - r;
  const halfAt = (y: number): number => {
    const ay = Math.abs(y);
    if (r <= 0 || ay <= lim) return w / 2;
    const dy = ay - lim;
    return w / 2 - r + Math.sqrt(Math.max(0, r * r - dy * dy));
  };
  const bh = h / bands;
  for (let i = 0; i < bands; i++) {
    const yTop = h / 2 - i * bh;
    const t = bands === 1 ? 0 : (bands - 1 - i) / (bands - 1);
    g.fillColor = gradColor(top, mid, bot, t, midAt);
    const hw = Math.min(halfAt(yTop), halfAt(yTop - bh));
    g.rect(-hw, yTop - bh, hw * 2, bh + 0.6);
    g.fill();
  }
}

/** 五角星 */
function drawStar(g: Graphics, cx: number, cy: number, r: number, color: Color): void {
  g.fillColor = color;
  for (let i = 0; i < 10; i++) {
    const rad = (Math.PI / 5) * i - Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * 0.42;
    const x = cx + Math.cos(rad) * rr;
    const y = cy + Math.sin(rad) * rr;
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.close();
  g.fill();
}

/** 奖杯：杯身梯形 + 两侧把手 + 杯脚（替代 cup-*.png） */
function drawCup(g: Graphics, color: Color, h: number, w: number): void {
  const top = h / 2;
  const neck = -h / 6;
  const bw = w * 0.62;
  g.fillColor = color;
  g.moveTo(-bw / 2, top);
  g.lineTo(bw / 2, top);
  g.lineTo(bw / 2 * 0.55, neck);
  g.lineTo(-bw / 2 * 0.55, neck);
  g.close();
  g.fill();
  g.lineWidth = Math.max(6, w * 0.07);
  g.strokeColor = color;
  g.moveTo(-bw / 2, top - h * 0.06);
  g.quadraticCurveTo(-bw / 2 - w * 0.17, h * 0.02, -bw / 2 * 0.6, neck + h * 0.04);
  g.stroke();
  g.moveTo(bw / 2, top - h * 0.06);
  g.quadraticCurveTo(bw / 2 + w * 0.17, h * 0.02, bw / 2 * 0.6, neck + h * 0.04);
  g.stroke();
  g.fillColor = color;
  g.rect(-w * 0.06, neck - h * 0.16, w * 0.12, h * 0.16);
  g.fill();
  g.roundRect(-w * 0.22, neck - h * 0.25, w * 0.44, h * 0.1, w * 0.04);
  g.fill();
}

/** 盾牌徽章（替代 medal-1~4.png） */
function drawShield(g: Graphics, color: Color, w: number, h: number): void {
  const hw = w / 2;
  const top = h / 2;
  g.fillColor = color;
  g.moveTo(-hw, top);
  g.lineTo(hw, top);
  g.lineTo(hw, h * 0.12);
  g.quadraticCurveTo(hw * 0.85, -h * 0.18, 0, -top);
  g.quadraticCurveTo(-hw * 0.85, -h * 0.18, -hw, h * 0.12);
  g.close();
  g.fill();
  g.lineWidth = 5;
  g.strokeColor = MEDAL_NUM;
  g.moveTo(-hw + 3, top - 3);
  g.lineTo(hw - 3, top - 3);
  g.lineTo(hw - 3, h * 0.1);
  g.quadraticCurveTo(hw * 0.82 - 3, -h * 0.18, 0, -top + 3);
  g.quadraticCurveTo(-hw * 0.82 + 3, -h * 0.18, -hw + 3, h * 0.1);
  g.close();
  g.stroke();
}
