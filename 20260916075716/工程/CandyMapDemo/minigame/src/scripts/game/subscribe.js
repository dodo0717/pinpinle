/**
 * 订阅消息（2026-10-27 评审 P1-6）：体力回满 / 每日挑战刷新提醒。
 *
 * 微信规矩：`wx.requestSubscribeMessage` 只能在**用户点击**的回调里调；每次授权只能推一条。
 * 所以入口放在签到弹窗的「开启提醒」按钮上，不在 toast / 自动流程里弹。
 *
 * 只做客户端授权：真正推送要服务端按回满时间定时发（未实现，见延后清单）。
 * 模板 ID 没配（release.ts SUBSCRIBE_TEMPLATES 为空）或非微信时，返回 false，调用方给提示。
 */

import { SUBSCRIBE_TEMPLATES } from '../core/release.js';
import { track } from './analytics.js';

export function subscribeAvailable()          {
  const wx = (globalThis                ).wx;
  const ids = Object.values(SUBSCRIBE_TEMPLATES).filter(Boolean);
  return !!wx && typeof wx.requestSubscribeMessage === 'function' && ids.length > 0;
}

/** 请求订阅；`done(accepted)` 回调一次（拒绝 / 失败 / 不可用都是 false） */
export function requestReminders(done                             )       {
  const wx = (globalThis                ).wx;
  const ids = Object.values(SUBSCRIBE_TEMPLATES).filter(Boolean);
  if (!subscribeAvailable()) {
    done(false);
    return;
  }
  try {
    wx.requestSubscribeMessage({
      tmplIds: ids,
      success: (res                        ) => {
        const ok = ids.some((id) => res[id] === 'accept');
        track('share', { from: ok ? 'subscribe_accept' : 'subscribe_reject' });
        done(ok);
      },
      fail: () => done(false),
    });
  } catch {
    done(false);
  }
}
