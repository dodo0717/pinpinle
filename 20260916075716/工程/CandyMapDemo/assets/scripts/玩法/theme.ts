/**
 * 对局界面三主题（2026-10-24，对应 design/ 三原型的真机版）：
 *   candy  「糖果嘉年华」—— 糖果传奇流派：紫罗兰夜空 + 木牌 HUD + 金融合环
 *   clean  「果冻乐园」—— Royal Match 流派：云白天 + 白胶囊 HUD + 金环细线
 *   journal「贴纸手账」—— 本作专属：纸张天 + 牛皮纸 HUD + 印章红虚线环
 *
 * 设计原则：**只换皮，不动玩法**——所有主题读同一份引擎与贴图，主题只决定
 * Graphics 画出来的颜色 / 圆角 / 线宽 / 字体，切换即时生效（GameBootstrap 收到
 * 变更事件后重建背景 + HUD + 棋盘视图）。
 *
 * 持久化：wx storage（微信）/ localStorage（浏览器）/ 内存兜底，与 storage.ts 同一套降级思路。
 */

import { Color } from 'cc';

export type ThemeId = 'candy' | 'clean' | 'journal';

export interface GameTheme {
  id: ThemeId;
  /** 名字 */
  name: string;
  /** 对局背景（垂直渐变的上下端色） */
  bgTop: Color;
  bgBottom: Color;
  /** HUD 形态：candy/journal = 整条横牌；clean = 三只悬浮胶囊 */
  hudStyle: 'bar' | 'pills';
  /** 横牌渐变上下色（pills 形态用 capsule 填充色） */
  hudFillA: Color;
  hudFillB: Color;
  /** HUD 主文字色 */
  hudText: Color;
  /** HUD 数值强调色（时间 / 分数） */
  hudAccent: Color;
  /** 文字是否要描边式的重投影（candy 的游戏字风） */
  textShadow: boolean;
  /** 楷体手写感（journal 专属） */
  fontFamily: string;
  /** 返回 / 提示按钮填充色 */
  backFill: Color;
  hintFill: Color;
  switchFill: Color;
  /** 棋盘底板 */
  panelFillA: Color;
  panelFillB: Color;
  panelBorder: Color;
  /** 融合环 */
  ringColor: Color;
  ringWidth: number;
  /** 融合环手账红笔感 */
  ringSketchy: boolean;
  /** 全套文案（照抄原型） */
  copy: ThemeCopy;
}

/** 主题文案表 —— 三个原型的完整文案照抄 */
export interface ThemeCopy {
  /** HUD 上的模式标签 */
  modeLabel: string;
  /** 棋盘下方的操作提示 */
  boardHint: string;
  /** 连击词（按连击数升序取，不够用最后一个） */
  combo: string[];
  /** 荣誉头衔（3星/2星/1星） */
  honor: [string, string, string];
  /** 结算表：本局得分 */
  winScore: string;
  /** 结算表：拼好贴纸 */
  winStickers: string;
  /** 结算表：累计总分 */
  winTotal: string;
  /** 结算表：新纪录角标 */
  newBest: string;
  /** 「下一关」按钮 */
  nextLevel: string;
  /** 「返回地图」按钮 */
  backToMap: string;
  /** 失败标题 */
  failTitle: string;
  /** 失败副标题（模板：{need} = 差多少分） */
  failSub: (need: number) => string;
  /** 续命标题 */
  reviveTitle: string;
  /** 续命说明 */
  reviveSub: string;
  /** 续命广告标签 */
  reviveAd: string;
  /** 续命按钮 */
  reviveBtn: string;
  /** 放弃按钮 */
  giveUp: string;
  /** 通关弹窗的卡片底色 */
  cardBg: Color;
  /** 通关弹窗的卡片边框色 */
  cardBorder: Color;
  /** 荣誉头衔文字色 */
  honorColor: Color;
  /** 结算表底色 */
  tallyBg: Color;
  /** 主按钮（下一关/续命）填充色 */
  primaryFill: Color;
  /** 主按钮底边色（按压立体感） */
  primaryEdge: Color;
  /** 副按钮（返回/放弃）填充色 */
  secondaryFill: Color;
  /** 弹窗标题字号 */
  honorFontSize: number;
}

const SANS = '"HarmonyOS Sans SC","PingFang SC","Microsoft YaHei",sans-serif';
const KAI = '"KaiTi","STKaiti","楷体","PingFang SC",sans-serif';

export const THEMES: Record<ThemeId, GameTheme> = {
  candy: {
    id: 'candy',
    name: '糖果嘉年华',
    bgTop: new Color(155, 109, 214),
    bgBottom: new Color(91, 46, 147),
    hudStyle: 'bar',
    hudFillA: new Color(169, 113, 59),
    hudFillB: new Color(139, 90, 43),
    hudText: new Color(255, 246, 233),
    hudAccent: new Color(255, 232, 155),
    textShadow: true,
    fontFamily: SANS,
    backFill: new Color(107, 63, 24),
    hintFill: new Color(126, 217, 87),
    switchFill: new Color(255, 111, 165),
    panelFillA: new Color(169, 113, 59),
    panelFillB: new Color(139, 90, 43),
    panelBorder: new Color(107, 63, 24),
    ringColor: new Color(255, 201, 60),
    ringWidth: 5,
    ringSketchy: false,
    copy: {
      modeLabel: '简单模式',
      boardHint: '拖碎片换位，四块拼成完整贴纸即消除',
      combo: ['漂亮！', '厉害！', '太赞了！', '无敌了！'],
      honor: ['超神！', '王者！', '优秀！'],
      winScore: '本局得分',
      winStickers: '拼好贴纸',
      winTotal: '累计总分',
      newBest: '新纪录',
      nextLevel: '下一关 ▶',
      backToMap: '返回地图',
      failTitle: '时间到！',
      failSub: (n) => `就差 ${n} 分就能拿第 1 颗星`,
      reviveTitle: '续命 30 秒',
      reviveSub: '接着刚才的分数继续，已拼好的进度都还在',
      reviveAd: '▶ 看广告免费续命 · 加 30 秒',
      reviveBtn: '▶ 续命 30 秒',
      giveUp: '就这样吧，回地图',
      cardBg: new Color(255, 249, 238),
      cardBorder: new Color(255, 223, 158),
      honorColor: new Color(255, 91, 77),
      tallyBg: new Color(255, 243, 214),
      primaryFill: new Color(126, 217, 87),
      primaryEdge: new Color(78, 168, 50),
      secondaryFill: new Color(185, 177, 201),
      honorFontSize: 52,
    },
  },
  clean: {
    id: 'clean',
    name: '果冻乐园',
    bgTop: new Color(234, 246, 255),
    bgBottom: new Color(187, 223, 244),
    hudStyle: 'pills',
    hudFillA: new Color(255, 255, 255),
    hudFillB: new Color(255, 255, 255),
    hudText: new Color(34, 48, 63),
    hudAccent: new Color(245, 166, 35),
    textShadow: false,
    fontFamily: SANS,
    backFill: new Color(255, 255, 255),
    hintFill: new Color(47, 191, 143),
    switchFill: new Color(245, 166, 35),
    panelFillA: new Color(255, 255, 255),
    panelFillB: new Color(250, 253, 255),
    panelBorder: new Color(228, 237, 244),
    ringColor: new Color(245, 166, 35),
    ringWidth: 4,
    ringSketchy: false,
    copy: {
      modeLabel: '简单',
      boardHint: '拖碎片换位，四块拼成完整贴纸即消除',
      combo: ['连上了', '再连锁', '三连锁！', '停不下来'],
      honor: ['超神通关', '王者通关', '优秀通关'],
      winScore: '本局得分',
      winStickers: '拼好贴纸',
      winTotal: '累计总分',
      newBest: '新纪录',
      nextLevel: '下一关',
      backToMap: '返回地图',
      failTitle: '就差一点点',
      failSub: (n) => `再得 ${n} 分就能摘下第 1 颗星`,
      reviveTitle: '续命 30 秒',
      reviveSub: '接着刚才的分数继续，已拼好的进度都还在',
      reviveAd: '▶ 免费广告',
      reviveBtn: '▶ 看广告，继续拼',
      giveUp: '回地图',
      cardBg: new Color(255, 255, 255),
      cardBorder: new Color(228, 237, 244),
      honorColor: new Color(176, 114, 20),
      tallyBg: new Color(246, 250, 253),
      primaryFill: new Color(245, 166, 35),
      primaryEdge: new Color(200, 122, 30),
      secondaryFill: new Color(240, 245, 249),
      honorFontSize: 32,
    },
  },
  journal: {
    id: 'journal',
    name: '贴纸手账',
    bgTop: new Color(251, 244, 228),
    bgBottom: new Color(241, 230, 204),
    hudStyle: 'bar',
    hudFillA: new Color(200, 155, 109),
    hudFillB: new Color(168, 123, 78),
    hudText: new Color(255, 249, 236),
    hudAccent: new Color(255, 233, 199),
    textShadow: false,
    fontFamily: KAI,
    backFill: new Color(138, 123, 102),
    hintFill: new Color(200, 155, 109),
    switchFill: new Color(214, 69, 69),
    panelFillA: new Color(255, 253, 246),
    panelFillB: new Color(251, 244, 228),
    panelBorder: new Color(203, 185, 153),
    ringColor: new Color(214, 69, 69),
    ringWidth: 3,
    ringSketchy: true,
    copy: {
      modeLabel: '简单',
      boardHint: '拖碎片换位，四块拼成完整贴纸就贴好啦',
      combo: ['贴得真顺！', '手感来了！', '太会贴了！', '手账大师！'],
      honor: ['超神', '王者', '优秀'],
      winScore: '本局',
      winStickers: '贴好',
      winTotal: '累计',
      newBest: '新纪录',
      nextLevel: '下一页 ▶',
      backToMap: '回地图',
      failTitle: '这一页还差一点…',
      failSub: (n) => `再得 ${n} 分就能摘下第 1 颗星`,
      reviveTitle: '续命 30 秒',
      reviveSub: '已拼好的进度都在，接着刚才的分数继续',
      reviveAd: '▶ 看免费广告',
      reviveBtn: '续命 30 秒',
      giveUp: '回地图',
      cardBg: new Color(255, 253, 246),
      cardBorder: new Color(229, 217, 188),
      honorColor: new Color(214, 69, 69),
      tallyBg: new Color(241, 230, 204),
      primaryFill: new Color(200, 155, 109),
      primaryEdge: new Color(168, 123, 78),
      secondaryFill: new Color(255, 253, 246),
      honorFontSize: 44,
    },
  },
};

const ORDER: ThemeId[] = ['candy', 'clean', 'journal'];
const KEY = 'pinpin.theme';

type Listener = (t: GameTheme) => void;
const listeners: Listener[] = [];

function readStored(): ThemeId | null {
  try {
    const wx = (globalThis as { wx?: any }).wx;
    if (wx && typeof wx.getStorageSync === 'function') {
      const v = wx.getStorageSync(KEY);
      if (typeof v === 'string' && v in THEMES) return v as ThemeId;
    }
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    if (ls) {
      const v = ls.getItem(KEY);
      if (v && v in THEMES) return v as ThemeId;
    }
  } catch {
    /* 读不到按默认 */
  }
  return null;
}

function writeStored(id: ThemeId): void {
  try {
    const wx = (globalThis as { wx?: any }).wx;
    if (wx && typeof wx.setStorageSync === 'function') {
      wx.setStorageSync(KEY, id);
      return;
    }
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    if (ls) ls.setItem(KEY, id);
  } catch {
    /* 存不上就内存态 */
  }
}

let currentId: ThemeId = readStored() ?? 'candy';

/**
 * 关卡 → 主题绑定（2026-10-24）：第 1/2/3/4 关分别用 糖果/果冻/手账/糖果（循环）。
 * 进关时由 GameBootstrap 调用 `setThemeForLevel`，不再需要手动切换。
 */
export function themeForLevel(level: number): GameTheme {
  const idx = (Math.max(1, level) - 1) % ORDER.length;
  return THEMES[ORDER[idx]!];
}

/** 进关时设定主题（GameBootstrap 调用） */
export function setThemeForLevel(level: number): GameTheme {
  const t = themeForLevel(level);
  if (currentId !== t.id) {
    currentId = t.id;
    writeStored(currentId);
    for (const cb of listeners.slice()) cb(t);
  }
  return t;
}

/** 当前主题（纯数据，调用方据此画 Graphics / 设字体） */
export function currentTheme(): GameTheme {
  return THEMES[currentId];
}

/** 主题变更订阅（GameBootstrap 用它重建背景 / HUD / 棋盘） */
export function onThemeChanged(cb: Listener): void {
  listeners.push(cb);
}

/** 切到三主题的下一个（调试用，正常流程走 setThemeForLevel） */
export function cycleTheme(): GameTheme {
  const i = ORDER.indexOf(currentId);
  currentId = ORDER[(i + 1) % ORDER.length]!;
  writeStored(currentId);
  const t = THEMES[currentId];
  for (const cb of listeners.slice()) cb(t);
  return t;
}

/** 测试用：直接设定 + 不落盘 */
export function setThemeForTest(id: ThemeId): void {
  currentId = id;
}
