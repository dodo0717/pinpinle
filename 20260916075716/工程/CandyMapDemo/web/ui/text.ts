/**
 * 界面文案集中表。
 *
 * **所有面向玩家的字符串都写在这里**，界面模块只引用、不内联 ——
 * 原因：策划案对「置灰 + 提示」的文案是**逐字规定**的（§9.3 / §12.1 / §12.2 / §12.4），
 * 散落在各界面文件里就没法一眼比对；集中之后，改文案只改一个文件。
 *
 * 每条都标注了出处；凡文档没给的，标 `占位` 并由策划替换。
 */

import { TOTAL_LEVELS } from '../../assets/scripts/core/index.ts';

/** 版本号（§11.4「关于游戏」） */
export const VERSION = 'v1.0';

/** 分享用的游戏链接（§12.1 分享规格：成绩截图 + 游戏链接） */
export const GAME_LINK = 'https://example.com/mengchong-puzzle';

export const TITLE = '萌宠拼拼乐';

/** 通用返回 */
export const BACK_HOME = '← 返回主界面';
export const BACK_COLLECTION = '← 返回图鉴';

/* ---------------------------------------------------------------- 主界面（§11.1） */

export const HOME = {
  start: '▶ 开始游戏',
  map: '🗺 关卡地图',
  collection: '📚 表情包图鉴',
  leaderboard: '🏆 排行榜',
  settings: '⚙️ 设置',
  addStaminaTip: '点击 + 看广告加 1 体力',
  staminaFull: '体力已满',
  staminaCountdown: (mmss: string): string => `下颗体力 ${mmss}`,
  progress: (level: number, stars: string): string =>
    stars ? `第 ${level} 关  ${stars}` : `第 ${level} 关`,
  /** 「世界名 · 本世界第几关/总关」，如 `奶油果园 · 1/20` */
  worldProgress: (world: string, local: number, total: number): string =>
    `${world} · ${local}/${total}`,
  /** 顶栏昵称：还没有账号系统，先用占位（接账号时从这里换） */
  nickname: '玩家',
  /** 顶栏头像：同理，占位 emoji，等美术给默认头像 */
  avatar: '🐶',
  unlockedCount: (unlocked: number): string => `${unlocked}/${TOTAL_LEVELS} 已解锁`,
  /** §12.4「开始游戏」体力不足 */
  noStamina: '体力不足，请点击顶部+看广告或等待恢复',
} as const;

/* ---------------------------------------------------------------- 图鉴（§11.3） */

export const COLLECTION = {
  title: '📚 图鉴',
  collected: (got: number, total: number): string => `已收集：${got} / ${total}`,
  lockedCell: '???',
  download: '下载',
  share: '分享',
  /** 图鉴文案是占位（config.ts 的 IMAGE_TEXT_PLACEHOLDER），界面这里再明示一次，避免被当成正式文案 */
  captionNote: '（文案为占位，待策划替换）',
} as const;

/* ---------------------------------------------------------------- 排行榜（§9.3） */

export const LEADERBOARD = {
  title: '🏆 排行榜',
  header: (level: number, tier: string): string => `第 ${level} 关  ·  ${tier}`,
  myRank: (rank: number): string => `我的排名：第 ${rank} 名`,
  myRankNone: '我的排名：暂未上榜',
  myPersonalBest: (score: number): string => `我的个人最高分：${score} 分`,
  /** 《通关及排名》：上榜门槛 = 3★，所以「上榜最高分」与「个人最高分」可能不同 */
  myBoardBest: (score: number): string => `上榜最高分：${score} 分`,
  /** 榜单规模说明（含并列） */
  boardSize: (total: number, shown: number): string =>
    `本关共 ${total} 位玩家 · 榜单取前 100 名（含并列，实收 ${shown} 条）`,
  /** 《通关及排名》§7：每页 20 名 */
  page: (page: number, pages: number): string => `第 ${page} / ${pages} 页`,
  prevPage: '◀ 上一页',
  nextPage: '下一页 ▶',
  empty: '暂无记录，快来挑战吧！',
  footer: '💡 上榜门槛：3 星。1★ / 2★ 与续命局不计入',
  challenge: '▶ 挑战本关（消耗1体力）',
  challengeLocked: '通关前一关后解锁',
  challengeUnclear: '通关后解锁',
  /** 该关所需素材张数不足（开发期素材未到齐），即使已通关也进不去 */
  challengeUnavailable: (level: number): string => `第 ${level} 关暂未开放（所需素材张数不足）`,
  /** §9.3「体力不足」 */
  challengeNoStamina: '体力不足，请点击主界面+看广告或返回主页',
  prev: '◀ 上一关',
  next: '下一关 ▶',
  /** 排行榜成绩是本地模拟数据（无后端），必须明示，别被当成真实榜单 */
  mockNote: '开发期说明：榜单为本地模拟的 100 名玩家（无后端），我的成绩取自本机记录',
  scoreUnit: (score: number): string => `${score} 分`,
} as const;

/* ---------------------------------------------------------------- 设置（§11.4） */

export const SETTINGS = {
  title: '⚙️ 设置',
  sound: '音效',
  bgm: '背景音乐',
  on: '开',
  off: '关',
  about: '关于游戏',
  version: (v: string): string => `版本号：${v}`,
  /**
   * ⚠️ M7 起开关**真的生效**了，但声音本身还是 WebAudio 现合成的占位音
   * （`art/` 里没有音频素材）。必须在界面上说清楚，否则测试者会把「音色很电子」
   * 当成音效做坏了 —— 正式素材接入后这句要一起改掉。
   */
  audioNote: '当前为合成占位音（暂无音频素材）：开关即时生效，正式音效接入后替换音色',
} as const;

/* ---------------------------------------------------------------- 结算（§12.1 ~ §12.3） */

/**
 * 星级短语。
 * 只有 3★ 与「续命 1★」是策划案线框里给的（§12.1.1 / §12.1.3），其余为**占位**。
 */
export const STAR_PHRASE = {
  star3: '今天也辛苦了。',
  star2: '表现不错哦！',
  star1: '通关啦！',
  revived: '回来就好。',
} as const;

export const SETTLEMENT = {
  title: '🎉 通关成功！',
  stars: (stars: number, revived: boolean): string => (revived ? '⭐ 1星（续命）' : `${'⭐'.repeat(stars)} ${stars}星`),
  score: (score: number): string => `得分：${score}`,
  line: (n: number, value: number, ok: boolean): string => `${n}星线：${value}  ${ok ? '✅' : '❌'}`,
  rewardGot: (imageId: number): string => `🎁 获得：图${imageId}`,
  rewardOwned: (imageId: number): string => `🎁 已拥有：图${imageId}`,
  /** 第 37~60 关设计表未给图鉴奖励（§10.2） */
  rewardNone: '🎁 本关无图鉴奖励（36 张已全部解锁）',
  personalBest: (score: number): string => `本关个人最高分：${score}`,
  revivedNote: '💡 续命通关不计入排行榜',
  repeatNote: '重复挑战不改变关卡进度',
  unlockNote: (level: number): string => `已解锁第 ${level} 关`,
  btnReplay: '再战本关',
  btnNext: '下一关',
  btnAdStamina: '📺 看广告 +1体力',
  btnShare: '分享',
  btnHome: '返回主页',
  /** 结算/失败弹窗里的体力不足提示（§12.1 / §12.2） */
  noStamina: '体力不足，请观看广告或返回主页',
} as const;

/* ---------------------------------------------------------------- 荣誉弹窗（《通关及排名》2026-09-12） */

/**
 * 通关荣誉弹窗文案。
 *
 * 全部逐字来自策划《通关及排名》§五，统称「您」。三档优先级：超神 > 王者 > 优秀。
 *
 * ⚠️ 图标目前用 emoji 占位（零素材、与现有界面风格一致：🏆/📚/⚙️ 都是 emoji）；
 * 美术出图后把 `icon` 换成 `<img>` 即可，文案不用动。
 * ⚠️ 优秀档**不显示排名**（策划：这一档玩家排名可能低于 60%，没必要展示）。
 */
export const HONOR = {
  /** 大号分数上方的标签 */
  scoreLabel: '本关得分',
  god: {
    icon: '👑',
    title: '恭喜，得分超神！',
    desc: '您的分数进入了百强。',
    /** 线框里的「本关第 N 名」 */
    sub: (rank: number): string => `本关第 ${rank} 名`,
  },
  king: {
    icon: '🏆',
    title: '恭喜，得分王者！',
    desc: (percent: string): string => `您的分数超越了 ${percent}% 的玩家。`,
    sub: '再战一次，刷新您的最高分！',
  },
  pass: {
    /** 优秀档用三颗星（按实际星级点亮），不用第二个图标 */
    icon: '',
    title: '恭喜，得分优秀',
    desc: (stars: number): string => `您已顺利通关，获得 ${stars}星！`,
    sub: '继续挑战，冲击更高分数！',
  },
  /** 排行榜表头用的档位名 */
  tierLabel: {
    god: '超神',
    king: '王者',
    pass: '优秀',
  } as const,
  btnLeaderboard: '查看排行榜',
  btnNext: '下一关',
  btnRetry: '再战本关',
  btnHome: '返回主页',
  /** 荣誉弹窗里的体力不足提示（新弹窗没有「看广告」按钮，只能回主页看） */
  noStamina: '体力不足，请返回主页看广告或等待恢复',
  /** 已经是第 60 关时，「下一关」变成「返回主页」并提示这句 */
  lastLevelToast: '敬请期待下阶段新关卡',
} as const;

export const FAIL = {
  title: '没关系。',
  score: (score: number): string => `得分：${score}`,
  line: (value: number): string => `1星线：${value}  ❌`,
  gap: (gap: number): string => `(还差 ${gap} 组)`,
  tip: '💡 休息一下再试试？',
  btnRetry: '重试',
  btnAdStamina: '📺 看广告 +1体力',
  btnHome: '返回主页',
  reviveUsed: '本局的续命机会已经用掉了',
} as const;

export const REVIVE = {
  title: '⏰ 时间到',
  gap: (gap: number): string => `还差 ${gap} 组就能通关`,
  ask: '要再试一次吗？',
  btnAd: '📺 看广告 +1分钟',
  btnGiveUp: '❌ 放弃',
  note: '💡 续命通关统一1星\n不计入排行榜',
  /** §7.5 / §13.4 广告没看完 → 提示「放弃挑战？」是/否 */
  adSkippedAsk: '放弃挑战？',
  adFailed: '广告加载失败，请稍后再试',
} as const;

/* ---------------------------------------------------------------- 广告（§13.3 / §13.4） */

export const ADS = {
  staminaTitle: '📺 加体力广告',
  reviveTitle: '📺 续命广告',
  /** 开发期模拟：真实 SDK 在 M5 里接，原型用按钮走完所有分支 */
  mockBody: '开发期模拟：真实广告由广告 SDK 播放，这里用按钮直接走完各分支。',
  watched: '模拟：看完广告',
  skipped: '模拟：中途退出',
  failed: '模拟：加载失败',
  staminaFull: '体力已满',
  dailyUsed: '今日广告次数已用完',
  failedToast: '广告加载失败，请稍后再试',
  /** 广告播放期间倒计时暂停（§13.5） */
  playing: '广告播放期间，倒计时与游戏完全暂停',
  gotStamina: (available: number, max: number): string => `看完广告，体力 +1（当前 ${available}/${max}）`,
  reviveGranted: '续命 +60 秒，继续本局（统一记 1 星，不上排行榜）',
} as const;

/* ---------------------------------------------------------------- 新手引导（§14） */

export const GUIDE: Record<string, string> = {
  swap: '按住拖动碎片移动位置（横竖斜都行），拼好的一整片会一起走',
  hint4: '这 4 块可以拼成一张图',
  eliminate: '凑齐4块 → 拼成2×2 → 消除！',
  refill: '消除后自动补位',
  clear: '通关解锁新表情！',
};

/* ---------------------------------------------------------------- 存档（M6 / §16） */

/**
 * 存档相关文案。
 *
 * ⚠️ 策划案只规定了**行为**（§16：退出后倒计时照走、离开期间时间走完就直接出判定、
 * 异常页给「重试 + 返回主页」），没有给逐字文案 —— 所以这一组是**占位**，
 * 上线前由策划替换；但**必须存在**：存档坏掉时不许静默按新档开始。
 */
export const SAVE = {
  /** 存档读取失败（版本不符 / JSON 被改坏）—— §16「异常页」的等价物 */
  errorTitle: '⚠️ 存档读取失败',
  errorLines: (issues: readonly string[]): string[] => [
    '本地存档已损坏或与当前版本不兼容，本次按新档开始。',
    ...issues.slice(0, 3).map((issue) => `· ${issue}`),
  ],
  /** 部分字段被自动修复（能继续，但要说一声） */
  repaired: (count: number): string => `存档有 ${count} 处异常已自动修复，进度可能与退出前略有偏差`,
  retryStillBad: '仍然无法读取存档 —— 只能按新档继续',
  btnRetry: '重试读取',
  btnReset: '重置存档并继续',
  /** 写入失败（隐私模式 / 配额满） */
  writeFailed: '存档写入失败（隐私模式或存储配额已满）——本次进度仅在内存，刷新会丢失',
  /** 介质是内存：一开始就说清楚 */
  memoryOnly: '当前环境不支持本地存档，进度仅在内存（刷新会丢失）',
  /** 恢复断点（§16 新口径：退出后倒计时照走，回来自动接着打） */
  resumeTitle: '⏸ 继续上次的挑战？',
  resumeLines: (modeLabel: string, level: number, mmss: string): string[] => [
    `${modeLabel} · 第 ${level} 关`,
    `剩余时间 ${mmss}（离开期间倒计时照走，不顺延）`,
  ],
  resumeYes: '继续',
  resumeNo: '放弃并重开',
  /** 离开期间倒计时已走完 → 不弹恢复窗，直接给本关判定结果 */
  offlineTimeout: '离开期间倒计时已走完，直接结算本局',
  /** 开发工具条 / 自检里的存档状态 */
  statsLabel: (kind: string, writes: number, deferred: number): string =>
    `存档 ${kind} · 写入 ${writes} 次 · 因动画推迟 ${deferred} 次`,
} as const;

/* ---------------------------------------------------------------- 段位（§8.1） */

/**
 * 关卡段位名（§8.1 段位表）。
 * ⚠️ 策划案在原表下注明「此表待策划最终确认」—— 表若定稿，只改这一处。
 */
const TIERS: ReadonlyArray<readonly [number, number, string]> = [
  [1, 3, '新手村'],
  [4, 6, '入门'],
  [7, 15, '进阶'],
  [16, 20, '高手'],
  [21, 35, '精英'],
  [36, 50, '大师'],
  [51, 60, '传说'],
];

export function tierOfLevel(level: number): string {
  const hit = TIERS.find(([from, to]) => level >= from && level <= to);
  return hit ? hit[2] : '—';
}

/* ---------------------------------------------------------------- 关卡地图（测试件） */

/**
 * 关卡地图文案。
 *
 * ⚠️ 这一屏是**测试件** —— 只为验收「翻滚式选关」的手感与观感。
 * 三张地图的主题名在 `web/ui/map.ts` 的 `WORLDS` 里，与这里是同一批占位文案，
 * 主美给了正式主题名后两处一起换。
 */
export const MAP = {
  title: '🗺 关卡地图',
  locked: (prev: number): string => `先通关第 ${prev} 关`,
  level: (level: number): string => `第 ${level} 关`,
  best: (stars: string): string => `最好成绩 ${stars}`,
  start: '▶ 开始',
  later: '稍后再说',
} as const;

/* ---------------------------------------------------------------- 底部页签栏 */

/**
 * 底部页签栏（糖果传奇式全局导航）。
 *
 * 用法：非玩法屏都常驻，玩法屏隐藏 —— 局内不允许有任何跳走的入口（§0 第 1 条
 * 「不设暂停」的同源约束：能一键跳走就等于能暂停）。
 */
export const TABBAR = {
  home: '首页',
  leaderboard: '排行榜',
  collection: '图鉴',
  settings: '设置',
} as const;
