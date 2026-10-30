/**
 * 排行榜（《通关及排名》§七 + §9.3 线框）—— 2026-10-22 按设计图《UI及角色/排行榜》整体改版。
 *
 * 视觉：整屏蓝天 + 一张金色圆角大卡（`web/art/leaderboard/frame.png`），
 * 卡内 = 胶囊双 Tab（总分榜/关卡榜）→ 金银铜奖杯领奖台 → 表头条 → 榜单行
 * （1-4 名盾牌徽章、金圈头像、简单绿 / 困难橙 / 总分黄三栏数字，「我」行黄色高亮）。
 *
 * ⚠️ **没有后端**：玩家（100 名）来自 `assets/scripts/核心/honor.ts` 的确定性 mock，
 * 是**本地模拟数据**（同一关每次打开都一样，方便验收），界面上必须写明这一点
 * （`LEADERBOARD.mockNote`），免得被当成真实榜单。
 *
 * 模块只做渲染与开关节点，**不反向依赖 `main.ts`**（避免循环导入）；
 * 数据通过 `handlers.view(level)` / `handlers.myTotals()` 取。
 */

import { Rng, mockBoardNames, TOTAL_LEVELS, type LevelStatus } from '../../assets/scripts/核心/index.ts';
import { LEADERBOARD } from './text.ts';
import { buttonEl, el, toast } from './dom.ts';

/** 《通关及排名》§七：每页 20 名（保留常量，逻辑页签已改为滚动列表） */
export const LEADERBOARD_PAGE_SIZE = 20;

/** 切图资源目录 */
const ART = '/web/art/leaderboard';

export interface LeaderboardRow {
  rank: number;
  name: string;
  /** 关卡榜里 = 上榜最高分；总分榜里 = 累计总分 */
  score: number;
  /** 是否为本机玩家 */
  mine?: boolean;
  /** 设计图四栏：简单分 / 困难分 / 总分（总分榜里 score 即总分） */
  simple?: number;
  hard?: number;
  total?: number;
  /** 头像图 URL */
  avatar?: string;
}

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
  /** 我在榜上的最高分；0 = 暂未上榜 */
  boardBest: number;
  /** 本关个人最高分（含 1★/2★/续命；0 = 没打过） */
  personalBest: number;
  /**
   * 我在本关**两套模式各自的最高分**（简单 / 困难分开记，没玩过 = 0）。
   *
   * ⚠️ 这两列**绝对不允许**由单个分数按比例拆出来（曾经用 0.6/0.4 硬拆，
   * 结果「简单 23 分」被显示成「简单 14 / 困难 9」，而困难根本没玩）。
   * 分模式的成绩只能来自各自的进度表：`progressByMode.normal / .nightmare`。
   */
  myScores: { simple: number; hard: number };
  /** 当前玩法模式：模拟玩家只有一份成绩，落在对应那一列 */
  mode: 'normal' | 'nightmare';
  /** 「挑战本关」按钮状态 */
  challenge: ChallengeState;
}

export interface LeaderboardHandlers {
  onBack: () => void;
  onChallenge: (level: number) => void;
  /** 取某关的榜单数据（由 main.ts 组装：模拟数据 + 本机成绩） */
  view: (level: number) => LeaderboardView;
  /**
   * 我在**全服总分榜**上的真实累计分：简单 / 困难各自累加各模式所有关卡的本关最高分。
   * 不再用「一个总分按比例拆两列」的假口径。
   */
  myTotals: () => { simple: number; hard: number };
  /**
   * 我的**累计星数**（两套进度之和，与图鉴解锁同源口径）。
   * 2026-10-22 新增：成绩单里最该被看见的一项（图鉴按它解锁）。
   */
  myStars: () => number;
}

export interface LeaderboardScreen {
  el: HTMLElement;
  /** 切到某一关并重绘 */
  show: (level: number, maxLevel: number) => void;
}

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** 金圈头像切图只有 3 张：按昵称哈希稳定取一张（同一玩家头像不变） */
function avatarUrl(name: string): string {
  return `${ART}/avatar-${(hashStr(name) % 3) + 1}.png`;
}

/** 小图工具：src + 禁拖拽，省得每个调用点重复写 */
function img(src: string, cls: string): HTMLImageElement {
  const node = el('img', cls) as HTMLImageElement;
  node.src = src;
  node.alt = '';
  node.draggable = false;
  return node;
}

/**
 * 关卡榜里模拟玩家那一行的三栏。
 *
 * 模拟玩家只有**一份**成绩（当前模式的该关上榜分），所以它只落在当前模式那一列，
 * 另一列就是「没玩过 = 0」——**不再按 0.6/0.4 拆成两个假数字**。
 * 本机玩家（`mine`）不用这个函数，走 `view.myScores`（两套进度表的真实值）。
 */
function mockRowScores(score: number, mode: 'normal' | 'nightmare'): { simple: number; hard: number; total: number } {
  const inSimple = mode === 'normal';
  return { simple: inSimple ? score : 0, hard: inSimple ? 0 : score, total: score };
}

/**
 * 「挑战本关」按钮状态（§9.3 状态机）。
 * 只要通关过就允许挑战，1★ / 2★ / 3★ 一视同仁。置灰只有三种原因，且必须说清是哪一种。
 */
export function challengeState(level: number, status: LevelStatus, playable: boolean): ChallengeState {
  if (!playable) return { dim: true, hint: LEADERBOARD.challengeUnavailable(level) };
  if (status === 'cleared') return { dim: false, hint: '' };
  return {
    dim: true,
    hint: status === 'unlocked' ? LEADERBOARD.challengeUnclear : LEADERBOARD.challengeLocked,
  };
}

/**
 * 总分榜：本地确定性 mock 的累计总分榜（无后端，纯展示）。
 *
 * ⚠️ 其余 100 名是**模拟玩家**，他们的「简单/困难」拆分也是 mock 出来的分布；
 * 但「我」这一行必须用**真实分模式累计分**（`my`）—— 简单 = 简单模式所有关的
 * 本关最高分之和，困难同理，没玩过的模式就是 0，绝不按比例虚构。
 */
function buildTotalBoard(my: { simple: number; hard: number }): LeaderboardRow[] {
  // 用第 1 关的 100 个固定昵称作为稳定身份，避免按关洗牌导致玩家对不上
  const names = mockBoardNames(1);
  const rng = new Rng(20260914);
  const rows: LeaderboardRow[] = names.map((name) => {
    const total = 380 + rng.int(600); // 380 ~ 979
    const simple = Math.round(total * 0.6);
    const hard = total - simple;
    return { rank: 0, name, simple, hard, total, avatar: avatarUrl(name), mine: false };
  });
  // 把本机玩家「我」塞进榜单，方便看高亮效果（真实值，不做任何比例拆分）
  rows.push({ rank: 0, name: '我', simple: my.simple, hard: my.hard, total: my.simple + my.hard, avatar: avatarUrl('我'), mine: true });
  rows.sort((a, b) => b.total - a.total);
  rows.forEach((r, i) => (r.rank = i + 1));
  return rows;
}

/** 领奖台三档的素材（亚军银 / 冠军金 / 季军铜，中间抬高），冠军底座写「1」 */
const PODIUM: Array<{ pos: 'silver' | 'gold' | 'bronze'; cup: string; base: string; label: string }> = [
  { pos: 'silver', cup: `${ART}/cup-silver.png`, base: `${ART}/podium-orange.png`, label: '' },
  { pos: 'gold', cup: `${ART}/cup-gold.png`, base: `${ART}/podium-red.png`, label: '1' },
  { pos: 'bronze', cup: `${ART}/cup-bronze.png`, base: `${ART}/podium-orange.png`, label: '' },
];

export function createLeaderboardScreen(handlers: LeaderboardHandlers): LeaderboardScreen {
  const root = el('section', 'screen leaderboard');
  root.id = 'screen-leaderboard';

  // 顶栏：棕色返回圆钮 + 白字描边标题（设计图口径，不再是右上角 ✕）
  const top = el('div', 'lb-top');
  const backBtn = buttonEl('', 'lb-back', () => handlers.onBack());
  backBtn.title = '返回';
  backBtn.style.backgroundImage = `url("${ART}/back.png")`;
  top.appendChild(backBtn);
  top.appendChild(el('div', 'lb-title', LEADERBOARD.title));
  root.appendChild(top);

  // 金色圆角大卡：框是切图，里面透出蓝天
  const card = el('div', 'lb-card');
  root.appendChild(card);

  // 双 Tab：总分榜（左）/ 关卡榜（右）。设计图默认选中「总分榜」
  const tabs = el('div', 'lb-tabs');
  const tabTotal = buttonEl(LEADERBOARD.tabTotal, 'lb-tab on', () => setTab('total'));
  const tabLevel = buttonEl(LEADERBOARD.tabLevel, 'lb-tab', () => setTab('level'));
  tabs.appendChild(tabTotal);
  tabs.appendChild(tabLevel);
  card.appendChild(tabs);

  // ⚠️ 这一行是**原有功能**（换肤不能丢）：
  // 左 = 关卡步进器「◀ 第 N 关 ▶」（下拉可直跳，◀▶ 逐关步进，到头置灰）
  // ⚠️ 2026-10-30：原先这里还有个「· 档位」（tierOfLevel），段位规则已去掉
  const meta = el('div', 'lb-meta');
  const levelBar = el('div', 'lb-header');
  const headerPrev = buttonEl('◀', 'lb-step', () => show(current - 1));
  const levelSel = el('select', 'lb-level-select') as HTMLSelectElement;
  levelSel.addEventListener('change', () => show(Number(levelSel.value)));
  const headerNext = buttonEl('▶', 'lb-step', () => show(current + 1));
  levelBar.append(headerPrev, levelSel, headerNext);
  meta.appendChild(levelBar);
  meta.hidden = true;   // 默认总分榜，步进器整行隐藏（成绩单独占一行）
  card.appendChild(meta);

  // ⚠️ 我的成绩单（2026-10-22 升级为独立成绩条）：
  // 原来只是步进器旁 28px 的小字两行，累计星数这种关键数据根本看不见。
  // 现在独占 Tab 下方一整条：金框胶囊 + 三格等分，标签小字、**数值大号金描边**。
  const mineCard = el('div', 'lb-mine-card');
  const mineCells = el('div', 'lb-mine-cells');
  mineCard.appendChild(mineCells);
  card.appendChild(mineCard);

  // 领奖台（前三 = 金银铜奖杯）+ 丝带/星星装饰（装饰是常驻背景，条目每次重建）
  const podium = el('div', 'lb-podium');
  const decor: Array<[string, string]> = [
    ['lb-deco d-rg', `${ART}/ribbon-green.png`],
    ['lb-deco d-rr', `${ART}/ribbon-blue.png`],
    ['lb-deco d-rgo', `${ART}/ribbon-gold.png`],
    ['lb-deco d-s1', `${ART}/star.png`],
    ['lb-deco d-s2', `${ART}/star.png`],
    ['lb-deco d-s3', `${ART}/star.png`],
  ];
  for (const [cls, src] of decor) podium.appendChild(img(src, cls));
  card.appendChild(podium);

  // 表头条：排名 / 昵称 / 简单 / 困难 / 总分（设计图把中间两列合写「简单/困难」，这里拆开对齐两列）
  const thead = el('div', 'lb-thead');
  thead.appendChild(el('span', 'lb-c-rank', LEADERBOARD.colRank));
  thead.appendChild(el('span', 'lb-c-name', LEADERBOARD.colName));
  thead.appendChild(el('span', 'lb-c h-simple', LEADERBOARD.colSimple));
  thead.appendChild(el('span', 'lb-c h-hard', LEADERBOARD.colHard));
  thead.appendChild(el('span', 'lb-c h-total', LEADERBOARD.colTotal));
  card.appendChild(thead);

  // 榜单行（可滚动；表头与领奖台固定）
  const scroll = el('div', 'lb-scroll');
  const list = el('div', 'lb-list');
  scroll.appendChild(list);
  card.appendChild(scroll);

  // ⚠️ 分页器也是**原有功能**（《通关及排名》§七：每页 20 名），换肤不能丢
  const pager = el('div', 'lb-pager');
  const pagePrev = buttonEl(LEADERBOARD.prevPage, 'lb-page-btn', () => goPage(page - 1));
  const pageLabel = el('span', 'lb-page-label');
  const pageNext = buttonEl(LEADERBOARD.nextPage, 'lb-page-btn', () => goPage(page + 1));
  pager.append(pagePrev, pageLabel, pageNext);
  card.appendChild(pager);

  // 「挑战本关」通栏按钮（仅关卡榜；§9.3 真实功能，设计图未画但保留）
  const challengeBtn = buttonEl(LEADERBOARD.challenge, 'lb-challenge', () => {
    const view = handlers.view(current);
    if (view.challenge.dim) {
      toast(view.challenge.hint, 2600);
      return;
    }
    handlers.onChallenge(current);
  });
  challengeBtn.hidden = true; // 默认总分榜，不显示
  card.appendChild(challengeBtn);

  let current = 1;
  /** 关卡榜的关卡上限：跟随 `TOTAL_LEVELS`（2026-10-29 从写死的 60 改成 180 关） */
  let maxLevel = TOTAL_LEVELS;
  let activeTab: 'total' | 'level' = 'total';
  let page = 1;

  function setTab(tab: 'total' | 'level'): void {
    activeTab = tab;
    page = 1; // 换榜回到第 1 页
    tabTotal.classList.toggle('on', tab === 'total');
    tabLevel.classList.toggle('on', tab === 'level');
    meta.hidden = tab !== 'level';   // 步进器整行只在关卡榜出现
    challengeBtn.hidden = tab !== 'level';
    render();
  }

  function goPage(next: number): void {
    page = next;
    render();
  }

  /**
   * 我的成绩单：三格等分 —— 我的排名 / 累计总分（关卡榜为本关最高分）/ 累计星数。
   * 上榜时排名给名次，没上榜给「暂未上榜」；关卡榜的分取「上榜最高分」，没上榜取「个人最高分」。
   */
  function renderMine(rows: LeaderboardRow[]): void {
    mineCells.replaceChildren();
    const cell = (label: string, value: string, cls: string): void => {
      const box = el('div', `lb-mine-cell ${cls}`);
      box.append(el('div', 'lb-mine-k', label), el('div', 'lb-mine-v', value));
      mineCells.appendChild(box);
    };
    const stars = handlers.myStars();
    if (activeTab === 'total') {
      const mine = rows.find((r) => r.mine);
      const t = handlers.myTotals();
      cell(LEADERBOARD.mineRankLabel, LEADERBOARD.rankValue(mine ? mine.rank : 0), 'c-rank');
      cell(LEADERBOARD.mineScoreLabel, LEADERBOARD.scoreValue(t.simple + t.hard), 'c-score');
    } else {
      const view = handlers.view(current);
      cell(LEADERBOARD.mineRankLabel, LEADERBOARD.rankValue(view.myRank ?? 0), 'c-rank');
      cell(LEADERBOARD.mineLevelScoreLabel, LEADERBOARD.scoreValue(view.myRank != null ? view.boardBest : view.personalBest), 'c-score');
    }
    cell(LEADERBOARD.mineStarsLabel, LEADERBOARD.starsValue(stars), 'c-star');
  }

  function currentRows(): LeaderboardRow[] {
    if (activeTab === 'total') {
      // 每次重算：打完一关分数就变了，缓存会显示上一次的累计分
      return buildTotalBoard(handlers.myTotals());
    }
    const view = handlers.view(current);
    return view.rows.map((r) => {
      const avatar = avatarUrl(r.name);
      // 我的行：简单/困难各自取两套进度表的真实最高分
      if (r.mine) {
        return {
          ...r, avatar,
          simple: view.myScores.simple,
          hard: view.myScores.hard,
          total: view.myScores.simple + view.myScores.hard,
        };
      }
      return { ...r, ...mockRowScores(r.score, view.mode), avatar };
    });
  }

  /** 领奖台：前三名换上金银铜奖杯（切图自带头像脸），冠军底座写「1」 */
  function renderPodium(rows: LeaderboardRow[]): void {
    for (const item of Array.from(podium.querySelectorAll('.lb-podium-item'))) item.remove();
    if (rows.length === 0) return;
    // 设计图顺序：亚军(左) / 冠军(中, 抬高) / 季军(右)
    for (let i = 0; i < 3; i++) {
      const spec = PODIUM[i]!;
      const item = el('div', `lb-podium-item ${spec.pos}`);
      item.appendChild(img(spec.cup, 'lb-cup'));
      const base = el('div', 'lb-base');
      base.style.backgroundImage = `url("${spec.base}")`;
      if (spec.label) base.appendChild(el('span', 'lb-base-num', spec.label));
      item.appendChild(base);
      podium.appendChild(item);
    }
  }

  function renderRows(rows: LeaderboardRow[]): void {
    list.replaceChildren();
    if (rows.length === 0) {
      list.appendChild(el('div', 'lb-empty', LEADERBOARD.empty));
      return;
    }
    for (const row of rows) {
      const item = el('div', row.mine ? 'lb-row mine' : 'lb-row');
      // 名次：1-4 名用盾牌徽章切图，其后用数字徽章
      if (row.rank >= 1 && row.rank <= 4) {
        item.appendChild(img(`${ART}/medal-${row.rank}.png`, 'lb-medal'));
      } else {
        item.appendChild(el('span', 'lb-rank-num', String(row.rank)));
      }
      const name = el('div', 'lb-name');
      const av = el('span', 'av');
      av.style.backgroundImage = `url("${row.avatar ?? avatarUrl(row.name)}")`;
      name.appendChild(av);
      name.appendChild(el('span', 'nm', row.name));
      item.appendChild(name);
      item.appendChild(el('span', 'lb-c simple', String(row.simple ?? 0)));
      item.appendChild(el('span', 'lb-c hard', String(row.hard ?? 0)));
      item.appendChild(el('span', 'lb-c total', String(row.total ?? row.score)));
      list.appendChild(item);
    }
  }

  function render(): void {
    const rows = currentRows();
    renderPodium(rows);
    renderMine(rows);

    // 分页（《通关及排名》§七：每页 20 名）—— 领奖台与「我的排名」始终看全量，列表按页切
    const pageCount = Math.max(1, Math.ceil(rows.length / LEADERBOARD_PAGE_SIZE));
    page = Math.min(Math.max(1, page), pageCount);
    const start = (page - 1) * LEADERBOARD_PAGE_SIZE;
    renderRows(rows.slice(start, start + LEADERBOARD_PAGE_SIZE));
    pageLabel.textContent = LEADERBOARD.page(page, pageCount);
    pagePrev.classList.toggle('dim', page <= 1);
    pageNext.classList.toggle('dim', page >= pageCount);

    if (activeTab === 'level') {
      const view = handlers.view(current);
      challengeBtn.classList.toggle('dim', view.challenge.dim);
      challengeBtn.textContent = view.challenge.dim ? view.challenge.hint : LEADERBOARD.challenge;
    }
  }

  function show(level: number, limit = maxLevel): void {
    current = Math.min(Math.max(1, level), limit);
    maxLevel = limit;
    page = 1; // 换关回到第 1 页

    // 关卡下拉（可直跳 60 关）+ 档位文本 + ◀▶ 到头置灰
    levelSel.replaceChildren();
    for (let i = 1; i <= maxLevel; i++) {
      const opt = el('option', undefined, LEADERBOARD.levelSelect(i)) as HTMLOptionElement;
      opt.value = String(i);
      if (i === current) opt.selected = true;
      levelSel.appendChild(opt);
    }
    headerPrev.classList.toggle('dim', current <= 1);
    headerNext.classList.toggle('dim', current >= maxLevel);
    render();
  }

  return { el: root, show };
}
