/**
 * 微信专属：好友排行（开放数据域）主域侧。
 *
 * 微信的硬规矩（不是我们能绕开的）：
 *   - 主域（游戏逻辑所在）读不到好友数据，只能用 `wx.setUserCloudStorage` 写**本人**的 KV；
 *   - 好友数据只能在开放数据域（`minigame/open-data/index.js`，纯 ES5 独立脚本，
 *     不走 TS 构建）里 `wx.getFriendCloudStorage` 读，画到 sharedCanvas 上；
 *   - 主域拿不到好友数据也看不到那块画布的内容，只能把 sharedCanvas（`odc.canvas`）
 *     整张贴到主画布上展示。
 *
 * 非微信环境（浏览器预览 / 纯本地）全部安全降级：syncFriendRank 为 no-op、
 * friendRankCanvas 返回 null —— 排行榜的好友 Tab 显示「仅在微信内可用」。
 *
 * 移植自糖果小镇 `universal-map-editor/src/minigame/wxFeatures.ts`（评估文档 §C），
 * KV 形状沿用 wxgame 协议：`{wxgame:{score,update_time}, totalStars, unlocked}`。
 */

import { GS } from './state';
import { totalStars } from './meta';
import { recordOf } from '../核心/index';
import type { ProgressData } from '../核心/index';

/** 开放数据域按同一个 key 读（open-data/index.js 里的 RANK_KEY 必须一致） */
const RANK_KEY = 'pinpin_rank';

/** sharedCanvas 尺寸缓存：变了才重设 + 让子域重画 */
let friendSize = '';

/** 两模式「所有关卡本关最高分之和」（与 MapPanels.totalScoreOf 同口径） */
function totalScoreOfBoth(progress: ProgressData[]): number {
  let sum = 0;
  for (const p of progress) {
    for (const key of Object.keys(p.levels)) {
      const level = Number(key);
      if (Number.isFinite(level)) sum += recordOf(p, level).personalBest;
    }
  }
  return sum;
}

/**
 * 把本人总分 / 总星 / 进度写进微信托管 KV（好友榜的数据源）。
 * 结算落盘与启动时各调一次；失败静默 —— 上报失败不影响游戏。
 */
export function syncFriendRank(): void {
  const wx = (globalThis as { wx?: any }).wx;
  if (!wx || typeof wx.setUserCloudStorage !== 'function') return;
  try {
    const normal = GS.data.progress.normal;
    const nightmare = GS.data.progress.nightmare;
    const score = totalScoreOfBoth([normal, nightmare]);
    const stars = totalStars(normal) + totalStars(nightmare);
    wx.setUserCloudStorage({
      KVDataList: [
        {
          key: RANK_KEY,
          // wxgame 协议：value 必须是 {wxgame:{score,update_time}} 形状，微信才认得分字段
          value: JSON.stringify({
            wxgame: { score: Math.max(0, score), update_time: Math.floor(Date.now() / 1000) },
            totalStars: stars,
            unlocked: GS.progress.unlocked,
          }),
        },
      ],
    });
  } catch {
    /* 忽略：好友榜是锦上添花，不能因为上报失败卡结算 */
  }
}

/**
 * 好友榜画布（开放数据域的 sharedCanvas）。尺寸变化时重设并让子域重画；
 * 主域只把它整张贴上屏幕，看不到里面的数据。非微信环境返回 null。
 *
 * @param w h   要显示的区域（设计 px）
 * @param scale 设计 → 物理像素比（主画布 canvas.width / 1080），子域按这个分辨率画才不发虚
 */
export function friendRankCanvas(w: number, h: number, scale: number): CanvasImageSource | null {
  const wx = (globalThis as { wx?: any }).wx;
  if (!wx || typeof wx.getOpenDataContext !== 'function') return null;
  try {
    const odc = wx.getOpenDataContext();
    const c = odc.canvas;
    if (!c) return null;
    const key = `${Math.round(w * scale)}x${Math.round(h * scale)}`;
    if (key !== friendSize) {
      friendSize = key;
      c.width = Math.round(w * scale);
      c.height = Math.round(h * scale);
    }
    odc.postMessage({ type: 'drawRank', key: RANK_KEY });
    // shim 的贴图就绪判断认 _ccReady（画布源没有 complete 属性），这里恒可用
    (c as { _ccReady?: boolean })._ccReady = true;
    return c as unknown as CanvasImageSource;
  } catch {
    return null;
  }
}
