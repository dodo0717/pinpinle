// 多尺度模板匹配：确定切片与源图的真实比例，并验证定位精度
import fs from 'node:fs';
import path from 'node:path';
import { decodePNG } from './png_locate.mjs';

function scaleImg(img, s) {
  const w = Math.max(1, Math.round(img.width * s)), h = Math.max(1, Math.round(img.height * s));
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = Math.min(img.width - 1, Math.round(x / s));
      const sy = Math.min(img.height - 1, Math.round(y / s));
      const si = (sy * img.width + sx) * 4, di = (y * w + x) * 4;
      out[di] = img.data[si]; out[di + 1] = img.data[si + 1]; out[di + 2] = img.data[si + 2]; out[di + 3] = img.data[si + 3];
    }
  }
  return { width: w, height: h, data: out };
}

function match(src, tpl, step, coarse) {
  const pts = [];
  for (let y = 0; y < tpl.height; y += step) {
    for (let x = 0; x < tpl.width; x += step) {
      const i = (y * tpl.width + x) * 4;
      if (tpl.data[i + 3] > 200) pts.push([x, y, tpl.data[i], tpl.data[i + 1], tpl.data[i + 2]]);
    }
  }
  if (pts.length < 20) return null;
  let best = { err: Infinity, x: -1, y: -1 };
  for (let sy = 0; sy + tpl.height <= src.height; sy += coarse) {
    for (let sx = 0; sx + tpl.width <= src.width; sx += coarse) {
      let sum = 0;
      for (const [px, py, r, g, b] of pts) {
        const i = ((sy + py) * src.width + (sx + px)) * 4;
        sum += Math.abs(src.data[i] - r) + Math.abs(src.data[i + 1] - g) + Math.abs(src.data[i + 2] - b);
      }
      const err = sum / (pts.length * 3);
      if (err < best.err) { best.err = err; best.x = sx; best.y = sy; }
    }
  }
  let fine = { ...best };
  const R = coarse + 1;
  for (let sy = Math.max(0, best.y - R); sy <= best.y + R; sy++) {
    for (let sx = Math.max(0, best.x - R); sx <= best.x + R; sx++) {
      if (sy + tpl.height > src.height || sx + tpl.width > src.width) continue;
      let sum = 0;
      for (const [px, py, r, g, b] of pts) {
        const i = ((sy + py) * src.width + (sx + px)) * 4;
        sum += Math.abs(src.data[i] - r) + Math.abs(src.data[i + 1] - g) + Math.abs(src.data[i + 2] - b);
      }
      const err = sum / (pts.length * 3);
      if (err < fine.err) { fine.err = err; fine.x = sx; fine.y = sy; }
    }
  }
  return { ...fine, pts: pts.length, w: tpl.width, h: tpl.height };
}

const src = decodePNG(process.argv[2]);
const tplDir = process.argv[3];
const names = process.argv.slice(4);
const scales = [0.40, 0.45, 0.50, 0.55, 0.60, 0.65, 0.70, 0.80, 0.90, 1.00];
console.log(`源图 ${src.width}x${src.height}`);
for (const n of names) {
  const tpl = decodePNG(path.join(tplDir, n));
  console.log(`\n${n}  原尺寸 ${tpl.width}x${tpl.height}`);
  let overall = null;
  for (const s of scales) {
    const sc = scaleImg(tpl, s);
    const r = match(src, sc, 4, 3);
    if (!r) continue;
    const cx = r.x + Math.round(sc.width / 2), cy = r.y + Math.round(sc.height / 2);
    const tag = r.err < 12 ? ' ✓' : (r.err < 25 ? ' ~' : '');
    console.log(`   scale ${s.toFixed(2)}  缩放后${sc.width}x${sc.height}  中心(${cx},${cy})  误差 ${r.err.toFixed(2)}${tag}`);
    if (!overall || r.err < overall.err) overall = { ...r, s, cx, cy };
  }
  if (overall) console.log(`   >>> 最佳 scale=${overall.s}  中心(${overall.cx},${overall.cy})  误差 ${overall.err.toFixed(2)}`);
}
