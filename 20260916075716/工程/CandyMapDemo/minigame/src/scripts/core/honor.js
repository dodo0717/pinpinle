/**
 * M9 · 通关荣誉与百名榜（纯逻辑，零 DOM / 零存储依赖）
 *
 * 权威依据：策划《通关及排名》（2026-09-12 版）§2 统计口径 / §三 档位判定 / §四 边界情况。
 *
 * 为什么单独一个文件：档位判定是**纯数学**（名次 + 百分比），但它决定了结算弹窗长什么样、
 * 按钮怎么排、埋点什么。把它和界面分开之后，三个档位可以在单测里被完整覆盖 ——
 * 而不是靠「打一局看看弹的是哪个档」。
 *
 * 三档（优先级从高到低；2026-10-25 改为按名次占比，见 HONOR_RULE）：
 *   超神 god  —— 名次 ≤ 10，或在前 1%
 *   王者 king —— 名次在前 10%
 *   优秀 pass —— 其余（含没上榜的 1★ / 2★ / 续命局）
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

import { BOARD_MIN_STARS } from './progress.js';
import { Rng } from './rng.js';
import { pointsOfGroups } from './scoring.js';

/* ------------------------------------------------------------------ 类型与常量 */

/** 荣誉档位 */
                                                

/** 一关的三条星线（与 `LevelConfig` 同形，这里只取需要的三个数） */
                             
                
                
                
 

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
  /**
   * 2026-10-25 排行榜新规（design/leaderboard-rules.html）：档位改按「名次占比」，人少人多都成立。
   *   超神：名次 ≤ godTopRank（人少时保底），或在前 godTopPct%
   *   王者：名次在前 kingTopPct%
   * 旧规则（超神 = 百强且总人数 > 100、王者 = 超越 ≥ 90%）在 101 人时上榜≈必得超神、
   * 不足 1001 人时王者数学上不可达，已作废。
   */
  godTopRank: 10,
  godTopPct: 1,
  kingTopPct: 10,
}         ;

/** 本机玩家在榜上的名字（真实昵称接入后替换） */
export const MY_BOARD_NAME = '我';

/* ------------------------------------------------------------------ 统计口径（§2） */

                             
                       
                     
                    
                      
                        
               
                           
                     
 

/**
 * 按 §2 的公式统计名次与百分比。
 *
 * `scores` 是**本关全部玩家的分数**（自己已经在里面）；`score` 是本次参与排名的分数。
 */
export function rankStats(scores                   , score        )             {
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
export function percentileText(percentile        )         {
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
export function honorOf(stats            )            {
  const n = Math.max(1, stats.totalPlayers);
  if (stats.rank <= HONOR_RULE.godTopRank || stats.rank <= Math.ceil((n * HONOR_RULE.godTopPct) / 100)) return 'god';
  if (stats.rank <= Math.ceil((n * HONOR_RULE.kingTopPct) / 100)) return 'king';
  return 'pass';
}

/* ------------------------------------------------------------------ 灰盒数据源 */

/** 模拟玩家昵称：10 个前缀 × 10 个后缀 = 100 个不重名的名字 */
const MOCK_NAME_HEAD = ['软糯', '元气', '抱抱', '咕噜', '懒懒', '奶盖', '甜心', '小只', '月光', '薄荷'];
const MOCK_NAME_TAIL = ['布丁', '团子', '豆豆', '柚子', '芝麻', '花卷', '包子', '汤圆', '奶糖', '年糕'];

/** 某关的 100 个模拟玩家昵称（同一关恒定，不同关洗牌不同） */
export function mockBoardNames(level        )           {
  const all           = [];
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
export function mockBoardScores(level        , line            )           {
  const star3 = line.star3;
  const span = Math.max(6, Math.round(star3 * 1.6));
  const rng = new Rng(level * 104729 + 17);
  const out           = [];
  for (let i = 0; i < HONOR_RULE.mockPlayers; i++) {
    const t = i / (HONOR_RULE.mockPlayers - 1);
    const curve = Math.pow(1 - t, 1.6);
    const jitter = rng.int(3) - 1;
    const groups = Math.max(star3, star3 + Math.round(span * curve) + jitter);
    // 2026-10-27 排行分：组数 ×100 + 每组平均 0~30 的速度分（scoring.ts），与真实玩家同一单位
    out.push(pointsOfGroups(groups) + rng.int(groups * 30 + 1));
  }
  return out;
}

/* ------------------------------------------------------------------ 榜单 */

                             
               
               
                
                
                
 

                                
                
                             
                       
                                                 
                     
                          
                        
                           
                      
 

/**
 * 生成的原始名次表（未截断到百强）。
 *
 * 名次 = 分数严格高于自己的人 + 1；同分同名次，因此名次会跳号
 * （策划 §三：第 100 名允许并列，若因此导致第 100 名空缺，下一位就是第 101 名）。
 */
function rankedEntries(level        , line            , myBoardBest        )               {
  const names = mockBoardNames(level);
  const scores = mockBoardScores(level, line);
  const raw                                                        = scores.map((score, i) => ({
    name: names[i] ,
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
export function boardSnapshot(level        , line            , myBoardBest        )                {
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
export function honorForLevel(input            )               {
  // 上不上榜看的是**本局**成绩（≥3★ 且没续命），不是「这关历史上上过榜」——
  // 否则以前 3★ 上过榜的关，这次续命或 1★ 通关也会被判成超神
  const onBoard = !input.revived && input.stars >= BOARD_MIN_STARS && input.boardBest > 0;
  const scores = mockBoardScores(input.level, input.line);
  const pool = onBoard ? [...scores, input.boardBest] : scores;
  // 没上榜按 1★ 线计：星线是组数，换成排行分单位再比
  const rankScore = onBoard ? input.boardBest : pointsOfGroups(input.line.star1);
  const stats = rankStats(pool, rankScore);
  return {
    // 没上榜（1★ / 2★ / 续命局）恒为优秀：它们不参加排名，名次只是参考值
    tier: onBoard ? honorOf(stats) : 'pass',
    stars: input.stars,
    boardBest: onBoard ? input.boardBest : 0,
    rankScore,
    stats,
    percentText: percentileText(stats.percentile),
  };
}
