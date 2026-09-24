import { sortCellsByRowThenCol } from './collapse';
import { Grid, swapCells } from './grid';
import { forceConstructForRefill } from './forceConstruct';
import { validateBoard } from './matcher';
import { imageOf, pieceOf } from './pieces';
import { poolSnapshot } from './pools';
import { Rng } from './rng';

/**
 * 补位（§4.5 + §4.8.3 + §4.8.4）
 *
 * 补位顺序固定，共补 4 块（各自补齐 4 张不同的图）：
 *   第 1 块：池子1（唯一 1 组，补齐该图）
 *   第 2 块：池子2（随机选 1 组，补该图尚未在场的 2 块中随机 1 块）
 *   第 3 块：池子3（唯一 1 组，补该图尚未在场的 3 块中随机 1 块）
 *   第 4 块：池子4（从备用池列表随机选 1 组，补该图尚未在场的 4 块中随机 1 块）
 *
 * 落点（§4.8.3）：4 张碎片 × 4 个空位 = 4! = 24 种排列，取第一个满足校验的。
 *
 * ⚠️ HC-03：补位的碎片必须是「尚未在场」的碎片，且不得与场上已有碎片重复。
 */

export interface RefillPlan {
  /** 顺序固定：[池子1, 池子2, 池子3, 池子4] 各 1 块 */
  pieces: number[];
  /** 对应的图ID，顺序同上 */
  images: number[];
}

export interface RefillResult {
  grid: Grid;
  plan: RefillPlan;
  /** 是否使用了 §4.8.4 的位置交换兜底 */
  usedSwapFallback: boolean;
  /** 是否使用了 §4.13.2 强制构造 */
  usedForceConstruct: boolean;
  /** 实际采用的排列下标（0~23），便于埋点与排查 */
  usedPermutation: number;
}

/** 某张图尚未在场的碎片位置 */
export function missingPositions(grid: Grid, imageId: number): number[] {
  const present = new Set<number>();
  for (const cell of grid.toArray()) {
    if (cell !== null && imageOf(cell) === imageId) present.add(cell % 4);
  }
  const out: number[] = [];
  for (let p = 0; p < 4; p++) if (!present.has(p)) out.push(p);
  return out;
}

/** 选出本次补位的 4 块碎片（§4.5） */
export function selectRefillPieces(grid: Grid, imageIds: readonly number[], rng: Rng): RefillPlan {
  const snap = poolSnapshot(grid, imageIds);

  if (snap.pool1.length !== 1) {
    throw new Error(`selectRefillPieces: 池子1 应有且仅有 1 组，实际 ${snap.pool1.length} 组`);
  }
  if (snap.pool2.length < 1) {
    throw new Error(`selectRefillPieces: 池子2 至少应有 1 组，实际 ${snap.pool2.length} 组`);
  }
  if (snap.pool3.length !== 1) {
    throw new Error(`selectRefillPieces: 池子3 应有且仅有 1 组，实际 ${snap.pool3.length} 组`);
  }
  if (snap.pool4.length !== 2) {
    // 消除的池子5 回池（1 张）+ 原备用池的图（1 张）
    throw new Error(`selectRefillPieces: 池子4 应恰好 2 组（消除的图 + 原备用池图），实际 ${snap.pool4.length} 组`);
  }

  const images = [snap.pool1[0]!, rng.pick(snap.pool2), snap.pool3[0]!, rng.pick(snap.pool4)];
  const pieces = images.map((img) => {
    const missing = missingPositions(grid, img);
    if (missing.length === 0) throw new Error(`selectRefillPieces: 图 ${img} 已无缺失碎片，池子划分异常`);
    return pieceOf(img, rng.pick(missing));
  });

  return { pieces, images };
}

/** 4! = 24 种排列，字典序（对应 §4.8.3 的「排列1 ~ 排列24」） */
export function permutationsOf4(): number[][] {
  const out: number[][] = [];
  const items = [0, 1, 2, 3];
  const permute = (prefix: number[], rest: number[]): void => {
    if (rest.length === 0) {
      out.push(prefix.slice());
      return;
    }
    for (let i = 0; i < rest.length; i++) {
      const next = rest.slice();
      const picked = next.splice(i, 1)[0]!;
      permute([...prefix, picked], next);
    }
  };
  permute([], items);
  return out;
}

/** 24 种排列（常量，避免重复计算） */
export const PERMUTATIONS_24: readonly number[][] = permutationsOf4();

/**
 * 执行补位。
 * 要求调用前网格恰好有 4 个空位（即刚刚消除 1 组并完成下压）。
 */
export function refillGrid(grid: Grid, imageIds: readonly number[], rng: Rng): RefillResult {
  const empties = sortCellsByRowThenCol(grid, grid.emptyIndices());
  if (empties.length !== 4) {
    throw new Error(`refillGrid: 补位要求恰好 4 个空位，实际 ${empties.length}`);
  }

  const plan = selectRefillPieces(grid, imageIds, rng);

  // §4.8.3：枚举 24 种落点排列，取第一个通过校验的
  for (let p = 0; p < PERMUTATIONS_24.length; p++) {
    const perm = PERMUTATIONS_24[p]!;
    const trial = grid.clone();
    for (let i = 0; i < 4; i++) trial.setAt(empties[perm[i]!]!, plan.pieces[i]!);
    if (validateBoard(trial).ok) {
      return { grid: trial, plan, usedSwapFallback: false, usedForceConstruct: false, usedPermutation: p };
    }
  }

  // §4.8.4 兜底：随机选一块已在场上的碎片，与补位碎片交换位置，重新检查，最多 10 次
  const trial = grid.clone();
  for (let i = 0; i < 4; i++) trial.setAt(empties[i]!, plan.pieces[i]!);
  const emptySet = new Set(empties);
  const occupiedCells = trial.indices().filter((i) => !emptySet.has(i));

  for (let attempt = 0; attempt < 10; attempt++) {
    const a = rng.pick(occupiedCells);
    const b = rng.pick(empties);
    swapCells(trial, a, b);
    if (validateBoard(trial).ok) {
      return { grid: trial, plan, usedSwapFallback: true, usedForceConstruct: false, usedPermutation: -1 };
    }
    swapCells(trial, a, b); // 未通过则换回，尝试下一对
  }

  // §4.13.2 强制构造（保留池子结构）
  const forced = forceConstructForRefill(grid, plan, rng);
  return { grid: forced, plan, usedSwapFallback: true, usedForceConstruct: true, usedPermutation: -1 };
}
