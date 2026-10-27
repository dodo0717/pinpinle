/**
 * 后段奖励（2026-10-27 评审 P0-4）：金卡 + 章节宝箱 —— 纯逻辑，零 Cocos 依赖。
 *
 * 两样东西都**从进度派生**，不另存「已领取表」（与图鉴同口径：两份数据一旦分叉就无法自证）。
 *
 * ── 金卡 ─────────────────────────────────────────────────────────────
 *   普通卡：每 10 颗星解锁一张（玩法/meta.ts `unlockedImageIds`，规则不变）。
 *   金卡  ：困难模式每拿到一个关卡的 3★，就把一张**已解锁**的普通卡升成金卡（按图号顺序），
 *          最多 36 张。金框 / 闪光由代码绘制，不需要新出图。
 *          产品确认（2026-10-27）：金卡就是「困难通关的掉落」，不再做碎片合成。
 *
 * ── 章节宝箱 ─────────────────────────────────────────────────────────
 *   简单模式通关（≥1★）第 40 / 45 / 50 / 55 / 60 关各开一个，奖励见 `CHESTS`。
 */

import { recordOf,                   } from './progress.js';

/* ------------------------------------------------------------------ 金卡 */

/** 困难模式拿到 3★ 的关卡数 */
export function hardThreeStarLevels(nightmare              )         {
  let n = 0;
  for (const key of Object.keys(nightmare.levels)) {
    if (recordOf(nightmare, Number(key)).stars >= 3) n++;
  }
  return n;
}

/**
 * 金卡张数 = min(已解锁普通卡张数, 困难 3★ 关数 + bonus)。
 * `bonus`：7 日签到第 7 天送的金卡（核心/retention.ts `bonusGold`），同样只能升级已解锁的卡。
 */
export function goldCardCount(ownedCards        , nightmare              , bonus = 0)         {
  return Math.max(0, Math.min(ownedCards, hardThreeStarLevels(nightmare) + Math.max(0, bonus)));
}

/** 已升金的图 ID：已解锁卡（按图号升序）里的前 N 张 */
export function goldCardIds(ownedIds                   , nightmare              , bonus = 0)           {
  const sorted = ownedIds.slice().sort((a, b) => a - b);
  return sorted.slice(0, goldCardCount(sorted.length, nightmare, bonus));
}

/* ------------------------------------------------------------------ 章节宝箱 */

                                            
                                       

                              
                         
                
                    
               
                        
                
                 
               
                        
 

export const CHESTS                         = [
  { level: 40, name: '头像框「萌宠新星」', frame: 'star' },
  { level: 45, name: '对局皮肤「糖果嘉年华」', skin: 'candy' },
  { level: 50, name: '称号「拼图达人」+ 体力上限 +2', title: '拼图达人', staminaBonus: 2 },
  { level: 55, name: '对局皮肤「果冻乐园」', skin: 'clean' },
  { level: 60, name: '头像框「终极拼王」', frame: 'king' },
];

/** 体力上限加成的最大可能值（存档校验的上限要算上它） */
export const MAX_STAMINA_BONUS = CHESTS.reduce((s, c) => s + (c.staminaBonus ?? 0), 0);

/** 已开的宝箱（按关卡升序） */
export function openedChests(normal              )                {
  return CHESTS.filter((c) => recordOf(normal, c.level).stars >= 1);
}

/** 某关是不是宝箱关 */
export function chestOfLevel(level        )                          {
  return CHESTS.find((c) => c.level === level);
}

/** 已拥有的全部奖励汇总（资料页 / 皮肤选择 / 体力上限用） */
                               
                          
                  
                   
                       
 

export function ownedRewards(normal              )               {
  const out               = { frames: [], skins: [], titles: [], staminaBonus: 0 };
  for (const c of openedChests(normal)) {
    if (c.frame) out.frames.push(c.frame);
    if (c.skin) out.skins.push(c.skin);
    if (c.title) out.titles.push(c.title);
    out.staminaBonus += c.staminaBonus ?? 0;
  }
  return out;
}

/**
 * 一次结算新拿到了什么：比较结算前后两份进度。
 * `ownedBefore` / `ownedAfter` = 结算前后的已解锁普通卡张数（由调用方用 meta.ts 算好传进来）。
 */
export function newlyEarned(
  before                                                                  ,
  after                                                                  ,
)                                          {
  const gold = goldCardCount(after.owned, after.nightmare) - goldCardCount(before.owned, before.nightmare);
  const had = new Set(openedChests(before.normal).map((c) => c.level));
  return { gold: Math.max(0, gold), chests: openedChests(after.normal).filter((c) => !had.has(c.level)) };
}
