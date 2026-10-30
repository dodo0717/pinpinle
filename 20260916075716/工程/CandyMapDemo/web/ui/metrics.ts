/**
 * 产品指标埋点（2026-10-26 建，2026-10-28 改为「**纯本地**」口径）。
 *
 * ```
 * track(事件) → localStorage 环形缓冲（上限 3000 条）
 *             → 控制台 __metrics.dump() / __metrics.download() 导出
 * ```
 *
 * **默认不发任何网络请求**（`DEFAULT_ENDPOINT = ''`）：验证期先攒在玩家本机，
 * 由种子用户导出 JSON 回传，零后端、零依赖、零成本。
 * 以后要接服务端时**不用改业务代码**，只给一个地址即可：
 * ```
 * ?analytics=http://localhost:5182/log      ← 本地 log 服务（tools/analytics-server.mjs）
 * ```
 * 一旦有 endpoint，缓冲区里的事件就会按批发出去（发成功才从缓冲删）。
 *
 * ⚠️ 与 `ui/analytics.ts`（M9）**是两个东西，别混**：
 *   - `analytics.ts`：荣誉弹窗「曝光 + 点了哪个按钮」聚合成一条；
 *   - 本文件：**产品指标**（次留 / 关卡通过率漏斗 / 单局时长 / 教学完成率）。
 *
 * ⚠️ 三条硬规矩：
 *   1. **绝不影响游戏**：全部 try/catch、不 await、失败只丢不抛（埋点把游戏搞崩是最蠢的线上事故）；
 *   2. **落盘格式是 JSON Lines 风格的单条对象**：导出的 JSON 里 `events` 是数组，
 *      每条一个对象，后续服务端 / 数仓直接吃；
 *   3. **攒批**：有 endpoint 时 5 秒或 10 条发一批，绝不一条一个请求。
 *
 * ⚠️ 上报用 `text/plain`：属「简单请求」，**不触发 CORS 预检**（省一半请求、少一个失败点）。
 */

/** 事件名：集中在这里，避免各处写错字符串（写错了日志里就永远查不到） */
export const EVENT = {
  /** 首次打开（留存的分母；只在真正第一次时发一次） */
  firstOpen: 'first_open',
  /** 每次会话开始：带 `day` = 首次打开后的第几天 → 用来算次留 / 3 留 / 7 留 */
  sessionStart: 'session_start',
  /** 开始一关：带 attempt = 本关第几次尝试 */
  levelStart: 'level_start',
  /** 通关：带 stars / score / 时长 / 是否续命 */
  levelEnd: 'level_end',
  /** 失败（没够到 1★ 且放弃续命）：带剩余时间，用来定位卡关 */
  levelFail: 'level_fail',
  /** 教学开始 */
  tutorialStart: 'tutorial_start',
  /** 教学完成（拼够 3 组） */
  tutorialDone: 'tutorial_done',
  /** 教学被跳过 */
  tutorialSkip: 'tutorial_skip',
  /** 看了广告（激励视频）：placement 区分点位 */
  adShow: 'ad_show',
  /** 广告看完 / 中途关掉 */
  adFinish: 'ad_finish',
} as const;

export type EventName = (typeof EVENT)[keyof typeof EVENT];
export type MetricsProps = Record<string, string | number | boolean | null>;

/** 一条事件的落盘形态（短键名：能省一点体积就省一点） */
interface Envelope {
  /** 事件名 */
  e: string;
  /** 时间戳（毫秒） */
  ts: number;
  /** 匿名玩家 id（本机随机串，不含任何个人信息） */
  pid: string;
  /** 会话 id：同一次打开里的所有事件共享，能还原一个玩家的完整行为序列 */
  sid: string;
  /** 首次打开后的第几天（0 = 当天） */
  day: number;
  /** 事件序号：同一毫秒内也能排出先后 */
  seq: number;
  /** 业务参数 */
  p: MetricsProps;
}

/**
 * 上报端点。
 *
 * **默认空 = 纯本地模式**（不发网络，只写 localStorage）。
 * 想启用上报：URL 加 `?analytics=http://host:port/log`，或直接把这里改成地址。
 */
const DEFAULT_ENDPOINT = '';

/** 缓冲区上限：超过就丢最旧的（验证期 3000 条够跑几个月，且不会撑爆 localStorage） */
const BUFFER_MAX = 3000;
/** 写盘节流：连续 track 时合并成一次 JSON.stringify（避免每条都序列化 3000 条） */
const SAVE_MS = 200;
/** 有 endpoint 时的攒批：5 秒或 10 条，谁先到走谁 */
const FLUSH_MS = 5000;
const FLUSH_AT = 10;

const ID_KEY = 'mengchong.metrics.id';
const FIRST_OPEN_KEY = 'mengchong.metrics.firstOpen';
const BUFFER_KEY = 'mengchong.metrics.buffer';

let endpoint = DEFAULT_ENDPOINT;
let playerId = '';
let sessionId = '';
let firstOpenAt = 0;
let seq = 0;
/** 全量缓冲：**唯一真相**，无论有没有 endpoint 都往这里写 */
let buffer: Envelope[] = [];
/** 待发送队列（只有 endpoint 存在时才非空） */
let queue: Envelope[] = [];
let timer: number | null = null;
let saveTimer: number | null = null;
let started = false;

/* ------------------------------------------------------------------ 存储（全容错） */

/** localStorage 在隐私模式 / 小游戏里都可能不可用 → 全部包起来，坏了就当没存过 */
function readStore(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function writeStore(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* 存不下就算了：埋点不该为此报错 */
  }
}

function randomId(): string {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  } catch {
    /* 老环境没有 randomUUID */
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/* ------------------------------------------------------------------ 身份与天序 */

function ensureIdentity(): { isNew: boolean } {
  let isNew = false;
  playerId = readStore(ID_KEY);
  if (!playerId) {
    playerId = randomId();
    writeStore(ID_KEY, playerId);
    isNew = true;
  }
  const rawFirst = Number(readStore(FIRST_OPEN_KEY));
  if (!Number.isFinite(rawFirst) || rawFirst <= 0) {
    firstOpenAt = Date.now();
    writeStore(FIRST_OPEN_KEY, String(firstOpenAt));
    isNew = true;
  } else {
    firstOpenAt = rawFirst;
  }
  sessionId = randomId();
  return { isNew };
}

/** 首次打开后的第几天（按**自然天**算：跨过 0 点就算新的一天，与体力跨天同口径） */
function dayIndex(now: number): number {
  if (!firstOpenAt) return 0;
  const a = new Date(firstOpenAt);
  const b = new Date(now);
  a.setHours(0, 0, 0, 0);
  b.setHours(0, 0, 0, 0);
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/* ------------------------------------------------------------------ 本地缓冲（纯本地模式的核心） */

function loadBuffer(): void {
  try {
    const raw = readStore(BUFFER_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    buffer = Array.isArray(parsed) ? (parsed as Envelope[]) : [];
  } catch {
    buffer = []; // 缓冲被改坏就丢掉重来（埋点数据不值得为它崩一次）
  }
}

/** 写盘（节流合并）：连续 track 时只落一次 */
function scheduleSave(): void {
  if (saveTimer !== null) return;
  try {
    saveTimer = window.setTimeout(() => {
      saveTimer = null;
      if (buffer.length > BUFFER_MAX) buffer = buffer.slice(-BUFFER_MAX);
      writeStore(BUFFER_KEY, JSON.stringify(buffer));
    }, SAVE_MS);
  } catch {
    /* 没有 window（理论上不会）就当没存 */
  }
}

/** 立即落盘（关页面 / 导出前用，保证数据是全的） */
function saveNow(): void {
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (buffer.length > BUFFER_MAX) buffer = buffer.slice(-BUFFER_MAX);
  writeStore(BUFFER_KEY, JSON.stringify(buffer));
}

/** 从缓冲里删掉「已经成功发出去」的那些（按 ts+seq 认） */
function dropSent(sent: readonly Envelope[]): void {
  if (sent.length === 0) return;
  const keys = new Set(sent.map((x) => `${x.ts}:${x.seq}`));
  buffer = buffer.filter((x) => !keys.has(`${x.ts}:${x.seq}`));
  scheduleSave();
}

/* ------------------------------------------------------------------ 上报（默认关闭） */

function serialize(batch: readonly Envelope[]): string {
  return batch.map((x) => JSON.stringify(x)).join('\n');
}

async function send(body: string, useBeacon: boolean): Promise<void> {
  // 关页面时用 sendBeacon：fetch 在这时会来不及发出去
  if (useBeacon && typeof navigator !== 'undefined' && navigator.sendBeacon) {
    const ok = navigator.sendBeacon(endpoint, new Blob([body], { type: 'text/plain' }));
    if (ok) return;
    throw new Error('beacon rejected');
  }
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body,
    keepalive: true, // 关页面也能发完
  });
  if (!res.ok) throw new Error(`http ${res.status}`);
}

async function post(batch: readonly Envelope[], useBeacon: boolean): Promise<void> {
  try {
    await send(serialize(batch), useBeacon);
    dropSent(batch); // 真发出去了才从缓冲删；失败就留着下次再发
  } catch {
    /* 失败不重排、不报错：数据还在 buffer 里，下次 flush 自然重试 */
  }
}

/**
 * 把待发队列发出去。
 *
 * ⚠️ **这里绝不能停定时器**（踩过的坑：一开始在 flush 里 `clearInterval(timer)`，
 *    结果只要触发过一次 flush（满 10 条、或第一次 5 秒到了），定时器就永久停摆 ——
 *    之后的事件再也没人发出去，只有关页面时靠 sendBeacon 侥幸带走一部分）。
 */
function flush(useBeacon = false): void {
  if (queue.length === 0) {
    saveNow();
    return;
  }
  const batch = queue;
  queue = [];
  void post(batch, useBeacon);
}

/* ------------------------------------------------------------------ 对外接口 */

/**
 * 记一条事件。
 *
 * @param name 事件名（用 `EVENT` 里的常量，别手写字符串）
 * @param props 业务参数；**不要放任何个人信息**（昵称 / 头像 / openid 都不行）
 */
export function track(name: EventName | string, props: MetricsProps = {}): void {
  try {
    const item: Envelope = {
      e: name,
      ts: Date.now(),
      pid: playerId,
      sid: sessionId,
      day: dayIndex(Date.now()),
      seq: seq++,
      p: props,
    };
    buffer.push(item);
    scheduleSave();
    if (endpoint) {
      queue.push(item);
      if (queue.length >= FLUSH_AT) flush();
    }
  } catch {
    /* 埋点绝不能影响游戏 */
  }
}

/**
 * 启动指标埋点：建身份、发会话事件、挂离场/导出钩子。
 * 素材就绪之后调用一次即可（这时的 `mode` / 关卡数据才是真的）。
 */
export function metricsStart(): void {
  if (started) return;
  started = true;
  try {
    const params = new URLSearchParams(location.search);
    endpoint = params.get('analytics') ?? DEFAULT_ENDPOINT;

    loadBuffer();
    const { isNew } = ensureIdentity();
    if (isNew) track(EVENT.firstOpen);
    track(EVENT.sessionStart);

    if (endpoint) {
      timer = window.setInterval(() => flush(), FLUSH_MS);
      // 启动时把上次没发出去的补发一遍
      flush();
    }
    window.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush(true);
    });
    window.addEventListener('pagehide', () => {
      saveNow();
      flush(true);
    });

    // 控制台/种子用户导出入口
    (window as unknown as Record<string, unknown>).__metrics = {
      dump,
      download,
      export: exportAll,
      stats,
    };
  } catch {
    /* 同上 */
  }
}

/** 导出全部本地事件（原始数组，给脚本/控制台用） */
export function exportAll(): Envelope[] {
  saveNow();
  return buffer.slice();
}

/** 自检：攒了多少条、当前是不是纯本地 */
export function stats(): { events: number; endpoint: string; day: number; playerId: string } {
  return {
    events: buffer.length,
    endpoint: endpoint || '(off · 纯本地)',
    day: dayIndex(Date.now()),
    playerId,
  };
}

/** 控制台摘要：按事件名计数（一眼看出「玩到哪一步」） */
export function dump(): void {
  const counts = new Map<string, number>();
  for (const x of buffer) counts.set(x.e, (counts.get(x.e) || 0) + 1);
  const table = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([事件, 条数]) => ({ 事件, 条数 }));
  const info = stats();
  console.log(
    `[metrics] ${info.endpoint} · 玩家 ${info.playerId.slice(0, 8)} · 第 ${info.day} 天 · 共 ${info.events} 条`,
  );
  console.table(table);
  if (info.events === 0) console.log('[metrics] 还没有事件（先玩一关）');
  else console.log('[metrics] 导出文件：__metrics.download()');
}

/** 下载一个 JSON 文件（种子用户把文件发回即可，零后端） */
export function download(): void {
  try {
    saveNow();
    const body = JSON.stringify(
      { version: 1, exportedAt: new Date().toISOString(), stats: stats(), events: buffer },
      null,
      1,
    );
    const blob = new Blob([body], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `metrics-${playerId.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  } catch {
    /* 下载失败也不能影响游戏 */
  }
}
