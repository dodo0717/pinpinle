/**
 * 微信专属：好友排行（开放数据域）主域侧 + 分享卡片（带邀请人）。
 *
 * 微信的硬规矩（不是我们能绕开的）：
 *   - 主域（游戏逻辑所在）读不到好友数据，只能用 `wx.setUserCloudStorage` 写**本人**的 KV；
 *   - 好友数据只能在开放数据域（`minigame/open-data/index.js`，纯 ES5 独立脚本，
 *     不走 TS 构建）里 `wx.getFriendCloudStorage` 读，画到 sharedCanvas 上；
 *   - 主域拿不到好友数据也看不到那块画布的内容，只能把 sharedCanvas（`odc.canvas`）
 *     整张贴到主画布上展示。
 *
 * 非微信环境（浏览器预览 / 纯本地）全部安全降级：syncFriendRank / enableShare /
 * reportInviter 为 no-op、friendRankCanvas / getInviter 返回 null —— 排行榜的
 * 好友 Tab 显示「仅在微信内可用」。
 *
 * 移植自糖果小镇 `universal-map-editor/src/minigame/wxFeatures.ts`（评估文档 §C），
 * KV 形状沿用 wxgame 协议：`{wxgame:{score,update_time}, totalStars, unlocked}`。
 */

import { GS } from './state.js';
import { rankTotals } from '../core/index.js';
import { cloudSync } from './cloud.js';
import { track } from './analytics.js';
import { withPrivacy } from './privacy.js';

/** 开放数据域按同一个 key 读（open-data/index.js 里的 RANK_KEY 必须一致） */
const RANK_KEY = 'pinpin_rank';

/** sharedCanvas 尺寸缓存：变了才重设 + 让子域重画 */
let friendSize = '';


/**
 * 把本人总分 / 总星 / 进度写进微信托管 KV（好友榜的数据源）。
 * 结算落盘与启动时各调一次；失败静默 —— 上报失败不影响游戏。
 */
export function syncFriendRank()       {
  const wx = (globalThis                ).wx;
  if (!wx || typeof wx.setUserCloudStorage !== 'function') return;
  // 托管 KV 属于关系链数据：先确认隐私协议已同意（privacy.ts），拒绝就不上报
  withPrivacy(() => writeFriendKV(wx));
}

function writeFriendKV(wx     )       {
  try {
    // 与总榜同一口径（核心/rank.ts）：总积分 = 简单 + 困难×1.5（只认有效成绩），总星数两模式合计
    const t = rankTotals(GS.data.progress.normal, GS.data.progress.nightmare);
    const score = t.total;
    const stars = t.stars;
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
export function friendRankCanvas(w        , h        , scale        )                           {
  const wx = (globalThis                ).wx;
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
    (c                          )._ccReady = true;
    return c                                ;
  } catch {
    return null;
  }
}

/* ================================================================ 分享卡片（带邀请人） */

/** 「从分享卡打开」每次启动只报一次（getInviter 可能被调用多次） */
let shareOpenTracked = false;

/** 分享卡片标题（糖果小镇同款做法：文案写在 wxFeatures 侧） */
const SHARE_TITLE = '萌宠拼拼乐，一起闯关！';

/**
 * 最近一次通关（2026-10-27 评审 P2-2）：有就用挑战式标题，卡片 query 带上关卡号，
 * 好友从卡片打开直接弹这一关的详情窗（getLaunchLevel）。
 */
let lastChallenge                                          = null;

/** 结算通关后调用：之后右上角转发就是「我第 N 关 3★，你敢来吗」 */
export function setShareChallenge(level        , stars        )       {
  lastChallenge = { level, stars };
}

function shareTitle()         {
  if (!lastChallenge) return SHARE_TITLE;
  const { level, stars } = lastChallenge;
  return stars >= 3 ? `我第 ${level} 关拿了 3★，你敢来挑战吗？` : `我过了萌宠拼拼乐第 ${level} 关，来比比谁更快！`;
}

/** 从分享卡启动时卡片里的关卡号；没有 / 非法返回 null（调用方再判断是否已解锁） */
export function getLaunchLevel()                {
  const wx = (globalThis                ).wx;
  if (!wx || typeof wx.getLaunchOptionsSync !== 'function') return null;
  try {
    const q = (wx.getLaunchOptionsSync()                                       ).query || {};
    const n = Number(q.level);
    return Number.isInteger(n) && n >= 1 ? n : null;
  } catch {
    return null;
  }
}

/**
 * 读取启动 / 分享参数里的邀请人 id（inviter）。非微信或无参数时返回 null。
 * 云同步登录成功后调用方把结果交给 reportInviter（本次登录只报一次）。
 */
export function getInviter()                {
  const wx = (globalThis                ).wx;
  if (!wx || typeof wx.getLaunchOptionsSync !== 'function') return null;
  try {
    const q = (wx.getLaunchOptionsSync()                                       ).query || {};
    const v = q.inviter;
    if (typeof v !== 'string' || v.length === 0) return null;
    if (!shareOpenTracked) { shareOpenTracked = true; track('share_open', { inviter: v }); }
    return v;
  } catch {
    return null;
  }
}

/**
 * 开启「转发给好友」并把本人 playerId 放进卡片 query（受邀者启动时 getInviter 能读到）。
 * playerId 是云同步登录后才有——未登录时也开分享，只是不带邀请人。非微信 no-op。
 */
export function enableShare(myPlayerId                        )       {
  const wx = (globalThis                ).wx;
  if (!wx || typeof wx.onShareAppMessage !== 'function') return;
  try {
    wx.onShareAppMessage(() => {
      track('share', { from: 'menu', level: lastChallenge?.level ?? 0 });
      const q           = [];
      if (myPlayerId != null) q.push(`inviter=${encodeURIComponent(String(myPlayerId))}`);
      if (lastChallenge) q.push(`level=${lastChallenge.level}`);
      return { title: shareTitle(), query: q.join('&') };
    });
  } catch {
    /* 忽略：分享开关失败不影响游戏 */
  }
}

/**
 * 上报「我是被谁邀请来的」（2026-10-27 服务端 GameRetentionController /invite）。
 * 返回受邀者这一份奖励体力（无效邀请 / 老服务端 404 / 失败一律 0，静默）。
 */
export async function reportInviter(inviter        )                  {
  if (!inviter) return 0;
  const cloud = cloudSync();
  if (!cloud) return 0;
  const res = await cloud.api('POST', '/game/api/invite', { inviter });
  const n = Number(res?.reward);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** 邀请人领取累计的邀请奖励（登录后调一次）；返回本次领到的体力，没有 / 失败为 0 */
export async function claimInviteRewards()                  {
  const cloud = cloudSync();
  if (!cloud) return 0;
  const res = await cloud.api('POST', '/game/api/invite/claim');
  const n = Number(res?.reward);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * 结算弹窗「挑战好友」按钮（评审 P2-2）：主动拉起转发，卡片与右上角转发同一套标题 / query。
 * 必须在点击回调里调（微信规矩）。非微信返回 false，调用方给提示。
 */
export function shareChallengeNow()          {
  const wx = (globalThis                ).wx;
  if (!wx || typeof wx.shareAppMessage !== 'function') return false;
  try {
    const q           = [];
    const pid = cloudSync()?.playerId;
    if (pid != null) q.push(`inviter=${encodeURIComponent(String(pid))}`);
    if (lastChallenge) q.push(`level=${lastChallenge.level}`);
    track('share', { from: 'result', level: lastChallenge?.level ?? 0 });
    wx.shareAppMessage({ title: shareTitle(), query: q.join('&') });
    return true;
  } catch {
    return false;
  }
}
