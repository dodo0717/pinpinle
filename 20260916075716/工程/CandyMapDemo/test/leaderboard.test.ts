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
  pageOfMyRow,
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

test('AI 角色的两列分数：简单 = 总分 × 60%~80%，困难 = 总分 − 简单分', () => {
  const row = mockRowScores(15, '软糯布丁', 30);
  assert.equal(row.total, 30);
  assert.equal(row.simple + row.hard, 30, '两列必须等于总分');
  const ratio = (row.simple / 30) * 100;
  // 四舍五入允许 ±0.5 分的边界偏差
  assert.ok(ratio >= 60 - 100 / 30 && ratio <= 80 + 100 / 30, `简单占比 ${ratio.toFixed(1)}% 不在 60%~80%`);
  assert.ok(row.hard > 0, '困难分必须 > 0（剩下的都算困难）');

  // 确定性：同一关同一角色每次一样，换个角色/关会变
  assert.deepEqual(mockRowScores(15, '软糯布丁', 30), row);
  const others = ['元气团子', '星星汤圆', '柠檬果冻', '奶盖花卷'].map((n) => mockRowScores(15, n, 30).simple);
  assert.ok(new Set(others).size >= 2, '不同角色的拆分不该完全一样');
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

  // AI 口径（2026-11-03）：66 关逐关累加，每关按 60%~80% 拆，所以两列都 > 0 且求和自洽
  const others = rows.filter((r) => !r.mine);
  for (const r of others) {
    assert.equal(r.total, (r.simple ?? 0) + (r.hard ?? 0), `${r.name} 的总分不等于简单+困难`);
    assert.ok((r.simple ?? 0) > 0, `${r.name} 的简单分必须 > 0`);
    assert.ok((r.hard ?? 0) > 0, `${r.name} 的困难分必须 > 0（剩下的都算困难）`);
    // 简单占比整体也落在 60%~80%（66 关累加后比例仍应在此区间内附近）
    const ratio = ((r.simple ?? 0) / (r.total ?? 1)) * 100;
    assert.ok(ratio >= 55 && ratio <= 85, `${r.name} 的简单占比 ${ratio.toFixed(1)}% 跑出 60%~80% 太远`);
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

test('结算跳转定位：「我」所在页算得准，没上榜就回第 1 页', () => {
  // 真实榜单：3000 分必进第 1 行（AI 累计分 = 66 关逐关相加，上限约 1056）→ 落在第 1 页
  const rows = buildTotalBoard({ simple: 3000, hard: 0 });
  assert.equal(pageOfMyRow(rows), 1, '第 1 行就是我 → 第 1 页');
  // 0 分必然垫底（1001 行 / 51 页）→ 我在最后一页，跳转要直接送过去
  assert.equal(pageOfMyRow(buildTotalBoard({ simple: 0, hard: 0 })), 51, '垫底 → 最后一页');

  // 造一个「我在第 3 页第 5 行」的榜（第 45 行）
  const fake = Array.from({ length: 60 }, (_, i) => ({ mine: i === 44 }));
  assert.equal(pageOfMyRow(fake), 3, '第 45 行 → 第 3 页');

  // 我在最后一行（页码正好等于总页数，不能越界成 4）
  const tail = Array.from({ length: 40 }, (_, i) => ({ mine: i === 39 }));
  assert.equal(pageOfMyRow(tail), 2, '第 40 行 → 第 2 页');

  // 榜里根本没有我（例如名次 > 100 不在百强行里）→ 回第 1 页，不能停在空页
  assert.equal(pageOfMyRow([{ mine: false }, { mine: false }]), 1);
  assert.equal(pageOfMyRow([]), 1, '空榜也返回第 1 页');
});

test('头像配色按昵称哈希稳定取一种（同一玩家每次一样）', () => {
  const a = avatarIndexOf('软糯布丁');
  assert.ok(a >= 0 && a < 3);
  assert.equal(avatarIndexOf('软糯布丁'), a, '同一昵称必须取到同一种');
  // 三种配色都要能被取到，否则等于只有一种
  const kinds = new Set(['软糯布丁', '元气团子', '抱抱豆豆', '咕噜柚子', '懒懒芝麻', '奶盖花卷'].map(avatarIndexOf));
  assert.ok(kinds.size >= 2, `昵称哈希只落到 ${kinds.size} 种配色`);
});
