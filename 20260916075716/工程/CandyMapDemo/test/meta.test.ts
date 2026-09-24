/**
 * M5 元系统与界面文案的单测。
 *
 * 为什么界面层的代码也要单测：`web/ui/meta.ts`（体力恢复 / 广告次数 / 图鉴解锁）和
 * `web/ui/leaderboard.ts` 的榜单生成是**纯函数**，跟 DOM 无关；它们是「界面里唯一会算错的地方」。
 * 而布局、事件绑定那些只能靠手点，测不了就明确不测 —— 不写假测试充数。
 *
 * 覆盖重点：
 *   - 体力按 20 分钟恢复（§13.1），用时间戳推进，不受定时器漂移影响；
 *   - 广告每日 5 次 + 跨天归零（§13.3），且加体力要按上限截断；
 *   - 图鉴解锁 = 已通关关卡（§10.3），不额外维护一张会分叉的表；
 *   - 百名榜的模拟玩家必须**确定性**（同一关两次一致）、恰好 100 名、
 *     且分数全部 ≥ 本关 3★ 线（1★ / 2★ 与续命局根本不上榜）。
 *
 * ⚠️ 2026-09-12：榜单数据源从 `web/ui/leaderboard.ts` 搬到了 `assets/scripts/core/honor.ts`
 * （`boardSnapshot` / `mockBoardScores`），界面模块不再自己造数据 —— 所以下面的用例
 * 改成直接核对 core 层，界面层只保留「挑战本关」状态机。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createProgress,
  commitSettlement,
  levelStatus,
  recordOf,
  settleLevel,
  LEVEL_REWARD_CONFIG,
  REWARD_LEVELS,
  STAMINA_MAX,
  boardSnapshot,
  mockBoardNames,
  mockBoardScores,
  type LevelOutcome,
} from '../assets/scripts/core/index.ts';
import {
  AD_STAMINA_DAILY_MAX,
  STAMINA_RECOVER_MS,
  addStamina,
  adStaminaLeft,
  armRecovery,
  createMeta,
  recordAdStamina,
  rollOverDay,
  staminaCountdown,
  tickMeta,
  unlockedImageIds,
} from '../web/ui/meta.ts';
import { challengeState } from '../web/ui/leaderboard.ts';
import { tierOfLevel } from '../web/ui/text.ts';

const T0 = new Date('2026-09-11T10:00:00').getTime();
const MINUTE = 60 * 1000;

/* ------------------------------------------------------------------ 体力恢复（§13.1） */

test('新账号送满体力，满格时不给倒计时', () => {
  const meta = createMeta(T0);
  assert.equal(meta.stamina.available, STAMINA_MAX);
  assert.equal(meta.stamina.pending, 0);
  // 「体力满时不显示倒计时」（§11.1）
  assert.equal(staminaCountdown(meta, T0), null);
  assert.equal(meta.nextRecoverAt, null);
});

test('消耗体力后 20 分钟恢复 1 颗，倒计时是 MM:SS', () => {
  const meta = createMeta(T0);
  // 用「差 1 颗满」起步：恢复 1 颗后正好满格，才能顺带验「满了就停表」
  meta.stamina = { available: STAMINA_MAX - 1, pending: 0 };
  armRecovery(meta, T0);

  // 计时起点刚点起来：倒计时 = 20:00
  assert.equal(staminaCountdown(meta, T0), '20:00');
  assert.equal(staminaCountdown(meta, T0 + 1 * MINUTE), '19:00');
  assert.equal(staminaCountdown(meta, T0 + 19 * MINUTE + 59 * 1000), '00:01');

  // 差 1 秒还不恢复
  tickMeta(meta, T0 + STAMINA_RECOVER_MS - 1000);
  assert.equal(meta.stamina.available, STAMINA_MAX - 1);

  // 到点恢复 1 颗
  assert.equal(tickMeta(meta, T0 + STAMINA_RECOVER_MS), true);
  assert.equal(meta.stamina.available, STAMINA_MAX);
  // 满了就把计时器停掉，否则「满格期间流逝的时间」会在下次消耗时被白算掉
  assert.equal(meta.nextRecoverAt, null);
});

test('一次时间跳跃可以补多颗，且不越过上限', () => {
  const meta = createMeta(T0);
  meta.stamina = { available: 1, pending: 0 };
  armRecovery(meta, T0);

  // 跳到 10 小时后：足够恢复很多颗，但只能补到上限
  tickMeta(meta, T0 + 10 * 60 * MINUTE);
  assert.equal(meta.stamina.available, STAMINA_MAX);
  assert.equal(meta.nextRecoverAt, null);
});

test('体力恢复不会吞掉正在预扣的那颗（pending 与 available 分开）', () => {
  const meta = createMeta(T0);
  meta.stamina = { available: STAMINA_MAX - 1, pending: 1 };
  armRecovery(meta, T0);
  tickMeta(meta, T0 + STAMINA_RECOVER_MS);
  assert.equal(meta.stamina.pending, 1);
  assert.equal(meta.stamina.available, STAMINA_MAX);
});

test('加体力按上限截断，满格时返回 false（界面据此提示「体力已满」）', () => {
  const meta = createMeta(T0);
  assert.equal(addStamina(meta, T0, 1), false);
  assert.equal(meta.stamina.available, STAMINA_MAX);

  meta.stamina = { available: STAMINA_MAX - 1, pending: 0 };
  assert.equal(addStamina(meta, T0, 3), true);
  assert.equal(meta.stamina.available, STAMINA_MAX);
});

/* ------------------------------------------------------------------ 广告次数（§13.3） */

test('加体力广告每日 5 次，用完为止', () => {
  const meta = createMeta(T0);
  meta.stamina = { available: 0, pending: 0 };
  assert.equal(adStaminaLeft(meta, T0), AD_STAMINA_DAILY_MAX);

  for (let i = 0; i < AD_STAMINA_DAILY_MAX; i++) recordAdStamina(meta);
  assert.equal(adStaminaLeft(meta, T0), 0);

  // 再记也不会变成负数
  recordAdStamina(meta);
  assert.equal(adStaminaLeft(meta, T0), 0);
});

test('跨天重置广告次数，同一天内不重置', () => {
  const meta = createMeta(T0);
  recordAdStamina(meta);
  recordAdStamina(meta);
  assert.equal(adStaminaLeft(meta, T0), AD_STAMINA_DAILY_MAX - 2);

  // 同一天稍晚一点：不重置
  assert.equal(rollOverDay(meta, T0 + 6 * 60 * MINUTE), false);
  assert.equal(adStaminaLeft(meta, T0 + 6 * 60 * MINUTE), AD_STAMINA_DAILY_MAX - 2);

  // 跨到第二天：归零
  assert.equal(rollOverDay(meta, T0 + 24 * 60 * MINUTE), true);
  assert.equal(adStaminaLeft(meta, T0 + 24 * 60 * MINUTE), AD_STAMINA_DAILY_MAX);
});

/* ------------------------------------------------------------------ 图鉴解锁（§10.3） */

/** 造一份「第 1~n 关已通关」的进度（走真实的结算函数，不手搓 records） */
function progressWithCleared(levels: number[]): ReturnType<typeof createProgress> {
  let progress = createProgress('normal');
  for (const level of levels) {
    const outcome: LevelOutcome = {
      level,
      score: 100,
      star1: 10,
      star2: 20,
      star3: 30,
      revived: false,
    };
    const settlement = settleLevel(outcome, undefined);
    assert.ok(settlement, `第 ${level} 关应当判为通关`);
    progress = commitSettlement(progress, outcome, settlement, 60);
  }
  return progress;
}

test('图鉴解锁 = 已通关关卡，且只到 36 张', () => {
  const progress = progressWithCleared([1, 2, 3]);
  const ids = unlockedImageIds(progress);
  assert.deepEqual(ids, [1, 2, 3].map((level) => LEVEL_REWARD_CONFIG[level]));

  // 升序、无重复
  assert.deepEqual([...ids].sort((a, b) => a - b), ids);
});

test('没通关就没有解锁的图', () => {
  assert.deepEqual(unlockedImageIds(createProgress('normal')), []);
});

test('第 37 关之后不再有图鉴奖励（§10.2 只配到第 36 关）', () => {
  assert.equal(LEVEL_REWARD_CONFIG[REWARD_LEVELS + 3], undefined);
  assert.equal(unlockedImageIds(progressWithCleared([37, 40])).length, 0);
});

/* ------------------------------------------------------------------ 百名榜模拟数据（《通关及排名》§2） */

const LINES = { star1: 20, star2: 40, star3: 60 };

test('模拟玩家：同一关两次生成的名单与分数完全一致（确定性，便于验收）', () => {
  assert.deepEqual(mockBoardScores(7, LINES), mockBoardScores(7, LINES));
  assert.deepEqual(mockBoardNames(7), mockBoardNames(7));
});

test('模拟玩家硬约束：恰好 100 名、昵称不重复、分数全部 ≥ 本关 3★ 线', () => {
  const scores = mockBoardScores(5, LINES);
  const names = mockBoardNames(5);
  assert.equal(scores.length, 100, '模拟玩家必须是 100 名');
  assert.equal(new Set(names).size, 100, '100 个昵称必须互不重复');
  const lowest = Math.min(...scores);
  assert.ok(lowest >= LINES.star3, `最低分 ${lowest} 不应低于 3★ 线 ${LINES.star3}`);
  assert.ok(
    scores.some((s) => s > LINES.star3),
    '不能所有人都刚好压在 3★ 线上，否则名次分不出来',
  );
});

test('百名榜：分数降序、名次升序且唯一、条目名次不超过 100（第 100 名可并列）', () => {
  const snap = boardSnapshot(5, LINES, 0);
  assert.equal(snap.totalPlayers, 100, '没上榜时总玩家数就是 100 名模拟玩家');
  assert.ok(snap.rows.length > 0, '榜单不该为空');
  for (let i = 1; i < snap.rows.length; i++) {
    assert.ok((snap.rows[i]?.score ?? 0) <= (snap.rows[i - 1]?.score ?? 0), '榜单必须按分数降序');
  }
  const ranks = snap.rows.map((row) => row.rank);
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b), '名次必须升序');
  assert.ok(Math.max(...ranks) <= 100, `百强榜不该出现第 100 名之后的名次，实际最高 ${Math.max(...ranks)}`);
  // 同分同名次：分数相同的条目名次必须相同，分数不同的条目名次必须不同
  for (let i = 1; i < snap.rows.length; i++) {
    const cur = snap.rows[i]!;
    const prev = snap.rows[i - 1]!;
    assert.equal(
      cur.rank === prev.rank,
      cur.score === prev.score,
      `名次与分数的对应关系不对：第 ${i} 条 ${cur.score} 分 / ${cur.rank} 名`,
    );
  }
  // 没上榜：没有「我」这一条
  assert.equal(snap.myRank, null);
  assert.equal(snap.myBoardBest, 0);
});

test('百名榜：我的上榜成绩会并进榜单，并给出我的名次', () => {
  const snap = boardSnapshot(5, LINES, 999);
  assert.equal(snap.totalPlayers, 101, '本机上榜后总玩家数 +1');
  assert.equal(snap.myRank, 1, '999 分必然第一');
  assert.equal(snap.rows.filter((row) => row.mine).length, 1, '「我」只能出现一次');
});

/* ------------------------------------------------------------------ 排行榜「挑战本关」状态机（§9.3） */

/** 造一份「第 1 关起依次拿 1★ / 2★ / 3★」的进度（星线 10 / 20 / 30） */
function progressWithStars(stars: number[]): ReturnType<typeof createProgress> {
  let progress = createProgress('normal');
  stars.forEach((want, i) => {
    const level = i + 1;
    const outcome: LevelOutcome = {
      level,
      score: want * 10,
      star1: 10,
      star2: 20,
      star3: 30,
      revived: false,
    };
    const settlement = settleLevel(outcome, undefined);
    assert.ok(settlement, `第 ${level} 关应当判为通关`);
    assert.equal(settlement.stars, want, `第 ${level} 关应当判 ${want} 星`);
    progress = commitSettlement(progress, outcome, settlement, 60);
  });
  return progress;
}

test('排行榜「挑战本关」：1★ / 2★ / 3★ 通关的关卡都允许挑战', () => {
  const progress = progressWithStars([1, 2, 3]);
  assert.deepEqual(
    [1, 2, 3].map((level) => recordOf(progress, level).stars),
    [1, 2, 3],
  );
  for (const level of [1, 2, 3]) {
    const state = challengeState(level, levelStatus(progress, level), true);
    assert.equal(state.dim, false, `第 ${level} 关（${recordOf(progress, level).stars}★）应当允许挑战`);
    assert.equal(state.hint, '');
  }
});

test('排行榜「挑战本关」：未通关 / 未解锁 / 素材不足都必须置灰并说明原因', () => {
  const progress = progressWithStars([1, 2, 3]); // 通关到第 3 关 → unlocked = 4
  // 已解锁但没通关：没有成绩可刷，先通一关
  assert.deepEqual(challengeState(4, levelStatus(progress, 4), true), { dim: true, hint: '通关后解锁' });
  // 还没解锁
  assert.deepEqual(challengeState(5, levelStatus(progress, 5), true), { dim: true, hint: '通关前一关后解锁' });
  // 已通关但素材不足：提示必须说清是素材问题，而不是被误读成「没通关」
  const unplayable = challengeState(1, levelStatus(progress, 1), false);
  assert.equal(unplayable.dim, true);
  assert.ok(unplayable.hint.includes('素材'), `提示应当说明素材不足，实际是「${unplayable.hint}」`);
});

/* ------------------------------------------------------------------ 段位表（§8.1） */

test('段位表边界正确（含 60 关与越界）', () => {
  assert.equal(tierOfLevel(1), '新手村');
  assert.equal(tierOfLevel(3), '新手村');
  assert.equal(tierOfLevel(4), '入门');
  assert.equal(tierOfLevel(6), '入门');
  assert.equal(tierOfLevel(7), '进阶');
  assert.equal(tierOfLevel(15), '进阶');
  assert.equal(tierOfLevel(16), '高手');
  assert.equal(tierOfLevel(20), '高手');
  assert.equal(tierOfLevel(21), '精英');
  assert.equal(tierOfLevel(35), '精英');
  assert.equal(tierOfLevel(36), '大师');
  assert.equal(tierOfLevel(50), '大师');
  assert.equal(tierOfLevel(51), '传说');
  assert.equal(tierOfLevel(60), '传说');
  assert.equal(tierOfLevel(61), '—');
});
