/**
 * 滑动演示动画（2026-10-26 新增，序章 v3 核心）
 *
 * 用户要求："不要用文字教学，要强制教用户拖动，只有拖动这碎片可以操作，**动画模拟滑动**"。
 * 这个组件就是那句"动画模拟滑动"：
 *
 *   手指落在目标块上（按下态）→ 沿直线滑到缺口 → 落位时金光一闪（4 块拼合的预演）
 *   → 淡出复位 → 循环（1.6s / 次）
 *
 * ⚠️ **玩家一按就停**：`stop()` 由 `onPointerDown` 调，动画不再打扰操作。
 * ⚠️ 定位用 `offsetLeft/offsetTop`（**boardEl 内的设计像素坐标**）：手指挂在 boardEl 里，
 *   与格子同一坐标系，不受 `#stage` 的 `transform: scale()` 影响。
 */

import { el } from './dom.ts';

export interface HandHint {
  el: HTMLElement;
  /** 挂到棋盘并开始循环演示；`fromCell` = 要拖的那块，`toCell` = 缺口 */
  play: (fromCell: HTMLElement, toCell: HTMLElement) => void;
  /** 停止并从 DOM 移除（玩家上手 / 教学步完成） */
  stop: () => void;
  isPlaying: () => boolean;
}

/** 演示一次的完整时长（ms），与 CSS 的 `tut-slide` 周期保持一致 */
export const HAND_HINT_MS = 1600;

export function createHandHint(): HandHint {
  const root = el('div', 'tut-hint');
  root.hidden = true;

  // 手指：白色圆头 + 描边，纯 CSS 画，不用新素材
  const hand = el('div', 'tut-hand');
  hand.appendChild(el('span', 'tut-hand-tip', '👆'));
  root.appendChild(hand);

  // 缺口处的拼合金光（滑动到位时闪一下，预演"拼成了"）
  const flash = el('div', 'tut-flash');
  root.appendChild(flash);

  let playing = false;

  function stop(): void {
    playing = false;
    root.classList.remove('on');
    root.hidden = true;
    if (root.parentNode) root.parentNode.removeChild(root);
  }

  function play(fromCell: HTMLElement, toCell: HTMLElement): void {
    const board = fromCell.offsetParent as HTMLElement | null;
    if (!board) return;
    board.appendChild(root);

    // 目标块与缺口的中心（设计像素，相对 boardEl）
    const fx = fromCell.offsetLeft + fromCell.offsetWidth / 2;
    const fy = fromCell.offsetTop + fromCell.offsetHeight / 2;
    const tx = toCell.offsetLeft + toCell.offsetWidth / 2;
    const ty = toCell.offsetTop + toCell.offsetHeight / 2;

    root.style.left = `${fx}px`;
    root.style.top = `${fy}px`;
    root.style.setProperty('--tx', `${tx - fx}px`);
    root.style.setProperty('--ty', `${ty - fy}px`);

    // 金光固定在缺口中心（不跟着手指走）
    flash.style.left = `${tx - fx}px`;
    flash.style.top = `${ty - fy}px`;

    playing = true;
    root.hidden = false;
    void root.offsetWidth; // 强制 reflow，保证动画从头播
    root.classList.add('on');
  }

  return { el: root, play, stop, isPlaying: () => playing };
}
