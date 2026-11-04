/**
 * M9 · 通关荣誉与百名榜（纯逻辑，零 DOM / 零存储依赖）
 *
 * 权威依据：策划《通关及排名》（2026-09-12 版）§2 统计口径 / §三 档位判定 / §四 边界情况。
 *
 * 为什么单独一个文件：档位判定是**纯数学**（名次 + 百分比），但它决定了结算弹窗长什么样、
 * 按钮怎么排、埋点什么。把它和界面分开之后，三个档位可以在单测里被完整覆盖 ——
 * 而不是靠「打一局看看弹的是哪个档」。
 *
 * 三档（优先级从高到低）：
 *   超神 god  —— 总分 > 100 且名次 ≤ 100（进了百强）
 *   王者 king —— 没进百强，但百分比 ≥ 90%
 *   优秀 pass —— 其余
 *
 * ── 统计口径（§2）────────────────────────────────────────────────────
 *   totalPlayers = 本关总玩家数（去重）
 *   lowerCount   = 分数**低于**本次得分的玩家数
 *   sameCount    = 分数**等于**本次得分的玩家数（含自己）
 *   higherCount  = totalPlayers - lowerCount - sameCount
 *   rank         = higherCount + 1                （同分同名次 → 名次会跳号）
 *   percentile   = lowerCount / (totalPlayers - 1)（totalPlayers ≤ 1 时为 0）
 *
 * ── 数据来源（M9 灰盒 / 基石数据）──────────────────────────────────────
 *   本文件里的 **1000 名模拟玩家是基石数据**（2026-11-03 用户决定：扩到 1000 位，当作后端接入前的底座）：
 *   本地确定性生成，每个关卡固定同一批人、同一批分数，刷新/重开都一样（便于复现与验收）。
 *   后端接入后只需替换 `mockBoardScores` / `mockBoardNames`，其余全部不用动。
 *
 * ── AI 角色分数口径（2026-11-03 用户定稿，替代原先「随手随机」的假数据）──────
 *   · 先给每个角色每关一个**总分**（`mockBoardScores`，地板 3★、天花板 1.6×3★）；
 *   · 再把总分拆两列：**简单分 = 总分 × 60%~80%（确定性随机）**，**困难分 = 总分 − 简单分**
 *     （`mockSplitOf`）。两列都 > 0 —— 这是用户明确要的口径，不是历史那个「按 0.6/0.4
 *     硬拆本机真实分」的 bug（那个拆的是**玩家自己的成绩**，这里拆的是 AI 的模拟数据）；
 *   · AI 分数**只配置到第 66 关**（`AI_SCORE_MAX_LEVEL`），67 关及以后不再造 AI 分数 ——
 *     榜单只有本机玩家（空榜显示「暂无记录」），排名/百分比也按「场上只有我」计算。
 *
 * ── 人口口径对档位的影响（2026-11-03 更新）──────────────────────────────
 *   总玩家数 = 1000 名模拟玩家 + 本机 1 人 = **1001 人**，于是：
 *   ① 「超神」要求 名次 ≤ 100 且 总人数 > 100 → 进前 100 名才算（1001 人里前 ~10%），不再"上榜即超神"；
 *   ② 「王者」要求 名次 > 100 且 百分比 ≥ 90% → 名次 101~200 这一段正好落入（数学上可达了，
 *      这正是 2026-09-12 记录的「N < 1001 时王者不可达」那条后果被 1000 人口径修掉的原因）；
 *   ③ 名次 > 100 且 百分比 < 90% → 「优秀」。
 *   ⚠️ 分数是整数、天花板仍是 3★线 ×1.6，所以 1001 人里顶端必然大量并列 —— 这是真实天梯形态，
 *      不是 bug（并列名次会跳号，见 §四）。
 */

import { Rng } from './rng';
import { pointsOfGroups } from './scoring';

/* ------------------------------------------------------------------ 类型与常量 */

/** 荣誉档位 */
export type HonorTier = 'god' | 'king' | 'pass';

/** 一关的三条星线（与 `LevelConfig` 同形，这里只取需要的三个数） */
export interface HonorLines {
  star1: number;
  star2: number;
  star3: number;
}

/**
 * 荣誉规则常量 —— **策划调参的唯一入口**。
 *
 * 这几个数字全部来自策划案，集中放在这里是为了「改数值不用翻代码」。
 */
export const HONOR_RULE = {
  /** 模拟玩家数（基石数据源，2026-11-03 由 100 扩到 1000；后端接入后作废） */
  mockPlayers: 1000,
  /** 上榜门槛星级：1★ / 2★ 与续命局一样**不上排行榜** */
  boardStars: 3,
  /** 百强榜的名次上限 */
  boardRankMax: 100,
  /** 「超神」还要求本关总玩家数**超过**这个数 */
  godMinPlayers: 100,
  /** 「王者」要求超越的玩家比例（%） */
  kingPercentile: 90,
} as const;

/** 本机玩家在榜上的名字（真实昵称接入后替换） */
export const MY_BOARD_NAME = '我';

/**
 * AI 角色分数**配置到第几关为止**（2026-11-03 用户：66 关之后不用设计 AI 分数）。
 *
 * 67 关及以后 `mockBoardScores` 返回空数组 —— 榜单里没有 AI 角色，
 * 玩家就是本关唯一的参赛者（百分比 0、名次 1，自然落进「优秀」档）。
 */
export const AI_SCORE_MAX_LEVEL = 66;

/** 本关是否配置了 AI 分数（关卡榜/结算排名都要先问一句，否则 67+ 关会凭空多出 1000 个对手） */
export function hasAiScores(level: number): boolean {
  return Number.isFinite(level) && level >= 1 && level <= AI_SCORE_MAX_LEVEL;
}

/**
 * AI 角色简单分占总分的比例区间（%），含两端 —— 用户口径 60%~80%。
 *
 * 剩下那部分**全部算困难分**：`hard = total - simple`，不另做一次随机，
 * 以保证「简单 + 困难 = 总分」这两列永远自洽。
 */
export const MOCK_SIMPLE_RATIO = { min: 60, max: 80 } as const;

/** AI 角色单关成绩的两列拆分 */
export interface MockSplit {
  /** 简单分 = 总分 × 60%~80%（四舍五入） */
  simple: number;
  /** 困难分 = 总分 − 简单分 */
  hard: number;
  /** 该关总分（= simple + hard） */
  total: number;
}

function hashNameSeed(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h;
}

/**
 * 把某个 AI 角色**单关的总分**拆成简单 / 困难两列（用户口径 2026-11-03）。
 *
 * 随机必须**确定性**：种子 = 关号 + 昵称哈希，所以同一关同一个角色每次打开都是同一个比例，
 * 不会出现「刷新一次排名就变了」。比例均匀落在 60~80（21 档）。
 */
export function mockSplitOf(level: number, name: string, total: number): MockSplit {
  const rng = new Rng((hashNameSeed(name) ^ (level * 7717 + 131)) >>> 0);
  const stations = MOCK_SIMPLE_RATIO.max - MOCK_SIMPLE_RATIO.min + 1; // 21 档：60..80
  const ratio = MOCK_SIMPLE_RATIO.min + rng.int(stations);
  const simple = Math.round((total * ratio) / 100);
  return { simple, hard: total - simple, total };
}

/* ------------------------------------------------------------------ 统计口径（§2） */

export interface HonorStats {
  totalPlayers: number;
  lowerCount: number;
  sameCount: number;
  higherCount: number;
  /** 名次（同分同名次，名次会跳号） */
  rank: number;
  /** 超越了百分之多少的玩家（0~100） */
  percentile: number;
}

/**
 * 按 §2 的公式统计名次与百分比。
 *
 * `scores` 是**本关全部玩家的分数**（自己已经在里面）；`score` 是本次参与排名的分数。
 */
export function rankStats(scores: readonly number[], score: number): HonorStats {
  let lowerCount = 0;
  let sameCount = 0;
  for (const s of scores) {
    if (s < score) lowerCount++;
    else if (s === score) sameCount++;
  }
  const totalPlayers = scores.length;
  const higherCount = totalPlayers - lowerCount - sameCount;
  return {
    totalPlayers,
    lowerCount,
    sameCount,
    higherCount,
    rank: higherCount + 1,
    percentile: totalPlayers > 1 ? (lowerCount / (totalPlayers - 1)) * 100 : 0,
  };
}

/**
 * 百分比展示文案：保留 1 位小数；**满格不显示 100.0%**（§四：≥99.95% 显示 99.9%）。
 *
 * 用「四舍五入到个位」比较而不是 `>= 99.95`，是为了绕开浮点误差
 * （99.95 在 IEEE754 里可能是 99.949999…，直接比会漏判）。
 */
export function percentileText(percentile: number): string {
  const clamped = Math.max(0, Math.min(100, percentile));
  if (Math.round(clamped * 10) >= 1000) return '99.9';
  return clamped.toFixed(1);
}

/* ------------------------------------------------------------------ 档位判定（§三 / §四） */

/**
 * 判定档位。**顺序即优先级**：先看超神，再看王者，剩下的都是优秀。
 *
 * ⚠️ 档位只由「名次 + 百分比」决定，**与星级无关** —— 星级只影响优秀档的星星图标。
 */
export function honorOf(stats: HonorStats): HonorTier {
  if (stats.totalPlayers > HONOR_RULE.godMinPlayers && stats.rank <= HONOR_RULE.boardRankMax) {
    return 'god';
  }
  if (stats.percentile >= HONOR_RULE.kingPercentile) return 'king';
  return 'pass';
}

/* ------------------------------------------------------------------ 灰盒数据源 */

/**
 * 模拟玩家昵称池：**40 个前缀 × 25 个后缀 = 1000 个不重名的名字**（`mockPlayers` 必须等于它）。
 * ⚠️ 组合唯一性靠「前缀之间两两不同 且 后缀之间两两不同」保证，改池子时先数一遍乘积。
 */
const MOCK_NAME_HEAD = [
  '软糯', '元气', '抱抱', '咕噜', '懒懒', '奶盖', '甜心', '小只', '月光', '薄荷',
  '棉花', '草莓', '云朵', '橘子', '闪亮', '圆滚', '毛球', '桃子', '可可', '海盐',
  '月牙', '星星', '雪球', '蜂蜜', '抹茶', '珍珠', '樱桃', '葡萄', '柠檬', '奶油',
  '焦糖', '麦芽', '果冻', '奶泡', '爱睡', '粘人', '撒娇', '贪吃', '好奇', '发呆',
];
const MOCK_NAME_TAIL = [
  '布丁', '团子', '豆豆', '柚子', '芝麻', '花卷', '包子', '汤圆', '奶糖', '年糕',
  '蛋糕', '卷卷', '球球', '圆圆', '软软', '糖糖', '小喵', '小汪', '兔兔', '熊熊',
  '饼饼', '果果', '酱酱', '丸丸', '啵啵',
];

/** 某关的 1000 个模拟玩家昵称（同一关恒定，不同关洗牌不同） */
export function mockBoardNames(level: number): string[] {
  const all: string[] = [];
  for (const head of MOCK_NAME_HEAD) for (const tail of MOCK_NAME_TAIL) all.push(`${head}${tail}`);
  return new Rng(level * 7717 + 131).shuffle(all);
}

/**
 * 某关的 1000 个模拟玩家分数（基石数据）。
 *
 * 硬约束（策划）：**全部 ≥ 本关 3★ 线** —— 因为 1★ / 2★ 的成绩根本不上榜，
 * 榜单上不该出现他们；天花板仍是 3★ 线的 1.6 倍（不擅自抬高）。
 *
 * 曲线：以 3★ 线为地板、3★ 线的 1.6 倍为天花板（至少 6 分），
 * 用 `(1 - t)^1.6` 分布 —— 高手稀疏、大多数人贴着地板扎堆，接近真实的天梯形态。
 * 额外叠 ±3 的确定性抖动：1000 人时 ±1 会让「每档分数」扎上千人，
 * 扩到 ±3 把并列密度降到合理范围，同时仍能验证「同分同名次 + 名次跳号 + 并列百名」。
 *
 * ⚠️ 这里给的是**总分**（关卡榜那一列「总分」）；简单/困难两列由
 * `mockSplitOf(level, name, total)` 按 60%~80% 现拆，别在别处再拆一次。
 * ⚠️ `level > AI_SCORE_MAX_LEVEL`（第 67 关起）返回**空数组**：用户要求后面不再设计 AI 分数。
 */
export function mockBoardScores(level: number, line: HonorLines): number[] {
  if (!hasAiScores(level)) return [];
  const star3 = line.star3;
  const span = Math.max(6, Math.round(star3 * 1.6));
  const rng = new Rng(level * 104729 + 17);
  const out: number[] = [];
  for (let i = 0; i < HONOR_RULE.mockPlayers; i++) {
    const t = i / (HONOR_RULE.mockPlayers - 1);
    const curve = Math.pow(1 - t, 1.6);
    const jitter = rng.int(7) - 3;
    const groups = Math.max(star3, star3 + Math.round(span * curve) + jitter);
    // 合并 main 时统一单位（2026-11-04）：玩家的最高分已是排行分（每组 100 + 速度分，scoring.ts），
    // AI 分数也换成同一单位，否则玩家永远第 1 名。组数仍 ≥ 3★ 线，曲线与 1000 人口径不变。
    out.push(pointsOfGroups(groups) + rng.int(groups * 30 + 1));
  }
  return out;
}

/* ------------------------------------------------------------------ 榜单 */

export interface BoardEntry {
  rank: number;
  name: string;
  score: number;
  /** 是不是本机玩家 */
  mine: boolean;
}

export interface BoardSnapshot {
  level: number;
  /** 本关总玩家数（去重：模拟玩家 + 本机） */
  totalPlayers: number;
  /** 百强榜条目（`rank ≤ 100`，**含并列**，所以可能多于 100 条） */
  rows: BoardEntry[];
  /** 我的名次；`null` = 没上榜 */
  myRank: number | null;
  /** 我在榜上的最高分；`0` = 没上榜 */
  myBoardBest: number;
}

/**
 * 生成的原始名次表（未截断到百强）。
 *
 * 名次 = 分数严格高于自己的人 + 1；同分同名次，因此名次会跳号
 * （策划 §三：第 100 名允许并列，若因此导致第 100 名空缺，下一位就是第 101 名）。
 */
function rankedEntries(level: number, line: HonorLines, myBoardBest: number): BoardEntry[] {
  const names = mockBoardNames(level);
  const scores = mockBoardScores(level, line);
  const raw: Array<{ name: string; score: number; mine: boolean }> = scores.map((score, i) => ({
    name: names[i]!,
    score,
    mine: false,
  }));
  if (myBoardBest > 0) raw.push({ name: MY_BOARD_NAME, score: myBoardBest, mine: true });

  // 分数降序；并列时把「我」顶到前面，其余按名字排（保证渲染顺序稳定）
  const sorted = raw.sort(
    (a, b) => b.score - a.score || Number(b.mine) - Number(a.mine) || a.name.localeCompare(b.name),
  );

  // 名次 = 分数**严格高于**自己的人数 + 1（同分同名次 → 名次跳号）。
  // ⚠️ 1000 人时不能再用「每项扫全表」的 O(n²) 写法：排序后单趟即可，
  //    分数一降档就把名次设成当前下标 +1，与旧口径逐值等价（并列者仍是同一个名次）。
  let rank = 1;
  return sorted.map((item, i) => {
    if (i > 0 && item.score < sorted[i - 1]!.score) rank = i + 1;
    return { ...item, rank };
  });
}

/** 本关百名榜快照（排行榜页用） */
export function boardSnapshot(level: number, line: HonorLines, myBoardBest: number): BoardSnapshot {
  const all = rankedEntries(level, line, myBoardBest);
  const rows = all.filter((entry) => entry.rank <= HONOR_RULE.boardRankMax);
  const mine = all.find((entry) => entry.mine);
  return {
    level,
    totalPlayers: all.length,
    rows,
    myRank: mine ? mine.rank : null,
    myBoardBest: myBoardBest > 0 ? myBoardBest : 0,
  };
}

/* ------------------------------------------------------------------ 结算用的荣誉结论 */

export interface HonorInput {
  level: number;
  line: HonorLines;
  /** 本局实际得分（弹窗上「本关得分」显示的就是它） */
  score: number;
  /** 本局星级（续命局按 §7.4 恒为 1） */
  stars: number;
  /** 本局是否用过续命 */
  revived: boolean;
  /** 本关**已经更新过**的上榜最高分（0 = 没上榜） */
  boardBest: number;
}

export interface HonorOutcome {
  tier: HonorTier;
  stars: number;
  /** 本机在榜上的分数（0 = 没上榜） */
  boardBest: number;
  /** 本机本次参与排名的分数 */
  rankScore: number;
  stats: HonorStats;
  /** 王者档文案用的百分比（已格式化） */
  percentText: string;
}

/**
 * 结算用的荣誉结论。
 *
 * **排名基准分**（这是最容易出岔子的一步，§2 要求「先更新历史最高分再统计」）：
 *   - 上了榜（≥3★ 且没续命）→ 用 `boardBest`（**更新后**的历史最高分）。
 *     这样「结算弹窗里的名次」与「排行榜里我的名次」永远是同一个数，
 *     而且自己一定落在 `sameCount` 里 —— 不会出现「自己把自己算成比我高的人」。
 *   - 没上榜（1★ / 2★ / 续命）→ 用 1★ 线（续命局「分数按 1★ 最低要求计分」的同一条规则）。
 *     这些分数一定低于所有模拟玩家，所以百分比是 0，稳定落进优秀档。
 */
export function honorForLevel(input: HonorInput): HonorOutcome {
  const onBoard = input.boardBest > 0;
  const scores = mockBoardScores(input.level, input.line);
  const pool = onBoard ? [...scores, input.boardBest] : scores;
  // 没上榜按 1★ 线计：星线是组数，换成排行分单位再比
  const rankScore = onBoard ? input.boardBest : pointsOfGroups(input.line.star1);
  const stats = rankStats(pool, rankScore);
  return {
    tier: honorOf(stats),
    stars: input.stars,
    boardBest: onBoard ? input.boardBest : 0,
    rankScore,
    stats,
    percentText: percentileText(stats.percentile),
  };
}
