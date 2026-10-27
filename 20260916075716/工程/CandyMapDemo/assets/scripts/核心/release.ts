/**
 * 发布开关（2026-10-26，评审 P0-3）：测试口径与正式口径的差异**只允许写在这里**。
 *
 * 提审前把 `RELEASE_PROFILE` 改成 `'prod'`，再按 `docs/上线核对清单.md` 逐项核对
 * （清单里还有几项服务端参数，客户端改不到）。
 *
 * 纯数据模块、不依赖 cc，核心层与单测都能直接 import。
 */

export type ReleaseProfile = 'test' | 'prod';

/** 当前发布口径：开发 / 测试服用 'test'，提审包用 'prod' */
export const RELEASE_PROFILE: ReleaseProfile = 'test';

interface ReleaseFlags {
  /**
   * 出厂就解锁的关卡数。测试口径 4（第 2/3/4 关默认可玩，三套主题对比用），正式口径 1。
   * 服务端 sys_config `game.level.initialUnlocked` 必须与它一致，否则上报会被当跳关拒收。
   */
  initialUnlocked: number;
  /** 运行时错误画在屏幕顶部红条上（真机截图定位用）；正式包只写 console */
  runtimeErrorBar: boolean;
  /**
   * 激励视频广告位 ID（微信后台「流量主 → 广告管理」申请）。
   * 空串 = 没有广告位，加体力 / 续命走本地模拟（1.2 秒视为看完）。
   */
  rewardedAdUnitId: string;
  /** We 分析埋点开关（事件要先在后台配置） */
  analytics: boolean;
}

/**
 * ⚠️ 待填：订阅消息模板 ID（微信后台「订阅消息」申请，2026-10-27 评审 P1-6）。
 * 空串 = 不弹订阅框。推送要服务端定时任务，尚未实现（见延后清单）。
 */
export const SUBSCRIBE_TEMPLATES = {
  /** 体力回满提醒 */
  stamina: '',
  /** 每日挑战刷新提醒 */
  daily: '',
} as const;

/** ⚠️ 待填：流量主开通后把广告位 ID 填到这里（测试 / 正式可以用同一个） */
const REWARDED_AD_UNIT_ID = '';

const FLAGS: Record<ReleaseProfile, ReleaseFlags> = {
  test: { initialUnlocked: 4, runtimeErrorBar: true, rewardedAdUnitId: REWARDED_AD_UNIT_ID, analytics: true },
  prod: { initialUnlocked: 1, runtimeErrorBar: false, rewardedAdUnitId: REWARDED_AD_UNIT_ID, analytics: true },
};

export const RELEASE: Readonly<ReleaseFlags> = FLAGS[RELEASE_PROFILE];
