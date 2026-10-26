import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  HONOR_RULE,
  boardSnapshot,
  honorForLevel,
  honorOf,
  mockBoardNames,
  mockBoardScores,
  percentileText,
  rankStats,
} from '../assets/scripts/核心/index';

/** 第 15 关的真实星线 */
const LINE = { star1: 5, star2: 7, star3: 9 };

/** 造一批分数：`count` 个 `score` */
function repeat(score: number, count: number): number[] {
  return Array.from({ length: count }, () => score);
}

describe('M9 · 统计口径（《通关及排名》§2）', () => {
  it('名次 = 高于我的人数 + 1，百分比分母是「总人数 - 1」', () => {
    const stats = rankStats([10, 8, 8, 5], 8);
    assert.deepStrictEqual(
      { ...stats, percentile: Number(stats.percentile.toFixed(4)) },
      {
        totalPlayers: 4,
        lowerCount: 1,
        sameCount: 2,
        higherCount: 1,
        rank: 2,
        percentile: 33.3333,
      },
    );
  });

  it('同分同名次 → 名次跳号（3 个第 1 名之后是第 4 名）', () => {
    const pool = [...repeat(10, 3), 5];
    assert.strictEqual(rankStats(pool, 10).rank, 1);
    assert.strictEqual(rankStats(pool, 5).rank, 4, '不能算成第 2 名');
  });

  it('第 100 名并列时第 100 名会空缺，下一位直接是第 101 名', () => {
    const pool = [...repeat(1000, 98), ...repeat(500, 2), 10];
    assert.strictEqual(rankStats(pool, 500).rank, 99);
    assert.strictEqual(rankStats(pool, 500).sameCount, 2, '第 99 名并列两人');
    assert.strictEqual(rankStats(pool, 10).rank, 101, '第 100 名这个名次根本不存在');
  });

  it('总人数 ≤ 1 时百分比是 0（不能除以 0）', () => {
    assert.strictEqual(rankStats([7], 7).percentile, 0);
    assert.strictEqual(rankStats([], 7).percentile, 0);
    assert.strictEqual(rankStats([], 7).rank, 1);
  });

  it('百分比文案保留 1 位小数，满格显示 99.9%', () => {
    assert.strictEqual(percentileText(0), '0.0');
    assert.strictEqual(percentileText(93.74), '93.7');
    assert.strictEqual(percentileText(99.96), '99.9');
    assert.strictEqual(percentileText(100), '99.9', '第一名不能显示 100.0%');
  });
});

describe('M9 · 三档判定（§三 / §四）', () => {
  const stats = (totalPlayers: number, rank: number, percentile: number) => ({
    totalPlayers,
    lowerCount: 0,
    sameCount: 1,
    higherCount: rank - 1,
    rank,
    percentile,
  });

  it('超神：名次 ≤ 10（人少时保底）或在前 1%', () => {
    assert.strictEqual(honorOf(stats(5, 1, 100)), 'god');
    assert.strictEqual(honorOf(stats(101, 10, 0)), 'god');
    assert.strictEqual(honorOf(stats(5000, 50, 0)), 'god', '5000 人的前 1% = 前 50 名');
    assert.strictEqual(honorOf(stats(5000, 51, 0)), 'king');
  });

  it('王者：名次在前 10%', () => {
    assert.strictEqual(honorOf(stats(101, 11, 0)), 'king', '101 人的前 10% 向上取整 = 前 11 名');
    assert.strictEqual(honorOf(stats(101, 12, 0)), 'pass');
    assert.strictEqual(honorOf(stats(1000, 100, 0)), 'king');
    assert.strictEqual(honorOf(stats(1000, 101, 0)), 'pass');
  });

  it('王者档在小池子里也可达（旧规则下 101 人时不可达）', () => {
    const tiers = new Set<string>();
    for (let rank = 1; rank <= 300; rank++) tiers.add(honorOf(stats(300, rank, 0)));
    assert.deepStrictEqual([...tiers].sort(), ['god', 'king', 'pass']);
  });
});

describe('M9 · 灰盒数据源（100 名模拟玩家）', () => {
  it('模拟分数全部 ≥ 本关 3★ 线，且人数固定', () => {
    for (const level of [1, 15, 35, 60]) {
      const scores = mockBoardScores(level, LINE);
      assert.strictEqual(scores.length, HONOR_RULE.mockPlayers);
      assert.ok(scores.every((s) => s >= LINE.star3), `第${level}关出现低于 3★ 线的分数`);
    }
  });

  it('同一关恒定（刷新 / 重开都一样），不同关不同', () => {
    assert.deepStrictEqual(mockBoardScores(15, LINE), mockBoardScores(15, LINE));
    assert.notDeepStrictEqual(mockBoardScores(15, LINE), mockBoardScores(16, LINE));
  });

  it('昵称不重名', () => {
    const names = mockBoardNames(20);
    assert.strictEqual(new Set(names).size, names.length);
  });
});

describe('M9 · 百名榜（排行榜页数据）', () => {
  it('没上榜时榜单只有模拟玩家，我的名次是 null', () => {
    const snap = boardSnapshot(15, LINE, 0);
    assert.strictEqual(snap.totalPlayers, HONOR_RULE.mockPlayers);
    assert.strictEqual(snap.myRank, null);
    assert.strictEqual(snap.myBoardBest, 0);
    assert.ok(snap.rows.every((row) => row.rank <= HONOR_RULE.boardRankMax));
  });

  it('上榜后总人数 +1，且我出现在榜单里（名次和分数都对得上）', () => {
    const snap = boardSnapshot(15, LINE, 999);
    assert.strictEqual(snap.totalPlayers, HONOR_RULE.mockPlayers + 1);
    assert.strictEqual(snap.myRank, 1, '999 分必然第一');
    assert.strictEqual(snap.rows[0]!.mine, true);
    assert.strictEqual(snap.rows[0]!.score, 999);
  });

  it('榜单按分数降序，名次单调不降', () => {
    const snap = boardSnapshot(40, LINE, 12);
    for (let i = 1; i < snap.rows.length; i++) {
      assert.ok(snap.rows[i - 1]!.score >= snap.rows[i]!.score, '分数必须降序');
      assert.ok(snap.rows[i - 1]!.rank <= snap.rows[i]!.rank, '名次必须升序');
    }
  });

  it('名次 > 100 的人不进榜单（我的名次照样能查到）', () => {
    const snap = boardSnapshot(15, LINE, 1);
    assert.ok(snap.rows.every((row) => row.rank <= 100));
    assert.ok(snap.myRank !== null && snap.myRank > 100, `1 分应该排在百名之外，实际 ${snap.myRank}`);
    assert.strictEqual(snap.rows.some((row) => row.mine), false);
  });
});

describe('M9 · 结算荣誉结论（§四 边界情况）', () => {
  it('3★ 上榜但分数贴着 3★ 线 → 优秀（新规：只够线不再白送超神）', () => {
    const out = honorForLevel({ level: 15, line: LINE, score: 9, stars: 3, revived: false, boardBest: 9 });
    assert.strictEqual(out.tier, 'pass');
    assert.strictEqual(out.stats.totalPlayers, 101);
    assert.strictEqual(out.rankScore, 9);
  });

  it('3★ 上榜且名次靠前 → 超神 / 王者按名次占比', () => {
    const top = honorForLevel({ level: 15, line: LINE, score: 99, stars: 3, revived: false, boardBest: 99 });
    assert.strictEqual(top.stats.rank, 1);
    assert.strictEqual(top.tier, 'god');
  });

  it('1★ / 2★ 不上榜 → 优秀（百分比 0）', () => {
    const one = honorForLevel({ level: 15, line: LINE, score: 5, stars: 1, revived: false, boardBest: 0 });
    assert.strictEqual(one.tier, 'pass');
    assert.strictEqual(one.stats.totalPlayers, HONOR_RULE.mockPlayers);
    assert.strictEqual(one.stats.percentile, 0);

    const two = honorForLevel({ level: 15, line: LINE, score: 8, stars: 2, revived: false, boardBest: 0 });
    assert.strictEqual(two.tier, 'pass');
  });

  it('续命局按 1★ 线计分 → 优秀（哪怕实际打出 3★ 的分数）', () => {
    const out = honorForLevel({ level: 15, line: LINE, score: 12, stars: 1, revived: true, boardBest: 0 });
    assert.strictEqual(out.tier, 'pass');
    assert.strictEqual(out.rankScore, LINE.star1);
    assert.strictEqual(out.stats.percentile, 0);
  });

  it('历史上过榜，但本局续命 / 只拿 1★ → 仍是优秀，不能沿用历史榜分判超神', () => {
    const revived = honorForLevel({ level: 15, line: LINE, score: 12, stars: 1, revived: true, boardBest: 30 });
    assert.strictEqual(revived.tier, 'pass');
    assert.strictEqual(revived.rankScore, LINE.star1);
    assert.strictEqual(revived.boardBest, 0);

    const oneStar = honorForLevel({ level: 15, line: LINE, score: 5, stars: 1, revived: false, boardBest: 30 });
    assert.strictEqual(oneStar.tier, 'pass');
    assert.strictEqual(oneStar.rankScore, LINE.star1);
  });

  it('重复通关时用「更新后的上榜最高分」排名 —— 不会把自己算成比自己高的人', () => {
    // 历史最高 30 分（榜上第一），本次只打了 9 分：排名仍然按 30 分算，
    // 名次必须是第 1 名，而不是「101 人里第 101 名」。
    const out = honorForLevel({ level: 15, line: LINE, score: 9, stars: 3, revived: false, boardBest: 30 });
    assert.strictEqual(out.rankScore, 30);
    assert.strictEqual(out.stats.rank, 1);
    assert.strictEqual(out.tier, 'god');
    assert.strictEqual(out.stats.sameCount, 1, '自己那条记录必须落在 sameCount 里');
  });
});
