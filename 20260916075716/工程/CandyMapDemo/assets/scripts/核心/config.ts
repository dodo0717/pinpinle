/**
 * 关卡配置与配置校验（§5.3、§5.4、§8.1、§8.3、§8.4、§10.2、附录B）
 *
 * ⚠️ 2026-09-11 修订（**60 关设计表落地**）：关卡从 20 关扩到 60 关。
 * 网格、图池构成、星线**全部改为逐关给定**，来源是策划的《关卡配置表》：
 *
 *   1~15 关  3×4（12 格 / 6 图）
 *   16~35 关 4×4（16 格 / 8 图）
 *   36~60 关 5×4（20 格 / 10 图）
 *
 * 与旧 20 关表的四处关键差异：
 *   1. 图池不再只声明一个 `ma`，而是逐关声明「**动物只数 + 同动物不同情绪分布**」
 *      （见 `LEVEL_POOL_SPEC` / `LEVEL_ANIMAL_COUNT`）。`ma` 降级为**派生量**
 *      （= 该关分配到的最大情绪数），不再是难度曲线的唯一来源。
 *   2. 星线不再由 `tools/calibrate.mjs` 标定，而是**设计表逐关给定**（`LEVEL_STAR_LINES`）。
 *      标定器保留为「体检 / 对照」工具，不再回写本表；原先「星线随关卡不升」的不变量随之作废。
 *   3. 备注列（教学 / 小BOSS / 回落 / 段BOSS / 终极BOSS）落地为 `LEVEL_TAGS`。
 *   4. 奖励表随关卡数扩到 36 张图（第 1~36 关逐关解锁一张），见 `LEVEL_REWARD_CONFIG`。
 *
 * 程序仍然不关心图长什么样：每关只声明「需要几张图 + 这几张图怎么分给几只动物」，
 * 具体用哪几张由 `poolGen.ts` 从可用素材池里确定性抽出。
 */

import { generateLevelPools, type GeneratedPool, type PoolRequest } from './poolGen';
import { MAX_ART_ID, allArtIds } from './ledger';

/** 素材台账（图ID ↔ 动物/情绪）在本模块转出，保持既有 import 路径可用 */
export * from './ledger';

/** 时间限制固定 180 秒（§5.3） */
export const TIME_LIMIT = 180;

/** 关卡总数（设计表：第 1~60 关） */
export const TOTAL_LEVELS = 60;

/** 通关奖励覆盖的关卡数：第 1~36 关逐关解锁一张图（素材恰好 36 张） */
export const REWARD_LEVELS = 36;

/**
 * **图鉴/奖励系统**使用的图 ID 上限。
 *
 * 36 张素材（`0~MAX_ART_ID`）在第 1~36 关逐关解锁完毕；第 37~60 关不再解锁新图
 * （设计表未给这 24 关的图鉴奖励，暂按「无新图奖励」处理）。
 */
export const MAX_IMAGE_ID_IN_USE = MAX_ART_ID;

/**
 * 关卡号 → [行, 列]（§8.1 + 60 关设计表）
 *
 * 棋盘上限：**每行最多 4 个碎片、每列最多 5 个碎片**。
 * 列固定 4、行数从 3 涨到 5 —— 竖屏下 4 列正好铺满宽度，多出来的碎片往上长。
 * 碎片因此能画大得多（5×4 约 217px/格，旧的 4×6 只有约 140px/格）。
 *
 * 段位（设计表）：
 *   第 1~15 关  3×4（12 格 / 6 图）
 *   第 16~35 关 4×4（16 格 / 8 图）
 *   第 36~60 关 5×4（20 格 / 10 图）
 * 全表只有 12 / 16 / 20 三种格数，**不存在 24 格关卡**。
 */
export const GRID_BY_LEVEL: Record<number, [number, number]> = (() => {
  const grid: Record<number, [number, number]> = {};
  for (let level = 1; level <= TOTAL_LEVELS; level++) {
    if (level <= 15) grid[level] = [3, 4];
    else if (level <= 35) grid[level] = [4, 4];
    else grid[level] = [5, 4];
  }
  return grid;
})();

/**
 * 一个「情绪组」：`moods` 个情绪图 × `animals` 只动物。
 *
 * 设计表里的写法是 `2情绪×1只`、`4情绪×3只` 这种，本类型就是它的结构化形式。
 */
export interface MoodGroup {
  /** 每只动物出几个情绪图 */
  moods: number;
  /** 该组有几只动物 */
  animals: number;
}

/** 图池构成表的构造器（只是为了表能写得和设计表一样短） */
const g = (moods: number, animals: number): MoodGroup => ({ moods, animals });

/**
 * **逐关图池构成**（设计表「同动物不同情绪」列）—— 图池生成的唯一权威来源。
 *
 * 读法：`[g(2,1), g(1,4)]` = 1 只动物出 2 个情绪图 + 4 只动物各出 1 个情绪图，
 * 共 5 只动物、6 张图（= 3×4 段的总图数）。
 *
 * ⚠️ 每关两个硬约束（`validateLevelDesign()` 会逐关校验，表写错直接报错）：
 *   1. **图数校验**：Σ(moods × animals) 必须等于 `imagesPerLevel(格数)`；
 *   2. **只数校验**：Σanimals 必须等于 `LEVEL_ANIMAL_COUNT[关卡]`。
 * 注意表里允许「只数回落」（如第 42 关 3 只 → 第 43 关 4 只），难度由此刻的星线承载，
 * 因此**不再校验「同段位只数单调不降」**。
 *
 * 素材齐全（36 张，每只动物 6 个情绪）时，本表可**逐关精确还原**；
 * 素材不足时由 `poolGen.ts` 降级（抬高实际 ma 或增加动物只数）并逐关点名。
 */
export const LEVEL_POOL_SPEC: Record<number, MoodGroup[]> = {
  // ── 3×4 段（第 1~15 关，6 图）────────────────────────────────────────
  1: [g(1, 6)],
  2: [g(1, 6)],
  3: [g(1, 6)],
  4: [g(2, 1), g(1, 4)],
  5: [g(2, 1), g(1, 4)],
  6: [g(2, 2), g(1, 2)],
  7: [g(2, 2), g(1, 2)],
  8: [g(2, 3)],
  9: [g(3, 1), g(2, 1), g(1, 1)],
  10: [g(3, 1), g(2, 1), g(1, 1)],
  11: [g(4, 1), g(2, 1)],
  12: [g(4, 1), g(2, 1)],
  13: [g(5, 1), g(1, 1)],
  14: [g(4, 1), g(2, 1)],
  15: [g(4, 1), g(2, 1)],
  // ── 4×4 段（第 16~35 关，8 图）──────────────────────────────────────
  16: [g(2, 4)],
  17: [g(2, 3), g(2, 1)],
  18: [g(2, 4)],
  19: [g(3, 2), g(2, 1)],
  20: [g(4, 1), g(2, 2)],
  21: [g(4, 1), g(2, 2)],
  22: [g(3, 2), g(2, 1)],
  23: [g(4, 2)],
  24: [g(4, 2)],
  25: [g(5, 1), g(3, 1)],
  26: [g(5, 1), g(3, 1)],
  27: [g(5, 1), g(3, 1)],
  28: [g(6, 1), g(2, 1)],
  29: [g(6, 1), g(2, 1)],
  30: [g(6, 1), g(2, 1)],
  31: [g(6, 1), g(2, 1)],
  32: [g(6, 1), g(2, 1)],
  33: [g(6, 1), g(2, 1)],
  34: [g(6, 1), g(2, 1)],
  35: [g(6, 1), g(2, 1)],
  // ── 5×4 段（第 36~60 关，10 图）─────────────────────────────────────
  36: [g(2, 5)],
  37: [g(2, 5)],
  38: [g(2, 5)],
  39: [g(3, 2), g(2, 2)],
  40: [g(4, 1), g(2, 3)],
  41: [g(4, 1), g(2, 3)],
  42: [g(4, 1), g(3, 2)],
  43: [g(3, 2), g(2, 2)],
  44: [g(5, 1), g(3, 1), g(2, 1)],
  45: [g(5, 1), g(3, 1), g(2, 1)],
  46: [g(5, 1), g(4, 1), g(1, 1)],
  47: [g(6, 1), g(3, 1), g(1, 1)],
  48: [g(6, 1), g(3, 1), g(1, 1)],
  49: [g(5, 1), g(3, 1), g(2, 1)],
  50: [g(5, 1), g(4, 1), g(1, 1)],
  51: [g(6, 1), g(3, 1), g(1, 1)],
  52: [g(6, 1), g(4, 1)],
  53: [g(6, 1), g(4, 1)],
  54: [g(6, 1), g(4, 1)],
  55: [g(6, 1), g(4, 1)],
  56: [g(6, 1), g(4, 1)],
  57: [g(6, 1), g(4, 1)],
  58: [g(6, 1), g(4, 1)],
  59: [g(6, 1), g(4, 1)],
  60: [g(6, 1), g(4, 1)],
};

/**
 * 逐关「动物只数」（设计表的「动物只数」列）。
 *
 * ⚠️ 与 `LEVEL_POOL_SPEC` 是同一条数据的**两种表述**，两列必须一致 ——
 * 这正是设计表新加的「只数校验」列，`validateLevelDesign()` 会逐关比对。
 * 保留成独立一列，是为了让「表被改错」这件事能被自动发现，而不是由生成器悄悄兜住。
 */
export const LEVEL_ANIMAL_COUNT: Record<number, number> = {
  1: 6, 2: 6, 3: 6, 4: 5, 5: 5, 6: 4, 7: 4, 8: 3, 9: 3, 10: 3,
  11: 2, 12: 2, 13: 2, 14: 2, 15: 2,
  16: 4, 17: 4, 18: 4, 19: 3, 20: 3, 21: 3, 22: 3, 23: 2, 24: 2, 25: 2,
  26: 2, 27: 2, 28: 2, 29: 2, 30: 2, 31: 2, 32: 2, 33: 2, 34: 2, 35: 2,
  36: 5, 37: 5, 38: 5, 39: 4, 40: 4, 41: 4, 42: 3, 43: 4, 44: 3, 45: 3,
  46: 3, 47: 3, 48: 3, 49: 3, 50: 3, 51: 3, 52: 2, 53: 2, 54: 2, 55: 2,
  56: 2, 57: 2, 58: 2, 59: 2, 60: 2,
};

/**
 * 逐关备注（设计表的「备注」列）—— 只影响展示与结构校验，不参与图池生成。
 *
 *   `教学`    第 1 关，星线取全表最低
 *   `修正`    设计表里被修订过的行（第 5 / 7 / 42 关），仅供追溯
 *   `小BOSS`  段内第一个爬升点（第 10 / 25 / 48 关）
 *   `回落`    打完 BOSS 后的缓一档（第 11 / 26 / 49 关）
 *   `段BOSS`  段位收尾（第 15 / 35 关）
 *   `终极BOSS` 第 60 关
 */
export const LEVEL_TAGS: Record<number, string> = {
  1: '教学',
  5: '修正',
  7: '修正',
  10: '小BOSS',
  11: '回落',
  15: '段BOSS',
  25: '小BOSS',
  26: '回落',
  35: '段BOSS',
  42: '修正',
  48: '小BOSS',
  49: '回落',
  60: '终极BOSS',
};

/** 展开某关的情绪分布：第 i 只动物出几个情绪图（按设计表从多到少） */
export function moodCountsOfLevel(level: number): number[] {
  const groups = LEVEL_POOL_SPEC[level];
  if (!groups) throw new Error(`moodCountsOfLevel: 缺少第${level}关的图池构成配置`);
  const out: number[] = [];
  for (const group of groups) {
    for (let i = 0; i < group.animals; i++) out.push(group.moods);
  }
  return out;
}

/** 某关的设计动物只数（Σanimals） */
export function animalsOfLevel(level: number): number {
  return (LEVEL_POOL_SPEC[level] ?? []).reduce((sum, group) => sum + group.animals, 0);
}

/** 某关的设计图数（Σ moods×animals） */
export function imagesOfLevel(level: number): number {
  return (LEVEL_POOL_SPEC[level] ?? []).reduce((sum, group) => sum + group.moods * group.animals, 0);
}

/** 某关的设计混淆度 ma（= 最大的一只动物出几个情绪图） */
export function confusionOfLevel(level: number): number {
  return (LEVEL_POOL_SPEC[level] ?? []).reduce((max, group) => Math.max(max, group.moods), 0);
}

/**
 * 每关的设计混淆度 `ma`（§8.3）—— ⚠️ 现在是 `LEVEL_POOL_SPEC` 的**派生量**。
 *
 * ma = 同关内「同一只动物的图」最多出现几张。同一张脸出现得越多，
 * 玩家越难判断「这四块是不是同一组」，认知负荷越高：
 *   ma=1 → 6 只动物各一张，一眼可分（最简单）
 *   ma=6 → 整关只有 1~2 只动物的不同情绪（最难）
 *
 * 保留这张派生表，是因为渲染层、标定器与测试都按 `ma` 分组比较。
 * 曲线（设计表）：1 → 2 → 3 → 4 → 5 → 6，段内整体走高，BOSS 前后有回落。
 */
export const LEVEL_CONFUSION_CONFIG: Record<number, number> = Object.fromEntries(
  Array.from({ length: TOTAL_LEVELS }, (_, i) => [i + 1, confusionOfLevel(i + 1)]),
);

/**
 * 每关通关奖励解锁哪张图（§10.2 / 附录B.2 + 60 关设计表）。
 *
 * 36 张素材在第 1~36 关逐关解锁完毕；**第 37~60 关设计表未给图鉴奖励**，
 * 因此不出现在本表里（后续若改为金币/徽章，只需扩这张表）。
 */
export const LEVEL_REWARD_CONFIG: Record<number, number> = Object.fromEntries(
  Array.from({ length: REWARD_LEVELS }, (_, i) => [i + 1, i]),
);

/**
 * 移动规则（§6.1 / §1.6）—— 限制的是**整片平移的位移向量**。
 *   'any'      —— 任意距离都能挪（**普通模式**，放开相邻限制后的默认规则）
 *   'adjacent' —— 只能挪 1 格（上下左右）（**噩梦模式**，最早的原始规则）
 *
 * 两条规则都保留，由「模式」选择用哪一条，而不是删掉其中一条。
 *
 * ⚠️ 名字沿用 `swap`（整片平移在单块时就是一次两块交换）：
 * `'adjacent'` 现在读作「整片每次只能挪一格」，而不是「只有两块相邻才能换」——
 * 单块时两者逐字等价，多块时才分道扬镳。见 `core/move.ts` 顶部说明。
 */
export type SwapRule = 'any' | 'adjacent';

/** 玩法模式。两种模式**共用同一批关卡**（网格、图池完全相同），差别在交换规则与星线。 */
export type GameMode = 'normal' | 'nightmare';

/** 每种模式使用的交换规则 */
export const SWAP_RULE_BY_MODE: Record<GameMode, SwapRule> = {
  normal: 'any',
  nightmare: 'adjacent',
};

/** 模式展示名（UI 与文档统一口径） */
export const MODE_LABEL: Record<GameMode, string> = {
  normal: '普通',
  nightmare: '困难',
};

/**
 * 一关的完整配置。引擎只读这个对象，不认任何外部状态。
 *
 * 由 `buildLevelPlan(mode, options)` 生成：网格来自 `GRID_BY_LEVEL`、
 * 图池由 `poolGen.ts` 从可用素材池随机抽出、星线来自该模式的星线表、
 * 交换规则来自 `SWAP_RULE_BY_MODE`。
 */
export interface LevelConfig {
  /** 关卡序号，1~60 */
  level: number;
  /** 棋盘行数 */
  rows: number;
  /** 棋盘列数 */
  cols: number;
  /** 本关使用的图ID列表，长度 = 图数 */
  imageIds: number[];
  timeLimit: number;
  star1: number;
  star2: number;
  star3: number;
  /** 本关的交换规则，由模式决定（见 SWAP_RULE_BY_MODE） */
  swapRule: SwapRule;
}

/** 网格格数 */
export function cellsOf(rows: number, cols: number): number {
  return rows * cols;
}

/** 图数公式（§5.4）：图数 = (格数 - 8) ÷ 2 + 4 */
export function imagesPerLevel(cells: number): number {
  return (cells - 8) / 2 + 4;
}

/**
 * 各关三条星线（§8.4）—— **设计表逐关给定**（《关卡配置表》1★/2★/3★ 列）。
 *
 * ⚠️ 2026-09-11 修订：原先由 `tools/calibrate.mjs` 按「P20 / P50 / P70」标定，
 * 现在改为设计表直接给值，原因有两条：
 *   1. 60 关表把星线当作**逐关的难度目标**来写（教学关最低、BOSS 前抬高、回落关压低），
 *      这不是「同一难度共用一组数」的标定口径能表达的；
 *   2. 标定器唯一的人因假设「一次交换 1.5 秒」尚未用真人数据替换（§8.4 待办 2）。
 *
 * 曲线（3★）：5 → 7 → …→ 9（3×4 段收尾）→ 8 → …→ 10（4×4 段收尾）→ 9 → …→ 11（终极BOSS）。
 * 因此**「星线随关卡单调不升」这条旧不变量已作废**，改为「与设计表逐关一致」。
 *
 * `tools/calibrate.mjs` 仍可运行（**保留**）：它打印本表的仿真达成率 + 参考建议值，
 * 不再自动回写。它的定位是**上线后设计新关卡分数时的标准参考工具** ——
 * 先用仿真出一个参考区间，再用真实用户数据逐步收紧。
 *
 * ⚠️ 2026-09-11 记录（后续扩充方向）：还会**继续补关卡**（触发信号：用户连噩梦都过得快），
 * 且新关卡的分数**逐关递增**；也会**增加新玩法**。
 *
 * 注意：**抬星线是唯一还能递加难度的手段** —— 网格已到硬上限
 * （每行 ≤4 / 每列 ≤5，最大 5×4，24 格段位已取消，见 `GRID_BY_LEVEL`），
 * 混淆度 `ma` 已到 6 上限（受素材张数限制），时间固定 `TIME_LIMIT = 180` 秒。
 * 所以分数加到「仿真里没几个人够得着」时，该加的是**新素材或新玩法**，不是继续堆分数。
 * 补关卡的具体流程见 `开发计划与美术资源清单.md` §13.11。
 */
export const LEVEL_STAR_LINES: Record<number, [number, number, number]> = {
  // ── 3×4 段（第 1~15 关，6 图）────────────────────────────────────────
  1: [1, 3, 5], // 教学
  2: [2, 4, 6],
  3: [3, 5, 7],
  4: [3, 5, 7],
  5: [3, 5, 7], // 修正
  6: [3, 5, 7],
  7: [3, 5, 7], // 修正
  8: [3, 5, 7],
  9: [3, 5, 7],
  10: [4, 6, 8], // 小BOSS
  11: [3, 5, 7], // 回落
  12: [3, 5, 7],
  13: [3, 5, 7],
  14: [4, 6, 8],
  15: [5, 7, 9], // 段BOSS
  // ── 4×4 段（第 16~35 关，8 图）──────────────────────────────────────
  16: [4, 6, 8],
  17: [4, 6, 8],
  18: [4, 6, 8],
  19: [4, 6, 8],
  20: [4, 6, 8],
  21: [4, 6, 8],
  22: [4, 6, 8],
  23: [4, 6, 8],
  24: [4, 6, 8],
  25: [5, 7, 9], // 小BOSS
  26: [4, 6, 8], // 回落
  27: [4, 6, 8],
  28: [4, 6, 8],
  29: [4, 6, 8],
  30: [4, 6, 8],
  31: [4, 6, 8],
  32: [4, 6, 8],
  33: [4, 6, 8],
  34: [5, 7, 9],
  35: [6, 8, 10], // 段BOSS
  // ── 5×4 段（第 36~60 关，10 图）─────────────────────────────────────
  36: [5, 7, 9],
  37: [5, 7, 9],
  38: [5, 7, 9],
  39: [5, 7, 9],
  40: [5, 7, 9],
  41: [5, 7, 9],
  42: [5, 7, 9], // 修正
  43: [5, 7, 9],
  44: [5, 7, 9],
  45: [5, 7, 9],
  46: [5, 7, 9],
  47: [5, 7, 9],
  48: [6, 8, 10], // 小BOSS
  49: [5, 7, 9], // 回落
  50: [5, 7, 9],
  51: [5, 7, 9],
  52: [5, 7, 9],
  53: [5, 7, 9],
  54: [5, 7, 9],
  55: [5, 7, 9],
  56: [5, 7, 9],
  57: [5, 7, 9],
  58: [5, 7, 9],
  59: [6, 8, 10],
  60: [7, 9, 11], // 终极BOSS
};

/**
 * 噩梦模式星线 —— **与普通同分（2026-09-11 已定，现在不动）**。
 *
 * 两个模式的**网格与图池完全相同**，差别只有交换规则（噩梦只能相邻交换，
 * 见 `SWAP_RULE_BY_MODE`）。噩梦每得 1 分要交换的次数约为普通的 2.5~3 倍
 * （见 `engine.minAdjacentSwapsToCompleteTarget()`），所以**同一组数值在噩梦模式下
 * 就是更难拿满星** —— 「难度更高」这件事已经由交换规则实现了，不需要再叠数值惩罚。
 *
 * 不同分还有第二个理由：现在没有任何用户数据，此时按仿真改数值等于
 * 用一个假设（一次交换 1.5 秒）覆盖策划的设计；而仿真给的建议值（3★ 线 4/6/7）
 * 比设计表**更低**，方向也说反了，照它改只会让噩梦更简单。
 *
 * ⚠️ 触发扩充的信号是「**用户连噩梦都过得快**」—— 那一刻说明现有 60 关的难度上限
 * 不够用了，优先**加第 61~100 关**（分数逐关递增），而不是给噩梦单独定表。
 * 因为难度旋钮已经顶格：网格到 5×4 上限、`ma` 到 6 上限、时间固定 180 秒，
 * **抬星线是唯一还能递加的手段**。
 *
 * → 预留能力：以后真要给噩梦独立数值，**只需把本表的表达式换成字面量**，
 *   其余代码（`STAR_LINES_BY_MODE` / `buildLevelPlan` / 校验 / 测试）都不用动。
 */
export const NIGHTMARE_STAR_LINES: Record<number, [number, number, number]> = { ...LEVEL_STAR_LINES };

/** 按模式索引星线表 */
export const STAR_LINES_BY_MODE: Record<GameMode, Record<number, [number, number, number]>> = {
  normal: LEVEL_STAR_LINES,
  nightmare: NIGHTMARE_STAR_LINES,
};

/** `buildLevelPlan` 的入参 */
export interface BuildLevelOptions {
  /**
   * 可用素材 ID 池（通常是「实际探测到已到货的图」）。
   * 省略时按**素材齐全**处理（0~`MAX_ART_ID`），供标定与测试使用。
   */
  availableIds?: readonly number[];
  /** 图池随机种子；同一种子 → 每关恒定同一套图池，换种子即整批重抽 */
  seed?: number;
}

/** 一次关卡构建的完整结果：能开的关卡 + 开不了的关卡 + 需要人工关注的问题 */
export interface LevelPlan {
  levels: LevelConfig[];
  /** 素材张数不足、组不出图池的关卡号 */
  skipped: number[];
  /** 需要人工关注的问题（图池偏离设计、跨关撞车、关卡被迫关闭） */
  notes: string[];
  /**
   * 关卡号 → 图池生成结果（含「设计 vs 实际」的 `ma` 与动物只数）。
   *
   * 这是生成器的**原始产物**，调用方直接读，不要再自己重算一遍 ——
   * 灰盒底部那行「实际 5 只 / ma=5（设计 …）」曾经用 `confusionOf` 另算，
   * 一旦两处口径分叉，界面显示的就未必是算法真正在用的那个图池。
   * `skipped` 里的关卡不在本表中。
   */
  pools: Map<number, GeneratedPool>;
}

/**
 * 生成关卡方案（**推荐入口**：能同时拿到被跳过的关卡与诊断信息）。
 *
 * 两种模式的**网格与图池完全一致**（噩梦模式就是重刷同一批关卡），
 * 只有「交换规则」和「星线」不同。
 *
 * 素材不足时**只返回能开的关卡**，被关掉的关卡号落在 `skipped` ——
 * 调用方据此决定「暂不开放」还是「降级展示」，而不是拿一个残缺配置硬跑。
 */
export function buildLevelPlan(mode: GameMode = 'normal', options: BuildLevelOptions = {}): LevelPlan {
  const availableIds = options.availableIds ?? allArtIds();
  const lines = STAR_LINES_BY_MODE[mode];
  const swapRule = SWAP_RULE_BY_MODE[mode];

  const requests: PoolRequest[] = [];
  for (let level = 1; level <= TOTAL_LEVELS; level++) {
    const grid = GRID_BY_LEVEL[level];
    if (!grid) throw new Error(`buildLevelPlan: 缺少第${level}关的网格配置`);
    const [rows, cols] = grid;
    const moodCounts = moodCountsOfLevel(level);
    const expect = imagesPerLevel(cellsOf(rows, cols));
    const actual = moodCounts.reduce((sum, n) => sum + n, 0);
    if (actual !== expect) {
      throw new Error(
        `buildLevelPlan: 第${level}关图池构成与图数公式不一致（构成 ${actual} 张，应为 ${expect} 张）`,
      );
    }
    requests.push({
      level,
      moodCounts,
      gridKey: `${rows}x${cols}`,
    });
  }

  const generated = generateLevelPools(requests, availableIds, options.seed);

  const levels: LevelConfig[] = [];
  for (const request of requests) {
    const pool: GeneratedPool | undefined = generated.byLevel.get(request.level);
    if (!pool) continue;
    const [rows, cols] = GRID_BY_LEVEL[request.level]!;
    const line = lines[request.level];
    if (!line) throw new Error(`buildLevelPlan: 缺少第${request.level}关（${mode}）的星线配置`);
    levels.push({
      level: request.level,
      rows,
      cols,
      imageIds: pool.imageIds,
      timeLimit: TIME_LIMIT,
      star1: line[0],
      star2: line[1],
      star3: line[2],
      swapRule,
    });
  }

  return {
    levels,
    skipped: generated.skipped,
    notes: generated.notes.map((note) => note.message),
    pools: generated.byLevel,
  };
}

/** 只要关卡配置、不关心被跳过的关卡时用这个 —— 等价于 `buildLevelPlan(...).levels` */
export function buildLevelConfigs(mode: GameMode = 'normal', options: BuildLevelOptions = {}): LevelConfig[] {
  return buildLevelPlan(mode, options).levels;
}

export interface ConfigIssue {
  scope: string;
  message: string;
}

/**
 * 校验**设计表本身**（60 关《关卡配置表》的落地正确性）。
 *
 * 设计表新增了「图数校验 / 只数校验」两列，这里就是那两条校验的程序化版本，
 * 外加备注结构（教学 / BOSS / 回落）与段位网格的约束。
 * 表被改错时（例如把 `2情绪×1只+1情绪×4只` 写成 `2情绪×2只+1情绪×2只` 却忘了改只数），
 * 会在启动自检 / `npm test` 里直接报出来，而不是由生成器悄悄兜住。
 */
export function validateLevelDesign(): ConfigIssue[] {
  const issues: ConfigIssue[] = [];

  for (let level = 1; level <= TOTAL_LEVELS; level++) {
    const scope = `第${level}关`;
    const groups = LEVEL_POOL_SPEC[level];
    if (!groups || groups.length === 0) {
      issues.push({ scope, message: '缺少图池构成配置（LEVEL_POOL_SPEC）' });
      continue;
    }
    for (const group of groups) {
      if (!Number.isInteger(group.moods) || group.moods < 1 || group.moods > 6) {
        issues.push({ scope, message: `情绪组 ${group.moods}情绪×${group.animals}只：情绪数必须为 1~6` });
      }
      if (!Number.isInteger(group.animals) || group.animals < 1) {
        issues.push({ scope, message: `情绪组 ${group.moods}情绪×${group.animals}只：只数必须 ≥1` });
      }
    }

    const grid = GRID_BY_LEVEL[level];
    if (!grid) {
      issues.push({ scope, message: '缺少网格配置（GRID_BY_LEVEL）' });
      continue;
    }
    const cells = cellsOf(grid[0], grid[1]);
    const expectImages = imagesPerLevel(cells);
    const actualImages = imagesOfLevel(level);
    if (actualImages !== expectImages) {
      issues.push({
        scope,
        message: `图数校验失败：各动物情绪图相加 = ${actualImages}，总图数量应为 ${expectImages}（${grid[0]}×${grid[1]}）`,
      });
    }
    const expectAnimals = LEVEL_ANIMAL_COUNT[level];
    if (expectAnimals === undefined) {
      issues.push({ scope, message: '缺少动物只数配置（LEVEL_ANIMAL_COUNT）' });
    } else if (animalsOfLevel(level) !== expectAnimals) {
      issues.push({
        scope,
        message: `只数校验失败：情绪分布用到 ${animalsOfLevel(level)} 只，动物只数列写的是 ${expectAnimals} 只`,
      });
    }

    const line = LEVEL_STAR_LINES[level];
    if (!line) {
      issues.push({ scope, message: '缺少星线配置（LEVEL_STAR_LINES）' });
      continue;
    }
    const [s1, s2, s3] = line;
    if (!(s1 >= 1 && s1 < s2 && s2 < s3)) {
      issues.push({ scope, message: `星线必须严格递增，实际 ${s1} / ${s2} / ${s3}` });
    }
  }

  // 段位边界（设计表）：1~15 为 3×4、16~35 为 4×4、36~60 为 5×4
  for (let level = 1; level <= TOTAL_LEVELS; level++) {
    const grid = GRID_BY_LEVEL[level]!;
    const key = `${grid[0]}×${grid[1]}`;
    const want = level <= 15 ? '3×4' : level <= 35 ? '4×4' : '5×4';
    if (key !== want) {
      issues.push({ scope: `第${level}关`, message: `段位网格应为 ${want}，实际 ${key}` });
    }
  }

  // 备注结构：教学最低 / BOSS 不低于前一关 / 回落低于前一小BOSS
  const firstLine = LEVEL_STAR_LINES[1]!;
  for (let level = 2; level <= TOTAL_LEVELS; level++) {
    const line = LEVEL_STAR_LINES[level]!;
    if (line[2] < firstLine[2]) {
      issues.push({ scope: `第${level}关`, message: `3★ 线 ${line[2]} 低于教学关 ${firstLine[2]}` });
    }
  }
  for (const [key, tag] of Object.entries(LEVEL_TAGS)) {
    const level = Number(key);
    const line = LEVEL_STAR_LINES[level];
    const prev = LEVEL_STAR_LINES[level - 1];
    if (!line) continue;
    if (!['小BOSS', '段BOSS', '终极BOSS', '回落'].includes(tag)) continue;
    if (!prev) {
      issues.push({ scope: `第${level}关`, message: `备注「${tag}」出现在第 1 关，无处对比` });
      continue;
    }
    if (tag === '回落') {
      const boss = LEVEL_STAR_LINES[level - 1]!;
      if (line[2] >= boss[2]) {
        issues.push({
          scope: `第${level}关`,
          message: `回落关 3★ 线 ${line[2]} 应低于第${level - 1}关的 ${boss[2]}`,
        });
      }
      continue;
    }
    if (line[2] < prev[2]) {
      issues.push({
        scope: `第${level}关`,
        message: `${tag} 的 3★ 线 ${line[2]} 不应低于第${level - 1}关的 ${prev[2]}`,
      });
    }
  }
  for (const level of [15, 35]) {
    // 段BOSS 必须是本段最严
    const line = LEVEL_STAR_LINES[level]!;
    const from = level <= 15 ? 1 : 16;
    for (let other = from; other < level; other++) {
      if (LEVEL_STAR_LINES[other]![2] > line[2]) {
        issues.push({
          scope: `第${level}关`,
          message: `段BOSS 的 3★ 线 ${line[2]} 低于同段第${other}关的 ${LEVEL_STAR_LINES[other]![2]}`,
        });
      }
    }
  }

  return issues;
}

/** 校验每关图列表（§5.4）+ 星线与设计表一致 */
export function validateLevelConfigs(configs: readonly LevelConfig[]): ConfigIssue[] {
  const issues: ConfigIssue[] = [];

  for (const cfg of configs) {
    const scope = `第${cfg.level}关`;
    const cells = cellsOf(cfg.rows, cfg.cols);

    // §4.4 / §5.4：格数 ≥12 且为 4 的倍数（12/16/20/24），保证池子2 组数 =(格数-8)÷2 ≥ 2
    if (cells < 12 || cells % 4 !== 0) {
      issues.push({ scope, message: `格数必须 ≥12 且为 4 的倍数，实际 ${cells}` });
    }
    if (cells !== 0 && imagesPerLevel(cells) !== Math.floor(imagesPerLevel(cells))) {
      issues.push({ scope, message: `(格数-8)÷2 必须为整数，格数 ${cells}` });
    }
    const expected = imagesPerLevel(cells);
    if (cfg.imageIds.length !== expected) {
      issues.push({ scope, message: `图列表长度必须等于图数 ${expected}，实际 ${cfg.imageIds.length}` });
    }
    const seen = new Set<number>();
    for (const id of cfg.imageIds) {
      if (!Number.isInteger(id) || id < 0 || id > MAX_ART_ID) {
        issues.push({ scope, message: `图ID ${id} 越界（允许 0~${MAX_ART_ID}）` });
      }
      if (seen.has(id)) issues.push({ scope, message: `图ID ${id} 在同一关内重复` });
      seen.add(id);
    }
    const mapped = GRID_BY_LEVEL[cfg.level];
    if (mapped && (mapped[0] !== cfg.rows || mapped[1] !== cfg.cols)) {
      issues.push({ scope, message: `网格 ${cfg.rows}×${cfg.cols} 与关卡段位表 ${mapped[0]}×${mapped[1]} 不一致` });
    }
    if (!(cfg.star1 < cfg.star2 && cfg.star2 < cfg.star3)) {
      issues.push({ scope, message: `星线必须严格递增，实际 ${cfg.star1} / ${cfg.star2} / ${cfg.star3}` });
    }

    // 星线必须与设计表逐关一致（设计表是唯一权威，防止"代码里的值"和"表里的值"漂移）
    const mode: GameMode = cfg.swapRule === 'adjacent' ? 'nightmare' : 'normal';
    const line = STAR_LINES_BY_MODE[mode][cfg.level];
    if (line && (line[0] !== cfg.star1 || line[1] !== cfg.star2 || line[2] !== cfg.star3)) {
      issues.push({
        scope,
        message:
          `星线 ${cfg.star1}/${cfg.star2}/${cfg.star3} 与设计表 ` +
          `${line[0]}/${line[1]}/${line[2]}（${MODE_LABEL[mode]}模式）不一致`,
      });
    }
  }

  // 跨关卡唯一性（§5.4 / BUG-9）：同一网格大小的关卡，任意两关的图ID「集合」不能完全相同（与顺序无关）
  const byGrid = new Map<string, LevelConfig[]>();
  for (const cfg of configs) {
    const key = `${cfg.rows}x${cfg.cols}`;
    const list = byGrid.get(key) ?? [];
    list.push(cfg);
    byGrid.set(key, list);
  }
  for (const [key, list] of byGrid) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!;
        const b = list[j]!;
        if (sameIdSet(a.imageIds, b.imageIds)) {
          issues.push({
            scope: `${key}`,
            message: `第${a.level}关与第${b.level}关图ID集合完全相同（与顺序无关），违反跨关卡唯一性`,
          });
        }
      }
    }
  }

  return issues;
}

/** 校验通关奖励配置（§10.2） */
export function validateRewardConfig(
  rewards: Readonly<Record<number, number>>,
  imageTexts: Readonly<Record<number, string>>,
): ConfigIssue[] {
  const issues: ConfigIssue[] = [];

  for (let level = 1; level <= REWARD_LEVELS; level++) {
    if (!(level in rewards)) issues.push({ scope: 'LevelRewardConfig', message: `缺少第${level}关的奖励配置` });
  }
  for (const key of Object.keys(rewards)) {
    const level = Number(key);
    if (!Number.isInteger(level) || level < 1 || level > TOTAL_LEVELS) {
      issues.push({ scope: 'LevelRewardConfig', message: `出现非法关卡号 ${key}` });
    }
  }

  const used = new Set<number>();
  for (const [key, imageId] of Object.entries(rewards)) {
    if (imageId < 0 || imageId > MAX_IMAGE_ID_IN_USE) {
      issues.push({ scope: `LevelRewardConfig[${key}]`, message: `rewardImageId ${imageId} 越界（允许 0~${MAX_IMAGE_ID_IN_USE}）` });
    }
    if (used.has(imageId)) {
      issues.push({ scope: `LevelRewardConfig[${key}]`, message: `rewardImageId ${imageId} 被多个关卡重复使用` });
    }
    used.add(imageId);

    const text = imageTexts[imageId];
    if (text === undefined || text.trim() === '') {
      issues.push({ scope: `LevelRewardConfig[${key}]`, message: `图ID ${imageId} 缺少非空文案` });
    }
  }

  return issues;
}

function sameIdSet(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort((x, y) => x - y);
  const sb = [...b].sort((x, y) => x - y);
  return sa.every((v, i) => v === sb[i]);
}

/**
 * 图鉴文案占位表（§10.2 要求 rewardImageId 必须有非空文案）。
 * ⚠️ 文档未给出正式文案，此处为占位，由策划替换；替换前不得上线。
 */
export const IMAGE_TEXT_PLACEHOLDER: Record<number, string> = Object.fromEntries(
  Array.from({ length: MAX_ART_ID + 1 }, (_, i) => [i, `图${i}的文案（占位）`]),
);
