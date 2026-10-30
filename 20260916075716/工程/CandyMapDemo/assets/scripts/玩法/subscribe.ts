/**
 * 订阅消息（2026-10-27 评审 P1-6）：体力回满 / 每日挑战刷新提醒。
 *
 * 微信规矩：`wx.requestSubscribeMessage` 只能在**用户点击**的回调里调；每次授权只能推一条。
 * 所以入口放在签到弹窗的「开启提醒」按钮上，不在 toast / 自动流程里弹。
 *
 * 只做客户端授权：真正推送要服务端按回满时间定时发（未实现，见延后清单）。
 * 模板 ID 没配（release.ts SUBSCRIBE_TEMPLATES 为空）或非微信时，返回 false，调用方给提示。
 */

import { SUBSCRIBE_TEMPLATES, SERVER_RETENTION_API } from '../核心/release';
import { track } from './analytics';
import { cloudSync } from './cloud';

/**
 * 授权成功后把推送时间登记到服务端（2026-10-27，GameRetentionController /subscribe）：
 *   stamina —— 体力回满的时刻（满格时不登记）；daily —— 明天 0 点 5 分（每日挑战刷新）。
 * 失败静默：推送是锦上添花。
 */
export function registerReminders(staminaFullAt: number | null, now = Date.now()): void {
  if (!SERVER_RETENTION_API) return;
  const cloud = cloudSync();
  if (!cloud) return;
  if (SUBSCRIBE_TEMPLATES.stamina && staminaFullAt !== null && staminaFullAt > now) {
    void cloud.api('POST', '/game/api/subscribe', { kind: 'stamina', sendAt: Math.round(staminaFullAt) });
  }
  if (SUBSCRIBE_TEMPLATES.daily) {
    const d = new Date(now);
    const tomorrow = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 5, 0).getTime();
    void cloud.api('POST', '/game/api/subscribe', { kind: 'daily', sendAt: tomorrow });
  }
}

export function subscribeAvailable(): boolean {
  const wx = (globalThis as { wx?: any }).wx;
  const ids = Object.values(SUBSCRIBE_TEMPLATES).filter(Boolean);
  return !!wx && typeof wx.requestSubscribeMessage === 'function' && ids.length > 0;
}

/** 请求订阅；`done(accepted)` 回调一次（拒绝 / 失败 / 不可用都是 false） */
export function requestReminders(done: (accepted: boolean) => void): void {
  const wx = (globalThis as { wx?: any }).wx;
  const ids = Object.values(SUBSCRIBE_TEMPLATES).filter(Boolean);
  if (!subscribeAvailable()) {
    done(false);
    return;
  }
  try {
    wx.requestSubscribeMessage({
      tmplIds: ids,
      success: (res: Record<string, string>) => {
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
