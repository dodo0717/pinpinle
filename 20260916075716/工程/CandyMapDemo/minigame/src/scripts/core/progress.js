/**
 * M4 · 关卡进度与结算规则层（纯逻辑，零 DOM / 零 Cocos 依赖）
 *
 * 为什么单独一个文件：M4 的**界面**只做一次（在 Cocos 里，见灰盒验收后的路线），
 * 但「几分算几星、时间归零算不算通关、续命之后判几星、最高分记哪个、什么时候解锁
 * 下一关、体力的预扣怎么退」这些规则必须能脱离 UI 单测 —— 与 M2 的算法层同理。
 *
 * 权威依据：《策划案V10》§7.2 / §7.3.3 / §7.4 / §12.1.1~§12.1.4 / §12.2 / §12.3 / §12.4。
 */

                                         
import { RELEASE } from './release.js';

/* ------------------------------------------------------------------ 类型 */

/** 关卡状态（§7.3.3）：未解锁 / 已解锁未通关 / 已通关 */
                                                            

/** 结算弹窗的 4 种形态（§12.1.1 ~ §12.1.4） */
                                                                                     

/** 一关的历史记录 */
                              
                   
                
                    
                       
     
                       
    
                                              
                                                          
    
                                              
                                               
                                                   
     
                    
     
                                                          
                                                       
                                                              
     
                    
 

/**
 * 一次结算的输入（由界面在关卡结束时收集）。
 *
 * ⚠️ **这里没有「结束原因」字段，是刻意的**：关卡结束**只有一个原因 —— 倒计时归零**（§7.2），
 * 所以「怎么结束的」不该出现在结算契约里。2026-09-11 之前曾有一个 `timedOut` 字段
 * （用来区分「时间归零」与「图全部消完」两种结束原因），但第二种原因并不存在
 * （图池无限补位、棋盘不可能消完），该字段也从未被任何逻辑读取 —— 留着它只会诱导
 * 别人再往里塞第二种结束条件。来龙去脉见《开发计划》§15.6 第 11 条。
 */
                               
                
                
                                           
                
                
                
                 
                   
 

/** 一次结算的结论（界面据此决定弹窗形态与按钮） */
                                  
                       
                          
                
                                                 
                         
                              
                      
 

/** 一个模式下的全部进度 */
                               
                 
                                
                   
                   
                                      
 

/* ------------------------------------------------------------------ 星级 */

/** 按三条星线把得分折算成 0~3 星（0 = 没够到 1★ 线） */
export function starsFor(score        , star1        , star2        , star3        )         {
  if (score >= star3) return 3;
  if (score >= star2) return 2;
  if (score >= star1) return 1;
  return 0;
}

/**
 * 上榜门槛星级（《通关及排名》2026-09-12）。
 *
 * 1★ / 2★ 的成绩**不上排行榜** —— 与续命局同一条口径，
 * 所以榜单上只有 3★ 及以上的人（荣誉弹窗也只在 ≥3★ 时才可能给超神/王者）。
 */
export const BOARD_MIN_STARS = 3;

/** 这次成绩够不够上榜（未续命 且 ≥ 3★） */
export function boardEligible(outcome              , stars         )          {
  const finalStars = stars ?? starsFor(outcome.score, outcome.star1, outcome.star2, outcome.star3);
  return !outcome.revived && finalStars >= BOARD_MIN_STARS;
}

/**
 * 判定一次关卡结束。
 *
 * 规则：
 *   1. 得分没够到 1★ 线 → **未通关**，返回 `null`（界面走失败结算 §12.2）；
 *      续命也没救回来同样是失败，不能因为「看广告了」就算过。
 *   2. 续命局按实际分数判星，**最高 2★**（2026-10-27 评审 P1-8，原 §7.4「统一判 1 星」作废）：
 *      看了广告不该被罚，但 3★ 必须一命通关；续命局仍不上排行榜。
 *   3. 只有**首次**通关才解锁下一关（§7.3.3）；重复挑战不改变关卡进度。
 *
 * ⚠️ 2026-09-12 修订（《通关及排名》）：删掉了 `showNext` 字段。
 * 旧规则「重复通关不显示下一关」（§12.1.2 / §12.1.4）**已被新案覆盖** ——
 * 荣誉弹窗三档都提供「下一关」，重复通关同样弹出，所以「显不显示下一关」
 * 不再由结算结论决定，界面按「本关是不是最后一关」自己判断即可。
 *
 * ⚠️ 判星**只看分数与三条星线**：§7.2 没有「达标立即通关」，玩家玩满 180 秒，
 * 打出多少分就按多少分判星 —— **分数可以超过本关图数**（图池是无限补位的），
 * 不存在任何形式的分数上限。
 */
export function settleLevel(
  outcome              ,
  before              ,
)                         {
  const raw = starsFor(outcome.score, outcome.star1, outcome.star2, outcome.star3);
  if (raw === 0) return null;

  // 2026-10-27 评审 P1-8：续命局按实际分数判星、上限 2★（3★ 必须一命通关）；仍不上榜
  const stars = outcome.revived ? Math.min(raw, REVIVED_MAX_STARS) : raw;
  const firstClear = (before?.stars ?? 0) === 0;
  const kind                 = firstClear
    ? outcome.revived
      ? 'first-revived'
      : 'first'
    : outcome.revived
      ? 'repeat-revived'
      : 'repeat';

  // 首次 3★ 返还 1 颗体力：只看「以前没拿过 3★」，续命局到不了 3★ 自然不返
  const refundStamina = stars >= 3 && (before?.stars ?? 0) < 3;
  return { kind, stars, unlockNext: firstClear, refundStamina };
}

/** 续命局的星级上限（评审 P1-8） */
export const REVIVED_MAX_STARS = 2;

/** 把一次结算写进记录（不修改入参） */
export function applySettlement(
  before                         ,
  outcome              ,
  settlement                 ,
)              {
  const rec              = before ?? { stars: 0, personalBest: 0, boardBest: 0, validBest: 0 };
  const prevValid = typeof rec.validBest === 'number' ? rec.validBest : rec.personalBest;
  return {
    stars: Math.max(rec.stars, settlement.stars),
    personalBest: Math.max(rec.personalBest, outcome.score),
    // 续命局不上榜（§7.4）；1★ / 2★ 同样不上榜（《通关及排名》2026-09-12）
    boardBest: boardEligible(outcome, settlement.stars)
      ? Math.max(rec.boardBest, outcome.score)
      : rec.boardBest,
    // 有效成绩：未续命（能走到这里已保证 ≥1★）
    // 老记录没有 validBest（commitSettlement 直接传 data.levels[x]，不经 recordOf 迁移）→ 按个人最高分兜底
    validBest: outcome.revived ? prevValid : Math.max(prevValid, outcome.score),
  };
}

/* ------------------------------------------------------------------ 进度 */

/**
 * 出厂就解锁的关卡数（2026-10-24：用户要求第 2/3/4 关默认可玩，三套对局主题对比用）。
 * 读档时也按它兜底（2026-10-26：老存档 unlocked=2 的真机只显示 1、2 关）。
 * 取值由发布口径决定（`release.ts`：测试 4 / 正式 1）；服务端 sys_config
 * `game.level.initialUnlocked` 要同步改（见 docs/上线核对清单.md）。
 */
export const INITIAL_UNLOCKED = RELEASE.initialUnlocked;

export function createProgress(mode          )               {
  return { mode, unlocked: INITIAL_UNLOCKED, levels: {} };
}

/** 查询关卡状态（§7.3.3） */
export function levelStatus(data              , level        )              {
  if ((data.levels[level]?.stars ?? 0) > 0) return 'cleared';
  return level <= data.unlocked ? 'unlocked' : 'locked';
}

/** 取某关记录（没有就返回全 0，调用方不用到处判空） */
export function recordOf(data              , level        )              {
  const r = data.levels[level];
  if (!r) return { stars: 0, personalBest: 0, boardBest: 0, validBest: 0 };
  // 内存里可能还有没经过 save.ts 迁移的老记录（云同步合并出来的等）：缺字段按个人最高分兜底
  return typeof r.validBest === 'number' ? r : { ...r, validBest: r.personalBest };
}

/**
 * 结算后写回进度（不修改入参）。
 *
 * `unlocked` **只增不减**：重复挑战低关卡不会把已解锁的关卡收回去。
 */
export function commitSettlement(
  data              ,
  outcome              ,
  settlement                 ,
  totalLevels        ,
)               {
  const record = applySettlement(data.levels[outcome.level], outcome, settlement);
  const unlocked = settlement.unlockNext
    ? Math.min(totalLevels, Math.max(data.unlocked, outcome.level + 1))
    : data.unlocked;
  return { ...data, unlocked, levels: { ...data.levels, [outcome.level]: record } };
}

/* ------------------------------------------------------------------ 体力（§12.4 入场计费） */

/**
 * 体力上限（§13.1）。20 分钟恢复 1 颗的计时由 M5 补，这里只管入场计费的三步。
 *
 * 2026-09-17 由 5 提到 10（产品口径）：0 → 回满 10 颗需 200 分钟，
 * 单次广告仍只 +1 颗、每日 `AD_STAMINA_DAILY_MAX` 次不变。
 */
export const STAMINA_MAX = 10;

                          
                          
                    
                          
                  
 

/** 拿不到结果时给出原因，不用布尔值糊过去（界面要按原因给不同文案） */
                           
                                
                                                           

/** 进场预扣 1 颗（§12.4 第一步） */
export function preDeductStamina(state         )                {
  if (state.pending > 0) return { ok: false, reason: 'already-pending' };
  if (state.available <= 0) return { ok: false, reason: 'exhausted' };
  return { ok: true, state: { available: state.available - 1, pending: 1 } };
}

/** 渲染完成 → 转正式扣除（§12.4 第二步：这颗不再退还） */
export function confirmStamina(state         )          {
  return { available: state.available, pending: 0 };
}

/**
 * 中途退出 / 加载超时 → 退还（§12.4 第三步）。
 *
 * 退还时按上限截断：否则「预扣 → 退还」循环能把体力刷到超过上限。
 */
export function refundStamina(state         )          {
  if (state.pending <= 0) return state;
  return { available: Math.min(STAMINA_MAX, state.available + 1), pending: 0 };
}
