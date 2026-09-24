import { Grid } from './grid';
import { validateBoard } from './matcher';
import { ALL_POSITIONS, imageOf, pieceOf } from './pieces';
import { Rng } from './rng';
import { forceConstructForInit } from './forceConstruct';
import {
  assignPools,
  pickNonSquareCells,
  piecesForAssignment,
  type PoolAssignment,
} from './structure';

/**
 * 首局生成（§4.10）
 *
 * 1. 按 §4.4 随机分配图到各池子
 * 2. 随机选 4 个格子放「池子5」的 4 块碎片，且这 4 格不得聚拢在同一个 2×2 区域内
 * 3. 其余碎片（池子1/2/3）随机填入剩余格子
 * 4. 校验：内容完整性必须恰好 1 组；位置拼合状态必须 0 组
 *    → 校验失败直接走 §4.13.1 强制构造
 */
export function buildInitialGrid(rows: number, cols: number, imageIds: readonly number[], rng: Rng): Grid {
  const cells = rows * cols;
  const assign = assignPools(cells, imageIds, rng);
  const grid = buildFromAssignment(rows, cols, assign, rng);

  if (validateBoard(grid).ok) return grid;
  // §4.13.1 兜底
  return forceConstructForInit(rows, cols, imageIds, rng);
}

/** 按 §4.10 的第 2、3 步装配棋盘 */
function buildFromAssignment(rows: number, cols: number, assign: PoolAssignment, rng: Rng): Grid {
  const grid = new Grid(rows, cols);
  const occupied = pickNonSquareCells(rows, cols, rng);
  const occupiedSet = new Set(occupied);

  // 第 2 步：池子5 的 4 块碎片随机占用这 4 格
  const positionOrder = rng.shuffle(ALL_POSITIONS);
  occupied.forEach((cellIndex, i) => {
    grid.setAt(cellIndex, pieceOf(assign.complete, positionOrder[i]!));
  });

  // 第 3 步：其余碎片随机填入剩余格子
  const others = piecesForAssignment(assign, rng);
  if (others.length !== grid.size - ALL_POSITIONS.length) {
    throw new Error(`buildFromAssignment: 其余碎片数量 ${others.length} != 空余格数 ${grid.size - 4}`);
  }
  const free = grid.indices().filter((i) => !occupiedSet.has(i));
  const shuffledOthers = rng.shuffle(others);
  free.forEach((cellIndex, i) => {
    grid.setAt(cellIndex, shuffledOthers[i]!);
  });

  return grid;
}

/** 调试用：把棋盘打印成「图ID:位置」矩阵 */
export function describeGrid(grid: Grid): string {
  const lines: string[] = [];
  for (let r = 0; r < grid.rows; r++) {
    const row: string[] = [];
    for (let c = 0; c < grid.cols; c++) {
      const piece = grid.get(r, c);
      if (piece === null) row.push(' .. ');
      else row.push(`${String(imageOf(piece)).padStart(2, '0')}:${piece % 4} `);
    }
    lines.push(row.join('|'));
  }
  return lines.join('\n');
}
