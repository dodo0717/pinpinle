/**
 * 冒烟测试专用解析钩子：在 ts-resolve 的基础上，再把裸模块 `'cc'` 指向
 * `preview/cc-shim.js`（浏览器预览用的那套引擎 shim）。
 *
 * 于是 `assets/scripts/**` 的真实 Cocos 源码可以在 Node 里被直接 import ——
 * 不装 Cocos、不开浏览器，也能把「对局层」跑一遍冒烟。
 *
 * 只影响测试进程，不参与游戏打包。
 */
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const shimUrl = pathToFileURL(path.join(here, '..', 'preview', 'cc-shim.js')).href;

/**
 * 剥掉 Cocos 装饰器：类型擦除后是 `@ccclass('X')\nexport class X`，
 * 这个位置连 Node 自己的 ESM 解析器都不认（标准装饰器要求 `export @dec class`）。
 * 与 preview/serve.mjs 里的处理保持一致。
 */
function stripDecorators(code) {
  return code
    .replace(/^[ \t]*@ccclass\([^\n]*\)[ \t]*\r?\n/gm, '')
    .replace(/^[ \t]*@property\([^\n]*\)[ \t]*\r?\n/gm, '');
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'cc') return { url: shimUrl, shortCircuit: true };

    if (specifier.startsWith('.') && context.parentURL) {
      const last = specifier.slice(specifier.lastIndexOf('/') + 1);
      if (last.length > 0 && !last.includes('.')) {
        const candidate = new URL(`${specifier}.ts`, context.parentURL);
        if (existsSync(fileURLToPath(candidate))) return { url: candidate.href, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },

  load(url, context, nextLoad) {
    if (url.endsWith('.ts')) {
      const raw = readFileSync(fileURLToPath(url), 'utf8');
      const source = stripDecorators(stripTypeScriptTypes(raw));
      return { format: 'module', source, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});
