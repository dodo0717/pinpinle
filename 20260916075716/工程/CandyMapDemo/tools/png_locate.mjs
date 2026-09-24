// 零依赖 PNG 解码 + 模板匹配：定位气球切片在设计稿 source_original.png 中的精确坐标
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';

export function decodePNG(file) {
  const buf = fs.readFileSync(file);
  let off = 8;
  let ihdr = null;
  const idat = [];
  let plte = null, trns = null;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      ihdr = {
        width: data.readUInt32BE(0), height: data.readUInt32BE(4),
        bitDepth: data[8], colorType: data[9], interlace: data[12],
      };
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'PLTE') plte = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (!ihdr) throw new Error('no IHDR: ' + file);
  if (ihdr.bitDepth !== 8) throw new Error('unsupported bitDepth ' + ihdr.bitDepth + ' @ ' + file);
  if (ihdr.interlace !== 0) throw new Error('interlaced unsupported @ ' + file);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ihdr.colorType];
  const bpp = ch, stride = ihdr.width * bpp;
  const out = Buffer.alloc(ihdr.width * ihdr.height * 4);
  const prev = Buffer.alloc(stride), cur = Buffer.alloc(stride);
  let p = 0;
  for (let y = 0; y < ihdr.height; y++) {
    const ft = raw[p++];
    raw.copy(cur, 0, p, p + stride);
    p += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v = cur[i];
      if (ft === 1) v = (v + a) & 255;
      else if (ft === 2) v = (v + b) & 255;
      else if (ft === 3) v = (v + ((a + b) >> 1)) & 255;
      else if (ft === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        const pr = (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
        v = (v + pr) & 255;
      }
      cur[i] = v;
    }
    for (let x = 0; x < ihdr.width; x++) {
      const s = x * bpp, d = (y * ihdr.width + x) * 4;
      if (ihdr.colorType === 6) {
        out[d] = cur[s]; out[d + 1] = cur[s + 1]; out[d + 2] = cur[s + 2]; out[d + 3] = cur[s + 3];
      } else if (ihdr.colorType === 2) {
        out[d] = cur[s]; out[d + 1] = cur[s + 1]; out[d + 2] = cur[s + 2]; out[d + 3] = 255;
      } else if (ihdr.colorType === 3) {
        const idx = cur[s];
        out[d] = plte[idx * 3]; out[d + 1] = plte[idx * 3 + 1]; out[d + 2] = plte[idx * 3 + 2];
        out[d + 3] = trns && idx < trns.length ? trns[idx] : 255;
      } else if (ihdr.colorType === 4) {
        out[d] = cur[s]; out[d + 1] = cur[s]; out[d + 2] = cur[s]; out[d + 3] = cur[s + 1];
      } else {
        out[d] = cur[s]; out[d + 1] = cur[s]; out[d + 2] = cur[s]; out[d + 3] = 255;
      }
    }
    cur.copy(prev);
  }
  return { width: ihdr.width, height: ihdr.height, data: out, colorType: ihdr.colorType };
}

/** 采样点：只取切片不透明区域的稀疏点，用于比对 */
function samplePoints(img, step) {
  const pts = [];
  for (let y = 0; y < img.height; y += step) {
    for (let x = 0; x < img.width; x += step) {
      const i = (y * img.width + x) * 4;
      if (img.data[i + 3] > 200) pts.push([x, y, img.data[i], img.data[i + 1], img.data[i + 2]]);
    }
  }
  return pts;
}

/** 粗搜 + 精搜的模板匹配，返回最佳左上角坐标与平均通道误差 */
export function locate(src, tpl) {
  const step = 3;
  const pts = samplePoints(tpl, step);
  if (!pts.length) return null;
  const best = { x: -1, y: -1, err: Infinity };
  for (let sy = 0; sy + tpl.height <= src.height; sy += 2) {
    for (let sx = 0; sx + tpl.width <= src.width; sx += 2) {
      let sum = 0;
      for (const [px, py, r, g, b] of pts) {
        const i = ((sy + py) * src.width + (sx + px)) * 4;
        sum += Math.abs(src.data[i] - r) + Math.abs(src.data[i + 1] - g) + Math.abs(src.data[i + 2] - b);
      }
      const err = sum / (pts.length * 3);
      if (err < best.err) { best.err = err; best.x = sx; best.y = sy; }
    }
  }
  // 精搜：粗搜结果 ±3 全步长
  let fine = { x: best.x, y: best.y, err: best.err };
  for (let sy = Math.max(0, best.y - 3); sy <= best.y + 3; sy++) {
    for (let sx = Math.max(0, best.x - 3); sx <= best.x + 3; sx++) {
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
  return { ...fine, samples: pts.length };
}

// CLI
if (process.argv[1].endsWith('png_locate.mjs')) {
  const srcPath = process.argv[2];
  const tplDir = process.argv[3];
  const src = decodePNG(srcPath);
  console.log(`源图 ${path.basename(srcPath)}: ${src.width}x${src.height}  colorType=${src.colorType}`);
  const files = fs.readdirSync(tplDir).filter(f => /^segment_\d+\.png$/.test(f)).sort();
  console.log('');
  console.log('切片'.padEnd(18) + '尺寸'.padEnd(12) + '左上角(x,y)'.padEnd(18) + '中心(x,y)'.padEnd(18) + '平均误差');
  for (const f of files) {
    const tpl = decodePNG(path.join(tplDir, f));
    const r = locate(src, tpl);
    if (!r) { console.log(f.padEnd(18) + '(全透明)'); continue; }
    const cx = Math.round(r.x + tpl.width / 2), cy = Math.round(r.y + tpl.height / 2);
    console.log(
      f.padEnd(18) +
      `${tpl.width}x${tpl.height}`.padEnd(12) +
      `(${r.x},${r.y})`.padEnd(18) +
      `(${cx},${cy})`.padEnd(18) +
      r.err.toFixed(2) + (r.err < 6 ? '  ✓匹配' : '  ?存疑')
    );
  }
}
