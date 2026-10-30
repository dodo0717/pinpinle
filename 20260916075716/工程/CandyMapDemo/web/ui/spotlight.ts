/**
 * 聚光灯 Spotlight（2026-10-26 新增，序章 v3）
 *
 * 用途：讲「目标旗 / 倒计时」这类 HUD 元素时，**把玩家视线强制拉过去** ——
 * 全屏压暗、只挖一个洞留那个元素亮着，玩家点一下才继续。
 *
 * ⚠️ **零文字**：v3 起不再配任何说明气泡（用户要求"不要文字教学"），
 *   靠「元素自己动」说话：旗子数字跳变、倒计时真的走 3 秒。只留一个「▾ 继续」箭头。
 *
 * ⚠️ 为什么挂 `document.body` 而不是 `#stage`：`#stage` 有 `transform: scale()`，
 *   挂在里面就得把 `getBoundingClientRect()` 的屏幕坐标换算回设计像素；挂 body 用
 *   `position: fixed` + 视口坐标，**零换算**，而且永远在最上层。
 */

import { el } from './dom.ts';

export interface SpotlightOptions {
  /** 洞相对元素的四周留白（px，设计像素） */
  pad?: number;
  /**
   * **简短文本**（≤16 字，与语音同一句）。
   * v3 一度把说明气泡删成零文字；v4 按用户要求加回来 —— 一行短语，不挡棋盘。
   */
  tip?: string;
  /** 点「继续」/点洞内时回调（不传 = 只能等自动关闭） */
  onNext?: () => void;
}

export interface Spotlight {
  el: HTMLElement;
  /** 挖洞圈住某个元素（传元素或选择器） */
  show: (target: HTMLElement | string, opts?: SpotlightOptions) => void;
  hide: () => void;
  isOpen: () => boolean;
}

/** 挖洞内边距默认值：刚好露出元素再留一圈，手指点得到 */
const DEFAULT_PAD = 14;

export function createSpotlight(): Spotlight {
  const root = el('div', 'spot');
  root.hidden = true;

  // 挖洞层：比目标外扩一圈，四周用超大 box-shadow 压暗
  const hole = el('div', 'spot-hole');
  root.appendChild(hole);

  // 简短文本气泡（v4：与语音同一句，贴在洞旁边，自动上/下避让）
  const tip = el('div', 'spot-tip');
  root.appendChild(tip);

  // 「▾ 继续」箭头
  const next = el('button', 'spot-next', '▾');
  next.type = 'button';
  next.title = '继续';
  root.appendChild(next);

  let onNextCb: (() => void) | null = null;
  let open = false;

  function hide(): void {
    open = false;
    onNextCb = null;
    root.classList.remove('on');
    window.setTimeout(() => {
      if (!open) root.hidden = true;
    }, 220);
  }

  // 点洞内 / 点箭头 = 继续；**点暗区不关闭**（防止误触跳过强制观看）
  hole.addEventListener('click', () => {
    if (!open) return;
    const cb = onNextCb;
    hide();
    cb?.();
  });
  next.addEventListener('click', (event) => {
    event.stopPropagation();
    if (!open) return;
    const cb = onNextCb;
    hide();
    cb?.();
  });

  function show(target: HTMLElement | string, opts: SpotlightOptions = {}): void {
    const node = typeof target === 'string' ? document.querySelector<HTMLElement>(target) : target;
    if (!node) return; // 目标不存在就干脆不挡路（教学不该因为缺元素而卡死）
    const rect = node.getBoundingClientRect();
    const pad = opts.pad ?? DEFAULT_PAD;

    hole.style.left = `${rect.left - pad}px`;
    hole.style.top = `${rect.top - pad}px`;
    hole.style.width = `${rect.width + pad * 2}px`;
    hole.style.height = `${rect.height + pad * 2}px`;

    // 气泡默认放洞下方；洞太靠下（或屏幕下半部）就翻到洞上方
    const below = rect.bottom + 24;
    const flip = below > window.innerHeight - 150;
    if (opts.tip) {
      tip.textContent = opts.tip;
      tip.hidden = false;
      tip.classList.toggle('up', flip);
      // 水平夹在屏内：气泡靠边时不再往外顶
      const w = Math.min(360, window.innerWidth - 32);
      tip.style.width = `${w}px`;
      tip.style.left = `${Math.min(Math.max(16, rect.left + rect.width / 2 - w / 2), window.innerWidth - w - 16)}px`;
      tip.style.top = flip ? `${Math.max(70, rect.top - 104)}px` : `${rect.bottom + 96}px`;
    } else {
      tip.hidden = true;
    }

    next.style.left = `${rect.left + rect.width / 2}px`;
    next.style.top = flip ? `${Math.max(12, rect.top - 96)}px` : `${below}px`;
    next.classList.toggle('up', flip);

    onNextCb = opts.onNext ?? null;
    open = true;
    root.hidden = false;
    void root.offsetWidth; // 强制 reflow，保证 transition 生效
    root.classList.add('on');
  }

  return { el: root, show, hide, isOpen: () => open };
}
