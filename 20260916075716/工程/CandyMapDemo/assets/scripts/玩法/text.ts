/**
 * 文案库 —— 对应 web/ui/text.ts（M5）。
 *
 * 单独一个文件的理由：文案是**会被产品逐句改**的东西，散落在逻辑里就只能靠
 * 全局搜索去改，改漏一句就是线上事故。集中之后「改文案 = 只动这个文件」。
 */

import { STAMINA_MAX } from '../核心/index';
import { AD_STAMINA_DAILY_MAX } from './meta';

/** 2026-10 命名统一：「普通」一律改叫「简单」，全项目不再出现「普通」二字 */
export const MODE_LABEL = { normal: '简单', nightmare: '困难' } as const;

export const HOME = {
  modeNormal: '简单模式',
  modeNightmare: '困难模式',
  staminaFull: '体力已满',
  staminaShort: '体力不够啦',
  staminaGain: (n: number, max: number) => `体力 +${n}（当前 ${n}/${max}）`,
  adLeft: (n: number) => `今日还可看 ${n} 次广告加体力`,
  adNone: '今日加体力次数已用完',
  lockedToast: '先通关前面的关卡哦',
  loading: '正在加载素材…',
} as const;

export const HONOR = {
  godTitle: '🏆 超神通关！',
  kingTitle: '👑 王者通关！',
  passTitle: '🎉 通关啦！',
  godLine: (rank: number) => `你冲进了本关前 ${rank} 名！`,
  kingLine: (pct: string) => `你超越了本关 ${pct}% 的玩家！`,
  starLine: (stars: number) => `本关评价 ${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}`,
  scoreLine: (score: number) => `本关得分 ${score}`,
  bestLine: (best: number) => `历史最高 ${best}`,
  next: '下一关',
  retry: '再玩一次',
  backHome: '回主界面',
  rank: '查看排行榜',
} as const;

export const REVIVE = {
  title: '差一点点！',
  line1: (sec: number) => `再看一段广告，加 ${sec} 秒继续拼`,
  line2: '（每局限一次，续命局最多 1★）',
  watch: '看广告续命',
  giveUp: '放弃本局',
  gained: (sec: number) => `已加时 ${sec} 秒，继续！`,
} as const;

export const FAIL = {
  title: '时间到',
  line1: (score: number) => `本关得分 ${score}`,
  line2: (s1: number, s2: number, s3: number) => `星线 ${s1} / ${s2} / ${s3}`,
  line3: '还差一点点就过关了',
  retry: '再玩一次',
  backHome: '回主界面',
} as const;

export const SAVE = {
  memoryOnly: '当前环境无法本地存档，进度只保留在本次游戏内',
  errorTitle: '⚠️ 存档读取失败',
  errorLines: (issues: string[]) => issues.slice(0, 3),
  retry: '重试读取',
  reset: '重置存档并继续',
  retryStillBad: '存档仍然无法读取，请重置',
  repaired: (n: number) => `存档已自动修复 ${n} 处，继续游戏`,
  resumeTitle: '⏸ 继续上次的挑战？',
  resumeLines: (mode: string, level: number, left: string) => [
    `上次玩到「${mode} · 第 ${level} 关」`,
    `剩余时间 ${left}`,
  ],
  resumeYes: '继续',
  resumeNo: '放弃并重开',
  resumed: (level: number, left: string, started: boolean) =>
    `已从第 ${level} 关恢复 · 剩余 ${left}` + (started ? '（点一下棋盘继续计时）' : ''),
  offlineTimeout: '离开期间倒计时已走完，直接结算本局',
  discarded: (level: number) => `已放弃第 ${level} 关的进度`,
  sessionDropped: (level: number) => `上次的第 ${level} 关素材尚未补齐，断点已作废`,
} as const;

export const ADS = {
  staminaFull: `体力已满（上限 ${STAMINA_MAX}）`,
  dailyLimit: `今日加体力次数已用完（${AD_STAMINA_DAILY_MAX} 次）`,
  notReady: '广告还没准备好，稍后再试',
  watched: '已看完广告',
} as const;

export const GUIDE = {
  step1: '同一张图被切成 4 块，把它们拼回一整张就能消掉',
  step2: '按住任意一块拖动，整片会跟着一起挪',
  step3: '拼成完整的一张图就会消除得分',
  step4: '消掉后上面的块会掉下来补位，可以连消',
  step5: '时间到就结算，够到星线才算通关',
} as const;

export const COLLECTION = {
  title: '图鉴',
  progress: (n: number, total: number) => `已收集 ${n} / ${total}`,
  locked: '通关对应关卡即可解锁',
  lockedHint: '？？？',
} as const;

export const BOARD = {
  title: '排行榜',
  total: (n: number) => `本关共 ${n} 人参与`,
  myRank: (r: number) => `我的名次 第 ${r} 名`,
  notOnBoard: '达到 3★ 才能上榜哦',
  prev: '上一页',
  next: '下一页',
} as const;

export const SETTINGS = {
  title: '设置',
  sound: '音效',
  bgm: '音乐',
  voice: '教学语音', // 2026-10-26 新增（2026-10-30 移植）：序章里那句简短文本要不要念出来
  on: '开',
  off: '关',
  about: '关于游戏',
  version: (v: string): string => `版本 ${v}`,
  reset: '重置存档',
  resetConfirmTitle: '确定重置存档？',
  resetConfirmLine: '所有进度、图鉴、体力都会清空，且无法恢复',
  resetYes: '确定重置',
  resetNo: '取消',
  resetDone: '存档已重置',
} as const;

/* ------------------------------------------------------------------ 提示文案 */

/** 非法交换的原因 → 提示（原版 doMove 的文案分支） */
export const MOVE = {
  notAdjacent: '困难模式只能一次挪一格',
  blocked: '这个方向被挡住了',
  noSpace: '那边没有空位',
} as const;

/* ------------------------------------------------------------------ 排行榜整屏（§9.3，2026-10-30 移植） */

/**
 * 排行榜整屏文案（从 web/ui/text.ts 的 LEADERBOARD 移植）。
 * ⚠️ 旧灰盒面板用的 `BOARD` 先保留，整屏上线后替换。
 */
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
  header: (level: number): string => `第 ${level} 关`,
  mineRankLabel: '我的排名',
  mineScoreLabel: '累计总分',
  mineLevelScoreLabel: '本关最高分',
  mineStarsLabel: '累计星数',
  rankValue: (rank: number): string => (rank > 0 ? `${rank}` : '未上榜'),
  scoreValue: (score: number): string => `${score}`,
  starsValue: (stars: number): string => `⭐${stars}`,
  page: (page: number, pages: number): string => `第 ${page} / ${pages} 页`,
  prevPage: '◀ 上一页',
  nextPage: '下一页 ▶',
  empty: '暂无记录，快来挑战吧！',
  challenge: '▶ 挑战本关（消耗1体力）',
  challengeLocked: '通关前一关后解锁',
  challengeUnclear: '通关后解锁',
  challengeUnavailable: (level: number): string => `第 ${level} 关暂未开放（所需素材张数不足）`,
  challengeNoStamina: '体力不足，请点击主界面+看广告或返回主页',
  prev: '◀ 上一关',
  next: '下一关 ▶',
  scoreUnit: (score: number): string => `${score} 分`,
} as const;

/* ------------------------------------------------------------------ 新手教学（序章，2026-10-30 移植） */

/**
 * 序章教学文案（2026-10-26 新增）。
 *
 * ⚠️ 口径：分数 = **消除组数**（拼成一张整图 +1），所以一律说「再拼 X 组」，
 * 不要说「再得 X 分」—— 玩家会以为是另一套分数系统。
 * 详细方案见 `docs/新手教学（序章）策划案.md`。
 */
export const TUTORIAL = {
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

  step1: '把同一只萌宠的碎片拼到一起',
  step2: '拼好的整片会一起走，按住拖动试试',
  star1: '已经 1 星！再拼 2 组就 3 星',
  star2: '再拼 1 组就 3 星',
  step4: '正式关卡里它会一直走，时间用完就结算',
  timeFrozen: '序章不计时',

  howTitle: '怎么玩',
  how1: '拖动：按住碎片移动，拼好的整片会一起走',
  how2: '拼合：同一只萌宠的 4 块贴到一起，自动拼成一张整图',
  how3: '消除：拼成 2×2 就消除 +1 组，上面的碎片落下来补位',
  how4: '目标：拼够旗子上的分数就过关，多拼多得星',

  noteTime: '🕒 倒计时走完，按最终所得分数结算',
  noteStar: '⭐ 多拼多得星，成绩进排行榜',
  noteNightmare: '🔒 困难关：只能拖动交换相邻的碎片（教学会单独讲这一条）',

  skip: '跳过教学',
  doneTitle: '教学完成',
  doneLines: [
    '倒计时走完，按最终所得分数结算',
    '你的成绩会进排行榜，和别的玩家比名次',
    '每拿 10 颗星，解锁一张图鉴贴纸',
  ],
  donePrimary: '继续第 1 关',
  doneSecondary: '回首页',
  rewardLine: (n: string) => `🎁 教学奖励：体力 +${n}`,
  rewardFreeLevel: '🎁 教学奖励：第 1 关免 1 颗体力',

  nightmareRule: '困难模式：一次只能挪一格',
  nightmareStep2: '把 4 块拼成一张整图',
} as const;

/**
 * 教学语音 / 简短文本（序章 v4）。
 *
 * ⚠️ 简单与困难是两套：简单讲「任意位置互换 → 拖动 → 目标旗 → 倒计时 → 整片」；
 * 困难只讲「相邻互换 → 挪一格 → 目标旗」（不讲倒计时/整片）。
 * 每句控制在 16 字以内：既是屏幕短句，也是要念出来的话。
 */
export const TUTORIAL_VOICE = {
  normal: {
    rule: '简单关：任意位置的碎片都能互换',
    drag: '按住这块碎片，拖到缺口上',
    flag: '旗子上的数字，是过关要拼的分数',
    time: '倒计时走完，按最终分数结算',
    timeDone: '时间一到，就按这个分数结算',
    group: '拼好的整片会一起走，拖一下试试',
  },
  nightmare: {
    rule: '困难关：只能交换相邻的碎片',
    drag: '挪一格，把这块补进缺口',
    nextStep: '继续往缺口挪一格',
    flag: '旗子上的数字，是过关要拼的分数',
  },
  done: '教学完成，去玩第 1 关吧',
} as const;

/* ------------------------------------------------------------------ 关卡地图 / 底部页签栏 */

/** 关卡地图整屏文案（地图节点锁因 / 吊牌 / 困难门槛提示） */
export const MAP = {
  title: '🗺 关卡地图',
  locked: (prev: number): string => `先通关第 ${prev} 关`,
  nightmareLocked: '三星通关后开启困难模式',
  nightmareHint: '三星通关后开启困难模式',
  level: (level: number): string => `第 ${level} 关`,
  best: (stars: string): string => `最好成绩 ${stars}`,
  start: '▶ 开始',
  later: '稍后再说',
} as const;

/** 底部页签栏（非玩法屏常驻，玩法屏隐藏 —— 局内不允许跳走的入口） */
export const TABBAR = {
  home: '首页',
  leaderboard: '排行榜',
  collection: '图鉴',
  settings: '设置',
} as const;
