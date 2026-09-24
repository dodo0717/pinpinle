/**
 * 新增界面（M5 元系统）共用的 DOM 小工具与纯展示函数。
 *
 * 为什么单独成模块：`web/main.ts` 是玩法控制器，界面模块只依赖这里，
 * **不反向 import main.ts**，避免循环依赖（dev-server 不做打包，循环导入会拿到半初始化的模块）。
 */

/** 碎片图目录（与 main.ts 保持一致，只此一处定义） */
export const STICKER_DIR = '/art/stickers';

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function clear(node: HTMLElement): void {
  node.replaceChildren();
}

export function buttonEl(
  label: string,
  className: string,
  onClick: () => void,
): HTMLButtonElement {
  const btn = el('button', className, label);
  btn.type = 'button';
  btn.addEventListener('click', onClick);
  return btn;
}

/** 秒 → `MM:SS`（用于倒计时与「下颗体力」） */
export function fmtMMSS(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * 体力心形串（§11.1 / §11.2）：❤️ 已拥有、🤍 空位，共 `max` 格。
 *
 * ⚠️ §11.1 明确用 🤍 表示空位（不是 🖤）—— 与「已拥有」的对比要够明显。
 */
export function heartRow(available: number, max: number): string {
  const owned = Math.max(0, Math.min(max, available));
  return '❤️'.repeat(owned) + '🤍'.repeat(max - owned);
}

/** 星级符号（0~3） */
export function starText(stars: number): string {
  const n = Math.max(0, Math.min(3, stars));
  return '★'.repeat(n) + '☆'.repeat(3 - n);
}

export function stickerURL(imageId: number): string {
  return `${STICKER_DIR}/sticker_${imageId}.png`;
}

/**
 * 全局 Toast（唯一的提示出口）。
 *
 * ⚠️ 「置灰按钮 + 提示文案」是策划案里大量使用的交互（§9.3 / §12.1 / §12.2 / §12.4），
 * 所以置灰不许用 `disabled` 把点击吃掉 —— 那样玩家点下去毫无反应。
 * 统一走 `disabledHint`：按钮照常可点，点了给一句 Toast。
 */
/**
 * 轻触反馈（《通关及排名》§五「触觉反馈：按钮按下轻微震动」）。
 *
 * 不是所有环境都有 `navigator.vibrate`（iOS Safari 没有），没有就静默跳过 ——
 * 震动是锦上添花，绝不能让「按了没反应」变成报错。
 */
export function haptic(ms = 12): void {
  if (typeof navigator === 'undefined') return;
  const nav = navigator as Navigator & { vibrate?: (pattern: number | number[]) => boolean };
  if (typeof nav.vibrate === 'function') nav.vibrate(ms);
}

let toastHandle = 0;
export function toast(message: string, ms = 2200): void {
  const node = document.getElementById('toast');
  if (!node) return;
  node.textContent = message;
  node.classList.add('show');
  window.clearTimeout(toastHandle);
  toastHandle = window.setTimeout(() => node.classList.remove('show'), ms);
}
