const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const src = 'C:/Users/fzswan/Downloads/图片节点 1 (11).png';
const png = PNG.sync.read(fs.readFileSync(src));
const W = png.width, H = png.height, data = png.data;

const outDir = 'C:/Users/fzswan/CodeBuddy/20260916075716/_tmp_analyze/crops';
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);

function crop(bbox, name) {
  const [x0, y0, x1, y1] = bbox;
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const out = new PNG({ width: w, height: h, colorType: 2, bitDepth: 8, inputColorType: 2 });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = ((y0 + y) * W + (x0 + x)) << 2;
      const di = (y * w + x) << 2;
      out.data[di] = png.data[si];
      out.data[di + 1] = png.data[si + 1];
      out.data[di + 2] = png.data[si + 2];
    }
  }
  const outPath = path.join(outDir, name + '.png');
  fs.writeFileSync(outPath, PNG.sync.write(out));
  console.log('裁剪:', outPath, `${w}x${h}`);
}

// 使用原始 bbox（来自 bfs_raw / ui_extract）
crop([0, 15, 541, 233], '01_顶栏_头像+昵称');
crop([782, 31, 1102, 140], '02_体力条');
crop([19, 248, 277, 384], '03_普通按钮');
crop([299, 265, 520, 362], '04_困难按钮');
crop([0, 905, 183, 1206], '05_左侧木牌');
crop([0, 1750, 1151, 2047], '06_底部导航');
