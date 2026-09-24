import { Grid } from './grid';
import { POS_BL, POS_BR, POS_TL, POS_TR, imageOf, positionOf } from './pieces';

/**
 * 融合机制（新增，参考《Jigsaw Drop》）
 *
 * 规则：相邻两块 A、B 同时满足 ↓ 时，A 与 B 之间形成「正确相邻」边
 *   1. 同一张图
 *   2. 网格中相邻（上下左右）
 *   3. 相对位置正确：
 *        水平（A 在 B 左侧）：仅允许 (posA,posB) = (0,1) 或 (2,3)
 *        垂直（A 在 B 上方）：仅允许 (posA,posB) = (0,2) 或 (1,3)
 * 以「正确相邻」为边求连通分量，每个分量即一个「融合组」。
 *
 * 重要结论：4 块位置节点在这 4 种合法边下构成的唯一连通图是 4-环，
 * 因此「融合组满 4 块」⟺「必须构成正确的 2×2」⟺「必然满足消除条件」。
 * 即：融合组达到 4 块的那一帧就是消除帧。
 */

/** A 在左、B 在右时，是否是「正确相邻」 */
export function isCorrectHorizontalPair(a: number, b: number): boolean {
  if (imageOf(a) !== imageOf(b)) return false;
  const pa = positionOf(a);
  const pb = positionOf(b);
  return (pa === POS_TL && pb === POS_TR) || (pa === POS_BL && pb === POS_BR);
}

/** A 在上、B 在下时，是否是「正确相邻」 */
export function isCorrectVerticalPair(a: number, b: number): boolean {
  if (imageOf(a) !== imageOf(b)) return false;
  const pa = positionOf(a);
  const pb = positionOf(b);
  return (pa === POS_TL && pb === POS_BL) || (pa === POS_TR && pb === POS_BR);
}

export interface MergeGroup {
  /** 组序号，用于渲染时分组绘制外轮廓 */
  groupId: number;
  imageId: number;
  /** 组内格子下标（升序） */
  cells: number[];
}

/** 某个格子的融合显示状态：四个方向哪些边需要向外扩展（覆盖缝隙、去掉边界） */
export interface MergeDisplay {
  cellIndex: number;
  pieceId: number;
  groupId: number;
  groupSize: number;
  mergeUp: boolean;
  mergeDown: boolean;
  mergeLeft: boolean;
  mergeRight: boolean;
  /**
   * 组在网格里的**列跨度 / 行跨度**（格数），以及本格在组内的列/行偏移（0 起）。
   *
   * ⚠️ 这几个字段是「拼合视觉逐像素一致」（§11.6.3）的前提，不是排版糖：
   * 渲染层必须按**整组**的统一比例取样纹理 —— 少了跨度信息，每块只能各按自己的
   * 元素尺寸取样（CSS `background-size: 200% 200%`），而融合时元素向外扩了半个缝隙，
   * 百分比随之变大 → 每块被放大的倍率不同，接缝两侧的原图坐标差 1 个源像素以上。
   * 详见 `web/ui/geometry.ts` 的说明。
   */
  groupCols: number;
  groupRows: number;
  colInGroup: number;
  rowInGroup: number;
  /**
   * 组的「四象限原点」= 组内最小的 posCol / posRow。
   *
   * 纹理对齐要**从组的原点算起**，而不是从「本块自己的位置」算起：
   * 组满 2 列时，右列那块的位置码是 1 或 3，但其在组内的象限只有 1 个，
   * 从自身算会把整张图错位半幅。单块的组里原点就是它自己的位置码（等价于旧行为）。
   */
  quadCol: number;
  quadRow: number;
}

/** 求当前网格的所有融合组（单块也会成为一个大小为 1 的组） */
export function computeMergeGroups(grid: Grid): MergeGroup[] {
  const parent = new Map<number, number>();
  const find = (x: number): number => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    // 路径压缩
    let cur = x;
    while (parent.get(cur) !== root) {
      const next = parent.get(cur)!;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  };

  for (let i = 0; i < grid.size; i++) {
    if (grid.cellAt(i) !== null) parent.set(i, i);
  }

  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const i = grid.index(r, c);
      const cur = grid.cellAt(i);
      if (cur === null) continue;

      if (c + 1 < grid.cols) {
        const right = grid.cellAt(grid.index(r, c + 1));
        if (right !== null && isCorrectHorizontalPair(cur, right)) union(i, grid.index(r, c + 1));
      }
      if (r + 1 < grid.rows) {
        const down = grid.cellAt(grid.index(r + 1, c));
        if (down !== null && isCorrectVerticalPair(cur, down)) union(i, grid.index(r + 1, c));
      }
    }
  }

  const buckets = new Map<number, number[]>();
  for (const [cellIndex] of parent) {
    const root = find(cellIndex);
    const list = buckets.get(root) ?? [];
    list.push(cellIndex);
    buckets.set(root, list);
  }

  const roots = [...buckets.keys()].sort((a, b) => a - b);
  const groups: MergeGroup[] = [];
  roots.forEach((root, groupId) => {
    const cells = buckets.get(root)!.slice().sort((a, b) => a - b);
    const piece = grid.cellAt(cells[0]!)!;
    groups.push({ groupId, imageId: imageOf(piece), cells });
  });
  return groups;
}

/**
 * 供渲染层（L09/L10）使用的逐格显示状态。
 * M3 用 mergeUp / mergeDown / mergeLeft / mergeRight 决定：
 *   - 该碎片哪几侧要把纹理子矩形向外扩展（覆盖 2~4px 缝隙 → 真无缝）
 *   - 该碎片哪几侧不画底卡边界 / 圆角 / 内阴影（去掉边界感）
 */
export function computeMergeDisplay(grid: Grid): MergeDisplay[] {
  const groups = computeMergeGroups(grid);
  const groupOfCell = new Map<number, MergeGroup>();
  for (const g of groups) for (const cell of g.cells) groupOfCell.set(cell, g);

  /** 组的包围盒（格数）与四象限原点 —— 只在网格坐标系里算，不掺任何屏幕尺寸 */
  interface GroupBox {
    minRow: number;
    minCol: number;
    cols: number;
    rows: number;
    quadCol: number;
    quadRow: number;
  }
  const boxOfGroup = new Map<number, GroupBox>();
  for (const g of groups) {
    let minRow = Infinity;
    let maxRow = -Infinity;
    let minCol = Infinity;
    let maxCol = -Infinity;
    let quadCol = 2;
    let quadRow = 2;
    for (const cell of g.cells) {
      const row = grid.rowOf(cell);
      const col = grid.colOf(cell);
      minRow = Math.min(minRow, row);
      maxRow = Math.max(maxRow, row);
      minCol = Math.min(minCol, col);
      maxCol = Math.max(maxCol, col);
      const pos = positionOf(grid.cellAt(cell)!);
      quadCol = Math.min(quadCol, posColOf(pos));
      quadRow = Math.min(quadRow, posRowOf(pos));
    }
    boxOfGroup.set(g.groupId, {
      minRow,
      minCol,
      cols: maxCol - minCol + 1,
      rows: maxRow - minRow + 1,
      quadCol,
      quadRow,
    });
  }

  const out: MergeDisplay[] = [];
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const i = grid.index(r, c);
      const piece = grid.cellAt(i);
      if (piece === null) continue;
      const group = groupOfCell.get(i)!;
      const box = boxOfGroup.get(group.groupId)!;

      const left = grid.inBounds(r, c - 1) ? grid.get(r, c - 1) : null;
      const right = grid.inBounds(r, c + 1) ? grid.get(r, c + 1) : null;
      const up = grid.inBounds(r - 1, c) ? grid.get(r - 1, c) : null;
      const down = grid.inBounds(r + 1, c) ? grid.get(r + 1, c) : null;

      out.push({
        cellIndex: i,
        pieceId: piece,
        groupId: group.groupId,
        groupSize: group.cells.length,
        mergeLeft: left !== null && isCorrectHorizontalPair(left, piece),
        mergeRight: right !== null && isCorrectHorizontalPair(piece, right),
        mergeUp: up !== null && isCorrectVerticalPair(up, piece),
        mergeDown: down !== null && isCorrectVerticalPair(piece, down),
        groupCols: box.cols,
        groupRows: box.rows,
        colInGroup: c - box.minCol,
        rowInGroup: r - box.minRow,
        quadCol: box.quadCol,
        quadRow: box.quadRow,
      });
    }
  }
  return out;
}

/**
 * 求某个格子所属的融合组 —— **整片拖动的「整片」就是它**（§1.6）。
 *
 * 单块也会成为一个大小为 1 的组，所以合法格子的返回值恒不为 null；
 * 空位或越界下标返回 null（调用方据此拒绝操作）。
 */
export function mergeGroupOfCell(grid: Grid, cellIndex: number): MergeGroup | null {
  if (!Number.isInteger(cellIndex) || cellIndex < 0 || cellIndex >= grid.size) return null;
  if (grid.cellAt(cellIndex) === null) return null;
  return computeMergeGroups(grid).find((g) => g.cells.includes(cellIndex)) ?? null;
}

/** 位置码 → 象限列（0/1） */
function posColOf(pos: number): number {
  return pos === POS_TR || pos === POS_BR ? 1 : 0;
}

/** 位置码 → 象限行（0/1） */
function posRowOf(pos: number): number {
  return pos === POS_BL || pos === POS_BR ? 1 : 0;
}

/**
 * 新手引导第 2 步（§14）用：「哪 4 块可以拼成一张图」。
 *
 * 判据（确定性的，便于单测与复现）：
 *   1. 只有**同图 ≥2 块**的组才值得提示（单块谈不上「这几块是一张图」）；
 *   2. 取块数最多的那组 —— 块数越多越接近能拼起来；
 *   3. 并列时取 imageId 更小的，保证同一局面每次提示同一组（不做随机，便于验收）。
 *
 * 返回格下标（升序）；全场没有任何同图成对时返回空数组，调用方据此不高亮。
 */
export function findHintCells(grid: Grid): number[] {
  let bestImage = -1;
  let bestCount = 0;
  for (const [imageId, count] of grid.countByImage()) {
    if (count < 2) continue;
    if (count > bestCount || (count === bestCount && imageId < bestImage)) {
      bestImage = imageId;
      bestCount = count;
    }
  }
  if (bestImage < 0) return [];

  const out: number[] = [];
  for (let i = 0; i < grid.size; i++) {
    const piece = grid.cellAt(i);
    if (piece !== null && imageOf(piece) === bestImage) out.push(i);
  }
  return out;
}

/** 融合组是否已满足消除条件（4 块 = 2×2 全对） */
export function isMergeGroupComplete(group: MergeGroup): boolean {
  return group.cells.length === 4;
}
