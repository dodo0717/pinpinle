import { Grid } from './grid';
import { PIECES_PER_IMAGE, POS_BL, POS_BR, POS_TL, POS_TR, imageOf, positionOf } from './pieces';

/**
 * 内容完整性（§4.9 第一步 / §3.4）
 *
 * 定义：某张图的 **4 块碎片全部在场**（与它们摆在哪个格子无关）。
 *
 * 由池子模型（§4.3 / §4.4）保证：任何合法棋盘中，4 块齐全的图**恰好 1 张**。
 * 因此「内容完整性恰好 1 组」= 恰好 1 张图齐全，这正是 HC-01 的前半句。
 *
 * ⚠️ 注意与「消除判定」（§6.2）区分：
 *   消除需要在**某个 2×2 区域**里同时满足「4 块同图」+「位置正确」，见
 *   findAllSameImageSquares / findAllPositionCorrectMatches。
 *   §4.10 明确要求首局把池子5 的 4 块**打散**（不得聚拢在同一个 2×2），
 *   所以「4 块齐全」与「4 块同图且占据 2×2」是两件事，绝不可混用。
 */
export interface ContentGroup {
  imageId: number;
  /** 4 块碎片所在格子的下标，按碎片位置 0/1/2/3 排序 */
  cells: number[];
  /** 4 块碎片 ID，按位置 0/1/2/3 排序 */
  pieces: number[];
}

/** 一个 2×2 匹配区域 */
export interface MatchRegion {
  /** 区域左上角的行 / 列 */
  row: number;
  col: number;
  /** 4 个格子的下标，顺序为 [左上, 右上, 左下, 右下] */
  cells: [number, number, number, number];
  /** 4 个格子上的碎片ID，顺序同上 */
  pieces: [number, number, number, number];
  imageId: number;
}

/** 找出所有「4 块碎片全部在场」的图（内容完整性组），按图ID升序 */
export function findAllContentMatches(grid: Grid): ContentGroup[] {
  const byImage = new Map<number, { cells: number[]; pieces: number[] }>();
  for (let i = 0; i < grid.size; i++) {
    const piece = grid.cellAt(i);
    if (piece === null) continue;
    const img = imageOf(piece);
    let entry = byImage.get(img);
    if (!entry) {
      entry = { cells: [], pieces: [] };
      byImage.set(img, entry);
    }
    entry.cells.push(i);
    entry.pieces.push(piece);
  }

  const out: ContentGroup[] = [];
  for (const [imageId, entry] of byImage) {
    if (entry.pieces.length !== PIECES_PER_IMAGE) continue;
    // 按位置 0/1/2/3 排序，保证结果稳定可断言
    const order = entry.pieces
      .map((_, i) => i)
      .sort((a, b) => positionOf(entry.pieces[a]!) - positionOf(entry.pieces[b]!));
    out.push({
      imageId,
      cells: order.map((i) => entry.cells[i]!),
      pieces: order.map((i) => entry.pieces[i]!),
    });
  }
  out.sort((a, b) => a.imageId - b.imageId);
  return out;
}

/**
 * 消除判定第一步（§4.9 第一步 / §6.2）
 * 扫描全网格，找出所有「4 块同图，且恰好占据一个 2×2 区域」的区域。
 */
export function findAllSameImageSquares(grid: Grid): MatchRegion[] {
  const out: MatchRegion[] = [];
  for (let r = 0; r + 1 < grid.rows; r++) {
    for (let c = 0; c + 1 < grid.cols; c++) {
      const i00 = grid.index(r, c);
      const i01 = grid.index(r, c + 1);
      const i10 = grid.index(r + 1, c);
      const i11 = grid.index(r + 1, c + 1);
      const p00 = grid.cellAt(i00);
      const p01 = grid.cellAt(i01);
      const p10 = grid.cellAt(i10);
      const p11 = grid.cellAt(i11);
      if (p00 === null || p01 === null || p10 === null || p11 === null) continue;
      const img = imageOf(p00);
      if (imageOf(p01) !== img || imageOf(p10) !== img || imageOf(p11) !== img) continue;
      out.push({ row: r, col: c, cells: [i00, i01, i10, i11], pieces: [p00, p01, p10, p11], imageId: img });
    }
  }
  return out;
}

/**
 * 消除判定第二步（§4.9 第二步 / §6.2）
 * 在「4 块同图的 2×2 区域」中，筛出「位置 0/1/2/3 恰好落在左上/右上/左下/右下」的区域 —— 即真正可消除的区域。
 */
export function findAllPositionCorrectMatches(grid: Grid): MatchRegion[] {
  return findAllSameImageSquares(grid).filter((m) => {
    return (
      positionOf(m.pieces[0]) === POS_TL &&
      positionOf(m.pieces[1]) === POS_TR &&
      positionOf(m.pieces[2]) === POS_BL &&
      positionOf(m.pieces[3]) === POS_BR
    );
  });
}

/** 补位后 / 首局加载后的合格判定（§4.9）：内容完整性恰好 1 组，且没有任何已拼好的 2×2 */
export interface BoardValidation {
  ok: boolean;
  /** 内容完整性组（4 块齐全的图），正常恒为 1 组 */
  content: ContentGroup[];
  /** 已拼合正确的 2×2，正常恒为 0 组 */
  positionCorrect: MatchRegion[];
}

export function validateBoard(grid: Grid): BoardValidation {
  const content = findAllContentMatches(grid);
  const positionCorrect = findAllPositionCorrectMatches(grid);
  return { ok: content.length === 1 && positionCorrect.length === 0, content, positionCorrect };
}
