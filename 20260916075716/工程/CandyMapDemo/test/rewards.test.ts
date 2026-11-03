/**
 * 后段奖励（2026-10-27 评审 P0-4）：金卡 = 困难 3★ 升级已解锁的普通卡；章节宝箱 = 简单通关第 40/45/50/55/60 关。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CHESTS,
  MAX_STAMINA_BONUS,
  STAMINA_MAX,
  chestOfLevel,
  createProgress,
  goldCardCount,
  goldCardIds,
  hardThreeStarLevels,
  newlyEarned,
  openedChests,
  ownedRewards,
  type ProgressData,
} from '../assets/scripts/核心/index.ts';
import { addStamina, createMeta, staminaCountdown } from '../assets/scripts/玩法/meta.ts';

/** 造一份进度：levels = 关卡号 → 星级 */
function prog(mode: 'normal' | 'nightmare', stars: Record<number, number>): ProgressData {
  const p = createProgress(mode);
  for (const [k, s] of Object.entries(stars)) {
    p.levels[Number(k)] = { stars: s, personalBest: s * 100, boardBest: 0, validBest: s * 100 };
  }
  return p;
}

test('金卡：困难 3★ 关数，且不超过已解锁的普通卡', () => {
  const hard = prog('nightmare', { 1: 3, 2: 3, 3: 2, 4: 3 });
  assert.equal(hardThreeStarLevels(hard), 3, '2★ 不算');
  assert.equal(goldCardCount(10, hard), 3);
  assert.equal(goldCardCount(2, hard), 2, '普通卡只有 2 张时最多 2 张金卡');
  assert.equal(goldCardCount(5, createProgress('nightmare')), 0);
});

test('金卡升级按图号顺序取已解锁卡的前 N 张', () => {
  const hard = prog('nightmare', { 1: 3, 2: 3 });
  assert.deepEqual(goldCardIds([4, 0, 2, 1], hard), [0, 1]);
});

test('章节宝箱：简单模式通关（≥1★）对应关才开，困难不算', () => {
  assert.deepEqual(CHESTS.map((c) => c.level), [40, 45, 50, 55, 60]);
  assert.equal(chestOfLevel(50)?.staminaBonus, 2);
  assert.equal(chestOfLevel(41), undefined);
  assert.deepEqual(openedChests(prog('normal', { 40: 1, 45: 0, 50: 3 })).map((c) => c.level), [40, 50]);
  const owned = ownedRewards(prog('normal', { 40: 1, 45: 2, 50: 1, 55: 1, 60: 1 }));
  assert.deepEqual(owned.frames, ['star', 'king']);
  assert.deepEqual(owned.skins, ['candy', 'clean']);
  assert.deepEqual(owned.titles, ['拼图达人']);
  assert.equal(owned.staminaBonus, MAX_STAMINA_BONUS);
});

test('一次结算新拿到了什么：金卡差值 + 新开的宝箱', () => {
  const before = { normal: prog('normal', { 39: 3 }), nightmare: prog('nightmare', { 1: 3 }), owned: 5 };
  const after = { normal: prog('normal', { 39: 3, 40: 1 }), nightmare: prog('nightmare', { 1: 3, 2: 3 }), owned: 5 };
  const got = newlyEarned(before, after);
  assert.equal(got.gold, 1);
  assert.deepEqual(got.chests.map((c) => c.level), [40]);
  assert.deepEqual(newlyEarned(after, after), { gold: 0, chests: [] }, '重复通关不重复发');
});

test('体力上限加成：上限 +2 后广告能加到 12，满格判定跟着变', () => {
  const meta = createMeta(0);
  meta.staminaMax = STAMINA_MAX + 2;
  meta.stamina = { available: STAMINA_MAX, pending: 0 };
  assert.notEqual(staminaCountdown(meta, 0), null, '10/12 不算满');
  assert.equal(addStamina(meta, 0, 5), true);
  assert.equal(meta.stamina.available, STAMINA_MAX + 2);
  assert.equal(staminaCountdown(meta, 0), null);
});
