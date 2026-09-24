import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildLevelConfigs } from '../assets/scripts/core/config';
import { buildInitialGrid } from '../assets/scripts/core/init';
import { validateBoard } from '../assets/scripts/core/matcher';
import { poolSnapshot } from '../assets/scripts/core/pools';
import { Rng } from '../assets/scripts/core/rng';

const CONFIGS = buildLevelConfigs();
/** 全表实际使用的三种段位（每行 ≤4、每列 ≤5，24 格段位已取消） */
const GRIDS: Array<[number, number]> = [
  [3, 4],
  [4, 4],
  [5, 4],
];

function configOf(rows: number, cols: number) {
  const cfg = CONFIGS.find((c) => c.rows === rows && c.cols === cols);
  if (!cfg) throw new Error(`缺少 ${rows}×${cols} 的关卡配置`);
  return cfg;
}

describe('init —— 首局生成（§4.10 / §4.4）', () => {
  for (const [rows, cols] of GRIDS) {
    it(`${rows}×${cols} 连续生成 500 次全部合法，且池子结构恒为 1/1/(n)/1/1`, () => {
      const cfg = configOf(rows, cols);
      const expectedPool2 = (rows * cols - 8) / 2;

      for (let i = 0; i < 500; i++) {
        const rng = new Rng(i * 7919 + rows * 131 + cols * 17);
        const grid = buildInitialGrid(rows, cols, cfg.imageIds, rng);

        // 恒满格
        assert.strictEqual(grid.emptyIndices().length, 0);
        // 无重复碎片（HC-03）
        const arr = grid.toArray().filter((v): v is number => v !== null);
        assert.strictEqual(new Set(arr).size, arr.length);

        const v = validateBoard(grid);
        assert.strictEqual(v.content.length, 1, `第 ${i} 次：内容完整性应为 1 组`); // 恰好 1 张图 4 块全在场
        assert.strictEqual(v.positionCorrect.length, 0, `第 ${i} 次：位置拼合应为 0 组`); // 没有任何已拼好的 2×2

        const snap = poolSnapshot(grid, cfg.imageIds);
        assert.strictEqual(snap.complete.length, 1);
        assert.strictEqual(snap.pool1.length, 1);
        assert.strictEqual(snap.pool2.length, expectedPool2);
        assert.strictEqual(snap.pool3.length, 1);
        assert.strictEqual(snap.pool4.length, 1);
        // 「内容完整性」那组必须就是池子5 那张
        assert.strictEqual(v.content[0]!.imageId, snap.complete[0]);
      }
    });
  }

  it('在场碎片总数恒等于格数', () => {
    for (const [rows, cols] of GRIDS) {
      const cfg = configOf(rows, cols);
      const grid = buildInitialGrid(rows, cols, cfg.imageIds, new Rng(20260910));
      const arr = grid.toArray().filter((v) => v !== null);
      assert.strictEqual(arr.length, rows * cols);
    }
  });
});
