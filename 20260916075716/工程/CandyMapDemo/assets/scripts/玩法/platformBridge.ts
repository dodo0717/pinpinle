/**
 * 平台接线层 —— 批次⑧（把 `平台/` 那四个模块接进游戏逻辑的**唯一**地方）。
 *
 * ── 为什么要多这一层 ──────────────────────────────────────────────
 * `平台/ads.ts` / `share.ts` / `track.ts` 都是**纯能力模块**：它们知道「能不能播广告」，
 * 但不知道「播完要给谁加体力」；知道「分享被取消了」，但不知道界面上要弹哪句话。
 * 这些「能力 × 玩法」的接线如果散在 `GameBootstrap` / `MapBootstrap` 两个启动器里，
 * 迟早会长成两份略有差异的副本（比如续命记了埋点、加体力忘了记）。
 *
 * 所以这里只做三件事，别的都不做：
 *   1. 持有三个平台实例（懒建一次），并把「轻提示」注入进去；
 *   2. 把「播广告 / 分享 / 埋点」收成**一眼能看懂的一个函数调用**；
 *   3. **所有平台调用一律不抛**：没有 `wx`、没有后端、没有剪贴板时，
 *      返回值照给（降级结果），调用方按返回值走它自己的降级分支。
 *
 * ── 降级口径（硬性）────────────────────────────────────────────────
 * 预览 shim 与浏览器里**没有 `wx`**：广告走「Web 模拟分支」（直接 `watched`），
 * 分享走「复制链接」或 `unavailable`，埋点因为没有端点只进本地缓冲。
 * 三条路径都必须能在没有宿主能力时跑完，且不产生异常 —— 这是本层唯一不能让步的约束。
 */

import { createAds, type AdDenyReason, type AdOutcome, type AdPlacement, type AdRunner } from '../平台/ads';
import { createShare, type ShareCard, type ShareOutcome, type Sharer } from '../平台/share';
import { createTracker, DEFAULT_ENDPOINT, EVENT, type Tracker } from '../平台/track';
import { AD_DENY, ADS } from './text';

/** 轻提示回调（Cocos 端就是 `玩法/toast.ts` 的 `show`） */
export type PlatformToast = (msg: string) => void;

let toastHook: PlatformToast | null = null;

/**
 * 注入「怎么提示」。由**调用方在每次动作前**注入一次 —— 地图与对局各有自己的 Toast 节点，
 * 常驻一个全局引用会出现「在地图里加体力，提示却发给了已经隐藏的对局层」。
 */
export function setPlatformToast(fn: PlatformToast | null): void {
  toastHook = fn;
}

function toast(msg: string): void {
  try {
    toastHook?.(msg);
  } catch {
    /* 提示不出来不该影响玩法 */
  }
}

let adInst: AdRunner | null = null;
let shareInst: Sharer | null = null;
let trackInst: Tracker | null = null;

/** 广告实例（懒建一次） */
export function adRunner(): AdRunner {
  if (!adInst) adInst = createAds({ hooks: { toast } });
  return adInst;
}

/** 分享实例（懒建一次；`hooks.toast` 供「复制链接」那条降级分支给反馈） */
export function sharer(): Sharer {
  if (!shareInst) shareInst = createShare({ hooks: { toast } });
  return shareInst;
}

/**
 * 埋点实例（懒建一次）。
 *
 * ⚠️ 存储**故意不接**宿主的持久化：埋点缓冲写进存档介质会跟存档抢配额，
 * 而它在 Creator 模拟器 / 预览页里本来也活不过进程。落盘时机等后端端点定了再一起定。
 */
export function tracker(): Tracker {
  if (!trackInst) trackInst = createTracker({ endpoint: DEFAULT_ENDPOINT });
  return trackInst;
}

/** 建身份 + 发 `first_open` / `session_start`；幂等，重复调用无副作用 */
export function startTracking(): void {
  try {
    tracker().start();
  } catch {
    /* 埋点绝不能影响游戏 */
  }
}

/** 立刻尝试上报（切后台时调用；没有端点时只是把缓冲整理一遍） */
export function flushTracking(): void {
  try {
    void tracker().flush();
  } catch {
    /* 同上 */
  }
}

/* ------------------------------------------------------------------ 广告 */

/** 广告被拦的原因 → 界面文案（查表，查不到就退回通用文案） */
export function adDenyText(reason?: AdDenyReason): string {
  if (!reason) return ADS.notReady;
  return AD_DENY[reason] ?? ADS.notReady;
}

/**
 * 播一条广告并记埋点（`ad_show` + `ad_finish`）。
 *
 * 调用方**只看 `outcome.result === 'watched'` 才发奖励** —— 与 `平台/ads.ts` 同口径。
 * 被拦下来时 `outcome.reason` 有值，配 `adDenyText()` 就是一句能用的提示。
 *
 * @param placement `'revive'` 续命 / `'stamina'` 加体力（`offline` 尚未开放）
 */
export async function playAd(placement: AdPlacement): Promise<AdOutcome> {
  const runner = adRunner();
  tracker().track(EVENT.adShow, { placement, port: runner.kind() });
  let outcome: AdOutcome;
  try {
    outcome = await runner.play(placement);
  } catch {
    // 平台层自己已经包过一层，这里是最后一道：就算真炸了也要给调用方一个可判的结果
    outcome = { result: 'failed', port: runner.kind(), reason: 'unavailable' };
  }
  tracker().track(EVENT.adFinish, {
    placement,
    port: outcome.port,
    result: outcome.result,
    reason: outcome.reason ?? '',
  });
  return outcome;
}

/* ------------------------------------------------------------------ 分享 */

/**
 * 分享一张卡片并记埋点。
 *
 * ⚠️ 与 `平台/share.ts` 同口径：`ok === true` 只代表「拉起了转发并确认」，
 * **不能**当成「真的发给别人了」—— 那条只有服务端收到 `query` 才敢确认。
 */
export async function shareCard(card: ShareCard): Promise<ShareOutcome> {
  const s = sharer();
  let outcome: ShareOutcome;
  try {
    outcome = await s.shareCard(card);
  } catch {
    outcome = { ok: false, port: s.kind(), reason: 'error' };
  }
  tracker().track(EVENT.share, { port: outcome.port, reason: outcome.reason, ok: outcome.ok });
  return outcome;
}

/** 注册「右上角菜单 → 转发」的默认卡片；宿主没有这个入口时返回 false（界面要认这个分支） */
export function setMenuShare(builder: () => ShareCard): boolean {
  try {
    return sharer().setMenuShare(builder);
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ 埋点（关卡漏斗） */

export interface LevelStartProps {
  level: number;
  mode: string;
  /** 本关第几次尝试（同一次打开里累计；通关后归零） */
  attempt: number;
}

export interface LevelEndProps {
  level: number;
  mode: string;
  score: number;
  stars: number;
  /** 这一局有没有看过续命广告 */
  revived: boolean;
  /** 从开局到结算的秒数 */
  durationSec: number;
}

export interface LevelFailProps {
  level: number;
  mode: string;
  score: number;
}

export function reportLevelStart(p: LevelStartProps): void {
  tracker().track(EVENT.levelStart, { level: p.level, mode: p.mode, attempt: p.attempt });
}

export function reportLevelEnd(p: LevelEndProps): void {
  tracker().track(EVENT.levelEnd, {
    level: p.level,
    mode: p.mode,
    score: p.score,
    stars: p.stars,
    revived: p.revived,
    durationSec: p.durationSec,
  });
}

/** 确认失败才记（弹续命弹窗不算失败 —— 见 `平台/track.ts` 的 `EVENT.levelFail` 注释） */
export function reportLevelFail(p: LevelFailProps): void {
  tracker().track(EVENT.levelFail, { level: p.level, mode: p.mode, score: p.score });
}

/* ------------------------------------------------------------------ 测试 */

/** 清掉三个平台实例与提示钩子（单测要能来回切宿主） */
export function resetPlatformBridge(): void {
  adInst = null;
  shareInst = null;
  trackInst = null;
  toastHook = null;
}
