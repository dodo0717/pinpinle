/**
 * 屏幕安全区（2026-11-04，全面屏适配）—— 换算成**设计像素**（宽 1080 那套坐标）。
 *
 * 相机按宽 1080 适配后，比 9:16 更窄长的手机上下会多出一截。要让首页 / 对局页铺满整屏，
 * 贴顶的元素得让开刘海（状态栏）和右上角的胶囊按钮，贴底的元素得让开系统手势条。
 * 做法参考小游戏线 10-24 的 `MapBootstrap`（那边真机验证过）。
 *
 * ⚠️ 只在小游戏宿主有值；Web / 预览 / 单测里返回全 0（调用方按原设计边距排）。
 */

import { pickHostApi } from './host';

interface HostRect { top?: number; bottom?: number }
interface HostWindowInfo {
  windowWidth?: number;
  windowHeight?: number;
  statusBarHeight?: number;
  safeArea?: HostRect;
}
interface HostScreenApi {
  getWindowInfo?: () => HostWindowInfo;
  getSystemInfoSync?: () => HostWindowInfo;
  getMenuButtonBoundingClientRect?: () => HostRect;
}

export interface ScreenInsets {
  /** 状态栏 / 刘海底边离屏幕顶的距离 */
  safeTop: number;
  /** 右上角胶囊按钮底边离屏幕顶的距离（拿不到时按状态栏估算） */
  capsuleBottom: number;
  /** 系统手势条（底部安全区）的高度 */
  safeBottom: number;
}

const ZERO: ScreenInsets = { safeTop: 0, capsuleBottom: 0, safeBottom: 0 };

function num(v: unknown, d = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : d;
}

/**
 * @param stageH 当前实际可见的设计高度（`uiPaint.stageHeight()`）；用它换算「宿主逻辑像素 → 设计像素」
 */
export function screenInsets(stageH: number): ScreenInsets {
  const api = pickHostApi<HostScreenApi>('wx');
  if (!api) return ZERO;
  let info: HostWindowInfo | null = null;
  try {
    if (typeof api.getWindowInfo === 'function') info = api.getWindowInfo();
    else if (typeof api.getSystemInfoSync === 'function') info = api.getSystemInfoSync();
  } catch {
    info = null;
  }
  const winH = num(info?.windowHeight);
  if (!info || winH <= 0) return ZERO;
  // 设计像素 / 宿主逻辑像素：可见设计高度对应整个窗口高度
  const k = stageH / winH;

  const statusBar = num(info.statusBarHeight);
  const safeTop = Math.max(num(info.safeArea?.top), statusBar) * k;
  const safeBottomRaw = num(info.safeArea?.bottom);
  const safeBottom = safeBottomRaw > 0 ? Math.max(0, winH - safeBottomRaw) * k : 0;

  let capsuleBottom = 0;
  try {
    if (typeof api.getMenuButtonBoundingClientRect === 'function') {
      capsuleBottom = num(api.getMenuButtonBoundingClientRect()?.bottom) * k;
    }
  } catch {
    capsuleBottom = 0;
  }
  // 拿不到胶囊位置：胶囊高约 32 + 上下间隙，按状态栏往下估
  if (capsuleBottom <= 0 && statusBar > 0) capsuleBottom = (statusBar + 40) * k;
  // 小游戏线 10-24 实测：开发者工具里胶囊接口报的位置比实际绘制偏上，统一至少让到安全区下 118
  capsuleBottom = Math.max(capsuleBottom, safeTop + 118);

  return { safeTop, capsuleBottom, safeBottom };
}

/** 贴顶元素的上边距：让开刘海和胶囊（原设计 `base`；无宿主时就是 base） */
export function topEdge(ins: ScreenInsets, base: number): number {
  if (ins.capsuleBottom <= 0 && ins.safeTop <= 0) return base;
  return Math.max(base + ins.safeTop, ins.capsuleBottom + 8);
}

/**
 * 贴底元素的下边距：让开手势条，但封顶 base + 44 ——
 * 有的设备会报出离谱的安全区（小游戏线见过 ~146），全额让位会把底栏顶进关卡珠。
 */
export function bottomEdge(ins: ScreenInsets, base: number): number {
  return Math.min(base + 44, Math.max(base, base + ins.safeBottom));
}
