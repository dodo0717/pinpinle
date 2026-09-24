/**
 * M5 元系统状态：体力恢复、广告每日次数、图鉴解锁、设置开关。
 *
 * ⚠️ 只存在内存里 —— 「以一次交换事务为单位落盘 + 防抖 + 异常回滚」是 **M6** 的活
 * （策划案 §16）。这里先把 M5 的**规则与界面**跑通，刷新页面即重置。
 * 状态被收进一个可变对象，就是为了 M6 直接把它整体序列化，不用逐处改。
 */

import {
  LEVEL_REWARD_CONFIG,
  REWARD_LEVELS,
  STAMINA_MAX,
  levelStatus,
  type ProgressData,
  type Stamina,
} from '../核心/index';

/** 秒 → mm:ss（原在 web/ui/dom.ts，纯函数，随模块搬过来） */
export function fmtMMSS(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** 加体力广告每日上限（§13.3：所有加体力入口共用 5 次） */
export const AD_STAMINA_DAILY_MAX = 5;

/** 体力恢复间隔：每 20 分钟 1 颗（§13.1） */
export const STAMINA_RECOVER_MS = 20 * 60 * 1000;

export interface Settings {
  /** 音效开关（§11.4）—— M7 起真的接到声音上（main.ts 的 onChange → audio.setSound） */
  sound: boolean;
  /** 背景音乐开关（§11.4）—— 同上，关掉会立刻停掉 BGM 的排音 */
  bgm: boolean;
}

export interface MetaState {
  /** 体力（复用 M4 的 `Stamina`：available / pending） */
  stamina: Stamina;
  /** 下颗体力的恢复时间戳；`null` = 体力已满，不显示倒计时（§11.1） */
  nextRecoverAt: number | null;
  /** 加体力广告的「今日」日期键（YYYY-MM-DD），用于跨天重置 */
  adDay: string;
  /** 今日已用完的加体力广告次数 */
  adStaminaUsed: number;
  settings: Settings;
  /** 新手引导是否已走完（§14 五步） */
  guideDone: boolean;
}

function dayKey(now: number): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 新用户送 5 颗（§13.1「首次赠送」） */
export function createMeta(now: number): MetaState {
  return {
    stamina: { available: STAMINA_MAX, pending: 0 },
    nextRecoverAt: null,
    adDay: dayKey(now),
    adStaminaUsed: 0,
    settings: { sound: true, bgm: true },
    guideDone: false,
  };
}

/** 跨天 → 加体力广告次数归零（§13.3「每日 5 次」） */
export function rollOverDay(state: MetaState, now: number): boolean {
  const key = dayKey(now);
  if (state.adDay === key) return false;
  state.adDay = key;
  state.adStaminaUsed = 0;
  return true;
}

/**
 * 时间推进：跨天重置 + 体力按 20 分钟 1 颗恢复（§13.1）。
 *
 * 用**时间戳**而不是「每秒累加」—— 切后台/息屏时定时器会停，累加会凭空少恢复。
 * 返回是否发生变化，调用方据此决定要不要重绘。
 */
export function tickMeta(state: MetaState, now: number): boolean {
  let changed = rollOverDay(state, now);

  if (state.stamina.available < STAMINA_MAX) {
    if (state.nextRecoverAt === null) state.nextRecoverAt = now + STAMINA_RECOVER_MS;
    while (state.stamina.available < STAMINA_MAX && now >= state.nextRecoverAt) {
      state.stamina = { available: state.stamina.available + 1, pending: state.stamina.pending };
      state.nextRecoverAt += STAMINA_RECOVER_MS;
      changed = true;
    }
  }
  // 满格 → 不再显示倒计时，计时器也停掉（否则下次消耗前的时间会被白算）
  if (state.stamina.available >= STAMINA_MAX && state.nextRecoverAt !== null) {
    state.nextRecoverAt = null;
    changed = true;
  }
  return changed;
}

/** 消耗体力后调用：把恢复计时器点起来（如果还没点） */
export function armRecovery(state: MetaState, now: number): void {
  if (state.stamina.available < STAMINA_MAX && state.nextRecoverAt === null) {
    state.nextRecoverAt = now + STAMINA_RECOVER_MS;
  }
}

/** 加体力（广告 / 开发工具）；满格时返回 false，调用方给「体力已满」 */
export function addStamina(state: MetaState, now: number, count = 1): boolean {
  if (state.stamina.available >= STAMINA_MAX) return false;
  state.stamina = {
    available: Math.min(STAMINA_MAX, state.stamina.available + count),
    pending: state.stamina.pending,
  };
  armRecovery(state, now);
  tickMeta(state, now);
  return true;
}

/** 「下颗体力 MM:SS」；体力已满返回 null（§11.1：满格不显示倒计时） */
export function staminaCountdown(state: MetaState, now: number): string | null {
  if (state.stamina.available >= STAMINA_MAX) return null;
  if (state.nextRecoverAt === null) return fmtMMSS(STAMINA_RECOVER_MS / 1000);
  return fmtMMSS(Math.max(0, state.nextRecoverAt - now) / 1000);
}

/** 今日还剩几次加体力广告 */
export function adStaminaLeft(state: MetaState, now: number): number {
  rollOverDay(state, now);
  return Math.max(0, AD_STAMINA_DAILY_MAX - state.adStaminaUsed);
}

/** 记一次加体力广告（看完才算，§13.3） */
export function recordAdStamina(state: MetaState): void {
  state.adStaminaUsed += 1;
}

/* ---------------------------------------------------------------- 图鉴（§10） */

/** 图鉴总数 = 36（图 ID 0~35） */
export const COLLECTION_TOTAL = REWARD_LEVELS;

/** 第 N 关的图鉴奖励图 ID；第 37~60 关无奖励（§10.2） */
export function rewardImageOfLevel(level: number): number | undefined {
  return LEVEL_REWARD_CONFIG[level];
}

/**
 * 已解锁的图 ID。
 *
 * 解锁条件 =「该关已通关」（§10.3：首次通关即解锁；重复通关不重复发放）。
 * 用进度**派生**而不是单独存一张「已解锁表」—— 两者一旦分叉就会出现
 * 「进度说通关了、图鉴说没解锁」这种无法自证的状态。
 */
export function unlockedImageIds(progress: ProgressData): number[] {
  const ids: number[] = [];
  for (let level = 1; level <= REWARD_LEVELS; level++) {
    if (levelStatus(progress, level) !== 'cleared') continue;
    const id = rewardImageOfLevel(level);
    if (id !== undefined) ids.push(id);
  }
  return ids.sort((a, b) => a - b);
}
