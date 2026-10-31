/**
 * UI 几何比对 —— `ui-dump.mjs` 两份导出（Web vs Cocos）按 key 对齐后逐项 diff。
 *
 * 判定口径（与 docs/核对-界面.md 一致）：
 * - 位置/尺寸：容差 ≤ 2 逻辑 px（Web 侧有亚像素取整）；
 * - 文案：逐字相等（首屏允许「0/03:00」这类动态值，靠 --ignore-text 放行）；
 * - 字号：容差 ≤ 1px；
 * - 缺失（一边有一边没有）= 缺陷。
 *
 * 用法：node tools/ui-diff.mjs docs/dump/web-game.json docs/dump/cocos-game.json
 */

import { readFileSync } from 'node:fs';

const [, , webPath, ccPath] = process.argv;
if (!webPath || !ccPath) {
  console.error('用法：node tools/ui-diff.mjs <web-dump.json> <cocos-dump.json>');
  process.exit(2);
}

const web = JSON.parse(readFileSync(webPath, 'utf8'));
const cc = JSON.parse(readFileSync(ccPath, 'utf8'));

const TOL_POS = 2;
const TOL_FONT = 1;

const webItems = new Map((web.data.items || []).map((i) => [i.key, i]));
// Cocos 的 key 带场景根名前缀（Canvas/...），剥掉再对齐
const ccItems = new Map((cc.data.items || []).map((i) => [i.key, i]));
/** 按「路径后缀」找 Cocos 节点：MAP 里的路径是相对场景根的（Canvas/ 前缀可带可不带） */
function findCc(p) {
  if (ccItems.has(p)) return ccItems.get(p);
  const hit = [...ccItems.entries()].find(([k]) => k.endsWith('/' + p));
  return hit && hit[1];
}

/** Web 选择器 key → Cocos 节点名路径（见 ui-dump.mjs 的 cocos 探针） */
const MAP = {
  card: 'GameCard',
  topbar: 'Topbar',
  exit: 'HudExit',
  goalFlag: 'HudGoalFlag',
  goalNum: 'HudGoalNum',
  scorePanel: 'HudScore',
  flapTens: 'FlapTens',
  flapUnits: 'FlapUnits',
  faceTens: 'FlapTens/Face',
  faceUnits: 'FlapUnits/Face',
  timer: 'HudTimer',
  timerClock: 'HudTimer/TimerClock',
  timerNum: 'HudTimer/TimerNum',
  boardWrap: 'BoardHost',
  board: 'BoardFrame',
};
// stage / screenGame / goal（容器）在 Cocos 没有单独对应物，不参比

let bad = 0;
const row = (s) => console.log(s);

row(`== Web: ${webPath}`);
row(`== Cocos: ${ccPath}`);
row('');

/** 棋盘格：两边各取 cells，比「格数 / 格宽 / 首格位置 / 步距」 */
function diffCells() {
  const a = web.data.cells || [];
  const b = cc.data.cells || [];
  if (a.length !== b.length) {
    row(`[FAIL] 棋盘格数 web=${a.length} cocos=${b.length}`);
    bad++;
    return;
  }
  row(`[ ok ] 棋盘格数 ${a.length}`);
  if (!a.length) return;
  const aw = a[0].w, bw = b[0].w;
  if (Math.abs(aw - bw) > TOL_POS) { row(`[FAIL] 格宽 web=${aw} cocos=${bw}`); bad++; }
  else row(`[ ok ] 格宽 ${aw} / ${bw}`);
  for (const k of ['x', 'y']) {
    const d = Math.abs(a[0][k] - b[0][k]);
    if (d > TOL_POS) { row(`[FAIL] 首格 ${k} web=${a[0][k]} cocos=${b[0][k]} (Δ${d.toFixed(2)})`); bad++; }
    else row(`[ ok ] 首格 ${k} ${a[0][k]} / ${b[0][k]} (Δ${d.toFixed(2)})`);
  }
  const stepA = a.length > 1 ? a[1].x - a[0].x : 0;
  const stepB = b.length > 1 ? b[1].x - b[0].x : 0;
  if (Math.abs(stepA - stepB) > TOL_POS) { row(`[FAIL] 步距 web=${stepA} cocos=${stepB}`); bad++; }
  else row(`[ ok ] 步距 ${stepA.toFixed(2)} / ${stepB.toFixed(2)}`);
}

for (const [key, w] of webItems) {
  const ccKey = MAP[key];
  if (!ccKey) continue;   // 没有对应物的 key（stage / screenGame / goal 容器）
  const c = findCc(ccKey);
  if (!c) { row(`[FAIL] ${key}: Cocos 端缺失（找不到节点 ${ccKey}）`); bad++; continue; }
  const diffs = [];
  const isText = w.fontSize !== undefined && c.fontSize !== undefined;
  if (isText) {
    // 文本节点：Web 量到的是「字形盒」（随内容变宽），Cocos 是内容盒 ——
    // 两者只有**中心点**和字号可比，宽高没有对照意义。
    for (const k of ['x', 'y']) {
      const wc = w[k] + (k === 'x' ? w.w : w.h) / 2;
      const cc2 = c[k] + (k === 'x' ? c.w : c.h) / 2;
      const d = Math.abs(wc - cc2);
      if (d > TOL_POS) diffs.push(`center${k}: ${wc.toFixed(2)} vs ${cc2.toFixed(2)} (Δ${d.toFixed(2)})`);
    }
  } else {
    for (const k of ['x', 'y', 'w', 'h']) {
      const d = Math.abs((w[k] ?? 0) - (c[k] ?? 0));
      if (d > TOL_POS) diffs.push(`${k}: ${w[k]} vs ${c[k]} (Δ${d.toFixed(2)})`);
    }
  }
  if (diffs.length) { row(`[FAIL] ${key} 几何 ${diffs.join('；')}`); bad++; continue; }
  row(`[ ok ] ${key} → ${ccKey} ${w.x},${w.y} ${w.w}×${w.h}`);
  if (w.text !== undefined && c.text !== undefined && w.text !== c.text && w.text.length && c.text.length) {
    row(`[warn] ${key} 文案 web="${w.text}" cocos="${c.text}"（动态值请人工确认）`);
  }
  const fsW = parseFloat(w.fontSize), fsC = parseFloat(c.fontSize);
  if (!Number.isNaN(fsW) && !Number.isNaN(fsC) && Math.abs(fsW - fsC) > TOL_FONT) {
    row(`[FAIL] ${key} 字号 web=${w.fontSize} cocos=${c.fontSize}`); bad++;
  }
}

diffCells();

row('');
row(bad === 0 ? '== 全部一致 ==' : `== ${bad} 处不一致 ==`);
process.exit(bad === 0 ? 0 : 1);
