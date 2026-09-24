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
 * ── 数据来源（M9 灰盒）──────────────────────────────────────────────
 *   本文件里的 100 名模拟玩家是**本地确定性数据**，用来在没有后端时把链路跑通：
 *   每个关卡固定同一批人、同一批分数，刷新/重开都一样（便于复现与验收）。
 *   后端接入后只需替换 `mockBoardScores` / `mockBoardNames`，其余全部不用动。
 *
 * ⚠️ 已知的规则后果（2026-09-12 记录，待策划裁决）：
 *   在「100 名模拟玩家 + 本机 1 人 = 101 人」的口径下，
 *   ① 名次 ≤ 100 覆盖了 101 人里的 100 人 → 只要上了榜（≥3★）几乎必得「超神」；
 *   ② 「王者」要求「名次 > 100 且百分比 ≥ 90%」，而名次 > 100 意味着至少 100 人比你高，
 *      于是 percentile ≤ (N-101)/(N-1) —— 要让它 ≥ 90% 必须 N ≥ 1001。
 *      也就是说 **王者档在总玩家数不足 1001 时数学上不可达**。
 *   两条都只是数值门槛的后果，不是代码缺陷；真要修，改的是 `HONOR_RULE`，不是这里。
 */

import { Rng } from './rng';

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
  /** 模拟玩家数（灰盒占位数据源；后端接入后作废） */
  mockPlayers: 100,
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

/** 模拟玩家昵称：10 个前缀 × 10 个后缀 = 100 个不重名的名字 */
const MOCK_NAME_HEAD = ['软糯', '元气', '抱抱', '咕噜', '懒懒', '奶盖', '甜心', '小只', '月光', '薄荷'];
const MOCK_NAME_TAIL = ['布丁', '团子', '豆豆', '柚子', '芝麻', '花卷', '包子', '汤圆', '奶糖', '年糕'];

/** 某关的 100 个模拟玩家昵称（同一关恒定，不同关洗牌不同） */
export function mockBoardNames(level: number): string[] {
  const all: string[] = [];
  for (const head of MOCK_NAME_HEAD) for (const tail of MOCK_NAME_TAIL) all.push(`${head}${tail}`);
  return new Rng(level * 7717 + 131).shuffle(all);
}

/**
 * 某关的 100 个模拟玩家分数。
 *
 * 硬约束（策划）：**全部 ≥ 本关 3★ 线** —— 因为 1★ / 2★ 的成绩根本不上榜，
 * 榜单上不该出现他们。
 *
 * 曲线：以 3★ 线为地板、3★ 线的 1.6 倍为天花板（至少 6 分），
 * 用 `(1 - t)^1.6` 分布 —— 高手稀疏、大多数人贴着地板扎堆，接近真实的天梯形态。
 * 额外叠 ±1 的确定性抖动：制造**并列**，正好用来验证「同分同名次 + 名次跳号 + 并列百名」。
 */
export function mockBoardScores(level: number, line: HonorLines): number[] {
  const star3 = line.star3;
  const span = Math.max(6, Math.round(star3 * 1.6));
  const rng = new Rng(level * 104729 + 17);
  const out: number[] = [];
  for (let i = 0; i < HONOR_RULE.mockPlayers; i++) {
    const t = i / (HONOR_RULE.mockPlayers - 1);
    const curve = Math.pow(1 - t, 1.6);
    const jitter = rng.int(3) - 1;
    out.push(Math.max(star3, star3 + Math.round(span * curve) + jitter));
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

  const all = raw.map((item) => ({
    ...item,
    rank: 1 + raw.reduce((n, other) => (other.score > item.score ? n + 1 : n), 0),
  }));

  // 分数降序；并列时把「我」顶到前面，其余按名字排（保证渲染顺序稳定）
  return all.sort((a, b) => b.score - a.score || Number(b.mine) - Number(a.mine) || a.name.localeCompare(b.name));
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
  const rankScore = onBoard ? input.boardBest : input.line.star1;
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
