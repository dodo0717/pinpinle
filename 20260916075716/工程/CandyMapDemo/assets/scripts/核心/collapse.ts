import { Grid } from './grid';

/**
 * 下压算法（§4.8.1）+ 空位排序（§4.8.2）
 *
 * 下压按「列」独立进行：
 *   每列中，被消除的碎片已被置为 null，其余碎片保持相对顺序下落。
 *   空位出现在该列顶部。
 * 因为消除的 2×2 跨越 2 列且两列消除的行号相同，
 * 下压后两列的空位行号相同，都落在列顶部。
 */

/**
 * 原地执行按列下压，并返回排序后的空位下标。
 * 空位排序规则（§4.8.2）：先按行号升序，行号相同再按列号升序。
 */
export function collapseColumns(grid: Grid): number[] {
  const empties: number[] = [];

  for (let c = 0; c < grid.cols; c++) {
    // 从下往上收集非空碎片，保持相对顺序
    const stack: number[] = [];
    for (let r = grid.rows - 1; r >= 0; r--) {
      const v = grid.get(r, c);
      if (v !== null) stack.push(v);
    }
    // 从底部往上填回
    let k = 0;
    for (let r = grid.rows - 1; r >= 0; r--) {
      grid.set(r, c, k < stack.length ? stack[k]! : null);
      k++;
    }
    // 顶部剩余的行即空位
    for (let r = 0; r < grid.rows - stack.length; r++) {
      empties.push(grid.index(r, c));
    }
  }

  return sortCellsByRowThenCol(grid, empties);
}

/** 空位排序（§4.8.2）：先按行，再按列 */
export function sortCellsByRowThenCol(grid: Grid, cells: readonly number[]): number[] {
  return cells.slice().sort((a, b) => {
    const dr = grid.rowOf(a) - grid.rowOf(b);
    if (dr !== 0) return dr;
    return grid.colOf(a) - grid.colOf(b);
  });
}
