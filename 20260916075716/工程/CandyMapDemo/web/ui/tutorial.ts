/**
 * 新手教学（序章）模块（2026-10-26 新增）
 *
 * 方案见 `docs/新手教学（序章）策划案.md`。这里只提供三样东西，流程编排在 `main.ts`：
 *   1. `tutorialConfig(mode)` —— 序章的关卡配置（**不走** `buildLevelPlan()` 的随机图池）；
 *   2. `createTutorialDrawer()` —— 首页右侧抽屉（怎么玩图解 + 重玩序章）；
 *   3. `createTutorialBanner()` —— 棋盘上方轻横幅（达成 1★/2★ 时 2 秒淡出，**非弹窗**）。
 *
 * ⚠️ 为什么不把序章做成「第 1 关」：60 关的编号牵动图鉴解锁（第 1~36 关逐关给图）、
 * 星线、解锁链与存档格数校验；序章是**独立关卡（level 0）**，不进这些系统。
 *
 * ⚠️ 抽屉**不接入** `showScreen()` / `SHEET_SCREENS`：浮层机制会点亮全屏 `#scrim`
 * （z=64，吃所有点击），抽屉是独立组件（自带遮罩），与屏状态机无关。
 */

import { el, STICKER_DIR } from './dom.ts';
import { TUTORIAL } from './text.ts';
import type { GameMode, LevelConfig } from '../../assets/scripts/核心/config.ts';
import { TIME_LIMIT } from '../../assets/scripts/核心/config.ts';
import { buildInitialGrid, buildTutorialGrid } from '../../assets/scripts/核心/index.ts';
import type { Grid, TutorialSwapRule } from '../../assets/scripts/核心/index.ts';
import type { Rng } from '../../assets/scripts/核心/index.ts';

/**
 * 序章固定的 6 张图 = **6 只动物各 1 张「开心」**（台账 `ledger.ts`）：
 * 猫 `0`、虎 `6`、兔 `7`、仓鼠 `8`、狗 `9`、熊 `10`。
 *
 * 选「每只动物只出 1 张」是刻意的：教学关要把**辨识难度压到最低**（ma = 1），
 * 玩家不用分辨"同一只猫的不同表情"，只要认脸就行。
 *
 * ⚠️ 图数**必须等于** `imagesPerLevel(12) = 6`：引擎初始化（`assignPools`）会按
 * 「图数 = (格数 − 8) ÷ 2 + 4」校验，给 3 张会直接抛
 * `本关图数不足，需要 6 张，实际 3 张`（实测踩过）。所以序章是 **6 张图 × 4 块 = 24 块的池**，
 * 场上 12 块从中随机取 —— 教学第一步因此用引擎自己的「可拼提示」圈块，而不是假定
 * 「某张图的 4 块一定都在场上」。
 */
const TUTORIAL_IMAGE_IDS: readonly number[] = [0, 6, 7, 8, 9, 10];

/** 序章星线：1 组 = 1★、2 组 = 2★、3 组 = 3★（达成 3 星即完成，比正式第 1 关 `1/3/5` 轻） */
/**
 * 序章星线：三条都取 **3**。
 *
 * ⚠️ 用户口径（v4.1）：**旗子旁的数字 = 过关分数**。序章的过关条件就是「拼够 3 组」，
 * 所以 `star1`（过关分数）也必须是 3 —— 否则会出现「旗子写 1 分过关、却要拼到 3 组才结束」
 * 这种自相矛盾的教学。三条线一致也不会污染任何系统：序章**不写 progress、不进排行榜、
 * 不进图鉴星数**（结算根本不走 `settleLevel()`）。
 */
const TUTORIAL_STARS: readonly [number, number, number] = [3, 3, 3];

/** 序章种子固定：同一套盘面可复现，教学步骤才有确定的「第一步」 */
export const TUTORIAL_SEED = 20261026;

/** 序章关卡号（不是 1~60 里的任何一关） */
export const TUTORIAL_LEVEL = 0;

/**
 * 序章关卡配置。
 *
 * ⚠️ 手工构造，不走 `buildLevelPlan()` —— 图池必须固定（不能随机抽到 6 张图），
 * 否则「场上一定有某张图的 4 块」这个前提就不成立，教学第一步可能无解。
 */
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
   *
   * ⚠️ **不挨着缺口**（用户要求 v4.1）：简单关摆在**最远处**（一次远距拖动到位），
   * 困难关摆在**最少 2 步**处（一次挪一格，走两步才到）。
   */
  targetIndex: number;
  /** 缺口：拖到这里就拼成（简单一步到位，困难要走几步） */
  gapIndex: number;
  /** 已拼好的 3 块：找路时绕开，别让玩家把它们拖散 */
  fixed: number[];
}

/**
 * 序章开局盘面：优先**手工摆出「3 缺 1」**（核心侧 `buildTutorialGrid`）。
 *
 * 摆不出来（图数 / 网格不合规、校验不过）就退回随机盘面 `buildInitialGrid()` ——
 * 这时返回 `null`，教学**降级为不锁定输入**（宁可不强制，也不能把玩家卡死）。
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

/* ------------------------------------------------------------------ 抽屉里的图解 */

/**
 * 一张贴纸的某一块（2×2 四等分取样，与棋盘碎片同一套切法）。
 *
 * 用**真实素材**而不是示意图：玩家在抽屉里看到的就是进关后要拖的那只动物，
 * 认知零转换。素材缺失时退化成色块（与棋盘灰盒一致）。
 */
function figPiece(imageId: number, pos: number): HTMLElement {
  const d = el('div', 'tut-fig-piece');
  d.style.backgroundImage = `url("${STICKER_DIR}/sticker_${imageId}.png")`;
  d.style.backgroundPosition = `${(pos % 2) * 100}% ${Math.floor(pos / 2) * 100}%`;
  d.style.backgroundColor = `hsl(${(imageId * 53 + 25) % 360} 58% 62%)`;
  return d;
}

/** 一个 2×2 的小棋盘；`gap` = 右下角留空（画虚线缺口） */
function figGrid(imageId: number, gap: boolean): HTMLElement {
  const g = el('div', 'tut-fig-grid');
  g.appendChild(figPiece(imageId, 0));
  g.appendChild(figPiece(imageId, 1));
  g.appendChild(figPiece(imageId, 2));
  if (gap) g.appendChild(el('div', 'tut-fig-gap'));
  else g.appendChild(figPiece(imageId, 3));
  return g;
}

/** 三步图解：「3 缺 1」→ 拖一步 → 拼成发光 */
function createFigure(imageId: number): HTMLElement {
  const fig = el('div', 'tut-fig');

  const left = el('div', 'tut-fig-col');
  left.appendChild(figGrid(imageId, true));
  const move = el('div', 'tut-fig-move');
  move.appendChild(el('span', 'tut-fig-up', '↑'));
  move.appendChild(figPiece(imageId, 3));
  left.appendChild(move);
  fig.appendChild(left);

  fig.appendChild(el('div', 'tut-fig-arrow', '➜'));

  const right = el('div', 'tut-fig-col');
  const done = figGrid(imageId, false);
  done.classList.add('done');
  right.appendChild(done);
  right.appendChild(el('div', 'tut-fig-cap', '✨ +1 组'));
  fig.appendChild(right);

  return fig;
}

/* ------------------------------------------------------------------ 抽屉 */

export interface TutorialDrawerHandlers {
  /** 点「开始教学 / 重玩简单序章」 */
  onStartNormal: () => void;
  /** 点「重玩困难序章」 */
  onStartNightmare: () => void;
  /** 抽屉关闭（用于首次自动展开后落盘 `seen`） */
  onClose: () => void;
}

export interface TutorialDrawer {
  el: HTMLElement;
  open: () => void;
  close: () => void;
  isOpen: () => boolean;
  /**
   * 更新两个序章的状态行与困难按钮的可用性。
   * @param normalDone 简单序章是否已达成 3 星
   * @param nightmareDone 困难序章是否已达成 3 星
   */
  setStatus: (normalDone: boolean, nightmareDone: boolean) => void;
}

export function createTutorialDrawer(handlers: TutorialDrawerHandlers): TutorialDrawer {
  const root = el('div', 'tut-drawer');
  root.hidden = true;

  // 遮罩：只吃抽屉自己这一层，不像 #scrim 那样铺满全屏
  const mask = el('div', 'tut-mask');
  mask.addEventListener('click', () => close());
  root.appendChild(mask);

  const panel = el('div', 'tut-panel');
  const head = el('div', 'tut-head');
  head.appendChild(el('div', 'tut-title', TUTORIAL.drawerTitle));
  const closeBtn = el('button', 'tut-close', '✕');
  closeBtn.type = 'button';
  closeBtn.title = '关闭';
  closeBtn.addEventListener('click', () => close());
  head.appendChild(closeBtn);
  panel.appendChild(head);

  /* 卡 1：状态（带勾选圆标，一屏看清做过没做过） */
  const cardStatus = el('div', 'tut-card');
  const statusNormal = el('div', 'tut-status-line');
  const statusNightmare = el('div', 'tut-status-line');
  cardStatus.appendChild(statusNormal);
  cardStatus.appendChild(statusNightmare);
  panel.appendChild(cardStatus);

  /* 卡 2：按钮（主次分明：主实心 118px、次描边 96px、未解锁置灰带锁） */
  const cardBtns = el('div', 'tut-card');
  const btnNormal = el('button', 'tut-btn primary', TUTORIAL.start);
  btnNormal.type = 'button';
  btnNormal.addEventListener('click', () => handlers.onStartNormal());
  cardBtns.appendChild(btnNormal);

  const btnNightmare = el('button', 'tut-btn ghost', TUTORIAL.replayNightmare);
  btnNightmare.type = 'button';
  btnNightmare.addEventListener('click', () => {
    if (btnNightmare.classList.contains('dim')) return;
    handlers.onStartNightmare();
  });
  cardBtns.appendChild(btnNightmare);
  panel.appendChild(cardBtns);

  /* 卡 3：图解（用**真实贴纸切块**画的「3 缺 1 → 拖一步 → 拼成发光」） */
  const cardHow = el('div', 'tut-card');
  cardHow.appendChild(el('div', 'tut-card-title', TUTORIAL.howTitle));
  cardHow.appendChild(createFigure(TUTORIAL_IMAGE_IDS[0]!));
  const items: Array<[string, string]> = [
    ['①', TUTORIAL.how1],
    ['②', TUTORIAL.how2],
    ['③', TUTORIAL.how3],
    ['④', TUTORIAL.how4],
  ];
  for (const [no, body] of items) {
    const row = el('div', 'tut-how-row');
    row.appendChild(el('span', 'tut-how-no', no));
    row.appendChild(el('span', 'tut-how-body', body));
    cardHow.appendChild(row);
  }
  panel.appendChild(cardHow);

  /* 卡 4：补充（小字、辅助色） */
  const cardNote = el('div', 'tut-card tut-card-note');
  cardNote.appendChild(el('div', 'tut-note-line', TUTORIAL.noteTime));
  cardNote.appendChild(el('div', 'tut-note-line', TUTORIAL.noteStar));
  cardNote.appendChild(el('div', 'tut-note-line', TUTORIAL.noteNightmare));
  panel.appendChild(cardNote);

  root.appendChild(panel);

  function open(): void {
    root.hidden = false;
    void root.offsetWidth; // 强制 reflow，保证 transition 生效
    root.classList.add('on');
  }

  function close(): void {
    root.classList.remove('on');
    window.setTimeout(() => {
      root.hidden = true;
    }, 220);
    handlers.onClose();
  }

  return {
    el: root,
    open,
    close,
    isOpen: () => !root.hidden,
    setStatus(normalDone: boolean, nightmareDone: boolean): void {
      statusNormal.textContent = normalDone ? TUTORIAL.doneNormal : TUTORIAL.todoNormal;
      statusNormal.classList.toggle('done', normalDone);
      statusNightmare.textContent = nightmareDone ? TUTORIAL.doneNightmare : TUTORIAL.todoNightmare;
      statusNightmare.classList.toggle('done', nightmareDone);
      // 困难序章要简单序章先达成 3 星（沿用正式关「同关简单三星」的门槛口径）
      btnNightmare.classList.toggle('dim', !normalDone);
      btnNightmare.textContent = normalDone ? TUTORIAL.replayNightmare : TUTORIAL.nightmareLocked;
      btnNormal.textContent = normalDone ? TUTORIAL.replayNormal : TUTORIAL.start;
    },
  };
}

/* ------------------------------------------------------------------ 轻横幅 */

export interface TutorialBanner {
  el: HTMLElement;
  /** 显示一句话，2 秒后淡出（不打断操作、不吃点击） */
  show: (text: string, ms?: number) => void;
  hide: () => void;
}

/**
 * 棋盘上方的轻横幅。
 *
 * 之所以不用 toast：toast 是全局的、会被其它提示顶掉；教学提示要**钉在棋盘上方**，
 * 玩家视线不用离开盘面（UX 考量：教学中途尽量少转移注意力）。
 */
export function createTutorialBanner(): TutorialBanner {
  const root = el('div', 'tut-banner');
  root.hidden = true;
  let timer = 0;

  function hide(): void {
    window.clearTimeout(timer);
    root.classList.remove('on');
    timer = window.setTimeout(() => {
      root.hidden = true;
    }, 200);
  }

  return {
    el: root,
    show(text: string, ms = 2000): void {
      window.clearTimeout(timer);
      root.textContent = text;
      root.hidden = false;
      void root.offsetWidth;
      root.classList.add('on');
      timer = window.setTimeout(hide, ms);
    },
    hide,
  };
}
