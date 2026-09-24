import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  LEVEL_CONFUSION_CONFIG,
  MAX_ART_ID,
  TOTAL_LEVELS,
  allArtIds,
  animalOf,
  buildLevelConfigs,
  buildLevelPlan,
  confusionOf,
  generateLevelPools,
  imagesPerLevel,
  moodCountsOfLevel,
} from '../assets/scripts/core/index';

/** 素材齐全：36 张全到货 */
const FULL = allArtIds();
/** 第一批到货：编号 0~10（猫 6 张 + 其余 5 只动物各 1 张） */
const FIRST_BATCH = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
/** 更少的一批：编号 0~8（猫 6 张 + 虎/兔/仓鼠各 1 张），凑不出 20 格段位所需的 10 张 */
const PARTIAL_BATCH = [0, 1, 2, 3, 4, 5, 6, 7, 8];

const desc = (a: number, b: number): number => b - a;

/** 图池 →「每只动物几张图」，从多到少排序（与设计表的情绪分布可直接比对） */
function animalCounts(imageIds: readonly number[]): number[] {
  const counts = new Map<string, number>();
  for (const id of imageIds) {
    const animal = animalOf(id) ?? `#${id}`;
    counts.set(animal, (counts.get(animal) ?? 0) + 1);
  }
  return [...counts.values()].sort(desc);
}

/** 同关内每张图都不重复、ID 合法、张数符合公式 */
function assertPoolShape(imageIds: readonly number[], rows: number, cols: number, label: string): void {
  const expected = imagesPerLevel(rows * cols);
  assert.strictEqual(imageIds.length, expected, `${label}：图数应为 ${expected}`);
  assert.strictEqual(new Set(imageIds).size, expected, `${label}：图池内出现重复图 ID`);
  for (const id of imageIds) {
    assert.ok(Number.isInteger(id) && id >= 0 && id <= MAX_ART_ID, `${label}：图 ID ${id} 越界`);
  }
}

describe('poolGen —— 素材齐全（36 张）', () => {
  it('60 关全部可开，且图池构成逐关精确等于设计表（只数 + 每只动物的情绪数）', () => {
    const plan = buildLevelPlan('normal', { availableIds: FULL });
    assert.strictEqual(plan.levels.length, TOTAL_LEVELS, '素材齐全时应开放全部 60 关');
    assert.deepStrictEqual(plan.skipped, []);
    assert.deepStrictEqual(plan.notes, [], '素材齐全时不应有任何图池诊断');

    for (const cfg of plan.levels) {
      const designed = [...moodCountsOfLevel(cfg.level)].sort(desc);
      assert.deepStrictEqual(
        animalCounts(cfg.imageIds),
        designed,
        `第${cfg.level}关的动物情绪分布与设计表不一致（设计 ${designed.join('+')}）`,
      );
      assert.strictEqual(
        confusionOf(cfg.imageIds),
        LEVEL_CONFUSION_CONFIG[cfg.level],
        `第${cfg.level}关实际 ma 应精确等于设计 ma`,
      );
    }
  });

  it('每关图数与形状合法，且只用到了已到货的素材', () => {
    const plan = buildLevelPlan('normal', { availableIds: FULL });
    for (const cfg of plan.levels) {
      assertPoolShape(cfg.imageIds, cfg.rows, cfg.cols, `第${cfg.level}关`);
    }
  });

  it('同一网格下各关图池两两不同（§5.4 跨关唯一性）', () => {
    const byGrid = new Map<string, Set<string>>();
    for (const cfg of buildLevelConfigs('normal', { availableIds: FULL })) {
      const key = `${cfg.rows}x${cfg.cols}`;
      const signature = [...cfg.imageIds].sort(desc).join(',');
      const seen = byGrid.get(key) ?? new Set<string>();
      assert.ok(!seen.has(signature), `第${cfg.level}关（${key}）与同尺寸关卡撞成了同一套图池`);
      seen.add(signature);
      byGrid.set(key, seen);
    }
  });

  it('同一关重复生成结果完全一致（确定性，可复现）', () => {
    const a = buildLevelConfigs('normal', { availableIds: FULL });
    const b = buildLevelConfigs('normal', { availableIds: FULL });
    assert.deepStrictEqual(
      a.map((c) => c.imageIds),
      b.map((c) => c.imageIds),
    );
  });

  it('换种子会整批换一套图（同一关仍是固定的一套）', () => {
    const a = buildLevelConfigs('normal', { availableIds: FULL, seed: 11 });
    const b = buildLevelConfigs('normal', { availableIds: FULL, seed: 22 });
    assert.notDeepStrictEqual(
      a.map((c) => c.imageIds),
      b.map((c) => c.imageIds),
    );
    assert.deepStrictEqual(
      a.map((c) => c.imageIds),
      buildLevelConfigs('normal', { availableIds: FULL, seed: 11 }).map((c) => c.imageIds),
    );
  });

  it('两种模式共用同一套图池，只有星线与交换规则不同', () => {
    const normal = buildLevelConfigs('normal', { availableIds: FULL });
    const nightmare = buildLevelConfigs('nightmare', { availableIds: FULL });
    assert.deepStrictEqual(
      normal.map((c) => c.imageIds),
      nightmare.map((c) => c.imageIds),
    );
  });
});

describe('poolGen —— 素材不足', () => {
  it('第一批 11 张已足够开满 60 关（最大图数需求是 5×4 的 10 张）', () => {
    const plan = buildLevelPlan('normal', { availableIds: FIRST_BATCH });
    assert.strictEqual(plan.levels.length, TOTAL_LEVELS);
    assert.deepStrictEqual(plan.skipped, []);
  });

  it('图数超过到货张数的关卡被跳过，并给出说明', () => {
    const plan = buildLevelPlan('normal', { availableIds: PARTIAL_BATCH });
    assert.ok(plan.skipped.length > 0, '5×4 需 10 张、只到货 9 张，应有被跳过的关卡');
    // 只有 5×4 的段位（第 36~60 关）会因张数不够而关闭
    for (const level of plan.skipped) {
      assert.ok(level >= 36 && level <= 60, `第${level}关不该被跳过`);
    }
    assert.ok(
      plan.notes.some((n) => n.includes('暂不开放')),
      '应有一条说明关卡因素材不足被关闭',
    );
  });

  it('能开的关卡仍是合法图池、只用已到货素材；撞车时必须说清（素材太少时无法完全错开）', () => {
    const plan = buildLevelPlan('normal', { availableIds: PARTIAL_BATCH });
    const byGrid = new Map<string, Set<string>>();
    for (const cfg of plan.levels) {
      assertPoolShape(cfg.imageIds, cfg.rows, cfg.cols, `第${cfg.level}关`);
      for (const id of cfg.imageIds) {
        assert.ok(PARTIAL_BATCH.includes(id), `第${cfg.level}关用了未到货的图 ${id}`);
      }
      const key = `${cfg.rows}x${cfg.cols}`;
      const signature = [...cfg.imageIds].sort(desc).join(',');
      const seen = byGrid.get(key) ?? new Set<string>();
      if (seen.has(signature)) {
        // 9 张素材要铺满 4×4 段的 20 关，可组合的图池必然会被用尽 ——
        // 关键是不能静默重复，必须有一条 note 点名
        assert.ok(
          plan.notes.some((n) => n.includes(`第${cfg.level}关`) && n.includes('无法与同尺寸关卡错开')),
          `第${cfg.level}关与同尺寸关卡撞车，却没有 note 说明`,
        );
      }
      seen.add(signature);
      byGrid.set(key, seen);
    }
  });

  it('素材不足导致构成偏离时，逐关点名（偏难或偏易都要说清）', () => {
    const plan = buildLevelPlan('normal', { availableIds: PARTIAL_BATCH });
    for (const cfg of plan.levels) {
      const actualCounts = animalCounts(cfg.imageIds);
      const designedCounts = [...moodCountsOfLevel(cfg.level)].sort(desc);
      const deviated =
        actualCounts.length !== designedCounts.length ||
        actualCounts.some((n, i) => n !== designedCounts[i]);
      if (!deviated) continue;
      assert.ok(
        plan.notes.some((n) => n.includes(`第${cfg.level}关`) && n.includes('偏离设计表')),
        `第${cfg.level}关图池构成偏离设计表，应有一条 note 点名`,
      );
    }
    assert.ok(
      plan.notes.some((n) => n.includes('偏难')) || plan.notes.some((n) => n.includes('偏易')),
      '偏离说明里应写明偏难还是偏易',
    );
  });

  it('一张素材都没有 → 60 关全部跳过，不产出半个图池', () => {
    const plan = buildLevelPlan('normal', { availableIds: [] });
    assert.strictEqual(plan.levels.length, 0);
    assert.strictEqual(plan.skipped.length, TOTAL_LEVELS);
  });
});

describe('generateLevelPools 单项行为', () => {
  it('可用池只够部分关卡时，只跳过不够的那一关', () => {
    const result = generateLevelPools(
      [
        // 3 只动物各 2 情绪 = 6 张
        { level: 1, moodCounts: [2, 2, 2], gridKey: '3x4' },
        // 2 只动物 = 10 张，凑不出来
        { level: 7, moodCounts: [6, 4], gridKey: '5x4' },
      ],
      [0, 1, 2, 3, 4, 5],
      7,
    );
    assert.ok(result.byLevel.has(1), '第 1 关应能组成');
    assert.deepStrictEqual(result.skipped, [7], '第 7 关需 10 张、只有 6 张，应被跳过');
  });

  it('素材均衡（3 只动物各 2 张）时能精确还原「3 只 × 2 情绪」', () => {
    const result = generateLevelPools(
      [{ level: 1, moodCounts: [2, 2, 2], gridKey: '3x4' }],
      [0, 1, 6, 11, 7, 16],
      7,
    );
    const pool = result.byLevel.get(1)!;
    assert.deepStrictEqual(animalCounts(pool.imageIds), [2, 2, 2]);
    assert.strictEqual(pool.maActual, 2);
    assert.strictEqual(pool.animalsActual, 3);
    assert.strictEqual(pool.deviatesFromDesign, false);
  });

  it('素材集中在一只动物时，动物只数减少、ma 被抬高并记 note', () => {
    const result = generateLevelPools(
      [{ level: 1, moodCounts: [2, 2, 2], gridKey: '3x4' }],
      [0, 1, 2, 3, 4, 5], // 全是猫
      7,
    );
    const pool = result.byLevel.get(1)!;
    assert.strictEqual(pool.maActual, 6, '只有同一只动物时 ma 必然等于图数');
    assert.strictEqual(pool.animalsActual, 1, '只凑得出 1 只动物');
    assert.strictEqual(pool.maDesigned, 2);
    assert.strictEqual(pool.animalsDesigned, 3);
    assert.strictEqual(pool.deviatesFromDesign, true);
    assert.ok(result.notes.some((n) => n.message.includes('偏离设计表')));
  });

  it('忽略重复与越界的素材 ID', () => {
    const result = generateLevelPools(
      [{ level: 1, moodCounts: [1, 1], gridKey: '3x4' }],
      [0, 0, MAX_ART_ID + 5, 1],
      7,
    );
    const pool = result.byLevel.get(1)!;
    assert.strictEqual(pool.imageIds.length, 2);
    assert.strictEqual(new Set(pool.imageIds).size, 2);
    for (const id of pool.imageIds) {
      assert.ok(id >= 0 && id <= MAX_ART_ID, `图 ID ${id} 越界`);
    }
  });
});
