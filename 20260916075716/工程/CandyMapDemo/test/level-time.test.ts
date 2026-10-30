/**
 * 关卡时长（2026-10-30 合并后按 main 规则：按关段 180 / 240 / 300 秒，两种模式相同）。
 * 评审分支（2026-10-27 P1-4）的逐关时长表只覆盖 60 关，已撤下；`timeLimitOf()` 保留签名改走 `timeLimitFor()`。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  MAX_TIME_LIMIT,
  PuzzleEngine,
  Rng,
  TOTAL_LEVELS,
  buildLevelConfigs,
  createSaveData,
  parseSave,
  reviveSecondsFor,
  serializeSave,
  timeLimitFor,
  timeLimitOf,
} from '../assets/scripts/核心/index.ts';
import { SAVE_LIMITS } from '../assets/scripts/玩法/state.ts';

test('按关段取时长：1~60 关 180 秒、61~120 关 240 秒、121~180 关 300 秒', () => {
  assert.equal(timeLimitFor(1), 180);
  assert.equal(timeLimitFor(60), 180);
  assert.equal(timeLimitFor(61), 240);
  assert.equal(timeLimitFor(120), 240);
  assert.equal(timeLimitFor(121), 300);
  assert.equal(timeLimitFor(TOTAL_LEVELS), 300);
});

test('timeLimitOf 两种模式都走按关段时长', () => {
  for (let level = 1; level <= TOTAL_LEVELS; level++) {
    assert.equal(timeLimitOf(level, 'normal'), timeLimitFor(level));
    assert.equal(timeLimitOf(level, 'nightmare'), timeLimitFor(level));
  }
});

test('关卡配置的时长与按关段时长一致', () => {
  for (const mode of ['normal', 'nightmare'] as const) {
    for (const cfg of buildLevelConfigs(mode)) {
      assert.equal(cfg.timeLimit, timeLimitFor(cfg.level), `${mode} 第 ${cfg.level} 关`);
    }
  }
});

test('存档上限放得下最长关的时长', () => {
  assert.ok(SAVE_LIMITS.timeLimit >= MAX_TIME_LIMIT);
});

test('最长关续命后的断点能原样恢复', () => {
  const T0 = 1_700_000_000_000;
  const cfg = buildLevelConfigs('nightmare').find((c) => c.level === TOTAL_LEVELS)!;
  const rng = new Rng(4321);
  const engine = new PuzzleEngine(cfg, rng);
  // 续命加时后剩余时间不会超过本关总时长（续命是在时间耗尽时触发的）
  const timeLeft = Math.min(SAVE_LIMITS.timeLimit, reviveSecondsFor(TOTAL_LEVELS));

  const data = createSaveData('nightmare', T0);
  data.session = {
    mode: 'nightmare', level: TOTAL_LEVELS, seed: 4321, rngState: rng.snapshot,
    cells: engine.board.toArray(), score: 0, eliminations: 0, timeLeft,
    started: false, revived: true, revivedUsed: true, swapMisses: 0, eliminatedOnce: false, savedAt: T0,
  };
  const result = parseSave(serializeSave(data), createSaveData('nightmare', T0), SAVE_LIMITS, T0);
  assert.equal(result.data.session?.timeLeft, timeLeft, result.issues.join('；'));
});
