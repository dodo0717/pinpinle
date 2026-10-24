/**
 * 文案库 —— 对应 web/ui/text.ts（M5）。
 *
 * 单独一个文件的理由：文案是**会被产品逐句改**的东西，散落在逻辑里就只能靠
 * 全局搜索去改，改漏一句就是线上事故。集中之后「改文案 = 只动这个文件」。
 */

import { STAMINA_MAX } from '../core/index.js';
import { AD_STAMINA_DAILY_MAX } from './meta.js';

/** 2026-10 命名统一：「普通」一律改叫「简单」，全项目不再出现「普通」二字 */
export const MODE_LABEL = { normal: '简单', nightmare: '困难' }         ;

export const HOME = {
  modeNormal: '简单模式',
  modeNightmare: '困难模式',
  staminaFull: '体力已满',
  staminaShort: '体力不够啦',
  staminaGain: (n        , max        ) => `体力 +${n}（当前 ${n}/${max}）`,
  adLeft: (n        ) => `今日还可看 ${n} 次广告加体力`,
  adNone: '今日加体力次数已用完',
  lockedToast: '先通关前面的关卡哦',
  loading: '正在加载素材…',
}         ;

/** 首页地图（对应 web/ui/text.ts 的 HOME / MAP / TABBAR，口径保持一致） */
export const MAP_TEXT = {
  /** 顶栏昵称 / 头像：还没有账号系统，先用占位（接账号时只改这里） */
  nickname: '玩家',
  avatar: '🐶',
  staminaCountdown: (mmss        ) => `下颗体力 ${mmss}`,
  locked: (prev        ) => `先通关第 ${prev} 关`,
  /** 困难模式门槛：同一关必须先在简单模式拿到 3 星 */
  nightmareLocked: '三星通关后开启困难模式',
  level: (level        ) => `第 ${level} 关`,
  starLine: (s1        , s3        ) => `1星 ${s1} 分   |   3星 ${s3} 分`,
  play: 'Play',
  loading: (pct        ) => `${pct}%`,
}         ;

/** 排行榜 / 图鉴 / 设置三个整屏面板（对应 web/ui/text.ts 的 LEADERBOARD / COLLECTION / SETTINGS） */
export const PANEL = {
  boardTitle: '排行榜',
  tabTotal: '总分榜',
  tabLevel: '关卡榜',
  tabFriend: '好友榜',
  friendNA: '好友榜仅在微信内可用',
  colRank: '排名',
  colName: '昵称',
  colSimple: '简单',
  colHard: '困难',
  colTotal: '总分',
  level: (level        ) => `第 ${level} 关`,
  mineRankLabel: '我的排名',
  mineScoreLabel: '累计总分',
  mineLevelScoreLabel: '本关最高分',
  mineStarsLabel: '累计星数',
  rankValue: (rank        ) => (rank > 0 ? `${rank}` : '未上榜'),
  starsValue: (stars        ) => `⭐${stars}`,
  page: (page        , pages        ) => `第 ${page} / ${pages} 页`,
  prevPage: '◀ 上一页',
  nextPage: '下一页 ▶',
  empty: '暂无记录，快来挑战吧！',
  challenge: '▶ 挑战本关（消耗1体力）',
  challengeLocked: '通关前一关后解锁',
  challengeUnclear: '通关后解锁',
  collectionTitle: '图鉴',
  collected: (got        , total        ) => `已收集：${got} / ${total}`,
  lockedToast: '每获得 10 颗星解锁一张',
  settingsTitle: '设置',
  music: '音乐',
  sfx: '音效',
  version: '版本 v1.0',
  reset: '重置存档',
}         ;

export const TABBAR = {
  home: '首页',
  leaderboard: '排行榜',
  collection: '图鉴',
  settings: '设置',
}         ;

export const HONOR = {
  godTitle: '🏆 超神通关！',
  kingTitle: '👑 王者通关！',
  passTitle: '🎉 通关啦！',
  godLine: (rank        ) => `你冲进了本关前 ${rank} 名！`,
  kingLine: (pct        ) => `你超越了本关 ${pct}% 的玩家！`,
  starLine: (stars        ) => `本关评价 ${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}`,
  scoreLine: (score        ) => `本关得分 ${score}`,
  bestLine: (best        ) => `历史最高 ${best}`,
  next: '下一关',
  retry: '再玩一次',
  backHome: '回主界面',
  rank: '查看排行榜',
}         ;

export const REVIVE = {
  title: '差一点点！',
  line1: (sec        ) => `再看一段广告，加 ${sec} 秒继续拼`,
  line2: '（每局限一次，续命局最多 1★）',
  watch: '看广告续命',
  giveUp: '放弃本局',
  gained: (sec        ) => `已加时 ${sec} 秒，继续！`,
}         ;

export const FAIL = {
  title: '时间到',
  line1: (score        ) => `本关得分 ${score}`,
  line2: (s1        , s2        , s3        ) => `星线 ${s1} / ${s2} / ${s3}`,
  line3: '还差一点点就过关了',
  retry: '再玩一次',
  backHome: '回主界面',
}         ;

export const SAVE = {
  memoryOnly: '当前环境无法本地存档，进度只保留在本次游戏内',
  errorTitle: '⚠️ 存档读取失败',
  errorLines: (issues          ) => issues.slice(0, 3),
  retry: '重试读取',
  reset: '重置存档并继续',
  retryStillBad: '存档仍然无法读取，请重置',
  repaired: (n        ) => `存档已自动修复 ${n} 处，继续游戏`,
  resumeTitle: '⏸ 继续上次的挑战？',
  resumeLines: (mode        , level        , left        ) => [
    `上次玩到「${mode} · 第 ${level} 关」`,
    `剩余时间 ${left}`,
  ],
  resumeYes: '继续',
  resumeNo: '放弃并重开',
  resumed: (level        , left        , started         ) =>
    `已从第 ${level} 关恢复 · 剩余 ${left}` + (started ? '（点一下棋盘继续计时）' : ''),
  offlineTimeout: '离开期间倒计时已走完，直接结算本局',
  discarded: (level        ) => `已放弃第 ${level} 关的进度`,
  sessionDropped: (level        ) => `上次的第 ${level} 关素材尚未补齐，断点已作废`,
}         ;

export const ADS = {
  staminaFull: `体力已满（上限 ${STAMINA_MAX}）`,
  dailyLimit: `今日加体力次数已用完（${AD_STAMINA_DAILY_MAX} 次）`,
  notReady: '广告还没准备好，稍后再试',
  watched: '已看完广告',
}         ;

export const GUIDE = {
  step1: '同一张图被切成 4 块，把它们拼回一整张就能消掉',
  step2: '按住任意一块拖动，整片会跟着一起挪',
  step3: '拼成完整的一张图就会消除得分',
  step4: '消掉后上面的块会掉下来补位，可以连消',
  step5: '时间到就结算，够到星线才算通关',
}         ;

export const COLLECTION = {
  title: '图鉴',
  progress: (n        , total        ) => `已收集 ${n} / ${total}`,
  locked: '通关对应关卡即可解锁',
  lockedHint: '？？？',
}         ;

export const BOARD = {
  title: '排行榜',
  total: (n        ) => `本关共 ${n} 人参与`,
  myRank: (r        ) => `我的名次 第 ${r} 名`,
  notOnBoard: '达到 3★ 才能上榜哦',
  prev: '上一页',
  next: '下一页',
}         ;

export const SETTINGS = {
  title: '设置',
  sound: '音效',
  bgm: '背景音乐',
  on: '开',
  off: '关',
  reset: '重置存档',
  resetConfirmTitle: '确定重置存档？',
  resetConfirmLine: '所有进度、图鉴、体力都会清空，且无法恢复',
  resetYes: '确定重置',
  resetNo: '取消',
  resetDone: '存档已重置',
}         ;

/* ------------------------------------------------------------------ 提示文案 */

/** 非法交换的原因 → 提示（原版 doMove 的文案分支） */
export const MOVE = {
  notAdjacent: '困难模式只能一次挪一格',
  blocked: '这个方向被挡住了',
  noSpace: '那边没有空位',
}         ;
