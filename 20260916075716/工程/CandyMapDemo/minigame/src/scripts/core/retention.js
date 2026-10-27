/**
 * 回访系统（2026-10-27 评审 P1-6）—— 纯逻辑，零 Cocos / 零存储依赖。
 *
 *   7 日签到 ：每天领一次；**断签不清零**，只是不连续（第 N 天的奖励按累计签到天数轮转，7 天一轮）。
 *   每日挑战 ：每天一关，日期作种子固定开局（所有人同一盘）；不耗体力，每天最多 3 次，
 *             当天首次通关送体力。日榜要服务端，先只记本机「今日最好」。
 *   回流礼包 ：距上次登录 ≥ 3 天再回来，补满体力 + 1 张续命券。
 *   续命券   ：续命时优先用券，不用看广告。
 *
 * 状态整体落进存档 `meta.retention`（save.ts 负责校验 / 老存档补默认值）。
 */

/* ------------------------------------------------------------------ 状态 */

                                 
                      
                      
                                        
                         
                    
                   
                
                     
                          
                        
                    
                    
                              
                       
              
                        
                                                             
                    
 

export function createRetention()                 {
  return {
    checkinDays: 0,
    lastCheckinDay: '',
    dailyDay: '',
    dailyPlays: 0,
    dailyCleared: false,
    dailyBest: 0,
    lastLoginDay: '',
    reviveTickets: 0,
    bonusGold: 0,
  };
}

/* ------------------------------------------------------------------ 日期 */

export function dayKeyOf(now        )         {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 两个日期键相差几天（b − a）；任一为空返回 null */
export function daysBetween(a        , b        )                {
  if (!a || !b) return null;
  const pa = Date.parse(`${a}T00:00:00`);
  const pb = Date.parse(`${b}T00:00:00`);
  if (!Number.isFinite(pa) || !Number.isFinite(pb)) return null;
  return Math.round((pb - pa) / 86_400_000);
}

/* ------------------------------------------------------------------ 签到 */

                                
                   
                         
                
 

/** 7 天一轮的奖励表（第 7 天大奖：金卡 1 张 + 3 体力） */
export const CHECKIN_REWARDS                           = [
  { stamina: 2 },
  { stamina: 2 },
  { reviveTickets: 1 },
  { stamina: 3 },
  { stamina: 3 },
  { reviveTickets: 1 },
  { gold: 1, stamina: 3 },
];

/** 今天还能不能签 */
export function canCheckin(s                , now        )          {
  return s.lastCheckinDay !== dayKeyOf(now);
}

/** 下一次签到是本轮第几天（1~7） */
export function nextCheckinIndex(s                )         {
  return (s.checkinDays % CHECKIN_REWARDS.length) + 1;
}

/**
 * 签到：返回本次奖励（已签过返回 null）。
 * 体力由调用方发（要走 GS.gainStamina 的上限与落盘）；续命券 / 金卡直接记进状态。
 */
export function checkin(s                , now        )                                                {
  if (!canCheckin(s, now)) return null;
  const day = nextCheckinIndex(s);
  const reward = CHECKIN_REWARDS[day - 1] ;
  s.checkinDays += 1;
  s.lastCheckinDay = dayKeyOf(now);
  s.reviveTickets += reward.reviveTickets ?? 0;
  s.bonusGold += reward.gold ?? 0;
  return { day, reward };
}

/* ------------------------------------------------------------------ 每日挑战 */

export const DAILY_MAX_PLAYS = 3;
/** 当天首次通关送几颗体力 */
export const DAILY_CLEAR_STAMINA = 2;

/** 跨天归零（每次读状态前调用） */
export function rollDaily(s                , now        )       {
  const key = dayKeyOf(now);
  if (s.dailyDay === key) return;
  s.dailyDay = key;
  s.dailyPlays = 0;
  s.dailyCleared = false;
  s.dailyBest = 0;
}

export function dailyPlaysLeft(s                , now        )         {
  rollDaily(s, now);
  return Math.max(0, DAILY_MAX_PLAYS - s.dailyPlays);
}

/** 日期 → 种子（同一天所有人同一盘）；FNV-1a */
export function dailySeed(day        )         {
  let h = 0x811c9dc5;
  for (let i = 0; i < day.length; i++) {
    h ^= day.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h || 1;
}

/**
 * 今天的挑战关卡：从第 4~30 关（3×4 后段到 4×4 中段，难度适中）里按日期轮换。
 * 不随玩家进度变：所有人同一关同一盘，日榜才有意义。
 */
export const DAILY_LEVEL_RANGE                            = [4, 30];

export function dailyLevel(day        )         {
  const [lo, hi] = DAILY_LEVEL_RANGE;
  return lo + (dailySeed(day) % (hi - lo + 1));
}

/** 开一局：返回是否允许（次数用完 false） */
export function startDailyPlay(s                , now        )          {
  if (dailyPlaysLeft(s, now) <= 0) return false;
  s.dailyPlays += 1;
  return true;
}

/** 一局结束：记最好成绩；返回「是不是今天第一次通关」（调用方据此发体力） */
export function finishDailyPlay(s                , now        , cleared         , points        )          {
  rollDaily(s, now);
  s.dailyBest = Math.max(s.dailyBest, Math.max(0, Math.floor(points)));
  if (!cleared || s.dailyCleared) return false;
  s.dailyCleared = true;
  return true;
}

/* ------------------------------------------------------------------ 回流 */

/** 距上次登录多少天算「回流」 */
export const COMEBACK_DAYS = 3;

/**
 * 登录打点：返回是不是回流（≥ COMEBACK_DAYS 天没来）。回流时发 1 张续命券，体力补满由调用方做。
 * 同一天多次启动只算一次。
 */
export function onLogin(s                , now        )                        {
  const today = dayKeyOf(now);
  const gap = daysBetween(s.lastLoginDay, today);
  s.lastLoginDay = today;
  if (gap === null || gap < COMEBACK_DAYS) return { comeback: false };
  s.reviveTickets += 1;
  return { comeback: true };
}

/* ------------------------------------------------------------------ 续命券 */

export function useReviveTicket(s                )          {
  if (s.reviveTickets <= 0) return false;
  s.reviveTickets -= 1;
  return true;
}
