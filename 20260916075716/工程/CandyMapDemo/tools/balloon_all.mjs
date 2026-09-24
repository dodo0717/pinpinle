// 输出每种气球主色在源图中的所有候选连通块（不只最大块），解决同色气球冲突
import fs from 'node:fs';
import path from 'node:path';
import { decodePNG } from './png_locate.mjs';

function dominantColor(img) {
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i + 3] < 200) continue;
    const R = img.data[i], G = img.data[i + 1], B = img.data[i + 2];
    const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
    if (mn > 210 || mx < 40) continue;
    r += R; g += G; b += B; n++;
  }
  return n ? { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) } : null;
}

function blobs(src, col, tol, minArea) {
  const W = src.width, H = src.height, N = W * H;
  const mask = new Uint8Array(N);
  for (let i = 0, p = 0; i < src.data.length; i += 4, p++) {
    const d = Math.abs(src.data[i] - col.r) + Math.abs(src.data[i + 1] - col.g) + Math.abs(src.data[i + 2] - col.b);
    if (d < tol) mask[p] = 1;
  }
  // 膨胀 1 次，让被白色数字切开的色块连成一片
  const dil = new Uint8Array(N);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      if (!mask[p]) continue;
      dil[p] = 1;
      if (x > 0) dil[p - 1] = 1;
      if (x < W - 1) dil[p + 1] = 1;
      if (y > 0) dil[p - W] = 1;
      if (y < H - 1) dil[p + W] = 1;
    }
  }
  const seen = new Uint8Array(N);
  const out = [];
  for (let p0 = 0; p0 < N; p0++) {
    if (!dil[p0] || seen[p0]) continue;
    const q = [p0]; seen[p0] = 1;
    let head = 0, area = 0, minx = W, maxx = 0, miny = H, maxy = 0, sx = 0, sy = 0;
    while (head < q.length) {
      const c = q[head++];
      const x = c % W, y = (c / W) | 0;
      area++; sx += x; sy += y;
      if (x < minx) minx = x; if (x > maxx) maxx = x;
      if (y < miny) miny = y; if (y > maxy) maxy = y;
      if (x > 0 && dil[c - 1] && !seen[c - 1]) { seen[c - 1] = 1; q.push(c - 1); }
      if (x < W - 1 && dil[c + 1] && !seen[c + 1]) { seen[c + 1] = 1; q.push(c + 1); }
      if (y > 0 && dil[c - W] && !seen[c - W]) { seen[c - W] = 1; q.push(c - W); }
      if (y < H - 1 && dil[c + W] && !seen[c + W]) { seen[c + W] = 1; q.push(c + W); }
    }
    if (area >= minArea) {
      out.push({ area, minx, maxx, miny, maxy, cx: Math.round(sx / area), cy: Math.round(sy / area), w: maxx - minx + 1, h: maxy - miny + 1 });
    }
  }
  return out.sort((a, b) => b.area - a.area);
}

const src = decodePNG(process.argv[2]);
const tplDir = process.argv[3];
const tol = Number(process.argv[4] || 60);
const minArea = Number(process.argv[5] || 1200);
console.log(`源图 ${src.width}x${src.height}  tol=${tol} minArea=${minArea}`);
console.log('');
const files = fs.readdirSync(tplDir).filter(f => /^segment_(01[2-9]|02[01])\.png$/.test(f)).sort();
for (const f of files) {
  const tpl = decodePNG(path.join(tplDir, f));
  const col = dominantColor(tpl);
  if (!col) { console.log(f + ' 无主色'); continue; }
  const list = blobs(src, col, tol, minArea).slice(0, 4);
  console.log(`${f}  切片${tpl.width}x${tpl.height}  主色(${col.r},${col.g},${col.b})`);
  for (const b of list) {
    console.log(`     中心(${b.cx},${b.cy})  bbox ${b.w}x${b.h}  x:${b.minx}-${b.maxx} y:${b.miny}-${b.maxy}  面积${b.area}`);
  }
  if (!list.length) console.log('     (无候选)');
}
