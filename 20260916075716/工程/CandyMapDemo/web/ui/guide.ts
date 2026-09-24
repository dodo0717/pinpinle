/**
 * 新手引导（§14 五步）。
 *
 * 引导是**事件驱动**的，不是线性播放：每一步由玩法事件触发（首次进入第 1 关 / 交换 2 次未消除 /
 * 首次消除 / 首次掉落 / 首次通关），所以这里只提供「显示某一步」，触发时机由 main.ts 决定。
 *
 * 每步只出现一次（`shown` 集合）；文案来自 `text.ts` 的 `GUIDE`。
 */

import { GUIDE } from './text.ts';
import { buttonEl, el } from './dom.ts';

export type GuideStep = 'swap' | 'hint4' | 'eliminate' | 'refill' | 'clear';

/** 五步引导的固定顺序（存档只存「走完没有」，恢复时按这个顺序整批标记） */
export const GUIDE_STEPS: readonly GuideStep[] = ['swap', 'hint4', 'eliminate', 'refill', 'clear'];

export interface Guide {
  el: HTMLElement;
  /** 显示某一步（重复调用只第一次生效，除非 `resetDone()`） */
  show: (step: GuideStep) => void;
  /** 隐藏（关卡切换时调用） */
  hide: () => void;
  /** 是否正在显示 —— 调用方用它把两条引导排成串行，避免文案叠在一起 */
  isVisible: () => boolean;
  /** 重看引导（设置里的调试入口用；正式版会删掉） */
  resetDone: () => void;
  /** 某一步是否已经展示过 */
  isDone: (step: GuideStep) => boolean;
  /**
   * 从存档恢复「已展示过的步骤」（M6）。
   *
   * 「每步只出现一次」如果只活在内存里，玩家每次刷新都会被重新教一遍 ——
   * 所以这个状态必须能落盘、也必须能装回来。
   */
  markShown: (steps: readonly GuideStep[]) => void;
}

/** 气泡自动消失时间：够看清一句话，又不至于挡着操作 */
const AUTO_HIDE_MS = 4500;

export function createGuide(): Guide {
  const root = el('div', 'guide');
  root.hidden = true;
  const text = el('div', 'guide-text');
  const btn = buttonEl('知道了', 'guide-btn', () => hide());
  root.appendChild(text);
  root.appendChild(btn);

  const shown = new Set<GuideStep>();
  let hideTimer = 0;

  function hide(): void {
    root.hidden = true;
    window.clearTimeout(hideTimer);
  }

  const show = (step: GuideStep): void => {
    if (shown.has(step)) return;
    shown.add(step);
    text.textContent = GUIDE[step] ?? '';
    root.hidden = false;
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(hide, AUTO_HIDE_MS);
  };

  return {
    el: root,
    show,
    hide,
    isVisible: () => !root.hidden,
    resetDone: () => {
      shown.clear();
      hide();
    },
    isDone: (step) => shown.has(step),
    markShown: (steps) => {
      for (const step of steps) shown.add(step);
      hide();
    },
  };
}
