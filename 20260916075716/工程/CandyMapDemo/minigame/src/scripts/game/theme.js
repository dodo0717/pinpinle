/**
 * 对局界面三主题（2026-10-25 重做，对应 design/ 三原型的真机版）：
 *   classic「原样式」—— 第 1 关（及第 5 关之后）：橙色顶栏 + 通用弹窗，即三主题之前的版本
 *   candy  「糖果嘉年华」—— 糖果传奇流派：紫罗兰夜空 + 木牌 HUD + 三星插座 + 木桌棋盘
 *   clean  「果冻乐园」—— Royal Match 流派：云白天 + 白胶囊 HUD + 白卡棋盘 + 底部 sheet 结算
 *   journal「贴纸手账」—— 本作专属：纸张 + 和纸胶带 + 手写楷体 + 拍立得/红章结算
 *
 * 设计原则：**只换皮，不动玩法**——所有主题读同一份引擎与贴图。
 * 本文件只放「数据」：配色（P_*）、字体、全套文案；怎么画在 themeHud / themeResult /
 * themeExtras / BoardView 里按 `theme.id` 分支。
 *
 * 字体：candy 用站酷快乐体、journal 用霞鹜文楷（均 OFL，子集化后打进包，见
 * tools/subset-fonts.py）；clean 用系统黑体粗体。字族名是别名，运行时
 * （cc-shim registerFont）映射到 wx.loadFont 返回的真实字族；没加载上就落到系统字体。
 */

import { Color } from '../../runtime/cc.js';

/**
 * classic = 原来的样式（橙色顶栏 + 通用弹窗，三主题之前的版本，10-25 按需求给第 1 关恢复）；
 * 其余三套是 design/ 三原型。
 */
                                                                

const c = (h        , a = 255)        =>
  new Color(parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), a);

/** 原型 A 的 CSS 变量 */
export const P_CANDY = {
  skyA: c('#9B6DD6'), skyB: c('#6C3FA8'), skyC: c('#5B2E93'),
  wood: c('#A9713B'), woodDark: c('#8B5A2B'), woodEdge: c('#6B3F18'),
  candy: c('#FF6FA5'), candyEdge: c('#C94B7E'),
  gold: c('#FFC93C'), goldLight: c('#FFE58A'), goldDark: c('#E8A008'),
  cream: c('#FFF6E9'), capText: c('#FFDFB0'), goalText: c('#FFE9C7'), hint: c('#E9D8FF'),
  cta: c('#FF5B4D'), ctaEdge: c('#C93325'),
  go: c('#7ED957'), goEdge: c('#4EA832'),
  ghost: c('#B9B1C9'), ghostEdge: c('#8E86A0'),
  socketA: c('#57358E'), socketB: c('#45276F'),
  cardA: c('#FFF9EE'), cardB: c('#FFEEDA'), cardBorder: c('#FFDF9E'), failBorder: c('#FFC9A3'),
  ink: c('#6B4A1D'), tally: c('#FFF3D6'), total: c('#D17515'), dash: c('#E8C58A'), adNote: c('#A9782F'),
};

/** 原型 B 的 CSS 变量 */
export const P_CLEAN = {
  skyA: c('#EAF6FF'), skyB: c('#CDE9FB'), skyC: c('#BBDFF4'),
  card: c('#FFFFFF'), ink: c('#22303F'), inkSoft: c('#7C8A99'),
  gold: c('#F5A623'), goldLight: c('#FFD98E'), goldSoft: c('#FDEBC8'), goldBtn: c('#FFC872'),
  mint: c('#2FBF8F'), mintSoft: c('#DFF5EC'),
  coral: c('#FF6B57'), coralSoft: c('#FFE4DF'),
  track: c('#EFF4F8'), trackStar: c('#C4CFDA'), cell: c('#F3F8FC'), line: c('#E4EDF4'),
  tally: c('#F6FAFD'), grab: c('#E1E9F0'), ringBg: c('#EAF1F7'),
  honorText: c('#B07214'), honorText3: c('#8A5A0E'), honor3A: c('#FFE3A6'),
  adBg: c('#FFF1E0'), adText: c('#C87A1E'),
  shadow: new Color(34, 48, 63, 34),
};

/** 原型 C 的 CSS 变量 */
export const P_JOURNAL = {
  paper: c('#FBF4E4'), paperDeep: c('#F1E6CC'), sheet: c('#FFFDF6'),
  kraft: c('#C89B6D'), kraftDark: c('#A87B4E'),
  ink: c('#4A3B2A'), inkSoft: c('#8A7B66'), pencil: c('#6E6152'),
  washiPink: c('#F4A9B8'), washiBlue: c('#A9C8F4'),
  stamp: c('#D64545'), stampSoft: c('#FFF3EE'),
  border: c('#E5D9BC'), rail: c('#CBBE9E'), dots: c('#E3D7B8'), ringBg: c('#E2D5B4'), starOff: c('#D8CBA8'),
  btnText: c('#FFF9EC'),
};

const SYS = '"PingFang SC","HarmonyOS Sans SC","Microsoft YaHei","Helvetica Neue",sans-serif';
/** 站酷快乐体（子集）——圆润游戏字 */
export const FONT_CANDY = `"PPCandy",${SYS}`;
/** 霞鹜文楷（子集）——手写楷体；系统楷体只在 Windows/macOS 有，手机上靠它 */
export const FONT_HAND = `"PPHand","KaiTi","STKaiti",${SYS}`;
export const FONT_SANS = SYS;

                            
                             
                                                   
                  
                    
             
                  
                   
                  
                         
                  
                       
                                  
                   
                      
                   
                  
                    
                    
                    
                                    
                     
                       
                                       
                    
                                    
                                     
                 
                
                     
                                 
                   
 

                            
              
               
                          
               
                   
               
            
                   
                    
             
              
                  
 

const GUIDE_STEPS                     = [
  ['每格是一张贴纸的 1/4', '左上、右上、左下、右下四块'],
  ['拖动碎片换位置', '同一张图、位置摆对就会粘在一起'],
  ['四块拼成完整贴纸', '整张消除得分，连锁还有加分'],
];

export const THEMES                             = {
  // 原样式：HUD / 弹窗走 GameBootstrap 的 classic 分支与 GameDialog，这里的文案只做兜底
  classic: {
    id: 'classic',
    name: '经典',
    font: FONT_SANS,
    body: FONT_SANS,
    ringColor: new Color(255, 214, 92),
    ringWidth: 5,
    mask: new Color(0, 0, 0, 150),
    copy: {
      modeTag: (m, lv) => `${m} · 第 ${lv} 关`,
      boardHint: '',
      hintBtn: '提示',
      scoreCap: '分数',
      goalCap: '星线',
      combo: ['连锁 ×2', '连锁 ×3', '连锁 ×4', '连锁 ×5'],
      honor: ['超神', '王者', '优秀'],
      winScore: '本局得分',
      winStickers: '拼好贴纸',
      winTotal: '累计总分',
      newBest: '新纪录',
      nextLevel: '下一关',
      backToMap: '返回地图',
      failTitle: '时间到',
      failSub: (n) => `再得 ${n} 分就能拿第 1 颗星`,
      failFinalSub: '再来一局试试',
      reviveTitle: (s) => `续命 ${s} 秒`,
      reviveSub: '',
      reviveAd: () => '',
      reviveBtn: (s) => `续命 ${s} 秒`,
      giveUp: '回地图',
      retry: '再来一局',
      guideTitle: '怎么玩',
      guideSteps: GUIDE_STEPS,
      guideBtn: '知道了',
    },
  },
  candy: {
    id: 'candy',
    name: '糖果嘉年华',
    font: FONT_CANDY,
    body: FONT_CANDY,
    ringColor: P_CANDY.gold,
    ringWidth: 7,
    mask: new Color(30, 10, 60, 184),
    copy: {
      modeTag: (m, lv) => `${m}模式 · 第 ${lv} 关`,
      boardHint: '拖碎片换位，四块拼成完整贴纸即消除',
      hintBtn: '提示',
      scoreCap: '分数',
      goalCap: '★线',
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
      failFinalSub: '这次没拿到星，换个思路再来一局',
      reviveTitle: (s) => `续命 ${s} 秒`,
      reviveSub: '接着刚才的分数继续，已拼好的进度都还在',
      // 2026-10-27 评审 P1-8：续命规则事前告知（最高 2★、不计入排行榜）
      reviveAd: (s) => `▶ 看广告续命 +${s} 秒 · 最高 2★ 不计排行`,
      reviveBtn: (s) => `续命 ${s} 秒`,
      giveUp: '就这样吧，回地图',
      retry: '再来一局',
      guideTitle: '怎么玩',
      guideSteps: GUIDE_STEPS,
      guideBtn: '知道了，开玩！',
    },
  },
  clean: {
    id: 'clean',
    name: '果冻乐园',
    font: FONT_SANS,
    body: FONT_SANS,
    ringColor: P_CLEAN.gold,
    ringWidth: 6,
    mask: new Color(24, 38, 52, 107),
    copy: {
      modeTag: (m) => `${m}模式`,
      boardHint: '拖碎片换位，四块拼成完整贴纸即消除',
      hintBtn: '提示',
      scoreCap: '分数',
      goalCap: '星线',
      // 10-25：原来是「连上了 / 再连锁 / 三连锁！」，4 连锁时显示「三连锁」，数字对不上
      combo: ['二连锁！', '三连锁！', '四连锁！', '停不下来'],
      honor: ['超神通关', '王者通关', '优秀通关'],
      winScore: '本局得分',
      winStickers: '拼好贴纸',
      winTotal: '累计总分',
      newBest: '新纪录',
      nextLevel: '下一关',
      backToMap: '返回地图',
      failTitle: '就差一点点',
      failSub: (n) => `再得 ${n} 分就能摘下第 1 颗星`,
      failFinalSub: '这局没摘到星，再来一局试试',
      reviveTitle: (s) => `续命 ${s} 秒`,
      reviveSub: '已拼好的进度都还在\n续命后最高 2★，不计入排行榜',
      reviveAd: () => '▶ 免费广告',
      reviveBtn: () => '▶ 看广告，继续拼',
      giveUp: '回地图',
      retry: '再来一局',
      guideTitle: '怎么玩',
      guideSteps: GUIDE_STEPS,
      guideBtn: '知道了',
    },
  },
  journal: {
    id: 'journal',
    name: '贴纸手账',
    font: FONT_HAND,
    body: FONT_HAND,
    ringColor: P_JOURNAL.stamp,
    ringWidth: 5,
    mask: new Color(74, 59, 42, 140),
    copy: {
      modeTag: (m, lv) => `${m} · 第 ${lv} 关`,
      boardHint: '拖碎片换位，四块拼成完整贴纸就贴好啦',
      hintBtn: '提示',
      scoreCap: '得分',
      goalCap: '星线',
      combo: ['贴得真顺！', '手感来了！', '太会贴了！', '手账大师！'],
      honor: ['超神', '王者', '优秀'],
      winScore: '本局',
      winStickers: '贴好',
      winTotal: '累计',
      newBest: '新纪录',
      nextLevel: '下一页 ▶',
      backToMap: '回地图',
      failTitle: '这一页还差一点…',
      failSub: (n) => `再得 ${n} 分就能摘下第 1 颗星\n贴纸们等你回来继续`,
      failFinalSub: '这一页先放一放\n换个思路再贴一次吧',
      reviveTitle: (s) => `续命 ${s} 秒`,
      reviveSub: '已拼好的进度都在\n续命后最高 2★，不计入排行榜',
      reviveAd: () => '▶ 看免费广告',
      reviveBtn: (s) => `续命 ${s} 秒`,
      giveUp: '回地图',
      retry: '重贴这页',
      guideTitle: '怎么贴',
      guideSteps: GUIDE_STEPS,
      guideBtn: '知道啦，开贴！',
    },
  },
};

const ORDER            = ['classic', 'candy', 'clean', 'journal'];

/** 关卡 → 主题（10-25）：第 2/3/4 关是三原型，其余关卡（含第 1 关）是原样式 */
const LEVEL_THEME                          = { 2: 'candy', 3: 'clean', 4: 'journal' };
const KEY = 'pinpin.theme';

                                       
const listeners             = [];

function readStored()                 {
  try {
    const wx = (globalThis                ).wx;
    if (wx && typeof wx.getStorageSync === 'function') {
      const v = wx.getStorageSync(KEY);
      if (typeof v === 'string' && v in THEMES) return v           ;
    }
    const ls = (globalThis                              ).localStorage;
    if (ls) {
      const v = ls.getItem(KEY);
      if (v && v in THEMES) return v           ;
    }
  } catch {
    /* 读不到按默认 */
  }
  return null;
}

function writeStored(id         )       {
  try {
    const wx = (globalThis                ).wx;
    if (wx && typeof wx.setStorageSync === 'function') {
      wx.setStorageSync(KEY, id);
      return;
    }
    const ls = (globalThis                              ).localStorage;
    if (ls) ls.setItem(KEY, id);
  } catch {
    /* 存不上就内存态 */
  }
}

let currentId          = readStored() ?? 'classic';

/** 关卡 → 主题：第 2 关糖果嘉年华 / 第 3 关果冻乐园 / 第 4 关贴纸手账，其余原样式。进关时由 GameBootstrap 调用 */
export function themeForLevel(level        )            {
  return THEMES[LEVEL_THEME[level] ?? 'classic'];
}

/** 进关时设定主题（GameBootstrap 调用） */
export function setThemeForLevel(level        )            {
  const t = themeForLevel(level);
  if (currentId !== t.id) {
    currentId = t.id;
    writeStored(currentId);
    for (const cb of listeners.slice()) cb(t);
  }
  return t;
}

/** 当前主题（纯数据） */
export function currentTheme()            {
  return THEMES[currentId];
}

/** 主题变更订阅（GameBootstrap 用它重建背景 / HUD / 棋盘） */
export function onThemeChanged(cb          )       {
  listeners.push(cb);
}

/** 切到三主题的下一个（调试用，正常流程走 setThemeForLevel） */
export function cycleTheme()            {
  const i = ORDER.indexOf(currentId);
  currentId = ORDER[(i + 1) % ORDER.length] ;
  writeStored(currentId);
  const t = THEMES[currentId];
  for (const cb of listeners.slice()) cb(t);
  return t;
}

/** 测试用：直接设定 + 不落盘 */
export function setThemeForTest(id         )       {
  currentId = id;
}
