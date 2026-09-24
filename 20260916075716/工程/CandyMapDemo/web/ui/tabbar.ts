/**
 * 底部页签栏（糖果传奇式全局导航）。
 *
 * 定位：**浮层**，不是屏。它盖在所有屏之上、 dialog（z=90）之下，
 * 所以玩法屏只要 `setVisible(false)` 就没有「一键跳走」的入口 —— 这跟
 * 「不设暂停按钮」是同一条约束（§0 第 1 条）：能一键跳走 = 能暂停 = 能截图作弊。
 *
 * 界面只负责显示与转发点击：跳哪一律由 main.ts 的 `showScreen()` 决定，
 * 这里不认识任何业务状态。
 */

import { TABBAR } from './text.ts';
import { el } from './dom.ts';

export type TabName = 'home' | 'leaderboard' | 'collection' | 'settings';

export interface TabBarHandlers {
  onHome: () => void;
  onLeaderboard: () => void;
  onCollection: () => void;
  onSettings: () => void;
}

export interface TabBar {
  el: HTMLElement;
  /** 高亮某个页签（传 null = 全部不高亮，玩法屏用） */
  setActive: (name: string | null) => void;
  setVisible: (visible: boolean) => void;
}

/** 顺序即布局顺序：首页在最左 */
const TABS: { name: TabName; icon: string; label: string }[] = [
  { name: 'home', icon: '🏠', label: TABBAR.home },
  { name: 'leaderboard', icon: '🏆', label: TABBAR.leaderboard },
  { name: 'collection', icon: '📚', label: TABBAR.collection },
  { name: 'settings', icon: '⚙️', label: TABBAR.settings },
];

export function createTabBar(handlers: TabBarHandlers): TabBar {
  const root = el('nav', 'tabbar');
  root.id = 'tabbar';

  const btns = new Map<TabName, HTMLButtonElement>();
  for (const t of TABS) {
    const btn = el('button', 'tab');
    btn.type = 'button';
    btn.appendChild(el('span', 'tab-icon', t.icon));
    btn.appendChild(el('span', 'tab-label', t.label));
    btn.addEventListener('click', () => {
      if (t.name === 'home') handlers.onHome();
      else if (t.name === 'leaderboard') handlers.onLeaderboard();
      else if (t.name === 'collection') handlers.onCollection();
      else handlers.onSettings();
    });
    btns.set(t.name, btn);
    root.appendChild(btn);
  }

  return {
    el: root,
    setActive: (name) => {
      for (const [key, btn] of btns) btn.classList.toggle('on', key === name);
    },
    setVisible: (visible) => {
      root.hidden = !visible;
    },
  };
}
