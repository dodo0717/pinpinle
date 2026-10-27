/**
 * 逐关时长仿真（2026-10-27 评审 P1-4）：给 `LEVEL_TIME` 出初稿，也供策划微调后复核。
 *
 *   node --import ./test/ts-resolve.mjs tools/sim-level-time.ts [局数=200] [--json]
 *
 * 模型（⚠️ 全是假设，等埋点有真实 time_left 后再校准）：
 *   每得 1 分的耗时 = 找图时间 + 交换次数 × 每次交换耗时
 *     找图时间 = 1.2 + 0.6×(ma−1) + 0.05×格数      （同动物情绪越多越难认、盘越大越难找）
 *     交换耗时 = 简单 1.5 秒 / 困难 1.5 秒（但相邻交换次数用下界，实际更多）
 *   引擎每局都走真实补位（forceCompleteTargetImage），交换次数取当前盘面的最少值。
 *
 * 输出每关：拿到 3★ 的中位耗时 t3、P80 耗时，以及建议时长（2026-10-27 产品确认的口径）：
 *   简单 = t3 中位 + 60 秒（保守版：模型偏乐观，真人只会更慢），向上取整到 5 秒
 *   困难 = max(简单, 困难 t3 中位 + 30 秒)，向上取整到 5 秒（相邻交换已经够难，时间不再额外压）
 *
 *   加 `--emit` 直接打印可粘贴进 config.ts 的 LEVEL_TIME / NIGHTMARE_LEVEL_TIME 字面量。
 */

import {
  Rng,
  PuzzleEngine,
  buildLevelConfigs,
  confusionOfLevel,
  LEVEL_TAGS,
  type GameMode,
  type LevelConfig,
} from '../assets/scripts/核心/index.ts';

const RUNS = Number(process.argv[2]) > 0 ? Number(process.argv[2]) : 200;
const AS_JSON = process.argv.includes('--json');
const EMIT = process.argv.includes('--emit');
const SEC_PER_SWAP = 1.5;

function searchSec(level: number, cells: number): number {
  return 1.2 + 0.6 * (confusionOfLevel(level) - 1) + 0.05 * cells;
}

/** 一局：返回拿到第 n 分时的累计秒数（n = 1..star3） */
function playOnce(cfg: LevelConfig, mode: GameMode, seed: number): number[] {
  const rng = new Rng(seed);
  const engine = new PuzzleEngine(cfg, rng);
  const cells = cfg.rows * cfg.cols;
  const out: number[] = [];
  let t = 0;
  for (let i = 0; i < cfg.star3; i++) {
    const swaps = mode === 'normal' ? engine.minSwapsToCompleteTarget() : engine.minAdjacentSwapsToCompleteTarget();
    if (swaps === null) break;
    t += searchSec(cfg.level, cells) + Math.max(1, swaps) * SEC_PER_SWAP;
    out.push(t);
    if (!engine.forceCompleteTargetImage()) break;
  }
  return out;
}

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
}

const round5 = (x: number): number => Math.ceil(x / 5) * 5;

export interface SimRow {
  level: number;
  tag: string;
  t3Median: number;
  t3P80: number;
}

function simulate(mode: GameMode): SimRow[] {
  const rows: SimRow[] = [];
  for (const cfg of buildLevelConfigs(mode)) {
    const t3: number[] = [];
    for (let k = 0; k < RUNS; k++) {
      const times = playOnce(cfg, mode, 1000 + cfg.level * 7919 + k);
      if (times.length >= cfg.star3) t3.push(times[cfg.star3 - 1]!);
    }
    t3.sort((a, b) => a - b);
    rows.push({
      level: cfg.level,
      tag: LEVEL_TAGS[cfg.level] ?? '',
      t3Median: Math.round(pct(t3, 0.5)),
      t3P80: Math.round(pct(t3, 0.8)),
    });
  }
  return rows;
}

const normal = simulate('normal');
const nightmare = simulate('nightmare');
const suggestNormal = normal.map((r) => round5(r.t3Median + 60));
const suggestHard = nightmare.map((r, i) => Math.max(suggestNormal[i]!, round5(r.t3Median + 30)));

/** 每行 10 关的 TS 字面量 */
function literal(name: string, values: number[]): string {
  const lines: string[] = [];
  for (let i = 0; i < values.length; i += 10) {
    lines.push('  ' + values.slice(i, i + 10).map((v, k) => `${i + k + 1}: ${v}`).join(', ') + ',');
  }
  return `export const ${name}: Record<number, number> = {\n${lines.join('\n')}\n};`;
}

if (AS_JSON) {
  console.log(JSON.stringify({ normal, nightmare, suggestNormal, suggestHard }, null, 2));
} else if (EMIT) {
  console.log(literal('LEVEL_TIME', suggestNormal));
  console.log(literal('NIGHTMARE_LEVEL_TIME', suggestHard));
} else {
  console.log(`局数 ${RUNS}/关；简单 = 任意交换，困难 = 相邻交换（下界）`);
  console.log('关 | 备注 | 简单 3★中位 | 简单 P80 | 简单建议 | 困难 3★中位 | 困难 P80 | 困难建议');
  for (let i = 0; i < normal.length; i++) {
    const n = normal[i]!;
    const h = nightmare[i]!;
    console.log(
      `${n.level} | ${n.tag} | ${n.t3Median} | ${n.t3P80} | ${suggestNormal[i]} | ${h.t3Median} | ${h.t3P80} | ${suggestHard[i]}`,
    );
  }
}
