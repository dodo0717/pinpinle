/**
 * 埋点（M9）。
 *
 * 采集规范（产品给的方向，逐条落到实现里）：
 *
 *   1. **客户端聚合 + 批量上报** —— 结算弹窗的「曝光 + 玩家点了哪个按钮」合并成
 *      *一条*记录（`HonorRecord`），而不是曝光发一次、每个按钮再各发一次。
 *   2. **异步上报、不阻塞主流程** —— 发出去就不管；失败只写本地缓存，
 *      不 await、不弹错、不影响任何一帧。整局游戏不会因为埋点卡一下。
 *   3. **采样** —— 按「装机」维度稳定分桶（存本地，永不重复摇号），
 *      默认全量，线上把 `ANALYTICS_SAMPLE_RATE` 改成 0.1 就是 10% 玩家。
 *      按装机采样而不是按事件采样，否则同一个人的曝光/点击会各丢一半，数据对不上。
 *   4. **只传必要字段** —— 关卡 ID / 档位 / 得分 / 名次 / 百分比 / 星级 / 动作 / 停留时长。
 *      没有昵称、没有存档、没有任何能定位到人的东西。
 *   5. **限流 + 降级 + 本地缓存** —— 两次上报之间有最小间隔；服务不可用（或开发期
 *      没有 endpoint）就降级成「只写本地环形缓冲」，下次启动接着补传。
 *
 * 开发期没有埋点服务，`ANALYTICS_ENDPOINT` 留空：不发网络，只把「本该发出去的那条」
 * 写进 localStorage，方便在 DevTools 里验收聚合结果长什么样。
 */

import type { HonorTier } from '../../assets/scripts/core/index.ts';

/** 玩家在荣誉弹窗里点了哪个按钮 */
export type HonorAction = 'leaderboard' | 'next' | 'retry' | 'home' | 'close';

/** 聚合后的一条荣誉记录（曝光与点击合并） */
export interface HonorRecord {
  e: 'honor';
  /** 关卡 ID */
  lv: number;
  tier: HonorTier;
  /** 本关得分 */
  score: number;
  /** 名次 */
  rank: number;
  /** 超越百分比（保留 1 位小数） */
  pct: number;
  /** 星级 */
  st: number;
  /** 玩家最后点了哪个按钮 */
  act: HonorAction;
  /** 从弹窗出现到点击的停留毫秒数 */
  ms: number;
}

/** 埋点服务地址。开发期留空 = 不发网络，只写本地缓存。 */
export const ANALYTICS_ENDPOINT = '';

/** 采样率（0~1）。线上建议 0.1（10%），默认全量方便开发期验收。 */
export const ANALYTICS_SAMPLE_RATE = 1;

const CACHE_KEY = 'mc_analytics_v1';
const BUCKET_KEY = 'mc_analytics_bucket';
/** 本地环形缓冲上限：服务长时间不可用时不许把 localStorage 撑爆 */
const MAX_CACHED = 200;
/** 单次批量上报的最大条数 */
const MAX_BATCH = 20;
/** 限流：两次上报之间的最小间隔 */
const MIN_INTERVAL_MS = 10_000;

/* ------------------------------------------------------------------ 存储（全部容错） */

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null; // 隐私模式 / 禁用存储
  }
}

function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // 写不进去就算了 —— 埋点不值得为它打扰玩家一次
  }
}

/**
 * 装机维度的采样分桶（0~99，首次随机后固定）。
 *
 * 为什么不用 `Math.random() < rate` 逐条判断：那样同一个玩家的曝光和点击
 * 有一半概率各丢一半，聚合记录会变成「有曝光没点击」的脏数据。
 */
function samplingBucket(): number {
  const raw = readStorage(BUCKET_KEY);
  const parsed = raw === null ? Number.NaN : Number.parseInt(raw, 10);
  if (Number.isInteger(parsed) && parsed >= 0 && parsed < 100) return parsed;
  const bucket = Math.floor(Math.random() * 100);
  writeStorage(BUCKET_KEY, String(bucket));
  return bucket;
}

function readCache(): HonorRecord[] {
  const raw = readStorage(CACHE_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as HonorRecord[]) : [];
  } catch {
    return []; // 缓存被改坏了，直接丢掉重来
  }
}

function writeCache(list: readonly HonorRecord[]): void {
  writeStorage(CACHE_KEY, JSON.stringify(list.slice(-MAX_CACHED)));
}

/* ------------------------------------------------------------------ 对外接口 */

export interface HonorExposure {
  level: number;
  tier: HonorTier;
  score: number;
  rank: number;
  percentile: number;
  stars: number;
}

export interface Analytics {
  /** 荣誉弹窗曝光：只开一条「待合并」记录，先不发 */
  honorShown(input: HonorExposure): void;
  /** 弹窗内点击按钮：把动作合并进刚才那条记录，然后进队列 */
  honorAction(action: HonorAction): void;
  /** 弹窗被直接关掉（没点任何按钮）时的兜底提交 */
  honorClosed(): void;
  /** 立刻尝试上报（切后台 / 退出时调用；失败会留在本地缓存） */
  flush(): void;
  /** 自检用：队列里还有几条、这台机器有没有被采样中 */
  stats(): { pending: number; sampled: boolean };
}

export function createAnalytics(): Analytics {
  const sampled = samplingBucket() < Math.round(ANALYTICS_SAMPLE_RATE * 100);
  let pending: HonorRecord | null = null;
  let shownAt = 0;
  let lastSend = 0;

  function nowMs(): number {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
  }

  function flush(): void {
    // 降级：没有服务地址 → 什么都不发，记录静静留在本地缓存里等下次
    if (!ANALYTICS_ENDPOINT || typeof navigator === 'undefined') return;
    const stamp = Date.now();
    if (stamp - lastSend < MIN_INTERVAL_MS) return; // 限流

    const list = readCache();
    if (list.length === 0) return;
    const batch = list.slice(0, MAX_BATCH);
    const body = JSON.stringify({ v: 1, events: batch });
    lastSend = stamp;

    let delivered = false;
    try {
      if (typeof navigator.sendBeacon === 'function') {
        // sendBeacon 天然「发出去就不管」，页面正在关闭时也不会被掐断
        delivered = navigator.sendBeacon(ANALYTICS_ENDPOINT, new Blob([body], { type: 'application/json' }));
      } else {
        void fetch(ANALYTICS_ENDPOINT, {
          method: 'POST',
          body,
          keepalive: true,
          headers: { 'content-type': 'application/json' },
        }).catch(() => undefined);
        delivered = true;
      }
    } catch {
      delivered = false;
    }

    // 只有「确实交出去了」才从缓存里删；交不出去就留着补传
    if (delivered) writeCache(list.slice(batch.length));
  }

  function commit(action: HonorAction): void {
    if (!pending) return;
    const record: HonorRecord = { ...pending, act: action, ms: Math.round(nowMs() - shownAt) };
    pending = null;
    if (!sampled) return; // 没被采样到：整条丢掉（连本地缓存都不写）
    const list = readCache();
    list.push(record);
    writeCache(list);
    flush();
  }

  // 切后台 / 关闭页面时把缓存里攒的补发一次（没发出去也无所谓，下次启动继续）
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('pagehide', () => flush());
    window.addEventListener('visibilitychange', () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') flush();
    });
  }

  return {
    honorShown(input: HonorExposure): void {
      shownAt = nowMs();
      pending = {
        e: 'honor',
        lv: input.level,
        tier: input.tier,
        score: input.score,
        rank: input.rank,
        pct: Number(input.percentile.toFixed(1)),
        st: input.stars,
        act: 'close',
        ms: 0,
      };
    },
    honorAction(action: HonorAction): void {
      commit(action);
    },
    honorClosed(): void {
      commit('close');
    },
    flush,
    stats(): { pending: number; sampled: boolean } {
      return { pending: readCache().length, sampled };
    },
  };
}
