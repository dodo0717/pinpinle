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
  createRetention,
  type ProgressData,
  type Stamina,
  type RetentionState,
} from '../核心/index';

/** 秒 → mm:ss（原在 web/ui/dom.ts，纯函数，随模块搬过来） */
export function fmtMMSS(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** 加体力广告每日上限（§13.3：所有加体力入口共用 5 次） */
export const AD_STAMINA_DAILY_MAX = 5;

/**
 * 续命广告每日上限（2026-10-26 评审 P0-2）：与加体力**分开计数** ——
 * 原来两者共用 5 次，续命几次之后就加不了体力了。
 */
export const AD_REVIVE_DAILY_MAX = 10;

/**
 * 体力恢复间隔：每 15 分钟 1 颗（2026-10-27 评审 P1-5，原 §13.1 为 20 分钟）。
 * 0 → 回满 10 颗约 2.5 小时，适合「中午 + 晚上」两次回访。
 */
export const STAMINA_RECOVER_MS = 15 * 60 * 1000;

/** 看一次广告加几颗体力（评审 P1-5：原来 +1，一次广告只值一局，改 +2） */
export const AD_STAMINA_GAIN = 2;

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
  /** 今日已用的续命广告次数（与加体力分开计，同一个 adDay 跨天归零） */
  adReviveUsed: number;
  settings: Settings;
  /** 新手引导是否已走完（§14 五步） */
  guideDone: boolean;
  /** 回访系统（签到 / 每日挑战 / 回流 / 续命券，核心/retention.ts） */
  retention: RetentionState;
  /**
   * 当前体力上限（运行时字段，不落盘）：STAMINA_MAX + 章节宝箱加成（核心/rewards.ts）。
   * 由 GS 在读档 / 结算后按进度重算；缺省按 STAMINA_MAX。
   */
  staminaMax?: number;
}

/** 本状态的体力上限 */
export function staminaMaxOf(state: MetaState): number {
  return state.staminaMax ?? STAMINA_MAX;
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
    adReviveUsed: 0,
    settings: { sound: true, bgm: true },
    guideDone: false,
    retention: createRetention(),
  };
}

/** 跨天 → 加体力 / 续命广告次数都归零（§13.3「每日 5 次」） */
export function rollOverDay(state: MetaState, now: number): boolean {
  const key = dayKey(now);
  if (state.adDay === key) return false;
  state.adDay = key;
  state.adStaminaUsed = 0;
  state.adReviveUsed = 0;
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
  const max = staminaMaxOf(state);

  if (state.stamina.available < max) {
    if (state.nextRecoverAt === null) state.nextRecoverAt = now + STAMINA_RECOVER_MS;
    while (state.stamina.available < max && now >= state.nextRecoverAt) {
      state.stamina = { available: state.stamina.available + 1, pending: state.stamina.pending };
      state.nextRecoverAt += STAMINA_RECOVER_MS;
      changed = true;
    }
  }
  // 满格 → 不再显示倒计时，计时器也停掉（否则下次消耗前的时间会被白算）
  if (state.stamina.available >= max && state.nextRecoverAt !== null) {
    state.nextRecoverAt = null;
    changed = true;
  }
  return changed;
}

/** 消耗体力后调用：把恢复计时器点起来（如果还没点） */
export function armRecovery(state: MetaState, now: number): void {
  if (state.stamina.available < staminaMaxOf(state) && state.nextRecoverAt === null) {
    state.nextRecoverAt = now + STAMINA_RECOVER_MS;
  }
}

/** 加体力（广告 / 开发工具）；满格时返回 false，调用方给「体力已满」 */
export function addStamina(state: MetaState, now: number, count = 1): boolean {
  const max = staminaMaxOf(state);
  if (state.stamina.available >= max) return false;
  state.stamina = {
    available: Math.min(max, state.stamina.available + count),
    pending: state.stamina.pending,
  };
  armRecovery(state, now);
  tickMeta(state, now);
  return true;
}

/** 「下颗体力 MM:SS」；体力已满返回 null（§11.1：满格不显示倒计时） */
export function staminaCountdown(state: MetaState, now: number): string | null {
  if (state.stamina.available >= staminaMaxOf(state)) return null;
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

/** 今日还剩几次续命广告 */
export function adReviveLeft(state: MetaState, now: number): number {
  rollOverDay(state, now);
  return Math.max(0, AD_REVIVE_DAILY_MAX - state.adReviveUsed);
}

/** 记一次续命广告（看完才算） */
export function recordAdRevive(state: MetaState): void {
  state.adReviveUsed += 1;
}

/* ---------------------------------------------------------------- 图鉴（§10） */

/** 图鉴总数 = 36（图 ID 0~35） */
export const COLLECTION_TOTAL = REWARD_LEVELS;

/**
 * 第 N 关的图鉴奖励图 ID（§10.2 旧口径，仅老界面 / 测试还在读）。
 * ⚠️ 图鉴实际按「每 10 颗星一张」解锁（见 unlockedImageIds）；后段奖励是金卡 + 章节宝箱（核心/rewards.ts）。
 */
export function rewardImageOfLevel(level: number): number | undefined {
  return LEVEL_REWARD_CONFIG[level];
}

/**
 * 解锁一张图所需的星数（§10.3 新规则，2026-10-22 改）：**每获得 10 颗星解锁一张**，
 * 按图号顺序解锁前 N 张。36 张 × 10 = 360 星 = 60 关 × 2 套模式 × 3 星。
 */
export const STARS_PER_IMAGE = 10;

/** 一份进度里已获得的星数（各关星级之和；没打过的关卡记 0） */
export function totalStars(progress: ProgressData): number {
  let sum = 0;
  for (const key of Object.keys(progress.levels)) {
    const rec = progress.levels[Number(key)];
    if (rec) sum += Number(rec.stars) || 0;
  }
  return sum;
}

/**
 * 已解锁的图 ID。
 *
 * 解锁条件 = **每 10 颗星一张**（§10.3 新规则），按图号从小到大解锁前 N 张。
 * 用进度**派生**而不是单独存一张「已解锁表」—— 两者一旦分叉就会出现
 * 「进度说有 N 星、图鉴说没解锁」这种无法自证的状态。
 * 参数可传一份进度，也可把两套模式（简单 / 困难）一起传进来合并计星。
 */
export function unlockedImageIds(...progresses: ProgressData[]): number[] {
  const stars = progresses.reduce((sum, p) => sum + totalStars(p), 0);
  const count = Math.min(COLLECTION_TOTAL, Math.floor(stars / STARS_PER_IMAGE));
  return Array.from({ length: count }, (_, i) => i);
}
