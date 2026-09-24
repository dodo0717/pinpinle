import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { findAllPositionCorrectMatches } from '../assets/scripts/core/matcher';
import {
  computeMergeDisplay,
  computeMergeGroups,
  findHintCells,
  isCorrectHorizontalPair,
  isCorrectVerticalPair,
} from '../assets/scripts/core/merge';
import { makeGrid } from './helpers';

function permutations4(): number[][] {
  const out: number[][] = [];
  const walk = (prefix: number[], rest: number[]): void => {
    if (rest.length === 0) {
      out.push(prefix.slice());
      return;
    }
    rest.forEach((v, i) => {
      const next = rest.slice();
      next.splice(i, 1);
      walk([...prefix, v], next);
    });
  };
  walk([], [0, 1, 2, 3]);
  return out;
}

describe('merge —— 融合机制（§1.5）', () => {
  describe('正确相邻判定', () => {
    it('水平：仅 (0,1) 与 (2,3) 合法', () => {
      assert.strictEqual(isCorrectHorizontalPair(0, 1), true);
      assert.strictEqual(isCorrectHorizontalPair(2, 3), true);
      assert.strictEqual(isCorrectHorizontalPair(1, 0), false);
      assert.strictEqual(isCorrectHorizontalPair(3, 2), false);
      assert.strictEqual(isCorrectHorizontalPair(0, 3), false);
      assert.strictEqual(isCorrectHorizontalPair(0, 2), false);
      assert.strictEqual(isCorrectHorizontalPair(0, 5), false); // 不同图
    });

    it('垂直：仅 (0,2) 与 (1,3) 合法', () => {
      assert.strictEqual(isCorrectVerticalPair(0, 2), true);
      assert.strictEqual(isCorrectVerticalPair(1, 3), true);
      assert.strictEqual(isCorrectVerticalPair(2, 0), false);
      assert.strictEqual(isCorrectVerticalPair(3, 1), false);
      assert.strictEqual(isCorrectVerticalPair(0, 1), false);
      assert.strictEqual(isCorrectVerticalPair(0, 6), false); // 不同图
    });
  });

  describe('融合组', () => {
    it('横向 2 块正确 → 1 个大小为 2 的组，两侧显示状态正确', () => {
      const grid = makeGrid(2, 2, [[0, 0], [0, 1], [7, 0], [8, 0]]);
      const groups = computeMergeGroups(grid);
      assert.strictEqual(groups.filter((g) => g.cells.length === 2).length, 1);

      const display = computeMergeDisplay(grid);
      const left = display.find((d) => d.cellIndex === 0)!;
      const right = display.find((d) => d.cellIndex === 1)!;
      assert.strictEqual(left.mergeRight, true);
      assert.strictEqual(left.mergeLeft, false);
      assert.strictEqual(right.mergeLeft, true);
      assert.strictEqual(right.mergeRight, false);
    });

    it('横向位置颠倒 → 不融合', () => {
      const grid = makeGrid(2, 2, [[0, 1], [0, 0], [7, 0], [8, 0]]);
      assert.strictEqual(computeMergeGroups(grid).every((g) => g.cells.length === 1), true);
    });

    it('纵向 2 块正确 → 融合', () => {
      const grid = makeGrid(2, 2, [[0, 0], [7, 0], [0, 2], [8, 0]]);
      const display = computeMergeDisplay(grid);
      assert.strictEqual(display.find((d) => d.cellIndex === 0)!.mergeDown, true);
      assert.strictEqual(display.find((d) => d.cellIndex === 2)!.mergeUp, true);
    });

    it('纵向位置颠倒 → 不融合', () => {
      const grid = makeGrid(2, 2, [[0, 2], [7, 0], [0, 0], [8, 0]]);
      assert.strictEqual(computeMergeGroups(grid).every((g) => g.cells.length === 1), true);
    });

    it('L 形 3 块 → 1 个大小为 3 的组，内侧两边融合', () => {
      const grid = makeGrid(2, 2, [[0, 0], [0, 1], [0, 2], [9, 3]]);
      assert.strictEqual(computeMergeGroups(grid).filter((g) => g.cells.length === 3).length, 1);

      const d0 = computeMergeDisplay(grid).find((d) => d.cellIndex === 0)!;
      assert.strictEqual(d0.mergeRight, true);
      assert.strictEqual(d0.mergeDown, true);
      assert.strictEqual(d0.mergeLeft, false);
      assert.strictEqual(d0.mergeUp, false);
    });

    it('4 块 → 1 个大小为 4 的组，且必然对应一个可消除的 2×2', () => {
      const grid = makeGrid(2, 2, [[0, 0], [0, 1], [0, 2], [0, 3]]);
      const groups = computeMergeGroups(grid);
      assert.strictEqual(groups.length, 1);
      assert.strictEqual(groups[0]!.cells.length, 4);
      assert.strictEqual(findAllPositionCorrectMatches(grid).length, 1);
    });

    it('融合组满 4 块 ⟺ 存在可消除的 2×2（穷举 24 种放置）', () => {
      for (const perm of permutations4()) {
        const grid = makeGrid(2, 2, [
          [0, perm[0]!], [0, perm[1]!],
          [0, perm[2]!], [0, perm[3]!],
        ]);
        const hasFullGroup = computeMergeGroups(grid).some((g) => g.cells.length === 4);
        const hasEliminable = findAllPositionCorrectMatches(grid).length === 1;
        assert.strictEqual(hasFullGroup, hasEliminable, `排列 ${perm.join(',')} 不一致`);
      }
    });

    it('不同图之间绝不融合', () => {
      const grid = makeGrid(2, 2, [[0, 0], [1, 1], [2, 2], [3, 3]]);
      assert.strictEqual(computeMergeGroups(grid).every((g) => g.cells.length === 1), true);
    });

    it('空位不参与融合', () => {
      const grid = makeGrid(2, 2, [[0, 0], null, [0, 2], [9, 3]]);
      const d0 = computeMergeDisplay(grid).find((d) => d.cellIndex === 0)!;
      assert.strictEqual(d0.mergeRight, false);
      assert.strictEqual(d0.mergeDown, true);
    });
  });

  describe('组的跨度与四象限原点（拼合取样用，§11.6.3）', () => {
    it('横向 2 块：组 2 列 1 行，左块 colInGroup=0、右块 =1', () => {
      const grid = makeGrid(2, 2, [[0, 0], [0, 1], [7, 0], [8, 0]]);
      const display = computeMergeDisplay(grid);
      const left = display.find((d) => d.cellIndex === 0)!;
      const right = display.find((d) => d.cellIndex === 1)!;

      assert.strictEqual(left.groupCols, 2);
      assert.strictEqual(left.groupRows, 1);
      assert.strictEqual(left.colInGroup, 0);
      assert.strictEqual(right.colInGroup, 1);
      // 两块的象限原点相同：组从象限列 0 起（0 与 1 这一对）
      assert.strictEqual(left.quadCol, 0);
      assert.strictEqual(right.quadCol, 0);
      assert.strictEqual(left.rowInGroup, 0);
      assert.strictEqual(right.rowInGroup, 0);
    });

    it('纵向 2 块：组 1 列 2 行，象限原点行 = 0', () => {
      const grid = makeGrid(2, 2, [[0, 0], [7, 0], [0, 2], [8, 0]]);
      const display = computeMergeDisplay(grid);
      const top = display.find((d) => d.cellIndex === 0)!;
      const bottom = display.find((d) => d.cellIndex === 2)!;

      assert.strictEqual(top.groupCols, 1);
      assert.strictEqual(top.groupRows, 2);
      assert.strictEqual(top.rowInGroup, 0);
      assert.strictEqual(bottom.rowInGroup, 1);
      assert.strictEqual(top.quadRow, 0);
      assert.strictEqual(bottom.quadCol, 0);
    });

    it('右列那一对（位置码 1/3）：象限原点列 = 1，不能当成 0', () => {
      // 位置码 1 和 3 都是「右半幅」，整组只占 1 列 —— 取样要从象限列 1 起算，
      // 从 0 起算会把整张图错位半幅（这正是当初需要 quadCol 字段的原因）
      const grid = makeGrid(2, 2, [null, [0, 1], null, [0, 3]]);
      const display = computeMergeDisplay(grid);
      const upper = display.find((d) => d.cellIndex === 1)!;
      const lower = display.find((d) => d.cellIndex === 3)!;

      assert.strictEqual(upper.groupCols, 1);
      assert.strictEqual(upper.groupRows, 2);
      assert.strictEqual(upper.quadCol, 1);
      assert.strictEqual(lower.quadCol, 1);
      assert.strictEqual(upper.colInGroup, 0);
      assert.strictEqual(lower.rowInGroup, 1);
    });

    it('L 形 3 块：包围盒按 2×2 算（缺角不影响取样比例）', () => {
      const grid = makeGrid(2, 2, [[0, 0], [0, 1], [0, 2], [9, 1]]);
      const display = computeMergeDisplay(grid);
      for (const index of [0, 1, 2]) {
        const d = display.find((x) => x.cellIndex === index)!;
        assert.strictEqual(d.groupSize, 3);
        assert.strictEqual(d.groupCols, 2);
        assert.strictEqual(d.groupRows, 2);
        assert.strictEqual(d.quadCol, 0);
        assert.strictEqual(d.quadRow, 0);
      }
      assert.strictEqual(display.find((d) => d.cellIndex === 1)!.colInGroup, 1);
      assert.strictEqual(display.find((d) => d.cellIndex === 2)!.rowInGroup, 1);
    });

    it('未融合的单块：跨度 1×1，象限原点 = 自己的位置码', () => {
      const grid = makeGrid(2, 2, [[0, 1], [7, 0], [8, 0], [9, 0]]);
      const d = computeMergeDisplay(grid).find((x) => x.cellIndex === 0)!;
      assert.strictEqual(d.groupSize, 1);
      assert.strictEqual(d.groupCols, 1);
      assert.strictEqual(d.groupRows, 1);
      assert.strictEqual(d.colInGroup, 0);
      assert.strictEqual(d.quadCol, 1);
      assert.strictEqual(d.quadRow, 0);
    });
  });
});

describe('引导高亮 —— findHintCells（§14 第 2 步）', () => {
  it('全场没有同图成对 → 空数组（调用方据此不高亮）', () => {
    const grid = makeGrid(2, 2, [[0, 0], [1, 1], [2, 2], [3, 3]]);
    assert.deepStrictEqual(findHintCells(grid), []);
  });

  it('取块数最多的那组（3 块优于 2 块），按下标升序返回', () => {
    const grid = makeGrid(2, 3, [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2], [7, 0]]);
    assert.deepStrictEqual(findHintCells(grid), [0, 2, 4]);
  });

  it('块数并列时取 imageId 更小的，结果与格子扫描顺序无关', () => {
    const grid = makeGrid(2, 3, [[9, 0], [9, 1], [3, 0], [3, 1], [7, 0], [8, 0]]);
    assert.deepStrictEqual(findHintCells(grid), [2, 3]);
  });

  it('4 块齐全的那组优先（能直接消）', () => {
    const grid = makeGrid(2, 3, [[5, 0], [5, 1], [5, 2], [5, 3], [6, 0], [6, 1]]);
    assert.deepStrictEqual(findHintCells(grid), [0, 1, 2, 3]);
  });

  it('单块不成组：只有一个孤块时返回空数组', () => {
    const grid = makeGrid(1, 2, [[0, 3], [4, 0]]);
    assert.deepStrictEqual(findHintCells(grid), []);
  });
});
