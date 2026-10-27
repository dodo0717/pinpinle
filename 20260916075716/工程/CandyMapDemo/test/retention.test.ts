/**
 * 回访系统（2026-10-27 评审 P1-6）：7 日签到 / 每日挑战 / 回流礼包 / 续命券 + 存档迁移。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CHECKIN_REWARDS,
  DAILY_LEVEL_RANGE,
  DAILY_MAX_PLAYS,
  STAMINA_MAX,
  TOTAL_LEVELS,
  canCheckin,
  checkin,
  createRetention,
  createSaveData,
  dailyLevel,
  dailyPlaysLeft,
  dailySeed,
  daysBetween,
  finishDailyPlay,
  goldCardCount,
  createProgress,
  onLogin,
  parseSave,
  serializeSave,
  startDailyPlay,
  useReviveTicket,
  type SaveLimits,
} from '../assets/scripts/核心/index.ts';

const DAY = 86_400_000;
const T0 = new Date('2026-10-27T10:00:00').getTime();
const LIMITS: SaveLimits = { totalLevels: TOTAL_LEVELS, staminaMax: STAMINA_MAX + 2, timeLimit: 300, adStaminaDailyMax: 5 };

test('签到：每天一次，7 天一轮，断签不清零', () => {
  const s = createRetention();
  assert.equal(checkin(s, T0)?.day, 1);
  assert.equal(checkin(s, T0 + 3600_000), null, '同一天不能再签');
  assert.equal(canCheckin(s, T0 + DAY), true);
  // 断签 5 天再来：接着第 2 天，不回到第 1 天
  assert.equal(checkin(s, T0 + 6 * DAY)?.day, 2);
  for (let i = 0; i < 5; i++) checkin(s, T0 + (7 + i) * DAY);
  assert.equal(s.checkinDays, 7);
  assert.equal(s.bonusGold, 1, '第 7 天送金卡');
  assert.equal(checkin(s, T0 + 20 * DAY)?.day, 1, '7 天一轮');
  assert.equal(CHECKIN_REWARDS.length, 7);
});

test('签到送的续命券记进状态，用一张少一张', () => {
  const s = createRetention();
  for (let i = 0; i < 3; i++) checkin(s, T0 + i * DAY);
  assert.equal(s.reviveTickets, 1, '第 3 天一张');
  assert.equal(useReviveTicket(s), true);
  assert.equal(useReviveTicket(s), false);
});

test('签到金卡同样只能升级已解锁的普通卡', () => {
  assert.equal(goldCardCount(5, createProgress('nightmare'), 1), 1);
  assert.equal(goldCardCount(0, createProgress('nightmare'), 1), 0);
});

test('每日挑战：同一天同一关同一种子；每天 3 次；首次通关才发奖；跨天归零', () => {
  const day = '2026-10-27';
  assert.equal(dailySeed(day), dailySeed(day));
  assert.notEqual(dailySeed(day), dailySeed('2026-10-28'));
  const lv = dailyLevel(day);
  assert.ok(lv >= DAILY_LEVEL_RANGE[0] && lv <= DAILY_LEVEL_RANGE[1]);

  const s = createRetention();
  for (let i = 0; i < DAILY_MAX_PLAYS; i++) assert.equal(startDailyPlay(s, T0), true);
  assert.equal(startDailyPlay(s, T0), false, '第 4 次不让开');
  assert.equal(finishDailyPlay(s, T0, true, 900), true, '首次通关');
  assert.equal(finishDailyPlay(s, T0, true, 1200), false, '再通关不再发');
  assert.equal(s.dailyBest, 1200);
  assert.equal(dailyPlaysLeft(s, T0 + DAY), DAILY_MAX_PLAYS);
  assert.equal(s.dailyBest, 0, '跨天清今日最好');
});

test('回流：≥3 天没来才算，发 1 张续命券；第一次启动不算', () => {
  const s = createRetention();
  assert.equal(onLogin(s, T0).comeback, false, '第一次启动');
  assert.equal(onLogin(s, T0 + 2 * DAY).comeback, false);
  assert.equal(onLogin(s, T0 + 5 * DAY).comeback, true);
  assert.equal(s.reviveTickets, 1);
  assert.equal(daysBetween('2026-10-27', '2026-11-01'), 5);
});

test('存档：老存档没有 retention → 默认值不算修复；新存档原样往返；坏日期兜底', () => {
  const raw = JSON.parse(serializeSave(createSaveData('normal', T0)));
  delete raw.meta.retention;
  const old = parseSave(JSON.stringify(raw), createSaveData('normal', T0), LIMITS, T0);
  assert.deepEqual(old.data.meta.retention, createRetention());
  assert.equal(old.recovered, false);

  const data = createSaveData('normal', T0);
  checkin(data.meta.retention, T0);
  data.meta.retention.reviveTickets = 2;
  const back = parseSave(serializeSave(data), createSaveData('normal', T0), LIMITS, T0);
  assert.deepEqual(back.data.meta.retention, data.meta.retention);

  raw.meta.retention = { lastCheckinDay: 'yesterday', checkinDays: -4 };
  const bad = parseSave(JSON.stringify(raw), createSaveData('normal', T0), LIMITS, T0);
  assert.equal(bad.data.meta.retention.lastCheckinDay, '');
  assert.equal(bad.data.meta.retention.checkinDays, 0);
});
