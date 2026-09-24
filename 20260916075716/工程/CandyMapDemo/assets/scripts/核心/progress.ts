/**
 * M4 · 关卡进度与结算规则层（纯逻辑，零 DOM / 零 Cocos 依赖）
 *
 * 为什么单独一个文件：M4 的**界面**只做一次（在 Cocos 里，见灰盒验收后的路线），
 * 但「几分算几星、时间归零算不算通关、续命之后判几星、最高分记哪个、什么时候解锁
 * 下一关、体力的预扣怎么退」这些规则必须能脱离 UI 单测 —— 与 M2 的算法层同理。
 *
 * 权威依据：《策划案V10》§7.2 / §7.3.3 / §7.4 / §12.1.1~§12.1.4 / §12.2 / §12.3 / §12.4。
 */

import type { GameMode } from './config';

/* ------------------------------------------------------------------ 类型 */

/** 关卡状态（§7.3.3）：未解锁 / 已解锁未通关 / 已通关 */
export type LevelStatus = 'locked' | 'unlocked' | 'cleared';

/** 结算弹窗的 4 种形态（§12.1.1 ~ §12.1.4） */
export type SettlementKind = 'first' | 'repeat' | 'first-revived' | 'repeat-revived';

/** 一关的历史记录 */
export interface LevelRecord {
  /** 历史最高星级 0~3 */
  stars: number;
  /** 个人最高分（含续命局） */
  personalBest: number;
  /**
   * 上榜最高分（用于排行榜与荣誉档位）。
   *
   * §7.4 要求与「个人最高分」**分开记录**：续命局统一判 1 星、不上排行榜，
   * 所以续命局只更新 `personalBest`，不更新 `boardBest` —— 否则「靠续命刷榜」。
   *
   * ⚠️ 2026-09-12 修订（《通关及排名》）：**上榜门槛 = 3 星**。
   * 1★ / 2★ 的成绩和续命局一样不上排行榜，因此也不写进 `boardBest`。
   * 榜单上因此只有 3★ 及以上的人（与「100 名模拟玩家全部要求 3 星以上分数」同口径）。
   */
  boardBest: number;
}

/**
 * 一次结算的输入（由界面在关卡结束时收集）。
 *
 * ⚠️ **这里没有「结束原因」字段，是刻意的**：关卡结束**只有一个原因 —— 倒计时归零**（§7.2），
 * 所以「怎么结束的」不该出现在结算契约里。2026-09-11 之前曾有一个 `timedOut` 字段
 * （用来区分「时间归零」与「图全部消完」两种结束原因），但第二种原因并不存在
 * （图池无限补位、棋盘不可能消完），该字段也从未被任何逻辑读取 —— 留着它只会诱导
 * 别人再往里塞第二种结束条件。来龙去脉见《开发计划》§15.6 第 11 条。
 */
export interface LevelOutcome {
  level: number;
  score: number;
  /** 本关三条星线（来自 `LevelConfig`，即设计表逐关给定值） */
  star1: number;
  star2: number;
  star3: number;
  /** 本局是否用过续命 */
  revived: boolean;
}

/** 一次结算的结论（界面据此决定弹窗形态与按钮） */
export interface LevelSettlement {
  kind: SettlementKind;
  /** 最终星级 1~3（续命局恒为 1） */
  stars: number;
  /** 是否首次拿到 ≥1 星 → 是否解锁下一关 */
  unlockNext: boolean;
}

/** 一个模式下的全部进度 */
export interface ProgressData {
  mode: GameMode;
  /** 已解锁到的关卡号；`1` 表示只开了第 1 关 */
  unlocked: number;
  /** 关卡号 → 历史记录 */
  levels: Record<number, LevelRecord>;
}

/* ------------------------------------------------------------------ 星级 */

/** 按三条星线把得分折算成 0~3 星（0 = 没够到 1★ 线） */
export function starsFor(score: number, star1: number, star2: number, star3: number): number {
  if (score >= star3) return 3;
  if (score >= star2) return 2;
  if (score >= star1) return 1;
  return 0;
}

/**
 * 上榜门槛星级（《通关及排名》2026-09-12）。
 *
 * 1★ / 2★ 的成绩**不上排行榜** —— 与续命局同一条口径，
 * 所以榜单上只有 3★ 及以上的人（荣誉弹窗也只在 ≥3★ 时才可能给超神/王者）。
 */
export const BOARD_MIN_STARS = 3;

/** 这次成绩够不够上榜（未续命 且 ≥ 3★） */
export function boardEligible(outcome: LevelOutcome, stars?: number): boolean {
  const finalStars = stars ?? starsFor(outcome.score, outcome.star1, outcome.star2, outcome.star3);
  return !outcome.revived && finalStars >= BOARD_MIN_STARS;
}

/**
 * 判定一次关卡结束。
 *
 * 规则：
 *   1. 得分没够到 1★ 线 → **未通关**，返回 `null`（界面走失败结算 §12.2）；
 *      续命也没救回来同样是失败，不能因为「看广告了」就算过。
 *   2. 续命局**统一判 1 星**（§7.4），哪怕最终分数够到了 2★/3★。
 *   3. 只有**首次**通关才解锁下一关（§7.3.3）；重复挑战不改变关卡进度。
 *
 * ⚠️ 2026-09-12 修订（《通关及排名》）：删掉了 `showNext` 字段。
 * 旧规则「重复通关不显示下一关」（§12.1.2 / §12.1.4）**已被新案覆盖** ——
 * 荣誉弹窗三档都提供「下一关」，重复通关同样弹出，所以「显不显示下一关」
 * 不再由结算结论决定，界面按「本关是不是最后一关」自己判断即可。
 *
 * ⚠️ 判星**只看分数与三条星线**：§7.2 没有「达标立即通关」，玩家玩满 180 秒，
 * 打出多少分就按多少分判星 —— **分数可以超过本关图数**（图池是无限补位的），
 * 不存在任何形式的分数上限。
 */
export function settleLevel(
  outcome: LevelOutcome,
  before?: LevelRecord,
): LevelSettlement | null {
  const raw = starsFor(outcome.score, outcome.star1, outcome.star2, outcome.star3);
  if (raw === 0) return null;

  const stars = outcome.revived ? 1 : raw;
  const firstClear = (before?.stars ?? 0) === 0;
  const kind: SettlementKind = firstClear
    ? outcome.revived
      ? 'first-revived'
      : 'first'
    : outcome.revived
      ? 'repeat-revived'
      : 'repeat';

  return { kind, stars, unlockNext: firstClear };
}

/** 把一次结算写进记录（不修改入参） */
export function applySettlement(
  before: LevelRecord | undefined,
  outcome: LevelOutcome,
  settlement: LevelSettlement,
): LevelRecord {
  const rec: LevelRecord = before ?? { stars: 0, personalBest: 0, boardBest: 0 };
  return {
    stars: Math.max(rec.stars, settlement.stars),
    personalBest: Math.max(rec.personalBest, outcome.score),
    // 续命局不上榜（§7.4）；1★ / 2★ 同样不上榜（《通关及排名》2026-09-12）
    boardBest: boardEligible(outcome, settlement.stars)
      ? Math.max(rec.boardBest, outcome.score)
      : rec.boardBest,
  };
}

/* ------------------------------------------------------------------ 进度 */

export function createProgress(mode: GameMode): ProgressData {
  return { mode, unlocked: 1, levels: {} };
}

/** 查询关卡状态（§7.3.3） */
export function levelStatus(data: ProgressData, level: number): LevelStatus {
  if ((data.levels[level]?.stars ?? 0) > 0) return 'cleared';
  return level <= data.unlocked ? 'unlocked' : 'locked';
}

/** 取某关记录（没有就返回全 0，调用方不用到处判空） */
export function recordOf(data: ProgressData, level: number): LevelRecord {
  return data.levels[level] ?? { stars: 0, personalBest: 0, boardBest: 0 };
}

/**
 * 结算后写回进度（不修改入参）。
 *
 * `unlocked` **只增不减**：重复挑战低关卡不会把已解锁的关卡收回去。
 */
export function commitSettlement(
  data: ProgressData,
  outcome: LevelOutcome,
  settlement: LevelSettlement,
  totalLevels: number,
): ProgressData {
  const record = applySettlement(data.levels[outcome.level], outcome, settlement);
  const unlocked = settlement.unlockNext
    ? Math.min(totalLevels, Math.max(data.unlocked, outcome.level + 1))
    : data.unlocked;
  return { ...data, unlocked, levels: { ...data.levels, [outcome.level]: record } };
}

/* ------------------------------------------------------------------ 体力（§12.4 入场计费） */

/**
 * 体力上限（§13.1）。20 分钟恢复 1 颗的计时由 M5 补，这里只管入场计费的三步。
 *
 * 2026-09-17 由 5 提到 10（产品口径）：0 → 回满 10 颗需 200 分钟，
 * 单次广告仍只 +1 颗、每日 `AD_STAMINA_DAILY_MAX` 次不变。
 */
export const STAMINA_MAX = 10;

export interface Stamina {
  /** 可用体力（不含预扣中的那 1 颗） */
  available: number;
  /** 预扣中的颗数：只可能是 0 或 1 */
  pending: number;
}

/** 拿不到结果时给出原因，不用布尔值糊过去（界面要按原因给不同文案） */
export type StaminaResult =
  | { ok: true; state: Stamina }
  | { ok: false; reason: 'exhausted' | 'already-pending' };

/** 进场预扣 1 颗（§12.4 第一步） */
export function preDeductStamina(state: Stamina): StaminaResult {
  if (state.pending > 0) return { ok: false, reason: 'already-pending' };
  if (state.available <= 0) return { ok: false, reason: 'exhausted' };
  return { ok: true, state: { available: state.available - 1, pending: 1 } };
}

/** 渲染完成 → 转正式扣除（§12.4 第二步：这颗不再退还） */
export function confirmStamina(state: Stamina): Stamina {
  return { available: state.available, pending: 0 };
}

/**
 * 中途退出 / 加载超时 → 退还（§12.4 第三步）。
 *
 * 退还时按上限截断：否则「预扣 → 退还」循环能把体力刷到超过上限。
 */
export function refundStamina(state: Stamina): Stamina {
  if (state.pending <= 0) return state;
  return { available: Math.min(STAMINA_MAX, state.available + 1), pending: 0 };
}
