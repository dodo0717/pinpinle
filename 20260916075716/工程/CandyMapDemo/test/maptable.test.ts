import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractLevels, renderTable } from '../tools/convert-map-json';

/**
 * 地图编辑器坐标表转换的接线检查。
 *
 * fixture 摘自糖果小镇示例地图（universal-map-editor/examples/糖果小镇.map.json）
 * 的真实结构：关卡节点带 props.level，x/y/w/h 为格子坐标（gridSize 32），
 * 地图 widthPx=288。换算系数 = 1536/288 = 5.333…。
 */

const FIXTURE = {
  name: '示例',
  widthPx: 288,
  heightPx: 2048,
  components: [
    // 关 1：中心 (128+16, 1952+16) = (144, 1968) → ×(1536/288=16/3) → (768, 10496)
    { x: 128, y: 1952, w: 32, h: 32, scale: 1.8, props: { level: 1, stars: 0, avatar: false } },
    { x: 64, y: 1792, w: 32, h: 32, scale: 1.8, props: { level: 2 } },
    { x: 160, y: 448, w: 32, h: 32, scale: 1.8, props: { level: 3 } },
    { x: 0, y: 0, w: 32, h: 32, props: {} },                 // 普通素材：不带 level，忽略
  ],
};

test('extractLevels：关卡中心点换算到轨道坐标（TRACK_W/widthPx 系数）', () => {
  const { levels, warnings } = extractLevels(FIXTURE);
  assert.equal(warnings.length, 0);
  assert.equal(levels.length, 3);
  // k = 1536/288 = 16/3；关 1 中心 (144, 1968)
  assert.deepEqual(levels[0], { level: 1, x: Math.round(144 * (16 / 3)), y: Math.round(1968 * (16 / 3)) });
  assert.equal(levels[0]!.x, 768);
  // 排序按关号
  assert.equal(levels.map((l) => l.level).join(','), '1,2,3');
});

test('extractLevels：关号异常要给警告而不是静默', () => {
  const bad = {
    widthPx: 288,
    components: [
      { x: 0, y: 0, w: 32, h: 32, props: { level: 1 } },
      { x: 0, y: 0, w: 32, h: 32, props: { level: 1 } },   // 重复
      { x: 0, y: 0, w: 32, h: 32, props: { level: 5 } },   // 跳号
    ],
  };
  const { warnings } = extractLevels(bad);
  assert.ok(warnings.some((w) => w.includes('重复')));
  assert.ok(warnings.some((w) => w.includes('不连续')));
});

test('extractLevels：缺 widthPx 时警告并不产出', () => {
  const { levels, warnings } = extractLevels({ components: FIXTURE.components });
  assert.equal(levels.length, 0);
  assert.ok(warnings.length > 0);
});

test('renderTable：空表 / 有表都能生成合法 TS（levelTable.ts 回退态）', () => {
  const empty = renderTable({});
  assert.ok(empty.includes('LEVELS_BY_ART: Record<string, LevelPos[]> = {}'));
  const filled = renderTable({ demo: [{ level: 1, x: 768, y: 10496 }] });
  assert.ok(filled.includes("'demo':"));
  assert.ok(filled.includes('level: 1, x: 768, y: 10496'));
});

test('LevelTable 模块可被 MapBootstrap 导入；已导出的世界关号连续、坐标落在轨道内', async () => {
  const mod = await import('../assets/scripts/场景/levelTable');
  assert.ok(mod.LEVELS_BY_ART);
  // 2026-10-28 起 xiaozhen 由地图编辑器导出；其余世界仍回退 ROAD_X 公式
  for (const [art, rows] of Object.entries(mod.LEVELS_BY_ART)) {
    assert.equal(rows.length, 12, `${art} 应为 12 关`);
    rows.forEach((r, i) => {
      assert.equal(r.level, rows[0].level + i, `${art} 关号不连续`);
      assert.ok(r.x > 0 && r.x < 1536 && r.y > 0 && r.y < 5462, `${art} 第 ${r.level} 关越界`);
    });
  }
});
