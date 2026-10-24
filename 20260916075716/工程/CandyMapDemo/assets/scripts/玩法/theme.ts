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
  /** 切换按钮上显示的名字 */
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
  /** 返回 / 提示 / 切换按钮填充色 */
  backFill: Color;
  hintFill: Color;
  switchFill: Color;
  /** 棋盘底板：candy=木桌 / clean=白卡 / journal=贴纸页 */
  panelFillA: Color;
  panelFillB: Color;
  panelBorder: Color;
  /** 融合环：颜色 / 线宽（journal 用红「虚线感」——Graphics 无虚线，用细双线近似） */
  ringColor: Color;
  ringWidth: number;
  /** 融合环是否画成「细线 + 外扩贴边」的手账红笔感 */
  ringSketchy: boolean;
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

/** 当前主题（纯数据，调用方据此画 Graphics / 设字体） */
export function currentTheme(): GameTheme {
  return THEMES[currentId];
}

/** 主题变更订阅（GameBootstrap 用它重建背景 / HUD / 棋盘） */
export function onThemeChanged(cb: Listener): void {
  listeners.push(cb);
}

/** 切到三主题的下一个并持久化；返回新主题 */
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
