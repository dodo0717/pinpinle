/**
 * 排行榜规则（核心/rank.ts，2026-10-25 定稿）的单测：总积分 / 总星数 / 有效成绩 / 竞赛排名 / 距上一名。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  rankTotals, totalScore, rankRows, totalBoard, gapToAhead, mockTotalRivals, RANK_RULE,
  applySettlement, settleLevel, LEVEL_STAR_LINES,
  type ProgressData, type LevelOutcome, type TotalBoardRow,
} from '../assets/scripts/核心/index';

const prog = (levels: ProgressData['levels'], mode: 'normal' | 'nightmare' = 'normal'): ProgressData => ({ mode, unlocked: 5, levels });
const rec = (stars: number, validBest: number, personalBest = validBest, boardBest = 0) => ({ stars, personalBest, boardBest, validBest });

describe('rank · 总积分与总星数', () => {
  it('总积分 = 简单 + ⌊困难 × 1.5⌋，只认有效分（续命局不算）', () => {
    const n = prog({ 1: rec(3, 6), 2: rec(1, 0, 12) });       // 第 2 关只有续命局：个人最高 12、有效 0
    const h = prog({ 1: rec(2, 5) }, 'nightmare');
    const t = rankTotals(n, h);
    assert.equal(t.simple, 6);
    assert.equal(t.hard, 5);
    assert.equal(t.total, 6 + 7);
    assert.equal(t.stars, 3 + 1 + 2, '续命局的 1★ 计入总星数');
  });

  it('困难加权向下取整', () => {
    assert.equal(totalScore(0, 3), 4);
    assert.equal(totalScore(10, 1), 11);
    assert.equal(RANK_RULE.maxStars, 1080);   // 180 关 × 3★ × 2 模式
  });

  it('结算链路：续命局不抬有效分，未续命 1★ 局会抬', () => {
    const line = LEVEL_STAR_LINES[3]!;
    const o = (score: number, revived: boolean): LevelOutcome => ({ level: 3, score, points: score, star1: line[0], star2: line[1], star3: line[2], revived });
    let r = applySettlement(undefined, o(4, false), settleLevel(o(4, false))!);
    assert.equal(r.validBest, 4);
    r = applySettlement(r, o(20, true), settleLevel(o(20, true), r)!);
    assert.equal(r.validBest, 4, '续命局 20 分不进有效分');
    assert.equal(r.personalBest, 20);
  });
});

describe('rank · 竞赛排名与上榜', () => {
  const row = (name: string, total: number, stars: number, mine = false): TotalBoardRow => ({ name, simple: total, hard: 0, total, stars, mine });

  it('同分同星同名次、下一名跳号（1, 1, 3）', () => {
    const r = rankRows([row('a', 10, 5), row('b', 10, 5), row('c', 8, 9)], (x, y) => y.total - x.total || y.stars - x.stars);
    assert.deepEqual(r.map((x) => x.rank), [1, 1, 3]);
  });

  it('同分时星多者在前', () => {
    const r = rankRows([row('a', 10, 3), row('b', 10, 7)], (x, y) => y.total - x.total || y.stars - x.stars);
    assert.deepEqual(r.map((x) => `${x.name}${x.rank}`), ['b1', 'a2']);
  });

  it('总积分为 0 不上总榜', () => {
    const { mine } = totalBoard({ simple: 0, hard: 0, total: 0, stars: 2 }, '我', [row('a', 5, 3)]);
    assert.equal(mine, null);
  });

  it('并列时我排在并列者最后，但名次相同', () => {
    const { rows, mine } = totalBoard({ simple: 5, hard: 0, total: 5, stars: 3 }, '我', [row('a', 5, 3)]);
    assert.equal(rows[1]!.mine, true);
    assert.equal(mine!.rank, 1);
  });
});

describe('rank · 距上一名', () => {
  const row = (name: string, total: number, stars: number, rank: number, mine = false) => ({ name, total, stars, rank, mine });

  it('分数落后：差 (对方 − 我 + 1) 分', () => {
    const g = gapToAhead([row('a', 12, 0, 1), row('我', 9, 0, 2, true)], (r) => r.total, (r) => r.stars);
    assert.deepEqual(g, { name: 'a', score: 4, stars: 0 });
  });

  it('同分但星少：提示还差几颗星', () => {
    const g = gapToAhead([row('a', 9, 6, 1), row('我', 9, 4, 2, true)], (r) => r.total, (r) => r.stars);
    assert.deepEqual(g, { name: 'a', score: 0, stars: 3 });
  });

  it('第 1 名（含并列第 1）返回 null', () => {
    assert.equal(gapToAhead([row('我', 9, 4, 1, true)], (r) => r.total), null);
    assert.equal(gapToAhead([row('a', 9, 4, 1), row('我', 9, 4, 1, true)], (r) => r.total), null);
  });
});

describe('rank · 示例对手', () => {
  it('100 人、确定性、分数与真实星线同量级', () => {
    const a = mockTotalRivals();
    assert.equal(a.length, 100);
    assert.equal(mockTotalRivals(), a, '缓存：每次同一批');
    const max = Math.max(...a.map((r) => r.total));
    // 排行分单位（2026-10-27）：40 关 × 3★线 ~9 组 × ~130 分 ≈ 5 万上下
    assert.ok(max < 120000, `示例对手最高分 ${max} 不该离谱`);
    assert.ok(a.some((r) => r.total < 3000), '应有刚入门的对手（新玩家不至于垫底）');
    assert.ok(a.every((r) => r.stars <= RANK_RULE.maxStars));
  });
});
