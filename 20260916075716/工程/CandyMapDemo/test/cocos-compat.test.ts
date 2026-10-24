/**
 * Cocos 构建兼容性检查。
 *
 * Cocos Creator 构建时用 Babel 的 loose 模式编译展开语法：
 *   `[...iter]`       → `[].concat(iter)`
 *   `Math.max(...it)` → `Math.max.apply(Math, it)`
 * 这两种写法只对**数组**等价。对 Set / Map / `.keys()` / `.values()` 这类迭代器，
 * 前者得到 `[迭代器本身]`，后者得到 NaN / Infinity —— 浏览器预览和 Node 单测都正常，
 * 只有构建产物（微信小游戏）里出错。2026-10-22 就是这样在 `generateLevelPools` 里
 * 读到 `undefined.length`，整个对局组件创建失败。
 *
 * 所以这里静态扫描 Cocos 会打包的脚本：迭代器必须先 `Array.from()` 再展开。
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const scriptsRoot = resolve(here, '../assets/scripts');

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return tsFiles(full);
    return name.endsWith('.ts') ? [full] : [];
  });
}

/** 去掉注释，避免说明文字里的示例被误报 */
function stripComments(src: string): string {
  // 块注释里的换行要保留，否则报出来的行号会对不上源码
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ''))
    .replace(/\/\/.*$/gm, '');
}

test('assets/scripts 里不对 Set / Map / 迭代器直接用展开语法', () => {
  const problems: string[] = [];
  for (const file of tsFiles(scriptsRoot)) {
    const code = stripComments(readFileSync(file, 'utf8'));
    // 本文件里被赋值为 Set / Map 的变量名
    const iterableVars = new Set<string>();
    for (const m of code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*new\s+(?:Set|Map)\b/g)) {
      iterableVars.add(m[1]!);
    }
    const lines = code.split(/\r?\n/);
    lines.forEach((line, i) => {
      const direct = /\.\.\.\s*(?:new\s+(?:Set|Map)\b|[\w$.]+\.(?:keys|values|entries)\(\))/.test(line);
      const viaVar = Array.from(line.matchAll(/\.\.\.\s*([A-Za-z_$][\w$]*)\b(?!\s*[.(\[])/g)).some((m) =>
        iterableVars.has(m[1]!),
      );
      if (direct || viaVar) problems.push(`${relative(scriptsRoot, file)}:${i + 1}  ${line.trim()}`);
    });
  }
  assert.deepEqual(problems, [], `以下展开会在 Cocos 构建后出错，请改成 Array.from()：\n${problems.join('\n')}`);
});
