/**
 * 关卡节点体检工具 —— 用数值回答两个肉眼很难判的问题：
 *   1. 每个关卡珠到底**点得到吗**？（照样没有屏幕，按 preview 自己的命中规则算每个珠心会被谁接走）
 *   2. 三色水晶球对不对？（3 星金 + 👑 / 1~2 星紫 / 未过关粉 / 锁定灰 + 🔒）
 *
 * 前置：本地服务 + Chrome/Edge 开了远程调试 9222（与 tools/ui-dump.mjs 同一套用法）
 *   node tools/check-nodes.mjs
 *
 * 它会塞一份「第 1 关 3 星 / 第 2 关 1 星 / 解锁到第 3 关」的存档，重载后取数 ——
 * 三个状态在同一屏里一次看全。
 */
const CDP_PORT = 9222;
const URL_ = 'http://127.0.0.1:5181/preview/play.html';

import { readFileSync, existsSync } from 'node:fs';

async function httpJson(url, init) { const r = await fetch(url, init); return r.json(); }
const target = await httpJson(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, { method: 'PUT' });
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res) => ws.addEventListener('open', res, { once: true }));

let seq = 0;
const pending = new Map();
const logs = [];
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id);
    pending.delete(m.id);
    m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
  } else if (m.method === 'Runtime.consoleAPICalled') {
    if (m.params.type === 'error') logs.push('error: ' + (m.params.args || []).map((a) => a.value ?? a.description).join(' '));
  } else if (m.method === 'Runtime.exceptionThrown') {
    logs.push('EXCEPTION: ' + (m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text));
  }
});
function send(method, params = {}) {
  const id = ++seq;
  return new Promise((res, rej) => { pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: URL_ });
await sleep(1500);
await send('Runtime.evaluate', {
  expression: `try{localStorage.setItem('mengchong.save.v1', JSON.stringify({
    version:1, savedAt: Date.now(), mode:'normal', session:null,
    meta:{ tutorial:{ seen:true, normalCleared:true, nightmareCleared:false, freeLevel:false } },
    progress:{
      normal:{ mode:'normal', unlocked:3, levels:{ '1':{ stars:3, best:100, attempts:1, unlocked:true }, '2':{ stars:1, best:50, attempts:1, unlocked:true } } },
      nightmare:{ mode:'nightmare', unlocked:1, levels:{} },
    }
  }));}catch(e){}; location.reload();`,
});
await sleep(9000);
const evalv = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return { error: (r.exceptionDetails.exception?.description || r.exceptionDetails.text || '').split('\n')[0] };
  return r.result.value;
};

/* ---------------------------------------------------------------- 1. 珠心命中 */
console.log('=== 关卡珠：珠心会被谁接走（应当是它自己）===');
const hits = await evalv(`(() => {
  const root = window.__root;
  const ut = (n) => (n.comps || []).find((c) => c && c.constructor && c.constructor.name === 'UITransform');
  const collect = (n, x, y, out) => {
    if (!n.active) return;
    for (let i = n.children.length - 1; i >= 0; i--) collect(n.children[i], x, y, out);
    const t = ut(n);
    if (!t || !n.worldPos || !(n._listeners && n._listeners.size)) return;
    const wp = n.worldPos();
    const hw = (t.width || 0) / 2, hh = (t.height || 0) / 2;
    if (x >= wp.x - hw && x <= wp.x + hw && y >= wp.y - hh && y <= wp.y + hh) out.push(n.name);
  };
  let content = null;
  const w = (n) => { if (n.name === 'Content') content = n; n.children.forEach(w); };
  w(root);
  const out = [];
  for (const c of content.children) {
    if (c.name.indexOf('Level_') !== 0) continue;
    const wp = c.worldPos();
    if (wp.y < -960 || wp.y > 960) continue;
    const arr = [];
    collect(root, wp.x, wp.y, arr);
    out.push({ lv: c.name, x: Math.round(wp.x), y: Math.round(wp.y), hit: arr[0], ok: arr[0] === c.name });
  }
  return out;
})()`);
let hitOk = true;
for (const h of hits) {
  if (!h.ok) hitOk = false;
  console.log(`  ${h.lv.padEnd(9)} 世界坐标(${String(h.x).padStart(5)},${String(h.y).padStart(5)}) → ${h.hit} ${h.ok ? '✅' : '❌ 点击被它上面那层接走了'}`);
}
console.log('  → 结论：' + (hitOk ? '全部关卡珠都能自己收到点击' : '有珠点不到，见上面 ❌'));

/* ---------------------------------------------------------------- 2. 三色球 */
console.log('=== 三色水晶果冻球 ===');
const EXPECT = { Level_1: 'rgb(255,198,62)', Level_2: 'rgb(154,95,240)', Level_3: 'rgb(255,143,200)' };
const beads = await evalv(`(() => {
  const root = window.__root;
  const comp = (n, name) => (n.comps || []).find((c) => c && c.constructor && c.constructor.name === name);
  let content = null;
  const w = (n) => { if (n.name === 'Content') content = n; n.children.forEach(w); };
  w(root);
  if (!content) return [];
  return content.children.filter((c) => c.name.indexOf('Level_') === 0).map((c) => {
    const bead = c.children.find((k) => k.name === 'Bead');
    const sp = bead && comp(bead, 'Sprite');
    return { lv: c.name, color: sp && sp.color ? 'rgb(' + sp.color.r + ',' + sp.color.g + ',' + sp.color.b + ')' : null, kids: c.children.map((k) => k.name).join('/') };
  });
})()`);
let colorOk = true;
for (const b of beads) {
  const want = EXPECT[b.lv];
  const ok = want ? b.color === want : (b.color === 'rgb(150,150,150)' || b.color === null);
  if (!ok) colorOk = false;
  console.log(`  ${b.lv.padEnd(9)} 珠色 ${String(b.color).padEnd(18)} 子节点 ${b.kids}` + (want ? `  期望 ${want}` : '  期望 灰(锁定)') + (ok ? ' ✅' : ' ❌'));
}
console.log('  → 结论：' + (colorOk ? '配色与登记口径一致（3星金+👑 / 1星紫 / 未过关粉 / 锁定灰+🔒）' : '有节点的配色不对'));

/* ---------------------------------------------------------------- 3. PLAY 吊牌链路 */
/**
 * 点第 1 关珠 → 弹 PLAY 吊牌 → 点 Play → 进玩法。顺手把吊牌几何与 Web 实测基准比对：
 * 基准来自 `docs/dump/web-preview.json`（`node tools/ui-dump.mjs --probe web-preview --click=".node"`），
 * 缺这份文件时只验链路、不比几何。
 */
console.log('=== PLAY 吊牌：点珠 → 吊牌 → Play → 进玩法 ===');
const tap = (x, y) => `(() => {
  const cv = (window.__renderer && window.__renderer.canvas) || document.querySelector('canvas');
  try {
    HTMLCanvasElement.prototype.setPointerCapture = function () {};
    HTMLCanvasElement.prototype.releasePointerCapture = function () {};
  } catch (e) {}
  const b = cv.getBoundingClientRect();
  const cx = b.left + (${x} / 1080) * b.width, cy = b.top + (${y} / 1920) * b.height;
  const o = { bubbles: true, cancelable: true, clientX: cx, clientY: cy, pointerId: 1, pointerType: 'touch', isPrimary: true, buttons: 1 };
  cv.dispatchEvent(new PointerEvent('pointerdown', o));
  cv.dispatchEvent(new PointerEvent('pointerup', Object.assign({}, o, { buttons: 0 })));
  return 'ok';
})()`;

// Web 基准（1080×1920、y 从顶向下）：docs/dump/web-preview.json
const WEB_PREVIEW = existsSync('docs/dump/web-preview.json')
  ? JSON.parse(readFileSync('docs/dump/web-preview.json', 'utf8')).data.items
  : null;
const webBox = (key) => {
  if (!WEB_PREVIEW) return null;
  const it = WEB_PREVIEW.find((i) => i.key === key && !i.missing);
  return it ? [it.x, it.y, it.w, it.h] : null;
};

const previewState = `(() => {
  const root = window.__root;
  const comp = (n, name) => (n.comps || []).find((c) => c && c.constructor && c.constructor.name === name);
  let lp = null, game = null;
  const w = (n) => { if (n.name === 'LevelPreview') lp = n; if (n.name === 'Game') game = n; n.children.forEach(w); };
  w(root);
  const box = (n) => {
    if (!n) return null;
    const p = n.worldPos ? n.worldPos() : { x: 0, y: 0 };
    const t = comp(n, 'UITransform');
    const wd = t ? (t.contentSize ? t.contentSize.width : t.width) : 0;
    const ht = t ? (t.contentSize ? t.contentSize.height : t.height) : 0;
    return [+(p.x + 540 - wd / 2).toFixed(2), +(960 - (p.y + ht / 2)).toFixed(2), +wd.toFixed(2), +ht.toFixed(2)];
  };
  const find = (n, name) => { if (!n) return null; for (const c of n.children) { if (c.name === name) return c; const r = find(c, name); if (r) return r; } return null; };
  const card = find(lp, 'card');
  const titleLabel = (() => { let t = null; const f = (n) => { if (n.name === 't' && comp(n, 'Label') && String(comp(n, 'Label').string).startsWith('第')) t = comp(n, 'Label').string; n.children.forEach(f); }; if (card) card.children.forEach(f); return t; })();
  return {
    open: !!lp && lp.active,
    title: titleLabel,
    boxes: {
      card: box(card),
      close: box(find(card, 'closeBtn')),
      modeNormal: box(find(card, 'mode-normal')),
      modeNightmare: box(find(card, 'mode-nightmare')),
      stars: box(find(card, 'stars')),
      play: box(find(card, 'play')),
    },
    gameActive: !!(game && game.active),
  };
})()`;

await evalv(tap(944, 1588));            // 第 1 关珠心
await sleep(1200);
const opened = await evalv(previewState);
console.log(`  点珠后：吊牌 open=${opened.open} 标题=${JSON.stringify(opened.title)}` + (opened.open ? ' ✅' : ' ❌ 吊牌没弹出来'));
if (opened.open && WEB_PREVIEW) {
  const pairs = [['card', 'lpCard'], ['close', 'lpClose'], ['modeNormal', 'lpMode0'], ['modeNightmare', 'lpMode1'], ['stars', 'lpStars'], ['play', 'lpPlay']];
  let geoOk = true;
  for (const [cc, wb] of pairs) {
    const wbv = webBox(wb), ccb = opened.boxes[cc];
    if (!wbv || !ccb) { console.log(`  ${cc.padEnd(12)} 基准或实际缺 → 跳过`); continue; }
    const d = wbv.map((v, i) => +(ccb[i] - v).toFixed(2));
    const ok = d.every((v) => Math.abs(v) <= 0.5);
    if (!ok) geoOk = false;
    console.log(`  ${cc.padEnd(12)} web=${wbv.join(',').padEnd(28)} cocos=${ccb.join(',').padEnd(28)} Δ=${d.join(',')}` + (ok ? ' ✅' : ' ❌'));
  }
  console.log('  → 吊牌几何：' + (geoOk ? '与 Web 实测逐项 ≤0.5px' : '有偏差，见上'));
}
await evalv(tap(540, 1144));            // Play（Web 实测中心 y=1143.5）
await sleep(2500);
const after = await evalv(previewState);
console.log(`  点 Play 后：Game active=${after.gameActive} 吊牌 open=${after.open}` + (after.gameActive ? ' ✅ 已进玩法' : ' ❌ 没进玩法'));

console.log('=== 控制台 ===');
console.log(logs.length ? logs.join('\n') : '(无)');
ws.close();
