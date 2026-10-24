/**
 * 云同步（candy.aidertech.cn）——v1 仅同步**简单模式**。
 *
 * 移植自糖果小镇 `universal-map-editor/src/minigame/cloud.ts`（评估文档 §B），
 * 按 2026-10-24 决策直接使用现有后端实例（`.env` 的 AppID 与本游戏一致）。
 *
 * ## 后端契约（GamePlayController / ProgressMerge）
 * - `POST /game/api/auth/login` `{code}` → `{token, playerId}`；
 * - `GET /game/api/progress`（Wx-Authorization: Bearer）→ `{unlocked, totalStars, totalScore, progress}`
 *   其中 `progress` 是后端自维护的 `{unlocked, stars:{关:星}, best:{关:分}}` JSON 串；
 * - `POST /game/api/level/result` `{level,win,stars,score,moves?,durationMs?}` → 逐关取大合并。
 *   **关卡守卫 `level ≤ unlocked`**：这是 v1 只同步简单模式的原因——困难模式若用
 *   关号偏移（+60）上报会被判「跳关」拒收；等后端加模式维度后再放开（客户端把
 *   `REPORT_MODES` 加上 'nightmare' 即可，映射缝已留好）。
 *
 * ## 设计原则（与糖果小镇同款）
 * **本地是真相，网络尽力而为**：弱网/离线不卡玩法——
 *   启动：login → flush 离线队列 → pull 云档与本地「取大合并」→ 把本地比云端多的关
 *   逐关补推上云（按关号升序，与后端的解锁守卫天然吻合：本方通关集是 1..N 连续前缀）；
 *   结算：先本地落盘（GameBootstrap 已做），再 report；失败进离线队列（上限 200 条）。
 * 一切失败静默降级为纯本地；401 清 token 转纯本地。
 *
 * 浏览器预览：无 `wx` → cloudSync() 返回 null，全部路径变 no-op。
 */

import { recordOf, TOTAL_LEVELS } from '../核心/index';
import type { ProgressData } from '../核心/index';
import type { GameMode } from '../核心/index';

/** 后端基址（现有实例，与 mini-assets 同域） */
export const CLOUD_BASE = 'https://candy.aidertech.cn';

const TOKEN_KEY = 'pinpin.cloud.token';
const QUEUE_KEY = 'pinpin.cloud.queue';

/** v1 上报的模式（见文件头「关卡守卫」说明） */
export const REPORT_MODES: readonly GameMode[] = ['normal'];

/** 一条结算上报（离线队列里也用它，附 ts） */
export interface CloudLevelResult {
  level: number;
  win: boolean;
  stars: number;
  score: number;
  moves?: number;
  durationMs?: number;
  ts?: number;
}

/** 平台宿主：微信实现的注入缝（测试用假宿主覆盖全部分支） */
export interface CloudHost {
  login(): Promise<{ code: string }>;
  request(o: { url: string; method: 'GET' | 'POST' | 'PUT'; data?: unknown; header?: Record<string, string> }): Promise<{ statusCode: number; data?: unknown }>;
  getStorage(key: string): string | null;
  setStorage(key: string, value: string): void;
}

/* ---------------------------------------------------------------- 纯函数（单测覆盖） */

/** 后端 progress JSON 的形状（ProgressMerge 维护的） */
interface CloudShape {
  stars: Record<string, number>;
  best: Record<string, number>;
}

function asCloudShape(raw: unknown): CloudShape | null {
  if (!raw || typeof raw !== 'object') return null;
  const stars = (raw as { stars?: unknown }).stars;
  const best = (raw as { best?: unknown }).best;
  if (!stars || typeof stars !== 'object' || !best || typeof best !== 'object') return null;
  return { stars: stars as Record<string, number>, best: best as Record<string, number> };
}

function clampInt(v: unknown, lo: number, hi: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : 0;
  return Math.min(hi, Math.max(lo, n));
}

/**
 * 云档并入本地（简单模式）：星级 / personalBest 逐关取大；boardBest 是排行榜口径
 * （续命局不上榜），云端没有对应字段，**保持本地值不动**。
 * `unlocked` 按 save.ts 同口径推导：通关第 L（≥1★）必然已解锁 L+1，夹到 [1, totalLevels]。
 * 云端没有本地没有的东西时不分配新对象（调用方靠引用判断是否需要重画）。
 */
export function mergeCloudProgress(local: ProgressData, cloud: unknown): ProgressData {
  const c = asCloudShape(cloud);
  if (!c) return local;
  const levels = { ...local.levels };
  let changed = false;
  for (const key of Object.keys(c.stars)) {
    const level = Number(key);
    if (!Number.isFinite(level) || level < 1 || level > TOTAL_LEVELS) continue;
    const rec = recordOf(local, level);
    const stars = Math.max(rec.stars, clampInt(c.stars[key], 0, 3));
    const personalBest = Math.max(rec.personalBest, Math.max(0, Math.floor(Number(c.best[key]) || 0)));
    if (stars === rec.stars && personalBest === rec.personalBest) continue;
    changed = true;
    levels[level] = { ...rec, stars, personalBest };
  }
  let maxCleared = 0;
  for (const key of Object.keys(levels)) {
    const rec = levels[Number(key)];
    if (rec && rec.stars >= 1) maxCleared = Math.max(maxCleared, Number(key));
  }
  const unlocked = Math.min(TOTAL_LEVELS, Math.max(local.unlocked, maxCleared + 1));
  if (!changed && unlocked === local.unlocked) return local;
  return { ...local, levels, unlocked };
}

/**
 * 本地比云端多的关（按关号升序）。升序补推与后端解锁守卫天然吻合：
 * 本方通关集是 1..N 连续前缀（要玩第 L 关必先 ≥1★ 过第 L-1 关），云端亦然，
 * 所以补推序列对双方 unlocked 都是连续推进，不会撞「跳关」拦截。
 */
export function cloudDiff(local: ProgressData, cloud: unknown): CloudLevelResult[] {
  const c = asCloudShape(cloud);
  const cloudStars = c?.stars ?? {};
  const cloudBest = c?.best ?? {};
  const out: CloudLevelResult[] = [];
  for (const key of Object.keys(local.levels)) {
    const level = Number(key);
    const rec = local.levels[level];
    if (!rec || level < 1 || level > TOTAL_LEVELS) continue;
    const better = rec.stars > (Number(cloudStars[key]) || 0)
      || rec.personalBest > (Number(cloudBest[key]) || 0);
    if (!better) continue;
    out.push({ level, win: true, stars: rec.stars, score: rec.personalBest });
  }
  return out.sort((a, b) => a.level - b.level);
}

/* ---------------------------------------------------------------- CloudSync */

export class CloudSync {
  private token: string | null;
  private readonly base: string;
  private readonly host: CloudHost;
  /** 登录成功后拿到的玩家主键（分享卡片 / 好友系统用） */
  playerId: number | null = null;

  // ⚠️ 不写 constructor(private x) 参数属性：Node 剥离模式不支持（同 MapPanels 规约）
  constructor(host: CloudHost, baseUrl: string) {
    this.host = host;
    this.base = baseUrl.replace(/\/+$/, '');
    this.token = this.host.getStorage(TOKEN_KEY);
  }

  get enabled(): boolean {
    return this.base.length > 0;
  }

  get loggedIn(): boolean {
    return !!this.token;
  }

  /** 微信登录换 JWT。失败不抛（纯本地也能玩），返回是否成功。 */
  async login(): Promise<boolean> {
    if (!this.enabled) return false;
    try {
      const { code } = await this.host.login();
      const res = await this.host.request({
        url: `${this.base}/game/api/auth/login`,
        method: 'POST',
        data: { code },
      });
      const body = res.data as { token?: string; playerId?: number } | null;
      if (res.statusCode === 200 && body && body.token) {
        this.token = body.token;
        this.playerId = typeof body.playerId === 'number' ? body.playerId : null;
        this.host.setStorage(TOKEN_KEY, body.token);
        return true;
      }
    } catch {
      /* 登录失败：继续纯本地 */
    }
    return false;
  }

  /**
   * 启动对齐：拉云档与本地（简单模式）取大合并；本地比云端多的关补推上云。
   * 返回合并后的进度（无变化时返回原引用，调用方按引用相等跳过重画）。
   */
  async pull(normal: ProgressData): Promise<ProgressData> {
    if (!this.enabled || !this.token) return normal;
    try {
      const res = await this.host.request({
        url: `${this.base}/game/api/progress`,
        method: 'GET',
        header: { 'Wx-Authorization': `Bearer ${this.token}` },
      });
      if (res.statusCode === 401) {
        this.clearToken();
        return normal;
      }
      if (res.statusCode !== 200) return normal;
      const body = res.data as { progress?: string } | null;
      const cloud = body && body.progress ? safeParse(body.progress) : null;
      const merged = mergeCloudProgress(normal, cloud);
      for (const item of cloudDiff(merged, cloud)) {
        // 逐关补推；失败不管（结算上报那条路还会兜底）
        await this.postResult(item);
      }
      return merged;
    } catch {
      return normal;
    }
  }

  /** 结算上报：成功即返回，失败入队（≤200 条），下次 flush() 补传。 */
  async report(r: CloudLevelResult): Promise<void> {
    if (!this.enabled) return;
    const item: CloudLevelResult = { ...r, ts: Date.now() };
    const ok = this.token ? await this.postResult(item) : false;
    if (!ok) this.enqueue(item);
  }

  /**
   * 调一个需要登录的接口（体力 / 分享邀请人 / …… 的通用通道）。
   * 返回若依格式的响应体（{code,msg,data,...}）；未启用、未登录、网络失败返回 null。
   * 401 清 token。**注意**：后端二期能力（如 /game/api/invite）可能还没上线，
   * 404 也归入 null——调用方按「尽力而为」处理，别当错误弹给玩家。
   */
  async api(method: 'GET' | 'POST' | 'PUT', path: string, data?: unknown): Promise<Record<string, unknown> | null> {
    if (!this.enabled || !this.token) return null;
    try {
      const res = await this.host.request({
        url: `${this.base}${path}`,
        method,
        data,
        header: { 'Wx-Authorization': `Bearer ${this.token}` },
      });
      if (res.statusCode === 401) {
        this.clearToken();
        return null;
      }
      if (res.statusCode !== 200 || !res.data || typeof res.data !== 'object') return null;
      return res.data as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  /** 补传离线队列（登录后调用）。 */
  async flush(): Promise<void> {
    if (!this.enabled || !this.token) return;
    const queue = this.readQueue();
    if (!queue.length) return;
    const remain: CloudLevelResult[] = [];
    for (const item of queue) {
      if (!(await this.postResult(item))) remain.push(item);
    }
    this.writeQueue(remain);
  }

  // ---------- 内部 ----------

  private async postResult(item: CloudLevelResult): Promise<boolean> {
    try {
      const res = await this.host.request({
        url: `${this.base}/game/api/level/result`,
        method: 'POST',
        header: { 'Wx-Authorization': `Bearer ${this.token}` },
        data: {
          level: item.level, win: item.win, stars: item.stars, score: item.score,
          moves: item.moves, durationMs: item.durationMs,
        },
      });
      if (res.statusCode === 401) {
        this.clearToken();
        return false;
      }
      return res.statusCode === 200;
    } catch {
      return false;
    }
  }

  private enqueue(item: CloudLevelResult): void {
    const queue = this.readQueue();
    queue.push(item);
    // 只保留最近 200 条，避免无限增长
    this.writeQueue(queue.slice(-200));
  }

  private readQueue(): CloudLevelResult[] {
    const raw = this.host.getStorage(QUEUE_KEY);
    const arr = raw ? safeParse(raw) : null;
    return Array.isArray(arr) ? (arr as CloudLevelResult[]) : [];
  }

  private writeQueue(q: CloudLevelResult[]): void {
    this.host.setStorage(QUEUE_KEY, JSON.stringify(q));
  }

  private clearToken(): void {
    this.token = null;
    this.host.setStorage(TOKEN_KEY, '');
  }
}

/* ---------------------------------------------------------------- 平台接入 */

/** 微信宿主。`wx.getStorageSync` 可能返回非字符串（存过对象时原样返回）——统一归一化。 */
function wxHost(): CloudHost | null {
  const wx = (globalThis as { wx?: any }).wx;
  if (!wx || typeof wx.login !== 'function' || typeof wx.request !== 'function') return null;
  return {
    login: () => new Promise<{ code: string }>((resolve, reject) => {
      wx.login({ success: resolve, fail: reject });
    }),
    request: (o) => new Promise<{ statusCode: number; data?: unknown }>((resolve) => {
      wx.request({ ...o, success: resolve, fail: () => resolve({ statusCode: 0 }) });
    }),
    getStorage: (key) => {
      try {
        const v = wx.getStorageSync(key);
        return typeof v === 'string' && v.length > 0 ? v : null;
      } catch {
        return null;
      }
    },
    setStorage: (key, value) => {
      try {
        wx.setStorageSync(key, value);
      } catch {
        /* 配额满等：纯本地继续 */
      }
    },
  };
}

let shared: CloudSync | null | undefined;

/** 懒单例：MapBootstrap（启动对齐）与 GameBootstrap（结算上报）共享同一份登录态。非微信返回 null。 */
export function cloudSync(): CloudSync | null {
  if (shared === undefined) {
    const host = wxHost();
    shared = host ? new CloudSync(host, CLOUD_BASE) : null;
  }
  return shared;
}

/** 测试用：重置单例与登录态 */
export function resetCloudForTest(): void {
  shared = undefined;
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
