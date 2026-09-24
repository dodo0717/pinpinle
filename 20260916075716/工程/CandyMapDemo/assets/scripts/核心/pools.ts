import { Grid } from './grid';

/**
 * 池子模型（§4.3、§4.6）
 *
 * 每张图按「场上块数」归入池子：
 *   场上 4 块 → 池子5（4 块完整图，等待被消除）
 *   场上 3 块 → 池子1（3缺1）
 *   场上 2 块 → 池子2（2缺2）
 *   场上 1 块 → 池子3（1缺3）
 *   场上 0 块 → 池子4（备用池，用列表维护）
 *
 * 注意：池子归属完全可由「场上块数」推导，因此不需要额外维护列表；
 * 但池子4 的「列表」语义在 §4.6 中被使用（补位过程中短暂为 2，补完恢复为 1），
 * 这与「场上 0 块的图」推导结果完全一致（消除的池子5 进场 + 原池子4 的图，共 2 张）。
 */

/** 池子5（4 块完整图；用常量 0 表示，与池子1~4 的编号错开） */
export const POOL_COMPLETE = 0;
/** 3缺1 */
export const POOL_1 = 1;
/** 2缺2 */
export const POOL_2 = 2;
/** 1缺3 */
export const POOL_3 = 3;

/** 场上块数 → 池子号（4→池子5，3→池子1，2→池子2，1→池子3，0→池子4） */
export function poolLevelOfOnBoardCount(count: number): number {
  if (count < 0 || count > 4) throw new Error(`poolLevelOfOnBoardCount: 非法场上块数 ${count}`);
  return 4 - count;
}

export interface PoolSnapshot {
  /** 池子5：场上 4 块完整图 */
  complete: number[];
  /** 池子1：场上 3 块 */
  pool1: number[];
  /** 池子2：场上 2 块 */
  pool2: number[];
  /** 池子3：场上 1 块 */
  pool3: number[];
  /** 池子4：场上 0 块（备用池） */
  pool4: number[];
}

/**
 * 取当前网格的池子快照。
 * imageIds 为本关使用的图列表（不在本关的图不参与池子统计）。
 * 每张列表按图ID升序，保证结果可复现。
 */
export function poolSnapshot(grid: Grid, imageIds: readonly number[]): PoolSnapshot {
  const count = grid.countByImage();
  const snap: PoolSnapshot = { complete: [], pool1: [], pool2: [], pool3: [], pool4: [] };
  for (const id of [...imageIds].sort((a, b) => a - b)) {
    const c = count.get(id) ?? 0;
    switch (poolLevelOfOnBoardCount(c)) {
      case POOL_COMPLETE:
        snap.complete.push(id);
        break;
      case POOL_1:
        snap.pool1.push(id);
        break;
      case POOL_2:
        snap.pool2.push(id);
        break;
      case POOL_3:
        snap.pool3.push(id);
        break;
      // 只剩「场上 0 块」一种可能（池子号 4）→ 备用池
      default:
        snap.pool4.push(id);
        break;
    }
  }
  return snap;
}
