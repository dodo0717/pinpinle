/**
 * 测试专用模块解析钩子。
 *
 * 目的：让算法层源码保持 Cocos Creator 习惯的「无扩展名相对导入」（如 `./grid`），
 * 同时能被 Node 原生的 TypeScript 类型擦除（type stripping）+ 内置测试运行器直接执行，
 * 从而做到「零第三方依赖」即可跑单测。
 *
 * 只影响测试进程，不参与游戏打包。
 */
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

registerHooks({
  resolve(specifier, context, nextResolve) {
    // ⚠️ 2026-10-30 补：算法层目录从 `core` 改名为「核心」，但 test/*.test.ts 里的 import
    // 仍写着 `../assets/scripts/core/...` —— 直接报 ERR_MODULE_NOT_FOUND，测试一行都跑不到。
    // 这里做一层目录别名统一兜住（改 1 处即可，不用去改 11 个测试文件，也防以后再改名又全挂）。
    // ⚠️ 只改写 specifier、不 return：改写后还要走下面「补 .ts 后缀」的逻辑 ——
    // 算法层源码是无扩展名导入（`./config`），直接 nextResolve 会找不到文件。
    if (specifier.includes('assets/scripts/core/')) {
      specifier = specifier.replace('assets/scripts/core/', 'assets/scripts/核心/');
    }
    if (specifier.startsWith('.') && context.parentURL) {
      const lastSegment = specifier.slice(specifier.lastIndexOf('/') + 1);
      if (lastSegment.length > 0 && !lastSegment.includes('.')) {
        const candidate = new URL(`${specifier}.ts`, context.parentURL);
        if (existsSync(fileURLToPath(candidate))) {
          return { url: candidate.href, shortCircuit: true };
        }
      }
    }
    return nextResolve(specifier, context);
  },
});
