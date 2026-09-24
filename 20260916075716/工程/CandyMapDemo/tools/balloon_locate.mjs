// 用「切片主色 → 源图同色连通块」定位气球在 source_original.png 中的位置
import fs from 'node:fs';
import path from 'node:path';
import { decodePNG } from './png_locate.mjs';

/** 切片主色：忽略透明、近白（数字/高光）、近黑（描边）像素 */
function dominantColor(img) {
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i + 3] < 200) continue;
    const R = img.data[i], G = img.data[i + 1], B = img.data[i + 2];
    const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
    if (mn > 210) continue;
    if (mx < 40) continue;
    r += R; g += G; b += B; n++;
  }
  if (!n) return null;
  return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n), n };
}

/** 在源图中找与 col 同色（tol 内）的最大连通块，返回包围盒与质心 */
function locateColor(src, col, tol) {
  const W = src.width, H = src.height, N = W * H;
  const mask = new Uint8Array(N);
  for (let i = 0, p = 0; i < src.data.length; i += 4, p++) {
    const d = Math.abs(src.data[i] - col.r) + Math.abs(src.data[i + 1] - col.g) + Math.abs(src.data[i + 2] - col.b);
    if (d < tol) mask[p] = 1;
  }
  const seen = new Uint8Array(N);
  let best = { area: 0 };
  for (let p0 = 0; p0 < N; p0++) {
    if (!mask[p0] || seen[p0]) continue;
    const q = [p0]; seen[p0] = 1;
    let head = 0, area = 0, minx = W, maxx = 0, miny = H, maxy = 0, sx = 0, sy = 0;
    while (head < q.length) {
      const c = q[head++];
      const x = c % W, y = (c / W) | 0;
      area++; sx += x; sy += y;
      if (x < minx) minx = x; if (x > maxx) maxx = x;
      if (y < miny) miny = y; if (y > maxy) maxy = y;
      if (x > 0 && mask[c - 1] && !seen[c - 1]) { seen[c - 1] = 1; q.push(c - 1); }
      if (x < W - 1 && mask[c + 1] && !seen[c + 1]) { seen[c + 1] = 1; q.push(c + 1); }
      if (y > 0 && mask[c - W] && !seen[c - W]) { seen[c - W] = 1; q.push(c - W); }
      if (y < H - 1 && mask[c + W] && !seen[c + W]) { seen[c + W] = 1; q.push(c + W); }
    }
    if (area > best.area) best = { area, minx, maxx, miny, maxy, cx: Math.round(sx / area), cy: Math.round(sy / area) };
  }
  return best.area ? best : null;
}

const srcPath = process.argv[2];
const tplDir = process.argv[3];
const tol = Number(process.argv[4] || 60);
const src = decodePNG(srcPath);
console.log(`源图: ${src.width}x${src.height}`);
console.log('');
console.log('切片'.padEnd(17) + '切片尺寸'.padEnd(12) + '主色RGB'.padEnd(16) + '源图包围盒'.padEnd(22) + '中心'.padEnd(14) + '面积');
const files = fs.readdirSync(tplDir).filter(f => /^segment_\d+\.png$/.test(f)).sort();
for (const f of files) {
  const tpl = decodePNG(path.join(tplDir, f));
  const col = dominantColor(tpl);
  if (!col) { console.log(f.padEnd(17) + '(无有效主色)'); continue; }
  const loc = locateColor(src, col, tol);
  if (!loc) { console.log(f.padEnd(17) + `${tpl.width}x${tpl.height}`.padEnd(12) + `(${col.r},${col.g},${col.b})`.padEnd(16) + '未找到'); continue; }
  const bw = loc.maxx - loc.minx + 1, bh = loc.maxy - loc.miny + 1;
  console.log(
    f.padEnd(17) +
    `${tpl.width}x${tpl.height}`.padEnd(12) +
    `(${col.r},${col.g},${col.b})`.padEnd(16) +
    `x:${loc.minx}-${loc.maxx} y:${loc.miny}-${loc.maxy}`.padEnd(22) +
    `(${loc.cx},${loc.cy})`.padEnd(14) +
    loc.area + `  [${bw}x${bh}]`
  );
}
