/**
 * 排行分（2026-10-27 评审 P1-1）：每组 100 + 速度分；老存档 / 老断点按组数 ×100 迁移。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  SCORE_RULE,
  addElimination,
  createSaveData,
  createTally,
  onRevive,
  parseSave,
  pointsForElimination,
  pointsOfGroups,
  serializeSave,
  TOTAL_LEVELS,
  STAMINA_MAX,
  TIME_LIMIT,
  type SaveLimits,
} from '../assets/scripts/核心/index.ts';

const LIMITS: SaveLimits = { totalLevels: TOTAL_LEVELS, staminaMax: STAMINA_MAX, timeLimit: 300, adStaminaDailyMax: 5 };
const T0 = 1_700_000_000_000;

test('速度分：间隔 0 秒满额 60，每秒 −10，6 秒及以上为 0', () => {
  assert.equal(pointsForElimination(0), SCORE_RULE.base + 60);
  assert.equal(pointsForElimination(1), 150);
  assert.equal(pointsForElimination(3.9), 130, '按整秒算');
  assert.equal(pointsForElimination(6), 100);
  assert.equal(pointsForElimination(40), 100, '慢也至少拿基础分');
  assert.equal(pointsForElimination(-5), 160, '负间隔按 0');
});

test('计分器：按倒计时剩余秒数之差算间隔，续命加时不白送速度分', () => {
  const t = createTally(120);
  assert.equal(addElimination(t, 118), 140, '开表 2 秒后第一组');
  assert.equal(addElimination(t, 108), 100, '隔 10 秒');
  assert.equal(addElimination(t, 107), 150, '隔 1 秒');
  assert.equal(t.points, 390);

  // 时间到 0 → 续命 +60：基准跟着抬，续命后 3 秒消除只算 3 秒间隔
  addElimination(t, 0);
  const before = t.points;
  onRevive(t, 60);
  assert.equal(addElimination(t, 57), 130);
  assert.equal(t.points, before + 130);
});

test('组数 → 排行分保底换算', () => {
  assert.equal(pointsOfGroups(9), 900);
  assert.equal(pointsOfGroups(-1), 0);
});

test('老存档（无 scoreUnit）三个最高分 ×100 迁移；新存档原样往返', () => {
  const raw = JSON.parse(serializeSave(createSaveData('normal', T0)));
  delete raw.scoreUnit;
  raw.progress.normal.levels = { 3: { stars: 3, personalBest: 9, boardBest: 8, validBest: 8 } };
  const old = parseSave(JSON.stringify(raw), createSaveData('normal', T0), LIMITS, T0);
  assert.deepEqual(old.data.progress.normal.levels[3], { stars: 3, personalBest: 900, boardBest: 800, validBest: 800 });
  assert.equal(old.recovered, false, '迁移不算修复');
  assert.equal(old.data.scoreUnit, 'points');

  // 迁移后再存再读：不能再乘一次
  const again = parseSave(serializeSave(old.data), createSaveData('normal', T0), LIMITS, T0);
  assert.equal(again.data.progress.normal.levels[3]?.personalBest, 900);
});

test('TIME_LIMIT 仍是缺表兜底', () => {
  assert.equal(TIME_LIMIT, 180);
});
