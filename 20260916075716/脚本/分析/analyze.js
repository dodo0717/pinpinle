const fs = require('fs');
const { PNG } = require('pngjs');

const src = 'C:/Users/fzswan/Downloads/图片节点 1 (11).png';
const png = PNG.sync.read(fs.readFileSync(src));
const W = png.width, H = png.height;
const data = png.data;

const SCALE = 1080 / W;   // 1152 -> 1080
const TARGET_W = 1080, TARGET_H = 1920;

function rgb(x, y) {
  if (x < 0 || y < 0 || x >= W || y >= H) return null;
  const i = (W * y + x) << 2;
  return [data[i], data[i + 1], data[i + 2]];
}

/** 判断像素是否属于棋盘格（灰阶 + 亮度落在格子的两种灰之间） */
function isCheckerColor(p) {
  if (!p) return false;
  const [r, g, b] = p;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  if (mx - mn > 12) return false;            // 必须是灰阶
  const lum = (r + g + b) / 3;
  return (lum >= 186 && lum <= 252);          // 覆盖亮格(~241)与暗格(~203)
}

console.log(`原图 ${W}x${H}，缩放系数 ${SCALE.toFixed(4)}，目标 ${TARGET_W}x${TARGET_H}`);

// ===== 1. 背景 mask：邻域内多数为棋盘格色 → 背景 =====
const isBg = new Uint8Array(W * H);
const RAD = 2; // 5x5 邻域
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    let cnt = 0, tot = 0;
    for (let dy = -RAD; dy <= RAD; dy++) {
      for (let dx = -RAD; dx <= RAD; dx++) {
        tot++;
        if (isCheckerColor(rgb(x + dx, y + dy))) cnt++;
      }
    }
    isBg[y * W + x] = (cnt / tot) > 0.55 ? 1 : 0;
  }
}

// ===== 2. 形态学开运算去噪（腐蚀 + 膨胀）=====
function morph(srcArr, erodeFirst) {
  const tmp = new Uint8Array(W * H);
  const out = new Uint8Array(W * H);
  const R = 1;
  for (let pass = 0; pass < 2; pass++) {
    const input = pass === 0 ? srcArr : tmp;
    const output = pass === 0 ? tmp : out;
    const mode = (pass === 0) === erodeFirst ? 0 : 1; // 0=腐蚀 1=膨胀
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let all = 1, any = 0;
        for (let dy = -R; dy <= R; dy++) {
          for (let dx = -R; dx <= R; dx++) {
            const nx = x + dx, ny = y + dy;
            const v = (nx < 0 || ny < 0 || nx >= W || ny >= H) ? 1 : input[ny * W + nx];
            if (!v) all = 0; else any = 1;
          }
        }
        output[y * W + x] = mode === 0 ? all : any;
      }
    }
  }
  return out;
}

// 前景 = 非背景，先膨胀再腐蚀（闭运算）填补小孔，再腐蚀去孤立点
const fgRaw = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) fgRaw[i] = isBg[i] ? 0 : 1;
const fg = morph(morph(fgRaw, true), false);

// ===== 3. 连通域 BFS =====
const visited = new Uint8Array(W * H);
const blobs = [];
const stack = new Int32Array(W * H);

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

const MIN_AREA = 1200; // 过滤小噪点
const kept = blobs.filter(b => b.area >= MIN_AREA);

console.log(`\n连通域总数 ${blobs.length}，过滤后(面积>=${MIN_AREA}) ${kept.length} 个\n`);

function toCocos(cxSrc, cySrc) {
  // 原图(左上原点,y向下) -> 目标1080x1920 -> Cocos(中心原点,y向上)
  const cx = cxSrc * SCALE;
  const cy = cySrc * SCALE;
  return { x: cx - TARGET_W / 2, y: TARGET_H / 2 - cy };
}

console.log('索引 | 原图 bbox (x0,y0)-(x1,y1) | 中心(1080x1920左上系) | 尺寸 | Cocos中心(x,y) | 面积');
kept.forEach((b, i) => {
  const cxSrc = (b.minX + b.maxX) / 2;
  const cySrc = (b.minY + b.maxY) / 2;
  const wSrc = b.maxX - b.minX + 1;
  const hSrc = b.maxY - b.minY + 1;
  const cx = cxSrc * SCALE, cy = cySrc * SCALE;
  const w = wSrc * SCALE, h = hSrc * SCALE;
  const c = toCocos(cxSrc, cySrc);
  console.log(
    `${String(i).padStart(3)} | (${b.minX},${b.minY})-(${b.maxX},${b.maxY}) | (${cx.toFixed(0)},${cy.toFixed(0)}) | ${w.toFixed(0)}x${h.toFixed(0)} | (${c.x.toFixed(0)},${c.y.toFixed(0)}) | ${b.area}`
  );
});

// 保存裁剪信息到 JSON
const outPath = 'C:/Users/fzswan/CodeBuddy/20260916075716/_tmp_analyze/blobs.json';
fs.writeFileSync(outPath, JSON.stringify(kept.map(b => {
  const cxSrc = (b.minX + b.maxX) / 2, cySrc = (b.minY + b.maxY) / 2;
  const c = toCocos(cxSrc, cySrc);
  return {
    bboxSrc: [b.minX, b.minY, b.maxX, b.maxY],
    center1080: [+(cxSrc * SCALE).toFixed(1), +(cySrc * SCALE).toFixed(1)],
    size1080: [+((b.maxX - b.minX + 1) * SCALE).toFixed(1), +((b.maxY - b.minY + 1) * SCALE).toFixed(1)],
    cocosCenter: [+c.x.toFixed(1), +c.y.toFixed(1)],
    area: b.area,
  };
}), null, 2));
console.log(`\n已保存 -> ${outPath}`);
