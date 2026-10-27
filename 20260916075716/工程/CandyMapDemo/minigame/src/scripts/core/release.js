/**
 * 发布开关（2026-10-26，评审 P0-3）：测试口径与正式口径的差异**只允许写在这里**。
 *
 * 提审前把 `RELEASE_PROFILE` 改成 `'prod'`，再按 `docs/上线核对清单.md` 逐项核对
 * （清单里还有几项服务端参数，客户端改不到）。
 *
 * 纯数据模块、不依赖 cc，核心层与单测都能直接 import。
 */

                                             

/** 当前发布口径：开发 / 测试服用 'test'，提审包用 'prod' */
export const RELEASE_PROFILE                 = 'test';

                        
     
                                                    
                                                                    
     
                          
                                              
                           
     
                                    
                                         
     
                           
                             
                     
 

/**
 * 服务端「回访」接口是否已部署（2026-10-27：/daily/result、/invite、/invite/claim、/subscribe，
 * 在 candy-game-server 分支 feat/daily-invite-subscribe）。
 * 没部署时调用会 404：功能上已静默降级，但开发者工具控制台每次启动都报红，容易被当成故障。
 * 2026-10-27 22:17 起测试服已部署（feat/daily-invite-subscribe，V8 / V9 已执行），打开。
 */
export const SERVER_RETENTION_API = true;

/**
 * ⚠️ 待填：订阅消息模板 ID（微信后台「订阅消息」申请，2026-10-27 评审 P1-6）。
 * 空串 = 不弹订阅框。服务端定时推送见 SubscribePushTask（还要在后台开 game.subscribe.enabled）。
 */
export const SUBSCRIBE_TEMPLATES = {
  /** 体力回满提醒 */
  stamina: '',
  /** 每日挑战刷新提醒 */
  daily: '',
}         ;

/** ⚠️ 待填：流量主开通后把广告位 ID 填到这里（测试 / 正式可以用同一个） */
const REWARDED_AD_UNIT_ID = '';

const FLAGS                                       = {
  test: { initialUnlocked: 4, runtimeErrorBar: true, rewardedAdUnitId: REWARDED_AD_UNIT_ID, analytics: true },
  prod: { initialUnlocked: 1, runtimeErrorBar: false, rewardedAdUnitId: REWARDED_AD_UNIT_ID, analytics: true },
};

export const RELEASE                         = FLAGS[RELEASE_PROFILE];
