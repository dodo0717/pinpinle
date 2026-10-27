/**
 * 隐私合规（2026-10-26 评审 P0-1）。
 *
 * `game.json` 开了 `__usePrivacyCheck__` 之后，涉及用户信息的接口（getUserInfo /
 * createUserInfoButton / 好友关系链等）在用户同意《隐私保护指引》之前会被微信拦下。
 * 我们没注册 `wx.onNeedPrivacyAuthorization`，所以微信会弹**官方授权弹窗**，这里只做两件事：
 *   1. 静默调用（启动时拿资料、上报好友榜 KV）之前先 `requirePrivacyAuthorize`，拒绝就跳过；
 *   2. 设置页的「隐私保护指引」入口 → `wx.openPrivacyContract`（内容在微信后台配置）。
 *
 * 非微信 / 基础库太老（< 2.32.3，没有这些接口）一律视为已同意，不挡流程。
 */

/** 适龄提示（设置页）。按实际申报结果改这里 */
export const AGE_RATING = '8+';

export const AGE_TIP_LINES                    = [
  `本游戏适合 ${AGE_RATING} 年龄段的用户。`,
  '游戏为休闲益智类拼图消除，无暴力、恐怖内容，无付费内容；',
  '含激励视频广告（自愿观看，看完获得体力 / 续命）。',
  '未成年人请在监护人指导下合理安排游戏时间。',
];

/** 健康游戏忠告（加载页底部，文字为国家新闻出版署规定原文） */
export const HEALTH_ADVICE                    = [
  '抵制不良游戏，拒绝盗版游戏。注意自我保护，谨防受骗上当。',
  '适度游戏益脑，沉迷游戏伤身。合理安排时间，享受健康生活。',
];

/**
 * ⚠️ 待补：《用户协议》正文由运营 / 法务提供；在这之前设置页显示这段占位说明。
 */
export const USER_AGREEMENT_LINES                    = [
  '《用户协议》正文待补充。',
  '个人信息的收集与使用以《隐私保护指引》为准。',
];

function wxApi()      {
  return (globalThis                ).wx;
}

/** 本次启动内已同意过（同意后不用再问） */
let granted = false;

/**
 * 确认用户已同意隐私协议后再执行 `run`；拒绝则执行 `onDeny`（可不传）。
 * 每次都允许调用：微信侧已同意时 success 立即回来，不会弹窗。
 */
export function withPrivacy(run            , onDeny             )       {
  const wx = wxApi();
  if (granted || !wx || typeof wx.requirePrivacyAuthorize !== 'function') {
    run();
    return;
  }
  try {
    wx.requirePrivacyAuthorize({
      success: () => { granted = true; run(); },
      fail: () => { onDeny?.(); },
    });
  } catch {
    run();
  }
}

/** 打开《隐私保护指引》；不支持时返回 false（调用方 toast 提示） */
export function openPrivacyContract()          {
  const wx = wxApi();
  if (!wx || typeof wx.openPrivacyContract !== 'function') return false;
  try {
    wx.openPrivacyContract({});
    return true;
  } catch {
    return false;
  }
}
