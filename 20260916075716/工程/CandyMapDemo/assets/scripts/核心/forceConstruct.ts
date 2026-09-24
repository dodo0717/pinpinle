import { Grid } from './grid';
import { validateBoard } from './matcher';
import { Rng } from './rng';
import { allPiecesForAssignment, assignPools } from './structure';
import type { RefillPlan } from './refill';

/**
 * 强制构造生成器（§4.13）—— 防御性兜底
 *
 * 正常流程下不应被触发；一旦触发说明常规算法出了边界问题，
 * 因此这里必须保证「一定能产出一个满足硬性约束的合法棋盘」。
 * 重试上限 50 次，仍失败则记录日志并返回最后一次结果（宁可交出近似合法棋盘，也不能卡死启动流程）。
 */

export interface ForceConstructOptions {
  maxTries?: number;
  /** 失败时回调，用于上层打点/上报 */
  onFail?: (tries: number) => void;
}

/** §4.13.1 首局加载的强制构造 */
export function forceConstructForInit(
  rows: number,
  cols: number,
  imageIds: readonly number[],
  rng: Rng,
  options: ForceConstructOptions = {},
): Grid {
  const maxTries = options.maxTries ?? 50;
  const cells = rows * cols;

  let last: Grid | null = null;
  for (let i = 0; i < maxTries; i++) {
    const assign = assignPools(cells, imageIds, rng);
    const pieces = allPiecesForAssignment(assign, rng);
    const shuffled = rng.shuffle(pieces);
    const grid = new Grid(rows, cols);
    shuffled.forEach((piece, index) => grid.setAt(index, piece));
    last = grid;
    if (validateBoard(grid).ok) return grid;
  }

  options.onFail?.(maxTries);
  if (!last) throw new Error('forceConstructForInit: 无法生成任何棋盘');
  return last;
}

/** §4.13.2 补位阶段的强制构造（保留池子结构：同一批碎片重新排布全部格子） */
export function forceConstructForRefill(
  grid: Grid,
  plan: RefillPlan,
  rng: Rng,
  options: ForceConstructOptions = {},
): Grid {
  const maxTries = options.maxTries ?? 50;

  // 待放置碎片 = 场上原有碎片 + 本次补位的 4 块（数量恰好 = 格数）
  const base = grid.toArray().filter((v): v is number => v !== null);
  const pieces = [...base, ...plan.pieces];
  if (pieces.length !== grid.size) {
    throw new Error(`forceConstructForRefill: 碎片数量 ${pieces.length} != 格数 ${grid.size}`);
  }

  let last: Grid | null = null;
  for (let i = 0; i < maxTries; i++) {
    const shuffled = rng.shuffle(pieces);
    const candidate = new Grid(grid.rows, grid.cols);
    shuffled.forEach((piece, index) => candidate.setAt(index, piece));
    last = candidate;
    if (validateBoard(candidate).ok) return candidate;
  }

  options.onFail?.(maxTries);
  if (!last) throw new Error('forceConstructForRefill: 无法生成任何棋盘');
  return last;
}
