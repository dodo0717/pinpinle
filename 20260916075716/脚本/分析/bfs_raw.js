const fs = require('fs');
const { PNG } = require('pngjs');

const src = 'C:/Users/fzswan/Downloads/图片节点 1 (11).png';
const png = PNG.sync.read(fs.readFileSync(src));
const W = png.width, H = png.height, data = png.data;
const SCALE = 1080 / W;

function rgb(x, y) {
  const i = (W * y + x) << 2;
  return [data[i], data[i + 1], data[i + 2]];
}

function isCheckerColor(p) {
  const [r, g, b] = p;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  if (mx - mn > 14) return false;
  const lum = (r + g + b) / 3;
  return lum >= 180 && lum <= 252;
}

const fg = new Uint8Array(W * H);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    fg[y * W + x] = isCheckerColor(rgb(x, y)) ? 0 : 1;
  }
}

const visited = new Uint8Array(W * H);
const stack = new Int32Array(W * H);
const blobs = [];

for (let sy = 0; sy < H; sy++) {
  for (let sx = 0; sx < W; sx++) {
    const idx = sy * W + sx;
    if (!fg[idx] || visited[idx]) continue;
    let sp = 0;
    stack[sp++] = idx;
    visited[idx] = 1;
    let minX = W, maxX = -1, minY = H, maxY = -1, area = 0;
    while (sp > 0) {
      const cur = stack[--sp];
      const cx = cur % W, cy = (cur / W) | 0;
      area++;
      if (cx < minX) minX = cx;
      if (cx > maxX) maxX = cx;
      if (cy < minY) minY = cy;
      if (cy > maxY) maxY = cy;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const ni = ny * W + nx;
          if (fg[ni] && !visited[ni]) { visited[ni] = 1; stack[sp++] = ni; }
        }
      }
    }
    blobs.push({ minX, maxX, minY, maxY, area });
  }
}

blobs.sort((a, b) => b.area - a.area);

console.log(`总连通域数: ${blobs.length}`);
console.log('\nTop 25 连通域（原图 bbox -> 1080x1920 Cocos 中心 -> 尺寸 -> 面积）:');
for (let i = 0; i < Math.min(25, blobs.length); i++) {
  const b = blobs[i];
  const cx = ((b.minX + b.maxX) / 2) * SCALE;
  const cy = ((b.minY + b.maxY) / 2) * SCALE;
  const w = (b.maxX - b.minX + 1) * SCALE;
  const h = (b.maxY - b.minY + 1) * SCALE;
  const cocosX = cx - 540;
  const cocosY = 960 - cy;
  console.log(
    `${String(i).padStart(2)} | (${String(b.minX).padStart(4)},${String(b.minY).padStart(4)})-(${String(b.maxX).padStart(4)},${String(b.maxY).padStart(4)}) ` +
    `| Cocos(${cocosX.toFixed(0).padStart(4)},${cocosY.toFixed(0).padStart(4)}) | ${w.toFixed(0)}x${h.toFixed(0)} | ${b.area}`
  );
}

// 保存所有连通域信息
const json = blobs.slice(0, 50).map(b => {
  const cx = ((b.minX + b.maxX) / 2) * SCALE;
  const cy = ((b.minY + b.maxY) / 2) * SCALE;
  return {
    bbox: [b.minX, b.minY, b.maxX, b.maxY],
    cocos: [+(cx - 540).toFixed(1), +(960 - cy).toFixed(1)],
    size: [+((b.maxX - b.minX + 1) * SCALE).toFixed(1), +((b.maxY - b.minY + 1) * SCALE).toFixed(1)],
    area: b.area
  };
});
fs.writeFileSync('C:/Users/fzswan/CodeBuddy/20260916075716/_tmp_analyze/blobs_raw.json', JSON.stringify(json, null, 2));
