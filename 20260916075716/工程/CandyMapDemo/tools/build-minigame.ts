/**
 * 构建 `minigame/`（纯代码微信小游戏）—— 无引擎、无编辑器、零 npm 依赖。
 *
 *   node tools/build-minigame.ts
 *
 * 做三件事：
 * 1. `assets/scripts` 下所有 .ts → `minigame/src/scripts` 下同名 .js
 *    用 Node 22 原生 `stripTypeScriptTypes` 剥类型（与测试跑法同一条路径），
 *    装饰器手动剥（`@ccclass` / `@property`，与 preview/serve.mjs 同一套正则）；
 * 2. import 重写：`from 'cc'` → 指向 `src/runtime/cc.js`（cc-shim 的拷贝）的相对路径；
 *    相对导入补 `.js` 扩展名；中文目录段映射成 ASCII（场景→scenes 等），
 *    避免小游戏包 / git / 工具链在非 ASCII 路径上出幺蛾子；
 * 3. `preview/cc-shim.js` → `minigame/src/runtime/cc.js`（双环境运行时原样拷贝）。
 *
 * 素材不进包（2026-10-24 远程化）：微信侧从 `https://candy.aidertech.cn/mini-assets/pp/`
 * 加载，浏览器验证走 serve.mjs 的 `/assets/resources/`——两边都由运行时的 RES_BASE
 * 决定，本脚本不再拷素材。上传新素材 = 传 `minigame 之外` 的 `assets/resources/` 内容
 * 到服务器 `/home/game/mini-assets/pp/`。
 *
 * 入口 `game.js` / `game.json` / `project.config.json` / `browser.html` 手工维护，
 * 本脚本不覆盖。产物提交进 git（可 review、可 diff、可回滚）。
 *
 * ## 包体
 * 纯代码：主包几百 KB，远低于微信 4MB 上限。
 */

import { stripTypeScriptTypes } from 'node:module';
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_SCRIPTS = join(ROOT, 'assets', 'scripts');
const SRC_SHIM = join(ROOT, 'preview', 'cc-shim.js');
const SRC_RES = join(ROOT, 'assets', 'resources');
const OUT = join(ROOT, 'minigame');
const OUT_SCRIPTS = join(OUT, 'src', 'scripts');
const OUT_RUNTIME = join(OUT, 'src', 'runtime');

/** 中文目录 → ASCII（输出结构与 import 路径同步映射） */
const DIR_MAP: Record<string, string> = {
  '场景': 'scenes',
  '玩法': 'game',
  '核心': 'core',
  '界面': 'ui',
};

/** 与 preview/serve.mjs 同一套：装饰器在 shim 运行时里没有意义，删掉最省心 */
function stripDecorators(code: string): string {
  return code
    .replace(/^[ \t]*@ccclass\([^\n]*\)[ \t]*\r?\n/gm, '')
    .replace(/^[ \t]*@property\([^\n]*\)[ \t]*\r?\n/gm, '');
}

/** 相对导入路径分段映射（中文目录段替换、无扩展名补 .js） */
function remapRelative(spec: string): string {
  const parts = spec.split('/');
  const mapped = parts.map((p) => DIR_MAP[p] ?? p);
  let out = mapped.join('/');
  if (!/\.[a-z]+$/i.test(out)) out += '.js';
  return out;
}

/** 输出文件目录 → 目标的 POSIX 相对导入路径（带 ./ 前缀） */
function relImport(fromDir: string, target: string): string {
  const r = relative(fromDir, join(OUT, target)).split(sep).join('/');
  return r.startsWith('.') ? r : './' + r;
}

function walk(dir: string, cb: (p: string) => void): void {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, cb);
    else cb(p);
  }
}

/* ------------------------------------------------ 游戏脚本：剥类型 + 重写导入 */

let count = 0;
rmSync(OUT_SCRIPTS, { recursive: true, force: true });
walk(SRC_SCRIPTS, (p) => {
  if (!p.endsWith('.ts')) return;
  const rel = relative(SRC_SCRIPTS, p);
  const outRel = rel.split(sep).map((s) => (s.includes('.') ? s : (DIR_MAP[s] ?? s))).join('/');
  const outPath = join(OUT_SCRIPTS, outRel.replace(/\.ts$/, '.js'));
  let code = stripDecorators(stripTypeScriptTypes(readFileSync(p, 'utf8'), { sourceMap: false }));
  const outDir = dirname(outPath);
  code = code.replace(/(\bfrom\s*)('([^']*)'|"([^"]*)")/g, (m, pre: string, quoted: string) => {
    const spec = quoted.slice(1, -1);
    const q = quoted[0];
    if (spec === 'cc') return pre + q + relImport(outDir, 'src/runtime/cc.js') + q;
    if (spec.startsWith('.')) return pre + q + remapRelative(spec) + q;
    return m;   // 裸包名导入（本仓库没有，留原样报警）
  });
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, code);
  count++;
});
console.log(`脚本: ${count} 个 .ts → minigame/src/scripts/`);

/* ------------------------------------------------ 运行时 + 素材扩展名清单 */

mkdirSync(OUT_RUNTIME, { recursive: true });
// 不用 cpSync：Windows 上偶发「unlink」怪错（杀软碰一下目标文件就炸），读写绕开
writeFileSync(join(OUT_RUNTIME, 'cc.js'), readFileSync(SRC_SHIM));
console.log('运行时: preview/cc-shim.js → minigame/src/runtime/cc.js');

// 素材真实扩展名清单：运行时的 loadImageAny 若逐后缀探测（png→jpg→…），远程化后
// 每次未命中都是一次真实 404 请求（map-v2 / loading 的 jpg 首当其冲）。构建时把
// 「相对路径（无扩展名）→ 真实后缀」烘成全局表，运行时先试命中项。
const extMap: Record<string, string> = {};
walk(SRC_RES, (p) => {
  if (p.endsWith('.meta')) return;
  const rel = relative(SRC_RES, p).split(sep).join('/');
  const ext = extname(p).toLowerCase();
  if (!ext) return;
  extMap[rel.slice(0, -ext.length)] = ext;
});
writeFileSync(
  join(OUT_RUNTIME, 'asset-ext.js'),
  '// 由 tools/build-minigame.ts 生成，请勿手改 —— 素材真实扩展名清单（key 为 resources.load 的路径口径）\n'
    + `globalThis.__PP_ASSET_EXT = ${JSON.stringify(extMap)};\n`,
);
console.log(`素材扩展名清单: ${Object.keys(extMap).length} 条 → minigame/src/runtime/asset-ext.js`);

// 素材不进包（远程化后可能还留着旧拷贝，清掉）
rmSync(join(OUT, 'assets'), { recursive: true, force: true });
console.log('完成。微信开发者工具导入 minigame/ 目录（素材走远程）；浏览器验证开 minigame/browser.html。');
