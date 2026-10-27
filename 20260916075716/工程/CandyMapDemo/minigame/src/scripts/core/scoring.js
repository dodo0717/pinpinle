/**
 * 排行分（2026-10-27 评审 P1-1）—— 纯逻辑，零 Cocos 依赖。
 *
 * 为什么另起一套「分」：引擎每消一组 +1（`engine.score`，下文叫「组数」），单关最高十来分，
 * 排行榜大量同分，手速好坏体现不出来。所以把两件事拆开：
 *   - **判星**仍按组数 + 三条星线（星线、逐关时长都不用重标定）；
 *   - **排行分**（points）= 每消一组 `base` 分 + 速度分，用于个人最高分 / 关卡榜 / 总榜。
 *
 * 速度分 = max(0, speedMax − speedStep × 距上次消除的秒数)，第一组从开表算起。
 * 「秒数」用倒计时剩余秒数之差（暂停、动画期间倒计时不走，也就不计），断点恢复接得上；
 * 续命 +60 秒时把基准一起抬 60（`onRevive`），否则续命后第一组会白拿满额速度分。
 *
 * ⚠️ 评审初稿里的「连锁倍率」与「剩余时间奖励」已经产品确认去掉：引擎每次移动最多消 1 组、
 * 补位后不会自动成组（HC-01 / HC-02），不存在连锁；每局都打满倒计时，剩余时间恒为 0。
 *
 * 困难模式的 ×1.5 不在单局里乘：总积分已经加权（`rank.ts` `totalScore` / 服务端
 * `ProgressMerge.weightedTotal`），关卡榜又按模式分开，单局再乘就成了重复加权。
 */

export const SCORE_RULE = {
  /** 每消一组的基础分 */
  base: 100,
  /** 速度分上限（与上一组间隔 0 秒时） */
  speedMax: 60,
  /** 间隔每多 1 秒扣多少速度分 → 6 秒及以上为 0 */
  speedStep: 10,
}         ;

/**
 * 老数据换算系数：2026-10-27 之前所有「分」都是组数，迁移时 × 本值
 * （只算基础分、不送速度分 —— 老玩家不吃亏也不白赚）。
 */
export const LEGACY_POINTS_PER_GROUP = SCORE_RULE.base;

/** 一次消除得多少排行分；`intervalSec` = 距上次消除（或开表）的秒数 */
export function pointsForElimination(intervalSec        )         {
  const sec = Math.max(0, Math.floor(intervalSec));
  return SCORE_RULE.base + Math.max(0, SCORE_RULE.speedMax - SCORE_RULE.speedStep * sec);
}

/** 组数 → 排行分的保底换算（老存档迁移、示例数据、星线换算成分数线） */
export function pointsOfGroups(groups        )         {
  return Math.max(0, Math.floor(groups)) * LEGACY_POINTS_PER_GROUP;
}

/** 一局的计分器：只有两个数，整体落进局内断点 */
                              
                
                 
                            
                       
 

export function createTally(timeLimit        )              {
  return { points: 0, lastTimeLeft: timeLimit };
}

/** 记一次消除；`timeLeft` = 此刻倒计时剩余秒数。返回本次得分（飘字用） */
export function addElimination(tally             , timeLeft        )         {
  const gained = pointsForElimination(tally.lastTimeLeft - timeLeft);
  tally.points += gained;
  tally.lastTimeLeft = timeLeft;
  return gained;
}

/** 续命加时：基准跟着抬，保证「间隔」仍是真实玩过的秒数 */
export function onRevive(tally             , addedSec        )       {
  tally.lastTimeLeft += addedSec;
}
