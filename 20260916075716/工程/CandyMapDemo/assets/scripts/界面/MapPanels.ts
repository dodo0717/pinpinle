/**
 * 首页的三个整屏面板：排行榜 / 图鉴 / 设置（移植自 web/ui/leaderboard.ts、collection.ts、settings.ts，2026-10-23）。
 *
 * 视觉与 web 版同一套：蓝天渐变 + 左上棕色返回圆钮 + 白字描边大标题 + 金框大卡
 * （素材在 resources/panel/，从 web/art/ 原样拷贝）。底部页签栏不在这里，由 MapBootstrap 画在面板之上。
 *
 * 与 web 版的差别（Cocos 里没有 DOM 滚动条，换成分页）：
 *   - 排行榜：web 是滚动列表 + 分页器；这里每页条数按屏幕剩余高度算，翻页看后面的人。
 *     屏幕太矮时（列表放不下 3 行）领奖台自动收起，把高度让给榜单。
 *   - 图鉴：web 是 3 列滚动网格；这里同样 3 列，按页显示，底部翻页。
 *   - 设置：web 只有音乐 / 音效两行；Cocos 端原有的「重置存档」保留在卡片下方（测试要用）。
 *   - 图鉴大图的「下载 / 分享」要接微信接口，留到接平台能力那一步，这里只做大图查看。
 *
 * 本模块只负责画与转发点击；进度、星数、榜单数据都从 GS / 核心层现算，不另存。
 * ⚠️ 不写 `constructor(private x)` 参数属性：预览走 Node 类型擦除，参数属性不支持。
 */

import {
  Node, UITransform, Sprite, SpriteFrame, Texture2D, Label, Color, Graphics, Layers, Vec2, Rect,
  EventTouch, HorizontalTextAlignment, VerticalTextAlignment, resources, UIOpacity, director,
} from 'cc';
import { GS } from '../玩法/state';
import { friendRankCanvas } from '../玩法/wxFriend';
import { PANEL } from '../玩法/text';
import { profileName } from '../玩法/profile';
import { cloudSync } from '../玩法/cloud';
import { AvatarView } from './ProfilePanel';
import { PRESET_AVATARS } from '../玩法/profile';
import { unlockedImageIds, COLLECTION_TOTAL } from '../玩法/meta';
import {
  boardSnapshot, recordOf, levelStatus, STAR_LINES_BY_MODE, TOTAL_LEVELS,
  rankTotals, totalBoard, mockTotalRivals, gapToAhead, RANK_RULE,
  IMAGE_MOOD, IMAGE_TEXT_PLACEHOLDER, animalOf, type GameMode, type ProgressData,
} from '../核心/index';

export type PanelKind = 'board' | 'collection' | 'settings';

export interface PanelHost {
  screenH: number;
  /** 顶部让位（刘海 / 微信胶囊），与地图顶栏同一个值 */
  topInset: number;
  /** 底部让位（手势条） */
  bottomInset: number;
  /** 底部页签栏高度：卡片要让开它 */
  tabbarH: number;
  toast: (text: string, ms?: number) => void;
  /** 左上返回圆钮 */
  onBack: () => void;
  /** 排行榜「挑战本关」 */
  onChallenge: (level: number) => void;
  /** 设置页「重置存档」（确认框由宿主弹） */
  onReset: () => void;
  /** 设置页合规入口：隐私保护指引 / 用户协议 / 适龄提示（评审 P0-1，弹窗由宿主弹） */
  onLegal: (kind: 'privacy' | 'agreement' | 'age') => void;
}

/* ------------------------------------------------------------------ 布局常量（1080 设计坐标，取自 web/ui.css） */

const W = 1080;
const ART = 'panel';
const FRAME = `${ART}/leaderboard/frame`;

/** 天空渐变（web: linear-gradient(180deg, #3f83d8 0%, #6fa9ea 42%, #a9d0f5 100%)） */
const SKY: Array<[number, Color]> = [
  [0, new Color(63, 131, 216)],
  [0.42, new Color(111, 169, 234)],
  [1, new Color(169, 208, 245)],
];

const C_WHITE = new Color(255, 255, 255);
const C_TITLE_EDGE = new Color(90, 45, 10);
const C_SHADOW = new Color(60, 30, 0, 110);
const C_BROWN_TEXT = new Color(95, 58, 18);
const C_HEAD_TEXT = new Color(124, 74, 18);
const C_SIMPLE = new Color(46, 164, 79);
const C_HARD = new Color(240, 138, 36);
const C_TOTAL = new Color(245, 184, 0);
const C_PILL = new Color(40, 70, 120, 128);
const C_PILL_TEXT = new Color(255, 248, 230);

/**
 * 排行榜字号（2026-10-25 优化）—— 版式与字体不动（系统字体），整页加粗、字号加大：
 *   层级 = 标题 100 > Tab 62 > 我的成绩数值 80 > 行内总分 54 > 简单/困难 48 > 昵称 46 > 表头 38 > 说明 34
 */
const LB = {
  title: 100,
  tab: 62,
  tabSmall: 56,
  mineKey: 34,
  mineValue: 80,
  head: 38,
  rank: 42,
  name: 46,
  score: 48,
  total: 54,
  pager: 38,
  pill: 38,
  challenge: 48,
  empty: 48,
};
const C_MINE_KEY = new Color(214, 230, 250);
const C_HEAD_EDGE = new Color(255, 236, 190);
const C_PAGE_TEXT = new Color(255, 250, 236);

/** 排行榜行：高 96、行距 14（web .lb-row / .lb-list gap） */
const ROW_H = 96;
const ROW_GAP = 14;
const ROW_STEP = ROW_H + ROW_GAP;
/** 领奖台高 274 + 上边距 12 */
const PODIUM_H = 274;
const PODIUM_BLOCK = PODIUM_H + 12;

/** 图鉴卡切图比例 271:355；网格间距 10 */
const CELL_RATIO = 355 / 271;
const CELL_GAP = 10;
const CARD_SKINS = ['card-blue', 'card-pink', 'card-orange'];

interface BoardRowView {
  rank: number;
  name: string;
  simple: number;
  hard: number;
  total: number;
  /** 总星数（总榜同分排序与「再多 N 颗星」提示用） */
  stars?: number;
  /** 预设头像序号（服务端 avatar / 示例对手按名字哈希）；「我」不填 = 跟随本机资料（含微信头像） */
  avatar?: number;
  mine: boolean;
}

/**
 * 奖杯切图里人物脸的位置（2026-10-26 按切图像素测出）：中心占切图宽 / 高的比例 + 直径占切图宽的比例。
 * 领奖台把前 3 名的头像盖在这里。换奖杯切图要重测（docker 外的 Python 小脚本，见 git log）。
 */
const CUP_FACE = {
  gold: { fx: 0.508, fy: 0.298, d: 0.36 },
  silver: { fx: 0.51, fy: 0.287, d: 0.42 },
  bronze: { fx: 0.489, fy: 0.305, d: 0.42 },
} as const;

/** 示例对手 / 服务端没给头像时，按名字稳定取一个预设头像 */
function avatarOfName(name: string): number {
  return hashStr(name) % PRESET_AVATARS.length;
}

function parseAvatar(v: unknown, name: string): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isInteger(n) && n >= 0 && n < PRESET_AVATARS.length ? n : avatarOfName(name);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function skyAt(t: number): Color {
  for (let i = 1; i < SKY.length; i++) {
    const [t1, c1] = SKY[i];
    const [t0, c0] = SKY[i - 1];
    if (t <= t1) {
      const k = (t - t0) / (t1 - t0);
      return new Color(lerp(c0.r, c1.r, k), lerp(c0.g, c1.g, k), lerp(c0.b, c1.b, k), 255);
    }
  }
  return SKY[SKY.length - 1][1];
}

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}


export class MapPanels {
  readonly root: Node;
  private host: PanelHost;
  private kind: PanelKind | null = null;

  private boardTab: 'total' | 'level' | 'friend' = 'total';
  private boardLevel = TOTAL_LEVELS;
  private boardPage = 0;
  private colPage = 0;
  private warned = new Set<string>();
  /** 正在画排行榜：文字一律加粗（图鉴 / 设置保持原样） */
  private boldText = false;

  /**
   * 服务端实时榜单（2026-10-26 接入 /rank/global、/rank/level、/rank/me）。
   * 登录了才拉；拉到之前 / 离线 / 失败时显示本地示例数据（榜底标「示例数据」）。
   * 「我」的分数始终用本地值（本地是真相，服务端可能还没收到刚打的那局）。
   */
  private live: {
    key: string;
    rows: BoardRowView[];
    myRank: number | null;
    total: number;
    ahead: { name: string; score: number; stars: number } | null;
  } | null = null;
  private liveLoading = '';
  /** 下一次画榜单时自动翻到「我」所在那一页（打开 / 换 Tab / 换关卡 / 实时数据到达时置位，手动翻页不置位） */
  private jumpMine = true;

  constructor(parent: Node, host: PanelHost) {
    this.host = host;
    this.root = this.node(parent, 'Panels', W, host.screenH);
    // 面板开着时吞掉空白处的触摸：手指不能穿过去拖动底下的地图
    const swallow = (e: EventTouch): void => { e.propagationStopped = true; };
    this.root.on(Node.EventType.TOUCH_START, swallow, this);
    this.root.on(Node.EventType.TOUCH_MOVE, swallow, this);
    this.root.on(Node.EventType.TOUCH_END, swallow, this);
    this.root.active = false;
  }

  get current(): PanelKind | null {
    return this.kind;
  }

  show(kind: PanelKind): void {
    this.kind = kind;
    if (kind === 'board') {
      // 与 web 同口径：默认总分榜；关卡榜默认看最后一关
      this.boardTab = 'total';
      this.boardLevel = TOTAL_LEVELS;
      this.boardPage = 0;
      // 每次打开都重新拉一次实时榜，并翻到我那一页
      this.live = null;
      this.jumpMine = true;
    } else if (kind === 'collection') {
      this.colPage = 0;
    }
    this.root.active = true;
    this.render();
  }

  hide(): void {
    this.kind = null;
    this.clear();
    this.root.active = false;
  }

  /** 外部数据变了（设置开关 / 重置存档）时重画当前面板 */
  refresh(): void {
    if (this.kind) this.render();
  }

  private clear(): void {
    const old = this.root.children.slice();
    this.root.removeAllChildren();
    for (const n of old) n.destroy();
  }

  private render(): void {
    this.clear();
    if (this.kind === 'board') this.renderBoard();
    else if (this.kind === 'collection') this.renderCollection();
    else if (this.kind === 'settings') this.renderSettings();
  }

  /* ================================================================ 通用小工具 */

  private node(parent: Node, name: string, w: number, h: number, x = 0, y = 0): Node {
    const n = new Node(name);
    n.parent = parent;
    n.layer = Layers.Enum.UI_2D;
    n.addComponent(UITransform).setContentSize(w, h);
    n.setPosition(x, y);
    return n;
  }

  /** 单行文字：超宽自动缩字，不换行、不溢出 */
  private label(
    parent: Node, name: string, text: string, size: number, color: Color,
    w: number, h: number, x = 0, y = 0,
    opts: {
      outline?: Color; outlineWidth?: number; shadow?: boolean; align?: 'left' | 'center' | 'right';
    } = {},
  ): Label {
    const n = this.node(parent, name, w, h, x, y);
    const l = n.addComponent(Label);
    l.string = text;
    l.fontSize = size;
    l.lineHeight = size + 8;
    l.color = color;
    l.isBold = true;
    // 纯代码运行时只认 enableBold（isBold 在那边不生效）：排行榜要真加粗
    if (this.boldText) (l as Label & { enableBold?: boolean }).enableBold = true;
    l.enableWrapText = false;
    l.overflow = Label.Overflow.SHRINK;
    l.horizontalAlign = opts.align === 'left' ? HorizontalTextAlignment.LEFT
      : opts.align === 'right' ? HorizontalTextAlignment.RIGHT : HorizontalTextAlignment.CENTER;
    l.verticalAlign = VerticalTextAlignment.CENTER;
    if (opts.outline) {
      l.enableOutline = true;
      l.outlineColor = opts.outline;
      l.outlineWidth = opts.outlineWidth ?? 3;
    }
    if (opts.shadow) {
      l.enableShadow = true;
      l.shadowColor = C_SHADOW;
      l.shadowOffset = new Vec2(0, -4);
      l.shadowBlur = 2;
    }
    return l;
  }

  /** 贴图：优先 spriteFrame，导入类型还是 texture 时现场包一个（与 MapBootstrap 同一套兜底） */
  private loadFrame(path: string, cb: (sf: SpriteFrame) => void): void {
    resources.load(path + '/spriteFrame', SpriteFrame, (err, sf) => {
      if (!err && sf) {
        cb(sf);
        return;
      }
      resources.load(path + '/texture', Texture2D, (err2, tex) => {
        if (err2 || !tex) {
          if (!this.warned.has(path)) {
            this.warned.add(path);
            console.warn('[panel] 贴图缺失: ' + path);
          }
          return;
        }
        const frame = new SpriteFrame();
        frame.texture = tex;
        cb(frame);
      });
    });
  }

  private sprite(parent: Node, name: string, path: string, w: number, h: number, x = 0, y = 0): Sprite {
    const n = this.node(parent, name, w, h, x, y);
    const sp = n.addComponent(Sprite);
    sp.sizeMode = Sprite.SizeMode.CUSTOM;
    this.loadFrame(path, (sf) => { if (sp.isValid) sp.spriteFrame = sf; });
    return sp;
  }

  /** 可点按钮：按下缩一下，抬手触发；`dim` = 半透明（仍可点，由调用方决定点了说什么） */
  private button(parent: Node, name: string, w: number, h: number, x: number, y: number, onTap: () => void, dim = false): Node {
    const n = this.node(parent, name, w, h, x, y);
    n.on(Node.EventType.TOUCH_START, (e: EventTouch) => {
      e.propagationStopped = true;
      n.setScale(0.95, 0.95);
    }, this);
    n.on(Node.EventType.TOUCH_END, (e: EventTouch) => {
      e.propagationStopped = true;
      n.setScale(1, 1);
      onTap();
    }, this);
    n.on(Node.EventType.TOUCH_CANCEL, () => n.setScale(1, 1), this);
    if (dim) n.addComponent(UIOpacity).opacity = 100;
    return n;
  }

  private roundRect(g: Graphics, x: number, y: number, w: number, h: number, r: number, color: Color): void {
    g.fillColor = color;
    g.roundRect(x, y, w, h, Math.min(r, h / 2, w / 2));
    g.fill();
  }

  /** 深蓝半透明胶囊按钮（步进器 / 翻页） */
  private pillButton(parent: Node, name: string, text: string, w: number, h: number, x: number, y: number, onTap: () => void, dim: boolean): void {
    const b = this.button(parent, name, w, h, x, y, onTap, dim);
    this.roundRect(b.addComponent(Graphics), -w / 2, -h / 2, w, h, h / 2, C_PILL);
    this.label(b, 'Text', text, LB.pill, C_PILL_TEXT, w - 16, h, 0, 0, {});
  }

  /* ================================================================ 公共外壳：天空 + 返回钮 + 标题 */

  /** 画天空、返回钮、标题；返回标题下方内容区的顶边 y */
  private chrome(title: string, backPath: string): number {
    const H = this.host.screenH;
    const g = this.node(this.root, 'Sky', W, H).addComponent(Graphics);
    const N = 32;
    const step = H / N;
    for (let i = 0; i < N; i++) {
      g.fillColor = skyAt((i + 0.5) / N);
      g.rect(-W, H / 2 - (i + 1) * step - 1, W * 2, step + 2);
      g.fill();
    }

    const y = H / 2 - this.host.topInset - 75;
    const back = this.button(this.root, 'Back', 150, 150, -W / 2 + 44 + 75, y, () => this.host.onBack());
    this.sprite(back, 'Img', backPath, 150, 150);
    this.label(this.root, 'Title', title, this.boldText ? LB.title : 96, C_WHITE, 560, 130, 0, y,
      { outline: C_TITLE_EDGE, outlineWidth: 6, shadow: true });
    return H / 2 - this.host.topInset - 150 - 16;
  }

  /** 卡片要让开的底边（页签栏上沿再留 20） */
  private bottomY(): number {
    return -this.host.screenH / 2 + this.host.bottomInset + this.host.tabbarH + 20;
  }

  /**
   * 卡片金框（frame.png，923×1273）底部有一段不透明金边（约 45px，按卡高等比换算）。
   * 金框是整张卡最后盖上去的，内容压进这段会被盖住 —— 2026-10-24 用户截图：
   * 图鉴翻页 pill 底边只离卡底 24，下半截正好被金边盖住「被遮挡一半」。
   */
  private frameBand(ch: number): number {
    return Math.ceil((ch * 45) / 1273);
  }

  /** 卡片底板（投影 + 圆角填充）；金框由调用方最后盖上（框在内容之上，与 web ::before z-index 9 一致） */
  private cardBase(top: number, w: number, h: number, fill: Color): Node {
    const card = this.node(this.root, 'Card', w, h, 0, top - h / 2);
    const g = card.addComponent(Graphics);
    this.roundRect(g, -w / 2, -h / 2 - 26, w, h, 118, new Color(20, 55, 120, 80));
    this.roundRect(g, -w / 2, -h / 2, w, h, 118, fill);
    return card;
  }

  private cardFrame(card: Node, w: number, h: number): void {
    this.sprite(card, 'Frame', FRAME, w, h);
  }

  /* ================================================================ 排行榜 */

  private renderBoard(): void {
    this.boldText = true;
    try {
      this.drawBoard();
    } finally {
      this.boldText = false;
    }
  }

  private drawBoard(): void {
    const top = this.chrome(PANEL.boardTitle, `${ART}/leaderboard/back`);
    const cw = W - 54;
    const cTop = top - 22;
    const ch = cTop - this.bottomY();
    const card = this.cardBase(cTop, cw, ch, new Color(110, 168, 236));
    const inner = cw - 108;
    const isLevel = this.boardTab === 'level';
    const isFriend = this.boardTab === 'friend';

    // ---- 从上往下：Tab → (关卡步进器) → 我的成绩 ----
    let y = ch / 2 - 40 - 27;
    // 三栏 Tab（总分 / 关卡 / 好友）：好友榜走开放数据域，见 wxFriend.ts
    this.tab(card, PANEL.tabTotal, -260, y - 61, !isLevel && !isFriend, () => this.setBoardTab('total'), 250);
    this.tab(card, PANEL.tabLevel, 0, y - 61, isLevel, () => this.setBoardTab('level'), 250);
    this.tab(card, PANEL.tabFriend, 260, y - 61, isFriend, () => this.setBoardTab('friend'), 250);
    y -= 122 + 6;

    // ---- 好友榜：开放数据域的 sharedCanvas 整张贴入卡内 ----
    // 微信规定主域读不到好友数据，只能把子域画好的画布当一张图贴上（wxFriend.ts）；
    // 非微信环境降级为提示文字。子域最多画 20 行，暂不做分页。
    if (isFriend) {
      const band = this.frameBand(ch);
      const areaTop = y - 10;
      const areaBottom = -ch / 2 + band + 12;
      const areaH = areaTop - areaBottom;
      const areaW = cw - 72;
      const scale = director._canvas && director._canvas.width > 0 ? director._canvas.width / 1080 : 1;
      const src = friendRankCanvas(areaW, areaH, scale);
      if (src) {
        const node = this.node(card, 'FriendCanvas', areaW, areaH, 0, areaBottom + areaH / 2);
        const sp = node.addComponent(Sprite);
        sp.sizeMode = Sprite.SizeMode.CUSTOM;
        const sf = new SpriteFrame();
        sf.texture = new Texture2D(src as unknown as HTMLImageElement);
        sp.spriteFrame = sf;
      } else {
        this.label(card, 'FriendNA', PANEL.friendNA, LB.empty, new Color(232, 243, 255), cw - 120, 90, 0, areaBottom + areaH / 2,
          { shadow: true });
      }
      this.cardFrame(card, cw, ch);
      return;
    }
    if (isLevel) {
      y -= 11;
      this.stepper(card, y - 37);
      y -= 74;
    }
    this.fetchLive();
    const rows = this.boardRows();
    y -= 12;
    this.mineCard(card, inner - 20, 150, y - 75, rows);
    y -= 150 + 4;
    // 「再来一局」提示条：距上一名 / 距上榜还差多少
    this.hintBar(card, inner - 20, y - 6 - 30, rows);
    y -= 6 + 60 + 4;

    // ---- 从下往上：(挑战本关) → 翻页；起点避开金框底边带（同图鉴 10-24 修复） ----
    let yb = -ch / 2 + this.frameBand(ch) + 12;
    // 最底一行：示例数据说明（服务端榜单接入前，对手是本地示例数据，标清楚不冒充真榜）
    const live = this.liveFor();
    const note = !live ? PANEL.sampleNote : isLevel ? PANEL.liveLevel(live.total) : PANEL.liveTotal;
    this.label(card, 'Sample', note, 26, new Color(235, 244, 255, 220), inner, 34, 0, yb + 17);
    yb += 34 + 6;
    if (isLevel) {
      this.challenge(card, inner - 74, yb + 52);
      yb += 104 + 8;
    }
    const pagerY = yb + 33;
    yb += 66 + 6;

    // ---- 中间：领奖台（放得下才放）→ 表头 → 榜单 ----
    const headBlock = 16 + 66 + 27;
    const showPodium = y - yb - headBlock - PODIUM_BLOCK >= 3 * ROW_STEP - ROW_GAP;
    if (showPodium) {
      y -= 12;
      this.podium(card, inner, y - PODIUM_H, rows);
      y -= PODIUM_H;
    }
    y -= 16;
    this.thead(card, inner, y - 33);
    y -= 66 + 27;

    const per = Math.max(1, Math.floor((y - yb + ROW_GAP) / ROW_STEP));
    const pages = Math.max(1, Math.ceil(rows.length / per));
    if (this.jumpMine) {
      // 我上榜了就直接翻到我那一页（比如第 99 名 → 第 99 名所在页）；没上榜停在第 1 页
      this.jumpMine = false;
      const idx = rows.findIndex((r) => r.mine);
      if (idx >= 0) this.boardPage = Math.floor(idx / per);
    }
    this.boardPage = Math.max(0, Math.min(pages - 1, this.boardPage));
    const slice = rows.slice(this.boardPage * per, (this.boardPage + 1) * per);
    if (slice.length === 0) {
      this.label(card, 'Empty', PANEL.empty, LB.empty, new Color(238, 246, 255), inner, 80, 0, y - 120,
        { shadow: true });
    }
    slice.forEach((r, i) => this.boardRow(card, inner, y - ROW_H / 2 - i * ROW_STEP, r));

    this.pager(card, pagerY, this.boardPage, pages, (p) => { this.boardPage = p; this.render(); });
    this.cardFrame(card, cw, ch);
  }

  /** 我的成绩下方一条提示：已上榜 → 距上一名差多少；没上榜 → 怎么上榜 */
  private hintBar(card: Node, w: number, y: number, rows: BoardRowView[]): void {
    const h = 60;
    const box = this.node(card, 'Hint', w, h, 0, y);
    const g = box.addComponent(Graphics);
    this.roundRect(g, -w / 2, -h / 2, w, h, 24, new Color(255, 255, 255, 235));
    let text: string;
    const mine = rows.find((r) => r.mine);
    if (!mine) {
      const line = STAR_LINES_BY_MODE[GS.mode]?.[this.boardLevel];
      text = this.boardTab === 'level' ? PANEL.hintJoinLevel(line ? line[2] : 0) : PANEL.hintJoinTotal;
    } else if (this.liveFor()?.ahead && mine.rank > RANK_RULE.topN) {
      // 我在百名外：紧挨在前面那一名不在列表里，用服务端 /rank/me 给的差距
      const a = this.liveFor()!.ahead!;
      text = a.score > 0 ? PANEL.hintAhead(a.name, a.score) : PANEL.hintAheadStars(a.name, a.stars);
    } else {
      const gap = gapToAhead(rows, (r) => r.total, (r) => r.stars ?? 0);
      text = !gap ? PANEL.hintFirst
        : gap.score > 0 ? PANEL.hintAhead(gap.name, gap.score) : PANEL.hintAheadStars(gap.name, gap.stars);
    }
    this.label(box, 'Text', '💡 ' + text, 32, new Color(43, 74, 115), w - 40, h, 0, 0);
  }

  private setBoardTab(tab: 'total' | 'level' | 'friend'): void {
    if (this.boardTab === tab) return;
    this.boardTab = tab;
    this.boardPage = 0;
    this.jumpMine = true;
    this.render();
  }

  private tab(parent: Node, text: string, x: number, y: number, on: boolean, onTap: () => void, w = 340): void {
    const b = this.button(parent, 'Tab_' + text, w, 122, x, y, onTap);
    this.sprite(b, 'Bg', `${ART}/leaderboard/${on ? 'tab-on' : 'tab-off'}`, w, 122);
    // 选中 Tab 白字 + 棕描边更醒目；未选中的略小、不描边，一眼分出当前在哪个榜
    this.label(b, 'Text', text, on ? LB.tab : LB.tabSmall, on ? C_WHITE : new Color(255, 255, 255, 225), w - 40, 110, 0, 4,
      on ? { shadow: true, outline: new Color(120, 60, 10), outlineWidth: 3 } : { shadow: true });
  }

  /** 关卡榜的「◀ 第 N 关 ▶」 */
  private stepper(card: Node, y: number): void {
    const lv = this.boardLevel;
    const go = (next: number): void => {
      if (next < 1 || next > TOTAL_LEVELS) return;
      this.boardLevel = next;
      this.boardPage = 0;
      this.jumpMine = true;
      this.render();
    };
    this.pillButton(card, 'Prev', '◀', 70, 70, -200, y, () => go(lv - 1), lv <= 1);
    const pill = this.node(card, 'Level', 280, 70, 0, y);
    this.roundRect(pill.addComponent(Graphics), -140, -35, 280, 70, 35, C_PILL);
    this.label(pill, 'Text', PANEL.level(lv), 38, C_PILL_TEXT, 260, 70, 0, 0, {});
    this.pillButton(card, 'Next', '▶', 70, 70, 200, y, () => go(lv + 1), lv >= TOTAL_LEVELS);
  }

  /** 我的成绩：我的排名 / 累计总分（关卡榜为本关最高分）/ 累计星数 */
  private mineCard(card: Node, w: number, h: number, y: number, rows: BoardRowView[]): void {
    const box = this.node(card, 'Mine', w, h, 0, y);
    const g = box.addComponent(Graphics);
    this.roundRect(g, -w / 2, -h / 2 - 6, w, h, 44, new Color(10, 22, 42, 90));
    this.roundRect(g, -w / 2, -h / 2, w, h, 44, new Color(26, 48, 90, 230));
    g.lineWidth = 4;
    g.strokeColor = new Color(255, 201, 94, 230);
    g.roundRect(-w / 2 + 2, -h / 2 + 2, w - 4, h - 4, 42);
    g.stroke();

    const me = rankTotals(GS.data.progress.normal, GS.data.progress.nightmare);
    const stars = me.stars;
    let rank: number;
    let score: number;
    let scoreLabel: string;
    if (this.boardTab === 'total') {
      const mine = rows.find((r) => r.mine);
      rank = mine ? mine.rank : 0;
      score = me.total;
      scoreLabel = PANEL.mineScoreLabel;
    } else {
      const rec = recordOf(GS.progress, this.boardLevel);
      if (this.liveFor()) {
        const m = rows.find((r) => r.mine);
        rank = m ? m.rank : 0;
        score = m ? rec.boardBest : rec.validBest;
      } else {
        const snap = this.levelSnapshot(this.boardLevel);
        rank = snap.myRank ?? 0;
        // 关卡分 = 本关有效成绩最高分；上了榜就是上榜分
        score = snap.myRank != null ? snap.myBoardBest : rec.validBest;
      }
      scoreLabel = PANEL.mineLevelScoreLabel;
    }
    const cells: Array<[string, string, Color]> = [
      [PANEL.mineRankLabel, PANEL.rankValue(rank), new Color(255, 233, 176)],
      [scoreLabel, `${score}`, new Color(255, 213, 74)],
      [PANEL.mineStarsLabel, `${PANEL.starsValue(stars)}/${RANK_RULE.maxStars}`, new Color(255, 224, 102)],
    ];
    const cw = (w - 36) / 3;
    cells.forEach(([k, v, color], i) => {
      const x = -w / 2 + 18 + cw * (i + 0.5);
      if (i > 0) {
        g.fillColor = new Color(255, 201, 94, 90);
        g.rect(x - cw / 2 - 1.5, -h / 2 + h * 0.12, 3, h * 0.76);
        g.fill();
      }
      this.label(box, 'K' + i, k, LB.mineKey, C_MINE_KEY, cw - 10, 40, x, h / 2 - 34);
      this.label(box, 'V' + i, v, rank <= 0 && i === 0 ? 62 : LB.mineValue, color, cw - 16, 96, x, -18,
        { outline: new Color(120, 60, 0), outlineWidth: 4 });
    });
  }

  /** 领奖台：亚军(左) / 冠军(中, 抬高) / 季军(右) + 丝带星星装饰 */
  private podium(card: Node, inner: number, bottom: number, rows: BoardRowView[]): void {
    const left = -inner / 2;
    const right = inner / 2;
    const topY = bottom + PODIUM_H;
    // 装饰（先画，在奖杯后面）：[切图, 宽, 原图宽, 原图高, x, 距顶, 角度]
    const deco: Array<[string, number, number, number, number, number, number]> = [
      ['ribbon-green', 107, 146, 267, left + 21 + 107 / 2, 48, 0],
      ['ribbon-blue', 80, 147, 214, right - 37 - 80 / 2, 80, -18],
      ['ribbon-gold', 91, 208, 163, right - 155 - 91 / 2, 6, 14],
      ['star', 59, 139, 134, left + 139 + 59 / 2, 171, 0],
      ['star', 43, 139, 134, left + 256 + 43 / 2, 21, 0],
      ['star', 48, 139, 134, right - 256 - 48 / 2, 176, 0],
    ];
    deco.forEach(([art, w, ow, oh, x, top, angle], i) => {
      const h = (w * oh) / ow;
      const sp = this.sprite(card, 'Deco' + i, `${ART}/leaderboard/${art}`, w, h, x, topY - top - h / 2);
      sp.node.angle = angle;
    });

    const sw = inner * 0.31;
    const gw = inner * 0.37;
    const total = sw * 2 + gw + 12;
    const silverX = -total / 2 + sw / 2;
    const goldX = -total / 2 + sw + 6 + gw / 2;
    const bronzeX = goldX + gw / 2 + 6 + sw / 2;
    // 前 3 名（榜单已按名次排好；并列时按展示顺序取）
    const top = rows.slice(0, 3);
    const item = (
      name: string, x: number, w: number, baseH: number, base: string, cup: string,
      cupW: number, ow: number, oh: number, overlap: number, num: string, size: number,
      face: { fx: number; fy: number; d: number }, who: BoardRowView | undefined,
    ): void => {
      this.sprite(card, name + 'Base', `${ART}/leaderboard/${base}`, w, baseH, x, bottom + baseH / 2);
      const cupH = (cupW * oh) / ow;
      const cupY = bottom + baseH - overlap + cupH / 2;
      this.sprite(card, name + 'Cup', `${ART}/leaderboard/${cup}`, cupW, cupH, x, cupY);
      // 把这一名的头像盖在奖杯里的人脸上（「我」跟随本机资料，含微信头像）
      if (who) {
        const d = Math.round(cupW * face.d);
        const ax = x + (face.fx - 0.5) * cupW;
        const ay = cupY + (0.5 - face.fy) * cupH;
        new AvatarView(card, d, ax, ay, who.mine ? null : who.avatar ?? avatarOfName(who.name));
      }
      this.label(card, name + 'Num', num, size, new Color(255, 217, 78), 80, 60, x, bottom + baseH / 2 - 2,
        { outline: new Color(120, 40, 0), outlineWidth: 4 });
    };
    item('Silver', silverX, sw, 77, 'podium-orange', 'cup-silver', 118, 302, 347, 5, '2', 44, CUP_FACE.silver, top[1]);
    item('Bronze', bronzeX, sw, 77, 'podium-orange', 'cup-bronze', 118, 276, 317, 5, '3', 44, CUP_FACE.bronze, top[2]);
    item('Gold', goldX, gw, 105, 'podium-red', 'cup-gold', 170, 397, 424, 13, '1', 52, CUP_FACE.gold, top[0]);
  }

  /** 列中心（行内坐标）：排名 100 | 昵称 1fr | 简单 124 | 困难 124 | 总分 156，间距 12，左右内边距 34 */
  private columns(inner: number): { rank: number; name: number; nameW: number; simple: number; hard: number; total: number } {
    const x0 = -inner / 2 + 34;
    const flex = inner - 68 - 100 - 124 - 124 - 156 - 48;
    const name = x0 + 112;
    const simple = name + flex + 12 + 62;
    const hard = simple + 62 + 12 + 62;
    const total = hard + 62 + 12 + 78;
    return { rank: x0 + 50, name, nameW: flex, simple, hard, total };
  }

  private thead(card: Node, inner: number, y: number): void {
    const head = this.node(card, 'Thead', inner, 66, 0, y);
    this.sprite(head, 'Bg', `${ART}/leaderboard/header`, inner, 66);
    const c = this.columns(inner);
    const ho = { outline: C_HEAD_EDGE, outlineWidth: 2 };
    this.label(head, 'Rank', PANEL.colRank, LB.head, C_HEAD_TEXT, 100, 56, c.rank, 0, ho);
    this.label(head, 'Name', PANEL.colName, LB.head, C_HEAD_TEXT, c.nameW, 56, c.name + 16 + c.nameW / 2, 0, { ...ho, align: 'left' });
    this.label(head, 'Simple', PANEL.colSimple, LB.head, C_HEAD_TEXT, 124, 56, c.simple, 0, ho);
    this.label(head, 'Hard', PANEL.colHard, LB.head, C_HEAD_TEXT, 124, 56, c.hard, 0, ho);
    this.label(head, 'Total', PANEL.colTotal, LB.head, C_HEAD_TEXT, 156, 56, c.total, 0, ho);
  }

  private boardRow(card: Node, inner: number, y: number, r: BoardRowView): void {
    const row = this.node(card, 'Row_' + r.rank, inner, ROW_H, 0, y);
    this.sprite(row, 'Bg', `${ART}/leaderboard/${r.mine ? 'row-mine' : 'row'}`, inner, ROW_H);
    const c = this.columns(inner);
    if (r.rank >= 1 && r.rank <= 4) {
      this.sprite(row, 'Medal', `${ART}/leaderboard/medal-${r.rank}`, 76, 86, c.rank, 0);
    } else {
      const badge = this.node(row, 'Badge', 80, 80, c.rank, 0);
      const g = badge.addComponent(Graphics);
      g.fillColor = new Color(111, 134, 166);
      g.circle(0, 0, 38);
      g.fill();
      this.label(badge, 'N', String(r.rank), r.rank >= 100 ? 32 : LB.rank, C_WHITE, 76, 60, 0, 0, {});
    }
    this.sprite(row, 'Avatar', `${ART}/leaderboard/avatar-${(hashStr(r.name) % 3) + 1}`, 76, 76, c.name + 38, 0);
    // 「我」那行昵称用更深的棕色
    this.label(row, 'Name', r.name, LB.name, r.mine ? new Color(120, 52, 0) : C_BROWN_TEXT, c.nameW - 90, 70,
      c.name + 90 + (c.nameW - 90) / 2, 0, { align: 'left' });
    // 分数：白色细描边，压在浅色行底上不发糊
    const sc = { outline: new Color(255, 255, 255, 230), outlineWidth: 2 };
    this.label(row, 'Simple', String(r.simple), LB.score, C_SIMPLE, 124, 70, c.simple, 0, sc);
    this.label(row, 'Hard', String(r.hard), LB.score, C_HARD, 124, 70, c.hard, 0, sc);
    this.label(row, 'Total', String(r.total), LB.total, C_TOTAL, 156, 70, c.total, 0,
      { outline: new Color(150, 90, 0), outlineWidth: 3 });
  }

  private pager(card: Node, y: number, page: number, pages: number, go: (p: number) => void): void {
    this.pillButton(card, 'PrevPage', PANEL.prevPage, 240, 66, -300, y, () => { if (page > 0) go(page - 1); }, page <= 0);
    this.label(card, 'PageLabel', PANEL.page(page + 1, pages), LB.pager, C_PAGE_TEXT, 300, 60, 0, y, { shadow: true });
    this.pillButton(card, 'NextPage', PANEL.nextPage, 240, 66, 300, y, () => { if (page < pages - 1) go(page + 1); }, page >= pages - 1);
  }

  /** 「挑战本关」：只要通关过就能挑战；否则置灰并说清原因（web challengeState 同口径） */
  private challenge(card: Node, w: number, y: number): void {
    const level = this.boardLevel;
    const status = levelStatus(GS.progress, level);
    const ok = status === 'cleared';
    const hint = status === 'unlocked' ? PANEL.challengeUnclear : PANEL.challengeLocked;
    const b = this.button(card, 'Challenge', w, 104, 0, y, () => {
      if (ok) this.host.onChallenge(level);
      else this.host.toast(hint, 2200);
    }, !ok);
    this.sprite(b, 'Bg', `${ART}/leaderboard/tab-on`, w, 104);
    this.label(b, 'Text', PANEL.challenge, LB.challenge, C_WHITE, w - 60, 90, 0, 4,
      { shadow: true, outline: new Color(120, 60, 10), outlineWidth: 3 });
  }

  private levelSnapshot(level: number) {
    const line = STAR_LINES_BY_MODE[GS.mode]?.[level] ?? [1, 1, 1];
    return boardSnapshot(level, { star1: line[0], star2: line[1], star3: line[2] }, recordOf(GS.progress, level).boardBest);
  }

  /**
   * 榜单行（规则见 核心/rank.ts）：
   *   总榜：示例对手 + 我（总积分 > 0 才上榜），总积分↓ → 总星数↓，竞赛排名；只展示前 100（含并列），
   *         我在 100 名外时把我那一行接在最后（名次照实显示）。
   *   关卡榜：本关本模式 ≥3★ 有效成绩，按上榜分排；「我」那行的简单 / 困难列是两种模式各自的上榜分。
   */
  private boardRows(): BoardRowView[] {
    const normal = GS.data.progress.normal;
    const nightmare = GS.data.progress.nightmare;
    const live = this.liveFor();
    if (live) return live.rows;
    if (this.boardTab === 'total') {
      const me = rankTotals(normal, nightmare);
      const { rows, mine } = totalBoard(me, profileName(), mockTotalRivals());
      const shown = rows.filter((r) => r.rank <= RANK_RULE.topN);
      if (mine && mine.rank > RANK_RULE.topN) shown.push(mine);
      return shown.map((r) => ({
        rank: r.rank, name: r.name, simple: r.simple, hard: r.hard, total: r.total, stars: r.stars, mine: r.mine,
        avatar: r.mine ? undefined : avatarOfName(r.name),
      }));
    }
    const level = this.boardLevel;
    const mode: GameMode = GS.mode;
    return this.levelSnapshot(level).rows.map((r) => {
      if (r.mine) {
        const sb = recordOf(normal, level).boardBest;
        const hb = recordOf(nightmare, level).boardBest;
        return { rank: r.rank, name: profileName(), simple: sb, hard: hb, total: r.score, mine: true };
      }
      const inSimple = mode === 'normal';
      return {
        rank: r.rank, name: r.name, simple: inSimple ? r.score : 0, hard: inSimple ? 0 : r.score, total: r.score,
        mine: false, avatar: avatarOfName(r.name),
      };
    });
  }


  /* ---------------------------------------------------------------- 实时榜单 */

  private liveKey(): string {
    return this.boardTab === 'level' ? `level:${this.boardLevel}:${GS.mode}` : 'total';
  }

  /** 当前 Tab 对应的实时数据（没有 / 不是这个 Tab 的返回 null） */
  private liveFor(): NonNullable<MapPanels['live']> | null {
    return this.live && this.live.key === this.liveKey() ? this.live : null;
  }

  /** 拉当前 Tab 的实时榜（已登录才拉，同一个 Tab 不重复拉）；拉到后重画 */
  private fetchLive(): void {
    const cloud = cloudSync();
    if (!cloud?.loggedIn || this.boardTab === 'friend') return;
    const key = this.liveKey();
    if (this.liveFor() || this.liveLoading === key) return;
    this.liveLoading = key;
    const isLevel = this.boardTab === 'level';
    const level = this.boardLevel;
    const mode = GS.mode;
    void (async () => {
      const res = isLevel
        ? await cloud.api('GET', `/game/api/rank/level?level=${level}&mode=${mode}&limit=${RANK_RULE.topN}`)
        : await cloud.api('GET', `/game/api/rank/global?limit=${RANK_RULE.topN}`);
      const me = isLevel ? null : await cloud.api('GET', '/game/api/rank/me');
      if (this.liveLoading === key) this.liveLoading = '';
      if (!res || res.code !== 200 || !Array.isArray(res.data)) return;   // 失败：继续显示示例数据
      this.live = this.buildLive(key, isLevel, mode, level, res, me);
      this.jumpMine = true;
      if (this.kind === 'board' && this.liveKey() === key) this.render();
    })();
  }

  private buildLive(
    key: string, isLevel: boolean, mode: GameMode, level: number,
    res: Record<string, unknown>, me: Record<string, unknown> | null,
  ): NonNullable<MapPanels['live']> {
    const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);
    const myName = profileName();
    const meData = me && me.code === 200 && me.data && typeof me.data === 'object' ? me.data as Record<string, unknown> : null;
    const myRankRaw = isLevel ? res.myRank : meData && num(meData.totalScore) > 0 ? meData.rank : null;
    const myRank = myRankRaw == null ? null : num(myRankRaw) || null;
    const rows: BoardRowView[] = (res.data as Array<Record<string, unknown>>).map((r) => {
      const name = typeof r.nickname === 'string' && r.nickname ? r.nickname : '玩家';
      if (isLevel) {
        const sc = num(r.levelScore);
        const hard = mode === 'nightmare';
        return {
          rank: num(r.rank), name, simple: hard ? 0 : sc, hard: hard ? sc : 0, total: sc, stars: num(r.totalStars),
          mine: false, avatar: parseAvatar(r.avatar, name),
        };
      }
      return {
        rank: num(r.rank), name, simple: num(r.scoreNormal), hard: num(r.scoreHard),
        total: num(r.totalScore), stars: num(r.totalStars), mine: false, avatar: parseAvatar(r.avatar, name),
      };
    });
    // 认出「我」那一行：名次相同且昵称一致（服务端没收到昵称时显示「玩家」，也认）
    const n = GS.data.progress.normal;
    const h = GS.data.progress.nightmare;
    const local = rankTotals(n, h);
    if (myRank != null) {
      const hit = rows.find((r) => r.rank === myRank && (r.name === myName || r.name === '玩家'));
      if (hit) {
        hit.mine = true;
        hit.name = myName;
        hit.avatar = undefined;   // 我的头像跟随本机资料（可能是微信头像）
      } else {
        // 百名外：把我接在最后（名次照服务端，分数用本地）
        const rec = recordOf(GS.progress, level);
        rows.push(isLevel
          ? { rank: myRank, name: myName, simple: mode === 'nightmare' ? 0 : rec.boardBest, hard: mode === 'nightmare' ? rec.boardBest : 0, total: rec.boardBest, mine: true }
          : { rank: myRank, name: myName, simple: local.simple, hard: local.hard, total: local.total, stars: local.stars, mine: true });
      }
    }
    const ahead = meData && typeof meData.aheadName === 'string'
      ? { name: meData.aheadName as string, score: num(meData.aheadScore), stars: num(meData.aheadStars) }
      : null;
    return { key, rows, myRank, total: isLevel ? num(res.total) : rows.length, ahead };
  }

  /* ================================================================ 图鉴 */

  private renderCollection(): void {
    const top = this.chrome(PANEL.collectionTitle, `${ART}/collection/back`);
    const owned = new Set(unlockedImageIds(GS.data.progress.normal, GS.data.progress.nightmare));
    this.label(this.root, 'Count', PANEL.collected(owned.size, COLLECTION_TOTAL), 58, new Color(217, 236, 125),
      900, 80, 0, top - 6 - 35, { outline: C_TITLE_EDGE, outlineWidth: 4 });

    const cTop = top - 6 - 70 - 14 - 8;
    const cw = W - 32;
    const ch = cTop - this.bottomY();
    const card = this.cardBase(cTop, cw, ch, new Color(141, 188, 240));

    // 底栈从卡底往上：金边带 band → 空 12 → 翻页 pill(66) → 空 16 → 网格
    const band = this.frameBand(ch);
    const pagerY = -ch / 2 + band + 12 + 33;
    const gridTop = ch / 2 - 24;
    const gridBottom = -ch / 2 + band + 12 + 66 + 16;
    const gridW = cw - 36;
    const gridH = gridTop - gridBottom;
    let cellW = (gridW - 2 * CELL_GAP) / 3;
    let cellH = cellW * CELL_RATIO;
    let rows = Math.floor((gridH + CELL_GAP) / (cellH + CELL_GAP));
    if (rows < 2) {
      rows = 2;
      cellH = (gridH - CELL_GAP) / 2;
      cellW = cellH / CELL_RATIO;
    }
    const per = rows * 3;
    const pages = Math.max(1, Math.ceil(COLLECTION_TOTAL / per));
    this.colPage = Math.max(0, Math.min(pages - 1, this.colPage));
    // 网格整体垂直居中在可用区内
    const usedH = rows * cellH + (rows - 1) * CELL_GAP;
    const startY = gridTop - (gridH - usedH) / 2 - cellH / 2;

    for (let k = 0; k < per; k++) {
      const id = this.colPage * per + k;
      if (id >= COLLECTION_TOTAL) break;
      const x = ((k % 3) - 1) * (cellW + CELL_GAP);
      const y = startY - Math.floor(k / 3) * (cellH + CELL_GAP);
      this.collectionCell(card, id, owned.has(id), cellW, cellH, x, y);
    }

    this.pager(card, pagerY, this.colPage, pages, (p) => { this.colPage = p; this.render(); });
    this.cardFrame(card, cw, ch);
  }

  private collectionCell(card: Node, id: number, owned: boolean, w: number, h: number, x: number, y: number): void {
    const cell = this.button(card, 'Cell_' + id, w, h, x, y, () => {
      if (owned) this.openSticker(id);
      else this.host.toast(PANEL.lockedToast, 1800);
    });
    const skin = owned ? CARD_SKINS[id % CARD_SKINS.length] : 'card-locked';
    this.sprite(cell, 'Skin', `${ART}/collection/${skin}`, w, h);
    if (!owned) return;
    // 贴纸放进卡的内框（左 6% / 上 5% / 86% × 89%），等比放大裁掉左右（web 的 object-fit: cover）
    const iw = w * 0.86;
    const ih = h * 0.89;
    const n = this.node(cell, 'Sticker', iw, ih, -w / 2 + w * 0.06 + iw / 2, h / 2 - h * 0.05 - ih / 2);
    const sp = n.addComponent(Sprite);
    sp.sizeMode = Sprite.SizeMode.CUSTOM;
    this.stickerFrame(id, iw / ih, (sf) => { if (sp.isValid) sp.spriteFrame = sf; });
  }

  /** 贴纸纹理按目标宽高比居中裁切（cover），裁切靠 SpriteFrame.rect，不改原图 */
  private stickerFrame(id: number, aspect: number, cb: (sf: SpriteFrame) => void): void {
    const path = `stickers/sticker_${id}`;
    resources.load(path + '/texture', Texture2D, (err, tex) => {
      if (err || !tex) {
        if (!this.warned.has(path)) {
          this.warned.add(path);
          console.warn('[panel] 贴图缺失: ' + path);
        }
        return;
      }
      const tw = tex.width;
      const th = tex.height;
      let cw = tw;
      let chh = th;
      if (tw / th > aspect) cw = th * aspect;
      else chh = tw / aspect;
      const sf = new SpriteFrame();
      sf.texture = tex;
      sf.rect = new Rect((tw - cw) / 2, (th - chh) / 2, cw, chh);
      cb(sf);
    });
  }

  /** 大图查看（下载 / 分享待接微信接口） */
  private openSticker(id: number): void {
    const H = this.host.screenH;
    const layer = this.node(this.root, 'StickerView', W, H);
    const close = (): void => { if (layer.isValid) layer.destroy(); };
    layer.on(Node.EventType.TOUCH_START, (e: EventTouch) => { e.propagationStopped = true; }, this);
    layer.on(Node.EventType.TOUCH_END, (e: EventTouch) => { e.propagationStopped = true; close(); }, this);
    const dim = layer.addComponent(Graphics);
    dim.fillColor = new Color(20, 12, 4, 150);
    dim.rect(-W, -H, W * 2, H * 2);
    dim.fill();

    const cw = 820;
    const ch = 1000;
    const card = this.node(layer, 'Card', cw, ch);
    const g = card.addComponent(Graphics);
    this.roundRect(g, -cw / 2, -ch / 2 - 20, cw, ch, 48, new Color(60, 40, 10, 90));
    this.roundRect(g, -cw / 2, -ch / 2, cw, ch, 48, new Color(255, 248, 231));
    g.lineWidth = 6;
    g.strokeColor = new Color(245, 197, 66);
    g.roundRect(-cw / 2, -ch / 2, cw, ch, 48);
    g.stroke();

    const img = this.node(card, 'Img', 640, 640, 0, ch / 2 - 60 - 320);
    const sp = img.addComponent(Sprite);
    sp.sizeMode = Sprite.SizeMode.CUSTOM;
    this.stickerFrame(id, 1, (sf) => { if (sp.isValid) sp.spriteFrame = sf; });

    const animal = animalOf(id) ?? '未知';
    const mood = IMAGE_MOOD[id] ?? '';
    this.label(card, 'Name', `图${id}  ·  ${animal}${mood ? `·${mood}` : ''}`, 44, new Color(107, 74, 47), cw - 80, 60, 0, ch / 2 - 60 - 640 - 50);
    this.label(card, 'Caption', IMAGE_TEXT_PLACEHOLDER[id] ?? '', 34, new Color(150, 120, 90), cw - 80, 50, 0, ch / 2 - 60 - 640 - 110);

    const btn = this.button(card, 'Close', 300, 96, 0, -ch / 2 + 40 + 48, close);
    this.roundRect(btn.addComponent(Graphics), -150, -48, 300, 96, 48, new Color(255, 176, 62));
    this.label(btn, 'Text', '关闭', 38, C_WHITE, 260, 80);
  }

  /* ================================================================ 设置 */

  private renderSettings(): void {
    const top = this.chrome(PANEL.settingsTitle, `${ART}/settings/back`);
    const cw = W - 120;
    const rowW = cw - 88;
    const rowH = 152;
    const gap = 34;
    const ch = 46 + rowH * 2 + gap + 40;
    const cTop = top - 24;
    const card = this.cardBase(cTop, cw, ch, new Color(92, 58, 39));

    const s = GS.meta.settings;
    const firstY = ch / 2 - 46 - rowH / 2;
    this.settingRow(card, rowW, rowH, firstY, 'icon-music', 156, 174, PANEL.music, s.bgm, () => {
      GS.setBgm(!GS.meta.settings.bgm);
      GS.flush();
      this.render();
    });
    this.settingRow(card, rowW, rowH, firstY - rowH - gap, 'icon-sfx', 188, 170, PANEL.sfx, s.sound, () => {
      GS.setSound(!GS.meta.settings.sound);
      GS.flush();
      this.render();
    });
    this.cardFrame(card, cw, ch);

    const cardBottom = cTop - ch;
    this.label(this.root, 'Version', PANEL.version, 40, new Color(68, 80, 122), 600, 56, 0, cardBottom - 14 - 28);

    const resetY = cardBottom - 14 - 56 - 40 - 45;
    const reset = this.button(this.root, 'Reset', 360, 90, 0, resetY, () => this.host.onReset());
    const g = reset.addComponent(Graphics);
    this.roundRect(g, -180, -45, 360, 90, 45, new Color(255, 255, 255, 220));
    g.lineWidth = 4;
    g.strokeColor = new Color(255, 176, 62);
    g.roundRect(-180, -45, 360, 90, 45);
    g.stroke();
    this.label(reset, 'Text', PANEL.reset, 36, new Color(150, 100, 40), 320, 80);

    // 合规入口一排三个文字按钮（评审 P0-1）：隐私保护指引 / 用户协议 / 适龄提示
    const legalY = resetY - 45 - 40 - 30;
    const legal: Array<[string, 'privacy' | 'agreement' | 'age']> = [
      [PANEL.privacy, 'privacy'], [PANEL.agreement, 'agreement'], [PANEL.ageTip, 'age'],
    ];
    legal.forEach(([text, kind], i) => {
      const btn = this.button(this.root, 'Legal_' + kind, 280, 60, (i - 1) * 300, legalY, () => this.host.onLegal(kind));
      this.label(btn, 'Text', text, 32, new Color(68, 80, 122), 270, 50);
    });
  }

  private settingRow(
    card: Node, w: number, h: number, y: number,
    icon: string, ow: number, oh: number, text: string, on: boolean, onTap: () => void,
  ): void {
    const row = this.button(card, 'Row_' + text, w, h, 0, y, onTap);
    const g = row.addComponent(Graphics);
    this.roundRect(g, -w / 2, -h / 2 - 6, w, h, 34, new Color(30, 15, 5, 70));
    this.roundRect(g, -w / 2, -h / 2, w, h, 34, new Color(110, 72, 49));
    this.roundRect(g, -w / 2 + 6, h / 2 - 14, w - 12, 8, 4, new Color(255, 255, 255, 30));
    // 图标等比放进 96×96
    const k = Math.min(96 / ow, 96 / oh);
    this.sprite(row, 'Icon', `${ART}/settings/${icon}`, ow * k, oh * k, -w / 2 + 40 + 48, 0);
    this.label(row, 'Label', text, 60, new Color(255, 233, 196), w - 420, 90, -w / 2 + 40 + 96 + 28 + (w - 420) / 2, 0,
      { align: 'left', shadow: true });
    this.sprite(row, 'Toggle', `${ART}/settings/${on ? 'toggle-on' : 'toggle-off'}`, 150, 78, w / 2 - 40 - 75, 0);
  }
}
