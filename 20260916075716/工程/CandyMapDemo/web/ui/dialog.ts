/**
 * 通用弹窗（结算 / 失败 / 续命 / 广告 / 确认 共用）。
 *
 * 两个关键设计：
 *   1. **置灰按钮照常可点**：策划案要求「按钮置灰 + 点击给提示文案」（§9.3 / §12.1 / §12.2 / §12.4）。
 *      用原生 `disabled` 会把点击吃掉，玩家点了没反应就以为卡死 —— 所以按钮保持可点，
 *      由 `disabledHint` 决定点下去给哪句 Toast。
 *   2. **按钮按行分组**：线框里按钮是 2×2 + 一条通栏（§12.1.1），
 *      用 `rows` 描述比一维数组更贴近线框。
 */

import { buttonEl, clear, el, haptic, toast } from './dom.ts';

export interface DialogButton {
  label: string;
  /** 主按钮（实心蜜色） */
  primary?: boolean;
  /** 视觉置灰，但仍可点击（点了给 `disabledHint`） */
  dim?: boolean;
  disabledHint?: string;
  onClick?: () => void;
}

/** 荣誉档位（与 `assets/scripts/core/honor.ts` 的 `HonorTier` 对齐，这里只用来上样式） */
export type DialogTier = 'god' | 'king' | 'pass';

/**
 * 荣誉弹窗的「头部」：图标 / 星星 + 档位配色。
 *
 * 图标暂用 emoji 占位（美术出图后换 `<img>`）；优秀档不带图标，改用三颗星
 * （按实际星级点亮），因为「优秀」本来就没有专属图腾（《通关及排名》§五）。
 */
export interface DialogHero {
  tier: DialogTier;
  /** 图标（emoji 占位） */
  icon?: string;
  /** 传了星星就不画图标：1~3 颗，按实际星级点亮 */
  stars?: number;
}

export interface DialogOptions {
  title?: string;
  /** 正文行（自动换行拼接；`pre-line` 由样式负责） */
  lines?: string[];
  /** 荣誉弹窗头部（M9）；不传就是普通弹窗 */
  hero?: DialogHero;
  /** 副文案：图标/标题下方、得分上方 */
  desc?: string;
  /** 大号分数（会从 0 滚上去） */
  score?: number;
  /** 大号分数上方的标签（如「本关得分」） */
  scoreLabel?: string;
  /** 辅助文案：得分下方、按钮区上方 */
  sub?: string;
  /** 按钮按行排布；每行 1~2 个 */
  rows: DialogButton[][];
  /** 关闭后回调（用于「看完广告回到原弹窗」这类恢复动作） */
  onClose?: () => void;
}

let dialogEl: HTMLDivElement | null = null;

function root(): HTMLDivElement {
  if (!dialogEl) dialogEl = document.getElementById('dialog') as HTMLDivElement;
  return dialogEl;
}

export function dialogOpen(): boolean {
  const node = root();
  return !!node && !node.hidden;
}

/** 头部：光环 + 图标 / 三颗星 */
function heroEl(hero: DialogHero): HTMLElement {
  const wrap = el('div', 'dialog-hero');
  // 光环与粒子都是纯 CSS（见 ui.css），这里只给一个钩子节点
  wrap.appendChild(el('div', 'hero-halo'));

  if (hero.stars !== undefined) {
    const row = el('div', 'hero-stars');
    for (let i = 0; i < 3; i++) {
      const star = el('span', i < hero.stars ? 'hero-star lit' : 'hero-star', '⭐');
      // 逐颗点亮（§五「星星图标 1~3 星，按实际星级点亮」）
      star.style.animationDelay = `${0.16 + i * 0.16}s`;
      row.appendChild(star);
    }
    wrap.appendChild(row);
  } else {
    wrap.appendChild(el('div', 'hero-icon', hero.icon ?? ''));
  }
  return wrap;
}

/** 大号分数：从 0 滚到目标值（§五「数字滚动」） */
function scoreEl(score: number, label?: string): HTMLElement {
  const wrap = el('div', 'dialog-score');
  if (label) wrap.appendChild(el('div', 'score-label', label));
  const value = el('div', 'score-value', '0');
  wrap.appendChild(value);
  rollNumber(value, score);
  return wrap;
}

function rollNumber(node: HTMLElement, target: number): void {
  if (typeof requestAnimationFrame !== 'function') {
    node.textContent = String(target);
    return;
  }
  const duration = 620;
  const start = performance.now();
  const step = (now: number): void => {
    const t = Math.min(1, (now - start) / duration);
    // easeOutCubic：先快后慢，停住那一下才有「数字落定」的手感
    const eased = 1 - Math.pow(1 - t, 3);
    node.textContent = String(Math.round(target * eased));
    if (t < 1) requestAnimationFrame(step);
    else node.textContent = String(target);
  };
  requestAnimationFrame(step);
}

export function openDialog(options: DialogOptions): void {
  const node = root();
  const card = el('div', 'dialog-card');
  if (options.hero) card.classList.add('dialog-honor', `honor-${options.hero.tier}`);

  // 顺序按《通关及排名》§五：图标 → 标题 → 副文案 → 本关得分 → 辅助文案 → 按钮区
  if (options.hero) card.appendChild(heroEl(options.hero));
  if (options.title) card.appendChild(el('h2', undefined, options.title));
  if (options.desc) card.appendChild(el('p', 'dialog-desc', options.desc));
  if (options.score !== undefined) card.appendChild(scoreEl(options.score, options.scoreLabel));
  if (options.sub) card.appendChild(el('p', 'dialog-sub', options.sub));

  if (options.lines && options.lines.length > 0) {
    const body = el('p');
    body.textContent = options.lines.join('\n');
    card.appendChild(body);
  }

  for (const row of options.rows) {
    const rowEl = el('div', 'dialog-buttons');
    for (const item of row) {
      const classes = ['dialog-btn'];
      if (item.primary) classes.push('primary');
      if (item.dim) classes.push('dim');
      const btn = buttonEl(item.label, classes.join(' '), () => {
        haptic();
        if (item.dim) {
          if (item.disabledHint) toast(item.disabledHint, 2600);
          return;
        }
        item.onClick?.();
      });
      rowEl.appendChild(btn);
    }
    card.appendChild(rowEl);
  }

  node.replaceChildren(card);
  node.hidden = false;
}

export function closeDialog(): void {
  const node = root();
  node.hidden = true;
  clear(node);
}

/**
 * 是 / 否 确认框（§7.5「放弃挑战？」）。
 * 关闭不算回答：`onAnswer` 只在玩家真的选了一边时才回调。
 */
export function confirmDialog(options: {
  title?: string;
  lines: string[];
  yesLabel: string;
  noLabel: string;
  onAnswer: (yes: boolean) => void;
}): void {
  openDialog({
    title: options.title,
    lines: options.lines,
    rows: [
      [
        { label: options.noLabel, onClick: () => options.onAnswer(false) },
        { label: options.yesLabel, primary: true, onClick: () => options.onAnswer(true) },
      ],
    ],
  });
}
