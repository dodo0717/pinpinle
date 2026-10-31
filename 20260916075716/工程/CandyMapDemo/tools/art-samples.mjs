/**
 * 切图采样 —— 把 `web/art/**` 里的 PNG 铺到 canvas 上，**按真像素平均出颜色**，
 * 给 Cocos 端「程序绘制替代切图」提供依据（颜色不再靠肉眼估）。
 *
 * 用法：
 *   node tools/art-samples.mjs                 # 采样图鉴 + 设置两屏的切图（默认）
 *   node tools/art-samples.mjs collection      # 只采样某个目录
 *   node tools/art-samples.mjs leaderboard settings
 *   node tools/art-samples.mjs --all           # web/art 下所有 png
 *
 * 每张贴图的输出：
 *   size        原始像素尺寸
 *   avg         整图不透明像素的均色（Hex + rgb）
 *   vBands      纵向 6 等分各自的均色（自上而下 —— 看渐变方向用）
 *   hBands      横向 6 等分各自的均色（自左向右）
 *   inner       中心区域（四周各收 20%）的均色 —— 大面积主色
 *   corners     四角像素（左上/右上/左下/右下）—— 判断圆角是否透明
 *   alphaRatio  不透明像素占比（判断是不是圆角/镂空贴图）
 *
 * 前置：本地服务 5181 + Edge/Chrome 开远程调试 9222（与 tools/ui-dump.mjs 同一套用法）。
 */
const CDP_PORT = 9222;
const PAGE = 'http://127.0.0.1:5181/web/index.html';

import { readdirSync } from 'node:fs';

const args = process.argv.slice(2);
const all = args.includes('--all');
const groups = all
  ? readdirSync('web/art', { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
  : args.filter((a) => !a.startsWith('--'));
const want = groups.length ? groups : ['collection', 'settings'];

/** 列出每组的 PNG（相对 web/art 的路径） */
const files = [];
for (const g of want) {
  let names = [];
  try {
    names = readdirSync(`web/art/${g}`).filter((f) => f.toLowerCase().endsWith('.png'));
  } catch (e) {
    console.log(`⚠️ web/art/${g} 不存在或无 PNG`);
    continue;
  }
  for (const n of names) files.push(`${g}/${n}`);
}
if (!files.length) { console.log('没有要采样的文件'); process.exit(0); }

async function httpJson(url, init) { const r = await fetch(url, init); return r.json(); }
const target = await httpJson(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, { method: 'PUT' });
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res) => ws.addEventListener('open', res, { once: true }));

let seq = 0;
const pending = new Map();
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id);
    pending.delete(m.id);
    m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
  }
});
const send = (method, params = {}) =>
  new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: PAGE });
await sleep(2500);

/** 在页面里采样：返回值详见文件头注释 */
const sampleOne = (path) => `(() => new Promise((resolve) => {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    const cv = document.createElement('canvas');
    cv.width = img.naturalWidth; cv.height = img.naturalHeight;
    const ctx = cv.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const W = cv.width, H = cv.height;
    const d = ctx.getImageData(0, 0, W, H).data;
    const px = (x, y) => { const i = (y * W + x) * 4; return [d[i], d[i + 1], d[i + 2], d[i + 3]]; };
    /** 区域均色（只统计 alpha > 8 的像素） */
    const avg = (x0, y0, x1, y1) => {
      let r = 0, g = 0, b = 0, n = 0;
      for (let y = Math.max(0, y0 | 0); y < Math.min(H, y1 | 0); y++) {
        for (let x = Math.max(0, x0 | 0); x < Math.min(W, x1 | 0); x++) {
          const p = px(x, y);
          if (p[3] <= 8) continue;
          r += p[0]; g += p[1]; b += p[2]; n++;
        }
      }
      return n ? [Math.round(r / n), Math.round(g / n), Math.round(b / n)] : null;
    };
    let opaque = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 8) opaque++;
    const bands = (n, vertical) => Array.from({ length: n }, (_, i) => vertical
      ? avg(0, (H * i) / n, W, (H * (i + 1)) / n)
      : avg((W * i) / n, 0, (W * (i + 1)) / n, H));
    resolve({
      path: '${path}', size: [W, H],
      avg: avg(0, 0, W, H),
      vBands: bands(6, true),
      hBands: bands(6, false),
      inner: avg(W * 0.2, H * 0.2, W * 0.8, H * 0.8),
      corners: [px(0, 0), px(W - 1, 0), px(0, H - 1), px(W - 1, H - 1)],
      alphaRatio: +(opaque / (W * H)).toFixed(3),
    });
  };
  img.onerror = () => resolve({ path: '${path}', missing: true });
  img.src = '/web/art/${path}?t=' + Date.now();
}))()`;

const hex = (c) => (c ? '#' + c.slice(0, 3).map((v) => v.toString(16).padStart(2, '0')).join('') : '-');
const out = [];
for (const f of files) {
  const r = await send('Runtime.evaluate', { expression: sampleOne(f), returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) { console.log(`❌ ${f}: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`.split('\n')[0]); continue; }
  const s = r.result.value;
  out.push(s);
  if (s.missing) { console.log(`❌ ${f}: 加载失败`); continue; }
  console.log(`\n${f}  ${s.size[0]}×${s.size[1]}  不透明占比 ${s.alphaRatio}`);
  console.log(`  整图均色 ${hex(s.avg)} rgb(${s.avg})`);
  console.log(`  上→下     ${s.vBands.map(hex).join(' ')}`);
  console.log(`  左→右     ${s.hBands.map(hex).join(' ')}`);
  console.log(`  中心区     ${hex(s.inner)}`);
  console.log(`  四角       ${s.corners.map((c) => `${hex(c)}/a${c[3]}`).join('  ')}`);
}
ws.close();
