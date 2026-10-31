/**
 * 图鉴 / 设置两屏的体检：Web 基准 ↔ Cocos 预览逐项几何比对。
 * （排行榜的同款工具是 `tools/check-leaderboard.mjs`，两份的比对口径一致。）
 *
 * 基准过期就重采：
 *   # Web（先写一份 12 关 ×3 星的存档，图鉴才解锁到 3 张，行_elem=e + 字中心才量得到）
 *   node tools/ui-dump.mjs --url http://127.0.0.1:5181/web/index.html --probe web-collection \
 *     --click=".tabbar .tab:nth-child(3)" --out docs/dump/web-collection.json --w 1080 --h 1886 --eval "$SAVE"
 *   node tools/ui-dump.mjs --url http://127.0.0.1:5181/web/index.html --probe web-settings \
 *     --click=".tabbar .tab:nth-child(4)" --out docs/dump/web-settings.json --w 1080 --h 1886
 *
 *   # Cocos 预览（底栏页签按 1080×1920 逻辑坐标：图鉴 (611,1815) / 设置 (846,1815)）
 *   node tools/ui-dump.mjs --url http://127.0.0.1:5181/preview/play.html --probe cocos-home \
 *     --tap=611,1815 --out docs/dump/cocos-collection.json --w 1080 --h 1886
 *   node tools/ui-dump.mjs --url http://127.0.0.1:5181/preview/play.html --probe cocos-home \
 *     --tap=846,1815 --out docs/dump/cocos-settings.json --w 1080 --h 1886
 *
 * 比对口径（与排行榜一致）：
 *   - 容器元素比**盒**（x,y,w,h）；
 *   - 文字比**字的位置**：Web 用 Range 量出的 textRect 中心（或左对齐时的左边缘），
 *     Cocos 的 Label 用 middle baseline 画在节点中心 → 节点中心 = 字的中心。
 */
import { readFileSync } from 'node:fs';

const load = (f) => JSON.parse(readFileSync('docs/dump/' + f, 'utf8'));

/** 左对齐的文字：比左边缘（Web 的设置标签盒不含 flex 的剩余空间，Cocos 节点左缘 = 字左缘） */
const LEFT_ALIGN = new Set(['label0', 'tutLabel']);

/** [Web key, Cocos 相对路径（相对屏幕根节点）, 同名第几个（0 起）] */
const COLLECTION_MAP = [
  ['screen', '', 0],
  ['back', '/back', 0],
  ['title', '/t', 8],          // 8 份描边副本之后是主标题
  ['count', '/t', 10],         // 阴影副本之后是主计数
  ['card', '/card', 0],
  ['grid', '/card/grid', 0],
  ['cell0', '/card/grid/content/cell0', 0],
  ['cell1', '/card/grid/content/cell1', 0],
  ['cell2', '/card/grid/content/cell2', 0],
  ['cellRow1', '/card/grid/content/cell3', 0],
  /** 贴纸的位置 = 卡底切图的内框（Web `.col-img`：left 6% / top 5% / 86%×89%） */
  ['img0', '/card/grid/content/cell0/imgFrame', 0],
];

const SETTINGS_MAP = [
  ['screen', '', 0],
  ['back', '/back', 0],
  ['title', '/t', 8],
  ['card', '/card', 0],
  ['row0', '/card/row0', 0],
  ['row1', '/card/row1', 0],
  ['row2', '/card/row2', 0],
  ['row3', '/card/row-tutorial', 0],
  ['icon0', '/card/row0/icon', 0],
  ['label0', '/card/row0/t', 1],
  ['toggle0', '/card/row0/toggle', 0],
  ['toggle1', '/card/row1/toggle', 0],
  ['toggle2', '/card/row2/toggle', 0],
  ['tutLabel', '/card/row-tutorial/t', 1],
  ['tutBtn', '/card/row-tutorial/btn', 0],
  ['version', '/t', 10],       // 标题（8 份描边 + 主）之后是版本阴影 + 版本正文
];

function cmp(title, webFile, cocosFile, rootName, map) {
  const web = load(webFile).data.items;
  const cocos = load(cocosFile).data.items.filter((i) => i.key.includes(rootName));
  console.log(`=== ${title} ===`);
  let worst = 0;
  const bad = [];
  for (const [wk, path, idx] of map) {
    const w = web.find((i) => i.key === wk);
    const cc = cocos.filter((i) => i.key.replace(new RegExp('^.*' + rootName), '') === path)[idx];
    if (!w || w.missing) { console.log(`  ${wk.padEnd(11)} Web 基准缺 → 跳过`); continue; }
    if (!cc) { console.log(`  ${wk.padEnd(11)} ❌ Cocos 缺节点 ${path}`); bad.push(wk); continue; }

    let a, b, d, note;
    if (w.textRect && LEFT_ALIGN.has(wk)) {
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
      `  ${wk.padEnd(11)} ${note.padEnd(6)} web=${a.map((v) => +v.toFixed(2)).join(',').padEnd(28)} cocos=${b.map((v) => +v.toFixed(2)).join(',').padEnd(28)} Δ=${d.join(',').padEnd(16)}` + (ok ? '✅' : ' ❌'),
    );
  }
  console.log(`  → 最大偏差 ${worst}px` + (bad.length ? `，${bad.length} 项超差：${bad.join(' / ')}` : '，全部 ≤2.5px ✅'));
}

cmp('图鉴屏', 'web-collection.json', 'cocos-collection.json', 'CollectionScreen', COLLECTION_MAP);
cmp('设置屏', 'web-settings.json', 'cocos-settings.json', 'SettingsScreen', SETTINGS_MAP);
