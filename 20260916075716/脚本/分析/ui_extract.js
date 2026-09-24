const fs = require('fs');
const { PNG } = require('pngjs');

const src = 'C:/Users/fzswan/Downloads/图片节点 1 (11).png';
const png = PNG.sync.read(fs.readFileSync(src));
const W = png.width, H = png.height, data = png.data;
const SCALE = 1080 / W; // 0.9375

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

function isWoodColor(p) {
  const [r, g, b] = p;
  return r >= 170 && r <= 255 && g >= 110 && g <= 210 && b >= 50 && b <= 150 && r > g && g > b;
}

// 前景 mask
const fg = new Uint8Array(W * H);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    fg[y * W + x] = isCheckerColor(rgb(x, y)) ? 0 : 1;
  }
}

// 通用 BFS
function bfs(seedMask, label, filter) {
  const visited = new Uint8Array(W * H);
  const stack = new Int32Array(W * H);
  const blobs = [];
  for (let sy = 0; sy < H; sy++) {
    for (let sx = 0; sx < W; sx++) {
      const idx = sy * W + sx;
      if (!seedMask[idx] || visited[idx]) continue;
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
            if (seedMask[ni] && !visited[ni]) { visited[ni] = 1; stack[sp++] = ni; }
          }
        }
      }
      const b = { minX, maxX, minY, maxY, area };
      if (!filter || filter(b)) blobs.push(b);
    }
  }
  return blobs;
}

// ===== 1. 顶栏区域拆分 (y<240 原图, x<600 原图) =====
const topMask = new Uint8Array(W * H);
for (let y = 0; y < 240; y++) {
  for (let x = 0; x < 600; x++) {
    topMask[y * W + x] = fg[y * W + x];
  }
}
const topBlobs = bfs(topMask, 'top', b => b.area > 500).sort((a, b) => a.minX - b.minX);

// 头像框和昵称条可能连通，取最大 blob 用列投影谷点切分
let avatar = null, namePlate = null;
const topBlob = topBlobs.sort((a, b) => b.area - a.area)[0];
if (topBlob) {
  let splitX = -1, minC = Infinity;
  // 在 x 范围 110~180 原图之间找列投影最低点（切分头像框和昵称条）
  for (let x = topBlob.minX + 110; x < topBlob.maxX - 110 && x < 250; x++) {
    let c = 0;
    for (let y = topBlob.minY; y <= topBlob.maxY; y++) c += fg[y * W + x];
    if (c < minC) { minC = c; splitX = x; }
  }
  // 切分
  avatar = { ...topBlob, maxX: splitX };
  namePlate = { ...topBlob, minX: splitX + 1 };
}

// ===== 2. 体力条 (右上区域 y<180 原图, x>700) =====
const staminaMask = new Uint8Array(W * H);
for (let y = 0; y < 180; y++) {
  for (let x = 700; x < W; x++) {
    staminaMask[y * W + x] = fg[y * W + x];
  }
}
const staminaBlobs = bfs(staminaMask, 'stamina', b => b.area > 1000).sort((a, b) => b.area - a.area);
const stamina = staminaBlobs[0] || null;

// ===== 3. 模式按钮 (y 240-420 原图, x<560) =====
const modeMask = new Uint8Array(W * H);
for (let y = 240; y < 420; y++) {
  for (let x = 0; x < 560; x++) {
    modeMask[y * W + x] = fg[y * W + x];
  }
}
const modeBlobs = bfs(modeMask, 'mode', b => b.area > 1000).sort((a, b) => a.minX - b.minX);
const normalBtn = modeBlobs[0] || null;
const hardBtn = modeBlobs[1] || null;

// ===== 4. 左侧木牌 (x<200, y 800-1300) =====
const boardMask = new Uint8Array(W * H);
for (let y = 800; y < 1300; y++) {
  for (let x = 0; x < 200; x++) {
    boardMask[y * W + x] = fg[y * W + x];
  }
}
const boardBlobs = bfs(boardMask, 'board', b => b.area > 3000).sort((a, b) => b.area - a.area);
const leftBoard = boardBlobs[0] || null;

// ===== 5. 底部导航栏 (y>1650, 木色) =====
const navMask = new Uint8Array(W * H);
for (let y = 1650; y < H; y++) {
  for (let x = 0; x < W; x++) {
    navMask[y * W + x] = isWoodColor(rgb(x, y)) ? 1 : 0;
  }
}
const navBlobs = bfs(navMask, 'nav', b => b.area > 5000).sort((a, b) => b.area - a.area);
const navbar = navBlobs[0] || null;

// 输出函数
function fmt(b, name, interactive = true) {
  if (!b) return { name, found: false };
  const cxSrc = (b.minX + b.maxX) / 2;
  const cySrc = (b.minY + b.maxY) / 2;
  const wSrc = b.maxX - b.minX + 1;
  const hSrc = b.maxY - b.minY + 1;
  const cocosX = cxSrc * SCALE - 540;
  const cocosY = 960 - cySrc * SCALE;
  const w = wSrc * SCALE;
  const h = hSrc * SCALE;
  return {
    name,
    found: true,
    bbox1080: [+(b.minX * SCALE).toFixed(1), +(b.minY * SCALE).toFixed(1), +(b.maxX * SCALE).toFixed(1), +(b.maxY * SCALE).toFixed(1)],
    center1080: [+(cxSrc * SCALE).toFixed(1), +(cySrc * SCALE).toFixed(1)],
    size1080: [+w.toFixed(1), +h.toFixed(1)],
    cocosCenter: [+cocosX.toFixed(1), +cocosY.toFixed(1)],
    size: [+w.toFixed(1), +h.toFixed(1)],
    area: b.area,
    interactive
  };
}

const result = [
  fmt(avatar, '头像框'),
  fmt(namePlate, '昵称条木牌'),
  fmt(stamina, '体力条粉胶囊'),
  fmt(normalBtn, '普通按钮'),
  fmt(hardBtn, '困难按钮'),
  fmt(leftBoard, '左侧木牌装饰'),
  fmt(navbar, '底部导航木条'),
];

console.log('=== 1080x1920 下 UI 元素精确坐标（Cocos 原点居中，y向上） ===\n');
for (const r of result) {
  if (!r.found) { console.log(`${r.name}: ❌ 未识别`); continue; }
  const [cx, cy] = r.cocosCenter;
  const [w, h] = r.size;
  console.log(`${r.name.padEnd(12)} | Cocos中心(${cx.toFixed(0).padStart(4)}, ${cy.toFixed(0).padStart(4)}) | 尺寸 ${w.toFixed(0).padStart(4)}x${h.toFixed(0).padStart(3)} | 1080左上系中心(${r.center1080[0].toFixed(1)}, ${r.center1080[1].toFixed(1)}) | 面积 ${r.area}`);
}

fs.writeFileSync('C:/Users/fzswan/CodeBuddy/20260916075716/_tmp_analyze/ui_blobs.json', JSON.stringify(result, null, 2));
console.log('\n已保存 -> _tmp_analyze/ui_blobs.json');
