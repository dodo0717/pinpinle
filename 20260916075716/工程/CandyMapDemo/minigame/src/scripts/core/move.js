                                         
                                   
import { mergeGroupOfCell } from './merge.js';

/**
 * 整片拖动（§1.6）—— 玩法的最小操作单位。
 *
 * 规则（2026-09-12 定，参考《Jigsaw Drop》的整组拖动）：
 *   1. **锚点** = 玩家按住的那一块所在的格；本次移动的落点全部以它为准；
 *   2. 参与移动的是**锚点所在的融合组**（`computeMergeGroups` 的连通分量，单块也算一个组）；
 *   3. **刚性平移**：组内每块 C 平移到 C + v（v = target − anchor），组内相对位置严格不变
 *      → 移动后这一片依然是「正确相邻」的，不会被自己拖散；
 *   4. **越界即非法**：要求组内每一块平移后都还在盘内（不做「部分出界」）；
 *   5. 位移受 `swapRule` 限制：`any` 任意距离，`adjacent` 只能恰好 1 格（上下左右）；
 *   6. **被压到的碎片与整片让出的格子对位互换**：目标区域里不属于本组的格子（被压到的）
 *      与「本组平移后空出来」的格子形状相同、数量必然相等，按格号升序一一配对。
 *      于是整次操作是一个**严格置换**：不增不减碎片 → HC-01~HC-06 与池子模型全都自动保持。
 *
 * 单块时（组大小 = 1）本函数退化成原本的「两块交换」：a → b、b → a ——
 * 也就是说 **老规则是新规则的特例**，不是两套逻辑。
 */
                           
              
               
              
             
 

                           
                 
                 
                       
             
             
                      
                  
     
                                                    
                        
    
                                                 
     
                    
 

/** 非法移动的原因（UI 据此给不同反馈，不再靠字符串猜） */
                        
                       
           
                                
          
                                    
          
                    
             

                                                                                         

/**
 * 位移向量是否被当前规则允许（§6.1）。
 *
 * `adjacent`（噩梦）= 曼哈顿距离恰好 1 格 —— 以前读作「两块相邻」，现在读作
 * **「整片每次只能挪一格」**；单块时两者逐字等价，因为单块平移 1 格就是和邻格交换。
 */
export function ruleAllowsShift(rule          , dr        , dc        )          {
  if (rule !== 'adjacent') return true;
  return Math.abs(dr) + Math.abs(dc) === 1;
}

/** 整片按 v 平移后是否全部落在盘内 */
export function shiftInBounds(grid      , cells                   , dr        , dc        )          {
  for (const cell of cells) {
    if (!grid.inBounds(grid.rowOf(cell) + dr, grid.colOf(cell) + dc)) return false;
  }
  return true;
}

/**
 * 把位移**钳到盘内**：把超出盘边的部分削掉，保留方向。
 *
 * 拖动过程中用它做预览 —— 手指滑得再远，整片也只是「贴着边停住」，
 * 而不是先画出界再在松手时弹回来（后者会被读成 bug）。
 */
export function clampShift(
  grid      ,
  cells                   ,
  dr        ,
  dc        ,
)                             {
  let up = 0;
  let down = 0;
  let left = 0;
  let right = 0;
  for (let i = 0; i < cells.length; i++) {
    const row = grid.rowOf(cells[i] );
    const col = grid.colOf(cells[i] );
    // 「整片能挪多少」由最贴边的那一块决定 → 取每一块上限的最小值
    up = i === 0 ? row : Math.min(up, row);
    down = i === 0 ? grid.rows - 1 - row : Math.min(down, grid.rows - 1 - row);
    left = i === 0 ? col : Math.min(left, col);
    right = i === 0 ? grid.cols - 1 - col : Math.min(right, grid.cols - 1 - col);
  }
  return {
    dr: Math.max(-up, Math.min(down, dr)),
    dc: Math.max(-left, Math.min(right, dc)),
  };
}

/**
 * 计划一次整片移动。纯计算，**不修改棋盘** —— 渲染层可以拿它做落点预览，
 * 引擎拿它做「接受 / 拒绝」的判定与执行。
 */
export function planGroupMove(
  grid      ,
  anchor        ,
  target        ,
  rule          ,
)            {
  if (!Number.isInteger(anchor) || !Number.isInteger(target)) return { ok: false, reason: 'empty' };
  if (anchor < 0 || anchor >= grid.size || target < 0 || target >= grid.size) {
    return { ok: false, reason: 'bounds' };
  }
  if (grid.cellAt(anchor) === null) return { ok: false, reason: 'empty' };

  const dr = grid.rowOf(target) - grid.rowOf(anchor);
  const dc = grid.colOf(target) - grid.colOf(anchor);
  if (dr === 0 && dc === 0) return { ok: false, reason: 'same' };
  if (!ruleAllowsShift(rule, dr, dc)) return { ok: false, reason: 'rule' };

  const group = mergeGroupOfCell(grid, anchor);
  const cells = group ? group.cells.slice() : [anchor];
  if (!shiftInBounds(grid, cells, dr, dc)) return { ok: false, reason: 'bounds' };

  const inGroup = new Set(cells);
  const steps             = [];
  const targetCells           = [];
  for (const cell of cells) {
    const to = grid.index(grid.rowOf(cell) + dr, grid.colOf(cell) + dc);
    targetCells.push(to);
    steps.push({ from: cell, to });
  }

  // 被压到的碎片 = 目标区域里不属于本组的格子；让出的格子 = 本组里平移后空出来的格子。
  // 两者一一对应（数量必然相等），按格号升序配对 —— 确定性、可复现，便于单测。
  const targetSet = new Set(targetCells);
  const pressed = targetCells.filter((cell) => !inGroup.has(cell)).sort((a, b) => a - b);
  const vacated = cells.filter((cell) => !targetSet.has(cell)).sort((a, b) => a - b);
  if (pressed.length !== vacated.length) {
    // 数学上不可能（两边都等于 组大小 − 重叠格数），真出现说明平移的构造被改错了。
    throw new Error(
      `planGroupMove: 内部错误 —— 被压到的 ${pressed.length} 格与让出的 ${vacated.length} 格不等`,
    );
  }
  for (let i = 0; i < pressed.length; i++) steps.push({ from: pressed[i] , to: vacated[i]  });

  return { ok: true, plan: { anchor, target, dr, dc, cells, steps } };
}

/**
 * 执行移动计划（原地改棋盘）。
 *
 * 先读完所有来源格再写，因此与 `steps` 的顺序无关；
 * `planGroupMove` 保证来源格两两不同、去向格也两两不同（是一个置换）。
 */
export function applyGroupMove(grid      , plan          )       {
  const values = plan.steps.map((step) => grid.cellAt(step.from));
  plan.steps.forEach((step, i) => grid.setAt(step.to, values[i] ));
}
