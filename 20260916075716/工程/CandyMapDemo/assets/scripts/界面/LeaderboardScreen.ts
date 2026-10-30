/**
 * 排行榜整屏（从 web/ui/leaderboard.ts 移植，2026-10-30）
 *
 * 结构同图鉴 / 设置整屏：蓝天底 + 棕返回圆钮 + 标题 + 一张金框木卡。
 * 卡内自上而下 = 胶囊双 Tab（总分榜 / 关卡榜）→ 关卡步进器（仅关卡榜）
 * → 我的成绩条（排名 / 分数 / 星数）→ 金银铜奖杯领奖台 → 表头条 → 榜单行（可滚动）
 * → 分页器（每页 20 名）→ **「挑战本关」通栏按钮**（仅关卡榜，产品硬要求）。
 *
 * ⚠️ 本机玩家那一行黄色高亮（`MINE_BG`），总分榜里永远有「我」，关卡榜按 `view.myRank` 判。
 * ⚠️ 「挑战本关」只在关卡榜出现；置灰时按钮上直接写原因（Web 版同口径），
 *    点了才走 `onHint` 提示 —— 不静默吞掉点击。
 *
 * 素材：杯 / 奖牌 / 头像 / 领奖台全部**程序绘制**（Graphics + Label），
 * 不引入任何新切图 —— 本项目一贯做法。数据口径在 `leaderboardModel.ts`（可单测）。
 */

import { Node, UITransform, Graphics, Label, Color, Layers, ScrollView } from 'cc';
import { LEADERBOARD } from '../玩法/text';
import { mkLabel } from './CollectionScreen';
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

/* ------------------------------------------------------------------ 布局常量（1080×1920 基准） */

const CARD_W = 960;
const CARD_H = 1440;
const CARD_Y = -60;

const TAB_W = 380;
const TAB_H = 92;
const TAB_Y = 640;

const STEP_Y = 530;
const STEP_BTN_W = 96;
const STEP_BTN_H = 76;

const MINE_Y = 420;
const MINE_H = 130;
const MINE_CELL_W = 280;

const PODIUM_Y = 225;
const PODIUM_H = 250;
/** 领奖台三档：亚军银（左）/ 冠军金（中，抬高）/ 季军铜（右） */
const PODIUM_SPEC = [
  { pos: 'silver', x: -280, cup: new Color(206, 212, 222, 255), base: new Color(238, 150, 60, 255), baseH: 95, cupH: 68 },
  { pos: 'gold', x: 0, cup: new Color(255, 206, 84, 255), base: new Color(214, 90, 80, 255), baseH: 130, cupH: 80 },
  { pos: 'bronze', x: 280, cup: new Color(205, 150, 96, 255), base: new Color(238, 150, 60, 255), baseH: 95, cupH: 68 },
] as const;

const HEAD_Y = 55;
const ROW_H = 76;
const LIST_W = 880;
const LIST_H = 485;
const LIST_Y = -228;

const PAGER_Y = -535;
const CHALLENGE_Y = -640;
const CHALLENGE_W = 760;
const CHALLENGE_H = 110;

/** 表头 / 行的五列 x（与 Web 版五栏对齐：排名 / 昵称 / 简单 / 困难 / 总分） */
const COL = { rank: -400, name: -170, simple: 60, hard: 220, total: 380 };
const COL_W = { rank: 70, name: 280, simple: 120, hard: 120, total: 140 };

const SKY = new Color(155, 215, 242, 255);
const CARD_BG = new Color(158, 112, 66, 255);
const CARD_LINE = new Color(240, 196, 110, 255);
const TEXT_BROWN = new Color(90, 50, 25, 255);
const TEXT_CREAM = new Color(255, 245, 225, 255);
const GOLD = new Color(255, 196, 92, 255);
const GOLD_DEEP = new Color(240, 176, 64, 255);
const DIM = new Color(118, 118, 126, 255);
const ROW_BG = new Color(255, 248, 232, 255);
/** 本机玩家行高亮（Web 版 `lb-row.mine`） */
const MINE_BG = new Color(255, 222, 130, 255);
/** 头像三种程序配色（对应 Web 版 3 张头像切图） */
const AVATAR_COLORS = [
  new Color(126, 176, 232, 255),
  new Color(247, 176, 186, 255),
  new Color(150, 210, 160, 255),
];
/** 1~4 名的盾牌徽章配色 */
const MEDAL_COLORS = [
  new Color(255, 206, 84, 255),
  new Color(206, 212, 222, 255),
  new Color(205, 150, 96, 255),
  new Color(170, 206, 150, 255),
];

interface Btn {
  node: Node;
  label: Label;
  /** 重画：换填充色 + 换文字（置灰态走这一条） */
  paint: (fill: Color, textColor: Color) => void;
}

export class LeaderboardScreen {
  private root: Node = null!;
  private h: LeaderboardHandlers;

  private curLevel = 1;
  private maxLevel = LEADERBOARD_MAX_LEVEL;
  private tab: 'total' | 'level' = 'total';
  private page = 1;

  private tabBtns: Record<'total' | 'level', Btn> = null!;
  private stepBar: Node = null!;
  private stepLabel: Label = null!;
  private stepPrev: Btn = null!;
  private stepNext: Btn = null!;
  private mineCells: Node = null!;
  private podium: Node = null!;
  private content: Node = null!;
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

    const bg = new Node('bg');
    bg.layer = Layers.Enum.UI_2D;
    bg.addComponent(UITransform).setContentSize(1080, 1920);
    const g = bg.addComponent(Graphics);
    g.rect(-540, -960, 1080, 1920);
    g.fillColor = SKY;
    g.fill();
    bg.parent = root;

    const back = new Node('back');
    back.layer = Layers.Enum.UI_2D;
    back.addComponent(UITransform).setContentSize(96, 96);
    back.setPosition(-450, 850, 0);
    const bgc = back.addComponent(Graphics);
    bgc.circle(0, 0, 48);
    bgc.fillColor = new Color(150, 106, 62, 255);
    bgc.fill();
    back.parent = root;
    mkLabel(back, '‹', 64, 0, 4, new Color(255, 255, 255), 96);
    back.on(Node.EventType.TOUCH_END, () => this.h.onBack());

    mkLabel(root, LEADERBOARD.title, 56, 0, 850, TEXT_BROWN, 400);

    const card = new Node('card');
    card.layer = Layers.Enum.UI_2D;
    card.addComponent(UITransform).setContentSize(CARD_W, CARD_H);
    card.setPosition(0, CARD_Y, 0);
    const cg = card.addComponent(Graphics);
    cg.roundRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, 30);
    cg.fillColor = CARD_BG;
    cg.fill();
    cg.lineWidth = 10;
    cg.strokeColor = CARD_LINE;
    cg.roundRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, 30);
    cg.stroke();
    card.parent = root;

    // 双 Tab：总分榜（左）/ 关卡榜（右），默认总分榜
    this.tabBtns = {
      total: this.mkPill(card, LEADERBOARD.tabTotal, -TAB_W / 2 - 10, TAB_Y, () => this.setTab('total')),
      level: this.mkPill(card, LEADERBOARD.tabLevel, TAB_W / 2 + 10, TAB_Y, () => this.setTab('level')),
    };

    // 关卡步进器「‹ 第 N 关 ›」—— 只有关卡榜显示（总分榜没有「本关」概念）
    this.stepBar = new Node('stepBar');
    this.stepBar.layer = Layers.Enum.UI_2D;
    this.stepBar.addComponent(UITransform).setContentSize(CARD_W - 80, STEP_BTN_H);
    this.stepBar.setPosition(0, STEP_Y, 0);
    this.stepBar.parent = card;
    this.stepPrev = this.mkSquare(this.stepBar, '‹', -240, 0, () => this.render(this.curLevel - 1, this.maxLevel));
    this.stepLabel = mkLabel(this.stepBar, '', 44, 0, 0, TEXT_CREAM, 320);
    this.stepNext = this.mkSquare(this.stepBar, '›', 240, 0, () => this.render(this.curLevel + 1, this.maxLevel));

    // 我的成绩条：三格等分（排名 / 分数 / 星数）
    this.mineCells = new Node('mine');
    this.mineCells.layer = Layers.Enum.UI_2D;
    this.mineCells.addComponent(UITransform).setContentSize(CARD_W - 80, MINE_H);
    this.mineCells.setPosition(0, MINE_Y, 0);
    this.mineCells.parent = card;

    // 领奖台（前三 = 金银铜奖杯）
    this.podium = new Node('podium');
    this.podium.layer = Layers.Enum.UI_2D;
    this.podium.addComponent(UITransform).setContentSize(CARD_W - 80, PODIUM_H);
    this.podium.setPosition(0, PODIUM_Y, 0);
    this.podium.parent = card;

    // 表头条
    const head = new Node('thead');
    head.layer = Layers.Enum.UI_2D;
    head.addComponent(UITransform).setContentSize(LIST_W, 50);
    head.setPosition(0, HEAD_Y, 0);
    head.parent = card;
    mkLabel(head, LEADERBOARD.colRank, 30, COL.rank, 0, TEXT_CREAM, COL_W.rank);
    mkLabel(head, LEADERBOARD.colName, 30, COL.name, 0, TEXT_CREAM, COL_W.name);
    mkLabel(head, LEADERBOARD.colSimple, 30, COL.simple, 0, TEXT_CREAM, COL_W.simple);
    mkLabel(head, LEADERBOARD.colHard, 30, COL.hard, 0, TEXT_CREAM, COL_W.hard);
    mkLabel(head, LEADERBOARD.colTotal, 30, COL.total, 0, TEXT_CREAM, COL_W.total);

    // 榜单行（可滚动；表头与领奖台固定）
    const svNode = new Node('list');
    svNode.layer = Layers.Enum.UI_2D;
    svNode.addComponent(UITransform).setContentSize(LIST_W, LIST_H);
    svNode.setPosition(0, LIST_Y, 0);
    svNode.parent = card;
    const sv = svNode.addComponent(ScrollView);
    sv.vertical = true;
    sv.horizontal = false;
    const content = new Node('content');
    content.layer = Layers.Enum.UI_2D;
    content.addComponent(UITransform).setContentSize(LIST_W, ROW_H);
    content.parent = svNode;
    sv.content = content;
    this.content = content;

    // 分页器（每页 20 名）
    const pager = new Node('pager');
    pager.layer = Layers.Enum.UI_2D;
    pager.addComponent(UITransform).setContentSize(CARD_W - 80, 70);
    pager.setPosition(0, PAGER_Y, 0);
    pager.parent = card;
    this.pagePrev = this.mkSquare(pager, '‹', -300, 0, () => this.goPage(this.page - 1));
    this.pageLabel = mkLabel(pager, '', 32, 0, 0, TEXT_CREAM, 340);
    this.pageNext = this.mkSquare(pager, '›', 300, 0, () => this.goPage(this.page + 1));

    // 「挑战本关」通栏按钮（仅关卡榜）
    this.challengeBtn = this.mkPill(
      card,
      LEADERBOARD.challenge,
      0,
      CHALLENGE_Y,
      () => this.onChallengeTap(),
      CHALLENGE_W,
      CHALLENGE_H,
      34,
    );
  }

  /* ------------------------------------------------------------ 小控件 */

  /** 胶囊按钮（Tab / 挑战本关）：可改填充色与文字色 */
  private mkPill(
    parent: Node,
    text: string,
    x: number,
    y: number,
    onTap: () => void,
    w = TAB_W,
    h = TAB_H,
    fontSize = 40,
  ): Btn {
    const node = new Node('btn');
    node.layer = Layers.Enum.UI_2D;
    node.addComponent(UITransform).setContentSize(w, h);
    node.setPosition(x, y, 0);
    const g = node.addComponent(Graphics);
    node.parent = parent;
    const label = mkLabel(node, text, fontSize, 0, 0, TEXT_BROWN, w - 40);
    const paint = (fill: Color, textColor: Color): void => {
      g.clear();
      g.roundRect(-w / 2, -h / 2, w, h, h / 2);
      g.fillColor = fill;
      g.fill();
      label.color = textColor;
    };
    paint(GOLD, TEXT_BROWN);
    node.on(Node.EventType.TOUCH_END, onTap);
    return { node, label, paint };
  }

  /** 方形小钮（步进 / 翻页）：置灰时画灰底 */
  private mkSquare(parent: Node, text: string, x: number, y: number, onTap: () => void): Btn {
    const node = new Node('btn');
    node.layer = Layers.Enum.UI_2D;
    node.addComponent(UITransform).setContentSize(STEP_BTN_W, STEP_BTN_H);
    node.setPosition(x, y, 0);
    const g = node.addComponent(Graphics);
    node.parent = parent;
    const label = mkLabel(node, text, 44, 0, 0, TEXT_BROWN, STEP_BTN_W);
    const paint = (fill: Color, textColor: Color): void => {
      g.clear();
      g.roundRect(-STEP_BTN_W / 2, -STEP_BTN_H / 2, STEP_BTN_W, STEP_BTN_H, 18);
      g.fillColor = fill;
      g.fill();
      label.color = textColor;
    };
    paint(GOLD, TEXT_BROWN);
    node.on(Node.EventType.TOUCH_END, onTap);
    return { node, label, paint };
  }

  /* ------------------------------------------------------------ 渲染 */

  /** 切到某一关并重绘（`maxLevel` 省略时用核心层的关卡上限） */
  render(level: number, maxLevel: number = this.maxLevel): void {
    this.maxLevel = Math.max(1, maxLevel);
    this.curLevel = Math.min(Math.max(1, level), this.maxLevel);
    this.page = 1; // 换关 / 打开回到第 1 页
    this.stepLabel.string = LEADERBOARD.header(this.curLevel);
    this.stepPrev.paint(this.curLevel <= 1 ? DIM : GOLD, this.curLevel <= 1 ? TEXT_CREAM : TEXT_BROWN);
    this.stepNext.paint(this.curLevel >= this.maxLevel ? DIM : GOLD, this.curLevel >= this.maxLevel ? TEXT_CREAM : TEXT_BROWN);
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
        return {
          ...r,
          simple: view.myScores.simple,
          hard: view.myScores.hard,
          total: view.myScores.simple + view.myScores.hard,
        };
      }
      return { ...r, ...mockRowScores(r.score, view.mode) };
    });
  }

  private refresh(): void {
    const rows = this.currentRows();
    const isLevel = this.tab === 'level';

    // Tab：选中金底棕字，未选中暗金底奶字；步进器与「挑战本关」只出现在关卡榜
    this.tabBtns.total.paint(isLevel ? GOLD_DEEP : GOLD, isLevel ? TEXT_CREAM : TEXT_BROWN);
    this.tabBtns.level.paint(isLevel ? GOLD : GOLD_DEEP, isLevel ? TEXT_BROWN : TEXT_CREAM);
    this.stepBar.active = isLevel;
    this.challengeBtn.node.active = isLevel;

    this.renderMine(rows);
    this.renderPodium(rows);
    this.renderRows(rows);
    this.renderPager(rows.length);

    if (isLevel) {
      const view = this.h.view(this.curLevel);
      const dim = view.challenge.dim;
      this.challengeBtn.label.string = dim ? view.challenge.hint : LEADERBOARD.challenge;
      this.challengeBtn.paint(dim ? DIM : GOLD, dim ? TEXT_CREAM : TEXT_BROWN);
    }
  }

  /** 我的成绩单：三格等分 —— 我的排名 / 分数（总分榜=累计总分，关卡榜=本关最高分）/ 累计星数 */
  private renderMine(rows: LeaderboardRow[]): void {
    for (const c of this.mineCells.children.slice()) c.destroy();
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
    const cells: Array<[string, string]> = [
      [LEADERBOARD.mineRankLabel, LEADERBOARD.rankValue(mine ? mine.rank : 0)],
      [isLevel ? LEADERBOARD.mineLevelScoreLabel : LEADERBOARD.mineScoreLabel, LEADERBOARD.scoreValue(score)],
      [LEADERBOARD.mineStarsLabel, LEADERBOARD.starsValue(stars)],
    ];
    cells.forEach(([label, value], i) => {
      const box = new Node('cell' + i);
      box.layer = Layers.Enum.UI_2D;
      box.addComponent(UITransform).setContentSize(MINE_CELL_W, MINE_H);
      box.setPosition((i - 1) * (MINE_CELL_W + 12), 0, 0);
      const g = box.addComponent(Graphics);
      g.roundRect(-MINE_CELL_W / 2, -MINE_H / 2, MINE_CELL_W, MINE_H, 24);
      g.fillColor = new Color(120, 82, 48, 255);
      g.fill();
      g.lineWidth = 4;
      g.strokeColor = CARD_LINE;
      g.roundRect(-MINE_CELL_W / 2, -MINE_H / 2, MINE_CELL_W, MINE_H, 24);
      g.stroke();
      box.parent = this.mineCells;
      mkLabel(box, label, 26, 0, 32, TEXT_CREAM, MINE_CELL_W);
      mkLabel(box, value, 48, 0, -22, GOLD, MINE_CELL_W);
    });
  }

  /** 领奖台：前三名换上金银铜奖杯，冠军底座抬高并写「1」 */
  private renderPodium(rows: LeaderboardRow[]): void {
    for (const c of this.podium.children.slice()) c.destroy();
    const bottom = -PODIUM_H / 2;
    for (let i = 0; i < PODIUM_SPEC.length; i++) {
      const spec = PODIUM_SPEC[i]!;
      const row = rows[i];
      const item = new Node('podium' + i);
      item.layer = Layers.Enum.UI_2D;
      item.addComponent(UITransform).setContentSize(240, PODIUM_H);
      item.setPosition(spec.x, 0, 0);
      item.parent = this.podium;
      if (!row) continue;

      // 杯（程序绘制：梯形杯身 + 两侧把手 + 杯脚）
      const cup = new Node('cup');
      cup.layer = Layers.Enum.UI_2D;
      cup.addComponent(UITransform).setContentSize(120, spec.cupH);
      cup.setPosition(0, bottom + spec.baseH + 6 + spec.cupH / 2, 0);
      cup.parent = item;
      this.drawCup(cup.addComponent(Graphics), spec.cup, spec.cupH);

      // 底座（冠军更高一截，写「1」）
      const base = new Node('base');
      base.layer = Layers.Enum.UI_2D;
      base.addComponent(UITransform).setContentSize(220, spec.baseH);
      base.setPosition(0, bottom + spec.baseH / 2, 0);
      const bg = base.addComponent(Graphics);
      bg.roundRect(-110, -spec.baseH / 2, 220, spec.baseH, 16);
      bg.fillColor = spec.base;
      bg.fill();
      base.parent = item;
      mkLabel(base, String(row.rank), 44, 0, spec.baseH / 2 - 42, new Color(255, 255, 255), 120);
      mkLabel(base, row.name, 28, 0, -spec.baseH / 2 + 30, new Color(255, 255, 255), 200);

      // 分数（杯上方）
      mkLabel(
        item,
        LEADERBOARD.scoreValue(row.total ?? row.score),
        30,
        0,
        bottom + spec.baseH + 6 + spec.cupH + 20,
        TEXT_CREAM,
        240,
      );
    }
  }

  /** 奖杯：杯身梯形 + 两条把手弧 + 杯脚（不引入切图） */
  private drawCup(g: Graphics, color: Color, h: number): void {
    const w = 92;
    const top = h / 2;
    const neck = -h / 6;
    g.fillColor = color;
    g.moveTo(-w / 2, top);
    g.lineTo(w / 2, top);
    g.lineTo((w / 2) * 0.55, neck);
    g.lineTo((-w / 2) * 0.55, neck);
    g.close();
    g.fill();
    g.lineWidth = 8;
    g.strokeColor = color;
    g.moveTo(-w / 2, top - 10);
    g.quadraticCurveTo(-w / 2 - 26, 0, (-w / 2) * 0.6, neck + 6);
    g.stroke();
    g.moveTo(w / 2, top - 10);
    g.quadraticCurveTo(w / 2 + 26, 0, (w / 2) * 0.6, neck + 6);
    g.stroke();
    g.fillColor = color;
    g.rect(-9, neck - 26, 18, 26);
    g.fill();
    g.roundRect(-34, neck - 42, 68, 16, 6);
    g.fill();
  }

  private renderRows(rows: LeaderboardRow[]): void {
    const ct = this.content.getComponent(UITransform)!;
    const shown = pageRows(rows, this.page);
    ct.setContentSize(LIST_W, Math.max(ROW_H, shown.length * ROW_H));

    for (const c of this.content.children.slice()) c.destroy();
    if (shown.length === 0) {
      const empty = new Node('empty');
      empty.layer = Layers.Enum.UI_2D;
      empty.addComponent(UITransform).setContentSize(LIST_W, ROW_H);
      empty.parent = this.content;
      mkLabel(empty, LEADERBOARD.empty, 34, 0, 0, TEXT_BROWN, LIST_W);
      return;
    }

    const top = ct.height / 2 - ROW_H / 2;
    shown.forEach((row, i) => {
      const item = new Node('row' + i);
      item.layer = Layers.Enum.UI_2D;
      item.addComponent(UITransform).setContentSize(LIST_W, ROW_H);
      item.setPosition(0, top - i * ROW_H, 0);
      const g = item.addComponent(Graphics);
      g.roundRect(-LIST_W / 2, -ROW_H / 2 + 4, LIST_W, ROW_H - 8, 16);
      g.fillColor = row.mine ? MINE_BG : ROW_BG;
      g.fill();
      item.parent = this.content;

      // 名次：1-4 名用盾牌徽章，其后用数字
      if (row.rank >= 1 && row.rank <= 4) {
        const badge = new Node('medal');
        badge.layer = Layers.Enum.UI_2D;
        badge.addComponent(UITransform).setContentSize(56, 56);
        badge.setPosition(COL.rank, 0, 0);
        const bgc = badge.addComponent(Graphics);
        bgc.circle(0, 0, 28);
        bgc.fillColor = MEDAL_COLORS[row.rank - 1]!;
        bgc.fill();
        badge.parent = item;
        mkLabel(badge, String(row.rank), 32, 0, 0, TEXT_BROWN, 56);
      } else {
        mkLabel(item, String(row.rank), 32, COL.rank, 0, TEXT_BROWN, COL_W.rank);
      }

      // 头像：程序绘制的圆底 + 昵称首字（同一玩家配色稳定）
      const av = new Node('avatar');
      av.layer = Layers.Enum.UI_2D;
      av.addComponent(UITransform).setContentSize(56, 56);
      av.setPosition(COL.rank + 78, 0, 0);
      const ag = av.addComponent(Graphics);
      ag.circle(0, 0, 28);
      ag.fillColor = AVATAR_COLORS[avatarIndexOf(row.name)]!;
      ag.fill();
      av.parent = item;
      mkLabel(av, row.name.slice(0, 1), 30, 0, 0, new Color(255, 255, 255), 56);

      mkLabel(item, row.name, 30, COL.name, 0, TEXT_BROWN, COL_W.name);
      mkLabel(item, String(row.simple ?? 0), 30, COL.simple, 0, TEXT_BROWN, COL_W.simple);
      mkLabel(item, String(row.hard ?? 0), 30, COL.hard, 0, TEXT_BROWN, COL_W.hard);
      mkLabel(item, String(row.total ?? row.score), 34, COL.total, 0, GOLD_DEEP, COL_W.total);
    });
  }

  private renderPager(count: number): void {
    const pages = pageCountOf(count);
    this.page = clampPage(this.page, count);
    this.pageLabel.string = LEADERBOARD.page(this.page, pages);
    this.pagePrev.paint(this.page <= 1 ? DIM : GOLD, this.page <= 1 ? TEXT_CREAM : TEXT_BROWN);
    this.pageNext.paint(this.page >= pages ? DIM : GOLD, this.page >= pages ? TEXT_CREAM : TEXT_BROWN);
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
