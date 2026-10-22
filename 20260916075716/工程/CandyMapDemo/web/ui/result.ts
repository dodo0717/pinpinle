/**
 * 结算弹窗（胜利 / 失败）：点关卡倒计时归零后，一块带麻绳的牌子从屏幕上方「吊下来」，
 * 与 PLAY 关卡详情弹窗**共用同一套骨架**（`.lp-drop` / `.lp-rope` / `.lp-card` / `.lp-spacer`），
 * 因此尺寸（宽 820、整屏垂直居中、绳子另算）和 PLAY 完全一致。
 *
 * 和 PLAY 的区别：结算是「一局结束」的终态，原本刻意**没有关闭按钮**——
 * 玩家必须选一个按钮（下一关 / 再战 / 主页 / 看广告）才能离开，避免误关丢进度。
 * 现右上角加了 `✕` 关闭键（`.lp-close`，与 PLAY 同款），点它 = 隐藏吊牌并**返回主页**，
 * 作为统一的逃生口（由 `onHome` 回调注入，main 里传 `exitToHome`）。
 *
 * 内容（按设计图《胜利弹窗UI》《失败弹窗UI》）：
 *   - 顶部英雄图标：胜利=奖杯/皇冠（随荣誉档位），失败=灯泡；优秀档用三颗星点亮
 *   - 主标题（金色描边）
 *   - 副文案（如「超越了 X% 的玩家」）
 *   - 得分卡：本关得分 + 大号滚动数字 + 辅助文案
 *   - 按钮行（绿=主、灰=次，沿用 dialog 的「置灰仍可点+提示」语义）
 *
 * 数据来自 main 传入的 `DialogButton[][]`（与通用弹窗同口径），所以体力扣费、
 * 续命广告、排行榜返回等行为原样保留，只换了外衣。
 */

import { buttonEl, clear, el, haptic, toast } from './dom.ts';
import type { DialogButton } from './dialog.ts';

export interface ResultOptions {
  /** 胜利 / 失败：仅用于可能的差异样式 */
  mode: 'win' | 'lose';
  /** emoji 占位图标（🏆 / 👑 / 💡），美术出图后换 `<img>` */
  icon?: string;
  /** 传了就画三颗星（1~3 颗点亮），优先于 `icon`（优秀档用） */
  stars?: number;
  title: string;
  /** 图标/标题下方、得分上方的副文案（如「您的分数超越了 X% 的玩家」） */
  sub?: string;
  /** 得分卡上的标签，默认「本关得分」 */
  scoreLabel?: string;
  /** 本关得分（从 0 滚上去） */
  score: number;
  /** 得分下方的辅助文案 */
  hint?: string;
  /** 更次要的提示行（如「还差 X 组」），可空 */
  note?: string;
  /** 按钮按行排布，与通用弹窗一致 */
  rows: DialogButton[][];
  /** 右上角 ❌ 关闭键的行为：默认「返回主页」(与「主页」按钮等效)，避免误关丢进度之外也给个逃生口 */
  onHome?: () => void;
}

export interface ResultPopup {
  el: HTMLElement;
  show: (opts: ResultOptions) => void;
  hide: () => void;
  readonly open: boolean;
}

export function createResultPopup(): ResultPopup {
  const root = el('div', 'result-preview');

  // 复用 PLAY 的吊牌骨架：麻绳 + 牌子 + 底部占位，整屏垂直居中
  const drop = el('div', 'lp-drop');
  drop.appendChild(el('div', 'lp-rope'));
  const card = el('div', 'lp-card');
  drop.appendChild(card);
  drop.appendChild(el('div', 'lp-spacer'));
  root.appendChild(drop);

  let open = false;

  function hide(): void {
    if (!open) return;
    open = false;
    root.classList.remove('on');
  }

  function show(opts: ResultOptions): void {
    clear(card);
    card.classList.toggle('result-lose', opts.mode === 'lose');

    // 顶部英雄图标：三颗星优先，否则 emoji
    const hero = el('div', 'rs-icon');
    if (opts.stars !== undefined) {
      const row = el('div', 'hero-stars');
      for (let i = 0; i < 3; i++) {
        row.appendChild(el('span', i < opts.stars ? 'hero-star lit' : 'hero-star', '⭐'));
      }
      hero.appendChild(row);
    } else {
      hero.appendChild(el('div', 'hero-icon', opts.icon ?? ''));
    }
    card.appendChild(hero);

    card.appendChild(el('h2', 'rs-title', opts.title));
    if (opts.sub) card.appendChild(el('p', 'rs-sub', opts.sub));

    // 得分卡
    const scoreCard = el('div', 'rs-score-card');
    scoreCard.appendChild(el('div', 'rs-score-label', opts.scoreLabel ?? '本关得分'));
    const value = el('div', 'rs-score-value', '0');
    scoreCard.appendChild(value);
    if (opts.hint) scoreCard.appendChild(el('div', 'rs-hint', opts.hint));
    card.appendChild(scoreCard);
    rollNumber(value, opts.score);

    if (opts.note) card.appendChild(el('p', 'rs-note', opts.note));

    // 按钮（沿用 dialog 的「置灰仍可点 + 提示」语义；非置灰才关弹窗并执行）
    for (const row of opts.rows) {
      const rowEl = el('div', 'rs-btn-row');
      for (const item of row) {
        const classes = ['rs-btn'];
        if (item.primary) classes.push('primary');
        if (item.dim) classes.push('dim');
        const btn = buttonEl(item.label, classes.join(' '), () => {
          haptic();
          if (item.dim) {
            if (item.disabledHint) toast(item.disabledHint, 2600);
            return;
          }
          hide();
          item.onClick?.();
        });
        rowEl.appendChild(btn);
      }
      card.appendChild(rowEl);
    }

    // 右上角 ❌ 关闭键：默认等同「主页」按钮（隐藏吊牌 + 回主页），给玩家一个一致的逃生口
    const closeBtn = buttonEl('✕', 'lp-close', () => {
      hide();
      opts.onHome?.();
    });
    closeBtn.title = '关闭（返回主页）';
    card.appendChild(closeBtn);

    // 重启下落动画：先移除再强制重排再添加
    root.classList.remove('on');
    void root.offsetWidth;
    root.classList.add('on');
    open = true;
  }

  return { el: root, show, hide, get open() { return open; } };
}

/** 大号分数：从 0 滚到目标值（与 dialog 同手感） */
function rollNumber(node: HTMLElement, target: number): void {
  if (typeof requestAnimationFrame !== 'function') {
    node.textContent = String(target);
    return;
  }
  const duration = 620;
  const start = performance.now();
  const step = (now: number): void => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    node.textContent = String(Math.round(target * eased));
    if (t < 1) requestAnimationFrame(step);
    else node.textContent = String(target);
  };
  requestAnimationFrame(step);
}
