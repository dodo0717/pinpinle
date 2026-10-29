/**
 * 埋点汇总（2026-10-26 建，2026-10-28 支持本地导出文件）：把事件汇总成**一个人盯得住的 4 个数**。
 *
 * 用法（两种数据来源都支持）：
 * ```
 * node tools/analytics-report.mjs                          ← 读 logs/*.ndjson（服务端日志模式）
 * node tools/analytics-report.mjs metrics-abc123-2026-10-28.json
 * node tools/analytics-report.mjs 玩家A.json 玩家B.json    ← 多个玩家的导出文件合并统计
 * ```
 * 导出的 JSON 由玩家在控制台敲 `__metrics.download()` 得到（纯本地模式，零后端）。
 *
 * 为什么要有这个：**数据躺在文件里没人看 = 白埋**。这个脚本只回答四个问题：
 *   1. 有多少玩家 / 次留多少（能不能活）
 *   2. 哪一关在卡人（前 15 关通过率 <70% 就要调）
 *   3. 单局多长时间（180 秒上限下，90~150 秒是健康区间）
 *   4. 教学完成率（序章留不住人，后面都白搭）
 */
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const LOG_DIR = resolve(HERE, '..', 'logs');

function median(nums) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}
const avg = (nums) => (nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : 0);
const pct = (a, b) => (b > 0 ? `${((a / b) * 100).toFixed(1)}%` : '—');

/** 解析一个文件：既吃导出的 `{events:[...]}`、也吃 JSON 数组、也吃 ndjson */
async function readAny(path) {
  const text = await readFile(path, 'utf8');
  const t = text.trim();
  if (!t) return [];
  // ① 导出文件：{ version, events: [...] }
  if (t.startsWith('{')) {
    try {
      const obj = JSON.parse(t);
      if (Array.isArray(obj?.events)) return obj.events;
      return [obj]; // 单条事件
    } catch {
      /* 落到按行解析 */
    }
  }
  // ② JSON 数组
  if (t.startsWith('[')) {
    try {
      const arr = JSON.parse(t);
      return Array.isArray(arr) ? arr : [];
    } catch {
      /* 落到按行解析 */
    }
  }
  // ③ ndjson（一行一条）
  const rows = [];
  for (const line of t.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try {
      rows.push(JSON.parse(s));
    } catch {
      /* 坏行跳过 */
    }
  }
  return rows;
}

async function load() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  if (args.length) {
    console.log(`数据来源：${args.join(', ')}`);
    const rows = [];
    for (const a of args) {
      try {
        rows.push(...(await readAny(resolve(a))));
      } catch (e) {
        console.warn(`读不了 ${a}：${e.message}`);
      }
    }
    return rows;
  }
  let files = [];
  try {
    files = (await readdir(LOG_DIR)).filter((f) => f.endsWith('.ndjson'));
  } catch {
    console.log(`没有日志目录：${LOG_DIR}`);
    return [];
  }
  if (!files.length) return [];
  console.log(`数据来源：${LOG_DIR}\\*.ndjson（${files.length} 个文件）`);
  const rows = [];
  for (const f of files.sort()) rows.push(...(await readAny(join(LOG_DIR, f))));
  return rows;
}

function main() {
  void (async () => {
    const rows = await load();
    if (!rows.length) {
      console.log('（日志为空：先在浏览器里玩一局，或确认 analytics-server 已启动）');
      return;
    }

    /** pid → { maxDay, sessions:Set } */
    const players = new Map();
    const cohort = new Set();
    const tut = { start: 0, done: 0, skip: 0 };
    const durations = [];
    /** `${mode}-${level}` → 聚合 */
    const levels = new Map();

    const playerOf = (pid) => {
      let p = players.get(pid);
      if (!p) {
        p = { maxDay: 0, sessions: new Set() };
        players.set(pid, p);
      }
      return p;
    };

    for (const r of rows) {
      const pid = r.pid || '?';
      const p = playerOf(pid);
      p.maxDay = Math.max(p.maxDay, Number(r.day) || 0);
      if (r.sid) p.sessions.add(r.sid);
      const q = r.p || {};

      switch (r.e) {
        case 'first_open':
          cohort.add(pid);
          break;
        case 'tutorial_start':
          tut.start += 1;
          break;
        case 'tutorial_done':
          tut.done += 1;
          break;
        case 'tutorial_skip':
          tut.skip += 1;
          break;
        case 'level_start': {
          const key = `${q.mode || '?'}-${q.level || '?'}`;
          let v = levels.get(key);
          if (!v) {
            v = { mode: q.mode || '?', level: Number(q.level) || 0, start: 0, end: 0, fail: 0, durs: [], tries: [] };
            levels.set(key, v);
          }
          v.start += 1;
          if (typeof q.attempt === 'number') v.tries.push(q.attempt);
          break;
        }
        case 'level_end': {
          const key = `${q.mode || '?'}-${q.level || '?'}`;
          const v = levels.get(key);
          if (v) {
            v.end += 1;
            if (typeof q.duration_ms === 'number') {
              v.durs.push(q.duration_ms);
              durations.push(q.duration_ms);
            }
          }
          break;
        }
        case 'level_fail': {
          const key = `${q.mode || '?'}-${q.level || '?'}`;
          const v = levels.get(key);
          if (v) v.fail += 1;
          break;
        }
        default:
          break;
      }
    }

    const total = players.size;
    const retained = (n) => [...players.values()].filter((p) => p.maxDay >= n).length;

    console.log('=== 埋点汇总 ===');
    console.log(`事件总数 ${rows.length}    玩家数 ${total}    会话数 ${[...players.values()].reduce((a, p) => a + p.sessions.size, 0)}`);
    console.log(`次留 ${pct(retained(1), total)}    3留 ${pct(retained(3), total)}    7留 ${pct(retained(7), total)}`);
    // ⚠️ 分母用「完成 + 跳过」而不是「开始」：一次教学要么被完成、要么被跳过，
    //    而「开始」可能因为跨会话补发/重复进入而对不上（实测出现过 200% 的跳过率）
    const tutEnd = tut.done + tut.skip;
    console.log(
      `教学：开始 ${tut.start}  完成 ${tut.done}  跳过 ${tut.skip}` +
        `  → 完成率 ${pct(tut.done, tutEnd)}  跳过率 ${pct(tut.skip, tutEnd)}`,
    );
    console.log(`单局时长：中位数 ${Math.round(median(durations) / 1000)}s    平均 ${Math.round(avg(durations) / 1000)}s    (n=${durations.length})`);

    for (const m of ['normal', 'nightmare']) {
      const list = [...levels.values()].filter((v) => v.mode === m).sort((a, b) => a.level - b.level);
      if (!list.length) continue;
      console.log(`\n--- 关卡漏斗（${m === 'normal' ? '简单' : '困难'}）---`);
      console.log(' 关   进入  通关  失败   通过率   平均时长  平均尝试');
      for (const v of list) {
        const pass = pct(v.end, v.start);
        console.log(
          `${String(v.level).padStart(3)}  ${String(v.start).padStart(5)}  ${String(v.end).padStart(4)}  ${String(v.fail).padStart(4)}  ${pass.padStart(7)}  ${String(Math.round(median(v.durs) / 1000)).padStart(7)}s  ${avg(v.tries).toFixed(1).padStart(7)}`,
        );
      }
    }
    console.log('\n（参考线：次留 ≥35%；前 15 关通过率 ≥70%；单局 90~150s；教学完成率 ≥80%）');
  })();
}

main();
