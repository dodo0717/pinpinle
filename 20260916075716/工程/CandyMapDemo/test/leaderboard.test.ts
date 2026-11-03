/**
 * 排行榜整屏**数据层**的单测（批次⑥）。
 *
 * 整屏组件 `界面/LeaderboardScreen.ts` 要 import `cc`，Node 里加载不了，
 * 所以最容易出错的那一半口径（挑战按钮状态机、模拟玩家两列分数、分页）
 * 被抽到了 `界面/leaderboardModel.ts` —— 这里直接测它。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  LEADERBOARD_PAGE_SIZE,
  challengeState,
  mockRowScores,
  buildTotalBoard,
  avatarIndexOf,
  pageCountOf,
  clampPage,
  pageRows,
} from '../assets/scripts/界面/leaderboardModel';
import { LEADERBOARD } from '../assets/scripts/玩法/text';

test('每页 20 名（《通关及排名》§七）', () => {
  assert.equal(LEADERBOARD_PAGE_SIZE, 20);
});

test('「挑战本关」状态机：通关即可挑战，置灰必须说清原因', () => {
  const ok = challengeState(3, 'cleared', true);
  assert.equal(ok.dim, false);
  assert.equal(ok.hint, '');

  // 已解锁但没通关 → 提示「通关后解锁」
  const unclear = challengeState(3, 'unlocked', true);
  assert.equal(unclear.dim, true);
  assert.equal(unclear.hint, LEADERBOARD.challengeUnclear);

  // 还没解锁 → 提示「通关前一关后解锁」
  const locked = challengeState(3, 'locked', true);
  assert.equal(locked.dim, true);
  assert.equal(locked.hint, LEADERBOARD.challengeLocked);

  // 通关过但素材不足（被跳过的关）→ 提示该关暂未开放，且优先级高于「已通关」
  const skipped = challengeState(7, 'cleared', false);
  assert.equal(skipped.dim, true);
  assert.equal(skipped.hint, LEADERBOARD.challengeUnavailable(7));
});

test('模拟玩家的两列分数：只落当前模式那一列，绝不按比例拆', () => {
  const normal = mockRowScores(23, 'normal');
  assert.deepEqual(normal, { simple: 23, hard: 0, total: 23 });

  const nightmare = mockRowScores(23, 'nightmare');
  assert.deepEqual(nightmare, { simple: 0, hard: 23, total: 23 });
});

test('总分榜：1001 行（1000 模拟 + 我），名次连续且我的分是真实值不拆分', () => {
  const rows = buildTotalBoard({ simple: 120, hard: 30 });

  assert.equal(rows.length, 1001, '1000 名模拟玩家（基石数据） + 本机 1 人');
  rows.forEach((r, i) => assert.equal(r.rank, i + 1, '名次必须连续'));

  const mine = rows.filter((r) => r.mine);
  assert.equal(mine.length, 1, '榜单里只能有 1 个「我」');
  assert.equal(mine[0]!.name, LEADERBOARD.mineName);
  assert.equal(mine[0]!.simple, 120, '我的简单分是真实累计分');
  assert.equal(mine[0]!.hard, 30, '我的困难分是真实累计分');
  assert.equal(mine[0]!.total, 150);

  // 降序：任何一行的总分都不该小于后一行
  for (let i = 1; i < rows.length; i++) {
    assert.ok((rows[i - 1]!.total ?? 0) >= (rows[i]!.total ?? 0), `第 ${i} 行破坏了降序`);
  }
});

test('总分榜是确定性的：同一份输入每次打开都一样（本地 mock，无后端）', () => {
  const a = buildTotalBoard({ simple: 120, hard: 30 });
  const b = buildTotalBoard({ simple: 120, hard: 30 });
  assert.deepEqual(a.map((r) => [r.rank, r.name, r.total]), b.map((r) => [r.rank, r.name, r.total]));
});

test('分页：每页 20 名，页码夹在合法区间，尾页只给剩下的行', () => {
  const rows = buildTotalBoard({ simple: 0, hard: 0 });
  // 1001 行 → ceil(1001/20) = 51 页
  assert.equal(pageCountOf(rows.length), 51, '1001 行 → 51 页');

  assert.equal(clampPage(0, rows.length), 1, '页码下限 1');
  assert.equal(clampPage(99, rows.length), 51, '页码上限 = 总页数');
  assert.equal(pageCountOf(0), 1, '空榜也至少算 1 页');

  assert.equal(pageRows(rows, 1).length, 20);
  assert.equal(pageRows(rows, 51).length, 1, '最后一页只剩 1 行');
  // 越界页码被夹住，不会取到空数组之外的东西（空榜时返回空）
  assert.equal(pageRows([], 3).length, 0);
  // 分页不重不漏：逐页拼回去等于全量
  const all: string[] = [];
  for (let p = 1; p <= pageCountOf(rows.length); p++) {
    for (const r of pageRows(rows, p)) all.push(`${r.rank}-${r.name}`);
  }
  assert.equal(all.length, rows.length);
  assert.equal(all[0], `1-${rows[0]!.name}`);
});

test('头像配色按昵称哈希稳定取一种（同一玩家每次一样）', () => {
  const a = avatarIndexOf('软糯布丁');
  assert.ok(a >= 0 && a < 3);
  assert.equal(avatarIndexOf('软糯布丁'), a, '同一昵称必须取到同一种');
  // 三种配色都要能被取到，否则等于只有一种
  const kinds = new Set(['软糯布丁', '元气团子', '抱抱豆豆', '咕噜柚子', '懒懒芝麻', '奶盖花卷'].map(avatarIndexOf));
  assert.ok(kinds.size >= 2, `昵称哈希只落到 ${kinds.size} 种配色`);
});
