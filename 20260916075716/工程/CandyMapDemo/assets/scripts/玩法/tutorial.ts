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
  Sprite, SpriteFrame, Texture2D, resources, Rect,
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

/**
 * 棋盘上方的轻横幅。不用 toast：toast 是全局的、会被其它提示顶掉；
 * 教学提示要钉在棋盘上方，玩家视线不用离开盘面。
 */
export class TutorialBanner {
  private root: Node = null!;
  private label: Label = null!;
  private timer = 0;

  static create(parent: Node): TutorialBanner {
    const b = new TutorialBanner();
    b.build(parent);
    return b;
  }

  private build(parent: Node): void {
    const root = new Node('TutorialBanner');
    root.layer = Layers.Enum.UI_2D;
    root.addComponent(UITransform).setContentSize(880, 92);
    const op = root.addComponent(UIOpacity);
    op.opacity = 0;
    root.parent = parent;
    this.root = root;

    const bg = root.addComponent(Graphics);
    bg.roundRect(-440, -46, 880, 92, 46);
    bg.fillColor = new Color(255, 246, 230, 235);
    bg.fill();
    bg.strokeColor = new Color(214, 158, 92, 255);
    bg.lineWidth = 4;
    bg.stroke();

    const ln = new Node('text');
    ln.layer = Layers.Enum.UI_2D;
    ln.addComponent(UITransform).setContentSize(840, 80);
    const l = ln.addComponent(Label);
    l.fontSize = 34;
    l.lineHeight = 44;
    l.color = new Color(90, 50, 25, 255);
    l.string = '';
    ln.parent = root;
    this.label = l;

    root.active = false;
  }

  /** 定位（创建方把横幅钉到棋盘上方） */
  setPosition(x: number, y: number): void {
    this.root.setPosition(x, y, 0);
  }

  /** 显示一句话，`ms` 后淡出（不打断操作、不吃点击） */
  show(text: string, ms = 2000): void {
    if (this.timer) clearTimeout(this.timer);
    this.label.string = text;
    this.root.active = true;
    const op = this.root.getComponent(UIOpacity)!;
    op.opacity = 255;
    this.timer = setTimeout(() => this.hide(), ms) as unknown as number;
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
  private panel: Node = null!;
  private statusNormal: Label = null!;
  private statusNightmare: Label = null!;
  private btnNormalLabel: Label = null!;
  private btnNightmareLabel: Label = null!;
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

    // 遮罩：只吃抽屉自己这一层
    const mask = new Node('mask');
    mask.layer = Layers.Enum.UI_2D;
    mask.addComponent(UITransform).setContentSize(1080, 1920);
    const mg = mask.addComponent(Graphics);
    mg.rect(-540, -960, 1080, 1920);
    mg.fillColor = new Color(0, 0, 0, 130);
    mg.fill();
    mask.parent = root;
    mask.on(Node.EventType.TOUCH_END, () => this.close());

    // 面板：竖长卡片
    const panel = new Node('panel');
    panel.layer = Layers.Enum.UI_2D;
    panel.addComponent(UITransform).setContentSize(940, 1560);
    const pg = panel.addComponent(Graphics);
    pg.roundRect(-470, -780, 940, 1560, 36);
    pg.fillColor = new Color(255, 250, 240, 255);
    pg.fill();
    pg.strokeColor = new Color(214, 158, 92, 255);
    pg.lineWidth = 6;
    pg.stroke();
    panel.parent = root;
    this.panel = panel;

    let y = 740;
    // 标题 + 关闭
    this.addText(panel, TUTORIAL.drawerTitle, 44, 0, y, new Color(90, 50, 25));
    const closeBtn = this.addButton(panel, '✕', 60, 60, 410, y, () => this.close());
    void closeBtn;
    y -= 100;

    // 卡 1：状态
    this.statusNormal = this.addText(panel, '', 32, -330, y, new Color(120, 80, 40));
    this.statusNightmare = this.addText(panel, '', 32, -330, y - 56, new Color(120, 80, 40));
    y -= 160;

    // 卡 2：按钮（主：开始教学；次：重玩困难序章）
    this.btnNormalLabel = this.addButton(panel, TUTORIAL.start, 560, 104, 0, y, () => this.handlers.onStartNormal());
    y -= 130;
    this.btnNightmareLabel = this.addButton(panel, TUTORIAL.replayNightmare, 560, 104, 0, y, () => {
      if (this.btnNightmareDim) return;
      this.handlers.onStartNightmare();
    });
    y -= 170;

    // 卡 3：怎么玩四步（图解用真实贴纸切块画的「3 缺 1 → 拖一步 → 拼成」）
    this.addText(panel, TUTORIAL.howTitle, 36, -360, y, new Color(90, 50, 25));
    y -= 80;
    this.addFigure(panel, TUTORIAL_IMAGE_IDS[0], -300, y);
    const hows: Array<[string, string]> = [
      ['①', TUTORIAL.how1], ['②', TUTORIAL.how2], ['③', TUTORIAL.how3], ['④', TUTORIAL.how4],
    ];
    let hy = y + 60;
    for (const [no, body] of hows) {
      this.addText(panel, no, 30, -110, hy, new Color(214, 158, 92));
      this.addText(panel, body, 30, 140, hy, new Color(90, 50, 25), 560);
      hy -= 58;
    }
    y = hy - 40;

    // 卡 4：补充（小字、辅助色）
    this.addText(panel, TUTORIAL.noteTime, 26, 0, y, new Color(150, 120, 90));
    this.addText(panel, TUTORIAL.noteStar, 26, 0, y - 52, new Color(150, 120, 90));
    this.addText(panel, TUTORIAL.noteNightmare, 26, 0, y - 104, new Color(150, 120, 90));

    root.active = false;
  }

  /** 程序绘制的一行文字（锚点中心，可选宽度换行） */
  private addText(parent: Node, str: string, size: number, x: number, y: number, color: Color, width = 860): Label {
    const n = new Node('t');
    n.layer = Layers.Enum.UI_2D;
    n.addComponent(UITransform).setContentSize(width, size + 16);
    const l = n.addComponent(Label);
    l.fontSize = size;
    l.lineHeight = size + 12;
    l.color = color;
    l.string = str;
    n.parent = parent;
    n.setPosition(x, y, 0);
    return l;
  }

  /** 程序绘制按钮：圆角底 + 文本，返回文本 Label 便于改字 */
  private addButton(parent: Node, str: string, w: number, h: number, x: number, y: number, onTap: () => void): Label {
    const btn = new Node('btn');
    btn.layer = Layers.Enum.UI_2D;
    btn.addComponent(UITransform).setContentSize(w, h);
    const g = btn.addComponent(Graphics);
    g.roundRect(-w / 2, -h / 2, w, h, h / 2);
    g.fillColor = new Color(255, 196, 92, 255);
    g.fill();
    btn.parent = parent;
    btn.setPosition(x, y, 0);

    const ln = new Node('t');
    ln.layer = Layers.Enum.UI_2D;
    ln.addComponent(UITransform).setContentSize(w - 24, h);
    const l = ln.addComponent(Label);
    l.fontSize = Math.min(36, h - 28);
    l.lineHeight = h;
    l.color = new Color(90, 50, 25, 255);
    l.string = str;
    ln.parent = btn;
    btn.on(Node.EventType.TOUCH_END, () => onTap());
    return l;
  }

  /**
   * 图解：左侧「3 缺 1 小棋盘 + 待拖块」→ 右侧「拼成发光 + ✨ +1 组」。
   * 用真实贴纸切块（与棋盘碎片同一套切法），素材缺失时退化为色块。
   */
  private addFigure(parent: Node, imageId: number, x: number, y: number): void {
    const fig = new Node('fig');
    fig.layer = Layers.Enum.UI_2D;
    fig.addComponent(UITransform);
    fig.parent = parent;
    fig.setPosition(x, y, 0);

    const px = 62; // 单块边长
    const gx = px * 2 + 96; // 右列（拼成图）的水平偏移
    const tint = hslColor((imageId * 53 + 25) % 360, 58, 62);

    /** 一块碎片：色块兜底 + 贴纸切块覆盖；`glow` = 拼成后的金色描边 */
    const mkPiece = (cx: number, cy: number, pos: number, glow: boolean): void => {
      const n = new Node('p' + pos);
      n.layer = Layers.Enum.UI_2D;
      n.addComponent(UITransform).setContentSize(px, px);
      const g = n.addComponent(Graphics);
      g.rect(-px / 2, -px / 2, px, px);
      g.fillColor = tint;
      g.fill();
      if (glow) {
        g.strokeColor = new Color(255, 226, 130, 255);
        g.lineWidth = 5;
        g.stroke();
      }
      n.parent = fig;
      n.setPosition(cx, cy, 0);
      this.loadStickerPiece(n, imageId, pos, px);
    };

    // 左列：「3 缺 1」—— 右下角是虚线缺口
    mkPiece(-px, px, 0, false);
    mkPiece(0, px, 1, false);
    mkPiece(-px, 0, 2, false);
    const gap = new Node('gap');
    gap.layer = Layers.Enum.UI_2D;
    gap.addComponent(UITransform).setContentSize(px, px);
    const gg = gap.addComponent(Graphics);
    gg.rect(-px / 2, -px / 2, px, px);
    gg.strokeColor = new Color(214, 158, 92, 255);
    gg.lineWidth = 3;
    gg.stroke();
    gap.parent = fig;
    gap.setPosition(0, 0, 0);
    // 待拖块（在缺口下方，对应 Web 版 tut-fig-move）
    mkPiece(0, -px - 26, 3, false);
    this.addText(fig, '↑', 30, -px - 44, -px / 2 - 26, new Color(214, 158, 92));
    this.addText(fig, '➜', 34, px + 26, 0, new Color(214, 158, 92));

    // 右列：拼成整图（金色描边）+ ✨ +1 组
    mkPiece(gx, px, 0, true);
    mkPiece(gx + px, px, 1, true);
    mkPiece(gx, 0, 2, true);
    mkPiece(gx + px, 0, 3, true);
    this.addText(fig, '✨ +1 组', 26, gx + px, -px - 14, new Color(150, 120, 90), 240);
  }

  /**
   * 加载贴纸的 2×2 切块（与棋盘碎片同一套切法：四等分取样）。
   * 失败（资源缺失）时静默 —— 保留色块兜底。
   */
  private loadStickerPiece(node: Node, imageId: number, pos: number, px: number): void {
    resources.load(`stickers/sticker_${imageId}/texture`, Texture2D, (err, tex) => {
      if (err || !tex || !node.isValid) return;
      const sf = new SpriteFrame();
      sf.setTexture(tex);
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

  open(): void {
    this.isOpenState = true;
    this.root.active = true;
  }

  close(): void {
    if (!this.isOpenState) return;
    this.isOpenState = false;
    this.root.active = false;
    this.handlers.onClose();
  }

  /** 更新两个序章的状态行与困难按钮的可用性 */
  setStatus(normalDone: boolean, nightmareDone: boolean): void {
    this.statusNormal.string = normalDone ? TUTORIAL.doneNormal : TUTORIAL.todoNormal;
    this.statusNightmare.string = nightmareDone ? TUTORIAL.doneNightmare : TUTORIAL.todoNightmare;
    this.btnNightmareDim = !normalDone;
    this.btnNightmareLabel.string = normalDone ? TUTORIAL.replayNightmare : TUTORIAL.nightmareLocked;
    this.btnNormalLabel.string = normalDone ? TUTORIAL.replayNormal : TUTORIAL.start;
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
