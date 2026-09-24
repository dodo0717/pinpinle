import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  QUADRANT_PX,
  TEXTURE_PX,
  mergeExtent,
  pieceGeometry,
  sourceXAt,
  sourceYAt,
  type PieceGeometry,
  type PieceGeometryInput,
} from '../web/ui/geometry';

/**
 * 融合纹理取样几何（§11.6.3「4 块拼成 512×512 与原图逐像素一致」）。
 *
 * 浏览器实测见 `shots/m7/`（M7-d：按同样几何做 canvas 等价合成，与原图缩放逐像素比对），
 * 这里把同一条结论钉成**代数断言**：不依赖浏览器、毫秒级可重跑。
 * 判据只有一条 —— 组内每块的 CSS 取样映射都等于「组内容坐标系 → 源像素」这条统一映射，
 * 于是接缝两侧必然显示同一个源像素（无重采样断层）。
 */

const CELL = 100;
const GAP = 12;
const EDGE = 2;

type Spec = Omit<PieceGeometryInput, 'cellSize' | 'gap' | 'edge'> &
  Partial<Pick<PieceGeometryInput, 'mergeLeft' | 'mergeRight' | 'mergeUp' | 'mergeDown'>>;

interface Sample {
  /** 位置码（0 左上 / 1 右上 / 2 左下 / 3 右下），仅用于断言消息 */
  pos: number;
  g: PieceGeometry;
  cols: number;
  rows: number;
  quadCol: number;
  quadRow: number;
}

function sample(pos: number, spec: Spec): Sample {
  const g = pieceGeometry({
    cellSize: CELL,
    gap: GAP,
    edge: EDGE,
    mergeLeft: false,
    mergeRight: false,
    mergeUp: false,
    mergeDown: false,
    ...spec,
  });
  return { pos, g, cols: spec.groupCols, rows: spec.groupRows, quadCol: spec.quadCol, quadRow: spec.quadRow };
}

/**
 * CSS 语义的真实取样：`background-position` 相对本块 padding-box 原点，
 * 而本题把本块 padding-box 左边/上边记在「组内容坐标系」的 `inkLeft/inkTop`。
 */
const cssSourceX = (s: Sample, groupX: number): number =>
  ((groupX - s.g.inkLeft - s.g.posX) * TEXTURE_PX) / s.g.bgW;
const cssSourceY = (s: Sample, groupY: number): number =>
  ((groupY - s.g.inkTop - s.g.posY) * TEXTURE_PX) / s.g.bgH;

/** 设计意图：组内容坐标系 → 源像素 = 该组所占象限内的线性映射 + 组原点象限偏移 */
const wantSourceX = (s: Sample, groupX: number): number =>
  sourceXAt(groupX, s.cols, s.g.groupInkW) + s.quadCol * QUADRANT_PX;
const wantSourceY = (s: Sample, groupY: number): number =>
  sourceYAt(groupY, s.rows, s.g.groupInkH) + s.quadRow * QUADRANT_PX;

/** 断言某块在 [0, inkW] × [0, inkH] 上的取样与统一映射逐点一致（含中点，防斜率对/截距错） */
function assertSamplingMatches(s: Sample): void {
  const xs = [s.g.inkLeft, s.g.inkLeft + s.g.inkW / 2, s.g.inkLeft + s.g.inkW];
  for (const x of xs) {
    assert.ok(
      Math.abs(cssSourceX(s, x) - wantSourceX(s, x)) < 1e-9,
      `位置码 ${s.pos} 的块在组内容 x=${x} 处：CSS 取样 ${cssSourceX(s, x)} ≠ 统一映射 ${wantSourceX(s, x)}`,
    );
  }
  const ys = [s.g.inkTop, s.g.inkTop + s.g.inkH / 2, s.g.inkTop + s.g.inkH];
  for (const y of ys) {
    assert.ok(
      Math.abs(cssSourceY(s, y) - wantSourceY(s, y)) < 1e-9,
      `位置码 ${s.pos} 的块在组内容 y=${y} 处：CSS 取样 ${cssSourceY(s, y)} ≠ 统一映射 ${wantSourceY(s, y)}`,
    );
  }
}

/** 2×2 满组：组原点象限恒为 (0,0)，组内四块两两全融合 */
function fullSquare(): Sample[] {
  return [0, 1, 2, 3].map((pos) => {
    const col = pos % 2;
    const row = Math.floor(pos / 2);
    return sample(pos, {
      groupCols: 2,
      groupRows: 2,
      colInGroup: col,
      rowInGroup: row,
      quadCol: 0,
      quadRow: 0,
      mergeLeft: col === 1,
      mergeRight: col === 0,
      mergeUp: row === 1,
      mergeDown: row === 0,
    });
  });
}

describe('geometry —— 融合纹理取样（§11.6.3）', () => {
  it('mergeExtent 正好是半个缝隙（多扩会在缝上重叠、少扩会留线）', () => {
    assert.strictEqual(mergeExtent(12), 6);
    assert.strictEqual(mergeExtent(4), 2);
    assert.strictEqual(mergeExtent(0), 0);
  });

  describe('单块退化：必须与旧的 `background-size: 200% 200%` 逐像素等价', () => {
    const box = CELL - 4 * EDGE; // 100 - 8 = 92

    it('整图 = 2 倍 padding-box，偏移 = 象限码 × 一格（旧 0% / 100% 的展开）', () => {
      for (const pos of [0, 1, 2, 3]) {
        const quadCol = pos % 2;
        const quadRow = Math.floor(pos / 2);
        const s = sample(pos, {
          groupCols: 1,
          groupRows: 1,
          colInGroup: 0,
          rowInGroup: 0,
          quadCol,
          quadRow,
        });
        assert.strictEqual(s.g.bgW, 2 * box, `位置码 ${pos} bgW`);
        assert.strictEqual(s.g.bgH, 2 * box, `位置码 ${pos} bgH`);
        assert.strictEqual(s.g.posX, -quadCol * box, `位置码 ${pos} posX`);
        assert.strictEqual(s.g.posY, -quadRow * box, `位置码 ${pos} posY`);
        assert.strictEqual(s.g.inkW, box, `位置码 ${pos} 只画自己那一格`);
      }
    });

    it('覆盖的正好是自己那一个象限', () => {
      for (const pos of [0, 1, 2, 3]) {
        const quadCol = pos % 2;
        const quadRow = Math.floor(pos / 2);
        const s = sample(pos, {
          groupCols: 1,
          groupRows: 1,
          colInGroup: 0,
          rowInGroup: 0,
          quadCol,
          quadRow,
        });
        assertSamplingMatches(s);
        assert.ok(Math.abs(cssSourceX(s, s.g.inkLeft) - quadCol * QUADRANT_PX) < 1e-9, `位置码 ${pos} 左边界`);
        assert.ok(
          Math.abs(cssSourceX(s, s.g.inkLeft + s.g.inkW) - (quadCol + 1) * QUADRANT_PX) < 1e-9,
          `位置码 ${pos} 右边界`,
        );
        assert.ok(Math.abs(cssSourceY(s, s.g.inkTop) - quadRow * QUADRANT_PX) < 1e-9, `位置码 ${pos} 上边界`);
        assert.ok(
          Math.abs(cssSourceY(s, s.g.inkTop + s.g.inkH) - (quadRow + 1) * QUADRANT_PX) < 1e-9,
          `位置码 ${pos} 下边界`,
        );
      }
    });
  });

  describe('2×2 满组（§1.5.3 唯一的 4 块形状）', () => {
    const pieces = fullSquare();
    const [tl, tr, bl, br] = pieces as [Sample, Sample, Sample, Sample];

    it('4 块取样比例完全一致（否则接缝两侧倍率不同 = 错位）', () => {
      for (const s of pieces) {
        assert.strictEqual(s.g.bgW, tl.g.bgW, `位置码 ${s.pos} bgW`);
        assert.strictEqual(s.g.bgH, tl.g.bgH, `位置码 ${s.pos} bgH`);
      }
    });

    it('组内 padding-box 首尾严格相接：无缝、无重叠', () => {
      assert.strictEqual(tl.g.inkLeft + tl.g.inkW, tr.g.inkLeft, '上排水平接缝');
      assert.strictEqual(bl.g.inkLeft + bl.g.inkW, br.g.inkLeft, '下排水平接缝');
      assert.strictEqual(tl.g.inkTop + tl.g.inkH, bl.g.inkTop, '左列垂直接缝');
      assert.strictEqual(tr.g.inkTop + tr.g.inkH, br.g.inkTop, '右列垂直接缝');
      // 两块各外扩 gap/2 → 两块内容宽之和正好等于组内容宽（缝隙被吃满，既不留线也不重叠）
      assert.strictEqual(2 * tl.g.inkW, tl.g.groupInkW);
      assert.strictEqual(2 * tl.g.inkH, tl.g.groupInkH);
      assert.ok(GAP > 0, '缝隙宽度由 --gap 提供，几何只负责把它吃掉');
    });

    it('组内每块的取样映射都等于统一映射（这就是「接缝连续」的代数形式）', () => {
      for (const s of pieces) assertSamplingMatches(s);
    });

    it('横/竖接缝两侧显示同一个源像素，且落在原图中线 256', () => {
      const seamXLeft = cssSourceX(tl, tl.g.inkLeft + tl.g.inkW);
      const seamXRight = cssSourceX(tr, tr.g.inkLeft);
      assert.strictEqual(seamXLeft, seamXRight, '水平接缝两侧源坐标');
      assert.ok(Math.abs(seamXLeft - QUADRANT_PX) < 1e-9, `水平接缝应落在 256，实际 ${seamXLeft}`);

      const seamYTop = cssSourceY(tl, tl.g.inkTop + tl.g.inkH);
      const seamYBottom = cssSourceY(bl, bl.g.inkTop);
      assert.strictEqual(seamYTop, seamYBottom, '垂直接缝两侧源坐标');
      assert.ok(Math.abs(seamYTop - QUADRANT_PX) < 1e-9, `垂直接缝应落在 256，实际 ${seamYTop}`);
    });

    it('整组恰好覆盖原图 0~512（§11.6.3 的「拼成 512×512」）', () => {
      const xs = pieces.flatMap((s) => [cssSourceX(s, s.g.inkLeft), cssSourceX(s, s.g.inkLeft + s.g.inkW)]);
      const ys = pieces.flatMap((s) => [cssSourceY(s, s.g.inkTop), cssSourceY(s, s.g.inkTop + s.g.inkH)]);
      assert.ok(Math.abs(Math.min(...xs) - 0) < 1e-9, `左边界 ${Math.min(...xs)}`);
      assert.ok(Math.abs(Math.max(...xs) - TEXTURE_PX) < 1e-9, `右边界 ${Math.max(...xs)}`);
      assert.ok(Math.abs(Math.min(...ys) - 0) < 1e-9, `上边界 ${Math.min(...ys)}`);
      assert.ok(Math.abs(Math.max(...ys) - TEXTURE_PX) < 1e-9, `下边界 ${Math.max(...ys)}`);
    });
  });

  describe('部分融合：横一对 / 竖一对 / L 形', () => {
    it('横一对（位置码 0-1）：只占上排，两块映射连续', () => {
      const left = sample(0, { groupCols: 2, groupRows: 1, colInGroup: 0, rowInGroup: 0, quadCol: 0, quadRow: 0, mergeRight: true });
      const right = sample(1, { groupCols: 2, groupRows: 1, colInGroup: 1, rowInGroup: 0, quadCol: 0, quadRow: 0, mergeLeft: true });
      assert.strictEqual(left.g.bgW, right.g.bgW);
      assert.strictEqual(left.g.inkLeft + left.g.inkW, right.g.inkLeft);
      assert.strictEqual(cssSourceX(left, left.g.inkLeft + left.g.inkW), cssSourceX(right, right.g.inkLeft), '接缝');
      assertSamplingMatches(left);
      assertSamplingMatches(right);
      // 只占上排：源 y 覆盖 0~256
      assert.ok(Math.abs(cssSourceY(left, left.g.inkTop) - 0) < 1e-9);
      assert.ok(Math.abs(cssSourceY(left, left.g.inkTop + left.g.inkH) - QUADRANT_PX) < 1e-9);
    });

    it('竖一对（位置码 1-3）：组原点象限是右列，源 x 覆盖 256~512', () => {
      const top = sample(1, { groupCols: 1, groupRows: 2, colInGroup: 0, rowInGroup: 0, quadCol: 1, quadRow: 0, mergeDown: true });
      const bottom = sample(3, { groupCols: 1, groupRows: 2, colInGroup: 0, rowInGroup: 1, quadCol: 1, quadRow: 0, mergeUp: true });
      assert.strictEqual(top.g.bgH, bottom.g.bgH);
      assert.strictEqual(top.g.inkTop + top.g.inkH, bottom.g.inkTop);
      assert.strictEqual(cssSourceY(top, top.g.inkTop + top.g.inkH), cssSourceY(bottom, bottom.g.inkTop), '接缝');
      assertSamplingMatches(top);
      assertSamplingMatches(bottom);
      assert.ok(Math.abs(cssSourceX(top, top.g.inkLeft) - QUADRANT_PX) < 1e-9, '本块左边 = 原图中线');
      assert.ok(Math.abs(cssSourceX(top, top.g.inkLeft + top.g.inkW) - TEXTURE_PX) < 1e-9, '本块右边 = 原图右沿');
    });

    it('L 形（缺右下）：外框仍是 2×2，缺口不参与但不破坏取样', () => {
      const tl = sample(0, { groupCols: 2, groupRows: 2, colInGroup: 0, rowInGroup: 0, quadCol: 0, quadRow: 0, mergeRight: true, mergeDown: true });
      const tr = sample(1, { groupCols: 2, groupRows: 2, colInGroup: 1, rowInGroup: 0, quadCol: 0, quadRow: 0, mergeLeft: true });
      const bl = sample(2, { groupCols: 2, groupRows: 2, colInGroup: 0, rowInGroup: 1, quadCol: 0, quadRow: 0, mergeUp: true, mergeRight: true });
      const box = tl.g.groupInkW;
      for (const s of [tl, tr, bl]) {
        // 组跨度不变 → 整图尺寸也不变，三块共用同一倍率
        assert.strictEqual(s.g.bgW, box, `位置码 ${s.pos} bgW`);
        assert.strictEqual(s.g.bgH, box, `位置码 ${s.pos} bgH`);
        assertSamplingMatches(s);
      }
      assert.strictEqual(tl.g.inkLeft + tl.g.inkW, tr.g.inkLeft, '上排接缝');
      assert.strictEqual(tl.g.inkTop + tl.g.inkH, bl.g.inkTop, '左列接缝');
      // 缺口（右下）没有任何一块铺到：右列没有下邻居 → 不融合、不向外扩
      assert.strictEqual(tr.g.inkTop, 0);
      assert.strictEqual(tr.g.inkH, CELL - 4 * EDGE, '未融合的一格就是 cellSize - 4·edge');
      // 左列有下邻居 → 两侧各外扩，正好吃满缝隙：白边 2·edge + 半个缝
      assert.strictEqual(tl.g.inkH, tr.g.inkH + 2 * EDGE + mergeExtent(GAP), '融合侧比未融合侧多出的量');
      assert.strictEqual(bl.g.inkTop + bl.g.inkH, bl.g.groupInkH, 'BL 底边 = 组内容底边');
    });
  });
});
