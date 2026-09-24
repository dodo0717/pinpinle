import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  findAllContentMatches,
  findAllPositionCorrectMatches,
  findAllSameImageSquares,
  validateBoard,
} from '../assets/scripts/core/matcher';
import { makeGrid } from './helpers';

describe('matcher —— 内容完整性 / 消除判定（§4.9 / §6.2）', () => {
  describe('内容完整性（4 块齐全的图，与位置无关）', () => {
    it('池子5 的 4 块被打散在非 2×2 区域时，内容完整性仍为 1 组（§4.10 首局形态）', () => {
      const grid = makeGrid(3, 4, [
        [0, 0], [9, 0], [0, 1], [10, 0],
        [0, 2], [11, 0], [12, 0], [13, 0],
        [0, 3], [14, 0], [15, 0], [16, 0],
      ]);
      const content = findAllContentMatches(grid);
      assert.strictEqual(content.length, 1);
      assert.strictEqual(content[0]!.imageId, 0);
      assert.deepStrictEqual(content[0]!.pieces, [0, 1, 2, 3]); // 按位置 0/1/2/3 排序
      // 但没有任何 2×2 同图区域 → 位置拼合 0 组
      assert.strictEqual(findAllSameImageSquares(grid).length, 0);
      assert.strictEqual(validateBoard(grid).ok, true);
    });

    it('4 块同图的 2×2 区域会被消除判定扫到', () => {
      const grid = makeGrid(3, 4, [
        [0, 0], [0, 1], [9, 0], [10, 0],
        [0, 2], [0, 3], [11, 0], [12, 0],
        [13, 0], [14, 0], [15, 0], [16, 0],
      ]);
      assert.strictEqual(findAllContentMatches(grid).length, 1);
      assert.strictEqual(findAllSameImageSquares(grid).length, 1);
    });

    it('全部为互不相同的图时不应产生任何匹配', () => {
      const grid = makeGrid(
        4,
        4,
        Array.from({ length: 16 }, (_, i) => [i, 0] as [number, number]),
      );
      assert.strictEqual(findAllContentMatches(grid).length, 0);
      assert.strictEqual(findAllSameImageSquares(grid).length, 0);
    });
  });

  describe('消除判定（§4.9 / §6.2）', () => {
    it('4 块同图且位置正确 → 位置拼合 1 组，棋盘不合格', () => {
      const grid = makeGrid(3, 4, [
        [0, 0], [0, 1], [9, 0], [10, 0],
        [0, 2], [0, 3], [11, 0], [12, 0],
        [13, 0], [14, 0], [15, 0], [16, 0],
      ]);
      assert.strictEqual(findAllSameImageSquares(grid).length, 1);
      assert.strictEqual(findAllPositionCorrectMatches(grid).length, 1);
      assert.strictEqual(validateBoard(grid).ok, false); // 已拼好 → 不合格
    });

    it('4 块同图但位置交错 → 位置拼合 0 组（合格态）', () => {
      const grid = makeGrid(3, 4, [
        [0, 1], [0, 0], [9, 0], [10, 0],
        [0, 2], [0, 3], [11, 0], [12, 0],
        [13, 0], [14, 0], [15, 0], [16, 0],
      ]);
      assert.strictEqual(findAllContentMatches(grid).length, 1);
      assert.strictEqual(findAllSameImageSquares(grid).length, 1);
      assert.strictEqual(findAllPositionCorrectMatches(grid).length, 0);
      assert.strictEqual(validateBoard(grid).ok, true);
    });

    it('空位会打断 2×2 判定', () => {
      const grid = makeGrid(3, 4, [
        [0, 0], [0, 1], [9, 0], [10, 0],
        [0, 2], null, [11, 0], [12, 0],
        [0, 3], [13, 0], [14, 0], [15, 0],
      ]);
      assert.strictEqual(findAllSameImageSquares(grid).length, 0);
      assert.strictEqual(findAllPositionCorrectMatches(grid).length, 0);
    });

    it('横向相邻的两个 2×2 区域都能被扫到（此时该盘有 2 张图 4 块齐全，本身违反 HC-01）', () => {
      const grid = makeGrid(3, 4, [
        [0, 0], [0, 1], [1, 0], [1, 1],
        [0, 2], [0, 3], [1, 2], [1, 3],
        [5, 0], [6, 0], [7, 0], [8, 0],
      ]);
      assert.strictEqual(findAllSameImageSquares(grid).length, 2);
      assert.strictEqual(findAllPositionCorrectMatches(grid).length, 2);
      assert.strictEqual(findAllContentMatches(grid).length, 2);
    });
  });
});
