import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Grid } from '../assets/scripts/core/grid';
import { findAllPositionCorrectMatches } from '../assets/scripts/core/matcher';
import { computeMergeGroups, isMergeGroupComplete } from '../assets/scripts/core/merge';
import { applyGroupMove, clampShift, planGroupMove, ruleAllowsShift } from '../assets/scripts/core/move';
import { POS_BL, POS_BR, POS_TL, POS_TR, pieceOf } from '../assets/scripts/core/pieces';
import { Rng } from '../assets/scripts/core/rng';
import { fillRest, makeGrid } from './helpers';

/* ------------------------------------------------------------------ 夹具 */

/** 一整盘互不相同、谁也不属于谁的棋盘（每块都是「1 块的融合组」） */
function scatteredBoard(rows = 3, cols = 4): Grid {
  const grid = makeGrid(
    rows,
    cols,
    new Array<null>(rows * cols).fill(null),
  );
  fillRest(grid, [], 100);
  return grid;
}

/** 4×4 盘：cell 4/5/8 摆成「缺右下」的 L 形（同一张图 0），其余填充无关图 */
function lShapeBoard(): Grid {
  const grid = makeGrid(
    4,
    4,
    new Array<null>(16).fill(null),
  );
  grid.setAt(4, pieceOf(0, POS_TL));
  grid.setAt(5, pieceOf(0, POS_TR));
  grid.setAt(8, pieceOf(0, POS_BL));
  fillRest(grid, [4, 5, 8], 100);
  return grid;
}

/* ------------------------------------------------------------------ 规则层 */

describe('move —— 位移规则（§1.6）', () => {
  it('普通规则（any）任意位移都允许，含对角线', () => {
    assert.ok(ruleAllowsShift('any', 0, 1));
    assert.ok(ruleAllowsShift('any', 3, -2));
    assert.ok(ruleAllowsShift('any', -4, 0));
  });

  it('噩梦规则（adjacent）只允许恰好 1 格，对角线/原地/多格都不算', () => {
    assert.ok(ruleAllowsShift('adjacent', 0, 1));
    assert.ok(ruleAllowsShift('adjacent', 0, -1));
    assert.ok(ruleAllowsShift('adjacent', 1, 0));
    assert.ok(ruleAllowsShift('adjacent', -1, 0));
    assert.ok(!ruleAllowsShift('adjacent', 0, 0), '原地不算移动');
    assert.ok(!ruleAllowsShift('adjacent', 1, 1), '对角线不是 1 格位移');
    assert.ok(!ruleAllowsShift('adjacent', 0, 2), '隔一格超出恶梦允许范围');
  });
});

describe('move —— 单块平移就是原来的「两块交换」（老规则是新规则的特例）', () => {
  it('组大小为 1 时，plan 恰好就是那一对格子的互换', () => {
    const grid = scatteredBoard();
    const check = planGroupMove(grid, 0, 5, 'any');
    assert.ok(check.ok, '应被接受');
    assert.deepStrictEqual(check.plan.cells, [0]);
    assert.deepStrictEqual(check.plan.steps, [
      { from: 0, to: 5 },
      { from: 5, to: 0 },
    ]);

    const before = grid.toArray();
    applyGroupMove(grid, check.plan);
    assert.strictEqual(grid.cellAt(0), before[5]);
    assert.strictEqual(grid.cellAt(5), before[0]);
  });
});

describe('move —— 刚性平移 + 被压到的碎片对位互换', () => {
  it('横一对右移 1 格：整片整体挪，被压到的那块回到让出的格子', () => {
    const grid = scatteredBoard();
    grid.setAt(4, pieceOf(0, POS_TL));
    grid.setAt(5, pieceOf(0, POS_TR));
    const pressedPiece = grid.cellAt(6);

    const check = planGroupMove(grid, 4, 5, 'any');
    assert.ok(check.ok);
    assert.deepStrictEqual(check.plan.cells, [4, 5], '整片 = 正确相邻的那一对');
    assert.deepStrictEqual(check.plan.steps, [
      { from: 4, to: 5 },
      { from: 5, to: 6 },
      { from: 6, to: 4 },
    ]);

    applyGroupMove(grid, check.plan);
    assert.strictEqual(grid.cellAt(6), pieceOf(0, POS_TR), '锚点那块应挪到目标格');
    assert.strictEqual(grid.cellAt(5), pieceOf(0, POS_TL));
    assert.strictEqual(grid.cellAt(4), pressedPiece, '被压到的碎片应回到整片让出的格子');
  });

  it('横一对右移 2 格（不重叠）：两块区域整体互换', () => {
    const grid = scatteredBoard();
    grid.setAt(4, pieceOf(0, POS_TL));
    grid.setAt(5, pieceOf(0, POS_TR));
    const before = grid.toArray();

    const check = planGroupMove(grid, 4, 6, 'any');
    assert.ok(check.ok);
    assert.deepStrictEqual(check.plan.steps, [
      { from: 4, to: 6 },
      { from: 5, to: 7 },
      { from: 6, to: 4 },
      { from: 7, to: 5 },
    ]);

    applyGroupMove(grid, check.plan);
    assert.strictEqual(grid.cellAt(6), before[4]);
    assert.strictEqual(grid.cellAt(7), before[5]);
    assert.strictEqual(grid.cellAt(4), before[6]);
    assert.strictEqual(grid.cellAt(5), before[7]);
  });

  it('组内相对位置严格不变：平移后这一片仍是同一个融合组，只是整体挪了位', () => {
    const grid = lShapeBoard();
    const before = grid.toArray();

    const check = planGroupMove(grid, 8, 12, 'any'); // L 形向下挪 1 格
    assert.ok(check.ok);
    assert.deepStrictEqual(check.plan.cells, [4, 5, 8]);

    applyGroupMove(grid, check.plan);

    const groups = computeMergeGroups(grid).filter((g) => g.cells.includes(12));
    assert.strictEqual(groups.length, 1, '锚点落点处应恰好属于一个融合组');
    assert.deepStrictEqual(groups[0]!.cells, [8, 9, 12], '三分片应作为整体落到新位置');
    assert.deepStrictEqual(
      groups[0]!.cells.map((c) => grid.cellAt(c)),
      [before[4], before[5], before[8]],
      '组内碎片与相对顺序都不变',
    );
  });
});

describe('move —— 整片移动是严格置换：碎片不增不减、不重复', () => {
  it('随机整片拖动 2000 次，每次都是置换且融合组不被拖散', () => {
    const rng = new Rng(20260912);
    const grid = lShapeBoard();
    // 先人为造出一些融合组，再随机拖 —— 单靠初始夹具只有 1 个组，覆盖不到 2 块组
    grid.setAt(10, pieceOf(1, POS_TL));
    grid.setAt(11, pieceOf(1, POS_TR));

    for (let i = 0; i < 2000; i++) {
      const anchor = Math.floor(rng.next() * grid.size);
      const target = Math.floor(rng.next() * grid.size);
      const before = grid.toArray();

      const check = planGroupMove(grid, anchor, target, 'any');
      if (!check.ok) {
        assert.deepStrictEqual(grid.toArray(), before, '非法移动不得改动棋盘');
        continue;
      }

      // 严格置换：来源格两两不同、去向格两两不同、覆盖同一批格子
      const froms = check.plan.steps.map((s) => s.from);
      const tos = check.plan.steps.map((s) => s.to);
      assert.strictEqual(new Set(froms).size, froms.length);
      assert.strictEqual(new Set(tos).size, tos.length);
      assert.deepStrictEqual([...froms].sort((a, b) => a - b), [...tos].sort((a, b) => a - b));

      const piecesBefore = check.plan.cells.map((c) => before[c]);
      const anchorAt = check.plan.cells.indexOf(anchor);
      applyGroupMove(grid, check.plan);

      const after = grid.toArray();
      assert.deepStrictEqual(
        [...after].sort(),
        [...before].sort(),
        `第 ${i} 次移动后碎片集合发生了变化`,
      );

      // 刚性平移：组内每一块都必须落到「自己 + 位移」那一格，碎片一块不少
      for (let k = 0; k < check.plan.cells.length; k++) {
        const from = check.plan.cells[k]!;
        const to = grid.index(grid.rowOf(from) + check.plan.dr, grid.colOf(from) + check.plan.dc);
        assert.strictEqual(after[to], piecesBefore[k], `第 ${i} 次移动：第 ${k} 块没有刚性跟随`);
      }
      assert.strictEqual(after[target], piecesBefore[anchorAt], '锚点那块必须落在目标格');

      // 平移不改变组内的相对位置 → 这一片只会「越长越大」（粘上旁边的正确碎片），绝不会被拖散
      const moved = computeMergeGroups(grid).find((g) => g.cells.includes(target));
      assert.ok(moved, `第 ${i} 次移动后锚点落点应仍在某个融合组里`);
      assert.ok(
        moved!.cells.length >= check.plan.cells.length,
        `第 ${i} 次移动后整片被拖散了：${check.plan.cells.length} → ${moved!.cells.length}`,
      );
    }
  });
});

describe('move —— 非法移动的原因（UI 要据此给不同反馈）', () => {
  it('原地不动 → same', () => {
    const grid = scatteredBoard();
    assert.deepStrictEqual(planGroupMove(grid, 4, 4, 'any'), { ok: false, reason: 'same' });
  });

  it('锚点是空位 → empty', () => {
    const grid = scatteredBoard();
    grid.setAt(4, null);
    assert.deepStrictEqual(planGroupMove(grid, 4, 5, 'any'), { ok: false, reason: 'empty' });
  });

  it('下标越界 → bounds', () => {
    const grid = scatteredBoard();
    assert.deepStrictEqual(planGroupMove(grid, 0, 99, 'any'), { ok: false, reason: 'bounds' });
    assert.deepStrictEqual(planGroupMove(grid, -1, 0, 'any'), { ok: false, reason: 'bounds' });
  });

  it('位移不符合模式规则 → rule（噩梦挪 2 格）', () => {
    const grid = scatteredBoard();
    assert.deepStrictEqual(planGroupMove(grid, 0, 2, 'adjacent'), { ok: false, reason: 'rule' });
    assert.deepStrictEqual(planGroupMove(grid, 0, 5, 'adjacent'), { ok: false, reason: 'rule' });
    assert.ok(planGroupMove(grid, 0, 1, 'adjacent').ok, '相邻 1 格应当允许');
  });

  it('整片会有一部分挪出棋盘 → bounds（含跨行回绕）', () => {
    const grid = scatteredBoard();
    grid.setAt(6, pieceOf(0, POS_TL));
    grid.setAt(7, pieceOf(0, POS_TR));
    // 这一对贴着右边界，右移 1 格会让右半块绕到下一行 → 必须整片拒绝，而不是「绕行」
    assert.deepStrictEqual(planGroupMove(grid, 6, 7, 'any'), { ok: false, reason: 'bounds' });
    assert.ok(planGroupMove(grid, 6, 5, 'any').ok, '往左挪 1 格是合法的');
  });

  it('贴边时 clampShift 把位移削到盘内（拖动预览用）', () => {
    const grid = scatteredBoard();
    grid.setAt(6, pieceOf(0, POS_TL));
    grid.setAt(7, pieceOf(0, POS_TR));
    const cells = [6, 7];
    assert.deepStrictEqual(clampShift(grid, cells, 0, 3), { dr: 0, dc: 0 }, '右侧已无空间');
    assert.deepStrictEqual(clampShift(grid, cells, 0, -1), { dr: 0, dc: -1 });
    assert.deepStrictEqual(clampShift(grid, cells, 2, 0), { dr: 1, dc: 0 }, '向下只剩 1 行');
    assert.deepStrictEqual(clampShift(grid, cells, -5, -9), { dr: -1, dc: -2 });
  });
});

describe('move —— 整片移动把缺口补齐：融合与消除天然一致（§1.5.4）', () => {
  it('缺右下的 L 形整体下移 1 格后，缺口正好被那块正确的碎片填上 → 形成 2×2', () => {
    const grid = lShapeBoard();
    // 缺角（cell 9）的正下方 13 放上这张图的右下块：它不在平移的目标区域内，因此原地不动
    grid.setAt(13, pieceOf(0, POS_BR));
    assert.strictEqual(findAllPositionCorrectMatches(grid).length, 0, '移动前不应有任何可消除区域');

    const check = planGroupMove(grid, 4, 8, 'any'); // 锚点 4 → 目标 8，v = +1 行
    assert.ok(check.ok);
    applyGroupMove(grid, check.plan);

    const matches = findAllPositionCorrectMatches(grid);
    assert.strictEqual(matches.length, 1, '移动后应恰好形成 1 组可消除区域');
    assert.deepStrictEqual(matches[0]!.cells.slice().sort((a, b) => a - b), [8, 9, 12, 13]);

    const full = computeMergeGroups(grid).filter(isMergeGroupComplete);
    assert.strictEqual(full.length, 1, '融合组满 4 块的那一帧就是消除帧');
    assert.deepStrictEqual(full[0]!.cells, [8, 9, 12, 13]);
  });

  it('被压到的碎片不会顶掉缺口：目标区域外的碎片一律原地不动', () => {
    const grid = lShapeBoard();
    const br = pieceOf(0, POS_BR);
    grid.setAt(13, br);
    const check = planGroupMove(grid, 4, 8, 'any');
    assert.ok(check.ok);
    applyGroupMove(grid, check.plan);
    assert.strictEqual(grid.cellAt(13), br, '缺口那一格不在目标区域里，不应被动过');
  });
});
