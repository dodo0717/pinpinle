// 零依赖静态服务器：node serve.mjs  →  http://localhost:5181/
//
// 除了静态文件，还把 `assets/**/*.ts` 现场做「类型擦除 + 补全 import 扩展名」
// 后当作 ES module 发给浏览器 —— 这样预览页跑的是 **Cocos 工程里的真源码**，
// 而不是手抄一份到 HTML 里，改 TS 刷新即生效。
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..'); // 站点根 = CandyMapDemo
const port = Number(process.env.PORT || 5181);
const host = process.env.HOST || '127.0.0.1';

/**
 * 浏览器 ESM 不认无扩展名的相对路径，把 `from './grid'` 补成 `from './grid.ts'`。
 * 只动相对路径，不动 'cc' 这类裸模块（由预览页的 import map 承接）。
 */
function rewriteImports(code) {
  return code.replace(
    /(\bfrom\s*|\bimport\s*\(\s*)(['"])(\.{1,2}\/[^'"]*?)(['"])/g,
    (m, head, q1, spec, q2) => {
      if (/\.(ts|js|mjs|json)$/i.test(spec)) return m;
      return `${head}${q1}${spec}.ts${q2}`;
    },
  );
}

/**
 * 剥掉 Cocos 装饰器。
 * 类型擦除后是 `@ccclass('X')\nexport class X` —— 这是 TS legacy 装饰器的位置，
 * 浏览器原生装饰器要求 `export @dec class`（顺序相反），直接跑会语法错误。
 * 装饰器在这里没有运行时意义（shim 不需要按名字注册类），删掉最省心。
 */
function stripDecorators(code) {
  return code
    .replace(/^[ \t]*@ccclass\([^\n]*\)[ \t]*\r?\n/gm, '')
    .replace(/^[ \t]*@property\([^\n]*\)[ \t]*\r?\n/gm, '');
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.ts': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg',
};

http
  .createServer(async (req, res) => {
    // 非法百分号编码（如 `/%E0`）会让 decodeURIComponent 抛错；不接住就是未处理的 rejection，整个进程退出
    let p;
    try {
      p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('400 bad url');
      return;
    }
    if (p === '/' || p === '') p = '/preview/index.html';
    const file = path.resolve(root, '.' + p);
    // 挡路径穿越：`/..%2F..%2F` 解码后能跳出站点根目录，读到工程外的任意文件
    if (file !== root && !file.startsWith(root + path.sep)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('403');
      return;
    }

    try {
      if (p.endsWith('.ts')) {
        const raw = await readFile(file, 'utf8');
        let js;
        try {
          js = rewriteImports(stripDecorators(stripTypeScriptTypes(raw)));
        } catch (e) {
          // 类型擦除只支持「可擦除」的 TS：enum / namespace / 参数属性都会走到这里。
          // 直接丢 404 会让浏览器只报一句 "Failed to load resource"，根本查不出是哪个语法
          res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('TS 转译失败 ' + p + '\n' + (e && e.message));
          return;
        }
        res.writeHead(200, { 'Content-Type': MIME['.ts'], 'Cache-Control': 'no-store' });
        res.end(js);
        return;
      }
      const buf = await readFile(file);
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream',
      });
      res.end(buf);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 ' + p);
    }
  })
  // 默认只监听本机；要用手机走局域网真机预览时显式 `HOST=0.0.0.0 node preview/serve.mjs`
  .listen(port, host, () => console.log('serving ' + root + ' at http://' + host + ':' + port + '/'));
