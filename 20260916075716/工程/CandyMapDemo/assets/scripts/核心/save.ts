/**
 * M6 · 存档层（纯逻辑，零 DOM / 零存储 API / 零计时器）
 *
 * 为什么单独一个文件：存档的三件事都必须**能脱离浏览器单测** ——
 *   1. **口径**：存档单位是「一次交换事务」（§16），所以一条合法存档 = 事务结束时的
 *      棋盘 + 随机源状态 + 局内剩余时间 + 进度 + 体力；
 *   2. **健壮性**：存档是**外部输入**（可能被改、被截断、来自旧版本）。
 *      任何字段坏掉都不许让游戏起不来，必须「按字段降级 + 逐条说明」；
 *   3. **离线计时**：退出 / 切后台期间倒计时**照走**，回来时按真实流逝一次性扣掉
 *      （§16 新口径），这条同样是纯算术。
 *
 * 存储介质（localStorage / wx.setStorageSync）与防抖调度在 `web/ui/storage.ts`、
 * `web/ui/saveManager.ts`，本文件只认字符串与对象。
 */

import { GRID_BY_LEVEL, type GameMode } from './config';
import type { Cell } from './grid';
import { STAMINA_MAX, createProgress, type LevelRecord, type ProgressData, type Stamina } from './progress';

/** 存档格式版本；改动字段含义时必须 +1（旧档会整档作废，见 `parseSave`） */
export const SAVE_VERSION = 1;

/** 「<1 秒连续交换合并（防抖）」（§16）——同一秒内的多次落盘请求只写一次 */
export const SAVE_DEBOUNCE_MS = 1000;

/** 两种玩法模式，顺序固定（进度要逐模式落盘，见 §7.3.3） */
export const GAME_MODES: readonly GameMode[] = ['normal', 'nightmare'];

/** 校验/降级时用到的外部约束（由调用方给真值，避免这里再抄一份策划案数字） */
export interface SaveLimits {
  totalLevels: number;
  staminaMax: number;
  timeLimit: number;
  adStaminaDailyMax: number;
}

/* ------------------------------------------------------------------ 结构 */

export interface SaveSettings {
  sound: boolean;
  bgm: boolean;
}

/** `web/ui/meta.ts` 的 `MetaState` 的可落盘形态（字段同名同义，整体序列化即可） */
export interface MetaSnapshot {
  stamina: Stamina;
  nextRecoverAt: number | null;
  adDay: string;
  adStaminaUsed: number;
  settings: SaveSettings;
  guideDone: boolean;
}

/**
 * 局内断点（§16）。
 *
 * ⚠️ 只在**被动退出**（切后台 / 进程结束）时落盘：主动返回主页是「中途退出」，
 * 按 §12.4 退还预扣体力并清掉断点，不做恢复。
 *
 * ⚠️ 退出**不暂停倒计时**（§16 新口径）：`savedAt` 就是「离开时刻」，回来时按
 * `now - savedAt` 把这段时间一次性扣掉；扣到 0 直接结算本局，不让玩家对着一个
 * 0 秒的棋盘发呆。
 *
 * `paused` 不存：恢复后一律先**停表**，等玩家点一下再走 —— 否则切回来时
 * 倒计时会在玩家还没看清棋盘时先流掉几秒。
 */
export interface LevelSession {
  mode: GameMode;
  level: number;
  /** 本局种子（仅用于排查复现；真正决定补位序列的是 `rngState`） */
  seed: number;
  /** `Rng.snapshot`（不是种子！见 rng.ts 的说明） */
  rngState: number;
  cells: Cell[];
  score: number;
  eliminations: number;
  /** 剩余秒数（整数） */
  timeLeft: number;
  /** 本局是否已经开始计时（没开始的一局恢复后不自动跑表） */
  started: boolean;
  revived: boolean;
  revivedUsed: boolean;
  swapMisses: number;
  eliminatedOnce: boolean;
  /** 最近一次落盘时刻 —— 同时是「离开时刻」的基准，见 `resumeTimeLeft` */
  savedAt: number;
}

export interface SaveData {
  version: number;
  /** 最近一次落盘时刻 */
  savedAt: number;
  /** 当前玩法模式 */
  mode: GameMode;
  /** 逐模式进度（两套都要存，切模式不该丢进度） */
  progress: Record<GameMode, ProgressData>;
  meta: MetaSnapshot;
  /** 局内断点；null = 当前没在局中 */
  session: LevelSession | null;
}

export interface SaveReadResult {
  data: SaveData;
  /** 有任何字段用了兜底值（含整档作废） */
  recovered: boolean;
  /** 整档被作废（版本不符 / 不是对象 / JSON 解析失败）—— 界面要按「存档读取失败」提示 */
  discarded: boolean;
  /** 逐条问题说明，直接可以打给开发者看 */
  issues: string[];
}

/* ------------------------------------------------------------------ 出厂值 */

function dayKey(now: number): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 新用户的元系统默认值（与 `web/ui/meta.ts` 的 `createMeta` 口径一致） */
export function createMetaSnapshot(now: number): MetaSnapshot {
  return {
    stamina: { available: STAMINA_MAX, pending: 0 },
    nextRecoverAt: null,
    adDay: dayKey(now),
    adStaminaUsed: 0,
    settings: { sound: true, bgm: true },
    guideDone: false,
  };
}

/** 全新存档（第 1 关解锁 / 满体力 / 无断点） */
export function createSaveData(mode: GameMode, now: number): SaveData {
  const progress = {} as Record<GameMode, ProgressData>;
  for (const m of GAME_MODES) progress[m] = createProgress(m);
  return {
    version: SAVE_VERSION,
    savedAt: now,
    mode,
    progress,
    meta: createMetaSnapshot(now),
    session: null,
  };
}

/** 序列化：唯一的落盘形态（保持紧凑 —— 微信 `setStorageSync` 有 1MB/条的上限） */
export function serializeSave(data: SaveData): string {
  return JSON.stringify({ ...data, savedAt: data.savedAt });
}

/* ------------------------------------------------------------------ 健壮性 */

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** 取整数并夹取；不是数字就返回 null（调用方决定是兜底还是忽略） */
function intIn(v: unknown, min: number, max: number): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const n = Math.floor(v);
  if (n < min || n > max) return null;
  return n;
}

function boolOr(v: unknown, fb: boolean): boolean {
  return typeof v === 'boolean' ? v : fb;
}

/** 关卡记录修复：星级 0~3、分数非负（越界即视为损坏，用 0 兜底并记一条） */
function sanitizeRecord(raw: unknown, level: number, issues: string[]): LevelRecord {
  if (!isObj(raw)) {
    issues.push(`第 ${level} 关记录不是对象，已按全 0 处理`);
    return { stars: 0, personalBest: 0, boardBest: 0 };
  }
  const stars = intIn(raw.stars, 0, 3);
  const personalBest = intIn(raw.personalBest, 0, Number.MAX_SAFE_INTEGER);
  const boardBest = intIn(raw.boardBest, 0, Number.MAX_SAFE_INTEGER);
  if (stars === null) issues.push(`第 ${level} 关星级非法（${String(raw.stars)}），已按 0 处理`);
  if (personalBest === null) issues.push(`第 ${level} 关个人最高分非法，已按 0 处理`);
  if (boardBest === null) issues.push(`第 ${level} 关上榜最高分非法，已按 0 处理`);
  return {
    stars: stars ?? 0,
    personalBest: personalBest ?? 0,
    // 上榜分不可能高于个人最高分（续命局只涨个人分、不涨上榜分，见 §7.4）
    boardBest: Math.min(boardBest ?? 0, personalBest ?? 0),
  };
}

/**
 * 进度修复。
 *
 * ⚠️ `unlocked` 必须夹在 `[1, totalLevels]`：存档被改成 999 之后主界面会显示
 * 「第 999 关」，而关卡数据里根本没有这一关 —— 这种错必须在这里挡掉。
 */
function sanitizeProgress(raw: unknown, mode: GameMode, limits: SaveLimits, issues: string[]): ProgressData {
  const fb = createProgress(mode);
  if (!isObj(raw)) {
    issues.push(`${mode} 进度不是对象，已按新档处理`);
    return fb;
  }

  let unlocked = intIn(raw.unlocked, 1, limits.totalLevels);
  if (unlocked === null) {
    issues.push(`${mode} 的 unlocked 非法（${String(raw.unlocked)}），已按第 1 关处理`);
    unlocked = 1;
  }

  const levels: Record<number, LevelRecord> = {};
  const rawLevels = isObj(raw.levels) ? raw.levels : {};
  if (!isObj(raw.levels)) issues.push(`${mode} 的关卡记录不是对象，已按空处理`);

  for (const [key, value] of Object.entries(rawLevels)) {
    const level = Number(key);
    if (!Number.isInteger(level) || level < 1 || level > limits.totalLevels) {
      issues.push(`${mode} 存在越界关卡记录「${key}」，已丢弃`);
      continue;
    }
    levels[level] = sanitizeRecord(value, level, issues);
  }

  // 有记录的关卡必然 <= unlocked（只增不减），否则把 unlocked 抬上去，
  // 避免出现「已通关第 20 关但第 1~19 关还锁着」这种自相矛盾的进度
  const maxRecorded = Object.keys(levels).reduce((m, k) => Math.max(m, Number(k)), 1);
  const fixed = Math.min(limits.totalLevels, Math.max(unlocked, maxRecorded));
  if (fixed !== unlocked) {
    issues.push(`${mode} 已通关到第 ${maxRecorded} 关但 unlocked=${unlocked}，已抬到 ${fixed}`);
    unlocked = fixed;
  }

  return { mode, unlocked, levels };
}

function sanitizeMeta(raw: unknown, limits: SaveLimits, now: number, issues: string[]): MetaSnapshot {
  const fb = createMetaSnapshot(now);
  if (!isObj(raw)) {
    issues.push('元系统数据不是对象，已按新档处理');
    return fb;
  }

  const rawStamina = isObj(raw.stamina) ? raw.stamina : {};
  let available = intIn(rawStamina.available, 0, limits.staminaMax);
  if (available === null) {
    issues.push(`体力非法（${String(rawStamina.available)}），已按满体力处理`);
    available = limits.staminaMax;
  }
  const pending = intIn(rawStamina.pending, 0, 1) ?? 0;

  let nextRecoverAt: number | null = null;
  if (typeof raw.nextRecoverAt === 'number' && Number.isFinite(raw.nextRecoverAt) && raw.nextRecoverAt > 0) {
    nextRecoverAt = raw.nextRecoverAt;
  } else if (raw.nextRecoverAt !== null && raw.nextRecoverAt !== undefined) {
    issues.push('体力恢复时间戳非法，已按「不显示倒计时」处理');
  }

  const adStaminaUsed = intIn(raw.adStaminaUsed, 0, limits.adStaminaDailyMax);
  if (adStaminaUsed === null && raw.adStaminaUsed !== undefined) {
    issues.push(`广告次数非法（${String(raw.adStaminaUsed)}），已按 0 处理`);
  }

  const rawSettings = isObj(raw.settings) ? raw.settings : {};

  return {
    stamina: { available, pending },
    nextRecoverAt,
    adDay: typeof raw.adDay === 'string' && raw.adDay ? raw.adDay : fb.adDay,
    adStaminaUsed: adStaminaUsed ?? 0,
    settings: {
      sound: boolOr(rawSettings.sound, fb.settings.sound),
      bgm: boolOr(rawSettings.bgm, fb.settings.bgm),
    },
    guideDone: boolOr(raw.guideDone, false),
  };
}

/**
 * 局内断点修复；任何不可自洽的地方都**整段丢弃**（返回 null）。
 *
 * 这里刻意不做「尽力修复」：棋盘少一块 / 图池不对，修出来的是一个可以继续玩
 * 但已经违法的局面（池子结构被破坏），会把「是不是存档的问题」变成查不出来的
 * 玄学 bug。整段丢弃最多丢一局，代价小得多。
 */
function sanitizeSession(raw: unknown, limits: SaveLimits, issues: string[]): LevelSession | null {
  if (raw === null || raw === undefined) return null;
  if (!isObj(raw)) {
    issues.push('局内断点不是对象，已丢弃');
    return null;
  }

  const drop = (why: string): null => {
    issues.push(`局内断点已丢弃：${why}`);
    return null;
  };

  const mode = raw.mode;
  if (mode !== 'normal' && mode !== 'nightmare') return drop(`模式非法（${String(mode)}）`);

  const level = intIn(raw.level, 1, limits.totalLevels);
  if (level === null) return drop(`关卡号非法（${String(raw.level)}）`);

  const grid = GRID_BY_LEVEL[level];
  if (!grid) return drop(`第 ${level} 关没有网格定义`);
  const expectedCells = grid[0] * grid[1];

  if (!Array.isArray(raw.cells)) return drop('棋盘不是数组');
  if (raw.cells.length !== expectedCells) {
    return drop(`棋盘格数 ${raw.cells.length} ≠ 第 ${level} 关的 ${expectedCells}`);
  }

  const cells: Cell[] = [];
  const seen = new Set<number>();
  for (const cell of raw.cells) {
    if (cell === null) return drop('棋盘存在空位（不是事务结束点）');
    if (typeof cell !== 'number' || !Number.isInteger(cell) || cell < 0) {
      return drop(`碎片 ID 非法（${String(cell)}）`);
    }
    if (seen.has(cell)) return drop(`碎片 ${cell} 重复出现（违反 HC-03）`);
    seen.add(cell);
    cells.push(cell);
  }

  const score = intIn(raw.score, 0, Number.MAX_SAFE_INTEGER);
  if (score === null) return drop(`得分非法（${String(raw.score)}）`);
  const eliminations = intIn(raw.eliminations, 0, Number.MAX_SAFE_INTEGER);
  if (eliminations === null) return drop(`消除组数非法（${String(raw.eliminations)}）`);

  const rngState = intIn(raw.rngState, 1, 0xffffffff);
  if (rngState === null) return drop(`随机源状态非法（${String(raw.rngState)}）`);

  const timeLeft = intIn(raw.timeLeft, 0, limits.timeLimit);
  if (timeLeft === null) return drop(`剩余时间非法（${String(raw.timeLeft)}）`);

  // ⚠️ `savedAt` 是「离开时刻」的基准：兜底 0 会让恢复时按「已经过去很久」直接扣到 0
  // （本局判负）。对一条损坏的档来说，这比「白送一次暂停」更符合新规则，故保留 0 兜底。
  const savedAt = intIn(raw.savedAt, 0, Number.MAX_SAFE_INTEGER) ?? 0;

  return {
    mode,
    level,
    seed: intIn(raw.seed, 0, Number.MAX_SAFE_INTEGER) ?? 0,
    rngState,
    cells,
    score,
    eliminations,
    timeLeft,
    started: boolOr(raw.started, false),
    revived: boolOr(raw.revived, false),
    revivedUsed: boolOr(raw.revivedUsed, false),
    swapMisses: intIn(raw.swapMisses, 0, 999) ?? 0,
    eliminatedOnce: boolOr(raw.eliminatedOnce, false),
    savedAt,
  };
}

/**
 * 读档：**永不抛错**，坏掉的地方逐字段降级并写进 `issues`。
 *
 * 版本不符 → 整档作废（`discarded = true`）。v1 没有历史包袱，先按最保守的做法走；
 * 以后真要迁移，就在这里按 `version` 分支，别在字段级修补里硬撑。
 *
 * ⚠️ **「没有存档」不等于「存档坏了」**：首次启动时介质里什么都没有，
 * 这时必须安静地按新档开始 —— 否则每个新玩家一进来就先看到一句「存档读取失败」，
 * 那是把人吓跑的第一印象。（这一条是被浏览器验证抓出来的：原先 `null` 走进了
 * 字段级校验，被报成「存档不是对象」。）
 */
export function parseSave(raw: unknown, fallback: SaveData, limits: SaveLimits, now: number): SaveReadResult {
  const issues: string[] = [];

  const fail = (why: string): SaveReadResult => {
    issues.push(why);
    return { data: fallback, recovered: true, discarded: true, issues };
  };

  // 首次启动：既不是「修复」也不是「作废」，就是没有存档
  if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) {
    return { data: fallback, recovered: false, discarded: false, issues };
  }

  let obj: unknown = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      return fail('存档 JSON 解析失败（内容被截断或改坏）');
    }
  }
  if (!isObj(obj)) return fail('存档不是对象');

  const version = intIn(obj.version, 0, Number.MAX_SAFE_INTEGER);
  if (version === null) return fail('存档缺少版本号');
  if (version !== SAVE_VERSION) {
    return fail(`存档版本 v${version} 与当前 v${SAVE_VERSION} 不兼容`);
  }

  const mode = obj.mode === 'nightmare' ? 'nightmare' : obj.mode === 'normal' ? 'normal' : null;
  if (mode === null) {
    issues.push(`模式非法（${String(obj.mode)}），已按普通模式处理`);
  }

  const rawProgress = isObj(obj.progress) ? obj.progress : {};
  if (!isObj(obj.progress)) issues.push('进度表不是对象，已按新档处理');
  const progress = {} as Record<GameMode, ProgressData>;
  for (const m of GAME_MODES) progress[m] = sanitizeProgress(rawProgress[m], m, limits, issues);

  const meta = sanitizeMeta(obj.meta, limits, now, issues);
  const session = sanitizeSession(obj.session, limits, issues);

  const savedAt = intIn(obj.savedAt, 0, Number.MAX_SAFE_INTEGER) ?? now;

  return {
    data: { version: SAVE_VERSION, savedAt, mode: mode ?? fallback.mode, progress, meta, session },
    recovered: issues.length > 0,
    discarded: false,
    issues,
  };
}

/* ------------------------------------------------------------------ 离线计时（§16） */

/**
 * 恢复后的局内剩余秒数。
 *
 * 口径（§16 新口径）：**已经开始计时**的一局，退出 / 切后台不暂停倒计时 ——
 * 离开多久就扣多久，所以这里无条件扣掉 `now - savedAt`（`savedAt` = 离开时刻）。
 *
 * ⚠️ `started = false` 的一局（进关后还没点棋盘）直接返回原值：它局内本来就不走表
 * （主循环那句 `if (!started || paused || finished) return;`），离线期间自然也不该走 ——
 * 否则玩家一进关还没开始玩，退出去一趟回来就被扣光了。这不是「暂停」，是「计时没启动」。
 *
 * 为什么不做「暂停 + 防滥用」那一套：能暂停就等于给玩家留了一条**离线思考**的通道
 * （截图 → 慢慢想 → 回来接着打），而本版产品的规则是「本关只有一个计时维度，
 * 不存在任何暂停入口」。既然按钮上没有暂停，退出也不能变成那个入口。
 *
 * 扣到 0 就停在 0（不返回负数）：调用方据此判定「本局已经结束」——
 * 见 `web/main.ts` 的 `resumeSession`（启动时时间已走完 → 直接出判定结果）。
 */
export function resumeTimeLeft(session: LevelSession, now: number): number {
  if (!session.started) return session.timeLeft;
  const elapsed = Math.max(0, (now - session.savedAt) / 1000);
  return Math.max(0, Math.floor(session.timeLeft - elapsed));
}
