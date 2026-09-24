import { ALL_POSITIONS, pieceOf } from './pieces';
import { Rng, pickSome } from './rng';

/**
 * 池子结构装配（§4.4）
 *
 * 初始结构（每关固定）：
 *   池子5 1 张：4 块在场
 *   池子1 1 张：3 块在场
 *   池子2 (格数-8)÷2 张：各 2 块在场
 *   池子3 1 张：1 块在场
 *   池子4 1 张：0 块在场
 * 合计图数 = (格数-8)÷2 + 4；合计在场碎片 = 格数
 */

export interface PoolAssignment {
  /** 池子5（4 块在场） */
  complete: number;
  /** 池子1（3 块在场） */
  pool1: number;
  /** 池子2（各 2 块在场） */
  pool2: number[];
  /** 池子3（1 块在场） */
  pool3: number;
  /** 池子4（0 块在场） */
  pool4: number;
}

/** 池子2 的组数：(格数 - 8) ÷ 2 */
export function pool2GroupCount(cells: number): number {
  return (cells - 8) / 2;
}

/** 按 §4.4 从本关图列表中随机分配图到各池子 */
export function assignPools(cells: number, imageIds: readonly number[], rng: Rng): PoolAssignment {
  const pool2Count = pool2GroupCount(cells);
  const required = pool2Count + 4;
  if (!Number.isInteger(pool2Count) || pool2Count < 0) {
    throw new Error(`assignPools: 格数 ${cells} 非法（(格数-8)÷2 必须为非负整数）`);
  }
  if (imageIds.length < required) {
    throw new Error(`assignPools: 本关图数不足，需要 ${required} 张，实际 ${imageIds.length} 张`);
  }

  const chosen = rng.shuffle(imageIds).slice(0, required);
  let k = 0;
  const complete = chosen[k++]!;
  const pool1 = chosen[k++]!;
  const pool2 = chosen.slice(k, k + pool2Count);
  k += pool2Count;
  const pool3 = chosen[k++]!;
  const pool4 = chosen[k++]!;
  return { complete, pool1, pool2, pool3, pool4 };
}

/** 某张图的全部 4 块碎片 */
export function allPiecesOf(imageId: number): number[] {
  return ALL_POSITIONS.map((p) => pieceOf(imageId, p));
}

/** 某张图随机取 count 块碎片（随机会选「哪几个位置在场」） */
export function randomPieceSubset(imageId: number, count: number, rng: Rng): number[] {
  return pickSome(rng, ALL_POSITIONS, count).map((p) => pieceOf(imageId, p));
}

/**
 * 按池子结构生成「除池子5 外的全部在场碎片」（数量 = 格数 - 4）
 * 池子1 → 3 块；池子2 每组 → 2 块；池子3 → 1 块；池子4 → 0 块
 */
export function piecesForAssignment(assign: PoolAssignment, rng: Rng): number[] {
  const out: number[] = [];
  out.push(...randomPieceSubset(assign.pool1, 3, rng));
  for (const img of assign.pool2) out.push(...randomPieceSubset(img, 2, rng));
  out.push(...randomPieceSubset(assign.pool3, 1, rng));
  return out;
}

/** 按池子结构生成完整碎片集合（含池子5 的 4 块），数量 = 格数 */
export function allPiecesForAssignment(assign: PoolAssignment, rng: Rng): number[] {
  return [...allPiecesOf(assign.complete), ...piecesForAssignment(assign, rng)];
}

/** 这 4 个格子的下标是否恰好构成一个 2×2 方形区域 */
export function isExactSquare(cells: readonly number[], cols: number): boolean {
  if (cells.length !== 4) return false;
  const rowSet = new Set(cells.map((i) => Math.floor(i / cols)));
  const colSet = new Set(cells.map((i) => i % cols));
  if (rowSet.size !== 2 || colSet.size !== 2) return false;
  const r0 = Math.min(...rowSet);
  const c0 = Math.min(...colSet);
  const want = new Set([r0 * cols + c0, r0 * cols + c0 + 1, (r0 + 1) * cols + c0, (r0 + 1) * cols + c0 + 1]);
  if (want.size !== 4) return false;
  return cells.every((i) => want.has(i));
}

/**
 * 随机选 4 个格子，且这 4 格不得聚拢在同一个 2×2 区域内（§4.10 第 1 步）。
 *
 * 说明：§4.10 原文描述为「随机选 4 格 → 若构成 2×2 则保留 1 块、移走任意 1 块 → 循环检查」。
 * 这里改用「直接重抽」实现，产出的集合分布与原文目标一致（都是「均匀取自全部非 2×2 的 4 元子集」），
 * 且可证明一定终止（(格数-4) 个候选远多于 4 元子集数量，单次失败概率极低）。
 */
export function pickNonSquareCells(rows: number, cols: number, rng: Rng): number[] {
  const total = rows * cols;
  const all = Array.from({ length: total }, (_, i) => i);
  for (let attempt = 0; attempt < 200; attempt++) {
    const cells = rng.shuffle(all).slice(0, 4);
    if (!isExactSquare(cells, cols)) return cells;
  }
  // 确定性兜底（理论上到不了这里）
  const first = [0, 1, cols, cols + 1];
  if (!isExactSquare(first, cols)) return first;
  return [0, 1, 2, 3];
}
