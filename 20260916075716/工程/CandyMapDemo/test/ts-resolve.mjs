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
