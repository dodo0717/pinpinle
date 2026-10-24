import { imageOf } from './pieces.js';

/** 格子内容：碎片ID，或 null（消除后、补位前的空位） */
                                 

/**
 * 网格（§5.2）
 *   由 行数 × 列数 个格子组成，每格存放 1 块碎片的 ID。
 *   正常状态下网格恒满格；只有「消除后 / 补位前」的中间态允许出现 null。
 *   下标约定：index = row * cols + col
 */
export class Grid {
           rows        ;
           cols        ;
                   data        ;

  constructor(rows        , cols        , data                  ) {
    if (rows <= 0 || cols <= 0) throw new Error(`Grid: 行列必须为正，收到 ${rows}x${cols}`);
    this.rows = rows;
    this.cols = cols;
    if (data) {
      if (data.length !== rows * cols) {
        throw new Error(`Grid: 数据长度 ${data.length} != ${rows * cols}`);
      }
      this.data = data.slice();
    } else {
      this.data = new Array      (rows * cols).fill(null);
    }
  }

  get size()         {
    return this.rows * this.cols;
  }

  index(row        , col        )         {
    return row * this.cols + col;
  }

  rowOf(index        )         {
    return Math.floor(index / this.cols);
  }

  colOf(index        )         {
    return index % this.cols;
  }

  inBounds(row        , col        )          {
    return row >= 0 && row < this.rows && col >= 0 && col < this.cols;
  }

  get(row        , col        )       {
    return this.data[this.index(row, col)] ;
  }

  set(row        , col        , value      )       {
    this.data[this.index(row, col)] = value;
  }

  cellAt(index        )       {
    return this.data[index] ;
  }

  setAt(index        , value      )       {
    this.data[index] = value;
  }

  clone()       {
    return new Grid(this.rows, this.cols, this.data);
  }

  /** 返回内部数据副本 */
  toArray()         {
    return this.data.slice();
  }

  /** 所有格子的下标 [0, size) */
  indices()           {
    const out           = [];
    for (let i = 0; i < this.data.length; i++) out.push(i);
    return out;
  }

  emptyIndices()           {
    const out           = [];
    for (let i = 0; i < this.data.length; i++) if (this.data[i] === null) out.push(i);
    return out;
  }

  /** 场上每张图有多少块碎片在场 */
  countByImage()                      {
    const map = new Map                ();
    for (const cell of this.data) {
      if (cell === null) continue;
      const img = imageOf(cell);
      map.set(img, (map.get(img) ?? 0) + 1);
    }
    return map;
  }

  /** 某张图在场的位置集合（0/1/2/3） */
  positionsOfImage(imageId        )           {
    const out           = [];
    for (const cell of this.data) {
      if (cell === null) continue;
      if (imageOf(cell) === imageId) out.push(cell % 4);
    }
    return out.sort((a, b) => a - b);
  }

  findCellOfPiece(pieceId        )         {
    for (let i = 0; i < this.data.length; i++) if (this.data[i] === pieceId) return i;
    return -1;
  }

  toString()         {
    const lines           = [];
    for (let r = 0; r < this.rows; r++) {
      const row           = [];
      for (let c = 0; c < this.cols; c++) {
        const v = this.get(r, c);
        row.push(v === null ? '  ..  ' : String(v).padStart(2, '0') + '/' + v % 4 + '  ');
      }
      lines.push(row.join('|'));
    }
    return lines.join('\n');
  }
}

/** 相邻判定（§6.1）：仅上下左右 */
export function isAdjacent(grid      , a        , b        )          {
  if (a === b) return false;
  const dr = Math.abs(grid.rowOf(a) - grid.rowOf(b));
  const dc = Math.abs(grid.colOf(a) - grid.colOf(b));
  return dr + dc === 1;
}

/** 交换两个格子的内容（原地） */
export function swapCells(grid      , a        , b        )       {
  const va = grid.cellAt(a);
  grid.setAt(a, grid.cellAt(b));
  grid.setAt(b, va);
}
