/**
 * 排行榜整屏的**数据层**（从 web/ui/leaderboard.ts 移植，2026-10-30）。
 *
 * 为什么单独拆一个文件：整屏组件（`LeaderboardScreen.ts`）要 import `cc`，
 * 在 Node 单测里根本加载不了；而榜单里最容易出错的恰恰是**纯数据口径**
 * （模拟玩家的两列分数怎么放、「挑战本关」什么时候置灰、每页切多少行）。
 * 把这些抽出来后，单测可以直接 import 本文件验证口径，不必开浏览器。
 *
 * ⚠️ **没有后端**：1000 名玩家（基石数据）来自 `核心/honor.ts` 的确定性 mock（本地模拟数据，
 * 同一关每次打开都一样），界面上必须写明这一点（`LEADERBOARD` 文案里的口径说明）。
 *
 * ── 两列（简单 / 困难）的口径（2026-11-03 用户定稿）────────────────
 *   · **AI 角色**：每关先有总分 `mockBoardScores`，再按 `mockSplitOf` 拆成
 *     简单 = 总分 × 60%~80%（确定性随机）、困难 = 总分 − 简单分；
 *     总分榜 = 第 1~66 关逐关累加（67 关起不再有 AI 分数）。
 *   · **本机玩家**：永远用两套进度表里的**真实值**（`myScores` / `myTotals`），不做任何拆分 ——
 *     历史 bug 说的就是这条：曾经把玩家自己的一次得分按 0.6 / 0.4 硬拆，
 *     结果「困难 9 分」显示出来，而玩家根本没玩过困难模式。
 */

import {
  LEVEL_STAR_LINES,
  AI_SCORE_MAX_LEVEL,
  mockBoardNames,
  mockBoardScores,
  mockSplitOf,
  TOTAL_LEVELS,
  type LevelStatus,
  type GameMode,
} from '../核心/index';
import { LEADERBOARD } from '../玩法/text';

/** 《通关及排名》§七：每页 20 名 */
export const LEADERBOARD_PAGE_SIZE = 20;

/** 关卡榜的关卡上限（与 Web 版一致，跟随核心层 `TOTAL_LEVELS`） */
export const LEADERBOARD_MAX_LEVEL = TOTAL_LEVELS;

/** 头像切图只有 3 张（Cocos 端是 3 种程序绘制的配色） */
export const AVATAR_VARIANTS = 3;

export interface LeaderboardRow {
  rank: number;
  name: string;
  /** 关卡榜里 = 上榜最高分；总分榜里 = 累计总分 */
  score: number;
  /** 是否为本机玩家 */
  mine?: boolean;
  /** 设计图四栏：简单分 / 困难分 / 总分（总分榜里 score 即总分） */
  simple?: number;
  hard?: number;
  total?: number;
}

export interface ChallengeState {
  dim: boolean;
  hint: string;
}

export interface LeaderboardView {
  level: number;
  /** 百强榜条目（名次 ≤ 100，含并列） */
  rows: LeaderboardRow[];
  /** 本关总玩家数（去重：模拟玩家 + 本机） */
  totalPlayers: number;
  /** 我的名次；null = 暂未上榜 */
  myRank: number | null;
  /** 我在榜上的最高分；0 = 暂未上榜 */
  boardBest: number;
  /** 本关个人最高分（含 1★/2★/续命；0 = 没打过） */
  personalBest: number;
  /**
   * 我在本关**两套模式各自的最高分**（简单 / 困难分开记，没玩过 = 0）。
   * 分模式的成绩只能来自各自的进度表，不允许由单个分数按比例拆。
   */
  myScores: { simple: number; hard: number };
  /**
   * 当前玩法模式（仅作记录）。
   *
   * 2026-11-03 起 AI 角色两列都按 60%~80% 拆分（`mockRowScores`），不再「只落当前模式那一列」，
   * 所以这里不再参与 AI 行的列计算；本机行一直用 `myScores`。
   */
  mode: GameMode;
  /** 「挑战本关」按钮状态 */
  challenge: ChallengeState;
}

/**
 * 「挑战本关」按钮状态（§9.3 状态机）。
 *
 * 只要通关过就允许挑战，1★ / 2★ / 3★ 一视同仁。置灰只有三种原因，且必须说清是哪一种。
 */
export function challengeState(level: number, status: LevelStatus, playable: boolean): ChallengeState {
  if (!playable) return { dim: true, hint: LEADERBOARD.challengeUnavailable(level) };
  if (status === 'cleared') return { dim: false, hint: '' };
  return {
    dim: true,
    hint: status === 'unlocked' ? LEADERBOARD.challengeUnclear : LEADERBOARD.challengeLocked,
  };
}

/**
 * 关卡榜里 AI 角色那一行的三栏。
 *
 * 用户口径（2026-11-03）：简单分 = 该关总分 × 60%~80%（确定性随机），
 * 困难分 = 总分 − 简单分 —— 两列都 > 0，百分比由 `mockSplitOf` 保证稳定。
 * 本机玩家（`mine`）不用这个函数，走 `view.myScores`（两套进度表的真实值）。
 */
export function mockRowScores(
  level: number,
  name: string,
  score: number,
): { simple: number; hard: number; total: number } {
  const split = mockSplitOf(level, name, score);
  return { simple: split.simple, hard: split.hard, total: split.total };
}

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** 金圈头像（Cocos 端是程序绘制的三种配色）：按昵称哈希稳定取一种，同一玩家不变 */
export function avatarIndexOf(name: string): number {
  return hashStr(name) % AVATAR_VARIANTS;
}

/** AI 角色累计分的缓存（确定性数据，与「我」无关，算一次就够） */
let mockTotalsCache: Array<{ name: string; simple: number; hard: number; total: number }> | null = null;

/**
 * 1000 个 AI 角色的累计成绩 = **第 1~66 关逐关相加**（用户口径 2026-11-03）。
 *
 * 每关：`mockBoardScores` 给总分 → `mockSplitOf` 拆简单/困难 → 按昵称累加。
 * 67 关起 `mockBoardScores` 返回空（`AI_SCORE_MAX_LEVEL`），所以后面的关卡不贡献分数。
 *
 * ⚠️ 身份用**昵称**而不是「第 i 个」：`mockBoardNames` 每关洗牌，同一个下标在不同关
 * 是不同的人，只有昵称才是稳定身份。
 * ⚠️ 结果按 `LEVEL_STAR_LINES` 计算，与具体进度/存档无关 → 缓存；换关卡配置时需重启即可。
 */
function mockTotalScores(): Array<{ name: string; simple: number; hard: number; total: number }> {
  if (mockTotalsCache) return mockTotalsCache;
  const names = mockBoardNames(1);
  const acc = new Map<string, { simple: number; hard: number }>();
  for (const name of names) acc.set(name, { simple: 0, hard: 0 });

  for (let level = 1; level <= AI_SCORE_MAX_LEVEL; level++) {
    const line = LEVEL_STAR_LINES[level];
    if (!line) continue;
    const scores = mockBoardScores(level, { star1: line[0], star2: line[1], star3: line[2] });
    if (scores.length === 0) continue;
    const levelNames = mockBoardNames(level);
    for (let i = 0; i < scores.length; i++) {
      const name = levelNames[i]!;
      const bucket = acc.get(name);
      if (!bucket) continue; // 理论上不会：两套名字都来自同一个 40×25 池
      const split = mockSplitOf(level, name, scores[i]!);
      bucket.simple += split.simple;
      bucket.hard += split.hard;
    }
  }

  mockTotalsCache = names.map((name) => {
    const a = acc.get(name)!;
    return { name, simple: a.simple, hard: a.hard, total: a.simple + a.hard };
  });
  return mockTotalsCache;
}

/**
 * 总分榜：本地确定性 mock 的累计总分榜（无后端，纯展示）。
 *
 * ── 两列口径（2026-11-03 用户定稿）──────────────────────────────────
 *   · AI 角色：第 1~66 关逐关累加，每关的简单/困难按 `mockSplitOf` 拆（60%~80%）；
 *     总分 = 简单 + 困难，一定自洽。
 *   · 「我」：真实值 —— 简单 = 简单模式所有关本关最高分之和，困难同理（不做任何拆分）。
 *   · 67 关以后不再有 AI 分数，所以**总分榜与关卡榜的 AI 部分都止步于 66 关**。
 */
export function buildTotalBoard(my: { simple: number; hard: number }): LeaderboardRow[] {
  const rows: LeaderboardRow[] = mockTotalScores().map((t) => ({
    rank: 0,
    name: t.name,
    score: t.total, // 总分榜里 `score` 就是累计总分（与 Web `.lb-row` 的总分列同源）
    simple: t.simple,
    hard: t.hard,
    total: t.total,
    mine: false,
  }));
  // 把本机玩家「我」塞进榜单，方便看高亮效果（真实值，不做任何比例拆分）
  rows.push({
    rank: 0,
    name: LEADERBOARD.mineName,
    score: my.simple + my.hard,
    simple: my.simple,
    hard: my.hard,
    total: my.simple + my.hard,
    mine: true,
  });
  rows.sort((a, b) => (b.total ?? 0) - (a.total ?? 0));
  rows.forEach((r, i) => (r.rank = i + 1));
  return rows;
}

/** 总页数（至少 1 页，空榜也算 1 页） */
export function pageCountOf(count: number): number {
  return Math.max(1, Math.ceil(count / LEADERBOARD_PAGE_SIZE));
}

/** 把页码夹到合法区间（换榜 / 换关 / 数据变少时都要夹一次） */
export function clampPage(page: number, count: number): number {
  return Math.min(Math.max(1, page), pageCountOf(count));
}

/** 取第 `page` 页的行（每页 20 名） */
export function pageRows<T>(rows: readonly T[], page: number): T[] {
  const start = (clampPage(page, rows.length) - 1) * LEADERBOARD_PAGE_SIZE;
  return rows.slice(start, start + LEADERBOARD_PAGE_SIZE);
}

/**
 * 「我」所在的那一页（1 起）。
 *
 * 结算页「查看排行榜」跳过来时用：**直接把玩家送到自己那页**，而不是让他从第 1 页翻。
 * 找不到「我」（没上榜 / 名次在百强之外，榜单里根本没有这一行）时回第 1 页 ——
 * 不能因为找不到就停在空页或末页。
 */
export function pageOfMyRow(rows: readonly { mine?: boolean }[]): number {
  const idx = rows.findIndex((r) => r.mine);
  if (idx < 0) return 1;
  return clampPage(Math.floor(idx / LEADERBOARD_PAGE_SIZE) + 1, rows.length);
}
