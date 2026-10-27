/**
 * 最小埋点集（2026-10-26 评审 P2-3）：接微信 We 分析 `wx.reportEvent`，零后端成本。
 *
 * ⚠️ 事件名与参数必须先在 We 分析后台「自定义分析 → 事件管理」里配好，否则上报会被丢弃。
 * 事件表见 docs/上线核对清单.md。非微信环境 / 关闭埋点时只在调试口径下打 console。
 *
 * 失败一律静默：埋点绝不能影响游戏。
 */

import { RELEASE } from '../核心/release';

export type TrackEvent =
  | 'level_start'
  | 'level_end'
  | 'guide_step'
  | 'ad_show'
  | 'ad_reward'
  | 'stamina_empty'
  | 'share'
  | 'share_open';

export type TrackParams = Record<string, string | number | boolean>;

/** 上报一个事件 */
export function track(event: TrackEvent, params: TrackParams = {}): void {
  if (!RELEASE.analytics) return;
  // We 分析的参数值只认 string / number：布尔转 0/1
  const data: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(params)) data[k] = typeof v === 'boolean' ? (v ? 1 : 0) : v;
  try {
    const wx = (globalThis as { wx?: any }).wx;
    if (wx && typeof wx.reportEvent === 'function') wx.reportEvent(event, data);
    else if (RELEASE.runtimeErrorBar) console.log('[track]', event, data);
  } catch {
    /* 静默 */
  }
}
