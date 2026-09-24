const fs = require('fs');
const { PNG } = require('pngjs');

const src = 'C:/Users/fzswan/Downloads/图片节点 1 (11).png';
const png = PNG.sync.read(fs.readFileSync(src));

console.log('=== 图片基本信息 ===');
console.log('尺寸:', png.width, 'x', png.height);
console.log('colorType:', png.colorType, '(6=RGBA, 2=RGB)');
console.log('alpha:', png.alpha);

function px(x, y) {
  const i = (png.width * y + x) << 2;
  return [png.data[i], png.data[i + 1], png.data[i + 2], png.data[i + 3]];
}

console.log('\n=== 采样点 ===');
console.log('左上角(5,5):', px(5, 5));
console.log('右上角(w-5,5):', px(png.width - 5, 5));
console.log('左下角(5,h-5):', px(5, png.height - 5));
console.log('中心:', px(Math.floor(png.width / 2), Math.floor(png.height / 2)));
console.log('左侧中部:', px(20, Math.floor(png.height / 2)));

// 统计 alpha 分布
const alphaCount = new Map();
let total = 0;
for (let y = 0; y < png.height; y += 3) {
  for (let x = 0; x < png.width; x += 3) {
    const a = px(x, y)[3];
    const bucket = a === 0 ? 'a=0' : a === 255 ? 'a=255' : 'a=中间';
    alphaCount.set(bucket, (alphaCount.get(bucket) || 0) + 1);
    total++;
  }
}
console.log('\n=== alpha 分布(采样) ===');
for (const [k, v] of alphaCount) {
  console.log(k, v, ((v / total) * 100).toFixed(1) + '%');
}

// 检测棋盘格：统计常见背景色
const colorCount = new Map();
for (let y = 0; y < png.height; y += 5) {
  for (let x = 0; x < png.width; x += 5) {
    const p = px(x, y);
    const key = `${p[0]},${p[1]},${p[2]},${p[3]}`;
    colorCount.set(key, (colorCount.get(key) || 0) + 1);
  }
}
const top = [...colorCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
console.log('\n=== 最常见颜色(采样top8) ===');
for (const [k, v] of top) {
  console.log(k, v);
}
