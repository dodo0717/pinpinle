/**
 * 构建产物静态服务 —— 起一个本地 HTTP 服务，方便在**普通浏览器**里测试出好的包
 * （构建产物必须通过 http 打开，直接双击 index.html 用 file:// 会因跨域加载不了资源）
 *
 * 用法：
 *   node tools/serve-build.mjs                  # 默认服务 build/web-mobile，端口 5183
 *   node tools/serve-build.mjs 8080             # 指定端口
 *   node tools/serve-build.mjs 8080 build/xxx   # 指定端口 + 产物目录（相对工程根）
 *
 * 启动后终端会打印可用地址：
 *   本机   http://127.0.0.1:<port>/
 *   局域网 http://<局域网IP>:<port>/   （手机 / 别的电脑连同一 WiFi 可打开）
 * 停止：Ctrl+C
 */

import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { networkInterfaces } from 'node:os';

// 注意：中文路径经 URL 解析后是 percent-encoded，必须先 decodeURIComponent 再用
const projectRoot = resolve(decodeURIComponent(new URL('..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'));
const port = Number(process.argv[2] ?? process.env.PORT ?? 5183);
const root = resolve(projectRoot, process.argv[3] ?? 'build/web-mobile');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.bin': 'application/octet-stream',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.ico': 'image/x-icon',
};

if (!existsSync(root)) {
  console.error('产物目录不存在: ' + root + '\n请先构建（编辑器 Publish → X-Device → Web Mobile → Build）');
  process.exit(1);
}

function lanIps() {
  const out = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const ni of list ?? []) {
      if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address);
    }
  }
  return out;
}

createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = join(root, p);
  if (!existsSync(f) || statSync(f).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404: ' + p);
    return;
  }
  res.writeHead(200, {
    'Content-Type': MIME[extname(f).toLowerCase()] ?? 'application/octet-stream',
    // ⚠️ no-store 而不是 no-cache：构建产物入口 JS 路径固定（assets/main/index.js 无版本号），
    //    no-cache 依赖重新验证，而这里没有 Last-Modified/ETag 可验，部分浏览器仍会拿旧包，
    //    表现为「改了、构建了、画面还是老的」。本地验证服务一律禁止缓存。
    'Cache-Control': 'no-store, must-revalidate',
  });
  res.end(readFileSync(f));
}).listen(port, '0.0.0.0', () => {
  console.log('产物目录: ' + root);
  console.log('本机访问: http://127.0.0.1:' + port + '/');
  for (const ip of lanIps()) console.log('局域网访问: http://' + ip + ':' + port + '/  （手机/其他设备连同一 WiFi 可打开）');
  console.log('停止服务: Ctrl+C');
});
