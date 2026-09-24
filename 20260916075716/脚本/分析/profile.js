const fs = require('fs');
const { PNG } = require('pngjs');

const src = 'C:/Users/fzswan/Downloads/图片节点 1 (11).png';
const png = PNG.sync.read(fs.readFileSync(src));
const W = png.width, H = png.height, data = png.data;

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

// 前景 mask（非棋盘格）
const fg = new Uint8Array(W * H);
let fgCount = 0;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const p = rgb(x, y);
    fg[y * W + x] = isCheckerColor(p) ? 0 : 1;
    if (fg[y * W + x]) fgCount++;
  }
}
console.log(`前景像素比例: ${(fgCount / (W * H) * 100).toFixed(1)}%`);

// ===== 行投影 =====
console.log('\n=== 行投影（每行前景像素数，采样步长 8）===');
const rowCounts = [];
for (let y = 0; y < H; y++) {
  let c = 0;
  for (let x = 0; x < W; x++) c += fg[y * W + x];
  rowCounts.push(c);
}
// 找出连续有内容的 y 段
function segments(arr, thresh) {
  const segs = [];
  let start = -1;
  for (let i = 0; i < arr.length; i++) {
    const on = arr[i] > thresh;
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      if (i - start > 3) segs.push([start, i - 1]);
      start = -1;
    }
  }
  if (start >= 0) segs.push([start, arr.length - 1]);
  return segs;
}

const rowSegs = segments(rowCounts, W * 0.02); // >2% 宽度视为有内容
const SCALE = 1080 / W;
console.log('y区间(原图) -> 映射到1920高:');
for (const [a, b] of rowSegs) {
  console.log(`  y ${a}-${b} (高 ${b - a + 1})  ->  ${(a * SCALE).toFixed(0)}-${(b * SCALE).toFixed(0)}   Cocos y: ${(960 - b * SCALE).toFixed(0)} ~ ${(960 - a * SCALE).toFixed(0)}   峰值密度 ${Math.max(...rowCounts.slice(a, b + 1))}`);
}

// ===== 列投影（针对每个 y 段）=====
console.log('\n=== 各 y 段内的列投影（找水平分段）===');
for (const [ya, yb] of rowSegs) {
  const colCounts = [];
  for (let x = 0; x < W; x++) {
    let c = 0;
    for (let y = ya; y <= yb; y++) c += fg[y * W + x];
    colCounts.push(c);
  }
  const colSegs = segments(colCounts, 2);
  const parts = colSegs.map(([a, b]) => {
    const cx = (a + b) / 2;
    return `x${a}-${b}(Cocos ${(cx * SCALE - 540).toFixed(0)}, w${((b - a + 1) * SCALE).toFixed(0)})`;
  });
  console.log(`y ${ya}-${yb}: ${parts.length} 段 -> ${parts.join(' | ')}`);
}
