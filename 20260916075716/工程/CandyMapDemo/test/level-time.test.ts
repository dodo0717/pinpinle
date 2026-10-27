/**
 * 逐关时长（2026-10-27 评审 P1-4）：表齐全、区间合法、困难不短于简单、关卡配置真的用上了表。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  LEVEL_TIME,
  LEVEL_TIME_MAX,
  LEVEL_TIME_MIN,
  NIGHTMARE_LEVEL_TIME,
  PuzzleEngine,
  Rng,
  TOTAL_LEVELS,
  buildLevelConfigs,
  createSaveData,
  parseSave,
  serializeSave,
  timeLimitOf,
  validateLevelDesign,
} from '../assets/scripts/核心/index.ts';
import { SAVE_LIMITS } from '../assets/scripts/玩法/state.ts';

test('两张时长表 60 关齐全，且都在合法区间内', () => {
  for (let level = 1; level <= TOTAL_LEVELS; level++) {
    for (const t of [LEVEL_TIME[level], NIGHTMARE_LEVEL_TIME[level]]) {
      assert.ok(t !== undefined, `第 ${level} 关缺时长`);
      assert.ok(t >= LEVEL_TIME_MIN && t <= LEVEL_TIME_MAX, `第 ${level} 关时长 ${t} 越界`);
    }
  }
});

test('困难时长不短于简单（困难只能相邻交换）', () => {
  for (let level = 1; level <= TOTAL_LEVELS; level++) {
    assert.ok(NIGHTMARE_LEVEL_TIME[level]! >= LEVEL_TIME[level]!, `第 ${level} 关困难比简单短`);
  }
});

test('设计表自检不报时长问题', () => {
  const issues = validateLevelDesign().filter((i) => i.message.includes('时长'));
  assert.deepEqual(issues, []);
});

test('关卡配置按模式取逐关时长', () => {
  const normal = buildLevelConfigs('normal');
  const hard = buildLevelConfigs('nightmare');
  for (const cfg of normal) assert.equal(cfg.timeLimit, timeLimitOf(cfg.level, 'normal'));
  for (const cfg of hard) assert.equal(cfg.timeLimit, timeLimitOf(cfg.level, 'nightmare'));
  assert.equal(normal.find((c) => c.level === 1)!.timeLimit, LEVEL_TIME[1]);
  assert.equal(hard.find((c) => c.level === 60)!.timeLimit, NIGHTMARE_LEVEL_TIME[60]);
});

test('最长关 + 续命 60 秒的断点能原样恢复（存档 timeLeft 上限不再是 180）', () => {
  const T0 = 1_700_000_000_000;
  const cfg = buildLevelConfigs('nightmare').find((c) => c.level === 60)!;
  const rng = new Rng(4321);
  const engine = new PuzzleEngine(cfg, rng);
  const timeLeft = NIGHTMARE_LEVEL_TIME[60]! + 60; // 续命后的最大可能值
  assert.ok(timeLeft <= SAVE_LIMITS.timeLimit, `上限 ${SAVE_LIMITS.timeLimit} 装不下 ${timeLeft}`);

  const data = createSaveData('nightmare', T0);
  data.session = {
    mode: 'nightmare', level: 60, seed: 4321, rngState: rng.snapshot,
    cells: engine.board.toArray(), score: 0, eliminations: 0, timeLeft,
    started: false, revived: true, revivedUsed: true, swapMisses: 0, eliminatedOnce: false, savedAt: T0,
  };
  const result = parseSave(serializeSave(data), createSaveData('nightmare', T0), SAVE_LIMITS, T0);
  assert.equal(result.data.session?.timeLeft, timeLeft, result.issues.join('；'));
});
