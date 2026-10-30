/**
 * 广告额度拆分（2026-10-26 评审 P0-2）：加体力与续命分开计数、同一天内互不影响、跨天一起归零。
 *
 * 测的是小游戏实际用的 `assets/scripts/玩法/meta.ts`（`test/meta.test.ts` 测的是 web 版）。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  AD_REVIVE_DAILY_MAX,
  AD_STAMINA_DAILY_MAX,
  adReviveLeft,
  adStaminaLeft,
  createMeta,
  recordAdRevive,
  recordAdStamina,
} from '../assets/scripts/玩法/meta.ts';

const T0 = new Date('2026-10-26T10:00:00').getTime();
const DAY = 24 * 60 * 60 * 1000;

test('续命广告不占加体力额度，加体力也不占续命额度', () => {
  const meta = createMeta(T0);
  for (let i = 0; i < 3; i++) recordAdRevive(meta);
  assert.equal(adStaminaLeft(meta, T0), AD_STAMINA_DAILY_MAX);
  assert.equal(adReviveLeft(meta, T0), AD_REVIVE_DAILY_MAX - 3);

  recordAdStamina(meta);
  assert.equal(adStaminaLeft(meta, T0), AD_STAMINA_DAILY_MAX - 1);
  assert.equal(adReviveLeft(meta, T0), AD_REVIVE_DAILY_MAX - 3);
});

test('续命额度用完为止，不会变成负数', () => {
  const meta = createMeta(T0);
  for (let i = 0; i < AD_REVIVE_DAILY_MAX + 2; i++) recordAdRevive(meta);
  assert.equal(adReviveLeft(meta, T0), 0);
});

test('跨天：两种额度一起归零', () => {
  const meta = createMeta(T0);
  recordAdRevive(meta);
  recordAdStamina(meta);
  assert.equal(adReviveLeft(meta, T0 + DAY), AD_REVIVE_DAILY_MAX);
  assert.equal(adStaminaLeft(meta, T0 + DAY), AD_STAMINA_DAILY_MAX);
});
