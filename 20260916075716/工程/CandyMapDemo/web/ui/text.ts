/**
 * 界面文案集中表。
 *
 * **所有面向玩家的字符串都写在这里**，界面模块只引用、不内联 ——
 * 原因：策划案对「置灰 + 提示」的文案是**逐字规定**的（§9.3 / §12.1 / §12.2 / §12.4），
 * 散落在各界面文件里就没法一眼比对；集中之后，改文案只改一个文件。
 *
 * 每条都标注了出处；凡文档没给的，标 `占位` 并由策划替换。
 */

import { TOTAL_LEVELS } from '../../assets/scripts/核心/index.ts';

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
  /** 「世界名 · 本世界第几关/总关」，如 `小镇 · 1/12`（5 世界 × 12 关 = 60） */
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
  title: '图鉴', // 白字棕描边由 .col-title 处理，不带 emoji（同排行榜标题口径）
  collected: (got: number, total: number): string => `已收集：${got} / ${total}`,
  lockedCell: '???',
  /** 未解锁卡的点击提示（§10.3 新规则：每 10 颗星解锁一张） */
  lockedToast: '每获得 10 颗星解锁一张',
  download: '下载',
  share: '分享',
} as const;

/* ---------------------------------------------------------------- 排行榜（§9.3） */

export const LEADERBOARD = {
  title: '排行榜',
  tabTotal: '总分榜',
  tabLevel: '关卡榜',
  colRank: '排名',
  colName: '昵称',
  colSimple: '简单',
  colHard: '困难',
  colTotal: '总分',
  levelSelect: (level: number): string => `第 ${level} 关 ▼`,
  header: (level: number, tier: string): string => `第 ${level} 关  ·  ${tier}`,
  /**
   * 我的成绩单（2026-10-22 升级：从「挤在步进器旁的 28px 小字」改为 Tab 下方独立成绩条，
   * 新增「累计星数」）。标签与数值分开排版：标签小字、数值大号金色描边字。
   */
  mineRankLabel: '我的排名',
  mineScoreLabel: '累计总分',
  mineLevelScoreLabel: '本关最高分',
  mineStarsLabel: '累计星数',
  /**
   * 数值**只放短内容**（纯数字 / 未上榜），单位语义在标签里 —— 这样数值才能放到 88px
   * 还不挤（「第 101 名」「118 分」这种带单位的写法在 76px 时就把三格顶满了）。
   */
  rankValue: (rank: number): string => (rank > 0 ? `${rank}` : '未上榜'),
  scoreValue: (score: number): string => `${score}`,
  /** 累计星数带星标，与图鉴「每 10 星解锁一张」同源口径 */
  starsValue: (stars: number): string => `⭐${stars}`,
  /** 《通关及排名》§7：每页 20 名 */
  page: (page: number, pages: number): string => `第 ${page} / ${pages} 页`,
  prevPage: '◀ 上一页',
  nextPage: '下一页 ▶',
  empty: '暂无记录，快来挑战吧！',
  challenge: '▶ 挑战本关（消耗1体力）',
  challengeLocked: '通关前一关后解锁',
  challengeUnclear: '通关后解锁',
  /** 该关所需素材张数不足（开发期素材未到齐），即使已通关也进不去 */
  challengeUnavailable: (level: number): string => `第 ${level} 关暂未开放（所需素材张数不足）`,
  /** §9.3「体力不足」 */
  challengeNoStamina: '体力不足，请点击主界面+看广告或返回主页',
  prev: '◀ 上一关',
  next: '下一关 ▶',
  scoreUnit: (score: number): string => `${score} 分`,
} as const;

/* ---------------------------------------------------------------- 设置（§11.4） */

export const SETTINGS = {
  title: '设置', // 白字棕描边由 .set-title 处理，不带 emoji（同排行榜/图鉴标题口径）
  sound: '音效',
  bgm: '音乐', // 设计图叫「音乐」
  voice: '教学语音', // 2026-10-26 新增：序章里那句简短文本要不要念出来
  on: '开',
  off: '关',
  about: '关于游戏',
  version: (v: string): string => `版本 ${v}`, // 设计图格式：卡下方小字「版本 1.0.0」
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
  title: '差一点就成功了',
  score: (score: number): string => `得分：${score}`,
  line: (value: number): string => `1星线：${value}  ❌`,
  gap: (gap: number): string => `(还差 ${gap} 组)`,
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
  /** §7.5 / §13.4 广告没看完 → 提示「放弃挑战？」是/否 */
  adSkippedAsk: '放弃挑战？',
  adFailed: '广告加载失败，请稍后再试',
} as const;

/* ---------------------------------------------------------------- 广告（§13.3 / §13.4） */

export const ADS = {
  staminaTitle: '📺 加体力广告',
  reviveTitle: '📺 续命广告',
  watched: '模拟：看完广告',
  skipped: '模拟：中途退出',
  failed: '模拟：加载失败',
  staminaFull: '体力已满',
  dailyUsed: '今日广告次数已用完',
  failedToast: '广告加载失败，请稍后再试',
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

/* ---------------------------------------------------------------- 新手教学（序章） */

/**
 * 序章教学文案（2026-10-26 新增）。
 *
 * ⚠️ 口径：分数 = **消除组数**（拼成一张整图 +1），所以一律说「再拼 X 组」，
 * 不要说「再得 X 分」—— 玩家会以为是另一套分数系统。
 * 详细方案见 `docs/新手教学（序章）策划案.md`。
 */
export const TUTORIAL = {
  /** 首页右侧胶囊按钮 */
  entry: '教学',
  drawerTitle: '新手教学 · 序章',
  start: '开始教学',
  replayNormal: '重玩简单序章',
  replayNightmare: '重玩困难序章',
  nightmareLocked: '先完成简单序章，才能玩困难序章',
  doneNormal: '简单序章：已完成',
  todoNormal: '简单序章：未开始',
  doneNightmare: '困难序章：已完成',
  todoNightmare: '困难序章：未开始',

  /** 教学步文案（每步一句短语） */
  step1: '把同一只萌宠的碎片拼到一起',
  step2: '拼好的整片会一起走，按住拖动试试',
  star1: '已经 1 星！再拼 2 组就 3 星',
  star2: '再拼 1 组就 3 星',
  step4: '正式关卡里它会一直走，时间用完就结算',
  timeFrozen: '序章不计时',

  /** 抽屉里的静态「怎么玩」四步 */
  howTitle: '怎么玩',
  how1: '拖动：按住碎片移动，拼好的整片会一起走',
  how2: '拼合：同一只萌宠的 4 块贴到一起，自动拼成一张整图',
  how3: '消除：拼成 2×2 就消除 +1 组，上面的碎片落下来补位',
  how4: '目标：拼够旗子上的分数就过关，多拼多得星',

  /** 抽屉补充卡（小字、辅助色） */
  noteTime: '🕒 倒计时走完，按最终所得分数结算',
  noteStar: '⭐ 多拼多得星，成绩进排行榜',
  /** ⚠️ 简单 / 困难教学的差异（两套流程不一样，抽屉里要写明） */
  noteNightmare: '🔒 困难关：只能拖动交换相邻的碎片（教学会单独讲这一条）',

  skip: '跳过教学',
  doneTitle: '教学完成',
  /**
   * ⚠️ **完成弹窗已简化（2026-10-28）**：改用结算的吊牌底板，只留
   * 「教学完成 + 继续第 1 关 + 回首页」，下面这三条说明**不再显示**。
   * 字段先留着（这些规则玩家在图鉴/排行榜里还能自己遇到，文案别丢）。
   */
  doneLines: [
    '倒计时走完，按最终所得分数结算',
    '你的成绩会进排行榜，和别的玩家比名次',
    '每拿 10 颗星，解锁一张图鉴贴纸',
  ],
  donePrimary: '继续第 1 关',
  doneSecondary: '回首页',
  /** 教学奖励（结算信息，不是教学文案） */
  rewardLine: (n: string) => `🎁 教学奖励：体力 +${n}`,
  rewardFreeLevel: '🎁 教学奖励：第 1 关免 1 颗体力',

  nightmareRule: '困难模式：一次只能挪一格',
  nightmareStep2: '把 4 块拼成一张整图',
} as const;

/**
 * 教学语音 / 简短文本（2026-10-26 新增，序章 v4）。
 *
 * 用户要求："简单和困难教学是不一样的，所有的教学要写个简短文本，加入语音说明"。
 *
 * ⚠️ **简单与困难是两套**，不是同一套换词：
 *   - 简单（normal）：**任意位置的碎片都能互换** → 拖动拼合 → 目标旗 → 倒计时 → 整片拖拉；
 *   - 困难（nightmare）：**只能交换相邻的碎片** → 拖动拼合 → 目标旗，
 *     **不讲倒计时、不讲整片**（简单序章已讲过；困难序章的门槛就是先完成简单序章）。
 *
 * ⚠️ **用户口径（v4.1）**：
 *   1. 旗子旁的数字 = **过关分数**（不是"还剩几组"）；
 *   2. 倒计时走完 → **按最终所得分数结算**；
 *   3. 每句话**至少留 5 秒**读完（显示时长在 main.ts 的 `tutorialSay()`）。
 *
 * ⚠️ 每句都要**短**：既是屏幕上那一行字（长了要换行、挡棋盘），也是要念出来的话
 * （TTS 念长句听起来像念稿）。控制在 16 字以内，一句一个信息点。
 */
export const TUTORIAL_VOICE = {
  /** 简单序章：先讲规则（任意位置），再讲这一步怎么拖 */
  normal: {
    /** 规则（简单关）：任意位置都能互换 */
    rule: '简单关：任意位置的碎片都能互换',
    /** S1 拖动（3 缺 1） */
    drag: '按住这块碎片，拖到缺口上',
    /** S2 目标旗：旗子数字 = 过关分数 */
    flag: '旗子上的数字，是过关要拼的分数',
    /** S3 倒计时：演示**前**讲（点「继续」才开始真走 3 秒） */
    time: '倒计时走完，按最终分数结算',
    /** S3 演示**之后**讲：走完了，等玩家点「继续」才进下一步 */
    timeDone: '时间一到，就按这个分数结算',
    /** S4 整片拖拉 */
    group: '拼好的整片会一起走，拖一下试试',
  },
  /** 困难序章：先讲规则（只能相邻），再讲这一步怎么挪 */
  nightmare: {
    /** 规则（困难关）：只能相邻 */
    rule: '困难关：只能交换相邻的碎片',
    /** D2 拖动（3 缺 1，一次挪一格，要走几步） */
    drag: '挪一格，把这块补进缺口',
    /** D2 中途：还没到缺口，继续挪（困难要走好几步） */
    nextStep: '继续往缺口挪一格',
    /** D3 目标旗 */
    flag: '旗子上的数字，是过关要拼的分数',
  },
  /** 达成 3 组，教学完成（与弹窗同时播） */
  done: '教学完成，去玩第 1 关吧',
} as const;

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
    `剩余时间 ${mmss}`,
  ],
  resumeYes: '继续',
  resumeNo: '放弃并重开',
  /** 离开期间倒计时已走完 → 不弹恢复窗，直接给本关判定结果 */
  offlineTimeout: '离开期间倒计时已走完，直接结算本局',
  /** 开发工具条 / 自检里的存档状态 */
  statsLabel: (kind: string, writes: number, deferred: number): string =>
    `存档 ${kind} · 写入 ${writes} 次 · 因动画推迟 ${deferred} 次`,
} as const;

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
  /** 困难模式门槛：同一关必须先在简单模式拿到 3 星，才允许挑战困难 */
  nightmareLocked: '三星通关后开启困难模式',
  nightmareHint: '三星通关后开启困难模式',
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
