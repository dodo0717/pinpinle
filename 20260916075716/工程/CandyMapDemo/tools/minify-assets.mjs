#!/usr/bin/env node
/**
 * 素材瘦身：把工程素材转成 WebP，输出到小游戏目录 `minigame/assets/`。
 *
 * 为什么需要：微信小游戏主包上限 4MB、总包（主包 + 分包）上限 20MB，
 * 而原始素材是 64.4 MB（贴纸 108 张 46.8 MB + UI 切图 67 张 17.6 MB），
 * 直接搬过去装不下。转 WebP 后约 11 MB，分包即可容纳，不必走 CDN。
 *
 * 实测（2026-10-30，单张 512×512 贴纸 447 KB）：
 *   512 WebP q82 → 47 KB（9.5×）｜320 WebP q82 → 24 KB（19×）｜256 PNG → 127 KB（3.5×）
 * 并排对比确认：棋盘格子实际显示最大 117px，512 WebP 在棋盘与图鉴大图预览下均无可见损失。
 *
 * ⚠️ 本脚本**不改动原素材**（原 PNG/JPG 仍在原处），Web 版继续用原图；
 *    输出只给小游戏用。删掉输出目录重跑即可，无副作用。
 *
 * 用法：
 *   1) 需要 ffmpeg（Windows 上若不在 PATH，用环境变量指定）：
 *      $env:FFMPEG = 'C:\...\ffmpeg.exe'
 *   2) node tools/minify-assets.mjs
 *
 * 想调质量改下面 QUALITY_*；想缩尺寸，给对应组的 `vf` 传值（如 'scale=320:320'）。
 */

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, mkdirSync, statSync } from 'node:fs';
import { join, relative, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const OUT = join(ROOT, 'minigame', 'assets');

/** 长边超过这个值视为「大图」（地图长卷），质量再降一档 */
const BIG_EDGE = 2000;

const ff = process.env.FFMPEG || 'ffmpeg';

function walk(dir) {
  const acc = [];
  let ents;
  try {
    ents = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of ents) {
    const p = join(dir, e.name);
    if (e.isDirectory()) acc.push(...walk(p));
    else if (/\.(png|jpe?g)$/i.test(e.name)) acc.push(p);
  }
  return acc;
}

/** 读 PNG 头拿长边（用于判定是否大图；JPG 返回 0，靠质量档兜住） */
function pngLongEdge(buf) {
  if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return Math.max(buf.readUInt32BE(16), buf.readUInt32BE(20));
  }
  return 0;
}

function minify(file, out, quality, vf) {
  mkdirSync(dirname(out), { recursive: true });
  const args = ['-y', '-loglevel', 'error', '-i', file];
  if (vf) args.push('-vf', vf);
  args.push('-c:v', 'libwebp', '-quality', String(quality), out);
  execFileSync(ff, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  return [statSync(file).size, statSync(out).size];
}

const groups = [
  {
    label: '贴纸',
    src: join(ROOT, 'assets', 'resources'),
    dst: join(OUT, 'stickers'),
    quality: 82,
    // 图鉴有大图预览（全屏看），缩到 320 会软 → 只转格式，保留 512
    vf: null,
  },
  {
    label: 'UI 切图',
    src: join(ROOT, 'web', 'art'),
    dst: join(OUT, 'art'),
    quality: 80,
    bigQuality: 72,
    vf: null,
  },
];

let totalBefore = 0;
let totalAfter = 0;

for (const g of groups) {
  const files = walk(g.src);
  let before = 0;
  let after = 0;
  const big = [];
  for (const f of files) {
    const rel = relative(g.src, f);
    const out = join(g.dst, rel.replace(/\.(png|jpe?g)$/i, '.webp'));
    const edge = pngLongEdge(readFileSync(f).subarray(0, 4096));
    const q = g.bigQuality && edge > BIG_EDGE ? g.bigQuality : g.quality;
    const [b, a] = minify(f, out, q, g.vf);
    before += b;
    after += a;
    if (a > 300 * 1024) big.push([rel, a]);
  }
  totalBefore += before;
  totalAfter += after;
  console.log(
    `${g.label.padEnd(8)} ${String(files.length).padStart(4)} 个  ${(before / 1048576).toFixed(1)} MB → ${(after / 1048576).toFixed(1)} MB`,
  );
  if (big.length) {
    console.log('  仍 >300KB 的（可考虑降分辨率或进分包）：');
    for (const [r, s] of big.sort((x, y) => y[1] - x[1]).slice(0, 5)) {
      console.log(`    ${(s / 1024).toFixed(0).padStart(5)} KB  ${r}`);
    }
  }
}

const afterMB = totalAfter / 1048576;
console.log(
  `\n合计 ${(totalBefore / 1048576).toFixed(1)} MB → ${afterMB.toFixed(1)} MB（省 ${(100 - (totalAfter / totalBefore) * 100).toFixed(0)}%）`,
);
console.log(`输出：${OUT}`);
console.log(
  `微信小游戏：主包 ≤ 4 MB，总包 ≤ 20 MB → ${afterMB < 20 ? '可分包容纳，无需 CDN' : '仍需 CDN 或进一步压缩'}`,
);
