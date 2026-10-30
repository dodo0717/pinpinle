import { Grid } from './grid.js';
import { validateBoard } from './matcher.js';
import { ALL_POSITIONS, imageOf, pieceOf, POS_BL, POS_TL } from './pieces.js';
import { Rng } from './rng.js';
import { forceConstructForInit } from './forceConstruct.js';
import {
  assignPools,
  pickNonSquareCells,
  piecesForAssignment,
                      
} from './structure.js';

/**
 * 首局生成（§4.10）
 *
 * 1. 按 §4.4 随机分配图到各池子
 * 2. 随机选 4 个格子放「池子5」的 4 块碎片，且这 4 格不得聚拢在同一个 2×2 区域内
 * 3. 其余碎片（池子1/2/3）随机填入剩余格子
 * 4. 校验：内容完整性必须恰好 1 组；位置拼合状态必须 0 组
 *    → 校验失败直接走 §4.13.1 强制构造
 */
export function buildInitialGrid(rows        , cols        , imageIds                   , rng     )       {
  const cells = rows * cols;
  const assign = assignPools(cells, imageIds, rng);
  const grid = buildFromAssignment(rows, cols, assign, rng);

  if (validateBoard(grid).ok) return grid;
  // §4.13.1 兜底
  return forceConstructForInit(rows, cols, imageIds, rng);
}

/** 按 §4.10 的第 2、3 步装配棋盘 */
function buildFromAssignment(rows        , cols        , assign                , rng     )       {
  const grid = new Grid(rows, cols);
  const occupied = pickNonSquareCells(rows, cols, rng);
  const occupiedSet = new Set(occupied);

  // 第 2 步：池子5 的 4 块碎片随机占用这 4 格
  const positionOrder = rng.shuffle(ALL_POSITIONS);
  occupied.forEach((cellIndex, i) => {
    grid.setAt(cellIndex, pieceOf(assign.complete, positionOrder[i] ));
  });

  // 第 3 步：其余碎片随机填入剩余格子
  const others = piecesForAssignment(assign, rng);
  if (others.length !== grid.size - ALL_POSITIONS.length) {
    throw new Error(`buildFromAssignment: 其余碎片数量 ${others.length} != 空余格数 ${grid.size - 4}`);
  }
  const free = grid.indices().filter((i) => !occupiedSet.has(i));
  const shuffledOthers = rng.shuffle(others);
  free.forEach((cellIndex, i) => {
    grid.setAt(cellIndex, shuffledOthers[i] );
  });

  return grid;
}

/**
 * 序章（新手教学）专用棋盘：**手工摆出「3 缺 1」**（2026-10-26 新增）
 *
 * 教学要的是确定局面：某张图的 3 块已按正确相对位置拼成 L 形（占住 2×2 的三格），
 * 缺的第 4 块摆在**别处** —— 玩家把它拖到缺口，4 块立刻成 2×2 并消除。
 *
 * ⚠️ v4.1 用户要求：**「教学碎片图不要放相邻位置」**。两种模式各按自己的规则摆：
 *   - **简单（any）**：缺块放**离缺口最远**的格 —— 一次**远距拖动**直接到位，
 *     正好把「简单关可以拖任意位置」这条规则演出来；
 *   - **困难（adjacent）**：缺块放**最少 2 步**的格 —— 一次挪一格、**要走两步**才到缺口，
 *     正好把「困难关只能交换相邻碎片」演出来（用户要求：困难教学多走几步）。
 *
 * ⚠️ 为什么不能靠随机盘面撞：序章 12 格必须给 6 张图（`assignPools` 的图数校验），
 * 24 块的池里只取 12 块在场，同一张图此时可能只有 2~3 块 —— 随机永远撞不出「3 缺 1」。
 *
 * ⚠️ 为什么这样摆**不破坏任何不变量**（HC-01~HC-06 / 池子模型）：
 *   - 只改**位置**、不改「各图在场块数」→ 池快照与随机盘面完全一致；
 *   - 补位 `refillGrid(grid, cfg.imageIds, rng)` 只依赖 `cfg.imageIds`，与本次摆放无关；
 *   - 内容完整性：complete 那张图 4 块全在场 = 恰好 1 组 ✅；
 *   - 位置拼合：3 块成 L 不构成 2×2 = 0 组 ✅（摆完仍跑一次 `validateBoard()` 兜底）。
 *
 * ⚠️ **额外还要摆一组「已成片」的两块**（2026-10-28 新增，见下方 `pairCells`）：
 *   只摆「3 缺 1」的话，L 形在第一组拼成时就被消除了，场上剩下的全是随机散块，
 *   而教学第 4 步「整片拖拉」要找一块 **≥2 格的融合组**来演示 —— 找不到就直接跳过，
 *   这一步等于白设计（实测 `mergeGroups()` 返回 12 个单格组）。所以**手工摆一对**。
 */
                                 
             
                                   
                      
                                           
                   
                                               
                  
 

/** 交换规则：与 `LevelConfig.swapRule` 同名同义，决定缺块摆多远 */
                                                  

/**
 * @returns 摆好的布局；**摆不出来就返回 `null`**（调用方退回 `buildInitialGrid()` 降级，不报错）
 */
export function buildTutorialGrid(
  rows        ,
  cols        ,
  imageIds                   ,
  rng     ,
  rule                  ,
)                        {
  // 「3 块在上」需要至少 3 行；2×2 目标区需要至少 2 列
  if (rows < 3 || cols < 2) return null;

  let assign;
  try {
    assign = assignPools(rows * cols, imageIds, rng);
  } catch {
    return null; // 图数不足等：交给调用方降级
  }

  // 目标 2×2 取棋盘中部偏上（行 1~2），手指好按、又不贴边
  const topLeft = 1 * cols + 0;
  const topRight = topLeft + 1;
  const bottomLeft = topLeft + cols;
  const gapIndex = bottomLeft + 1; // 缺口 = 2×2 的右下角
  const fixedCells = [topLeft, topRight, bottomLeft];

  // 从缺口 BFS（绕开已拼好的 3 块）→ 每格到缺口**最少要挪几步**
  const dist = bfsSteps(rows, cols, gapIndex, new Set(fixedCells));

  // 候选格：除已拼的 3 块与缺口本身，且要**走得到**
  const candidates = Array.from({ length: rows * cols }, (_, i) => i).filter(
    (i) => i !== gapIndex && !fixedCells.includes(i) && dist[i] !== null,
  );
  if (candidates.length === 0) return null;

  let targetIndex = -1;
  let best = -1;
  if (rule === 'adjacent') {
    // 困难：要多走几步 → 优先取「至少 2 步」里最近的（2 步最合适：够演示、又不啰嗦）
    for (const i of candidates) {
      const d = dist[i] ;
      if (d < 2) continue; // ⚠️ 别放隔壁（用户要求）
      if (best < 0 || d < best) {
        best = d;
        targetIndex = i;
      }
    }
    // 盘太小、没有 ≥2 步的格 → 退而求其次取最远
    if (targetIndex < 0) {
      for (const i of candidates) {
        const d = dist[i] ;
        if (d > best) {
          best = d;
          targetIndex = i;
        }
      }
    }
  } else {
    // 简单：一次远距拖动 → 取**最远**的格
    for (const i of candidates) {
      const d = dist[i] ;
      if (d > best) {
        best = d;
        targetIndex = i;
      }
    }
  }
  if (targetIndex < 0) return null;

  const grid = new Grid(rows, cols);
  // 3 块按**正确相对位置**摆成 L 形（位置 0=左上 1=右上 2=左下）
  grid.setAt(topLeft, pieceOf(assign.complete, 0));
  grid.setAt(topRight, pieceOf(assign.complete, 1));
  grid.setAt(bottomLeft, pieceOf(assign.complete, 2));
  // 缺的第 4 块（位置 3=右下）放到算出来的那格（**不挨着缺口**）
  grid.setAt(targetIndex, pieceOf(assign.complete, 3));

  // ---- 额外摆一组「已成片」的两块：给教学第 4 步「整片拖拉」当演示对象 ----
  //
  // ⚠️ 为什么必须**上下相邻（同列）**：第一组拼成后会触发按列下压（collapse），
  //    左右相邻的两块跨列、两列下压高度不同就会被拆开；同列的两块跟着整列一起走，
  //    相对位置不变 —— 于是这一片能活到「整片拖拉」那一步。
  //
  // ⚠️ 用**池子2 的第一张图**（该图在场恰好 2 块）：摆 `TL` 在上、`BL` 在下，
  //    相对位置正确 → `computeMergeGroups` 会把它们并成一个 2 格融合组（这就是"成片"）。
  //    在场块数不变（还是这 2 块，只是位置码定死）→ 池子模型与不变量不受影响。
  let pairCells = pickVerticalPair(rows, cols, new Set([...fixedCells, gapIndex, targetIndex]));
  const pairImg = pairCells ? (assign.pool2[0] ?? -1) : -1;
  if (pairCells && pairImg >= 0) {
    grid.setAt(pairCells[0], pieceOf(pairImg, POS_TL)); // 上
    grid.setAt(pairCells[1], pieceOf(pairImg, POS_BL)); // 下
  } else {
    pairCells = null; // 没有池子2 或找不到位置：不摆，教学第 4 步照旧跳过
  }

  // 其余碎片随机填剩余格（数量 = 格数 − 4 − 2）
  const others = piecesForAssignment(assign, rng);
  // 那两张已手工占用（换成 TL+BL），不再参与随机填充
  const rest = pairImg >= 0 ? others.filter((p) => imageOf(p) !== pairImg) : others;
  const fixed = new Set([...fixedCells, targetIndex]);
  if (pairCells) {
    fixed.add(pairCells[0]);
    fixed.add(pairCells[1]);
  }
  const free = grid.indices().filter((i) => !fixed.has(i));
  if (free.length !== rest.length) return null;
  const shuffled = rng.shuffle(rest);
  free.forEach((cellIndex, i) => {
    grid.setAt(cellIndex, shuffled[i] );
  });

  if (!validateBoard(grid).ok) return null; // 兜底：不通过就不做强制教学
  return { grid, targetIndex, gapIndex, fixed: fixedCells };
}

/**
 * 从 `from` 出发的 BFS，返回每格到它的最少步数（`null` = 走不到）。
 * `blocked` 里的格**不可通行**（已拼好的 3 块，别去碰）。
 *
 * 只用在 12 格的小教学盘上，邻接展开即可，不必上优先队列。
 */
function bfsSteps(
  rows        ,
  cols        ,
  from        ,
  blocked                     ,
)                       {
  const dist                       = new Array(rows * cols).fill(null);
  if (from < 0 || from >= rows * cols) return dist;
  dist[from] = 0;
  const queue           = [from];
  for (let head = 0; head < queue.length; head += 1) {
    const cur = queue[head] ;
    const r = Math.floor(cur / cols);
    const c = cur % cols;
    const step = dist[cur]  + 1;
    for (const [nr, nc] of [
      [r - 1, c],
      [r + 1, c],
      [r, c - 1],
      [r, c + 1],
    ]         ) {
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
      const next = nr * cols + nc;
      if (blocked.has(next)) continue;
      if (dist[next] !== null) continue;
      dist[next] = step;
      queue.push(next);
    }
  }
  return dist;
}

/**
 * 在**未被占用**的格里找一对**上下相邻**（同列）的格，用来摆「已成片」的两块。
 *
 * 从**右下**往左上找：教学盘的「3 缺 1」L 形固定在左上（`topLeft` 起），
 * 演示用的这一片摆得离它越远、视觉上越不打架（玩家一眼能分清"要拼的"和"能拖的"）。
 *
 * @returns `[上格, 下格]`；找不到（盘太小 / 全被占）返回 `null` → 调用方不摆
 */
function pickVerticalPair(
  rows        ,
  cols        ,
  blocked                     ,
)                          {
  if (rows < 2) return null;
  for (let c = cols - 1; c >= 0; c -= 1) {
    for (let r = rows - 2; r >= 0; r -= 1) {
      const up = r * cols + c;
      const down = up + cols;
      if (blocked.has(up) || blocked.has(down)) continue;
      return [up, down];
    }
  }
  return null;
}

/** 调试用：把棋盘打印成「图ID:位置」矩阵 */
export function describeGrid(grid      )         {
  const lines           = [];
  for (let r = 0; r < grid.rows; r++) {
    const row           = [];
    for (let c = 0; c < grid.cols; c++) {
      const piece = grid.get(r, c);
      if (piece === null) row.push(' .. ');
      else row.push(`${String(imageOf(piece)).padStart(2, '0')}:${piece % 4} `);
    }
    lines.push(row.join('|'));
  }
  return lines.join('\n');
}
