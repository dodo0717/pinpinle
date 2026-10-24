import { Grid } from './grid.js';
import { POS_BL, POS_BR, POS_TL, POS_TR, imageOf, positionOf } from './pieces.js';

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
export function isCorrectHorizontalPair(a        , b        )          {
  if (imageOf(a) !== imageOf(b)) return false;
  const pa = positionOf(a);
  const pb = positionOf(b);
  return (pa === POS_TL && pb === POS_TR) || (pa === POS_BL && pb === POS_BR);
}

/** A 在上、B 在下时，是否是「正确相邻」 */
export function isCorrectVerticalPair(a        , b        )          {
  if (imageOf(a) !== imageOf(b)) return false;
  const pa = positionOf(a);
  const pb = positionOf(b);
  return (pa === POS_TL && pb === POS_BL) || (pa === POS_TR && pb === POS_BR);
}

                             
                         
                  
                  
                   
                  
 

/** 某个格子的融合显示状态：四个方向哪些边需要向外扩展（覆盖缝隙、去掉边界） */
                               
                    
                  
                  
                    
                   
                     
                     
                      
     
                                                
    
                                            
                                              
                                                             
                                              
                                 
     
                    
                    
                     
                     
     
                                      
    
                                      
                                            
                                            
     
                  
                  
 

/** 求当前网格的所有融合组（单块也会成为一个大小为 1 的组） */
export function computeMergeGroups(grid      )               {
  const parent = new Map                ();
  const find = (x        )         => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root) ;
    // 路径压缩
    let cur = x;
    while (parent.get(cur) !== root) {
      const next = parent.get(cur) ;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  const union = (a        , b        )       => {
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

  const buckets = new Map                  ();
  for (const [cellIndex] of parent) {
    const root = find(cellIndex);
    const list = buckets.get(root) ?? [];
    list.push(cellIndex);
    buckets.set(root, list);
  }

  // ⚠️ 不能写 `[...buckets.keys()]`：Cocos 构建按 loose 模式把展开编译成 `[].concat(iter)`，
  // 迭代器不会被展开，拿到的是 `[迭代器]` 本身（见 test/cocos-compat.test.ts）
  const roots = Array.from(buckets.keys()).sort((a, b) => a - b);
  const groups               = [];
  roots.forEach((root, groupId) => {
    const cells = buckets.get(root) .slice().sort((a, b) => a - b);
    const piece = grid.cellAt(cells[0] ) ;
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
export function computeMergeDisplay(grid      )                 {
  const groups = computeMergeGroups(grid);
  const groupOfCell = new Map                    ();
  for (const g of groups) for (const cell of g.cells) groupOfCell.set(cell, g);

  /** 组的包围盒（格数）与四象限原点 —— 只在网格坐标系里算，不掺任何屏幕尺寸 */
                      
                   
                   
                 
                 
                    
                    
   
  const boxOfGroup = new Map                  ();
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
      const pos = positionOf(grid.cellAt(cell) );
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

  const out                 = [];
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const i = grid.index(r, c);
      const piece = grid.cellAt(i);
      if (piece === null) continue;
      const group = groupOfCell.get(i) ;
      const box = boxOfGroup.get(group.groupId) ;

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
export function mergeGroupOfCell(grid      , cellIndex        )                    {
  if (!Number.isInteger(cellIndex) || cellIndex < 0 || cellIndex >= grid.size) return null;
  if (grid.cellAt(cellIndex) === null) return null;
  return computeMergeGroups(grid).find((g) => g.cells.includes(cellIndex)) ?? null;
}

/** 位置码 → 象限列（0/1） */
function posColOf(pos        )         {
  return pos === POS_TR || pos === POS_BR ? 1 : 0;
}

/** 位置码 → 象限行（0/1） */
function posRowOf(pos        )         {
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
export function findHintCells(grid      )           {
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

  const out           = [];
  for (let i = 0; i < grid.size; i++) {
    const piece = grid.cellAt(i);
    if (piece !== null && imageOf(piece) === bestImage) out.push(i);
  }
  return out;
}

/** 融合组是否已满足消除条件（4 块 = 2×2 全对） */
export function isMergeGroupComplete(group            )          {
  return group.cells.length === 4;
}
