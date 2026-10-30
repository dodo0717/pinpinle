/**
 * 排行榜整屏的**数据层**（从 web/ui/leaderboard.ts 移植，2026-10-30）。
 *
 * 为什么单独拆一个文件：整屏组件（`LeaderboardScreen.ts`）要 import `cc`，
 * 在 Node 单测里根本加载不了；而榜单里最容易出错的恰恰是**纯数据口径**
 * （模拟玩家的两列分数怎么放、「挑战本关」什么时候置灰、每页切多少行）。
 * 把这些抽出来后，单测可以直接 import 本文件验证口径，不必开浏览器。
 *
 * ⚠️ **没有后端**：100 名玩家来自 `核心/honor.ts` 的确定性 mock（本地模拟数据，
 * 同一关每次打开都一样），界面上必须写明这一点（`LEADERBOARD` 文案里的口径说明）。
 *
 * ⚠️ **禁止按比例拆分数**（历史 bug）：曾经用 0.6 / 0.4 把一个分硬拆成「简单/困难」
 * 两列，结果「简单 23 分」被显示成「简单 14 / 困难 9」，而困难模式根本没玩过。
 * 两列只能各自来自对应模式的进度表。
 */

import { Rng, mockBoardNames, TOTAL_LEVELS, type LevelStatus, type GameMode } from '../核心/index';
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
  /** 当前玩法模式：模拟玩家只有一份成绩，落在对应那一列 */
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
 * 关卡榜里模拟玩家那一行的三栏。
 *
 * 模拟玩家只有**一份**成绩（当前模式的该关上榜分），所以它只落在当前模式那一列，
 * 另一列就是「没玩过 = 0」—— 不再按 0.6 / 0.4 拆成两个假数字。
 * 本机玩家（`mine`）不用这个函数，走 `view.myScores`（两套进度表的真实值）。
 */
export function mockRowScores(score: number, mode: GameMode): { simple: number; hard: number; total: number } {
  const inSimple = mode === 'normal';
  return { simple: inSimple ? score : 0, hard: inSimple ? 0 : score, total: score };
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

/**
 * 总分榜：本地确定性 mock 的累计总分榜（无后端，纯展示）。
 *
 * ⚠️ 其余 100 名是**模拟玩家**，他们的「简单/困难」拆分也是 mock 出来的分布；
 * 但「我」这一行必须用**真实分模式累计分**（`my`）—— 简单 = 简单模式所有关的
 * 本关最高分之和，困难同理，没玩过的模式就是 0，绝不按比例虚构。
 */
export function buildTotalBoard(my: { simple: number; hard: number }): LeaderboardRow[] {
  // 用第 1 关的 100 个固定昵称作为稳定身份，避免按关洗牌导致玩家对不上
  const names = mockBoardNames(1);
  const rng = new Rng(20260914);
  const rows: LeaderboardRow[] = names.map((name) => {
    const total = 380 + rng.int(600); // 380 ~ 979
    const simple = Math.round(total * 0.6);
    const hard = total - simple;
    return { rank: 0, name, simple, hard, total, mine: false };
  });
  // 把本机玩家「我」塞进榜单，方便看高亮效果（真实值，不做任何比例拆分）
  rows.push({
    rank: 0,
    name: LEADERBOARD.mineName,
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
