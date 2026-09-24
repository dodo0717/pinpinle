import { Grid } from '../assets/scripts/core/grid';
import { pieceOf } from '../assets/scripts/core/pieces';

export type CellSpec = [imageId: number, position: number] | null;

/** 用「图ID + 位置」列表快速搭一个棋盘（null = 空位） */
export function makeGrid(rows: number, cols: number, spec: readonly CellSpec[]): Grid {
  if (spec.length !== rows * cols) {
    throw new Error(`makeGrid: spec 长度 ${spec.length} != ${rows * cols}`);
  }
  const grid = new Grid(rows, cols);
  spec.forEach((item, i) => {
    grid.setAt(i, item === null ? null : pieceOf(item[0], item[1]));
  });
  return grid;
}

/** 造一个「除指定 2×2 区域外全部填无关图」的棋盘 */
export function fillRest(grid: Grid, skip: readonly number[], startImage = 100): void {
  let img = startImage;
  for (let i = 0; i < grid.size; i++) {
    if (skip.includes(i)) continue;
    grid.setAt(i, pieceOf(img, 0));
    img++;
  }
}

/** 随机相邻格子对 */
export function randomAdjacentPair(grid: Grid, rnd: () => number): [number, number] {
  for (;;) {
    const a = Math.floor(rnd() * grid.size);
    const r = grid.rowOf(a);
    const c = grid.colOf(a);
    const neighbors: number[] = [];
    if (r > 0) neighbors.push(grid.index(r - 1, c));
    if (r + 1 < grid.rows) neighbors.push(grid.index(r + 1, c));
    if (c > 0) neighbors.push(grid.index(r, c - 1));
    if (c + 1 < grid.cols) neighbors.push(grid.index(r, c + 1));
    if (neighbors.length === 0) continue;
    return [a, neighbors[Math.floor(rnd() * neighbors.length)]!];
  }
}
