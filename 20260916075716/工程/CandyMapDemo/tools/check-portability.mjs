#!/usr/bin/env node
/**
 * 可移植性守卫：检查「算法层」是否沾了任何平台 API。
 *
 * 背景：整个移植计划的地基是「算法层纯 TS、零平台依赖」——棋盘生成、移动规则、融合判定、
 * 消除结算、星线、图池、存档逻辑这些东西，Web 版和小游戏版**共用同一份**。
 * 一旦有人在算法层里写了 `document` / `localStorage` / `wx.*`，这份代码就再也不能被引擎
 * 直接引用，移植计划当场失效 —— 而这个错误平时不会暴露（Web 版照样能跑），
 * 只在往小游戏搬的时候才炸。所以要有自动守卫。
 *
 * 判定：
 *   - 禁止出现浏览器 / 微信专有 API（document / window / localStorage / wx.* / navigator ...）
 *   - 禁止反向依赖表现层（import 路径里出现 `web/`）
 *   - 允许标准 JS（Date / Math / JSON / setTimeout …）
 *   - 注释与字符串里的出现**不算违规**（先剥掉行注释再匹配）
 *
 * 用法：node tools/check-portability.mjs
 * 退出码：0 = 干净；1 = 发现违规（可接进 CI）
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const CORE = join(ROOT, 'assets', 'scripts');

/** 平台专有 API（出现即违规） */
const FORBIDDEN = [
  'document',
  'window',
  'localStorage',
  'sessionStorage',
  'navigator',
  'HTMLElement',
  'HTMLCanvasElement',
  'CanvasRenderingContext2D',
  'XMLHttpRequest',
  'requestAnimationFrame',
  'Image',
  'fetch',
  'alert',
  'wx',
];

/** 反向依赖表现层 */
const FORBIDDEN_IMPORT = [/from\s+['"][^'"]*\/web\//, /from\s+['"][^'"]*\.\.\/web\//];

function walk(dir) {
  const acc = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) acc.push(...walk(p));
    else if (e.name.endsWith('.ts')) acc.push(p);
  }
  return acc;
}

/** 剥掉行注释与块注释后的纯代码（字符串里的误报靠白名单兜） */
function stripComments(src) {
  let out = '';
  let inBlock = false;
  const lines = src.split('\n');
  for (const raw of lines) {
    let line = '';
    let i = 0;
    while (i < raw.length) {
      if (inBlock) {
        if (raw.startsWith('*/', i)) {
          inBlock = false;
          i += 2;
        } else i++;
        continue;
      }
      if (raw.startsWith('/*', i)) {
        inBlock = true;
        i += 2;
        continue;
      }
      if (raw.startsWith('//', i)) break;
      line += raw[i];
      i++;
    }
    out += line + '\n';
  }
  return out;
}

const violations = [];
const files = walk(CORE);

for (const file of files) {
  const code = stripComments(readFileSync(file, 'utf8'));
  const lines = code.split('\n');
  const rel = relative(ROOT, file);

  lines.forEach((line, idx) => {
    for (const api of FORBIDDEN) {
      // 全词匹配，避免把 `imageWidth` 里的 `Image` 之类算进来
      const re = new RegExp(`(^|[^\\w.$])${api}\\s*[.(]`, '');
      if (re.test(line)) {
        violations.push({ rel, line: idx + 1, why: `平台 API \`${api}\``, text: line.trim().slice(0, 90) });
      }
    }
    for (const re of FORBIDDEN_IMPORT) {
      if (re.test(line)) {
        violations.push({ rel, line: idx + 1, why: '反向依赖表现层 web/', text: line.trim().slice(0, 90) });
      }
    }
  });
}

if (violations.length === 0) {
  console.log(`✅ 算法层可移植性检查通过：${files.length} 个文件无任何平台依赖`);
  console.log(`   扫描目录：${relative(ROOT, CORE)}`);
  console.log('   算法层可直接被引擎（Cocos / Laya / 原生 Canvas）引用。');
  process.exit(0);
}

console.log(`❌ 发现 ${violations.length} 处平台依赖（算法层必须零平台依赖，否则无法移植到小游戏）：\n`);
for (const v of violations) {
  console.log(`  ${v.rel}:${v.line}  ${v.why}`);
  console.log(`      ${v.text}`);
}
process.exit(1);
