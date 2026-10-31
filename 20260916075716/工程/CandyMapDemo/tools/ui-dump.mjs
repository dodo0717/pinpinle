/**
 * UI 几何导出器（验证工具，不进小游戏包）
 * ------------------------------------------------------------------
 * 用途：把「Web 版真页面」和「Cocos 预览页（cc-shim）」的界面元素几何
 *       导出成同结构 JSON，供 `ui-diff.mjs` 逐元素比对 —— 让「与 Web 版一致」
 *       这句话可以被机器判定，而不是靠肉眼。
 *
 * 两边都换算到 **1080×1920 逻辑坐标**、**左上角原点、y 向下**（与 CSS 一致）。
 *
 * 用法：
 *   node tools/ui-dump.mjs --url <url> --probe web-game  --out docs/dump/web-game.json
 *   node tools/ui-dump.mjs --url <url> --probe cocos-game --out docs/dump/cocos-game.json
 *   ... [--click=<selector>]（可多次，按序点击后再导出）
 *   ... [--shot=<png 路径>]（同时截图，1080×1920）
 *
 * 依赖：本机 Chrome（远程调试端口 9222），Node ≥22（自带 WebSocket）。
 * 不改 web/ 任何文件：探针只在运行时注入。
 */

import { spawn } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const CDP_PORT = 9222;

const argv = process.argv.slice(2);
function arg(name, def) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : def;
}
const flags = (name) => argv.filter((a) => a.startsWith(`--${name}=`)).map((a) => a.slice(name.length + 3));

const URL_ = arg('url');
const PROBE = arg('probe', 'web-game');
const OUT = arg('out');
const WAIT = Number(arg('wait', 7000));
const SHOT = arg('shot', '');
const SCALE = Number(arg('scale', 1)); // 视口缩放：0.55 时窗口 594×1056，画面内容不变
const CLICKS = flags('click');
/**
 * Cocos 预览页没有 DOM，只能用**坐标点击**（1080×1920 逻辑坐标，原点左上）。
 * 用法：`--tap=944,1588`（多次可打开多层界面，例如先点关卡珠再点 Play）
 */
const TAPS = flags('tap');
// 本机 Chrome 的 side-by-side 配置坏了（spawn UNKNOWN），Edge 同为 Chromium，CDP 完全一致
const BROWSER = arg('browser', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ 探针（Web） */

/** key → CSS 选择器。key 与 Cocos 侧的节点名一一对应，比对时按 key 对齐。 */
const WEB_KEYS = {
  stage: '#stage',
  screenGame: '#screen-game',
  card: '.game-card',
  topbar: '.game-topbar',
  exit: '#hud-exit',
  goal: '.hud-goal',
  goalFlag: '.hud-goal .goal-flag',
  goalNum: '#hud-goal-num',
  scorePanel: '#hud-score',
  flapTens: '#score-tens',
  flapUnits: '#score-units',
  faceTens: '#score-tens .face',
  faceUnits: '#score-units .face',
  timer: '#hud-timer',
  timerClock: '.hud-timer .timer-clock',
  timerNum: '#hud-timer-num',
  boardWrap: '#board-wrap',
  board: '#board',
};

function webProbeSource() {
  return `(() => {
  const KEYS = ${JSON.stringify(WEB_KEYS)};
  const stage = document.getElementById('stage');
  const base = stage.getBoundingClientRect();
  const s = (base.width || 1080) / 1080;
  const L = (r) => ({
    x: +((r.left - base.left) / s).toFixed(2),
    y: +((r.top - base.top) / s).toFixed(2),
    w: +(r.width / s).toFixed(2),
    h: +(r.height / s).toFixed(2),
  });
  const cs = (el) => {
    const c = getComputedStyle(el);
    return {
      color: c.color, fontSize: c.fontSize, fontWeight: c.fontWeight, lineHeight: c.lineHeight,
      family: c.fontFamily, bg: c.backgroundColor, bgImage: c.backgroundImage.slice(0, 180),
      radius: c.borderTopLeftRadius, border: c.borderTopWidth + ' ' + c.borderTopColor,
      shadow: c.boxShadow.slice(0, 180), textShadow: c.textShadow.slice(0, 120),
      opacity: c.opacity, display: c.display, padding: c.padding, gap: c.gap,
    };
  };
  const out = [];
  for (const [k, sel] of Object.entries(KEYS)) {
    const el = document.querySelector(sel);
    if (!el) { out.push({ key: k, missing: true }); continue; }
    const r = el.getBoundingClientRect();
    out.push(Object.assign({ key: k, text: (el.textContent || '').trim().slice(0, 60) }, L(r), cs(el)));
  }
  const cells = [...document.querySelectorAll('#board .cell')].map((el, i) => {
    const r = el.getBoundingClientRect();
    return Object.assign({ key: 'cell' + i }, L(r), { bg: getComputedStyle(el).backgroundColor });
  });
  const screen = document.querySelector('#screen-game.active') ? 'game' : (document.querySelector('.screen.active')?.id || 'none');
  return { screen, stageScale: s, items: out, cells };
})()`;
}

/* ------------------------------------------------------------------ 探针（Web · 首页/地图屏） */

/**
 * key → CSS 选择器（首页）。重复元素（关卡节点 / 底栏 tab）用 querySelectorAll 展开。
 * 关卡节点的「珠面层」单独导出 —— 果冻层 / 数字 / 锁的尺寸都要单独比。
 */
const WEB_HOME_KEYS = {
  stage: '#stage',
  screenHome: '#screen-home, #screen-map',
  homeBack: '.home-back',
  homeUser: '.home-user',
  homeAvatar: '.home-avatar',
  homeNick: '.home-nick',
  homeStamina: '.home-stamina',
  homeHeart: '.home-heart',
  heartsText: '.hearts-text',
  homePlus: '.home-plus',
  homeRecover: '.home-recover',
  homeTutorial: '.home-tutorial',
  worldNavLeft: '.map-world-nav.nav-left',
  worldNavRight: '.map-world-nav.nav-right',
  pager: '.map-pager',
  pagerUp: '.map-pager-btn.page-up, .map-pager-btn:nth-of-type(1)',
  pagerDown: '.map-pager-btn.page-down, .map-pager-btn:nth-of-type(3)',
  pagerDots: '.map-pager-dots',
  mapScroll: '.map-scroll',
  mapTrack: '.map-track',
  mapPath: '.map-path',
  tabbar: '.tabbar',
};

function webHomeProbeSource() {
  return `(() => {
  const KEYS = ${JSON.stringify(WEB_HOME_KEYS)};
  const stage = document.getElementById('stage');
  const base = stage.getBoundingClientRect();
  const s = (base.width || 1080) / 1080;
  const L = (r) => ({
    x: +((r.left - base.left) / s).toFixed(2),
    y: +((r.top - base.top) / s).toFixed(2),
    w: +(r.width / s).toFixed(2),
    h: +(r.height / s).toFixed(2),
  });
  const cs = (el) => {
    const c = getComputedStyle(el);
    return {
      color: c.color, fontSize: c.fontSize, fontWeight: c.fontWeight,
      bg: c.backgroundColor, bgImage: c.backgroundImage.slice(0, 160),
      radius: c.borderTopLeftRadius, border: c.borderTopWidth + ' ' + c.borderTopColor,
      shadow: c.boxShadow.slice(0, 160), opacity: c.opacity,
      transform: c.transform === 'none' ? '' : c.transform.slice(0, 80),
      display: c.display, zIndex: c.zIndex,
    };
  };
  const out = [];
  for (const [k, sel] of Object.entries(KEYS)) {
    const el = document.querySelector(sel);
    if (!el) { out.push({ key: k, missing: true }); continue; }
    out.push(Object.assign({ key: k, text: (el.textContent || '').trim().slice(0, 40) }, L(el.getBoundingClientRect()), cs(el)));
  }
  // 关卡节点：全部导出（含状态 class），珠面层取第一个节点做样本
  const nodes = [...document.querySelectorAll('.map .node, .node')].filter((el, i, a) => a.indexOf(el) === i);
  nodes.slice(0, 24).forEach((el, i) => {
    out.push(Object.assign({ key: 'node' + i, cls: el.className, text: (el.textContent || '').trim().slice(0, 16) }, L(el.getBoundingClientRect()), cs(el)));
  });
  const art = document.querySelector('.node-art');
  const gel = document.querySelector('.node-gel');
  const num = document.querySelector('.node-num');
  const lock = document.querySelector('.node-lock');
  for (const [k, el] of [['nodeArt', art], ['nodeGel', gel], ['nodeNum', num], ['nodeLock', lock]]) {
    if (el) out.push(Object.assign({ key: k, text: (el.textContent || '').trim().slice(0, 10) }, L(el.getBoundingClientRect()), cs(el)));
  }
  document.querySelectorAll('.tabbar .tab').forEach((el, i) => {
    out.push(Object.assign({ key: 'tab' + i, text: (el.textContent || '').trim().slice(0, 10) }, L(el.getBoundingClientRect()), cs(el)));
    const ic = el.querySelector('.tab-icon');
    const lb = el.querySelector('.tab-label');
    if (ic) out.push(Object.assign({ key: 'tab' + i + 'Icon' }, L(ic.getBoundingClientRect()), { bgImage: getComputedStyle(ic).backgroundImage.slice(0, 120) }));
    if (lb) out.push(Object.assign({ key: 'tab' + i + 'Label', text: lb.textContent || '' }, L(lb.getBoundingClientRect()), { color: getComputedStyle(lb).color, fontSize: getComputedStyle(lb).fontSize }));
  });
  const screen = document.querySelector('.screen.active')?.id || 'none';
  // 滚动状态（地图是翻页容器）：track 的 translate / fitScale
  const track = document.querySelector('.map-track');
  return {
    screen, stageScale: s, items: out,
    trackTransform: track ? getComputedStyle(track).transform : null,
    fit: track ? getComputedStyle(track).getPropertyValue('--fit') : null,
  };
})()`;
}

/* ------------------------------------------------------------------ 探针（Web · 吊牌浮层：PLAY / 结算） */

/**
 * 吊牌类浮层（`.lp-*` 是关卡详情 PLAY 吊牌，`.result-*` 是结算吊牌）的实测几何。
 * 前提是浮层已经打开 —— 用 `--click ".node"`（点关卡珠）或 `--click "#xxx"` 打开。
 * 结算吊牌与 PLAY 吊牌共用 820 宽的骨架，所以两套 key 一起导出。
 */
const WEB_PREVIEW_KEYS = {
  previewRoot: '.level-preview.on',
  lpDrop: '.lp-drop',
  lpRope: '.lp-rope',
  lpSpacer: '.lp-spacer',
  lpCard: '.lp-card',
  lpClose: '.lp-close',
  lpLevel: '.lp-level',
  lpModes: '.lp-modes',
  lpMode0: '.lp-modes .lp-mode:nth-child(1)',
  lpMode1: '.lp-modes .lp-mode:nth-child(2)',
  lpStars: '.lp-stars',
  lpStar0: '.lp-stars .lp-star:nth-child(1)',
  lpSep: '.lp-stars .lp-sep',
  lpStar1: '.lp-stars .lp-star:nth-child(2)',
  lpStarNum0: '.lp-stars .lp-star:nth-child(1) b',
  lpStarNum1: '.lp-stars .lp-star:nth-child(2) b',
  lpPlay: '.lp-play',
  // 结算吊牌（result.ts 复用了同一套 lp-* 骨架）
  resultRoot: '.result-preview.on',
  resultCard: '.result-preview .lp-card',
  resultDrop: '.result-preview .lp-drop',
  resultExtra: '.result-extra',
  rsTitle: '.rs-title',
  rsScore: '.rs-score',
  rsStarsRow: '.rs-stars',
  rsBtns: '.rs-btns',
  rsBtn0: '.rs-btns button:nth-child(1)',
  rsBtn1: '.rs-btns button:nth-child(2)',
  rsBtn2: '.rs-btns button:nth-child(3)',
};

function webPreviewProbeSource() {
  return `(() => {
  const KEYS = ${JSON.stringify(WEB_PREVIEW_KEYS)};
  const stage = document.getElementById('stage');
  const base = stage.getBoundingClientRect();
  const s = (base.width || 1080) / 1080;
  const L = (r) => ({
    x: +((r.left - base.left) / s).toFixed(2),
    y: +((r.top - base.top) / s).toFixed(2),
    w: +(r.width / s).toFixed(2),
    h: +(r.height / s).toFixed(2),
  });
  const cs = (el) => {
    const c = getComputedStyle(el);
    return {
      color: c.color, fontSize: c.fontSize, fontWeight: c.fontWeight, letterSpacing: c.letterSpacing,
      bg: c.backgroundColor, bgImage: c.backgroundImage.slice(0, 200),
      radius: c.borderTopLeftRadius, border: c.borderTopWidth + ' ' + c.borderTopColor,
      shadow: c.boxShadow.slice(0, 200), opacity: c.opacity, padding: c.padding,
      margin: c.marginTop + ' ' + c.marginRight + ' ' + c.marginBottom + ' ' + c.marginLeft,
      stroke: c.webkitTextStrokeWidth + ' ' + c.webkitTextStrokeColor,
      textShadow: c.textShadow.slice(0, 120),
      display: c.display, zIndex: c.zIndex, disabled: !!el.disabled,
    };
  };
  const out = [];
  for (const [k, sel] of Object.entries(KEYS)) {
    const el = document.querySelector(sel);
    if (!el) { out.push({ key: k, missing: true }); continue; }
    out.push(Object.assign({ key: k, cls: el.className, text: (el.textContent || '').trim().slice(0, 40) }, L(el.getBoundingClientRect()), cs(el)));
  }
  // 困难模式按钮文案 / 是否挂锁（和 derivatives 一起判断口径）
  const hard = document.querySelector('.lp-modes .lp-mode:nth-child(2)');
  return {
    screen: 'preview', stageScale: s, items: out,
    hardBtn: hard ? { text: hard.textContent, disabled: !!hard.disabled, cls: hard.className } : null,
    open: !!document.querySelector('.level-preview.on') || !!document.querySelector('.result-preview.on'),
  };
})()`;
}

/* ------------------------------------------------------------------ 探针（Web · 排行榜整屏） */

/**
 * 排行榜整屏 `#screen-leaderboard` 的实测几何。
 * 前提是先切到这一屏 —— 用 `--click=".tabbar .tab:nth-child(2)"`（底栏第 2 个页签 = 排行榜）；
 * 默认是**总分榜**，再叠一个 `--click=".lb-tab:nth-child(2)"` 切到**关卡榜**
 * （关卡榜才有步进器与「挑战本关」，这是产品硬要求的一项）。
 */
const WEB_LB_KEYS = {
  screen: '#screen-leaderboard',
  top: '.lb-top',
  back: '.lb-back',
  title: '.lb-title',
  card: '.lb-card',
  tabs: '.lb-tabs',
  tabTotal: '.lb-tabs .lb-tab:nth-child(1)',
  tabLevel: '.lb-tabs .lb-tab:nth-child(2)',
  meta: '.lb-meta',
  header: '.lb-header',
  stepPrev: '.lb-header .lb-step:nth-child(1)',
  levelSelect: '.lb-level-select',
  stepNext: '.lb-header .lb-step:nth-child(3)',
  mineCard: '.lb-mine-card',
  mineCells: '.lb-mine-cells',
  mineCell0: '.lb-mine-cell:nth-child(1)',
  mineCell1: '.lb-mine-cell:nth-child(2)',
  mineCell2: '.lb-mine-cell:nth-child(3)',
  mineK0: '.lb-mine-cell:nth-child(1) .lb-mine-k',
  mineV0: '.lb-mine-cell:nth-child(1) .lb-mine-v',
  mineV1: '.lb-mine-cell:nth-child(2) .lb-mine-v',
  mineV2: '.lb-mine-cell:nth-child(3) .lb-mine-v',
  podium: '.lb-podium',
  podiumSilver: '.lb-podium-item.silver',
  podiumGold: '.lb-podium-item.gold',
  podiumBronze: '.lb-podium-item.bronze',
  cupGold: '.lb-podium-item.gold .lb-cup',
  cupSilver: '.lb-podium-item.silver .lb-cup',
  baseGold: '.lb-podium-item.gold .lb-base',
  baseSilver: '.lb-podium-item.silver .lb-base',
  baseNum: '.lb-base-num',
  thead: '.lb-thead',
  theadRank: '.lb-thead .lb-c-rank',
  theadName: '.lb-thead .lb-c-name',
  theadSimple: '.lb-thead .h-simple',
  theadHard: '.lb-thead .h-hard',
  theadTotal: '.lb-thead .h-total',
  scroll: '.lb-scroll',
  list: '.lb-list',
  row0: '.lb-list .lb-row:nth-child(1)',
  row1: '.lb-list .lb-row:nth-child(2)',
  rowMine: '.lb-list .lb-row.mine',
  medal: '.lb-row .lb-medal',
  rankNum: '.lb-row .lb-rank-num',
  name: '.lb-row .lb-name',
  av: '.lb-row .lb-name .av',
  nm: '.lb-row .lb-name .nm',
  cSimple: '.lb-row .lb-c.simple',
  cHard: '.lb-row .lb-c.hard',
  cTotal: '.lb-row .lb-c.total',
  pager: '.lb-pager',
  pagePrev: '.lb-pager .lb-page-btn:nth-child(1)',
  pageLabel: '.lb-page-label',
  pageNext: '.lb-pager .lb-page-btn:nth-child(3)',
  challenge: '.lb-challenge',
  tabbar: '#tabbar',
};

/**
 * 通用 Web 探针模板（排行榜 / 图鉴 / 设置三屏共用）：
 * 给一批选择器 → 逐个量几何 + computed style + **文字真实包围盒**（见 `tr`）。
 * `extra` 是拼进返回对象里的附加字段表达式串（例如 `rowCount: rows.length,`），
 * 可以直接用模板里的 `s`（stage 缩放）与 `box()`。
 */
function webKeysProbeSource(KEYS, screenName, extra = '') {
  return `(() => {
  const KEYS = ${JSON.stringify(KEYS)};
  const stage = document.getElementById('stage');
  const base = stage.getBoundingClientRect();
  const s = (base.width || 1080) / 1080;
  const box = (e) => e.getBoundingClientRect();
  const L = (r) => ({
    x: +((r.left - base.left) / s).toFixed(2),
    y: +((r.top - base.top) / s).toFixed(2),
    w: +(r.width / s).toFixed(2),
    h: +(r.height / s).toFixed(2),
  });
  const cs = (el) => {
    const c = getComputedStyle(el);
    return {
      color: c.color, fontSize: c.fontSize, fontWeight: c.fontWeight, lineHeight: c.lineHeight,
      bg: c.backgroundColor, bgImage: c.backgroundImage.slice(0, 160),
      radius: c.borderTopLeftRadius, shadow: c.boxShadow.slice(0, 160),
      stroke: c.webkitTextStrokeWidth + ' ' + c.webkitTextStrokeColor,
      textShadow: c.textShadow.slice(0, 140), opacity: c.opacity,
      margin: c.marginTop + ' ' + c.marginRight + ' ' + c.marginBottom + ' ' + c.marginLeft,
      padding: c.paddingTop + ' ' + c.paddingRight + ' ' + c.paddingBottom + ' ' + c.paddingLeft,
      gap: c.gap, cols: c.gridTemplateColumns, aspect: c.aspectRatio, hidden: el.hidden === true,
    };
  };
  /**
   * 文字的**真实包围盒**（用 Range 量文本节点，不含 padding / border）。
   * 有了它才能把"Cocos 的 Label 节点中心"和"Web 里字真正画在哪"对齐 ——
   * 盒子里带 padding 的元素（例如表头里 .h-simple 有 padding-left 21 + border 6），
   * 盒中心并不是字的中心。
   */
  const tr = (el) => {
    if (el.children.length || !(el.textContent || '').trim()) return null;
    const r = document.createRange();
    r.selectNodeContents(el);
    const b = r.getBoundingClientRect();
    return {
      x: +((b.left - base.left) / s).toFixed(2),
      y: +((b.top - base.top) / s).toFixed(2),
      w: +(b.width / s).toFixed(2),
      h: +(b.height / s).toFixed(2),
    };
  };
  const out = [];
  for (const [k, sel] of Object.entries(KEYS)) {
    const el = document.querySelector(sel);
    if (!el) { out.push({ key: k, missing: true }); continue; }
    out.push(Object.assign({ key: k, cls: el.className, text: (el.textContent || '').trim().slice(0, 30) }, L(box(el)), cs(el), { textRect: tr(el) }));
  }
  return {
    screen: '${screenName}', stageScale: s, items: out,
${extra}
  };
})()`;
}

function webLeaderboardProbeSource() {
  const extra = `
    rowCount: Array.from(document.querySelectorAll('.lb-list .lb-row')).length,
    // 行间距：CSS gap 14px，这里用实测的相邻行顶边之差（行高 + 间距）
    rowPitch: (() => {
      const r = Array.from(document.querySelectorAll('.lb-list .lb-row'));
      return r.length > 1 ? +((box(r[1]).top - box(r[0]).top) / s).toFixed(2) : null;
    })(),
    podiumCount: Array.from(document.querySelectorAll('.lb-podium-item')).length,
    activeTab: (() => { const t = document.querySelector('.lb-tab.on'); return t ? t.textContent : null; })(),
    scrollTop: (() => { const sc = document.querySelector('.lb-scroll'); return sc ? sc.scrollTop : null; })(),`;
  return webKeysProbeSource(WEB_LB_KEYS, 'leaderboard', extra);
}

/* ------------------------------------------------------------------ 探针（Web · 图鉴整屏） */

/**
 * 图鉴 `#screen-collection`：整屏蓝天 + 棕返回钮 + 96px 标题 + 「已收集 x/y」+
 * 金框大卡内的 3 列贴纸卡网格（可滚）。
 * 进入方式：`--click=".tabbar .tab:nth-child(3)"`。
 */
const WEB_COL_KEYS = {
  screen: '#screen-collection',
  top: '.col-top',
  back: '.col-back',
  title: '.col-title',
  count: '.col-count',
  card: '.col-card',
  grid: '.col-grid',
  cell0: '.col-grid .col-cell:nth-child(1)',
  cell1: '.col-grid .col-cell:nth-child(2)',
  cell2: '.col-grid .col-cell:nth-child(3)',
  /** 第 2 行第 1 个（3 列网格 → nth-child(4)），用来量行距 */
  cellRow1: '.col-grid .col-cell:nth-child(4)',
  /** 贴纸图的位置 = 卡底切图的内框（CSS: left 6% / top 5% / 86%×89%） */
  img0: '.col-grid .col-cell:nth-child(1) .col-img',
  cellLocked: '.col-grid .col-cell.locked',
  tabbar: '#tabbar',
};

function webCollectionProbeSource() {
  const extra = `
    cellCount: Array.from(document.querySelectorAll('.col-grid .col-cell')).length,
    lockedCount: Array.from(document.querySelectorAll('.col-grid .col-cell.locked')).length,
    // 列/行的实测步距（grid 是 3 列 + gap 10px）
    colPitch: (() => {
      const c = Array.from(document.querySelectorAll('.col-grid .col-cell'));
      return c.length > 1 ? +((box(c[1]).left - box(c[0]).left) / s).toFixed(2) : null;
    })(),
    rowPitch: (() => {
      const c = Array.from(document.querySelectorAll('.col-grid .col-cell'));
      return c.length > 3 ? +((box(c[3]).top - box(c[0]).top) / s).toFixed(2) : null;
    })(),
    countText: (() => { const e = document.querySelector('.col-count'); return e ? e.textContent : null; })(),`;
  return webKeysProbeSource(WEB_COL_KEYS, 'collection', extra);
}

/* ------------------------------------------------------------------ 探针（Web · 设置整屏） */

/**
 * 设置 `#screen-settings`：整屏蓝天 + 棕返回钮 + 96px 标题 + 金框棕木卡
 * （卡内 4 行：音乐 / 音效 / 教学语音 / 新手教学「查看」）+ 卡下版本号。
 * 进入方式：`--click=".tabbar .tab:nth-child(4)"`。
 */
const WEB_SET_KEYS = {
  screen: '#screen-settings',
  top: '.set-top',
  back: '.set-back',
  title: '.set-title',
  card: '.set-card',
  rows: '.set-rows',
  row0: '.set-rows .set-row:nth-child(1)',
  row1: '.set-rows .set-row:nth-child(2)',
  row2: '.set-rows .set-row:nth-child(3)',
  row3: '.set-rows .set-row:nth-child(4)',
  icon0: '.set-rows .set-row:nth-child(1) .set-icon',
  label0: '.set-rows .set-row:nth-child(1) .set-label',
  toggle0: '.set-rows .set-row:nth-child(1) .set-toggle',
  toggle1: '.set-rows .set-row:nth-child(2) .set-toggle',
  toggle2: '.set-rows .set-row:nth-child(3) .set-toggle',
  tutLabel: '.set-rows .set-row:nth-child(4) .set-label',
  tutBtn: '.set-tutorial-btn',
  version: '.set-version',
  tabbar: '#tabbar',
};

function webSettingsProbeSource() {
  const extra = `
    rowCount: Array.from(document.querySelectorAll('.set-rows .set-row')).length,
    toggleImgs: Array.from(document.querySelectorAll('.set-toggle')).map((b) => b.style.backgroundImage.slice(0, 90)),
    versionText: (() => { const e = document.querySelector('.set-version'); return e ? e.textContent : null; })(),`;
  return webKeysProbeSource(WEB_SET_KEYS, 'settings', extra);
}

/* ------------------------------------------------------------------ 探针（Cocos / cc-shim） */

function cocosProbeSource() {
  return `(() => {
  const root = window.__game && window.__game.node;
  if (!root) return { error: 'window.__game 不存在（预览页没起来？）' };
  const comp = (n, name) => (n.comps || []).find((c) => c && c.constructor && c.constructor.name === name);
  const rgb = (c) => c ? 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + (c.a / 255).toFixed(3) + ')' : null;
  const out = [];
  const walk = (n, px, py, path) => {
    const p = n.getPosition ? n.getPosition() : { x: 0, y: 0 };
    const ax = px + (p.x || 0), ay = py + (p.y || 0);
    const t = comp(n, 'UITransform');
    const w = t ? (t.contentSize ? t.contentSize.width : t.width) : 0;
    const h = t ? (t.contentSize ? t.contentSize.height : t.height) : 0;
    // Cocos 中心原点 + y 向上  →  左上原点 + y 向下（与 CSS 对齐）
    const x = +(ax + 540 - w / 2).toFixed(2);
    const y = +(960 - (ay + h / 2)).toFixed(2);
    const lb = comp(n, 'Label');
    const g = comp(n, 'Graphics');
    const sp = comp(n, 'Sprite');
    const op = comp(n, 'UIOpacity');
    // key = 根到该节点的名字路径（GameCard/Topbar/HudTimer/TimerNum 这种），
    // 与 ui-diff.mjs 的 MAP 对齐；重名节点（如多个 Txt）靠路径区分。
    const key = path ? path + '/' + (n.name || '(anon)') : (n.name || '(anon)');
    const item = {
      key,
      x, y, w: +w.toFixed(2), h: +h.toFixed(2),
      opacity: op ? op.opacity / 255 : 1,
    };
    if (lb) {
      item.text = lb.string;
      item.fontSize = lb.fontSize;
      item.color = rgb(lb.color);
      item.lineHeight = lb.lineHeight;
      item.hAlign = lb.horizontalAlign;
    }
    if (g) {
      const cmds = (g.cmds || []).filter((c) => c.t === 'fill' || c.t === 'stroke').slice(0, 40);
      item.fills = (g.cmds || []).filter((c) => c.t === 'fill').map((c) => rgb(c.c)).slice(0, 40);
      item.strokes = (g.cmds || []).filter((c) => c.t === 'stroke').map((c) => rgb(c.c) + ' w' + c.w).slice(0, 40);
      item.cmdCount = (g.cmds || []).length;
      void cmds;
    }
    if (sp && sp.spriteFrame) item.sprite = sp.spriteFrame.name || '(sf)';
    out.push(item);
    for (const c of n.children || []) walk(c, ax, ay, key);
  };
  walk(root, 0, 0, '');
  return { screen: 'game', stageScale: 1, items: out, cells: out.filter((i) => /Cell_\\d+_\\d+$/.test(i.key)).sort((a, b) => a.y - b.y || a.x - b.x) };
})()`;
}

/**
 * 首页 / 地图屏探针：root = play.html 暴露的 window.__root。
 * 额外导出滚动状态（地图 content 节点的 y），因为地图是滚动容器，
 * 绝对坐标必须连同滚动位置一起看才有可比性。
 */
function cocosHomeProbeSource() {
  return `(() => {
  const root = window.__root;
  if (!root) return { error: 'window.__root 不存在（预览页没起来？）' };
  const comp = (n, name) => (n.comps || []).find((c) => c && c.constructor && c.constructor.name === name);
  const rgb = (c) => c ? 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + (c.a / 255).toFixed(3) + ')' : null;
  const out = [];
  const walk = (n, px, py, path) => {
    const p = n.getPosition ? n.getPosition() : { x: 0, y: 0 };
    const ax = px + (p.x || 0), ay = py + (p.y || 0);
    const t = comp(n, 'UITransform');
    const w = t ? (t.contentSize ? t.contentSize.width : t.width) : 0;
    const h = t ? (t.contentSize ? t.contentSize.height : t.height) : 0;
    const x = +(ax + 540 - w / 2).toFixed(2);
    const y = +(960 - (ay + h / 2)).toFixed(2);
    const lb = comp(n, 'Label');
    const sp = comp(n, 'Sprite');
    const op = comp(n, 'UIOpacity');
    const key = path ? path + '/' + (n.name || '(anon)') : (n.name || '(anon)');
    const item = { key, x, y, w: +w.toFixed(2), h: +h.toFixed(2), opacity: op ? op.opacity / 255 : 1 };
    if (lb) { item.text = lb.string; item.fontSize = lb.fontSize; item.color = rgb(lb.color); }
    if (sp && sp.spriteFrame) item.sprite = sp.spriteFrame.name || '(sf)';
    out.push(item);
    for (const c of n.children || []) walk(c, ax, ay, key);
  };
  walk(root, 0, 0, '');
  const nodes = out.filter((i) => /^Level_\\d+$/.test(i.key.split('/').pop() || ''));
  // 滚动状态：地图 content 节点的 y（首页地图是滚动容器，绝对坐标要看滚动位置才有可比性）
  const content = out.find((i) => i.key === 'Map/Scroll/Content') || out.find((i) => /Content$/.test(i.key));
  return {
    screen: 'home', stageScale: 1, items: out,
    levelNodes: nodes.sort((a, b) => a.y - b.y),
    scrollY: content ? content.y : null,
    contentKey: content ? content.key : null,
    saveRaw: (() => { try { return (localStorage.getItem('mengchong.save.v1') || '').slice(0, 300); } catch (e) { return 'ERR'; } })(),
    t1: window.__t1 || null,
    t2: window.__t2 || null,
  };
})()`;
}

/* ------------------------------------------------------------------ CDP */

async function httpJson(url, init) {
  const r = await fetch(url, init);
  return r.json();
}

async function ensureChrome() {
  try {
    return await httpJson(`http://127.0.0.1:${CDP_PORT}/json/version`);
  } catch {
    /* 没起就拉一个 */
  }
  const profile = path.join(os.tmpdir(), 'ui-dump-profile');
  spawn(
    BROWSER,
    [
      '--headless=new',
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--hide-scrollbars',
      '--mute-audio',
      '--force-device-scale-factor=1',
      'about:blank',
    ],
    { stdio: 'ignore', detached: true },
  ).unref();
  for (let i = 0; i < 80; i++) {
    await sleep(250);
    try {
      return await httpJson(`http://127.0.0.1:${CDP_PORT}/json/version`);
    } catch { /* 继续等 */ }
  }
  throw new Error('Chrome 远程调试端口没起来');
}

class Session {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { res, rej } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); rej(new Error(method + ' 超时')); }
      }, 30000);
    });
  }
}

/* ------------------------------------------------------------------ main */

const ver = await ensureChrome();
console.log('[cdp]', ver.Browser);

const target = await httpJson(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, { method: 'PUT' });
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
const cdp = new Session(ws);

await cdp.send('Page.enable');
await cdp.send('Runtime.enable');
await cdp.send('Log.enable');
// 视口尺寸单独可调：Web 版的 #stage 高度是 max(1920, availH/s)，
// 想让它正好等于 1080×1920（与 Cocos 设计分辨率对齐），视口高要取 1886
// （= 1920 - 2*EDGE_SAFE_Y 再让宽度方向成为缩放瓶颈），见 main.ts fitStage()。
const vw = Number(arg('w', Math.round(1080 * SCALE)));
const vh = Number(arg('h', Math.round(1920 * SCALE)));
await cdp.send('Emulation.setDeviceMetricsOverride', {
  width: vw, height: vh, deviceScaleFactor: 1, mobile: false,
});
await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: SCALE });

const errors = [];
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === 'Runtime.exceptionThrown') {
    errors.push((m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text || '').slice(0, 300));
  }
  if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) {
    const tag = m.params.type === 'error' ? 'console.error: ' : 'console.warn: ';
    errors.push(tag + String(m.params.args?.[0]?.value ?? '').slice(0, 200));
  }
});

console.log('[nav]', URL_);
await cdp.send('Page.navigate', { url: URL_ });
await sleep(WAIT);
if (argv.includes('--fresh')) {
  // 清本地存档再刷新：排除「继续上次的挑战」弹窗对画面的干扰
  await cdp.send('Runtime.evaluate', { expression: 'try { localStorage.clear(); sessionStorage.clear(); } catch {} location.reload();' });
  await sleep(WAIT);
  console.log('[fresh] 存档已清，已刷新');
}
const EVAL = arg('eval', '');
if (EVAL) {
  // 例：--eval "localStorage.setItem('mengchong.save.v1','{\"tutorial\":{\"seen\":true}}'); location.reload();"
  await cdp.send('Runtime.evaluate', { expression: EVAL });
  await sleep(WAIT);
  console.log('[eval] 已执行');
}

for (const tapXY of TAPS) {
  const [tx, ty] = String(tapXY).split(',').map(Number);
  const r = await cdp.send('Runtime.evaluate', {
    expression: `(() => {
  const cv = (window.__renderer && window.__renderer.canvas) || document.querySelector('canvas');
  if (!cv) return 'no canvas';
  try {
    // shim 会调 setPointerCapture，headless 下没这个实现 → 垫个空壳
    HTMLCanvasElement.prototype.setPointerCapture = function () {};
    HTMLCanvasElement.prototype.releasePointerCapture = function () {};
  } catch (e) {}
  const box = cv.getBoundingClientRect();
  const cx = box.left + (${tx} / 1080) * box.width;
  const cy = box.top + (${ty} / 1920) * box.height;
  const o = { bubbles: true, cancelable: true, clientX: cx, clientY: cy, pointerId: 1, pointerType: 'touch', isPrimary: true, buttons: 1 };
  cv.dispatchEvent(new PointerEvent('pointerdown', o));
  cv.dispatchEvent(new PointerEvent('pointerup', Object.assign({}, o, { buttons: 0 })));
  return 'tapped ${tx},${ty}';
})()`,
    returnByValue: true,
  });
  console.log('[tap]', tapXY, '→', r.result.value);
  await sleep(1600);
}

for (const sel of CLICKS) {
  const r = await cdp.send('Runtime.evaluate', {
    expression: `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return 'missing'; e.click(); return 'ok'; })()`,
    returnByValue: true,
  });
  console.log('[click]', sel, '→', r.result.value);
  await sleep(1500);
}

const src = PROBE === 'cocos-home'
  ? cocosHomeProbeSource()
  : PROBE.startsWith('cocos')
    ? cocosProbeSource()
    : PROBE === 'web-home'
      ? webHomeProbeSource()
      : PROBE === 'web-preview'
        ? webPreviewProbeSource()
        : PROBE === 'web-leaderboard'
          ? webLeaderboardProbeSource()
          : PROBE === 'web-collection'
            ? webCollectionProbeSource()
            : PROBE === 'web-settings'
              ? webSettingsProbeSource()
              : webProbeSource();
const res = await cdp.send('Runtime.evaluate', { expression: src, returnByValue: true, awaitPromise: true });
let data;
if (res.exceptionDetails) {
  data = { error: res.exceptionDetails.exception?.description || res.exceptionDetails.text };
} else {
  data = res.result.value;
}

if (SHOT) {
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  await mkdir(path.dirname(SHOT), { recursive: true });
  await writeFile(SHOT, Buffer.from(shot.data, 'base64'));
  console.log('[shot]', SHOT, `${vw}×${vh}`);
}

const payload = {
  url: URL_, probe: PROBE, at: new Date().toISOString(), viewport: [vw, vh],
  exceptions: errors, data,
};
if (OUT) {
  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(payload, null, 2), 'utf8');
  console.log('[out]', OUT);
} else {
  console.log(JSON.stringify(payload, null, 2));
}
console.log('[exceptions]', errors.length);
if (errors.length) console.log(errors.slice(0, 10).join('\n---\n'));
ws.close();
process.exit(0);
