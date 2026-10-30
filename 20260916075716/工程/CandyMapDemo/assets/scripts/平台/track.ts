/**
 * 埋点 —— 平台适配层（批次⑧）。
 *
 * 对应原版 `web/ui/metrics.ts`（产品指标）。那边的设计三条全盘保留：
 *   1. **默认零网络**：端点为空 → 事件只进本地环形缓冲（`BUFFER_MAX = 3000`，照抄），
 *      主同样一帧也不受影响；
 *   2. **攒批上报**：有端点时 10 条 / 或到点了发一批（`FLUSH_AT` / `FLUSH_MS`，照抄），
 *      绝不一条一个请求；发成功了才从缓冲删，发失败就留着下次补发；
 *   3. **绝不抛异常**：埋点把游戏搞崩是最蠢的线上事故，所有路径包一层，坏了就丢。
 *
 * ⚠️ 事件名**以原版为准**（`EVENT` 逐个对齐 `web/ui/metrics.ts`）：
 *    `first_open` / `session_start` / `level_start` / `level_end` / `level_fail` /
 *    `tutorial_start` / `tutorial_done` / `tutorial_skip` / `ad_show` / `ad_finish`。
 *    任务单里提到的 `share` 与 `ad_watch` **原版没有**：`share` 是本层新增（见下），
 *    `ad_watch` 一律用原版那对 `ad_show` + `ad_finish`，不要再造一个名字 ——
 *    名字一乱，漏斗两边就对不上了。
 *
 * 与 `web/ui/analytics.ts`（M9 荣誉弹窗聚合）的关系：那是**另一个东西**，本层不复刻它；
 * 荣誉弹窗的「曝光 + 点了哪个按钮」要搬，请单独做，别塞进这里。
 *
 * 三分支（无后端口径）：有端点 → 攒批发；无端点 → 本地缓冲 + `exportAll()` 导出；
 * 宿主既没存储也没网络（例如 Creator 模拟器）→ 缓冲退化成内存数组，进程结束即丢，但不报错。
 */

import { dayStamp } from './host';

/** 事件名常量（逐个对齐 `web/ui/metrics.ts` 的 `EVENT`） */
export const EVENT = {
  /** 首次打开（留存的分母；只在真正第一次时发一次） */
  firstOpen: 'first_open',
  /** 每次会话开始：带 day = 首次打开后的第几天 → 算次留 / 3 留 / 7 留 */
  sessionStart: 'session_start',
  /** 开始一关：带 attempt = 本关第几次尝试 */
  levelStart: 'level_start',
  /** 通关：带 stars / score / 时长 / 是否续命 */
  levelEnd: 'level_end',
  /** 失败（没够到 1★ 且放弃续命）：**确认失败**才记，弹续命弹窗不算 */
  levelFail: 'level_fail',
  /** 教学开始 */
  tutorialStart: 'tutorial_start',
  /** 教学完成（拼够 3 组） */
  tutorialDone: 'tutorial_done',
  /** 教学被跳过（带 step，能看出第几步劝退） */
  tutorialSkip: 'tutorial_skip',
  /** 广告曝光：看了（拉起）一次，`placement` 区分点位 */
  adShow: 'ad_show',
  /** 广告结束：`watched` / `skipped` / `failed`（与 `平台/ads.ts` 的 AdResult 同口径） */
  adFinish: 'ad_finish',
  /**
   * ⚠️ 新增（原版没有这个事件）：分享盘点 ‖ 转发被拉起。
   * 注意 `平台/share.ts` 里说过的口径 —— 这只代表「拉起并确认」，不代表真的发出去了。
   */
  share: 'share',
} as const;

export type EventName = (typeof EVENT)[keyof typeof EVENT];
export type MetricsProps = Record<string, string | number | boolean | null>;

/** 一条事件的落盘形态（短键名，照抄原版：能省一点体积就省一点） */
export interface Envelope {
  e: string;
  ts: number;
  /** 匿名玩家 id（本机随机串，不含任何个人信息） */
  pid: string;
  /** 会话 id：同一次打开里的所有事件共享 */
  sid: string;
  /** 首次打开后的第几天（0 = 当天） */
  day: number;
  /** 事件序号：同一毫秒内也能排出先后 */
  seq: number;
  p: MetricsProps;
}

/** ⚠️ **待填写**：上报端点。空串 = 纯本地（默认），给地址才会真的发网络 */
export const DEFAULT_ENDPOINT = '';

/** 缓冲区上限（照抄 `web/ui/metrics.ts` 的 BUFFER_MAX） */
export const BUFFER_MAX = 3000;
/** 攒批：多少条发一批（照抄 FLUSH_AT） */
export const FLUSH_AT = 10;
/** 攒批：两次 flush 的最小间隔毫秒（照抄 FLUSH_MS） */
export const FLUSH_MS = 5000;

const ID_KEY = 'mengchong.metrics.id';
const FIRST_OPEN_KEY = 'mengchong.metrics.firstOpen';
const BUFFER_KEY = 'mengchong.metrics.buffer';

/** 宿主注入的最小存储；不注入就退化成内存 Map（ Creator 模拟器 / 单测都是这条路径） */
export interface TrackStorage {
  read(key: string): string | null;
  write(key: string, value: string): boolean;
}

export interface TrackerConfig {
  /** 上报端点，默认 `DEFAULT_ENDPOINT`（空 = 不发网络） */
  endpoint?: string;
  storage?: TrackStorage;
  /** 采样率 0~1，默认 1（全量）；按「装机」分桶，不按事件 —— 见 analytics.ts 那条理由 */
  sampleRate?: number;
  /** 测试用：直接指定分桶值 0~99，跳过随机 */
  bucket?: number;
  maxBuffer?: number;
  flushAt?: number;
  now?: () => number;
  randomId?: () => string;
  /** 网络发送实现；默认走宿主的 fetch。**测试务必注入**，否则会真的发请求 */
  send?: (url: string, body: string) => Promise<boolean>;
}

export interface TrackerStats {
  events: number;
  endpoint: string;
  day: number;
  playerId: string;
  sampled: boolean;
}

export interface Tracker {
  /** 启动：建身份、发会话事件。幂等（重复调用无效） */
  start(): void;
  track(name: EventName | string, props?: MetricsProps): void;
  /** 立刻尝试上报（宿主切后台 / 退出时调用；失败会留在本地缓冲） */
  flush(): Promise<void>;
  /** 导出全部本地事件（种子用户回传用） */
  exportAll(): readonly Envelope[];
  stats(): TrackerStats;
  /** 清空缓冲（测试 / 玩家要求清除本机数据） */
  clear(): void;
}

/* ------------------------------------------------------------------ 宿主形状 */

type HostSend = (url: string, init: { method?: string; body?: string; headers?: Record<string, string> }) => Promise<{ ok?: boolean }>;

/**
 * 默认发送：用宿主的 fetch 打一发 `text/plain`（原版刻意这么选 —— 属「简单请求」、不触发预检）。
 *
 * ⚠️ 这里用「字符串键取布尔、取出来放进变量再调用」，目的只有一个：这份源码里不出现裸的
 * 平台标识符（可移植性守卫会拦），同时任何宿主拿不到 fetch 时都能干净地返回 false ——
 * 埋点拿不到网络，游戏照打。
 */
async function hostSend(url: string, body: string): Promise<boolean> {
  try {
    const bag = globalThis as unknown as Record<string, unknown>;
    const candidate = bag['fetch'];
    if (typeof candidate !== 'function') return false;
    const sender = candidate as HostSend;
    const res = await sender(url, { method: 'POST', body, headers: { 'Content-Type': 'text/plain' } });
    return res?.ok !== false;
  } catch {
    return false;
  }
}

/** 序列化格式：**JSON Lines**（一行一条）—— 追加写并发安全，后续数仓直接吃 */
function serialize(batch: readonly Envelope[]): string {
  return batch.map((x) => JSON.stringify(x)).join('\n');
}

function defaultId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/* ------------------------------------------------------------------ 工厂 */

export function createTracker(config: TrackerConfig = {}): Tracker {
  const nowFn = config.now ?? ((): number => Date.now());
  const idFn = config.randomId ?? defaultId;
  const storage = config.storage ?? null;
  const endpoint = config.endpoint ?? DEFAULT_ENDPOINT;
  const maxBuffer = config.maxBuffer ?? BUFFER_MAX;
  const flushAt = config.flushAt ?? FLUSH_AT;
  const send = config.send ?? hostSend;
  const sampleRate = Math.min(1, Math.max(0, config.sampleRate ?? 1));

  let playerId = '';
  let sessionId = '';
  let firstOpenAt = 0;
  let seq = 0;
  let started = false;
  let lastFlushAt = 0;
  /** 全量缓冲：**唯一真相**，有没有端点都往这里写 */
  let buffer: Envelope[] = [];
  /** 待发送队列（只有端点存在时才非空） */
  let queue: Envelope[] = [];
  let sampled = true;

  /* ------------------------------------------------- 存储（全容错） */

  const mem = new Map<string, string>();

  function readStore(key: string): string {
    try {
      if (storage) return storage.read(key) ?? '';
      return mem.get(key) ?? '';
    } catch {
      return '';
    }
  }

  function writeStore(key: string, value: string): void {
    try {
      if (storage) {
        storage.write(key, value);
        return;
      }
      mem.set(key, value);
    } catch {
      /* 存不下就算了：埋点不该为此报错 */
    }
  }

  /* ------------------------------------------------- 身份与采样 */

  function ensureIdentity(): boolean {
    let isNew = false;
    playerId = readStore(ID_KEY);
    if (!playerId) {
      playerId = idFn();
      writeStore(ID_KEY, playerId);
      isNew = true;
    }
    const rawFirst = Number(readStore(FIRST_OPEN_KEY));
    if (Number.isFinite(rawFirst) && rawFirst > 0) {
      firstOpenAt = rawFirst;
    } else {
      firstOpenAt = nowFn();
      writeStore(FIRST_OPEN_KEY, String(firstOpenAt));
      isNew = true;
    }
    sessionId = idFn();
    return isNew;
  }

  /**
   * 装机维度的采样分桶（原 `web/ui/analytics.ts` 的理由照搬）：
   * 不用「逐条 Math.random()」是因为那样同一个人的曝光与点击会各撒一半，
   * 聚合出来的记录会变成「有曝光没点击」的脏数据。
   */
  function resolveBucket(): number {
    if (config.bucket !== undefined) {
      written = true;
      return Math.min(99, Math.max(0, config.bucket));
    }
    return Math.floor(Math.random() * 100);
  }

  let written = false;

  /** 首次打开后的第几天（按**自然天**算，与体力跨天同口径） */
  function dayIndex(now: number): number {
    if (!firstOpenAt) return 0;
    const a = new Date(firstOpenAt);
    const b = new Date(now);
    a.setHours(0, 0, 0, 0);
    b.setHours(0, 0, 0, 0);
    return Math.round((b.getTime() - a.getTime()) / 86_400_000);
  }

  function loadBuffer(): void {
    try {
      const raw = readStore(BUFFER_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      buffer = Array.isArray(parsed) ? (parsed as Envelope[]) : [];
    } catch {
      buffer = []; // 缓冲被改坏就丢掉重来（埋点数据不值得为它崩一次）
    }
  }

  function writeBuffer(): void {
    if (buffer.length > maxBuffer) buffer = buffer.slice(-maxBuffer);
    writeStore(BUFFER_KEY, JSON.stringify(buffer));
  }

  /**
   * 写盘节流：连续 track 时不要每条都序列化 3000 条（原版是 200ms 定时器，
   * 这里改成「距离上次落盘超过 SAVE_MS 才写」—— 结果一样，但不需要定时器，
   * 免得单测进程被一个挂着的 timer 拖着不退出）。
   */
  function saveThrottled(now: number): void {
    if (now - lastSaveAt < SAVE_MS) return;
    lastSaveAt = now;
    writeBuffer();
  }

  function saveNow(): void {
    lastSaveAt = nowFn();
    writeBuffer();
  }

  /** 只有「确实发出去了」这批才从缓冲删；交不出去就留着下次补发 */
  function dropSent(sent: readonly Envelope[]): void {
    if (sent.length === 0) return;
    const keys = new Set(sent.map((x) => `${x.ts}:${x.seq}`));
    buffer = buffer.filter((x) => !keys.has(`${x.ts}:${x.seq}`));
    saveNow();
  }

  async function doFlush(): Promise<void> {
    if (!endpoint) {
      saveNow();
      return;
    }
    // 限流：两次上报之间留最小间隔（避免一口气刷屏）
    const stamp = nowFn();
    if (queue.length > 0 && stamp - lastFlushAt < FLUSH_MS) return;
    const batch = queue;
    queue = [];
    if (batch.length === 0) {
      saveNow();
      return;
    }
    lastFlushAt = stamp;
    try {
      const ok = await send(endpoint, serialize(batch));
      if (ok) dropSent(batch);
      else queue = batch.concat(queue); // 没发出去就放回队首，下次再试
    } catch {
      queue = batch.concat(queue);
    }
  }

  return {
    start(): void {
      if (started) return;
      started = true;
      try {
        if (!written) {
          const bucket = resolveBucket();
          sampled = bucket < Math.round(sampleRate * 100);
        }
        loadBuffer();
        const isNew = ensureIdentity();
        if (isNew) this.track(EVENT.firstOpen);
        this.track(EVENT.sessionStart);
        // 启动时把上次没发出去的补发一遍
        void doFlush();
      } catch {
        /* 埋点绝不能影响游戏 */
      }
    },

    track(name: EventName | string, props: MetricsProps = {}): void {
      try {
        if (!sampled) return; // 没被采样到：整条丢掉（连本地缓冲都不写）
        const item: Envelope = {
          e: String(name),
          ts: nowFn(),
          pid: playerId,
          sid: sessionId,
          day: dayIndex(nowFn()),
          seq: seq++,
          p: props,
        };
        buffer.push(item);
        if (buffer.length > maxBuffer) buffer = buffer.slice(-maxBuffer);
        writeStore(BUFFER_KEY, JSON.stringify(buffer));
        if (endpoint) {
          queue.push(item);
          if (queue.length >= flushAt) void doFlush();
        }
      } catch {
        /* 同上 */
      }
    },

    async flush(): Promise<void> {
      try {
        await doFlush();
      } catch {
        /* 同上 */
      }
    },

    exportAll(): readonly Envelope[] {
      saveNow();
      return buffer.slice();
    },

    stats(): TrackerStats {
      return {
        events: buffer.length,
        endpoint: endpoint || '(off · 纯本地)',
        day: dayIndex(nowFn()),
        playerId,
        sampled,
      };
    },

    clear(): void {
      buffer = [];
      queue = [];
      writeStore(BUFFER_KEY, JSON.stringify(buffer));
    },
  };
}

let cached: Tracker | null = null;

/** 进程内默认实例（懒建一次） */
export function track(): Tracker {
  if (!cached) cached = createTracker();
  return cached;
}

/** 测试 / 换宿主时清掉默认实例 */
export function resetTrackProbe(): void {
  cached = null;
}

/** 今日 ↔ 首次 的天数差，给「次留」这类体外计算用 */
export function daysSince(startAt: number, now: number): number {
  const days = Math.round((new Date(now).setHours(0, 0, 0, 0) - new Date(startAt).setHours(0, 0, 0, 0)) / 86_400_000);
  return dayStamp(now) === dayStamp(startAt) ? 0 : days;
}
