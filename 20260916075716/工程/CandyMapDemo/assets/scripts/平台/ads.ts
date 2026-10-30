/**
 * 广告 —— 平台适配层（批次⑧）。
 *
 * 对应原版 `web/ui/ads.ts`。原版只有两个点位（`AdKind = 'stamina' | 'revive'`），
 * 而打法一律是「三种结果之一」（`watched` / `skipped` / `failed`），动机写在那边文件头：
 * 「看了沒看完 / 加载失败」三条分支必须能走过一遍，否则规则没法验收。这里照抄这个口径，
 * **一个字都不改**：调用方只看 `result === 'watched'` 才发奖励。
 *
 * ── 三分支（硬要求）──────────────────────────────────────────────
 *   1. **小游戏激励视频**：宿主能建激励视频 → 真广告，`onClose(res.isEnded)` 判定看完与否；
 *   2. **Web / 浏览器**：没有广告 SDK → 走 `resolver`（默认直接 `watched`），让分支照样能跑完；
 *   3. **无广告降级**：既没有 SDK、也不允许模拟 → `available() === false`，
 *      `play()` 一律返回 `failed`，**由调用方给提示**（文案在 `玩法/text.ts` 的 `ADS.notReady`）。
 *
 * ── 次数与冷却 ──────────────────────────────────────────────────
 * 常量全部照抄原版：
 *   - `AD_STAMINA_DAILY_MAX = 5`：加体力广告 5 次/日，**所有加体力入口共用同一份额度**（§13.3）；
 *   - 续命广告：**不受每日 5 次限制**（§13.4 明写），它的限制是「每局 1 次」，那是玩法层的账；
 *   - `MAX_CONSECUTIVE_FAILS = 3`：连续 3 次加载失败就把它「停一会儿」（§13.4）；
 *   - **冷却**：原版没有「看完一次要等多久」这条规则，所以默认 `0`（不限）。
 *     机制留在这就是为了以后要加不用改结构 —— 现在不允许凭空发明一个秒数。
 *
 * ── 计数放哪 ────────────────────────────────────────────────────
 * 本模块**不碰存储**：额度和冷却都活在内存里，通过 `exportUsage() / importUsage()` 交给调用方
 * （落盘点应为 `玩法/state.ts` 的 GS / `核心/save.ts`）。理由同 `玩法/storage.ts`：
 * 平台层只管平台的事，持久化由数据层负责，否则同一份计数会有两个真相。
 */

import { clampNonNegative, crossedDay, dayStamp, pickHostApi } from './host';

/** 广告点位（第三个是预留，见 `AD_OFFLINE_DAILY_MAX` 的说明） */
export type AdPlacement = 'revive' | 'stamina' | 'offline';

/** 广告介质 */
export type AdPort = 'wx' | 'web' | 'none';

/** 与 `web/ui/ads.ts` 的 `AdResult` 逐字一致 —— 只有 `watched` 才给奖励 */
export type AdResult = 'watched' | 'skipped' | 'failed';

/** 被拦下来的原因（界面据此选择文案） */
export type AdDenyReason =
  | 'unavailable' // 本环境没有广告能力
  | 'disabled' // 该点位当前关闭（如「离线收益翻倍」未开样板号）
  | 'noUnit' // 有 SDK 但没填广告位 id
  | 'dailyLimit' // 今日额度用完
  | 'cooldown' // 冷却中
  | 'busy' // 上一条还没播完
  | 'failedTooMuch'; // 连续失败到上限

export interface AdOutcome {
  /** `'watched'` 才发奖励；`skipped`（没看完）与 `failed`（加载失败）都不发 */
  result: AdResult;
  port: AdPort;
  /** 只有 result === 'failed' 且有被拦原因时才有值 */
  reason?: AdDenyReason;
}

export interface AdUsageItem {
  /** 今日已看**完**几次（没看完 / 失败都不计数，§13.3） */
  used: number;
  /** 今日还剩几次；`Infinity` 表示不限（续命、离线收益） */
  left: number;
  /** 还要等多久（毫秒）才能再看；0 = 立刻能看 */
  cooldownLeftMs: number;
  /** 连续加载失败次数；看完一次归零 */
  fails: number;
}

export interface AdCanPlay {
  ok: boolean;
  reason?: AdDenyReason;
  /** `cooldown` 时给出还要等多久（毫秒），方便界面显示倒计时 */
  retryInMs?: number;
}

/** 计数快照（给存档用：形状稳定，改结构就要同步改 SAVE_VERSION） */
export interface AdUsageSnapshot {
  day: string;
  used: Partial<Record<AdPlacement, number>>;
  lastAt: Partial<Record<AdPlacement, number>>;
  fails: Partial<Record<AdPlacement, number>>;
}

export interface AdHooks {
  /** 轻提示（调用方接 `玩法/toast.ts`）—— 被拦下来时可以顺便说一句 */
  toast?(msg: string): void;
  /** 被拦下来时的钩子，便于埋点 / 自检 */
  onDenied?(placement: AdPlacement, reason: AdDenyReason): void;
}

export interface AdsConfig {
  port?: AdPort | 'auto';
  /** ⚠️ **待填写**：各点位的广告位 id（不传就用 `AD_UNIT_IDS`，现在全是空串） */
  unitIds?: Partial<Record<AdPlacement, string>>;
  /** 每个点位是否开放；默认 `AD_DEFAULT_ENABLED` */
  enabled?: Partial<Record<AdPlacement, boolean>>;
  /** 每点位每日上限；默认 `AD_DEFAULT_DAILY_MAX` */
  dailyMax?: Partial<Record<AdPlacement, number>>;
  /** 每点位冷却毫秒；默认 `AD_DEFAULT_COOLDOWN_MS`（全 0 = 不限） */
  cooldownMs?: Partial<Record<AdPlacement, number>>;
  /** 是否允许「Web 分支」直接给成功；默认 true（开发期跑得通分支最重要） */
  allowSimulate?: boolean;
  /** Web 分支的结果裁定器（不传默认 `watched`） */
  resolver?: (placement: AdPlacement) => AdResult | Promise<AdResult>;
  now?: () => number;
  hooks?: AdHooks;
}

export interface AdRunner {
  kind(): AdPort;
  /** 是否真的能播（界面据此决定按钮置灰与否） */
  available(placement?: AdPlacement): boolean;
  /** 能不能播这一条：把「为什么不行」讲清楚 */
  canPlay(placement: AdPlacement, now?: number): AdCanPlay;
  /** 播一条；内部已按 canPlay 拦一遍，被拦时返回 result='failed' + reason */
  play(placement: AdPlacement, now?: number): Promise<AdOutcome>;
  usage(placement: AdPlacement, now?: number): AdUsageItem;
  exportUsage(): AdUsageSnapshot;
  importUsage(snapshot: AdUsageSnapshot | null): void;
  /** 连续失败计数清零（换一局 / 换一天时调用方负责） */
  resetFails(placement?: AdPlacement): void;
}

/* ------------------------------------------------------------------ 常量（全部照抄原版，不要自行发明） */

/** §13.3：加体力广告 5 次/日，所有入口共用一份额度（同 `玩法/meta.ts` 的 `AD_STAMINA_DAILY_MAX`） */
export const AD_STAMINA_DAILY_MAX = 5;

/** §13.4：续命广告**不受**每日 5 次限制（每局 1 次的限制在玩法层，不在这里） */
export const AD_REVIVE_DAILY_MAX = Number.POSITIVE_INFINITY;

/**
 * 「离线收益翻倍」：⚠️ **原版没有这个点位**（翻遍 `web/` 只有加体力 / 续命两种），
 * 任务单里提到的它属于另一条尚未开的需求线。所以默认**关闭**（`enabled: false`）：
 * 要上线得先把「离线产出怎么算、翻倍发到哪」这两件事定下来，再把它打开 —— 现在留着只是电位预留。
 */
export const AD_OFFLINE_DAILY_MAX = Number.POSITIVE_INFINITY;

export const AD_DEFAULT_DAILY_MAX: Record<AdPlacement, number> = {
  stamina: AD_STAMINA_DAILY_MAX,
  revive: AD_REVIVE_DAILY_MAX,
  offline: AD_OFFLINE_DAILY_MAX,
};

/** §13.4：连续 3 次加载失败就不再打扰玩家（原版是「回续命弹窗」，这里落成 deny reason） */
export const MAX_CONSECUTIVE_FAILS = 3;

/** 原版没有「看完要冷却」这条规则 → 默认全 0（不限）。机制留着，数值等策划给 */
export const AD_DEFAULT_COOLDOWN_MS: Record<AdPlacement, number> = {
  stamina: 0,
  revive: 0,
  offline: 0,
};

export const AD_DEFAULT_ENABLED: Record<AdPlacement, boolean> = {
  stamina: true,
  revive: true,
  offline: false,
};

/** ⚠️ **待填写**：微信广告位 id（`adUnitId`）。留空就意味着跑不了真广告，只能降级到模拟分支 */
export const AD_UNIT_IDS: Record<AdPlacement, string> = {
  revive: '',
  stamina: '',
  offline: '',
};

/** §13.3：一次加体力广告只加 1 颗（体力上限见 `核心/progress.ts` 的 `STAMINA_MAX`） */
export const STAMINA_PER_AD = 1;

/* ------------------------------------------------------------------ 宿主形状 */

interface HostRewardedAd {
  load?: () => Promise<unknown>;
  show?: () => Promise<unknown>;
  onClose?: (cb: (res: { isEnded?: boolean }) => void) => void;
  offClose?: (cb: (res: { isEnded?: boolean }) => void) => void;
  onError?: (cb: (err: unknown) => void) => void;
  offError?: (cb: (err: unknown) => void) => void;
  destroy?: () => void;
}

interface HostAdApi {
  createRewardedVideoAd?: (o: { adUnitId: string }) => HostRewardedAd;
}

function hostAdApi(): HostAdApi | null {
  const api = pickHostApi<HostAdApi>('wx');
  if (!api || typeof api.createRewardedVideoAd !== 'function') return null;
  return api;
}

/* ------------------------------------------------------------------ 工厂 */

const PLACEMENTS: AdPlacement[] = ['stamina', 'revive', 'offline'];

export function createAds(config: AdsConfig = {}): AdRunner {
  const nowFn = config.now ?? ((): number => Date.now());
  const hooks = config.hooks ?? {};
  const dailyMax = { ...AD_DEFAULT_DAILY_MAX, ...(config.dailyMax ?? {}) };
  const cooldownMs = { ...AD_DEFAULT_COOLDOWN_MS, ...(config.cooldownMs ?? {}) };
  const enabled = { ...AD_DEFAULT_ENABLED, ...(config.enabled ?? {}) };
  const unitIds = { ...AD_UNIT_IDS, ...(config.unitIds ?? {}) };

  /** 每个点位有自己的计数（加体力「所有入口共用」= 大家都是同一个点位 `stamina`，天然共用） */
  const used: Record<AdPlacement, number> = { stamina: 0, revive: 0, offline: 0 };
  const lastAt: Record<AdPlacement, number> = { stamina: 0, revive: 0, offline: 0 };
  const fails: Record<AdPlacement, number> = { stamina: 0, revive: 0, offline: 0 };
  const instances = new Map<AdPlacement, HostRewardedAd>();
  let day = dayStamp(nowFn());
  let busy = false;

  /** 跨天重置：每一次查询前先滚一天 —— 免得「凌晨 0 点没归零」这种漏账在生产上才被发现 */
  function rollDay(now: number): void {
    const key = dayStamp(now);
    if (key === day) return;
    day = key;
    for (const p of PLACEMENTS) {
      used[p] = 0;
      lastAt[p] = 0;
      fails[p] = 0;
    }
  }

  function resolvePort(): AdPort {
    const want = config.port ?? 'auto';
    if (want !== 'auto') return want;
    if (hostAdApi()) return 'wx';
    if (config.allowSimulate !== false) return 'web';
    return 'none';
  }

  const port = resolvePort();

  function deny(placement: AdPlacement, reason: AdDenyReason, retryInMs?: number): AdCanPlay {
    hooks.onDenied?.(placement, reason);
    return { ok: false, reason, retryInMs };
  }

  /* -------------------------------------------------- 额度判定（纯算术，可单测） */

  function canPlay(placement: AdPlacement, now: number): AdCanPlay {
    rollDay(now);
    if (!enabled[placement]) return deny(placement, 'disabled');
    if (busy) return deny(placement, 'busy');
    if (fails[placement] >= MAX_CONSECUTIVE_FAILS) return deny(placement, 'failedTooMuch');
    if (used[placement] >= dailyMax[placement]) return deny(placement, 'dailyLimit');

    const gap = cooldownMs[placement];
    if (gap > 0) {
      const since = now - lastAt[placement];
      if (lastAt[placement] > 0 && since < gap) return deny(placement, 'cooldown', gap - since);
    }
    return { ok: true };
  }

  function usage(placement: AdPlacement, now: number): AdUsageItem {
    rollDay(now);
    const gap = cooldownMs[placement];
    const cd = gap > 0 ? clampNonNegative(lastAt[placement] + gap - now) : 0;
    return {
      used: used[placement],
      left: Math.max(0, dailyMax[placement] - used[placement]),
      cooldownLeftMs: lastAt[placement] > 0 ? cd : 0,
      fails: fails[placement],
    };
  }

  /* -------------------------------------------------- 播放 */

  /** Web / 模拟分支：把「这局该是什么结果」交给裁定器，默认看完 */
  async function simulate(placement: AdPlacement): Promise<AdResult> {
    const resolver = config.resolver;
    if (!resolver) return 'watched';
    return await resolver(placement);
  }

  /** 小游戏分支：拉真广告；任何一个环节炸了都归到 `failed` */
  function playHost(placement: AdPlacement): Promise<AdResult> {
    const api = hostAdApi();
    if (!api) return Promise.resolve('failed');
    return new Promise<AdResult>((resolve) => {
      let settled = false;
      const ad = instances.get(placement) ?? api.createRewardedVideoAd?.({ adUnitId: unitIds[placement] });
      if (!ad) {
        resolve('failed');
        return;
      }
      instances.set(placement, ad);

      let closeCb: ((res: { isEnded?: boolean }) => void) | null = null;
      let errorCb: ((err: unknown) => void) | null = null;

      const unbind = (): void => {
        try {
          if (closeCb) ad.offClose?.(closeCb);
          if (errorCb) ad.offError?.(errorCb);
        } catch {
          /* 解绑失败不影响已经拿到的结果 */
        }
      };
      const settle = (r: AdResult): void => {
        if (settled) return;
        settled = true;
        unbind();
        resolve(r);
      };

      try {
        // 官方语义：`isEnded === true` 才是「完整看完」，中途退出是 false —— 一律不给奖励
        closeCb = (res: { isEnded?: boolean }): void => {
          settle(res && res.isEnded === true ? 'watched' : 'skipped');
        };
        errorCb = (): void => settle('failed');
        ad.onClose?.(closeCb);
        ad.onError?.(errorCb);

        const shown: unknown = ad.show?.();
        if (shown && typeof (shown as Promise<unknown>).then === 'function') {
          // 新版 SDK 的 show() 返回 Promise：未加载好 / 频次过限会 reject，同样算 failed
          void (shown as Promise<unknown>).catch(() => settle('failed'));
        }
      } catch {
        settle('failed');
      }
    });
  }

  return {
    kind(): AdPort {
      return port;
    },

    available(placement: AdPlacement = 'stamina'): boolean {
      if (!enabled[placement]) return false;
      if (port === 'none') return false;
      // 有了 SDK 但没填广告位 id = 建不出实例 = 真 unavailable（不要让按钮亮了又点不动）
      if (port === 'wx' && !unitIds[placement]) return false;
      return true;
    },

    canPlay(placement: AdPlacement, now: number = nowFn()): AdCanPlay {
      const gate = canPlay(placement, now);
      if (gate.ok && !this.available(placement)) {
        const reason: AdDenyReason = port === 'wx' ? 'noUnit' : 'unavailable';
        return deny(placement, reason);
      }
      return gate;
    },

    async play(placement: AdPlacement, now: number = nowFn()): Promise<AdOutcome> {
      const gate = this.canPlay(placement, now);
      if (!gate.ok) {
        return { result: 'failed', port, reason: gate.reason };
      }
      busy = true;
      let result: AdResult;
      try {
        result = port === 'wx' ? await playHost(placement) : await simulate(placement);
      } catch {
        result = 'failed';
      } finally {
        busy = false;
      }
      rollDay(nowFn());
      if (result === 'watched') {
        used[placement] += 1;
        lastAt[placement] = nowFn();
        fails[placement] = 0;
      } else if (result === 'failed') {
        fails[placement] += 1;
      }
      return result === 'watched' ? { result, port } : { result, port, reason: undefined };
    },

    usage(placement: AdPlacement, now: number = nowFn()): AdUsageItem {
      return usage(placement, now);
    },

    exportUsage(): AdUsageSnapshot {
      const pick = (src: Record<AdPlacement, number>): Partial<Record<AdPlacement, number>> => {
        const out: Partial<Record<AdPlacement, number>> = {};
        for (const p of PLACEMENTS) if (src[p] > 0) out[p] = src[p];
        return out;
      };
      return { day, used: pick(used), lastAt: pick(lastAt), fails: pick(fails) };
    },

    importUsage(snapshot: AdUsageSnapshot | null): void {
      for (const p of PLACEMENTS) {
        used[p] = 0;
        lastAt[p] = 0;
        fails[p] = 0;
      }
      if (!snapshot) return;
      day = snapshot.day || dayStamp(nowFn());
      for (const p of PLACEMENTS) {
        used[p] = clampNonNegative(Number(snapshot.used?.[p] ?? 0));
        lastAt[p] = clampNonNegative(Number(snapshot.lastAt?.[p] ?? 0));
        fails[p] = clampNonNegative(Number(snapshot.fails?.[p] ?? 0));
      }
    },

    resetFails(placement?: AdPlacement): void {
      const list = placement ? [placement] : PLACEMENTS;
      for (const p of list) fails[p] = 0;
    },
  };
}

let cached: AdRunner | null = null;

/** 进程内默认实例（懒建一次） */
export function ads(): AdRunner {
  if (!cached) cached = createAds();
  return cached;
}

/** 测试 / 换宿主时清掉默认实例 */
export function resetAdsProbe(): void {
  cached = null;
}

/**
 * 上次计费到现在是否跨天（给「几天没来」类的判断用）。
 * 放在这里是想让调用方不必自己再去 weekday/monthday 上比长短 —— 跨天的口径只有一个。
 */
export function isSameDay(a: number, b: number): boolean {
  return !crossedDay(a, b);
}
