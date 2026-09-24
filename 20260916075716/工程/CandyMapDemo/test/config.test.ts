import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  IMAGE_ANIMAL,
  IMAGE_MOOD,
  IMAGE_TEXT_PLACEHOLDER,
  LEVEL_ANIMAL_COUNT,
  LEVEL_CONFUSION_CONFIG,
  LEVEL_POOL_SPEC,
  LEVEL_REWARD_CONFIG,
  LEVEL_STAR_LINES,
  LEVEL_TAGS,
  MAX_ART_ID,
  NIGHTMARE_STAR_LINES,
  REWARD_LEVELS,
  SWAP_RULE_BY_MODE,
  TOTAL_LEVELS,
  animalOf,
  animalsOfLevel,
  buildLevelConfigs,
  confusionOfLevel,
  imagesOfLevel,
  imagesPerLevel,
  moodCountsOfLevel,
  validateLevelConfigs,
  validateLevelDesign,
  validateRewardConfig,
} from '../assets/scripts/core/config';
import { confusionOf } from '../assets/scripts/core/poolGen';
import { ANIMAL_IMAGE_IDS } from '../assets/scripts/core/ledger';

/** 设计表里各段位的网格（第 1~15 / 16~35 / 36~60 关） */
function designGridOf(level: number): string {
  return level <= 15 ? '3×4' : level <= 35 ? '4×4' : '5×4';
}

describe('素材台账 IMAGE_ANIMAL', () => {
  it('覆盖 0~MAX_ART_ID，且所有关卡图池的每张图都有归属', () => {
    for (let id = 0; id <= MAX_ART_ID; id++) {
      assert.ok(animalOf(id), `图 ID ${id} 缺少动物归属`);
    }
    for (const cfg of buildLevelConfigs()) {
      for (const id of cfg.imageIds) {
        assert.ok(animalOf(id), `第${cfg.level}关的图 ${id} 缺少动物归属`);
      }
    }
  });

  it('0~10 与 §3.1.2 归档记录一致：6~10 是五只动物各一张，不是同一只', () => {
    assert.deepStrictEqual(new Set([0, 1, 2, 3, 4, 5].map(animalOf)), new Set(['猫']));
    assert.deepStrictEqual([6, 7, 8, 9, 10].map(animalOf), ['虎', '兔', '仓鼠', '狗', '熊']);
    assert.strictEqual(Object.keys(IMAGE_ANIMAL).length, MAX_ART_ID + 1);
  });

  it('36 张全部登记，且每只动物正好 6 张、情绪不重复', () => {
    const byAnimal = new Map<string, string[]>();
    for (let id = 0; id <= MAX_ART_ID; id++) {
      const animal = animalOf(id);
      const mood = IMAGE_MOOD[id];
      assert.ok(animal, `图 ${id} 缺少动物`);
      assert.ok(mood, `图 ${id} 缺少情绪`);
      const list = byAnimal.get(animal) ?? [];
      list.push(mood);
      byAnimal.set(animal, list);
    }
    assert.strictEqual(byAnimal.size, 6, '应恰好 6 只动物');
    for (const [animal, moods] of byAnimal) {
      assert.strictEqual(moods.length, 6, `${animal} 应有 6 张`);
      assert.strictEqual(new Set(moods).size, 6, `${animal} 的情绪出现重复`);
    }
  });

  it('六种情绪与《关卡配置表》的写法一致（含「难过」）', () => {
    assert.deepStrictEqual(
      new Set(Object.values(IMAGE_MOOD)),
      new Set(['开心', '难过', '生气', '害羞', '惊讶', '得意']),
    );
  });

  it('每只动物的情绪顺序固定为 开心/难过/生气/害羞/惊讶/得意', () => {
    // ⚠️ 这里刻意用 set<string> 比较过（见上一个用例），只能验证"六种齐全"，测不出顺序。
    // 位置 3/4/5 是 害羞/惊讶/得意 —— 曾把这三项写成「惊讶/得意/害羞」而未被测试拦住，
    // 结果是标签与图案看起来错位（素材本身没错）。故补逐位断言防回归。
    const EXPECTED = ['开心', '难过', '生气', '害羞', '惊讶', '得意'];
    for (const [animal, ids] of ANIMAL_IMAGE_IDS) {
      assert.deepStrictEqual(
        ids.map((id) => IMAGE_MOOD[id]),
        EXPECTED,
        `${animal} 的 6 张图情绪顺序与《关卡配置表》不符`,
      );
    }
  });
});

describe('60 关设计表落地（网格 / 图池构成 / 只数 / 备注）', () => {
  it('设计表本身零问题（含图数校验与只数校验）', () => {
    assert.deepStrictEqual(validateLevelDesign(), []);
  });

  it('60 关齐全，且段位网格为 1~15 → 3×4、16~35 → 4×4、36~60 → 5×4', () => {
    for (let level = 1; level <= TOTAL_LEVELS; level++) {
      const cfg = buildLevelConfigs()[level - 1]!;
      assert.strictEqual(cfg.level, level);
      assert.strictEqual(`${cfg.rows}×${cfg.cols}`, designGridOf(level), `第${level}关网格不符`);
      assert.ok(LEVEL_POOL_SPEC[level], `第${level}关缺少图池构成`);
      assert.ok(LEVEL_ANIMAL_COUNT[level], `第${level}关缺少动物只数`);
      assert.ok(LEVEL_STAR_LINES[level], `第${level}关缺少星线`);
    }
    assert.strictEqual(buildLevelConfigs().length, TOTAL_LEVELS);
  });

  it('图数校验：Σ(moods × animals) === 图数公式', () => {
    for (let level = 1; level <= TOTAL_LEVELS; level++) {
      const cfg = buildLevelConfigs()[level - 1]!;
      assert.strictEqual(
        imagesOfLevel(level),
        imagesPerLevel(cfg.rows * cfg.cols),
        `第${level}关图池构成与图数公式不一致`,
      );
    }
  });

  it('只数校验：Σanimals === 表里的「动物只数」列', () => {
    for (let level = 1; level <= TOTAL_LEVELS; level++) {
      assert.strictEqual(
        animalsOfLevel(level),
        LEVEL_ANIMAL_COUNT[level],
        `第${level}关情绪分布用到的只数与「动物只数」列不符`,
      );
      assert.strictEqual(
        moodCountsOfLevel(level).length,
        LEVEL_ANIMAL_COUNT[level]!,
        `第${level}关展开后的只数与「动物只数」列不符`,
      );
    }
  });

  it('第 5 / 7 / 42 关这三处「修正」行已按新表落地', () => {
    // 第 5 关与第 4 关同构（5 只：1 只出 2 情绪 + 4 只各 1 情绪）
    assert.deepStrictEqual(LEVEL_POOL_SPEC[5], LEVEL_POOL_SPEC[4]);
    assert.deepStrictEqual(LEVEL_POOL_SPEC[5], [{ moods: 2, animals: 1 }, { moods: 1, animals: 4 }]);
    // 第 7 关与第 6 关同构（4 只：2 只出 2 情绪 + 2 只各 1 情绪）
    assert.deepStrictEqual(LEVEL_POOL_SPEC[7], LEVEL_POOL_SPEC[6]);
    assert.deepStrictEqual(LEVEL_POOL_SPEC[7], [{ moods: 2, animals: 2 }, { moods: 1, animals: 2 }]);
    // 第 42 关是 3 只：1 只出 4 情绪 + 2 只各 3 情绪
    assert.deepStrictEqual(LEVEL_POOL_SPEC[42], [{ moods: 4, animals: 1 }, { moods: 3, animals: 2 }]);
    assert.strictEqual(LEVEL_ANIMAL_COUNT[5], 5);
    assert.strictEqual(LEVEL_ANIMAL_COUNT[7], 4);
    assert.strictEqual(LEVEL_ANIMAL_COUNT[42], 3);
  });

  it('备注结构：小BOSS / 段BOSS 不低于前一关，回落关低于前一小BOSS，教学关最低', () => {
    for (const level of [10, 25, 48]) {
      assert.strictEqual(LEVEL_TAGS[level], '小BOSS');
      assert.ok(
        LEVEL_STAR_LINES[level]![2] > LEVEL_STAR_LINES[level - 1]![2],
        `第${level}关（小BOSS）3★ 线应高于第${level - 1}关`,
      );
    }
    for (const level of [11, 26, 49]) {
      assert.strictEqual(LEVEL_TAGS[level], '回落');
      assert.ok(
        LEVEL_STAR_LINES[level]![2] < LEVEL_STAR_LINES[level - 1]![2],
        `第${level}关（回落）3★ 线应低于第${level - 1}关（小BOSS）`,
      );
    }
    assert.strictEqual(LEVEL_TAGS[1], '教学');
    assert.strictEqual(LEVEL_TAGS[15], '段BOSS');
    assert.strictEqual(LEVEL_TAGS[35], '段BOSS');
    assert.strictEqual(LEVEL_TAGS[60], '终极BOSS');
    for (const cfg of buildLevelConfigs()) {
      assert.ok(
        LEVEL_STAR_LINES[cfg.level]![2] >= LEVEL_STAR_LINES[1]![2],
        `第${cfg.level}关 3★ 线低于教学关`,
      );
    }
  });

  it('混淆度由图池构成派生：第 1 关最好认（ma=1）、第 60 关最难（ma=6）', () => {
    for (let level = 1; level <= TOTAL_LEVELS; level++) {
      assert.strictEqual(LEVEL_CONFUSION_CONFIG[level], confusionOfLevel(level));
      // ma 是「同一只动物最多出几个情绪」，可以大于动物只数（如第 13 关 2 只里有一只出 5 个情绪）
      assert.ok(
        LEVEL_CONFUSION_CONFIG[level]! <= 6,
        `第${level}关 ma 不应超过情绪总数 6`,
      );
    }
    assert.strictEqual(LEVEL_CONFUSION_CONFIG[1], 1);
    assert.strictEqual(LEVEL_CONFUSION_CONFIG[13], 5);
    assert.strictEqual(LEVEL_CONFUSION_CONFIG[60], 6);
  });

  it('棋盘上限：每行 ≤4 个碎片、每列 ≤5 个碎片，且不存在 24 格关卡', () => {
    for (const cfg of buildLevelConfigs()) {
      assert.ok(cfg.cols <= 4, `第${cfg.level}关每行 ${cfg.cols} 个碎片，超过「每行 4 个」上限`);
      assert.ok(cfg.rows <= 5, `第${cfg.level}关每列 ${cfg.rows} 个碎片，超过「每列 5 个」上限`);
      assert.notStrictEqual(cfg.rows * cfg.cols, 24, `第${cfg.level}关仍是 24 格段位`);
    }
  });
});

describe('玩法模式（普通 / 噩梦）', () => {
  it('普通模式用任意交换，噩梦模式用相邻交换，都重刷 60 关', () => {
    const normal = buildLevelConfigs('normal');
    const nightmare = buildLevelConfigs('nightmare');
    assert.strictEqual(normal.length, TOTAL_LEVELS);
    assert.strictEqual(nightmare.length, TOTAL_LEVELS);
    for (const cfg of normal) assert.strictEqual(cfg.swapRule, 'any', `第${cfg.level}关应为任意交换`);
    for (const cfg of nightmare) assert.strictEqual(cfg.swapRule, 'adjacent', `第${cfg.level}关应为相邻交换`);
    assert.strictEqual(SWAP_RULE_BY_MODE.normal, 'any');
    assert.strictEqual(SWAP_RULE_BY_MODE.nightmare, 'adjacent');
  });

  it('两种模式共用同一批网格与图池；星线各模式独立成表（噩梦可单独给值）', () => {
    const normal = buildLevelConfigs('normal');
    const nightmare = buildLevelConfigs('nightmare');
    assert.strictEqual(normal.length, nightmare.length);
    for (let i = 0; i < normal.length; i++) {
      const a = normal[i]!;
      const b = nightmare[i]!;
      assert.strictEqual(a.level, b.level);
      assert.strictEqual(a.rows, b.rows);
      assert.strictEqual(a.cols, b.cols);
      assert.deepStrictEqual(a.imageIds, b.imageIds, `第${a.level}关两种模式图池应一致`);
      // 星线断言的是「与本模式的表一致」，而不是「两模式必须相同」——
      // 以后给噩梦单独定一张表时（见 README §5.3），这里不需要改。
      assert.deepStrictEqual(
        [a.star1, a.star2, a.star3],
        LEVEL_STAR_LINES[a.level],
        `第${a.level}关普通星线应与设计表一致`,
      );
      assert.deepStrictEqual(
        [b.star1, b.star2, b.star3],
        NIGHTMARE_STAR_LINES[b.level],
        `第${b.level}关噩梦星线应与噩梦表一致`,
      );
    }
  });

  it('噩梦星线表覆盖 1~60 关且逐关严格递增（噩梦难度需单独考虑，见 README §5.3）', () => {
    for (let level = 1; level <= TOTAL_LEVELS; level++) {
      const line = NIGHTMARE_STAR_LINES[level];
      assert.ok(line, `第${level}关缺少噩梦星线`);
      const [s1, s2, s3] = line!;
      assert.ok(s1 >= 1, `第${level}关噩梦 1★ 线必须 ≥1`);
      assert.ok(s1 < s2 && s2 < s3, `第${level}关噩梦星线未严格递增：${s1} / ${s2} / ${s3}`);
    }
  });

  it('星线表覆盖 1~60 关，逐关严格递增，且与配置逐关一致（§8.4）', () => {
    for (let level = 1; level <= TOTAL_LEVELS; level++) {
      const [s1, s2, s3] = LEVEL_STAR_LINES[level]!;
      assert.ok(s1 >= 1, `第${level}关 1★ 线必须 ≥1`);
      assert.ok(s1 < s2 && s2 < s3, `第${level}关星线未严格递增：${s1} / ${s2} / ${s3}`);
      const cfg = buildLevelConfigs()[level - 1]!;
      assert.deepStrictEqual([cfg.star1, cfg.star2, cfg.star3], [s1, s2, s3]);
    }
  });

  it('两种模式各自都能通过配置校验', () => {
    assert.deepStrictEqual(validateLevelConfigs(buildLevelConfigs('normal')), []);
    assert.deepStrictEqual(validateLevelConfigs(buildLevelConfigs('nightmare')), []);
  });
});

describe('config —— 配置与校验（§5.4 / §8.4 / §10.2）', () => {
  it('内置 60 关配置全部通过校验（0 条问题）', () => {
    assert.deepStrictEqual(validateLevelConfigs(buildLevelConfigs()), []);
  });

  it('内置通关奖励配置通过校验（0 条问题）', () => {
    assert.deepStrictEqual(validateRewardConfig(LEVEL_REWARD_CONFIG, IMAGE_TEXT_PLACEHOLDER), []);
    assert.strictEqual(Object.keys(LEVEL_REWARD_CONFIG).length, REWARD_LEVELS);
  });

  it('能检出「星线与设计表不一致」', () => {
    const configs = buildLevelConfigs();
    configs[0]!.star1 = 5;
    configs[0]!.star2 = 9;
    configs[0]!.star3 = 13; // 仍然严格递增，但不再是设计表的 1/3/5
    const issues = validateLevelConfigs(configs);
    assert.ok(issues.some((i) => i.message.includes('与设计表')), '应报出星线偏离设计表');
  });

  it('图数公式 = (格数-8)÷2 + 4', () => {
    assert.strictEqual(imagesPerLevel(12), 6);
    assert.strictEqual(imagesPerLevel(16), 8);
    assert.strictEqual(imagesPerLevel(20), 10);
    assert.strictEqual(imagesPerLevel(24), 12);
  });

  it('能检出「格数不合法」：必须 ≥12 且为 4 的倍数（§4.4 / §5.4）', () => {
    // 只动网格、只看「格数」这一条；由此连带出的图数/段位表问题与本题无关，一律过滤掉。
    const gridIssues = (rows: number, cols: number) => {
      const configs = buildLevelConfigs();
      configs[0]!.rows = rows;
      configs[0]!.cols = cols;
      return validateLevelConfigs(configs).filter((i) => i.message.includes('格数必须'));
    };

    // 合法：12 / 16 / 20 / 24 —— 4 的倍数且 ≥12
    for (const [rows, cols] of [[3, 4], [4, 3], [4, 4], [4, 5], [4, 6]] as const) {
      assert.deepStrictEqual(
        gridIssues(rows, cols),
        [],
        `${rows}×${cols}（${rows * cols} 格）是 4 的倍数且 ≥12，不应报格数问题`,
      );
    }

    // 非法：<12；或 ≥12 但不是 4 的倍数（14 / 18 正是旧「偶数」口径漏掉的那批）
    for (const [rows, cols] of [[2, 4], [2, 5], [2, 7], [3, 5], [3, 6]] as const) {
      assert.strictEqual(
        gridIssues(rows, cols).length,
        1,
        `${rows}×${cols}（${rows * cols} 格）不满足「≥12 且为 4 的倍数」，应恰好报 1 条格数问题`,
      );
    }
  });

  it('能检出「同一网格下两关图集合完全相同」（BUG-9）', () => {
    const configs = buildLevelConfigs();
    // 第 1、2 关同为 3×4，把第 2 关的图集合改成与第 1 关完全相同
    configs[1]!.imageIds = configs[0]!.imageIds.slice();
    const issues = validateLevelConfigs(configs);
    assert.ok(issues.some((i) => i.message.includes('图ID集合完全相同')));
  });

  it('能检出图ID越界与同关内重复', () => {
    const configs = buildLevelConfigs();
    configs[0]!.imageIds = [0, 0, 1, 2, 3, MAX_ART_ID + 1];
    const issues = validateLevelConfigs(configs);
    assert.ok(issues.some((i) => i.message.includes('重复')));
    assert.ok(issues.some((i) => i.message.includes('越界')));
  });

  it('能检出图列表长度不符合图数公式', () => {
    const configs = buildLevelConfigs();
    configs[0]!.imageIds = [0, 1, 2];
    const issues = validateLevelConfigs(configs);
    assert.ok(issues.some((i) => i.message.includes('图列表长度')));
  });

  it('能检出奖励配置缺失与文案缺失', () => {
    const rewards: Record<number, number> = { ...LEVEL_REWARD_CONFIG };
    delete rewards[REWARD_LEVELS];
    const texts: Record<number, string> = { ...IMAGE_TEXT_PLACEHOLDER };
    delete texts[REWARD_LEVELS - 2]; // 第35关奖励图ID=34，仍能触发文案缺失检查
    const issues = validateRewardConfig(rewards, texts);
    assert.ok(issues.some((i) => i.message.includes(`缺少第${REWARD_LEVELS}关`)));
    assert.ok(issues.some((i) => i.message.includes('缺少非空文案')));
  });
});

describe('poolGen 与设计表的口径一致性', () => {
  it('实际图池的动物情绪分布与设计表逐关一致（素材齐全时）', () => {
    for (const cfg of buildLevelConfigs()) {
      const counts = new Map<string, number>();
      for (const id of cfg.imageIds) {
        const animal = animalOf(id) ?? `#${id}`;
        counts.set(animal, (counts.get(animal) ?? 0) + 1);
      }
      const actual = [...counts.values()].sort((a, b) => b - a);
      const designed = [...moodCountsOfLevel(cfg.level)].sort((a, b) => b - a);
      assert.deepStrictEqual(actual, designed, `第${cfg.level}关动物情绪分布与设计表不一致`);
      assert.strictEqual(confusionOf(cfg.imageIds), LEVEL_CONFUSION_CONFIG[cfg.level]);
      assert.strictEqual(actual.length, LEVEL_ANIMAL_COUNT[cfg.level]);
    }
  });
});
