/**
 * 排行榜规则（2026-10-25 定稿，原型见 design/leaderboard-rules.html）—— 纯逻辑，零 DOM / 零存储依赖。
 *
 * 三个榜（总榜 / 关卡榜 / 好友榜）与结算弹窗的数字**全部从这里算**，避免各处各算一套。
 *
 * ── 口径 ──────────────────────────────────────────────────────────────
 *   有效成绩：没有续命、且至少拿到 1★ 的一局（续命局照常通关 / 解锁 / 记个人最高分，但不进任何排行）
 *   关卡分  ：某关某模式的有效成绩最高分（`LevelRecord.validBest`）
 *   总积分  ：Σ 简单关卡分 + ⌊Σ 困难关卡分 × 1.5⌋（困难要先三星简单才能开，给加权）
 *   总星数  ：Σ 每关每模式最高星级（含续命局的 1★ —— 星数是收集进度，不是竞技分），上限 360
 *
 * ── 上榜与名次 ────────────────────────────────────────────────────────
 *   总榜 / 好友榜：总积分 > 0；排序 总积分↓ → 总星数↓
 *   关卡榜      ：本关本模式有 ≥3★ 的有效成绩（`boardBest`，见 progress.ts）；排序 关卡分↓
 *   名次一律「竞赛排名」：比较键完全相同即同名次，下一名跳号（1, 1, 3）
 */

import { recordOf, type ProgressData, type LevelRecord } from './progress';
import { LEVEL_STAR_LINES, NIGHTMARE_STAR_LINES, TOTAL_LEVELS } from './config';
import { mockBoardNames } from './honor';
import { starsFor } from './progress';
import { Rng } from './rng';
import { pointsOfGroups } from './scoring';

/**
 * 排行规则版本（2026-10-27 评审 P1-2 冻结）。规则任何改动都 +1，并同步改
 * text.ts `PANEL.rulesLines` 与服务端 ProgressMerge —— 三处口径必须一致。
 *   v1 2026-10-25 有效成绩 / 困难 ×1.5 / 关卡榜 ≥3★
 *   v2 2026-10-27 分数改为排行分（每组 100 + 速度分）；续命局最高 2★
 */
export const RANK_RULES_VERSION = 2;

export const RANK_RULE = {
  /** 困难关卡分在总积分里的加权 */
  hardWeight: 1.5,
  /** 榜单展示前 N 名（含并列） */
  topN: 100,
  /** 总星数上限：60 关 × 3★ × 2 模式 */
  maxStars: TOTAL_LEVELS * 3 * 2,
} as const;

/* ------------------------------------------------------------------ 汇总 */

/** 某关的关卡分（有效成绩最高分） */
export function validBestOf(rec: LevelRecord): number {
  return Math.max(0, rec.validBest || 0);
}

/** 总积分 = 简单 + ⌊困难 × 1.5⌋ */
export function totalScore(simple: number, hard: number): number {
  return simple + Math.floor(hard * RANK_RULE.hardWeight);
}

export interface RankTotals {
  /** Σ 简单关卡分 */
  simple: number;
  /** Σ 困难关卡分（未加权） */
  hard: number;
  /** 总积分（加权后） */
  total: number;
  /** 总星数（两模式合计） */
  stars: number;
}

function sumMode(p: ProgressData): { score: number; stars: number } {
  let score = 0;
  let stars = 0;
  for (const key of Object.keys(p.levels)) {
    const level = Number(key);
    if (!Number.isFinite(level)) continue;
    const rec = recordOf(p, level);
    score += validBestOf(rec);
    stars += Math.max(0, Math.min(3, rec.stars || 0));
  }
  return { score, stars };
}

/** 一个玩家两套进度的汇总（总榜 / 好友榜 / 结算弹窗都读它） */
export function rankTotals(normal: ProgressData, nightmare: ProgressData): RankTotals {
  const n = sumMode(normal);
  const h = sumMode(nightmare);
  return { simple: n.score, hard: h.score, total: totalScore(n.score, h.score), stars: n.stars + h.stars };
}

/* ------------------------------------------------------------------ 名次 */

/**
 * 竞赛排名：按 `cmp` 降序排（cmp 返回负数 = a 在前），`cmp === 0` 视为并列同名次，下一名跳号。
 * `order` 只决定**并列者之间的展示顺序**（如「先达到者在前」），不影响名次。
 */
export function rankRows<T extends object>(
  rows: readonly T[],
  cmp: (a: T, b: T) => number,
  order?: (a: T, b: T) => number,
): Array<T & { rank: number }> {
  const sorted = rows.slice().sort((a, b) => cmp(a, b) || (order ? order(a, b) : 0));
  const out: Array<T & { rank: number }> = [];
  sorted.forEach((r, i) => {
    const prev = out[i - 1];
    const rank = prev && cmp(prev, r) === 0 ? prev.rank : i + 1;
    out.push({ ...r, rank });
  });
  return out;
}

export interface TotalBoardRow {
  name: string;
  simple: number;
  hard: number;
  total: number;
  stars: number;
  mine: boolean;
}

/** 总榜 / 好友榜的排序键：总积分↓ → 总星数↓ */
export function cmpTotal(a: TotalBoardRow, b: TotalBoardRow): number {
  return b.total - a.total || b.stars - a.stars;
}

/**
 * 总榜：对手（离线时是示例数据）+ 我（总积分 > 0 才上榜）。
 * 并列时我排在并列者最后（本地拿不到「达到时间」，对手默认更早达到）。
 */
export function totalBoard(me: RankTotals, myName: string, rivals: readonly TotalBoardRow[]): {
  rows: Array<TotalBoardRow & { rank: number }>;
  mine: (TotalBoardRow & { rank: number }) | null;
} {
  const all: TotalBoardRow[] = rivals.slice();
  if (me.total > 0) all.push({ name: myName, simple: me.simple, hard: me.hard, total: me.total, stars: me.stars, mine: true });
  const rows = rankRows(all, cmpTotal, (a, b) => Number(a.mine) - Number(b.mine));
  return { rows, mine: rows.find((r) => r.mine) ?? null };
}

/* ------------------------------------------------------------------ 「再来一局」的钩子 */

export interface AheadGap {
  /** 前一名的名字 */
  name: string;
  /** 要超过他还差多少分（0 = 分数已持平，差的是星数） */
  score: number;
  /** 分数持平时还差几颗星 */
  stars: number;
}

/**
 * 我和「紧挨在前面的那一名」差多少。我已经是第 1 名返回 null。
 * 超过 = 分数更高；分数相同时星数更多。
 */
export function gapToAhead<T extends { rank: number; mine: boolean; name: string }>(
  rows: ReadonlyArray<T>,
  score: (r: T) => number,
  stars: (r: T) => number = () => 0,
): AheadGap | null {
  const mine = rows.find((r) => r.mine);
  if (!mine) return null;
  let ahead: T | null = null;
  for (const r of rows) {
    if (r.rank < mine.rank) ahead = r;
    else break;
  }
  if (!ahead) return null;
  const ds = score(ahead) - score(mine);
  if (ds > 0) return { name: ahead.name, score: ds + 1, stars: 0 };
  return { name: ahead.name, score: 0, stars: Math.max(1, stars(ahead) - stars(mine) + 1) };
}

/* ------------------------------------------------------------------ 示例对手（离线 / 服务端未接入时） */

let rivalsCache: TotalBoardRow[] | null = null;

/**
 * 总榜示例对手：100 人，按**真实星线**生成（与真实玩家同一量级，不再是 380~980 的假分）。
 * 确定性：同一份代码每次生成同一批人、同一批分数，便于复现与验收。
 *   - 多数人停在前几关（打到第 reach 关，reach 偏小），少数人打得很远；
 *   - 技术好的人一半关卡还打了困难。
 */
export function mockTotalRivals(): TotalBoardRow[] {
  if (rivalsCache) return rivalsCache;
  const rng = new Rng(20261025);
  const names = mockBoardNames(1);
  rivalsCache = names.map((name) => {
    const reach = 1 + Math.floor(Math.pow(rng.next(), 1.8) * 40);
    const skill = rng.next();
    let simple = 0;
    let hard = 0;
    let stars = 0;
    for (let lv = 1; lv <= reach; lv++) {
      const [s1, s2, s3] = LEVEL_STAR_LINES[lv] ?? [1, 2, 3];
      const sc = Math.max(s1, Math.round(s3 * (0.6 + 0.8 * skill)) + rng.int(3) - 1);
      // 2026-10-27 排行分：组数 ×100 + 手速越好速度分越多（每组 0~60）
      simple += pointsOfGroups(sc) + Math.round(sc * 60 * skill * rng.next());
      stars += starsFor(sc, s1, s2, s3);
      if (skill > 0.6 && rng.next() < 0.5) {
        const [h1, h2, h3] = NIGHTMARE_STAR_LINES[lv] ?? [1, 2, 3];
        const hs = Math.max(h1, Math.round(h3 * (0.7 + 0.6 * skill)));
        hard += pointsOfGroups(hs) + Math.round(hs * 40 * skill * rng.next());
        stars += starsFor(hs, h1, h2, h3);
      }
    }
    return { name, simple, hard, total: totalScore(simple, hard), stars, mine: false };
  });
  return rivalsCache;
}
