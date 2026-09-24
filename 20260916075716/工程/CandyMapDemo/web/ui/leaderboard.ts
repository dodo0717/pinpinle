/**
 * 排行榜（《通关及排名》§七 + §9.3 线框）。
 *
 * 关键规则（2026-09-12 版策划案）：
 *   - 榜单是**百强**：只显示名次 ≤ 100 的条目；第 100 名允许并列，
 *     所以实际条数可能略多于 100（「符合要求的百名（或并列百名）」）。
 *   - **每页 20 名**，有多少页补多少页。
 *   - 打开时默认停在玩家当前所在的最后一关，并直接翻到**我的排名那一页**，
 *     否则玩家得自己一页页找自己在哪。
 *
 * ⚠️ **没有后端**：模拟玩家（100 名、全部 ≥3★）来自 `assets/scripts/core/honor.ts`，
 * 是**本地确定性数据**（同一关每次打开都一样，方便验收），只有「我的成绩」取自本机记录。
 * 界面上必须写明这一点（`LEADERBOARD.mockNote`），免得被当成真实榜单。
 */

import type { LevelStatus } from '../../assets/scripts/core/index.ts';
import { LEADERBOARD, tierOfLevel } from './text.ts';
import { buttonEl, el, toast } from './dom.ts';

/** 《通关及排名》§七：每页 20 名 */
export const LEADERBOARD_PAGE_SIZE = 20;

export interface LeaderboardRow {
  rank: number;
  name: string;
  score: number;
  /** 是否为本机玩家 */
  mine?: boolean;
}

/** 「挑战本关」按钮状态：`dim = true` 表示置灰，点击只弹 `hint`（不进入关卡） */
export interface ChallengeState {
  dim: boolean;
  hint: string;
}

export interface LeaderboardView {
  level: number;
  /** 百强榜条目（名次 ≤ 100，含并列） */
  rows: LeaderboardRow[];
  /** 本关总玩家数（去重：模拟玩家 + 本机） */
  totalPlayers: number;
  /** 我的名次；null = 暂未上榜 */
  myRank: number | null;
  /** 我在榜上的最高分（0 = 暂未上榜） */
  boardBest: number;
  /** 本关个人最高分（含 1★/2★/续命；0 = 没打过） */
  personalBest: number;
  /** 「挑战本关」按钮状态 */
  challenge: ChallengeState;
}

export interface LeaderboardHandlers {
  onBack: () => void;
  onChallenge: (level: number) => void;
  /** 取某关的榜单数据（由 main.ts 组装：模拟数据 + 本机成绩） */
  view: (level: number) => LeaderboardView;
}

export interface LeaderboardScreen {
  el: HTMLElement;
  /** 切到某一关并重绘 */
  show: (level: number, maxLevel: number) => void;
}

/**
 * 「挑战本关」按钮状态（§9.3 状态机）。
 *
 * ⚠️ **只要通关过就允许挑战，1★ / 2★ / 3★ 一视同仁** —— 排行榜的意义就是让玩家回来刷
 * 更高分 / 更高星，卡「必须满星」等于把绝大多数关卡挡在门外。
 *
 * 置灰只有三种原因，且必须说清是哪一种：
 *   - `playable === false`：该关所需素材张数不足（开发期素材未到齐），已通关也进不去；
 *   - `unlocked`：已解锁但没通关 —— 没有成绩可刷，先通关；
 *   - `locked`：前一关还没通关。
 */
export function challengeState(level: number, status: LevelStatus, playable: boolean): ChallengeState {
  if (!playable) return { dim: true, hint: LEADERBOARD.challengeUnavailable(level) };
  if (status === 'cleared') return { dim: false, hint: '' };
  return {
    dim: true,
    hint: status === 'unlocked' ? LEADERBOARD.challengeUnclear : LEADERBOARD.challengeLocked,
  };
}

export function createLeaderboardScreen(handlers: LeaderboardHandlers): LeaderboardScreen {
  const root = el('section', 'screen leaderboard sheet');
  root.id = 'screen-leaderboard';

  const top = el('div', 'screen-top');
  top.appendChild(el('div', 'sheet-title', LEADERBOARD.title));
  const closeBtn = buttonEl('✕', 'sheet-close', () => handlers.onBack());
  closeBtn.title = '关闭';
  top.appendChild(closeBtn);
  root.appendChild(top);

  // 关卡切换放在表头里（「◀ 第 N 关 · 段位 ▶」），把纵向空间留给 20 行榜单
  const header = el('div', 'lb-header');
  const headerPrev = buttonEl('◀', 'lb-step', () => step(-1));
  const headerText = el('span', 'lb-header-text');
  const headerNext = buttonEl('▶', 'lb-step', () => step(1));
  header.appendChild(headerPrev);
  header.appendChild(headerText);
  header.appendChild(headerNext);
  root.appendChild(header);

  const mine = el('div', 'lb-mine');
  root.appendChild(mine);

  const list = el('div', 'lb-list');
  root.appendChild(list);

  const pager = el('div', 'lb-pager');
  const pagePrev = buttonEl(LEADERBOARD.prevPage, 'lb-page-btn', () => goPage(page - 1));
  const pageLabel = el('span', 'lb-page-label');
  const pageNext = buttonEl(LEADERBOARD.nextPage, 'lb-page-btn', () => goPage(page + 1));
  pager.appendChild(pagePrev);
  pager.appendChild(pageLabel);
  pager.appendChild(pageNext);
  root.appendChild(pager);

  const challengeBtn = buttonEl(LEADERBOARD.challenge, 'menu-btn primary', () => {
    const view = handlers.view(current);
    if (view.challenge.dim) {
      toast(view.challenge.hint, 2600);
      return;
    }
    handlers.onChallenge(current);
  });
  root.appendChild(challengeBtn);
  root.appendChild(el('div', 'lb-note', LEADERBOARD.footer));
  root.appendChild(el('div', 'lb-note dim', LEADERBOARD.mockNote));

  let current = 1;
  let maxLevel = 60;
  let page = 1;
  let pageCount = 1;
  let view: LeaderboardView | null = null;

  function step(delta: number): void {
    const next = current + delta;
    if (next < 1) {
      toast('已经是第一关', 1600);
      return;
    }
    if (next > maxLevel) {
      toast('已经是最后一关', 1600);
      return;
    }
    show(next);
  }

  function goPage(next: number): void {
    if (next < 1 || next > pageCount) return;
    page = next;
    renderRows();
  }

  /** 画「我的排名」那一块（在榜 / 未上榜两种形态） */
  function renderMine(): void {
    const data = view;
    if (!data) return;
    mine.replaceChildren();
    if (data.myRank !== null) {
      mine.appendChild(el('div', 'lb-my-rank', LEADERBOARD.myRank(data.myRank)));
      if (data.boardBest > 0) {
        mine.appendChild(el('div', 'lb-my-best', LEADERBOARD.myBoardBest(data.boardBest)));
      }
    } else {
      mine.appendChild(el('div', 'lb-my-rank', LEADERBOARD.myRankNone));
      // 未上榜也把个人最高分摆出来：玩家要知道「离上榜还差多少」
      if (data.personalBest > 0) {
        mine.appendChild(el('div', 'lb-my-best', LEADERBOARD.myPersonalBest(data.personalBest)));
      }
    }
  }

  /** 只画当前页的 20 行 */
  function renderRows(): void {
    const data = view;
    if (!data) return;
    list.replaceChildren();

    if (data.rows.length === 0) {
      list.appendChild(el('div', 'lb-empty', LEADERBOARD.empty));
      return;
    }

    const from = (page - 1) * LEADERBOARD_PAGE_SIZE;
    const slice = data.rows.slice(from, from + LEADERBOARD_PAGE_SIZE);
    for (const row of slice) {
      const item = el('div', row.mine ? 'lb-row mine' : 'lb-row');
      const medal = row.rank === 1 ? '🥇' : row.rank === 2 ? '🥈' : row.rank === 3 ? '🥉' : String(row.rank);
      item.appendChild(el('span', 'lb-rank', medal));
      item.appendChild(el('span', 'lb-name', row.name));
      item.appendChild(el('span', 'lb-score', LEADERBOARD.scoreUnit(row.score)));
      list.appendChild(item);
    }

    pageLabel.textContent = LEADERBOARD.page(page, pageCount);
    pagePrev.classList.toggle('dim', page <= 1);
    pageNext.classList.toggle('dim', page >= pageCount);
  }

  function show(level: number, limit = maxLevel): void {
    current = Math.min(Math.max(1, level), limit);
    maxLevel = limit;
    view = handlers.view(current);

    headerText.textContent = LEADERBOARD.header(current, tierOfLevel(current));
    headerPrev.classList.toggle('dim', current <= 1);
    headerNext.classList.toggle('dim', current >= maxLevel);

    pageCount = Math.max(1, Math.ceil(view.rows.length / LEADERBOARD_PAGE_SIZE));
    // 默认翻到我的排名那一页；没上榜就从第一页看起
    const mineIndex = view.rows.findIndex((row) => row.mine);
    page = mineIndex >= 0 ? Math.floor(mineIndex / LEADERBOARD_PAGE_SIZE) + 1 : 1;

    renderMine();
    renderRows();

    // 只有一页时把翻页条收起来，别占地方
    pager.hidden = pageCount <= 1;

    challengeBtn.classList.toggle('dim', view.challenge.dim);
    challengeBtn.textContent = view.challenge.dim ? view.challenge.hint : LEADERBOARD.challenge;
  }

  return { el: root, show };
}
