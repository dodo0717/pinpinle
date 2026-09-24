/**
 * 全局游戏状态 —— 对应 web/main.ts 里那一批模块级变量。
 *
 * 为什么必须有个全局持有者：地图场景和关卡场景**都要读写同一份**体力、进度、
 * 元系统。靠场景之间传引用，一旦出现「地图 → 关卡 → 地图」的往返就会有两份状态，
 * 然后就是「打完一关体力没扣」这种经典 bug。原版是单页应用所以直接用模块变量，
 * 这里用单例模块保持同一口径。
 *
 * ⚠️ 这里只管**内存镜像**；落盘时机由调用方决定（`flush()` / `markDirty()`）。
 */

import {
  parseSave,
  createSaveData,
  SAVE_DEBOUNCE_MS,
  SAVE_VERSION,
  type SaveData,
  type LevelSession,
  type SaveLimits,
  type SaveReadResult,
} from '../核心/save';
import {
  TOTAL_LEVELS,
  TIME_LIMIT,
  STAMINA_MAX,
  preDeductStamina,
  confirmStamina,
  refundStamina,
  type GameMode,
  type ProgressData,
  type Stamina,
} from '../核心/index';
import { SaveManager } from './saveManager';
import { removeSave } from './storage';
import {
  AD_STAMINA_DAILY_MAX,
  createMeta,
  rollOverDay,
  tickMeta,
  armRecovery,
  addStamina,
  staminaCountdown,
  adStaminaLeft,
  recordAdStamina,
  type MetaState,
} from './meta';

/** 存档字段的合法区间（由 core 给真值，避免这里再抄一份策划案数字） */
export const SAVE_LIMITS: SaveLimits = {
  totalLevels: TOTAL_LEVELS,
  staminaMax: STAMINA_MAX,
  timeLimit: TIME_LIMIT,
  adStaminaDailyMax: AD_STAMINA_DAILY_MAX,
};

/** 元系统有变化时的订阅（地图顶栏据此刷新体力/倒计时） */
type MetaListener = () => void;

class GameState {
  /** 内存中的完整存档镜像 */
  data: SaveData = createSaveData('normal', Date.now());
  /** 元系统（体力/广告/设置/引导）—— 与 `data.meta` 同源，这里是可变对象 */
  meta: MetaState = createMeta(Date.now());
  save: SaveManager = null!;

  private listeners: MetaListener[] = [];
  /** 读档结果，启动后由界面播报一次 */
  readResult: SaveReadResult | null = null;
  /**
   * 现在允许落盘吗？由关卡层注入（动画播放中不写）。
   *
   * 默认恒真：地图场景没有「事务」概念，不能被关卡层的 `busy` 卡住。
   */
  canWrite: () => boolean = () => true;

  init(): void {
    this.save = new SaveManager({
      snapshot: () => this.snapshot(),
      canWrite: () => this.canWrite(),
      onWriteError: (m: string) => console.warn('[save] ' + m),
    });
    this.load();
  }

  /* ------------------------------------------------------------ 读档 / 落盘 */

  /** 读档；坏档按字段降级，界面拿 `readResult` 播报（原版 loadSaveAtStartup） */
  load(): SaveReadResult {
    const now = Date.now();
    const fresh = createSaveData('normal', now);
    const result = parseSave(this.save.read(), fresh, SAVE_LIMITS, now);
    this.data = result.data;
    this.meta = metaFromSnapshot(this.data, now);
    this.readResult = result;
    // 悬空的预扣体力只能在读档这一刻退还：此时没有任何「局内」上下文，
    // 再往后就无法区分「正在进关」和「上次进关时崩了」
    this.refundStamina();
    return result;
  }

  /** 立刻落盘（事务结束点 / 切后台 / 关弹窗时调用） */
  flush(): void {
    this.syncMeta();
    this.save.flush();
  }

  markDirty(): void {
    this.syncMeta();
    this.save.markDirty();
  }

  private snapshot(): SaveData {
    this.syncMeta();
    return this.data;
  }

  /** 把 meta 的最新值写回存档镜像（落盘前的唯一同步点） */
  private syncMeta(): void {
    this.data.meta = {
      stamina: { ...this.meta.stamina },
      nextRecoverAt: this.meta.nextRecoverAt,
      adDay: this.meta.adDay,
      adStaminaUsed: this.meta.adStaminaUsed,
      settings: { ...this.meta.settings },
      guideDone: this.meta.guideDone,
    };
    this.data.savedAt = Date.now();
  }

  /* ------------------------------------------------------------ 模式与进度 */

  get mode(): GameMode { return this.data.mode; }

  setMode(mode: GameMode): void {
    if (this.data.mode === mode) return;
    this.data.mode = mode;
    this.markDirty();
  }

  /** 当前模式的进度（两套进度分别存，切模式不丢） */
  get progress(): ProgressData { return this.data.progress[this.mode]; }

  setProgress(next: ProgressData): void {
    this.data.progress[this.mode] = next;
    this.markDirty();
  }

  /* ------------------------------------------------------------ 体力（§12.4 三态） */

  get stamina(): Stamina { return this.meta.stamina; }

  /** 进关预扣；失败时返回原因，界面按原因给不同文案 */
  preDeduct(): { ok: true } | { ok: false; reason: 'exhausted' | 'already-pending' } {
    const r = preDeductStamina(this.meta.stamina);
    if (!r.ok) return r;
    this.meta.stamina = r.state;
    armRecovery(this.meta, Date.now());
    this.markDirty();
    this.notify();
    return { ok: true };
  }

  /** 渲染完成 → 正式扣除（这颗不再退还） */
  confirmStamina(): void {
    this.meta.stamina = confirmStamina(this.meta.stamina);
    this.markDirty();
    this.notify();
  }

  /** 中途退出 / 加载超时 → 退还 */
  refundStamina(): void {
    if (this.meta.stamina.pending <= 0) return;
    this.meta.stamina = refundStamina(this.meta.stamina);
    this.markDirty();
    this.notify();
  }

  /** 加体力（广告 / 开发工具）；满格返回 false */
  gainStamina(count = 1): boolean {
    const ok = addStamina(this.meta, Date.now(), count);
    if (ok) { this.markDirty(); this.notify(); }
    return ok;
  }

  get staminaMax(): number { return STAMINA_MAX; }
  get adStaminaLeft(): number { return adStaminaLeft(this.meta, Date.now()); }
  recordAd(): void { recordAdStamina(this.meta); this.markDirty(); }
  countdownText(): string | null { return staminaCountdown(this.meta, Date.now()); }

  /* ------------------------------------------------------------ 元系统心跳 */

  /**
   * 每秒一次：跨天重置 + 体力按时间戳恢复。
   * 返回是否发生变化，调用方据此决定是否重绘（原版 main() 的两个 setInterval 合并到这里）。
   */
  tick(): boolean {
    const now = Date.now();
    const dayChanged = rollOverDay(this.meta, now);
    const recovered = tickMeta(this.meta, now);
    if (dayChanged || recovered) { this.markDirty(); this.notify(); }
    return dayChanged || recovered;
  }

  onMetaChange(fn: MetaListener): void { this.listeners.push(fn); }
  offMetaChange(fn: MetaListener): void {
    const i = this.listeners.indexOf(fn);
    if (i >= 0) this.listeners.splice(i, 1);
  }
  private notify(): void {
    for (const fn of this.listeners) fn();
  }

  /* ------------------------------------------------------------ 局内断点（§16） */

  get session(): LevelSession | null { return this.data.session; }

  setSession(s: LevelSession | null): void {
    this.data.session = s;
    this.markDirty();
  }

  /** 断点里的关卡在不在当前可玩范围（素材没补齐时该关可能排不进来） */
  hasResumableSession(): boolean {
    const s = this.data.session;
    return s !== null && s.level >= 1 && s.level <= TOTAL_LEVELS;
  }

  /* ------------------------------------------------------------ 设置 / 引导 */

  setSound(on: boolean): void { this.meta.settings.sound = on; this.markDirty(); }
  setBgm(on: boolean): void { this.meta.settings.bgm = on; this.markDirty(); }
  get guideDone(): boolean { return this.meta.guideDone; }
  finishGuide(): void { this.meta.guideDone = true; this.markDirty(); }

  /** 重置存档（设置页入口） */
  reset(): void {
    const now = Date.now();
    removeSave();
    this.data = createSaveData('normal', now);
    this.meta = createMeta(now);
    this.flush();
    this.notify();
  }
}

/** 存档里的 meta 快照 → 可变的 MetaState */
function metaFromSnapshot(data: SaveData, now: number): MetaState {
  const m = data.meta;
  const base = createMeta(now);
  return {
    stamina: { available: m?.stamina?.available ?? base.stamina.available, pending: m?.stamina?.pending ?? 0 },
    nextRecoverAt: m?.nextRecoverAt ?? null,
    adDay: m?.adDay ?? base.adDay,
    adStaminaUsed: m?.adStaminaUsed ?? 0,
    settings: m?.settings ?? base.settings,
    guideDone: m?.guideDone ?? false,
  };
}

/** 全局单例 */
export const GS = new GameState();

export { SAVE_VERSION, SAVE_DEBOUNCE_MS };
export type { SaveData, LevelSession };
