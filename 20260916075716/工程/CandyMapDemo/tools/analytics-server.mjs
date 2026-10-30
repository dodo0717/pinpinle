/**
 * 埋点日志服务（2026-10-26 新增，**零依赖**）：
 *
 * ```
 * 前端 POST /log（text/plain，一行一条 JSON）→ 追加写 logs/analytics-YYYY-MM-DD.ndjson
 * ```
 *
 * 用法：`node tools/analytics-server.mjs`（端口用 `PORT=xxxx` 改，默认 5182）
 *
 * ⚠️ 为什么要单独一个进程：前端跑在预览服务器（5181）上，那边加不了服务端逻辑；
 *    埋点数据要**落到服务器的专用日志文件**里，后续服务端直接对接这个文件即可。
 *
 * ⚠️ 格式用 **JSON Lines（.ndjson，一行一条）**：
 *    - 追加写不需要读旧内容，天然并发安全（这里仍串行化，双保险）；
 *    - 后续 ELK / ClickHouse / Fluent Bit / 数仓离线导入都直接吃这个格式；
 *    - 文件按**天切分**，对接时按天分区、按天归档都方便。
 */
import { createServer } from 'node:http';
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
/** 专用日志目录：`工程/CandyMapDemo/logs/` */
const LOG_DIR = join(ROOT, 'logs');
const PORT = Number(process.env.PORT || 5182);
/** 单批上限：超了直接拒（正常一批 10 条几 KB，这里给足余量又挡住异常流量） */
const MAX_BODY = 256 * 1024;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

/** 当天日志文件：`analytics-2026-10-26.ndjson` */
function logFileOf(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return join(LOG_DIR, `analytics-${y}-${m}-${d}.ndjson`);
}

/* ---- 串行写：所有 append 排成一条链，避免并发追加把一行写断 ---- */
let writeChain = Promise.resolve();

function appendLines(text) {
  writeChain = writeChain
    .then(async () => {
      await mkdir(LOG_DIR, { recursive: true });
      await appendFile(logFileOf(), text, 'utf8');
    })
    .catch((err) => {
      console.error('[analytics] 写入失败：', err?.message || err);
    });
  return writeChain;
}

/** 逐行校验：只留合法 JSON，坏行丢掉并计数（不让一条脏数据毁掉整个文件） */
function sanitize(body) {
  const kept = [];
  let bad = 0;
  for (const line of body.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      JSON.parse(t);
      kept.push(t);
    } catch {
      bad += 1;
    }
  }
  return { text: kept.length ? `${kept.join('\n')}\n` : '', ok: kept.length, bad };
}

const server = createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    res.end();
    return;
  }

  if (req.method === 'GET' && (req.url === '/health' || req.url === '/')) {
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, logDir: LOG_DIR, file: logFileOf(), port: PORT }));
    return;
  }

  if (req.method !== 'POST' || !req.url?.startsWith('/log')) {
    res.writeHead(404, CORS);
    res.end();
    return;
  }

  let size = 0;
  const chunks = [];
  req.on('data', (c) => {
    size += c.length;
    if (size > MAX_BODY) {
      req.destroy();
      return;
    }
    chunks.push(c);
  });
  req.on('end', () => {
    const { text, ok, bad } = sanitize(Buffer.concat(chunks).toString('utf8'));
    if (text) void appendLines(text);
    if (bad) console.warn(`[analytics] 丢弃 ${bad} 条非法 JSON`);
    if (ok) {
      console.log(`[analytics] +${ok} → ${logFileOf().split(/[\\/]/).pop()}`);
    }
    res.writeHead(204, CORS);
    res.end();
  });
  req.on('error', () => {
    res.writeHead(400, CORS);
    res.end();
  });
});

server.listen(PORT, () => {
  console.log(`[analytics] 日志服务已启动：http://127.0.0.1:${PORT}/log`);
  console.log(`[analytics] 日志目录：${LOG_DIR}`);
});
