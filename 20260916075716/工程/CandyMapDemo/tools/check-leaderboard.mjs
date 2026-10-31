/**
 * 排行榜体检：Web 基准 ↔ Cocos 预览逐项几何比对（总分榜 + 关卡榜）。
 *
 * 基准是 Web 实测（docs/dump/web-leaderboard*.json），Cocos 侧是预览页实测
 * （docs/dump/cocos-leaderboard*.json）。基准过期就重采：
 *
 *   # Web（总分榜 / 关卡榜，视口 1080×1886 让 #stage 正好 1080×1920）
 *   node tools/ui-dump.mjs --url http://127.0.0.1:5181/web/index.html --probe web-leaderboard \
 *     --click=".tabbar .tab:nth-child(2)" --out docs/dump/web-leaderboard.json --w 1080 --h 1886 \
 *     --eval "<写存档>; location.reload();"
 *   # 关卡榜再叠一个 --click=".lb-tabs .lb-tab:nth-child(2)"，输出 web-leaderboard-level.json
 *
 *   # Cocos 预览（tap = 1080×1920 逻辑坐标；底栏第 2 页签 (376,1815) 打开排行榜，
 *   # 再 tap 关卡榜 Tab (740,368) 切到关卡榜）
 *   node tools/ui-dump.mjs --url http://127.0.0.1:5181/preview/play.html --probe cocos-home \
 *     --tap=376,1815 --out docs/dump/cocos-leaderboard.json --w 1080 --h 1886
 *
 * 文字节点比的是**字的位置**（Web 用 Range 量 textRect，Cocos 的 Label 用 middle baseline
 * 画在节点中心）—— 盒子带 padding 的元素（如表头的昵称列）盒中心不是字的中心。
 */
import { readFileSync } from 'node:fs';

const load = (f) => JSON.parse(readFileSync('docs/dump/' + f, 'utf8'));

/** Web key → Cocos 节点路径（相对 `Canvas/Map/LeaderboardScreen`）+ 同名第几个（0 起） */
const TOTAL_MAP = [
  ['screen', '', 0],
  ['back', '/back', 0],
  ['title', '/t', 8],
  ['card', '/card', 0],
  ['tabTotal', '/card/btn', 0],
  ['tabLevel', '/card/btn', 1],
  ['mineCard', '/card/mine', 0],
  ['mineCell0', '/card/mine/cell0', 0],
  ['mineCell1', '/card/mine/cell1', 0],
  ['mineCell2', '/card/mine/cell2', 0],
  ['podium', '/card/podium', 0],
  ['podiumSilver', '/card/podium/podium0', 0],
  ['podiumGold', '/card/podium/podium1', 0],
  ['podiumBronze', '/card/podium/podium2', 0],
  ['cupGold', '/card/podium/podium1/cup', 0],
  ['cupSilver', '/card/podium/podium0/cup', 0],
  ['baseGold', '/card/podium/podium1/base', 0],
  ['baseSilver', '/card/podium/podium0/base', 0],
  ['baseNum', '/card/podium/podium1/base/t', 0],
  ['thead', '/card/thead', 0],
  ['theadRank', '/card/thead/t', 0],
  ['theadName', '/card/thead/t', 1],
  ['theadSimple', '/card/thead/t', 2],
  ['theadHard', '/card/thead/t', 3],
  ['theadTotal', '/card/thead/t', 4],
  ['scroll', '/card/list', 0],
  ['row0', '/card/list/content/row0', 0],
  ['row1', '/card/list/content/row1', 0],
  ['medal', '/card/list/content/row0/medal', 0],
  ['rankNum', '/card/list/content/row4/rank', 0],
  ['av', '/card/list/content/row0/avatar', 0],
  ['nm', '/card/list/content/row0/t', 0],
  ['cSimple', '/card/list/content/row0/t', 1],
  ['cHard', '/card/list/content/row0/t', 2],
  ['cTotal', '/card/list/content/row0/t', 3],
  ['pager', '/card/pager', 0],
  ['pagePrev', '/card/pager/btn', 0],
  ['pageLabel', '/card/pager/t', 0],
  ['pageNext', '/card/pager/btn', 1],
];

const LEVEL_MAP = [
  ['card', '/card', 0],
  ['meta', '/card/meta', 0],
  ['stepPrev', '/card/meta/btn', 0],
  ['levelSelect', '/card/meta/select', 0],
  ['stepNext', '/card/meta/btn', 1],
  ['mineCard', '/card/mine', 0],
  ['podium', '/card/podium', 0],
  ['thead', '/card/thead', 0],
  ['scroll', '/card/list', 0],
  ['row0', '/card/list/content/row0', 0],
  ['pager', '/card/pager', 0],
  ['challenge', '/card/btn', 2],
];

/**
 * 文字节点比的是**字的位置**而不是盒：Web 用 Range 量出的 textRect，Cocos 用 Label 节点。
 * 居中文字比中心；左对齐文字比左边缘（Web 的昵称列带 padding-left，盒左 ≠ 字左）。
 */
const LEFT_ALIGN = new Set(['theadName']);

function cmp(title, webFile, cocosFile, map) {
  const web = load(webFile).data.items;
  const cocos = load(cocosFile).data.items.filter((i) => i.key.includes('LeaderboardScreen'));
  console.log(`=== ${title} ===`);
  let worst = 0;
  const bad = [];
  for (const [wk, path, idx] of map) {
    const w = web.find((i) => i.key === wk);
    const cc = cocos.filter((i) => i.key.replace(/^Canvas\/Map\/LeaderboardScreen/, '') === path)[idx];
    if (!w || w.missing) { console.log(`  ${wk.padEnd(12)} Web 基准缺 → 跳过`); continue; }
    if (!cc) { console.log(`  ${wk.padEnd(12)} ❌ Cocos 缺节点 ${path}`); bad.push(wk); continue; }

    let a, b, d, note = '';
    // Cocos 的 Label：shim 用 middle baseline 画在节点中心 → **节点中心 = 字的中心**
    if (w.textRect && LEFT_ALIGN.has(wk)) {
      // 左对齐：Cocos 里字的左缘 = 节点盒左边（shim 用 x=-w/2 + textAlign=left）
      a = [w.textRect.x, w.textRect.y + w.textRect.h / 2];
      b = [cc.x, cc.y + cc.h / 2];
      d = [+(b[0] - a[0]).toFixed(2), +(b[1] - a[1]).toFixed(2)];
      note = '字左缘';
    } else if (w.textRect) {
      a = [w.textRect.x + w.textRect.w / 2, w.textRect.y + w.textRect.h / 2];
      b = [cc.x + cc.w / 2, cc.y + cc.h / 2];
      d = [+(b[0] - a[0]).toFixed(2), +(b[1] - a[1]).toFixed(2)];
      note = '字中心';
    } else {
      a = [w.x, w.y, w.w, w.h];
      b = [cc.x, cc.y, cc.w, cc.h];
      d = a.map((v, i) => +(b[i] - v).toFixed(2));
      note = '盒';
    }
    const m = Math.max(...d.map(Math.abs));
    worst = Math.max(worst, m);
    const ok = m <= 2.5;
    if (!ok) bad.push(wk);
    console.log(
      `  ${wk.padEnd(12)} ${note.padEnd(6)} web=${a.map((v) => +v.toFixed(2)).join(',').padEnd(28)} cocos=${b.map((v) => +v.toFixed(2)).join(',').padEnd(28)} Δ=${d.join(',').padEnd(16)}` + (ok ? '✅' : '❌'),
    );
  }
  console.log(`  → 最大偏差 ${worst}px` + (bad.length ? `，${bad.length} 项超差：${bad.join(' / ')}` : '，全部 ≤2.5px ✅'));
}

cmp('总分榜', 'web-leaderboard.json', 'cocos-leaderboard.json', TOTAL_MAP);
cmp('关卡榜', 'web-leaderboard-level.json', 'cocos-leaderboard-level.json', LEVEL_MAP);
