import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AI_SCORE_MAX_LEVEL,
  HONOR_RULE,
  TOTAL_LEVELS,
  boardSnapshot,
  hasAiScores,
  honorForLevel,
  honorOf,
  mockBoardNames,
  mockBoardScores,
  mockSplitOf,
  percentileText,
  pointsOfGroups,
  rankStats,
} from '../assets/scripts/core/index';

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

  it('进了百强 → 超神', () => {
    assert.strictEqual(honorOf(stats(101, 1, 100)), 'god');
    assert.strictEqual(honorOf(stats(101, 100, 1)), 'god');
    assert.strictEqual(honorOf(stats(9999, 100, 99)), 'god');
  });

  it('总玩家数 ≤ 100 时**不启用**超神档，直接看百分比', () => {
    assert.strictEqual(honorOf(stats(100, 1, 100)), 'king');
    assert.strictEqual(honorOf(stats(50, 1, 100)), 'king');
  });

  it('没进百强但百分比 ≥ 90% → 王者', () => {
    assert.strictEqual(honorOf(stats(1001, 101, 90)), 'king');
    assert.strictEqual(honorOf(stats(2000, 150, 95.5)), 'king');
  });

  it('其余都是优秀', () => {
    assert.strictEqual(honorOf(stats(2000, 150, 89.9)), 'pass');
    assert.strictEqual(honorOf(stats(101, 101, 0)), 'pass');
  });

  it('1001 人池子（1000 基石 + 我）里王者档刚好可达：卡在第 101 名', () => {
    // 名次 > 100 意味着至少 100 人比你高 → percentile ≤ (N-101)/(N-1)。
    // N = 1001 时上界正好 90%：第 101 名（100 人比你高、孤立无并列）恰好卡在 90% → 王者；
    // 第 102 名百分比就掉到 89.9% → 优秀。也就是说 1001 人口径下「王者」= 刚好卡在百强门外那一名，
    // 这是数值门槛的必然（策划要放宽就改 HONOR_RULE.kingPercentile，不是改代码）。
    assert.strictEqual(honorOf(stats(1001, 101, 90)), 'king', '第 101 名（90%）应是王者');
    assert.strictEqual(honorOf(stats(1001, 102, 89.9)), 'pass', '第 102 名（89.9%）应是优秀');
    // 第 100 名以内仍是超神（总人数 > 100 且名次 ≤ 100）
    assert.strictEqual(honorOf(stats(1001, 100, 90.1)), 'god');
  });
});

describe('M9 · 灰盒数据源（1000 名模拟玩家，基石数据）', () => {
  it('模拟分数全部 ≥ 本关 3★ 线，且人数固定', () => {
    // 只到 AI_SCORE_MAX_LEVEL（66 关）：更后面的关卡按用户口径不配置 AI 分数
    for (const level of [1, 15, 35, AI_SCORE_MAX_LEVEL]) {
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

describe('M9 · AI 分数口径（2026-11-03 用户定稿）', () => {
  it(`只配置到第 ${AI_SCORE_MAX_LEVEL} 关，之后不再造 AI 分数`, () => {
    assert.strictEqual(AI_SCORE_MAX_LEVEL, 66);
    assert.strictEqual(hasAiScores(AI_SCORE_MAX_LEVEL), true);
    assert.strictEqual(hasAiScores(AI_SCORE_MAX_LEVEL + 1), false);
    assert.strictEqual(mockBoardScores(AI_SCORE_MAX_LEVEL, LINE).length, HONOR_RULE.mockPlayers);
    assert.strictEqual(mockBoardScores(AI_SCORE_MAX_LEVEL + 1, LINE).length, 0, '67 关起没有 AI');
    assert.strictEqual(mockBoardScores(TOTAL_LEVELS, LINE).length, 0, '末关也没有 AI');
  });

  it('第 67 关起榜单只有本机：没上榜 = 空榜，上榜 = 第 1 名', () => {
    const empty = boardSnapshot(AI_SCORE_MAX_LEVEL + 1, LINE, 0);
    assert.strictEqual(empty.totalPlayers, 0);
    assert.strictEqual(empty.rows.length, 0);
    assert.strictEqual(empty.myRank, null);

    const alone = boardSnapshot(AI_SCORE_MAX_LEVEL + 1, LINE, 12);
    assert.strictEqual(alone.totalPlayers, 1);
    assert.strictEqual(alone.myRank, 1);
    assert.deepStrictEqual(alone.rows.map((r) => [r.rank, r.mine]), [[1, true]]);
  });

  it('简单分占 60%~80%，困难分 = 总分 − 简单分（两列都 > 0 且求和自洽）', () => {
    for (const total of [5, 9, 12, 18, 30, 47]) {
      for (const name of ['软糯布丁', '元气团子', '星星汤圆', '柠檬果冻']) {
        const split = mockSplitOf(15, name, total);
        const ratio = (split.simple / total) * 100;
        assert.ok(ratio >= 60 - 100 / total && ratio <= 80 + 100 / total, `${name}@${total} 比例 ${ratio.toFixed(1)}%`);
        assert.strictEqual(split.simple + split.hard, total, '两列必须等于总分');
        assert.ok(split.simple > 0 && split.hard > 0, '两列都必须 > 0');
        assert.strictEqual(mockSplitOf(15, name, total).simple, split.simple, '同一角色同一关必须稳定');
      }
    }
    // 不同角色 / 不同关的比例不该完全一样（随机确实在起作用）
    const ratios = new Set(
      ['软糯布丁', '元气团子', '星星汤圆', '柠檬果冻', '奶盖花卷', '樱桃蛋糕'].map((n) => mockSplitOf(15, n, 30).simple),
    );
    assert.ok(ratios.size >= 2, `6 个角色只落到 ${ratios.size} 种拆分，随机性不足`);
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
    const snap = boardSnapshot(15, LINE, 999999);
    assert.strictEqual(snap.totalPlayers, HONOR_RULE.mockPlayers + 1);
    assert.strictEqual(snap.myRank, 1, '999999 分必然第一');
    assert.strictEqual(snap.rows[0]!.mine, true);
    assert.strictEqual(snap.rows[0]!.score, 999999);
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
  it('3★ 上榜：接近天花板 → 超神；贴着 3★ 线的低分 → 优秀（1001 人口径）', () => {
    // 1000 名基石数据下「上榜即超神」不再成立 —— 天梯从天花板（3★线×1.6）往下铺，
    // 贴地板的分数在 1001 人里排 800 名开外，要进前 100 得打到接近天花板。
    // 2026-11-04 合并：AI 分数与玩家统一成排行分单位（每组 100 + 每组 0~30 速度分）
    const ceilGroups = LINE.star3 + Math.max(6, Math.round(LINE.star3 * 1.6));
    const ceiling = pointsOfGroups(ceilGroups) + ceilGroups * 30;
    const high = honorForLevel({ level: 15, line: LINE, score: ceilGroups, stars: 3, revived: false, boardBest: ceiling });
    assert.strictEqual(high.tier, 'god', `天花板 ${ceiling} 分应进前 100 → 超神（实际第 ${high.stats.rank} 名）`);
    assert.strictEqual(high.stats.totalPlayers, HONOR_RULE.mockPlayers + 1, '1000 基石 + 我 = 1001');
    assert.ok(high.stats.rank <= HONOR_RULE.boardRankMax);

    const low = honorForLevel({ level: 15, line: LINE, score: LINE.star3, stars: 3, revived: false, boardBest: pointsOfGroups(LINE.star3) });
    assert.strictEqual(low.tier, 'pass', '贴 3★ 线的低分在 1001 人里排不进前 100');
    assert.ok(low.stats.rank > 100, `实际名次 ${low.stats.rank}`);
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
    assert.strictEqual(out.rankScore, pointsOfGroups(LINE.star1));
    assert.strictEqual(out.stats.percentile, 0);
  });

  it('重复通关时用「更新后的上榜最高分」排名 —— 不会把自己算成比自己高的人', () => {
    // 历史最高 30 分（榜上第一），本次只打了 9 分：排名仍然按 30 分算，
    // 名次必须是第 1 名，而不是「101 人里第 101 名」。
    const best = pointsOfGroups(40);   // 历史最高 40 组的排行分，高于全部 AI
    const out = honorForLevel({ level: 15, line: LINE, score: 9, stars: 3, revived: false, boardBest: best });
    assert.strictEqual(out.rankScore, best);
    assert.strictEqual(out.stats.rank, 1);
    assert.strictEqual(out.tier, 'god');
    assert.strictEqual(out.stats.sameCount, 1, '自己那条记录必须落在 sameCount 里');
  });
});
