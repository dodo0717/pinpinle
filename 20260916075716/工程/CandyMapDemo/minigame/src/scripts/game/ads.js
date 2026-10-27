/**
 * 激励视频广告（2026-10-26 评审 P0-2）：加体力 / 续命两个点位共用一个封装。
 *
 * 规则：
 *   - **只在看完（`onClose(res.isEnded)`）时发奖**；中途关闭不发、不扣次数；
 *   - 拉取失败 / 无填充 / 中途关闭各给一句文案（`ADS.*`，见 text.ts），由调用方 toast；
 *   - 非微信环境，或 `release.ts` 没配 adUnitId 时，退回本地模拟（1.2 秒后视为看完），
 *     保证浏览器预览与测试服流程能走通。
 *
 * 次数额度不在这里管（`GS.adStaminaLeft` / `GS.adReviveLeft`），本模块只负责「放一次广告」。
 */

import { RELEASE } from '../core/release.js';
import { track } from './analytics.js';

                                               

/** 一次广告的结果：看完 / 中途关闭 / 拉不到（含无填充） */
                                                     

/** 模拟广告时长（毫秒）—— 与原来本地模拟的 1.2 秒一致 */
const MOCK_MS = 1200;

             
                        
                        
                                                           
                                                            
                                            
  

let ad              = null;
/** 同一时间只允许放一条广告（防连点） */
let playing = false;

function wxApi()      {
  return (globalThis                ).wx;
}

/** 真广告可用：在微信里且配了广告位 */
function realAvailable()          {
  const wx = wxApi();
  return !!(RELEASE.rewardedAdUnitId && wx && typeof wx.createRewardedVideoAd === 'function');
}

function ensureAd()              {
  if (ad) return ad;
  if (!realAvailable()) return null;
  try {
    ad = wxApi().createRewardedVideoAd({ adUnitId: RELEASE.rewardedAdUnitId })        ;
    // 错误事件只记日志：失败结果由 show/load 的 Promise 回给调用方
    ad.onError((err) => console.warn('[ads] error', err));
  } catch (e) {
    console.warn('[ads] create failed', e);
    ad = null;
  }
  return ad;
}

/** 启动时预加载一次，第一次点广告不用等拉取 */
export function preloadAds()       {
  const a = ensureAd();
  if (a) a.load().catch(() => { /* 首次预加载失败不提示，真正点的时候再拉 */ });
}

/**
 * 放一次激励视频。`done` 只回调一次。
 *
 * 调用方约定：`ended` 才发奖并记次数；`closed` 提示「看完才能领取」；`failed` 提示「广告还没准备好」。
 */
export function showRewardedAd(placement             , done                       )       {
  if (playing) return;
  playing = true;
  track('ad_show', { placement });
  const finish = (r          )       => {
    playing = false;
    if (r === 'ended') track('ad_reward', { placement });
    done(r);
  };

  const a = ensureAd();
  if (!a) {
    // 模拟：浏览器预览 / 未配广告位
    setTimeout(() => finish('ended'), MOCK_MS);
    return;
  }

  const onClose = (res                        )       => {
    a.offClose(onClose);
    // 基础库 < 2.1.0 回调没有 res：按看完处理（微信官方示例同口径）
    finish(!res || res.isEnded ? 'ended' : 'closed');
    a.load().catch(() => { /* 预拉下一条 */ });
  };
  a.onClose(onClose);
  a.show().catch(() =>
    // 没拉到就重拉一次再放；还不行（含无填充）就算失败
    a.load()
      .then(() => a.show())
      .catch(() => {
        a.offClose(onClose);
        finish('failed');
      }),
  );
}
