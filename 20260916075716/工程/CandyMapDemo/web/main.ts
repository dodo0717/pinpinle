/**
 * 灰盒原型控制器（M3 玩法 + M4 结算 + M5 元系统界面）。
 *
 * 直接复用 `assets/scripts/core` 的算法层与规则层（同一份源码，不做任何算法复制）：
 *   - `PuzzleEngine` 负责「交换 → 消除 → 下压 → 补位 → 校验」；
 *   - `assets/scripts/core/progress.ts` 负责「判星 / 解锁 / 记录 / 入场计费」；
 *   - 本文件只负责**渲染、输入、界面调度**。
 *
 * 界面拆在 `web/ui/` 下，各自成模块（不反向依赖本文件，避免循环导入）：
 *   dom / text / dialog / ads / meta / home / map / collection / leaderboard / settings / share / guide
 *
 * 渲染策略：
 *   - 碎片图片若已放在 `art/stickers/sticker_<图ID>.png`，自动按 256×256 四等分显示；
 *   - 缺图时退化为「色块 + 位置数字 + 图ID」的灰盒形态，不阻塞任何验证。
 */
import {
  GAME_MODES,
  GRID_BY_LEVEL,
  Grid,
  MAX_ART_ID,
  MODE_LABEL,
  PuzzleEngine,
  Rng,
  SAVE_VERSION,
  STAR_LINES_BY_MODE,
  STAMINA_MAX,
  TIME_LIMIT,
  TOTAL_LEVELS,
  boardSnapshot,
  buildLevelConfigs,
  buildLevelPlan,
  clampShift,
  commitSettlement,
  computeMergeDisplay,
  confirmStamina,
  createProgress,
  createSaveData,
  findHintCells,
  honorForLevel,
  imageOf,
  levelStatus,
  parseSave,
  positionOf,
  preDeductStamina,
  recordOf,
  refundStamina,
  resumeTimeLeft,
  settleLevel,
  type Cell,
  type GeneratedPool,
  type GameMode,
  type HonorOutcome,
  type LevelConfig,
  type LevelOutcome,
  type LevelSession,
  type LevelSettlement,
  type MergeDisplay,
  type MoveOutcome,
  type ProgressData,
  type SaveData,
  type SaveLimits,
} from '../assets/scripts/core/index.ts';

import { STICKER_DIR, fmtMMSS, starText, toast } from './ui/dom.ts';
import { closeDialog, openDialog, confirmDialog, type DialogButton } from './ui/dialog.ts';
import { createAnalytics } from './ui/analytics.ts';
import { runAd } from './ui/ads.ts';
import {
  addStamina,
  armRecovery,
  adStaminaLeft,
  createMeta,
  recordAdStamina,
  rollOverDay,
  staminaCountdown,
  tickMeta,
  unlockedImageIds,
  AD_STAMINA_DAILY_MAX,
  COLLECTION_TOTAL,
  type MetaState,
} from './ui/meta.ts';
import { createCollectionScreen, createPreviewScreen } from './ui/collection.ts';
import { challengeState, createLeaderboardScreen, type LeaderboardView } from './ui/leaderboard.ts';
import { createSettingsScreen } from './ui/settings.ts';
import { createMapScreen, type MapNode, type MapView } from './ui/map.ts';
import { createTabBar, type TabName } from './ui/tabbar.ts';
import { downloadSticker, shareSticker } from './ui/share.ts';
import { createGuide, GUIDE_STEPS, type GuideStep } from './ui/guide.ts';
import { SaveManager } from './ui/saveManager.ts';
// M7：音效（开发期用 WebAudio 合成占位音，见 audio.ts 的说明）与融合纹理几何
import { createAudio } from './ui/audio.ts';
import { mergeExtent, pieceGeometry } from './ui/geometry.ts';
import { removeSave, storageKind } from './ui/storage.ts';
import { ADS, FAIL, HOME, HONOR, LEADERBOARD, REVIVE, SAVE, SETTLEMENT } from './ui/text.ts';

/** 探测范围 = 素材总量（附录A 的 36 张，ID 0~35）；没到货的图会自动退化成色块 */
const PROBE_MAX = MAX_ART_ID + 1;

/** 格间距（px）。原值 4 缩到手机上等于没有，现按「肉眼一眼可辨」调到 12 */
const GAP = 12;
/** 碎片白色描边宽度 —— 这就是「边界感」本身（收窄一半） */
const EDGE = 2;

/**
 * `#board-wrap` 左右留白的自适应区间（画布 px）。
 *
 * 上限留到 96：屏幕很宽时 reconciliation 需要比原来的 56 更宽的留白才安全
 * （见 `boardPadX()`），此时宁可牺牲一点点格子尺寸，也不能让最外一列够到手势区。
 */
const PAD_X_MIN = 16;
const PAD_X_MAX = 96;
/**
 * 安全余量（画布 px）。`boardPadX()` 解出的是「距离刚好等于一格步距」的理论值，
 * 这里再垫几 px 抵掉取整误差和「手指没按在正中心」的偏差 —— 这条边一旦不够，
 * 代价是整局游戏被系统手势截走（§1.6.9），不值得为几个像素去赌。
 */
const PAD_X_SLACK = 6;
/**
 * `#board` 的内边距 / 边框宽度（画布 px）—— **必须与 index.html 的 `#board` 一致**，
 * 因为它们同样占在「屏幕边缘 → 最外一列碎片中心」这条距离上（§1.6.9）。
 * 改 CSS 里的值时这俩常量要跟着改，`boardPadX()` 是按它们反解留白的。
 */
const BOARD_PAD = 12;
const BOARD_BORDER = 1;

/**
 * 结算动画各段时长（ms）—— **消除 5 阶段**（§6.3 / §11.6.2）：
 *
 *   交换完成 → ① 识别 → ② 拼合 → ③ 确认 → ④ 消除（+ ⑤ 得分飘字）→ 掉落 → 补位
 *
 * ⚠️ 下面每个常量都必须与 index.html 里同名动画的 animation-duration 严格一致 ——
 * 定时器一到就 paintBoard 清 class，时长对不上会把动画打断（表现为「掉到一半突然归位」）。
 * 改动时两边一起改。
 *
 * 时长口径（2026-09-11 定，依据 §6.3 的 5 阶段与「不拖节奏」的取舍）：
 *   - ①②③ 合计 150ms：文档给的是 0.15+0.15+0.1 = 400ms，那样光「认一认」就 0.4 秒，
 *     180 秒里每次消除都这么等会明显拖慢手感；这里压到 150ms，**5 个阶段一个没少**；
 *   - ④ 消除 350ms：与文档一致（它是唯一需要被看清的一段：炸金光 + 缩没）；
 *   - ⑤ 飘字 500ms **与 ④ 和随后的掉落并行**，不额外占时间。
 *   于是「交换完成 → 可以继续操作」的阻塞时间 = 150 + 350 = **500ms**，
 *   正好卡在「总时长 0.5 秒内」这条线上。想让节奏更快/更慢，改这四个数即可。
 */
const SWAP_MS = 90;
/** ① 识别：整组抬起 + 金环，告诉玩家「要消的是这 4 块」 */
const RECOGNIZE_MS = 60;
/** ② 拼合：落回原位，读作「缝隙合上了」 */
const FIT_MS = 50;
/** ③ 确认：整体一顿，读作「就是现在」 */
const CONFIRM_MS = 40;
/** ④ 消除：吸气鼓起 → 炸金光 → 缩成一点消失 */
const VANISH_MS = 350;
/** ⑤ 得分飘字的飞行时长（与消除/掉落并行） */
const FLOAT_MS = 500;
const FALL_MS = 260;
const SPAWN_MS = 260;
/** 同一帧里相邻列落下的错开时长，纯粹为了做出「哗啦啦」的连锁感 */
const STAGGER_MS = 12;
/** 非法交换的反馈时长（回弹 + 棋盘轻抖），与 index.html 的 .3s 一致 */
const REJECT_MS = 300;

/** 播放动画期间顺手清掉的动画类名（消除 5 阶段的前三段 + 消除 + 掉落补位） */
const ANIM_CLASSES = ['recog', 'fit', 'confirm', 'vanish', 'fall', 'spawn'] as const;

/** 消除动画的三个「前段」类名：识别 → 拼合 → 确认，互斥切换 */
const PHASE_CLASSES = ['recog', 'fit', 'confirm'] as const;

const delay = (ms: number): Promise<void> => new Promise((r) => window.setTimeout(r, ms));

const stageEl = document.getElementById('stage') as HTMLDivElement;
const wrapEl = document.getElementById('board-wrap') as HTMLDivElement;
const boardEl = document.getElementById('board') as HTMLDivElement;
const timerEl = document.getElementById('hud-timer') as HTMLDivElement;
const scoreEl = document.getElementById('hud-score-num') as HTMLElement;
/** 分数 HUD 的外框：得分飘字的落点 + 落到时轻弹一下的目标 */
const scoreHudEl = document.getElementById('hud-score') as HTMLDivElement;
const heartsEl = document.getElementById('hud-hearts') as HTMLDivElement;
const statusEl = document.getElementById('dev-status') as HTMLElement;
const levelBtn = document.querySelector('[data-act="level"]') as HTMLButtonElement;
const modeBtn = document.querySelector('[data-act="mode"]') as HTMLButtonElement;
const exitBtn = document.getElementById('hud-exit') as HTMLButtonElement;

const available = new Set<number>();

/**
 * 音效层（§15）。开发期没有音频素材 —— 用 WebAudio 合成占位音，但**接口按真素材定好**：
 * 7 个事件音槽位 + BGM 开关，将来只换 `ui/audio.ts` 的内部实现，调用方一行不动。
 * 开关来自设置；「随倒计时暂停而暂停」由 `syncAudio()` 统一驱动。
 */
const audio = createAudio();

/**
 * 埋点（M9，实现与取舍见 `ui/analytics.ts`）。
 * 目前只有荣誉弹窗在用：**曝光 + 玩家点的那个按钮合并成一条**，攒够一批再异步发出去。
 * 开发期没有埋点服务，所以它只写本地缓存、不发网络 —— 不会拖慢任何一帧。
 */
const analytics = createAnalytics();

/**
 * 当前玩法模式。
 * 两种模式**共用同一批关卡**（网格、图池完全相同），只有移动规则与星线不同：
 *   普通 → 整片想挪多远都行；噩梦 → 整片一次只能挪一格。
 */
let mode: GameMode = 'normal';

/**
 * 可玩关卡。
 *
 * ⚠️ 2026-09-10 修订：图池不再硬编码，改为素材探测完成后由 `buildRenderLevels()`
 * 从**实际到货素材**里随机抽出（见 assets/scripts/core/poolGen.ts）。
 * 所以这里初始为空 —— 模块顶层还不知道哪些图已到货。
 */
let playable: LevelConfig[] = [];
/** 素材张数不足、暂不开放的关卡号 */
let skipped: number[] = [];
/**
 * 关卡号 → 该关的图池生成结果（含设计 / 实际的 ma 与动物只数）。
 *
 * 直接引用 `LevelPlan.pools`，**不在这里重算** —— 否则「界面显示的图池」
 * 与「算法实际在用的图池」是两条独立算出来的路线，迟早分叉。
 */
let poolInfo = new Map<number, GeneratedPool>();
/** 实际混淆度 ma 被抬高（素材分布不足）的关卡，星线仍按设计标定 */
let poolMismatch: number[] = [];
/** 生成器发现的问题（跨关撞车等），会打到错误条 */
let poolIssues: string[] = [];
/** 重试后仍未加载成功的素材 ID —— 用来把「加载失败」与「素材分布不足」区分开 */
let missingStickers: number[] = [];

/**
 * 关卡数据是否已就绪（素材探测 + 图池生成都已完成）。
 *
 * ⚠️ 就绪之前 `playable` 还是空数组，但开发工具条在 `main()` 一开始就绑定了 ——
 * 36 张素材在手机上要探测好几秒，这段空窗期里点「重开 / 上一关 / 下一关」，
 * `loadLevel` 会拿到 `playable[...] === undefined`，`new PuzzleEngine(undefined)`
 * 抛 `TypeError: Cannot read properties of undefined (reading 'rows')`。
 * 这里用 ready 把这条路径整体挡掉：未就绪时按钮置灰 + 操作统一提示。
 */
let ready = false;

interface CellRef {
  root: HTMLDivElement;
  piece: HTMLDivElement;
}

let levelIndex = 0;
let engine: PuzzleEngine;
let rng: Rng;
let cells: CellRef[] = [];
let cellSize = 120;
let timeLeft = 180;
let started = false;
let paused = true;
let busy = false;
let finished = false;

/* ---- M4：关卡进度 / 结算 ---- */

/**
 * 各模式的关卡进度。
 *
 * 是内存里的**权威副本**；落盘由 M6 的 `save`（`ui/saveManager.ts`）负责，
 * 存档单位是「一次交换事务」（§16）——见文件末尾的 M6 段落。
 */
const progressByMode: Record<GameMode, ProgressData> = {
  normal: createProgress('normal'),
  nightmare: createProgress('nightmare'),
};

/** M5 元系统状态（体力恢复 / 广告次数 / 图鉴 / 设置）。体力也就此收进 meta，不再单独一份 */
const meta: MetaState = createMeta(Date.now());

/** 本局是否用过续命（§7.4：每局限 1 次） */
let revivedUsed = false;
/** 本局是否处于「续命之后」的状态 —— 决定判几星、要不要记上榜分 */
let revived = false;
/** 关卡已结束、但还在等「续命 or 放弃」决策时的现场数据 */
let pendingOutcome: LevelOutcome | null = null;
/**
 * 本次结算是否发生在**玩家不在场**的时候（启动恢复 / 切回前台才发现时间已经走完）。
 *
 * 为什么单独记一笔：续命弹窗（§12.3）的前提是「玩家正看着屏幕、愿意看广告」——
 * 他不在场时弹出来毫无意义，回来只会看到一个「+1 分钟」按钮，而离开的那段时间
 * 早已走完、广告也补不回来。所以离线超时**不发续命机会**，直接给结算结果。
 *
 * ⚠️ 它**只影响「要不要续命」，不影响判星**：分数照算，够 3★ 就是 3★、该上榜就上榜 ——
 * 离线只是让时间继续走，没动过分数。
 *
 * 由 `enterLevel()` 在开局时清零：它只描述「这一局是怎么结束的」，不跨局残留。
 */
let offlineSettle = false;
/** 续命一次加多少秒（§7.4） */
const REVIVE_SECONDS = 60;
/** 本局续命广告「连续加载失败」次数：连续 3 次按 §13.4 直接回续命弹窗 */
let reviveAdFailures = 0;
/**
 * 挪了但没消除的次数（新手引导第 2 步的触发条件）。
 *
 * ⚠️ 名字与断点字段名都沿用 `swapMisses`：它是**已落盘的存档字段**（§16），
 * 改名会让玩家手上的断点读不回来，不值得为措辞冒这个险。
 */
let swapMisses = 0;
/** 本局是否已消除过（新手引导第 3/4 步只认「首次」） */
let eliminatedOnce = false;

/**
 * 拖动中的整片（§1.6）。
 *
 * `index` = 手指按住的那一块（**锚点**，落点全部以它为准），`cells` = 它所在的整片。
 * ⚠️ 拖动全程不写 engine：松手时才提交一次移动事务 —— 拖到一半来电 / 手势返回，
 * 棋盘还是原样，不存在「半成品状态」。
 */
let drag: { index: number; x: number; y: number; cells: number[] } | null = null;

/* ---- M6：存档（§16）---- */

/**
 * 存档口径：关卡数 / 体力上限 / 时间限制从 core 常量取，广告上限从 M5 的 `meta.ts` 取 ——
 * 存档层不重复抄策划案数字（多抄一份就多一处会忘记同步的地方）。
 */
const SAVE_LIMITS: SaveLimits = {
  totalLevels: TOTAL_LEVELS,
  staminaMax: STAMINA_MAX,
  timeLimit: TIME_LIMIT,
  adStaminaDailyMax: AD_STAMINA_DAILY_MAX,
};

/** 本局种子（只用于排查复现；真正决定补位序列的是 `Rng.snapshot`） */
let levelSeed = 0;
/** 局内断点：只在**被动退出**（切后台 / 进程结束）时留，主动退出 / 结算 / 重开都清掉 */
let session: LevelSession | null = null;
/** 启动时读到的断点：等素材探测完、确认这一关开得出来之后，再问玩家要不要继续 */
let loadedSession: LevelSession | null = null;
/** 存档管理器（`main()` 一开始就建好，界面事件最早也要等到那之后才会触发） */
let save: SaveManager;

/** 出厂存档：读档失败时的兜底，也是「重置存档」的落点（每次都要一份新的，不能共用） */
function freshSaveData(): SaveData {
  return createSaveData('normal', Date.now());
}

/** 把当前全部状态组装成一条存档（只在落盘那一刻调用，不常驻） */
function currentSave(): SaveData {
  const progress = {} as Record<GameMode, ProgressData>;
  for (const m of GAME_MODES) progress[m] = progressByMode[m];
  return {
    version: SAVE_VERSION,
    savedAt: Date.now(),
    mode,
    progress,
    meta: {
      stamina: { ...meta.stamina },
      nextRecoverAt: meta.nextRecoverAt,
      adDay: meta.adDay,
      adStaminaUsed: meta.adStaminaUsed,
      settings: { ...meta.settings },
      guideDone: meta.guideDone,
    },
    session: session ? { ...session, cells: session.cells.slice() } : null,
  };
}

/**
 * 开一条新断点（进入 / 重开本关时调用）。
 *
 * 必须在 `engine` / `rng` / `enterLevel()` 都就位之后调用，所以棋盘直接取引擎快照，
 * 而不是在这里重新生成 —— 生成两遍迟早有一遍是错的。
 */
function openSession(cfg: LevelConfig, seed: number): void {
  session = {
    mode,
    level: cfg.level,
    seed,
    rngState: rng.snapshot,
    cells: engine.toSnapshot().cells,
    score: 0,
    eliminations: 0,
    timeLeft: cfg.timeLimit,
    started: false,
    revived: false,
    revivedUsed: false,
    swapMisses: 0,
    eliminatedOnce: false,
    savedAt: Date.now(),
  };
}

function clearSession(): void {
  session = null;
}

/**
 * 把局内现场同步进断点（**只改内存**，落不落盘由 `save` 决定）。
 *
 * 只在「这一局还在进行」时同步：结算 / 主动退出之后 `session` 已经是 null，
 * 不能被这里又建回来 —— 否则退出后下次启动还会弹「继续上次的挑战」。
 */
function syncSession(): void {
  if (!session || !engine || finished) return;
  const snap = engine.toSnapshot();
  session.cells = snap.cells;
  session.score = snap.score;
  session.eliminations = snap.eliminations;
  session.rngState = rng.snapshot;
  session.timeLeft = timeLeft;
  session.started = started;
  session.revived = revived;
  session.revivedUsed = revivedUsed;
  session.swapMisses = swapMisses;
  session.eliminatedOnce = eliminatedOnce;
}

/** 把一条存档应用回内存（读档 / 重试 / 重置共用） */
function applySave(data: SaveData): void {
  for (const m of GAME_MODES) progressByMode[m] = data.progress[m];
  mode = data.mode;
  meta.stamina = { ...data.meta.stamina };
  meta.nextRecoverAt = data.meta.nextRecoverAt;
  meta.adDay = data.meta.adDay;
  meta.adStaminaUsed = data.meta.adStaminaUsed;
  meta.settings = { ...data.meta.settings };
  meta.guideDone = data.meta.guideDone;
  // 引导「只出现一次」也要跨会话成立：老玩家刷新回来不该再被教一遍（§14）
  guide.markShown(data.meta.guideDone ? GUIDE_STEPS : []);
  // 开关要显示存档里的值，不然「关了音效 → 刷新 → 界面显示还是开」
  settingsScreen.render(meta.settings);
  // 读档后声音开关要真的生效（否则界面上是「关」，耳朵里还在响）—— M7 起有声音了，这行才有意义
  audio.setSound(meta.settings.sound);
  audio.setBgm(meta.settings.bgm);
  loadedSession = data.session;
}

/**
 * 启动兜底：退还**悬空的预扣**（§12.4）。
 *
 * 场景是「预扣成功 → 渲染完成 → 转正」之间被强杀：那 1 颗既没转正也没退还。
 * 有断点说明关卡已经渲染出来了（那颗已转正），此时**不能退**，否则等于白送体力。
 */
function repairStaminaAfterLoad(): void {
  if (loadedSession) return;
  if (meta.stamina.pending <= 0) return;
  meta.stamina = refundStamina(meta.stamina);
}

/* ------------------------------------------------------------------ 界面调度 */

type ScreenName = 'home' | 'game' | 'collection' | 'preview' | 'leaderboard' | 'settings';

const collectionScreen = createCollectionScreen({
  onBack: () => showScreen('home'),
  onOpen: (imageId) => {
    previewScreen.render(imageId);
    showScreen('preview');
  },
});

const previewScreen = createPreviewScreen({
  onBack: () => showScreen('collection'),
  onDownload: (imageId) => void downloadSticker(imageId),
  onShare: (imageId, caption) => void shareSticker(imageId, caption),
});

/**
 * 「结算弹窗 → 查看排行榜 → 返回」这条路径要回到哪。
 *
 * 非空 = 排行榜是从荣誉弹窗进来的，返回时应该**回到结算弹窗**（原样重画），
 * 而不是把玩家丢回主界面 —— 他看完榜单还要接着选「下一关 / 再战本关」。
 * 从主界面直接进排行榜时它是空的，返回就回主界面。
 */
let backToSettlement: (() => void) | null = null;

const leaderboardScreen = createLeaderboardScreen({
  onBack: () => {
    if (backToSettlement) {
      const back = backToSettlement;
      backToSettlement = null;
      showScreen('game');
      back();
      return;
    }
    showScreen('home');
  },
  onChallenge: challengeLevel,
  view: leaderboardView,
});

const settingsScreen = createSettingsScreen({
  onBack: () => showScreen('home'),
  onChange: (patch) => {
    Object.assign(meta.settings, patch);
    settingsScreen.render(meta.settings);
    // 开关要**立刻**作用到声音上：等刷新才生效会让人以为开关坏了（M7）
    audio.setSound(meta.settings.sound);
    audio.setBgm(meta.settings.bgm);
    // 设置是玩家明确表达的偏好，不要等防抖窗口（M6：关键点立即落盘）
    save.flush();
  },
});

/**
 * 首页 = 关卡地图（糖果传奇式：进游戏就是地图，点关卡直接开打）。
 *
 * 图鉴 / 排行榜 / 设置的「返回」也回到这一屏，所以它就是主界面本身，不再另设一屏。
 *
 * 选关不另开一条路：直接复用 `loadLevel()` —— 体力预扣/转正、断点、存档、切屏
 * 全在那一条路径上，首页只负责把「点了哪一关」转交出去（与排行榜「挑战本关」同口径）。
 */
const homeScreen = createMapScreen({
  // 难度切换（普通 / 困难）：两套进度各自独立，切完由 setMode 重建关卡配置并回首页
  onMode: (next) => setMode(next),
  onAddStamina: watchStaminaAd,
  onPick: (level) => {
    const index = indexOfLevel(level);
    if (index < 0) {
      toast(LEADERBOARD.challengeUnavailable(level), 2600);
      return;
    }
    loadLevel(index);
  },
});

const guide = createGuide();

/**
 * 底部页签栏（糖果传奇式全局导航）。
 *
 * 玩法屏**整条隐藏** —— 局内不能有一键跳走的入口：能一键跳走 = 能暂停 = 能截图作弊，
 * 与「不设暂停按钮」（§0 第 1 条）是同一条约束。
 */
const tabbar = createTabBar({
  onHome: () => showScreen('home'),
  onLeaderboard: () => {
    showScreen('leaderboard');
    // 与主界面「🏆 排行榜」同口径：默认看最后一关
    leaderboardScreen.show(TOTAL_LEVELS, TOTAL_LEVELS);
  },
  onCollection: () => {
    refreshCollection();
    showScreen('collection');
  },
  onSettings: () => {
    settingsScreen.render(meta.settings);
    showScreen('settings');
  },
});

/** 排行榜当前浏览的关卡（切关由排行榜自己管，main 只在进入时给初值） */
let currentScreen: ScreenName = 'home';

/**
 * 功能浮层：盖在常驻地图之上的三张卡片（大图预览是图鉴上的二级浮层）。
 * 它们**不再是「另一屏」** —— 打开时地图照旧在底下（`#screen-home` 保持 active），
 * 所以关掉浮层只是把它收起来，地图不重建、滚动位置也不会跳。
 */
const SHEET_SCREENS: readonly ScreenName[] = ['collection', 'preview', 'leaderboard', 'settings'];

const anchor = document.getElementById('toast');
stageEl.insertBefore(collectionScreen.el, anchor);
stageEl.insertBefore(previewScreen.el, document.getElementById('toast'));
stageEl.insertBefore(leaderboardScreen.el, document.getElementById('toast'));
stageEl.insertBefore(settingsScreen.el, document.getElementById('toast'));
stageEl.insertBefore(homeScreen.el, document.getElementById('toast'));
stageEl.insertBefore(guide.el, document.getElementById('toast'));
stageEl.insertBefore(tabbar.el, document.getElementById('toast'));

/**
 * 压暗地图的遮罩。做成真实元素（不是 CSS 伪元素）只为能接「点一下关掉浮层」；
 * 从图鉴的大图里点它回图鉴，其余回首页 —— 与各浮层里 ✕ 的落点一致。
 */
const scrim = document.createElement('div');
scrim.id = 'scrim';
stageEl.insertBefore(scrim, document.getElementById('toast'));
scrim.addEventListener('click', () => showScreen(currentScreen === 'preview' ? 'collection' : 'home'));

function showScreen(name: ScreenName): void {
  currentScreen = name;
  const isGame = name === 'game';
  for (const node of Array.from(stageEl.querySelectorAll('.screen'))) {
    if (node.id === 'screen-game') node.classList.toggle('active', isGame);
    // 地图就是主界面本身：只要不在玩法里，它一直在最底下当背景
    else if (node.id === 'screen-home') node.classList.toggle('active', !isGame);
    else node.classList.toggle('active', node.id === `screen-${name}`);
  }
  // 大图预览叠在图鉴之上：进预览时不关图鉴，返回时原样露出来
  if (name === 'preview') collectionScreen.el.classList.add('active');
  scrim.classList.toggle('on', SHEET_SCREENS.includes(name));
  // 页签栏：玩法屏整条隐藏
  tabbar.setVisible(name !== 'game');
  tabbar.setActive(
    name === 'game' ? null
      : name === 'preview' ? ('collection' as TabName)
      : (name as TabName),
  );
  if (name !== 'game') guide.hide();
  // 首页 = 地图：先渲染（进度 / 体力 / 节点），再量视口并定位到当前关
  if (name === 'home') {
    refreshHome();
    // 地图的高度与定位依赖可见高度：切进来时必须重新量一次
    homeScreen.enter();
  } else if (SHEET_SCREENS.includes(name)) {
    // 浮层开着时地图还露在四周：顺手刷一次，免得露出的是进玩法前那份旧状态
    refreshHome();
  }
  // 棋盘布局依赖可见高度：从其它屏切回玩法屏时必须重新量一次
  if (name === 'game' && engine) layoutBoard();
}

/** 首页整体刷新（地图节点 / 进度 / 体力 / 倒计时都从这里取） */
function refreshHome(): void {
  homeScreen.render(mapView());
}

function refreshCollection(): void {
  const unlocked = new Set(unlockedImageIds(progressByMode[mode]));
  collectionScreen.render(unlocked, COLLECTION_TOTAL);
}

/**
 * 组装首页（= 地图）数据。
 *
 * 关卡状态一律由 core 派生（与 `leaderboardView()` 同一口径）：
 *   - `levelStatus()` → locked / unlocked / cleared（决定节点灰、亮、金）；
 *   - `recordOf().stars / .personalBest` → 节点上的小星与历史最高分；
 *   - `GRID_BY_LEVEL` → 节点角标。
 *
 * ⚠️ 进度是**分模式**存的（`progressByMode`），所以切模式后这张地图要跟着换一套状态；
 * 「默认定位到当前解锁关」用的也是该模式的 `unlocked`，不是另一模式的。
 */
function mapView(): MapView {
  const progress = progressByMode[mode];
  const nodes: MapNode[] = [];
  for (let level = 1; level <= TOTAL_LEVELS; level++) {
    const grid = GRID_BY_LEVEL[level];
    const record = recordOf(progress, level);
    nodes.push({
      level,
      status: levelStatus(progress, level),
      stars: record.stars,
      best: record.personalBest,
      grid: grid ? `${grid[0]}×${grid[1]}` : '',
    });
  }
  return {
    mode,
    modeLabel: MODE_LABEL[mode],
    currentLevel: progress.unlocked,
    stars: recordOf(progress, progress.unlocked).stars,
    totalLevels: TOTAL_LEVELS,
    nodes,
    // 还没有账号系统：先用占位头像与昵称（接账号时只改这一处）
    profile: { avatar: HOME.avatar, nickname: HOME.nickname },
    // 进关要消耗体力，所以首页上直接显示（糖果传奇的做法）
    stamina: {
      available: meta.stamina.available,
      max: STAMINA_MAX,
      countdown: staminaCountdown(meta, Date.now()),
    },
  };
}

/* ------------------------------------------------------------------ 体力 / 广告（§12.4 / §13） */

/**
 * 加体力广告的唯一入口（主界面「+」、结算弹窗、失败弹窗、开发工具条共用）。
 *
 * 三条分支的顺序是策划案规定的（§13.3）：**先看体力满没满，再看今日次数**。
 * 反过来的话「体力已满但次数也用完」会报错一句无关的提示。
 */
async function watchStaminaAd(): Promise<void> {
  const now = Date.now();
  if (meta.stamina.available >= STAMINA_MAX) {
    toast(ADS.staminaFull, 1800);
    return;
  }
  if (adStaminaLeft(meta, now) <= 0) {
    toast(ADS.dailyUsed, 2600);
    return;
  }
  const result = await runAd('stamina');
  // 广告弹窗是 runAd 打开的，无论结果如何都要关掉它，否则会一直挂在屏幕上
  closeDialog();
  if (result !== 'watched') {
    if (result === 'failed') toast(ADS.failedToast, 2400);
    // 「没看完」不加体力，但把原弹窗还回去，玩家的操作不会丢
    reopenDialog?.();
    return;
  }
  recordAdStamina(meta);
  addStamina(meta, Date.now(), 1);
  // 体力与广告次数都变了 → 立即落盘（§M6：体力变化实时存档）
  save.flush();
  updateHearts();
  toast(ADS.gotStamina(meta.stamina.available, STAMINA_MAX), 2200);
  // 体力恢复 → 置灰的按钮要立刻能点了（§13.3），所以把弹窗重画一遍
  if (currentScreen === 'home') refreshHome();
  reopenDialog?.();
}

/** 弹窗重绘回调：看完广告后要让置灰的按钮恢复（离开关卡 / 关弹窗时必须清掉，避免重画幽灵弹窗） */
let reopenDialog: (() => void) | null = null;

/** 判断某个「要花 1 体力」的按钮该不该置灰（§12.1 / §12.2 / §12.4） */
function costButton(label: string, hint: string, run: () => void): {
  label: string;
  primary?: boolean;
  dim: boolean;
  disabledHint: string;
  onClick: () => void;
} {
  return { label, dim: meta.stamina.available <= 0, disabledHint: hint, onClick: run };
}

/* ------------------------------------------------------------------ 初始化 */

/** 设计画布宽度（竖屏，固定 1080）。画布内所有坐标都是这个尺度 —— 飘字落点也按它换算 */
const STAGE_WIDTH = 1080;
/** 基准高度 9:16；实际高度见 fitStage()（手机更高时跟着变高） */
const STAGE_BASE_HEIGHT = 1920;

/**
 * 视口安全边（**屏幕** px）—— 见 §1.6.9。手机上「贴着屏幕边缘拖」会撞上**两套**手势：
 *
 *   1. **系统的**：安卓侧边返回 / iOS 侧滑返回。网页**拦不住** ——
 *      它在浏览器之上被系统截走，`preventDefault()`、`touch-action` 都无效；
 *   2. **浏览器的**：Chrome 安卓「横滑返回」、下拉刷新。由 overscroll 派生，
 *      `overscroll-behavior: none` 能关掉（见 index.html）。
 *
 * 第 2 条能关，第 1 条关不掉，于是只剩一个办法：**别让手指有机会落在那条带子里**。
 *   - 左右各留 28 屏幕 px（安卓手势区约 24dp、iOS 侧滑区约 20pt，取 28 兜住两者）；
 *   - 上下各留 12 屏幕 px（安卓底部 home 手势区 / iOS 底部小横条）。
 *
 * ⚠️ 必须是**屏幕** px，不能写死进画布尺寸：这条边要挡住的是指头，指头活在屏幕空间。
 * 代价是竖屏手机上画布左右各让出一条窄边（看着像安全框）—— 那条窄边**就是**系统的手势区，
 * 不是游戏区，让出来是刻意的。
 *
 * ⚠️ 为什么值得让画布小 ~10%：横向拖动的**手指行程**必须留在屏幕内。
 * 不留安全边时，最外侧那一列的碎片中心离屏幕边只有约一格 —— 玩家往外一拖，手指就出了屏，
 * 而出屏那一下正是系统手势的判定窗口，「拖到一半被踢回桌面」就是这么来的。
 * 让出 28px 后，最外侧碎片中心到屏边的距离 ≥ 一格步距，往外拖一格手指仍在屏内。
 */
const EDGE_SAFE_X = 28;
const EDGE_SAFE_Y = 12;

/**
 * 竖屏 1080×1920 画布等比缩放贴合窗口（贴合的是**扣掉安全边之后**的那块区域）。
 *
 * ⚠️ 2026-09-10 修黑屏：内置预览面板折叠 / 尚未完成布局时，`window.innerHeight`
 * 会返回 0，scale 随之变成 0 —— `transform: scale(0)` 把整个 stage 缩到不可见，
 * 屏幕上只剩 body 的暗色背景，表现就是「黑屏、什么都看不到」。
 * 这里对 0 和非法值兜底，并补一层 ResizeObserver（面板展开不一定触发 window resize）。
 */
function fitStage(): void {
  const w = window.innerWidth || document.documentElement.clientWidth;
  const h = window.innerHeight || document.documentElement.clientHeight;
  // 先把安全边让出来，再在剩下的区域里等比缩放、居中
  const availW = Math.max(1, w - EDGE_SAFE_X * 2);
  const availH = Math.max(1, h - EDGE_SAFE_Y * 2);
  const scale = Math.min(availW / STAGE_WIDTH, availH / STAGE_BASE_HEIGHT);
  const s = Number.isFinite(scale) && scale > 0 ? scale : 1;
  // 画布高度跟着视口走（宽度仍固定 1080）：手机比 9:16 更高时，多出来的高度归画布，不再上下留黑边
  const stageH = Math.max(STAGE_BASE_HEIGHT, availH / s);
  stageEl.style.height = `${stageH}px`;

  // origin 为 top left，这里手动把缩放后的画布摆到**安全区**正中
  stageEl.style.transform =
    `translate(${EDGE_SAFE_X + (availW - STAGE_WIDTH * s) / 2}px, ` +
    `${EDGE_SAFE_Y + (availH - stageH * s) / 2}px) scale(${s})`;
}

/**
 * 当前画布缩放比 = 屏幕像素 ÷ 画布像素。
 *
 * ⚠️ 指针事件的 `clientX/Y`、`getBoundingClientRect()` 都是**屏幕像素**，
 * 而格距、CSS 变量、`.cell` 的尺寸全都是**画布像素** —— 两者相差一个 scale。
 * 任何「屏幕位移 ÷ 画布尺寸」的换算都必须先除掉这一层，否则在 430 宽的窗口里
 * （scale ≈ 0.4）会算出「拖了一整格 ≈ 0.4 格」，取整后恒为 0：
 * 表现就是**整片怎么拖都不动**（§1.6 的拖动曾整段踩过这个坑）。
 */
/** 视口变化（旋转 / 浏览器地址栏收放 / 面板折叠）：重新贴合画布并重排棋盘 */
function onViewportChange(): void {
  fitStage();
  if (engine && currentScreen === 'game') {
    layoutBoard();
    paintAll();
  }
}

function stageScale(): number {
  const rect = stageEl.getBoundingClientRect();
  return rect.width > 0 ? rect.width / STAGE_WIDTH : 1;
}

/* 任何脚本错误都直接打到页面上，避免下次出问题只能靠猜 */
const errEl = document.getElementById('errbar') as HTMLDivElement | null;

function reportError(what: string, detail: unknown): void {
  if (!errEl) return;
  const text = detail instanceof Error ? detail.stack ?? detail.message : String(detail);
  errEl.hidden = false;
  errEl.textContent += `[${what}] ${text}\n`;
}

window.addEventListener('error', (e) => reportError('error', e.error ?? e.message));
window.addEventListener('unhandledrejection', (e) => reportError('promise', e.reason));

/**
 * 探测哪些图已有素材（缺图则走色块灰盒）。
 *
 * ⚠️ 36 张 PNG 合计约 26MB，手机上一口气并发 36 张时**尾部请求容易被丢掉**。
 * 那样「素材真的没有」和「只是这次没加载上」在界面上长得一模一样 —— 都会表现为
 * 图池偏离设计表，白白冤枉设计表。这里做三件事把两者区分开：
 *   1. 并发限流到 6 —— 对齐浏览器同域连接上限，不再 36 张大图互相挤；
 *   2. 每张最多试 3 次 —— 偶发丢包 / 请求被取消不再直接判成「素材不存在」；
 *   3. 用 inflight 持有加载中的 Image 引用 —— 不持有引用时，尚未完成的加载
 *      在移动端内存吃紧时可能被 GC 取消。
 * 重试后仍失败的记进 missingStickers，由状态提示点名，而不是静默降级。
 */
async function probeStickers(): Promise<void> {
  /** 浏览器同域并发连接上限（HTTP/1.1 常见为 6） */
  const CONCURRENCY = 6;
  /** 单张最多尝试次数 */
  const MAX_ATTEMPTS = 3;
  /**
   * 单次尝试的最长等待时间。
   *
   * 移动端切后台 / 连接被运营商掐断时，Image 请求可能**既不 onload 也不 onerror**。
   * 没有超时的话 worker 会卡死在这里，`Promise.all` 永远不 resolve ——
   * 表现为「界面一直停在加载中，任何关卡操作都报错」。宁可判它失败去重试。
   */
  const ATTEMPT_TIMEOUT_MS = 8000;
  /** 加载中的 Image 强引用，防止未完成的加载被 GC 提前取消 */
  const inflight = new Set<HTMLImageElement>();
  const queue = Array.from({ length: PROBE_MAX }, (_, id) => id);

  const loadOne = (id: number, attempt: number): Promise<boolean> =>
    new Promise<boolean>((done) => {
      const img = new Image();
      inflight.add(img);
      let settled = false;
      let timer = 0;
      const settle = (ok: boolean): void => {
        // onload / onerror / 超时可能先后到达，只认第一次，避免 done 被调用两次
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        inflight.delete(img);
        img.onload = null;
        img.onerror = null;
        done(ok);
      };
      timer = window.setTimeout(() => settle(false), ATTEMPT_TIMEOUT_MS);
      img.onload = () => settle(true);
      img.onerror = () => settle(false);
      // 重试换 URL：浏览器可能把失败的响应缓存住，同 URL 重试会永远失败
      img.src =
        attempt === 0
          ? `${STICKER_DIR}/sticker_${id}.png`
          : `${STICKER_DIR}/sticker_${id}.png?retry=${attempt}`;
    });

  const worker = async (): Promise<void> => {
    for (;;) {
      const id = queue.shift();
      if (id === undefined) return;

      /**
       * ⚠️ 这里**不能**在加载成功时 `return` —— 那是从 worker 本体退出，会让这个 worker
       * 只探测 1 张图就收工。6 个 worker 加起来只能探到 6 张（正好是 0~5 的猫），
       * 其余 30 张永远进不了 `available`，于是 60 关里 15 关被判「素材分布不足」、
       * 45 关被判「素材不足已暂不开放」，满屏红字全是假的。
       * 正确写法是：成功只跳出「重试循环」，然后继续从队列取下一个 id。
       */
      let loaded = false;
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        if (await loadOne(id, attempt)) {
          loaded = true;
          break;
        }
      }
      if (loaded) available.add(id);
      else missingStickers.push(id);
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  missingStickers.sort((a, b) => a - b);
}

function colorOf(imageId: number): string {
  return `hsl(${(imageId * 53 + 25) % 360} 58% ${58 + (imageId % 3) * 6}%)`;
}

/**
 * 按「实际到货素材」构建可玩关卡。
 *
 * 每关的图池构成由 60 关设计表**逐关给定**（动物只数 + 同动物不同情绪分布，见
 * assets/scripts/core/config.ts 的 LEVEL_POOL_SPEC）；生成器只负责把「设计表要求的那几只动物、
 * 那几个情绪」从到货素材里确定性地抽出来（见 assets/scripts/core/poolGen.ts）：
 *   - 同一关每次进入都是同一套图池（种子固定），方便验收与复现；
 *   - 同一网格下各关图池保证两两不同，不会再出现「同一关重复出现」；
 *   - 图数超过到货数量的关卡（如 5×4 需 10 张）记入 skipped，暂不开放；
 *   - 素材分布不足以还原设计构成时会抬高实际 ma 或增加动物只数 ——
 *     记进 poolMismatch，由 UI 明示「这几关的图池与设计不一致」，不静默糊过去。
 */
function buildRenderLevels(): void {
  const ids = [...available].sort((a, b) => a - b);
  const plan = buildLevelPlan(mode, { availableIds: ids });

  playable = plan.levels;
  skipped = plan.skipped.slice();
  poolIssues = plan.notes.slice();
  // 图池的「设计 vs 实际」指标直接取自生成器（见 `LevelPlan.pools` 注释）
  poolInfo = plan.pools;
  poolMismatch = playable
    .filter((cfg) => poolInfo.get(cfg.level)?.deviatesFromDesign)
    .map((cfg) => cfg.level);

  for (const message of poolIssues) reportError('pool', message);

  // 一张素材都没有时生成器会把 60 关全部跳过；退回第 1 关，至少还能看到灰盒棋盘
  if (playable.length === 0) playable = buildLevelConfigs(mode).slice(0, 1);
}

/** 取当前关的设计 / 实际图池构成（用于底部状态栏与关卡提示） */
function currentPool(): GeneratedPool | undefined {
  const cfg = playable[levelIndex];
  return cfg ? poolInfo.get(cfg.level) : undefined;
}

/** 关卡号 → 可玩关卡下标（排行榜「挑战本关」用；找不到返回 -1） */
function indexOfLevel(level: number): number {
  return playable.findIndex((cfg) => cfg.level === level);
}

/** 当前进度该打哪一关（进度关卡可能因素材不足被跳过，往前找到最近的已开放关卡） */
function progressLevelIndex(): number {
  const target = progressByMode[mode].unlocked;
  const exact = indexOfLevel(target);
  if (exact >= 0) return exact;
  for (let i = playable.length - 1; i >= 0; i--) {
    if ((playable[i] as LevelConfig).level < target) return i;
  }
  return 0;
}

/* ------------------------------------------------------------------ 玩法模式 */

/** 当前模式的移动规则提示语（普通 / 困难，§1.6） */
function ruleHint(): string {
  return mode === 'nightmare'
    ? '困难模式：整片一次只能挪一格'
    : '普通模式：整片想挪多远都行';
}

/** 把模式按钮的文字与高亮状态同步到当前模式 */
function refreshModeButton(): void {
  modeBtn.textContent = `${MODE_LABEL[mode]}模式`;
  modeBtn.classList.toggle('on', mode === 'nightmare');
}

/**
 * 切换玩法模式。
 *
 * 两种模式共用同一批关卡，所以切换后需要**重建关卡配置**（星线不同）并回到主界面：
 * 进度是分模式存的（`progressByMode`），切模式后当前进度关卡也不一样。
 */
function setMode(next: GameMode): void {
  if (next === mode) return;
  mode = next;
  buildRenderLevels();
  refreshModeButton();
  // 切模式等于换了一套进度：回主界面，让玩家从该模式的进度关卡重新开始
  finished = true;
  setPaused(true);
  // 当前这一局被留在了另一个模式里 → 断点一起清掉（模式按钮在游戏内不可达，属开发路径）。
  // 注意这里**不退体力**：切模式不是「中途退出」，口径与 M5 一致，别顺手改掉。
  clearSession();
  closeDialog();
  showScreen('home');
  refreshHome();
  save.flush();
  toast(
    `已切换到${MODE_LABEL[mode]}模式\n${ruleHint()}\n` +
      `普通与困难的关卡进度各自独立 —— 星线沿用设计表同一组数值，困难更难拿满星`,
    3200,
  );
}

/* ------------------------------------------------------------------ 关卡装载 */

/**
 * 未就绪时的统一拦截：挡住所有「要读 engine / playable」的操作。
 *
 * 这些操作原本会直接读到 `undefined`：`playable[index]` 或尚未赋值的 `engine`，
 * 报错信息与真实原因（数据没加载完）相隔十万八千里，所以这里显式提示。
 */
function requireReady(): boolean {
  if (ready) return true;
  toast('关卡数据尚未就绪 —— 素材还在探测，稍等片刻再点', 1600);
  return false;
}

/** 已有引擎（开过一局）时的拦截：开发工具条里有几个按钮必须先有局 */
function requireEngine(): boolean {
  if (engine) return true;
  toast('还没有开局 —— 先从主界面点「开始游戏」', 2400);
  return false;
}

/**
 * 入场计费（§12.4 第一步）：先退还上一关没结算掉的预扣，再预扣本关的 1 颗。
 *
 * 体力不足时返回 false，调用方**必须放弃本次进入** —— 不能「先开局再补扣」，
 * 否则连点按钮就能卡出无限局。
 */
function enterWithStamina(): boolean {
  // 上一关开了头没打完（切关 = 中途退出）→ 退还（§12.4 第三步）
  meta.stamina = refundStamina(meta.stamina);
  const entered = preDeductStamina(meta.stamina);
  if (!entered.ok) {
    updateHearts();
    toast(
      entered.reason === 'already-pending' ? '上一局的入场体力还没结算，稍等片刻再进' : HOME.noStamina,
      2600,
    );
    return false;
  }
  meta.stamina = entered.state;
  updateHearts();
  // 预扣 / 退还是体力变化 → 立即落盘：这一颗若不落，强杀后既没退还也没转正
  save.flush();
  return true;
}

/** 排行榜「▶ 挑战本关」：打指定关卡（只消耗体力，不改变进度） */
function challengeLevel(level: number): void {
  if (!requireReady()) return;
  if (meta.stamina.available <= 0) {
    toast(LEADERBOARD.challengeNoStamina, 2600);
    return;
  }
  const index = indexOfLevel(level);
  if (index < 0) {
    toast(`第 ${level} 关暂未开放（所需素材张数不足）`, 2600);
    return;
  }
  loadLevel(index);
}

function loadLevel(index: number, seed: number = Date.now()): void {
  if (!requireReady()) return;
  levelIndex = Math.max(0, Math.min(playable.length - 1, index));
  const cfg = currentConfig();
  if (!cfg) return;
  if (!enterWithStamina()) return;
  // 进新关 = 上一局「中途退出」→ 旧断点作废（`enterWithStamina` 里已按 §12.4 退还）
  clearSession();
  showScreen('game');
  levelSeed = seed;
  rng = new Rng(seed);
  engine = new PuzzleEngine(cfg, rng);
  enterLevel(cfg);
  openSession(cfg, seed);
  // 棋盘已经渲染出来了 → 这颗体力转正式扣除，不再退还（§12.4 第二步）
  meta.stamina = confirmStamina(meta.stamina);
  updateHearts();
  armRecovery(meta, Date.now());
  // 体力转正 + 新断点建立：一起落盘，避免出现「有断点但体力还是预扣态」的中间档
  save.flush();
}

/**
 * 重开本关（工具条的「重开」与结算弹窗的「再玩一次」）。
 *
 * 与「上一关 / 下一关」的区别：**不重建关卡、不重算图池**，只换种子重排棋盘 ——
 * 走引擎自己的 `restart()`，这样「重开」一定还是同一套图、同一个难度。
 */
function restartLevel(): void {
  if (!requireReady() || !requireEngine()) return;
  const cfg = currentConfig();
  if (!cfg) return;
  // 重开也是一次「重新入场」，同样计 1 颗（§12.4）：
  // 否则失败之后可以无限重开，体力就形同虚设
  if (!enterWithStamina()) return;
  clearSession();
  showScreen('game');
  const seed = Date.now() + 7;
  levelSeed = seed;
  rng = new Rng(seed);
  engine.restart(rng);
  enterLevel(cfg);
  openSession(cfg, seed);
  meta.stamina = confirmStamina(meta.stamina);
  updateHearts();
  armRecovery(meta, Date.now());
  save.flush();
}

/**
 * 取当前关卡的配置；取不到就提示并返回 null。
 *
 * 取不到有两种可能：索引越界（连点按钮），或「已就绪却没有对应关卡」（图池生成异常）。
 * 两者都明确说出来，不让按钮文字留着上一关的旧值去误导排查。
 */
function currentConfig(): LevelConfig | null {
  const cfg = playable[levelIndex];
  if (cfg) return cfg;
  levelBtn.textContent = '关卡数据异常';
  toast('关卡数据异常：未找到该关卡配置，请刷新重试', 2400);
  return null;
}

/** 把界面与计时器复位到「刚进本关」的状态（`loadLevel` / `restartLevel` 共用） */
function enterLevel(cfg: LevelConfig): void {
  finished = false;
  // 「每局限 1 次续命」的计数在这里归零：换关与重开都算新的一局
  revived = false;
  revivedUsed = false;
  pendingOutcome = null;
  // 一次性标记：上一局若是「离线超时」结算的，不能把「不发续命」带进这一局
  offlineSettle = false;
  reviveAdFailures = 0;
  swapMisses = 0;
  eliminatedOnce = false;
  busy = false;
  started = false;
  setPaused(true);
  timeLeft = cfg.timeLimit;

  closeDialog();
  reopenDialog = null;
  // 进了新的一局：排行榜的「返回结算」路径作废；埋点里那条还没点按钮的记录也一起收尾
  backToSettlement = null;
  analytics.honorClosed();
  layoutBoard();
  dropInAll();
  updateHud();
  updateStatus();
  refreshLevelButton();
  const pool = currentPool();
  const poolHint =
    pool && (pool.maActual !== pool.maDesigned || pool.animalsActual !== pool.animalsDesigned)
      ? `\n图池：实际 ${pool.animalsActual} 只 / ma=${pool.maActual}` +
        `（设计 ${pool.animalsDesigned} 只 / ma=${pool.maDesigned}，素材分布不足导致不一致）`
      : '';
  toast(
    `${MODE_LABEL[mode]} · 第 ${cfg.level} 关 · ${cfg.rows}×${cfg.cols} · ` +
      `${cfg.imageIds.length} 张图${pool ? ` · ${pool.animalsDesigned} 只动物` : ''}\n` +
      `${ruleHint()}；点「自动消一组」可看 融合 → 消除 → 下压 → 补位` +
      poolHint,
    3200,
  );

  // 新手引导第 1 步：首次进入第 1 关（§14）
  if (cfg.level === 1) showGuide('swap');
}

/**
 * 刷新「关卡按钮」文案：星级一眼可见，「未解锁」也在这里暴露出来
 * （工具条允许跳到未解锁的关卡，那是开发便利，不是玩家路径）。
 *
 * 单独成函数是为了给 M6 的断点恢复复用 —— 恢复一局时不能再走一遍 `enterLevel()`
 * （它会重播入场动画、再弹一次教学 toast），但按钮文案必须和正常进入完全一致。
 */
function refreshLevelButton(): void {
  const cfg = currentConfig();
  if (!cfg) return;
  const progress = progressByMode[mode];
  const record = recordOf(progress, cfg.level);
  levelBtn.textContent =
    `第 ${cfg.level} 关 · ${cfg.rows}×${cfg.cols} · ` +
    (levelStatus(progress, cfg.level) === 'locked' ? '未解锁 🔒' : starText(record.stars));
}

/** 元素**内容盒**尺寸（画布 px）。`clientWidth` **含 padding**，必须显式减掉。 */
function contentBox(el: HTMLElement): { w: number; h: number } {
  const cs = getComputedStyle(el);
  return {
    w: el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight),
    h: el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom),
  };
}

/** 元素自身的「外壳」尺寸（padding + border，画布 px）—— 它不参与放格子，但要占地方 */
function chromeOf(el: HTMLElement): { w: number; h: number } {
  const cs = getComputedStyle(el);
  return {
    w:
      parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) +
      parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth),
    h:
      parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) +
      parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth),
  };
}

/**
 * `#board-wrap` 的左右留白（画布 px）—— **跟着画布缩放比自适应**。
 *
 * 为什么不能写死一个数：这块留白看着只是「棋盘没撑满」，实际承担 §1.6.9 的手势安全 ——
 * 最外侧一列被拖动时，手指按在碎片中心附近，往外拖一格的**行程**必须留在屏幕内，
 * 一旦指头滑出屏幕边缘，系统侧滑返回就会截走这一拖（拖动被收掉 / 直接回桌面）。
 *
 * 判据（先按屏幕 px 写，再整体折算回画布 px，`s` = `stageScale()`）：
 *
 *   EDGE_SAFE_X / s + P ≥ cell / 2 + GAP
 *   左边 = 屏幕边缘 → 碎片中心的可用距离；右边 = 拖一格所需的行程
 *   其中 P = padX + BOARD_PAD + BOARD_BORDER（画布边缘 → 格子外沿）
 *
 * 麻烦在于 `s` 会变：`EDGE_SAFE_X` 是**屏幕** px，折算进画布要除以 `s`，
 * 屏幕越宽 `s` 越大、这条安全边在画布里就越**薄**，同一份留白于是
 * 「iPad 上不够用、手机上却有余」。这就是为什么写死必然顾此失彼：
 *   - 按 iPad 取 58px → 手机上白白浪费一截宽度，格子被压小；
 *   - 按手机取 28px → iPad / 宽屏上重新踩回那个手势 bug（它是真机 bug，不是美观问题）。
 *
 * 所以这里直接把上面的不等式对 `padX` 反解（代入 cell = (A − 2·padX) / cols），
 * 取「刚好够安全」的那个值，再夹到 [PAD_X_MIN, PAD_X_MAX]。
 * 手机 ≈ 28px / 桌面 ≈ 39px / iPad ≈ 58px 会自动落出来，不用分支判断。
 */
function boardPadX(cols: number, s: number): number {
  // stage 还没贴合过（rect.width = 0）时 stageScale() 兜底为 1，这里再兜一层防除零
  const safe = Number.isFinite(s) && s > 0 ? s : 1;
  const inner = BOARD_PAD + BOARD_BORDER;
  const usable = STAGE_WIDTH - 2 * inner - GAP * (cols - 1);
  // 用 ceil：宁可多留 1px，也不要因为舍入把这条边做窄
  const need =
    Math.ceil((usable / (2 * cols) + GAP - inner - EDGE_SAFE_X / safe) / (1 + 1 / cols)) +
    PAD_X_SLACK;
  return Math.min(PAD_X_MAX, Math.max(PAD_X_MIN, need));
}

function layoutBoard(): void {
  // 重建格子会丢掉旧的 DOM，高亮下标必须先作废（否则会指到新格子上）
  clearHint();
  // 拖动中的整片同理：DOM 换掉了，旧的拖动记录与它的格子下标必须一起丢掉
  drag = null;
  const rows = engine.board.rows;
  const cols = engine.board.cols;
  // 可用区 = wrap 的**内容盒** − 棋盘自己的 padding/border。
  //
  // ⚠️ 2026-09-12 修「棋盘贴右边缘、最右一列被切」：原先写的是
  // `wrapEl.clientWidth - 64`，而 `clientWidth` **含 padding** ——
  // `#board-wrap` 的 `padding: 12px 56px`（左右共 112 画布 px）从来没被扣掉，
  // 棋盘于是比内容盒宽 86 px，整体**向右溢出**，再被 `#stage { overflow: hidden }` 裁掉
  // （实测最右一列被切 11 画布 px）。真机上的后果不止是丑：那一列的手指活动区
  // 正好被顶进系统手势区，往外拖一格手指就出屏 → 触发返回手势被踢回桌面（§1.6.9）。
  //
  // 现在按元素的实际盒模型算（改用 CSS 也不会再漂），并且**留白的责任回归 CSS**：
  // 想让棋盘离边缘远一点，改 `#board-wrap` 的 padding，而不是在这里写魔法数字。
  //
  // ⚠️ 唯一的例外是**左右留白**：它随画布缩放比自适应（见 boardPadX()），
  // 必须在量 contentBox **之前**写进去，否则量到的还是上一次的留白。
  wrapEl.style.setProperty('--pad-x', `${boardPadX(cols, stageScale())}px`);
  const wrapBox = contentBox(wrapEl);
  const chrome = chromeOf(boardEl);
  const availW = Math.max(200, wrapBox.w - chrome.w);
  const availH = Math.max(200, wrapBox.h - chrome.h);
  cellSize = Math.max(
    36,
    Math.floor(Math.min((availW - GAP * (cols - 1)) / cols, (availH - GAP * (rows - 1)) / rows)),
  );

  boardEl.style.gridTemplateColumns = `repeat(${cols}, ${cellSize}px)`;
  boardEl.style.gridTemplateRows = `repeat(${rows}, ${cellSize}px)`;
  boardEl.style.gap = `${GAP}px`;
  boardEl.replaceChildren();

  cells = [];
  for (let i = 0; i < rows * cols; i++) {
    const root = document.createElement('div');
    root.className = 'cell';
    root.dataset.index = String(i);
    root.style.width = `${cellSize}px`;
    root.style.height = `${cellSize}px`;

    const piece = document.createElement('div');
    piece.className = 'piece';
    root.appendChild(piece);
    boardEl.appendChild(root);

    cells.push({ root, piece });
  }
}

/* ------------------------------------------------------------------ 渲染 */

/**
 * 把碎片的图案（或灰盒色块 + 角标）刷到元素上，不含任何几何 / 动画。
 *
 * ⚠️ 这里**不再写** `background-size / background-position` —— 纹理取样统归
 * `applyPieceGeometry()` 按「整组」算（见 web/ui/geometry.ts 的长注释）。
 * 分两处写迟早对不上：一处按元素百分比、一处按组比例，接缝就会错位。
 */
function applyPieceFace(el: HTMLDivElement, pieceId: number): void {
  const imageId = imageOf(pieceId);
  const pos = positionOf(pieceId);

  if (available.has(imageId)) {
    el.style.backgroundImage = `url("${STICKER_DIR}/sticker_${imageId}.png")`;
    el.style.backgroundColor = 'transparent';
  } else {
    el.style.backgroundImage = 'none';
    // 灰盒没有纹理要取样：清掉上一块留下的取样几何，否则会沿用别人的尺寸
    el.style.removeProperty('--bg-size');
    el.style.removeProperty('--bg-pos');
    el.style.backgroundColor = colorOf(imageId);
  }

  for (const stale of Array.from(el.querySelectorAll('.pos, .iid'))) stale.remove();
  if (available.has(imageId)) return;

  const posEl = document.createElement('span');
  posEl.className = 'pos';
  posEl.textContent = String(pos);
  el.appendChild(posEl);

  const iidEl = document.createElement('span');
  iidEl.className = 'iid';
  iidEl.textContent = `图${imageId}`;
  el.appendChild(iidEl);
}

/**
 * 把「融合状态」翻译成几何 CSS 变量 + **纹理取样几何** —— 第 1 条体验问题的正面解法。
 *
 * 两件事放在一起做，因为他们必须共用同一套尺寸：
 *
 * 1. **边界感**（不再用阴影深浅暗示）：
 *    - 未融合的一侧：留 EDGE 内缩 + EDGE 宽纯白描边 → 一眼就是「一块一块的」；
 *    - 已融合的一侧：描边宽度直接归零，同时向外扩 `GAP/2` 把裂缝填掉。
 *      相邻两格各扩一半正好吃满 12px 缝隙，两侧都不再有任何白线。
 *      ⚠️ 扩展量必须**正好**是 GAP/2：以前为「保险」多给 1px，会让两块在缝上重叠
 *      2px，重叠处两块显示的原图位置差 1px —— 正是 §11.6.3 逐像素验收要抓的错位。
 * 2. **纹理取样**（§11.6.3「4 块拼成 512×512 与原图逐像素一致」）：
 *    按**整组**统一比例算 `background-size / position`（`web/ui/geometry.ts`），
 *    而不是每块各按自己的元素尺寸用百分比 —— 后者在融合时每块放大的倍率不同，
 *    接缝两侧的原图坐标对不上。算式被抽成纯函数，所以能单测。
 */
function applyPieceGeometry(
  root: HTMLDivElement,
  el: HTMLDivElement,
  pieceId: number,
  d: MergeDisplay | null,
): void {
  const up = d?.mergeUp ?? false;
  const down = d?.mergeDown ?? false;
  const left = d?.mergeLeft ?? false;
  const right = d?.mergeRight ?? false;

  /**
   * 融合时向外扩的量 = **正好半个缝隙**。
   *
   * 为什么不再「多给 1px 保险」：相邻两块各扩一半，扩多了就会在缝上重叠；
   * 重叠区里两块显示的原图位置不同（差 1px），放大截图就是一道错位。
   * 亚像素取整的残留底色问题由「融合侧描边归零」解决，不该靠多扩。
   */
  const ext = mergeExtent(GAP);
  el.style.setProperty('--pt', up ? `${-ext}px` : `${EDGE}px`);
  el.style.setProperty('--pb', down ? `${-ext}px` : `${EDGE}px`);
  el.style.setProperty('--pl', left ? `${-ext}px` : `${EDGE}px`);
  el.style.setProperty('--pr', right ? `${-ext}px` : `${EDGE}px`);

  el.style.setProperty('--bt', up ? '0px' : `${EDGE}px`);
  el.style.setProperty('--bb', down ? '0px' : `${EDGE}px`);
  el.style.setProperty('--bl', left ? '0px' : `${EDGE}px`);
  el.style.setProperty('--br', right ? '0px' : `${EDGE}px`);

  // 融合侧的角必须削平，否则两块交界处会各留一个月牙形缺口
  const r = Math.round(cellSize * 0.1);
  el.style.setProperty('--r-tl', `${up || left ? 0 : r}px`);
  el.style.setProperty('--r-tr', `${up || right ? 0 : r}px`);
  el.style.setProperty('--r-br', `${down || right ? 0 : r}px`);
  el.style.setProperty('--r-bl', `${down || left ? 0 : r}px`);

  // ≥2 块才算「融合组」：对外那几条边换成金色，整组被圈起来
  root.classList.toggle('merged', (d?.groupSize ?? 1) > 1);

  // 纹理取样：单块（d = null）时退化成 200% / 0%|100%，与旧行为逐像素等价
  if (available.has(imageOf(pieceId))) {
    const geo = pieceGeometry({
      cellSize,
      gap: GAP,
      edge: EDGE,
      groupCols: d?.groupCols ?? 1,
      groupRows: d?.groupRows ?? 1,
      colInGroup: d?.colInGroup ?? 0,
      rowInGroup: d?.rowInGroup ?? 0,
      // 单块的组：组的四象限原点就是它自己的位置码
      quadCol: d?.quadCol ?? positionOf(pieceId) % 2,
      quadRow: d?.quadRow ?? Math.floor(positionOf(pieceId) / 2),
      mergeLeft: left,
      mergeRight: right,
      mergeUp: up,
      mergeDown: down,
    });
    el.style.setProperty('--bg-size', `${geo.bgW}px ${geo.bgH}px`);
    el.style.setProperty('--bg-pos', `${geo.posX}px ${geo.posY}px`);
  }
}

/**
 * 按任意一帧的棋盘数据整盘重绘（不带动画）。
 *
 * 之所以要能吃「快照」而不只是读 engine.board：算法层把消除 / 下压 / 补位
 * 一次算完，结算动画要顺序渲染「交换后」「消除后」「补位后」三帧，
 * 这三帧只能靠 outcome.stages 里的快照还原。
 */
function paintBoard(data: readonly Cell[]): void {
  const grid = new Grid(engine.config.rows, engine.config.cols, data);
  const display = new Map<number, MergeDisplay>();
  for (const d of computeMergeDisplay(grid)) display.set(d.cellIndex, d);

  for (let i = 0; i < cells.length; i++) {
    const ref = cells[i] as CellRef;
    const pieceId = data[i] ?? null;
    const d = display.get(i) ?? null;

    for (const cls of ANIM_CLASSES) ref.root.classList.remove(cls);
    // 拖动是「状态」不是动画：重绘时一并收掉，免得残留的位移被后面的动画读走
    ref.root.classList.remove('dragging');
    ref.root.style.removeProperty('--delay');

    if (pieceId === null) {
      ref.piece.style.visibility = 'hidden';
      ref.root.classList.remove('merged');
      continue;
    }
    ref.piece.style.visibility = 'visible';
    applyPieceFace(ref.piece, pieceId);
    applyPieceGeometry(ref.root, ref.piece, pieceId, d);
  }
}

/** 便捷封装：按引擎当前盘面重绘 */
function paintAll(): void {
  paintBoard(engine.board.toArray());
}

/* ------------------------------------------------------------------ 结算动画 */

/**
 * 回放一次结算 —— **消除 5 阶段**（§6.3 / §11.6.2）：
 *   移动完成帧 → ① 识别 → ② 拼合 → ③ 确认 → ④ 消除（⑤ 得分飘字并行）→ ⑥ 掉落/补位
 *
 * 算法层是一次算完的，这里用 outcome.stages 的两帧快照把过程还原出来：
 *   afterMove      = 移动后、消除前 → 移动完成帧（整片已经落到新位置）
 *   afterEliminate = 消除后、下压前 → 用它反推「每块碎片原来在第几行」
 * 掉落位移一律由「碎片ID 在前后两帧分别落在哪一格」推导，
 * 不去依赖算法层描述路径，§4.8.4 的兜底搬运也能自然退化掉。
 *
 * `gained` 是这次移动拿到的分数（调用方在 move 前后取 engine.score 之差）——
 * 飘字的意义就是把「这 1 分加到哪儿了」讲清楚，所以不接受这里自己猜。
 */
async function playResolution(outcome: MoveOutcome, gained: number): Promise<void> {
  const cols = engine.config.cols;
  const step = cellSize + GAP;
  const stages = outcome.stages;

  if (!stages) {
    paintAll();
    return;
  }

  // 移动完成帧：整片已落到新位置、消除尚未发生，留一段时间让玩家看清「我挪成了」
  paintBoard(stages.afterMove);
  await delay(SWAP_MS);

  const group = stages.eliminatedCells;

  // 新手引导第 3 步：首次消除。赶在动画开始前弹，免得跟后面「首次掉落」那条挤在一起
  if (!eliminatedOnce) {
    eliminatedOnce = true;
    showGuide('eliminate');
  }

  // ① 识别：整组抬起 + 套一圈金环 —— 先让玩家看清「要消的是这 4 块」
  setMergePhase(group, 'recog');
  await delay(RECOGNIZE_MS);

  // ② 拼合：落回原位，读作「缝隙合上了」
  setMergePhase(group, 'fit');
  await delay(FIT_MS);

  // ③ 确认：整体一顿，读作「就是现在」
  setMergePhase(group, 'confirm');
  await delay(CONFIRM_MS);

  // ④ 消除 + ⑤ 得分飘字：飘字与消除、随后的掉落**并行**，不额外占用节奏
  setMergePhase(group, 'vanish');
  audio.play('eliminate');
  showScoreFloat(group, gained);
  await delay(VANISH_MS);

  // ⑥ 掉落 + 补位
  const finalData = engine.board.toArray();
  const moves: Array<{ index: number; cls: 'fall' | 'spawn'; dy: number }> = [];

  for (let i = 0; i < finalData.length; i++) {
    const piece = finalData[i];
    if (piece === null) continue;

    const from = stages.afterEliminate.indexOf(piece);
    if (from === i) continue; // 原地没动

    if (from < 0) {
      // 场上原本没有它 → 是补位来的，从棋盘上沿之外落进来
      moves.push({ index: i, cls: 'spawn', dy: -((Math.floor(i / cols) + 1) * step + 30) });
      continue;
    }

    const drop = Math.floor(from / cols) - Math.floor(i / cols);
    // drop === 0 只可能出现在 §4.8.4 横向搬运兜底上：硬做位移动画反而像 bug，
    // 这种情况直接落位，不做位移。
    if (drop !== 0) moves.push({ index: i, cls: 'fall', dy: drop * step });
  }

  // 先整体画成最终态，再逐个补上「从原位置滑下来」的反向位移动画。
  // 中间强制一次同步重排，避免浏览器先把最终态多画一帧（表现为闪一下）。
  paintBoard(finalData);
  void boardEl.offsetWidth;
  audio.play('drop');

  for (const move of moves) {
    const ref = cells[move.index];
    if (!ref) continue;
    ref.piece.style.setProperty('--dy', `${move.dy}px`);
    // 按列错开一点点，让下落呈「哗啦啦」的连锁感，而不是整块板平移
    ref.root.style.setProperty('--delay', `${(move.index % cols) * STAGGER_MS}ms`);
    ref.root.classList.add(move.cls);
  }

  await delay(Math.max(FALL_MS, SPAWN_MS) + cols * STAGGER_MS + 30);
  paintAll();
  // 新手引导第 4 步：首次掉落 / 补位（§14）。消除气泡还在时排队等它消失，避免两句挤在一起
  showGuide('refill');
}

/** 开局 / 重开：整盘从上方依次落下，替代原来「啪一下全出现」 */
function dropInAll(): void {
  const cols = engine.config.cols;
  const step = cellSize + GAP;

  paintAll();
  void boardEl.offsetWidth;
  audio.play('drop');

  for (let i = 0; i < cells.length; i++) {
    const ref = cells[i] as CellRef;
    if (ref.piece.style.visibility === 'hidden') continue;
    ref.piece.style.setProperty('--dy', `${-((Math.floor(i / cols) + 1) * step)}px`);
    ref.root.style.setProperty('--delay', `${i * 18}ms`);
    ref.root.classList.add('spawn');
  }

  // ⚠️ 入场动画是 `fill-mode: both`，播完必须把类名摘掉：动画里的 transform 会一直压住
  // `.piece` 上的 CSS transform（拖动位移、选中放大全部失效），见 `onPointerDown` 的注释。
  // 100% 关键帧是恒等变换，摘掉它画面不会有任何变化。
  window.setTimeout(() => {
    for (const ref of cells) {
      if (!ref) continue;
      for (const cls of ANIM_CLASSES) ref.root.classList.remove(cls);
      ref.root.style.removeProperty('--delay');
    }
  }, SPAWN_MS + cells.length * 18 + 30);
}

function flash(cellIndex: number, cls: string, ms: number): void {
  const ref = cells[cellIndex];
  if (!ref) return;
  ref.root.classList.remove(cls);
  void ref.root.offsetWidth;
  ref.root.classList.add(cls);
  window.setTimeout(() => ref.root.classList.remove(cls), ms);
}

/**
 * 把消除组的动画阶段切到 `cls`（其余前段类一起摘掉）。
 *
 * 为什么整组一起切：4 块必须**同时**进入同一阶段 —— 差一帧就会被看成「有一块没跟上」，
 * 而融合的全部说服力就在「这 4 块是一个整体」上。
 */
function setMergePhase(indices: readonly number[], cls: (typeof PHASE_CLASSES)[number]): void {
  for (const index of indices) {
    const ref = cells[index];
    if (!ref) continue;
    for (const other of PHASE_CLASSES) if (other !== cls) ref.root.classList.remove(other);
    ref.root.classList.add(cls);
  }
}

/**
 * 得分飘字（§6.3 第 5 段）：从消除处飞向 HUD 分数。
 *
 * 为什么不用 CSS 里写死一个 `translate(0, -120px)`：这条动画的全部意义就是讲清
 * 「这 1 分加到哪儿了」，所以落点必须是**真正的分数 HUD**（它随布局与安全区变化）。
 * 画布整体被 `transform: scale()` 缩放过，所以要把客户端像素差除以缩放比，
 * 才能写进元素自己的 CSS 变量 —— CSS 变量是在**画布坐标系**里被解释的。
 */
function showScoreFloat(indices: readonly number[], gained: number): void {
  const anchor = cells[indices[0] ?? -1];
  if (!anchor || indices.length === 0 || gained <= 0) return;

  const node = document.createElement('div');
  node.className = 'score-float';
  node.textContent = `+${gained}`;

  const scale = stageScale();
  const from = anchor.root.getBoundingClientRect();
  const to = scoreHudEl.getBoundingClientRect();
  node.style.setProperty('--fx', `${(to.left + to.width / 2 - from.left - from.width / 2) / scale}px`);
  node.style.setProperty('--fy', `${(to.top + to.height / 2 - from.top - from.height / 2) / scale}px`);
  anchor.root.appendChild(node);
  window.setTimeout(() => node.remove(), FLOAT_MS);

  // 数字落到分数上时让 HUD 弹一下：提前弹会「先弹后到」，晚了就成了两件不相干的事
  window.setTimeout(() => {
    scoreHudEl.classList.add('bump');
    window.setTimeout(() => scoreHudEl.classList.remove('bump'), 260);
  }, Math.round(FLOAT_MS * 0.72));
}

/**
 * 非法移动的反馈（§6.3）：**整片**朝反方向推一下再弹回 + 棋盘整体轻微抖动。
 *
 * 刻意**不用红叉、也不用刺耳音** —— 红叉表达的是「你错了」，而这里要表达的只是
 * 「这样挪不过去」。
 *
 * ⚠️`dx/dy` 是**回弹方向**（px），整片所有格子朝同一方向推：整片时代的非法操作
 * 都是「这一整片去不了那边」，而不是两块互相碰一下（那是单块时代的读法）。
 */
function rejectCells(indices: readonly number[], dx: number, dy: number): void {
  indices.forEach((index) => {
    const ref = cells[index];
    if (!ref) return;
    ref.piece.style.setProperty('--rx', `${dx}px`);
    ref.piece.style.setProperty('--ry', `${dy}px`);
    flash(index, 'reject', REJECT_MS);
  });

  // 棋盘跟着抖 3px：够让人感到「碰住了」，又不会晃到看不清盘面
  boardEl.classList.remove('reject-board');
  void boardEl.offsetWidth;
  boardEl.classList.add('reject-board');
  window.setTimeout(() => boardEl.classList.remove('reject-board'), REJECT_MS);
}

/* ---- 暂停与音效的联动（§M7 第 4 条：音效随倒计时暂停而暂停）---- */

/**
 * 倒计时是否真的在走 —— 秒针 / 加速滴答 / BGM 跟着它一起停。
 *
 * 判据与主循环那句 `if (!started || paused || finished) return;` **逐字对齐**：
 * 只要主循环不走，就不该有节拍声。写成同一个表达式，避免两处口径分叉
 * （分叉的表现就是「暂停了还在滴答」或者「开局了却一声不响」）。
 */
function syncAudio(): void {
  audio.setRunning(started && !paused && !finished && currentScreen === 'game');
}

/**
 * `paused` 的**唯一写入口**。
 *
 * 收口不只是为了可读性：暂停状态现在同时驱动音效（`syncAudio`）。谁都能直接写
 * `paused`，就一定会漏掉某一处 —— 表现是「暂停弹窗都出来了，秒针还在后面滴答」。
 */
function setPaused(next: boolean): void {
  paused = next;
  syncAudio();
}

/* ---- 新手引导高亮（§14 第 2 步）---- */

/** 高亮持续时长：够玩家扫一眼「那几块在哪儿」，又不会一直亮着挡视线 */
const HINT_MS = 2600;

/** 当前被高亮的格子下标与它的定时器 */
let hintIndices: number[] = [];
let hintTimer = 0;

/**
 * 把「可以拼成一张图」的那几块圈出来。
 *
 * 只弹一句「这 4 块可以拼成一张图」是不够的 —— 新手盯着 20 块碎片，根本不知道
 * 说的是哪 4 块。该指哪一组由纯函数 `findHintCells` 决定（可单测），这里只管加类。
 */
function showHint(): void {
  clearHint();
  if (!engine) return;
  hintIndices = findHintCells(engine.board);
  if (hintIndices.length < 2) return;
  for (const index of hintIndices) cells[index]?.root.classList.add('hint');
  hintTimer = window.setTimeout(clearHint, HINT_MS);
}

/** 摘掉高亮：超时自动撤，玩家一动手也撤（提示还亮着会干扰已经看懂的人） */
function clearHint(): void {
  if (hintTimer !== 0) {
    window.clearTimeout(hintTimer);
    hintTimer = 0;
  }
  for (const index of hintIndices) cells[index]?.root.classList.remove('hint');
  hintIndices = [];
}

/* ------------------------------------------------------------------ 新手引导（§14） */

/**
 * 引导气泡是**串行**的：上一条还在屏幕上时不叠加，排队等它消失。
 * 否则「首次消除」和「首次掉落」只隔 220ms，两句会直接盖在一起谁也看不清。
 */
function showGuide(step: GuideStep): void {
  if (guide.isDone(step)) return;
  if (guide.isVisible()) {
    window.setTimeout(() => showGuide(step), 500);
    return;
  }
  guide.show(step);
  // 最后一步（首次通关提示）走完 = 整段引导走完 → 落盘，下次不再教（§14 + M6）
  if (step === 'clear' && !meta.guideDone) {
    meta.guideDone = true;
    save.flush();
  }
}

/* ------------------------------------------------------------------ HUD / 状态 */

/**
 * 体力单独一个渲染函数。
 *
 * 它在**入场阶段**（`engine` 还没建出来）就要被调用，所以不能塞进 `updateHud()` ——
 * 那里会读 `engine.score`，在那一刻会炸。
 */
function updateHearts(): void {
  // 上限改成 10 颗后，玩法屏 HUD 那一行（返回 / 体力 / 倒计时 / 分数）放不下 10 颗心，
  // 所以这里用紧凑的「❤️ 8/10」；首页是整行显示，那里仍然画满 10 颗心（见 map.ts）。
  heartsEl.textContent = `❤️ ${meta.stamina.available}/${STAMINA_MAX}`;
  heartsEl.title = meta.stamina.pending > 0 ? `预扣中 ${meta.stamina.pending} 颗（尚未结算）` : '';
}

function updateHud(): void {
  const mm = String(Math.floor(timeLeft / 60)).padStart(2, '0');
  const ss = String(timeLeft % 60).padStart(2, '0');
  timerEl.textContent = `${mm}:${ss}`;
  timerEl.classList.toggle('warn', timeLeft <= 60 && timeLeft > 10);
  timerEl.classList.toggle('danger', timeLeft <= 10);
  scoreEl.textContent = String(engine.score);
  updateHearts();
  // HUD 是「局内状态变了」的统一出口：音效的启停搭在这里，就不会漏掉某个改状态的路径
  syncAudio();
}

function updateStatus(): void {
  const snap = engine.poolSnapshot();
  const pool = currentPool();
  const imageCount = playable[levelIndex]?.imageIds.length ?? 0;
  const remap = pool
    ? ` · 图池 ${imageCount} 张 ${pool.animalsDesigned}只/ma${pool.maDesigned}` +
      `→${pool.animalsActual}只/ma${pool.maActual}`
    : '';
  statusEl.textContent =
    `池子 池5:${snap.complete.length} / 池1:${snap.pool1.length} / 池2:${snap.pool2.length} / ` +
    `池3:${snap.pool3.length} / 池4:${snap.pool4.length} · 消除 ${engine.eliminations} 组 · ` +
    `多组同消违规 ${engine.multiMatchViolations} 次` +
    remap;
}

/* ------------------------------------------------------------------ 交互（§6.1） */

/**
 * 第一次交互开始计时（§6.1）。
 *
 * @param allowStart 是否允许在这里「替玩家开表」。
 *   只点选一格不算一次交换，因此点选只负责**恢复被暂停的计时**、
 *   不负责开表 —— 开表仍然留给真正的交换动作。
 *
 * ⚠️ 恢复暂停这件事是 M6 补的：从断点恢复进来时 `started` 已经是 true、
 * 而计时是暂停的（否则玩家弹出的弹窗还没看完就先流掉几秒）。此时若没人负责
 * 把它放行，倒计时就**永远不会走** —— 恢复弹窗里承诺的「点一下棋盘继续计时」
 * 会变成一句空话，而且玩家可以一直不落子、白想下去。
 */
function ensureRunning(allowStart = true): void {
  if (finished || busy) return;
  if (!started) {
    if (!allowStart) return;
    started = true;
    setPaused(false);
    // 计时一旦跑起来就要进断点：否则「点一下就走表，然后马上切后台」
    // 恢复出来会是一局 `started=false` 的假状态
    syncSession();
    save.markDirty();
    return;
  }
  if (paused) {
    setPaused(false);
    save.markDirty();
  }
}

/**
 * 一次**移动事务**（§1.6）：把「锚点所在的整片」平移到目标格，然后结算消除 / 下压 / 补位。
 *
 * `anchor` = 主动块（手指按住的那一块），`target` = 它的落点。整片刚性跟随（相对位置
 * 不变），被压到的碎片与整片让出的格子对位互换 —— 规则本身全在 `core/move.ts` 里（可单测），
 * 这里只管「拿结果去演动画」。单块时它就是原来的一次两块交换。
 */
function doMove(anchor: number, target: number): void {
  if (busy || finished) return;
  ensureRunning();
  busy = true;
  clearHint();

  // 分数差要在移动之前取一份：结算动画里的飘字要说清「加了多少分」
  const scoreBefore = engine.score;
  const outcome = engine.move(anchor, target);
  const gained = engine.score - scoreBefore;

  if (!outcome.accepted) {
    paintAll();
    // 非法移动：整片朝反方向撞一下再弹回 + 棋盘轻抖（§6.3），不用红叉式反馈
    const board = engine.board;
    const dr = board.rowOf(target) - board.rowOf(anchor);
    const dc = board.colOf(target) - board.colOf(anchor);
    const group = engine.groupOfCell(anchor);
    rejectCells(
      group ? group.cells : [anchor],
      -Math.sign(dc) * 12,
      -Math.sign(dr) * 12,
    );
    // 两种拒绝各有各的说法，干抖一下玩家只能自己猜
    if (outcome.rejectReason === 'rule') toast(ruleHint(), 1400);
    else if (outcome.rejectReason === 'bounds') toast('整片挪不出棋盘', 1400);
    busy = false;
    // 新手引导第 2 步：挪了 2 次还没消除 → 一边说，一边把那几块圈出来（§14）
    swapMisses += 1;
    if (swapMisses >= 2) {
      showGuide('hint4');
      showHint();
    }
    return;
  }

  audio.play('swap');
  setPaused(true);
  updateHud();
  updateStatus();
  if (outcome.stages) toast(`消除 1 组（图 ${outcome.eliminatedImage}）+${gained} 分`, 1200);

  // 解锁交给动画本身，而不是拍一个固定时长的定时器 ——
  // 否则动画长度一改，输入锁就会和画面脱节
  void playResolution(outcome, gained).then(afterResolve);
}

/**
 * 一段「消除 → 下压 → 补位」播完后的统一收尾：解锁输入、标记存档点。
 *
 * ⚠️ 这里**不能**再加任何「达标就结算」的判断（§7.2 明确没有「达标立即通关」）。
 *
 * 曾经这里有一条「分数达到本关图数就结算」的判断（把本关图数当成了分数上限），
 * 注释把它解释成「图全部消完（图池里每张图都消过一遍）」。这个说法两处都站不住，
 * 2026-09-11 由试玩反馈「时间还没到就结束了」发现并删除：
 *   1. 图池是**无限补位**的（池子1~4 恒会补回场上），棋盘根本不存在「消完」这个状态，
 *      玩家本来可以一直消到 0 秒；
 *   2. 星线最高到 11 分（第 60 关 3★），而最大图数只有 10 张 —— 这个条件等于给每关
 *      加了**隐藏分数上限**：第 3 关 3★=7 分、上限 6 分，高关卡 3★ 永远拿不到。
 *
 * 关卡结束**只有一个原因：倒计时归零**（`onLevelEnd` 的唯一调用点）。
 */
function afterResolve(): void {
  busy = false;
  if (finished) return;

  // ★ 一次交换事务到此结束（含它引发的消除 / 下压 / 补位）——
  // 此刻的棋盘、分数、随机源才是**合法存档点**（§16「存档单位 = 一次交换事务」）。
  // 不在这里落盘：交给 `save` 按 1 秒防抖合并连续交换；动画播放中则自动推迟。
  syncSession();
  save.markDirty();

  if (started) setPaused(false);
}

/* ---- 整片拖动（§1.6）：按住整片里的任何一块，整片跟着手指走 ---- */

/**
 * 位移小于它 = 一次「点」而不是拖动（手指在触屏上不可能一动不动）。
 *
 * 单位是**屏幕像素**：判据是「手指到底动没动」，那是屏幕空间的事，
 * 不该随画布缩放变化（画布像素的换算只发生在 `dragAxes()` 内部）。
 */
const TAP_SLOP = 14;

/** 一格 + 一条缝 = 一格的画布像素（跟手换算与松手吸附共用这一个步距） */
function dragStep(): number {
  return cellSize + GAP;
}

/**
 * 整片在四个方向最多还能挪几格（由最贴边的那一块决定，与 `clampShift` 同一口径）。
 *
 * 跟手预览是**连续**的，越界必须在取整之前就钳住 —— 否则手指在盘边一滑，
 * 整片会先画出界、再在松手时被拉回来。
 */
function dragLimits(indices: readonly number[]): {
  up: number;
  down: number;
  left: number;
  right: number;
} {
  const board = engine.board;
  let up = Number.POSITIVE_INFINITY;
  let down = Number.POSITIVE_INFINITY;
  let left = Number.POSITIVE_INFINITY;
  let right = Number.POSITIVE_INFINITY;
  for (const cell of indices) {
    const row = board.rowOf(cell);
    const col = board.colOf(cell);
    up = Math.min(up, row);
    down = Math.min(down, board.rows - 1 - row);
    left = Math.min(left, col);
    right = Math.min(right, board.cols - 1 - col);
  }
  return { up, down, left, right };
}

/**
 * 拖动方向口径 —— 跟手（`dragFollow`）与落定（`dragIntent`）**必须共用这一个函数**，
 * 否则会出现「看着落在 A、松手却落到 B」。
 *
 *   - 普通模式：**两轴都算** —— 可以斜着拖，整片斜着走。刚性平移对任意方向都成立
 *     （`planGroupMove` 只要求「组内每块平移后都在盘内」，不看方向）；
 *   - 噩梦模式：**只认主导轴** ——「一次一格」是它的规则（曼哈顿距离恰好 1），
 *     斜拖必须收敛到一个轴上；不收敛的话手指一斜就成了 (1,1) =
 *     横竖各一格，落点会被 `ruleAllowsShift` 判非法，反馈会莫名其妙。
 *
 * ⚠️ 入参是屏幕像素，返回**画布**像素（见 `stageScale()`）。
 */
function dragAxes(dxScreen: number, dyScreen: number): { dx: number; dy: number } {
  const scale = stageScale();
  const dx = dxScreen / scale;
  const dy = dyScreen / scale;
  if (engine.config.swapRule !== 'adjacent') return { dx, dy };
  return Math.abs(dx) > Math.abs(dy) ? { dx, dy: 0 } : { dx: 0, dy };
}

/**
 * 拖动跟手位移（**画布** px，连续值）—— 按住拖动时整片就贴着手走，**不做任何取整**，
 * 斜着拖就斜着走（两轴各自跟手，不是「只取主导轴」）。
 *
 * 只有两处会「卡住」它，都是为了把规则讲清楚：
 *   1. 噩梦模式最多 1 格（且收敛到主导轴，见 `dragAxes`）；
 *   2. 整片贴到盘边就停 —— 手再滑，整片也不会出去（两轴各自钳制，所以会沿边滑动）。
 *
 * ⚠️ 取整（吸附）**只发生在松手那一刻**（`dragIntent`）：拖动过程是「我在搬它」，
 * 松手才是「它落在哪一格」。两者混在一起，整片会在拖动途中一格一格地跳着走，
 * 读起来像「拖到一半自己掉下去了」。
 *
 * ⚠️ 两轴独立钳制与 `clampShift`（落定用）**同一口径**：都取「最贴边那一块」的上限，
 * 所以跟手尽头的位置取整后必然等于落点。
 */
function dragFollow(
  indices: readonly number[],
  dxScreen: number,
  dyScreen: number,
): { x: number; y: number } {
  const step = dragStep();
  const limits = dragLimits(indices);
  const { dx, dy } = dragAxes(dxScreen, dyScreen);
  let x = dx;
  let y = dy;
  if (engine.config.swapRule === 'adjacent') {
    x = Math.max(-step, Math.min(step, x));
    y = Math.max(-step, Math.min(step, y));
  }
  return {
    x: Math.max(-limits.left * step, Math.min(limits.right * step, x)),
    y: Math.max(-limits.up * step, Math.min(limits.down * step, y)),
  };
}

/**
 * 手指位移（**屏幕** px）→ 整片的位移（格）。返回两个值：
 *   `intent` = 玩家**想**挪多远（**两轴各自**吸附到整格；噩梦收敛到主导轴并只给 1 格）；
 *   `shift`  = 实际**能**挪多远（`clampShift` 把 intent 两轴独立钳进盘内）。
 * 两者不等 = 「想往那边走，但整片已经贴边了」—— 拒绝反馈的方向要用 `intent`。
 *
 * 只在**松手**时调用（拖动途中走 `dragFollow`，那是连续值）。
 */
function dragIntent(
  indices: readonly number[],
  dxScreen: number,
  dyScreen: number,
): { intent: { dr: number; dc: number }; shift: { dr: number; dc: number } } {
  const step = dragStep();
  const { dx, dy } = dragAxes(dxScreen, dyScreen);
  let dr = Math.round(dy / step);
  let dc = Math.round(dx / step);
  // 噩梦模式：一次只挪一格（§1.6）。拖得再远也只是 1 格 —— 这就是它的难度所在
  if (engine.config.swapRule === 'adjacent') {
    dr = Math.sign(dr);
    dc = Math.sign(dc);
  }
  const intent = { dr, dc };
  return { intent, shift: clampShift(engine.board, indices, dr, dc) };
}

/**
 * 拖动预览：把跟手位移（画布 px，可为小数）写到整片的每一块上。
 *
 * 位移写在 cell 上、由 .cell.dragging 读走（`transform: translate()`），
 * 所以**不受** `.piece` 上那组 top/left 过渡影响 —— 手到哪，整片到哪，没有延迟。
 */
function paintDrag(x: number, y: number): void {
  if (!drag) return;
  for (const index of drag.cells) {
    const ref = cells[index];
    if (!ref) continue;
    ref.root.style.setProperty('--drag-x', `${x}px`);
    ref.root.style.setProperty('--drag-y', `${y}px`);
  }
}

/**
 * 收掉拖动预览。
 *
 * ⚠️ 必须把 `--drag-x/--drag-y` **一起删掉**，不能只摘 class：掉落动画用的是
 * `--dy`（另一个变量），残留的拖动位移会在下一次动画里被读到，表现成「碎片从别处飞过来」。
 */
function clearDragPreview(indices: readonly number[]): void {
  for (const index of indices) {
    const ref = cells[index];
    if (!ref) continue;
    ref.root.classList.remove('dragging');
    ref.root.style.removeProperty('--drag-x');
    ref.root.style.removeProperty('--drag-y');
  }
}

function onPointerDown(event: PointerEvent): void {
  if (busy || finished) return;
  const cell = (event.target as HTMLElement).closest('.cell') as HTMLElement | null;
  if (!cell || cell.dataset.index === undefined) return;
  const index = Number(cell.dataset.index);
  // 拖动单位是「锚点所在的整片」（§1.6）；单块时它就退化成一次两块交换
  const group = engine.groupOfCell(index);
  drag = {
    index,
    x: event.clientX,
    y: event.clientY,
    cells: group ? group.cells.slice() : [index],
  };
  // 按下就把整片亮起来：让玩家看清「现在抓的是一整片，不只是手指下那一块」
  for (const i of drag.cells) {
    const ref = cells[i];
    if (!ref) continue;
    // ⚠️ 必须顺手摘掉残留的动画类：`.cell.spawn/.fall` 这些动画是 `fill-mode: both`，
    // 而**动画里的 transform 会盖过 CSS 里的 `transform: translate(--drag-x)`** ——
    // 开局入场动画播完类名仍挂在格子上（`dropInAll()` 之后没人清），
    // 于是「整片抓起来了、也高亮了，却纹丝不动」。拖动是玩家的即时输入，优先于入场动画。
    for (const cls of ANIM_CLASSES) ref.root.classList.remove(cls);
    ref.root.classList.add('dragging');
  }
}

function onPointerMove(event: PointerEvent): void {
  if (!drag || busy || finished) return;
  const follow = dragFollow(drag.cells, event.clientX - drag.x, event.clientY - drag.y);
  paintDrag(follow.x, follow.y);
}

function onPointerUp(event: PointerEvent): void {
  const active = drag;
  if (!active) return;
  drag = null;
  clearDragPreview(active.cells);

  const dx = event.clientX - active.x;
  const dy = event.clientY - active.y;
  if (Math.abs(dx) < TAP_SLOP && Math.abs(dy) < TAP_SLOP) {
    // 手指根本没动 = 一次「点」。**拖动是唯一的操作**（§1.6.5）：点不选中、也不交换。
    // 但仍要兑现两件与操作无关的事：撤掉引导高亮、以及「点一下棋盘继续计时」（§13 恢复弹窗的承诺）。
    clearHint();
    ensureRunning(false);
    return;
  }

  const { intent, shift } = dragIntent(active.cells, dx, dy);
  if (intent.dr === 0 && intent.dc === 0) {
    // 拖了、但两轴都没跨过半格 → 整片弹回原位，什么都不做。
    // （以前这里会当成「点了一下」把整片选中：玩家明明在拖，却被高亮成选中态，
    //   于是「点选交换」和「拖动」两套手感叠在同一个动作上。拖就是拖，落定才算数。）
    return;
  }
  if (shift.dr === 0 && shift.dc === 0) {
    // 整片顶在盘边：朝拖动方向推一下再弹回 —— 比「什么都不发生」更能说明「那边去不了」
    const push = 10;
    rejectCells(active.cells, intent.dc === 0 ? 0 : intent.dc > 0 ? push : -push, intent.dr === 0 ? 0 : intent.dr > 0 ? push : -push);
    return;
  }

  const board = engine.board;
  const target = board.index(
    board.rowOf(active.index) + shift.dr,
    board.colOf(active.index) + shift.dc,
  );
  doMove(active.index, target);
}

/** 手指被系统打断（来电 / 手势返回 / 弹窗抢走指针）：把整片放回原地，不留半截拖动状态 */
function onPointerCancel(): void {
  if (!drag) return;
  const active = drag;
  drag = null;
  clearDragPreview(active.cells);
}

/* ------------------------------------------------------------------ 结算弹窗（§12.1 ~ §12.3） */

/** 顶部「← 主界面」：中途退出，退还还没结算掉的预扣（§12.4 第三步） */
function exitToHome(): void {
  if (!ready) return;
  meta.stamina = refundStamina(meta.stamina);
  finished = true;
  setPaused(true);
  // 主动退出 = 玩家明确放弃这一局 → 断点必须一起清掉，否则下次启动还会弹
  // 「继续上次的挑战」，而这一局在玩家心里已经结束了。
  //
  // ⚠️ 别把这里读成「体力退了所以要清断点」：`refundStamina` 对 `pending = 0` 是空操作，
  // 上面那次调用只在「预扣尚未转正」时才真的退，而转正就发生在 `enterLevel()` 之后、
  // 玩家能点这个按钮之前 —— 所以中途退出**不会**退回入场费（§12.4 第二步）。
  // 别顺手改成「退出就退体力」：那会让「打不过就退出重开」变成零成本。
  clearSession();
  closeDialog();
  reopenDialog = null;
  backToSettlement = null;
  analytics.honorClosed();
  guide.hide();
  showScreen('home');
  updateHearts();
  save.flush();
}

/** 某关的三条星线。缺数据时退化成 0，与原逻辑一致（不在这里抛错） */
function starLineOf(level: number): { star1: number; star2: number; star3: number } {
  const line = STAR_LINES_BY_MODE[mode][level] ?? ([0, 0, 0] as const);
  return { star1: line[0], star2: line[1], star3: line[2] };
}

/**
 * 关卡结束的**唯一**入口，而且**无参**：结束原因在规则里只有一个 —— 倒计时归零（§7.2）。
 *
 * 参数是刻意不设的（原来有一个 `timedOut`）：只要留着一个表达「怎么结束的」入参，
 * 迟早有人会往里塞第二个取值。规则依据见 `LevelOutcome` 的说明与 §15.6 第 11 条。
 *
 * 判星、解锁、记录全部交给 `assets/scripts/core/progress.ts` 的纯函数 —— 界面只负责
 * 「问一句规则，然后照着显示」。这样 M4 的规则能单测，也能原样搬到 Cocos。
 * 玩家玩满 180 秒，打出多少分就按多少分判星，**分数不设上限**。
 */
function onLevelEnd(): void {
  finished = true;
  setPaused(true);
  updateHud();

  // 本局到此为止（倒计时归零）→ 断点作废。
  // 两种残留情况都在这里一起处理：① 直接走结算；② 停在续命弹窗上（倒计时已归零，
  // 恢复出来也没法继续打）—— 真要续命成功，会由 `revive()` 另开一条断点。
  clearSession();
  save.flush();

  const cfg = engine.config;
  const progress = progressByMode[mode];
  const outcome: LevelOutcome = {
    level: cfg.level,
    score: engine.score,
    star1: cfg.star1,
    star2: cfg.star2,
    star3: cfg.star3,
    revived,
  };

  const settlement = settleLevel(outcome, recordOf(progress, cfg.level));
  if (!settlement) {
    // 没够到 1★ 线 → 先给一次续命机会（§12.3）；本局已用过续命就只能走失败结算（§12.2）。
    // 「看了广告就算过」是不允许的：续命之后还得真的够到 1★ 线。
    //
    // 离线超时是第三种情况（§16 新口径）：玩家不在场，那 60 秒续命补不回他已经离开的时间，
    // 所以不发这个机会，直接失败结算。注意「够到 1★ 线」的一律照常通关 —— 分数是玩的时候
    // 实打实打出来的，不因为离线而作废。
    pendingOutcome = outcome;
    if (revivedUsed || offlineSettle) showFailDialog(outcome);
    else showReviveDialog(outcome);
    return;
  }

  // 通关音：与结算弹窗同时响（失败音在 showFailDialog 里，两者不会同时出现）
  audio.play('win');

  // 先落盘、再弹窗：荣誉档位要读**更新之后**的 boardBest
  // （《通关及排名》§2 的「先更新玩家本关历史最高分，再统计」就落在这个先后顺序上）
  progressByMode[mode] = commitSettlement(progress, outcome, settlement, TOTAL_LEVELS);
  showGuide('clear');
  refreshCollection();
  showHonorDialog(outcome, settlement.stars);
}

/**
 * 通关荣誉弹窗（《通关及排名》2026-09-12）—— 取代原来那个「🎉 通关成功！」结算弹窗。
 *
 * 结构固定（§五）：图标 → 标题 → 副文案 → 本关得分 → 辅助文案 → 按钮区。
 * 三档的差别只有图标、文案、按钮组合（§六）：
 *   超神 👑 —— 下一关 /（再战本关、查看排行榜）
 *   王者 🏆 —— 下一关 / 再战本关
 *   优秀 ⭐ —— 下一关 / 再战本关（**不显示名次**：这一档是鼓励档，展示排名只会让人沮丧）
 *
 * ⚠️ 三条与新案一致、但和旧实现不同的行为，**不是回退**：
 *   1. 重复通关**照样弹**，而且**照样给「下一关」** —— 旧规则「重复通关不显示下一关」
 *      （§12.1.2 / §12.1.4）已被本次新案覆盖，`LevelSettlement.showNext` 也一并删掉了；
 *      另外「下一关」以**可玩关卡表**为准，避免点了原地重开同一关、白扣一颗体力；
 *   2. 旧弹窗里的**星级三行星线 / 图鉴奖励 / 个人最高分 / 解锁提示 / 分享 / 看广告+体力**
 *      在本窗**不再出现**（策划要求整窗按新案走）。功能本身没丢：分享在预览页、
 *      加体力在主页与失败弹窗都还在；
 *   3. 续命局照常弹，但恒判 1★、按 1★ 线计分（§7.4）→ 稳定落进优秀档。
 */
function showHonorDialog(outcome: LevelOutcome, stars: number): void {
  const level = outcome.level;
  // 排名基准分用**已经更新过**的 boardBest，这样「弹窗里的名次」和「排行榜里我的名次」
  // 永远是同一个数（详见 assets/scripts/core/honor.ts 的 honorForLevel）。
  const honor: HonorOutcome = honorForLevel({
    level,
    line: starLineOf(level),
    score: outcome.score,
    stars,
    revived: outcome.revived,
    boardBest: recordOf(progressByMode[mode], level).boardBest,
  });
  const tier = honor.tier;

  const title = tier === 'god' ? HONOR.god.title : tier === 'king' ? HONOR.king.title : HONOR.pass.title;
  const desc =
    tier === 'god'
      ? HONOR.god.desc
      : tier === 'king'
        ? HONOR.king.desc(honor.percentText)
        : HONOR.pass.desc(stars);
  const sub = tier === 'god' ? HONOR.god.sub(honor.stats.rank) : tier === 'king' ? HONOR.king.sub : HONOR.pass.sub;

  // 「下一关」：不是最后一关就加载下一关；已是最后一关则换成「返回主页」并提示
  const hasNext = levelIndex >= 0 && levelIndex + 1 < playable.length;
  const nextButton: DialogButton = hasNext
    ? {
        ...costButton(HONOR.btnNext, HONOR.noStamina, () => {
          analytics.honorAction('next');
          loadLevel(levelIndex + 1);
        }),
        primary: true,
      }
    : {
        label: HONOR.btnHome,
        primary: true,
        onClick: () => {
          analytics.honorAction('home');
          toast(HONOR.lastLevelToast, 2600);
          exitToHome();
        },
      };

  const retryButton = costButton(HONOR.btnRetry, HONOR.noStamina, () => {
    analytics.honorAction('retry');
    restartLevel();
  });

  const rows: DialogButton[][] = [[nextButton]];
  if (tier === 'god') {
    rows.push([
      retryButton,
      {
        label: HONOR.btnLeaderboard,
        onClick: () => {
          analytics.honorAction('leaderboard');
          // 关掉弹窗再去排行榜（弹窗盖在所有屏之上，不关会挡住榜单），
          // 并把「返回结算」记下来 —— 从排行榜返回时原样把这张弹窗画回来
          closeDialog();
          reopenDialog = null;
          backToSettlement = () => showHonorDialog(outcome, stars);
          showScreen('leaderboard');
          leaderboardScreen.show(level, TOTAL_LEVELS);
        },
      },
    ]);
  } else {
    rows.push([retryButton]);
  }

  // 本窗没有「看广告」按钮，不需要重绘回调；显式清掉，免得留下上一张弹窗的幽灵回调
  reopenDialog = null;
  openDialog({
    title,
    // 超神/王者用图标；优秀用三颗星（按实际星级点亮）
    hero: tier === 'pass' ? { tier, stars } : { tier, icon: HONOR[tier].icon },
    desc,
    score: outcome.score,
    scoreLabel: HONOR.scoreLabel,
    sub,
    rows,
  });

  // 曝光先只开一条待合并记录；玩家点按钮时由 honorAction 补上「点了哪个」与停留时长，
  // 整张弹窗只产生**一条**埋点，而不是曝光、点击各发一次（见 ui/analytics.ts）
  analytics.honorShown({
    level,
    tier,
    score: outcome.score,
    rank: honor.stats.rank,
    percentile: honor.stats.percentile,
    stars,
  });
}

/** 续命弹窗（§12.3） */
function showReviveDialog(outcome: LevelOutcome): void {
  const gap = Math.max(1, outcome.star1 - outcome.score);
  const build = (): void => {
    openDialog({
      title: REVIVE.title,
      lines: [REVIVE.gap(gap), REVIVE.ask, REVIVE.note],
      rows: [
        [{ label: REVIVE.btnAd, primary: true, onClick: () => void watchReviveAd() }],
        [{ label: REVIVE.btnGiveUp, onClick: giveUp }],
      ],
    });
  };
  reopenDialog = build;
  build();
}

/**
 * 续命广告（§13.4）：每局 1 次、**不受每日 5 次限制**；连续 3 次加载失败 → 回续命弹窗。
 * 「没看完」不是失败，而是一次确认：放弃挑战？是 → 失败结算，否 → 重新播放。
 */
async function watchReviveAd(): Promise<void> {
  const result = await runAd('revive');
  closeDialog();
  if (result === 'watched') {
    reviveAdFailures = 0;
    revive();
    return;
  }
  if (result === 'skipped') {
    // §13.4：没看完 → 「放弃挑战？」；选否就重新播一遍
    confirmDialog({
      lines: [REVIVE.adSkippedAsk],
      yesLabel: '是，放弃',
      noLabel: '否，继续看',
      onAnswer: (yes) => {
        if (yes) giveUp();
        else void watchReviveAd();
      },
    });
    return;
  }
  reviveAdFailures += 1;
  toast(REVIVE.adFailed, 2400);
  if (reviveAdFailures >= 3) {
    // 连续 3 次失败：不再弹广告，直接把玩家送回续命弹窗（§13.4）
    toast('广告连续 3 次加载失败，请稍后再试或放弃本局', 3200);
  }
  if (pendingOutcome) showReviveDialog(pendingOutcome);
}

/** 续命：+60 秒继续本局（§7.4） */
function revive(): void {
  if (!pendingOutcome) return;
  closeDialog();
  reopenDialog = null;
  revived = true;
  revivedUsed = true;
  pendingOutcome = null;
  timeLeft += REVIVE_SECONDS;
  finished = false;
  started = true;
  setPaused(false);
  updateHud();
  // 续命成功 = 本局换了个新起点（+60 秒、续命标记入账）→ 重新开一条断点。
  // 先 `openSession` 再 `syncSession`：后者会把 `timeLeft` 覆盖成真正的 60，
  // 不然切后台再回来会白拿回一整个 `cfg.timeLimit`
  openSession(engine.config, levelSeed);
  syncSession();
  save.flush();
  toast(ADS.reviveGranted, 2600);
}

/** 放弃续命 → 失败结算（§12.2） */
function giveUp(): void {
  const outcome = pendingOutcome;
  pendingOutcome = null;
  if (outcome) showFailDialog(outcome);
}

/** 失败结算（§12.2） */
function showFailDialog(outcome: LevelOutcome): void {
  const gap = Math.max(1, outcome.star1 - outcome.score);
  const lines = [FAIL.score(outcome.score), FAIL.line(outcome.star1), FAIL.gap(gap), FAIL.tip];
  if (revivedUsed) lines.push(`💡 ${FAIL.reviveUsed}`);
  // 离线超时：玩家没看到过程就失败了，弹窗里得把原因写出来（toast 4 秒就没了，
  // 而这张弹窗会一直留在屏幕上等他回来）
  if (offlineSettle) lines.push(`💡 ${SAVE.offlineTimeout}`);

  // 失败音与弹窗同时响。放在这里（而不是 onLevelEnd）：看广告复活失败结算会重开弹窗，
  // 那时不该再响一次 —— 而 `build()` 会被赋给 reopenDialog 复用，所以必须在它外面。
  audio.play('fail');

  const build = (): void => {
    openDialog({
      title: FAIL.title,
      lines,
      rows: [
        [{ label: FAIL.btnAdStamina, primary: true, onClick: () => void watchStaminaAd() }],
        [
          costButton(FAIL.btnRetry, SETTLEMENT.noStamina, restartLevel),
          { label: FAIL.btnHome, onClick: exitToHome },
        ],
      ],
    });
  };
  reopenDialog = build;
  build();
}

/* ------------------------------------------------------------------ 排行榜（§9.3） */

/**
 * 组装某关的百名榜数据。
 *
 * ⚠️ 开发期约定（正式版由服务端提供，替换 `assets/scripts/core/honor.ts` 里的模拟数据源即可）：
 *   1. 榜单主体是**本地确定性模拟的 100 名玩家**（全部 ≥3★），界面上明确标注了这一点；
 *   2. 「我的成绩」来自本机记录：只有**上榜成绩**（≥3★ 且未续命）才插进榜里，
 *      1★ / 2★ / 续命局一律不显示名次（与 core 的上榜门槛同口径）；
 *   3. 名次、并列、百强截断全部在 core 里算 —— 界面不自己排一遍，避免两处口径分叉。
 */
function leaderboardView(level: number): LeaderboardView {
  const progress = progressByMode[mode];
  const rec = recordOf(progress, level);
  const status = levelStatus(progress, level);
  const board = boardSnapshot(level, starLineOf(level), rec.boardBest);

  return {
    level,
    rows: board.rows,
    totalPlayers: board.totalPlayers,
    myRank: board.myRank,
    boardBest: board.myBoardBest,
    personalBest: rec.personalBest,
    // 挑战按钮的状态机在 `ui/leaderboard.ts`：1★/2★/3★ 通关一律可挑战；
    // 已通关但素材不足（被跳过）的关卡也进不去，那里会给出对应文案
    challenge: challengeState(level, status, indexOfLevel(level) >= 0),
  };
}

/* ------------------------------------------------------------------ 开发工具 */

function autoOne(): void {
  if (!requireReady() || !requireEngine()) return;
  if (busy || finished) return;
  ensureRunning();
  // 与 doMove 同口径取分数差，飘字才说得清「加了多少分」
  const scoreBefore = engine.score;
  const outcome = engine.forceCompleteTargetImage();
  if (!outcome) {
    toast('当前没有可集齐的图（池子异常）');
    return;
  }
  const gained = engine.score - scoreBefore;
  busy = true;
  setPaused(true);
  updateHud();
  updateStatus();
  void playResolution(outcome, gained).then(afterResolve);
}

function selfCheck(): void {
  if (!requireReady()) return;
  const issues = engine.invariantIssues();
  const stats = save.stats;
  const saveLine = SAVE.statsLabel(save.kind, stats.writes, stats.deferred);
  updateStatus();
  if (issues.length === 0) {
    toast(`算法自检通过：HC-01~HC-06 全部成立\n${saveLine}\n` + statusEl.textContent, 3000);
  } else {
    toast(`算法自检失败：\n${issues.join('\n')}\n${saveLine}`, 6000);
  }
}

/* ------------------------------------------------------------------ 存档：启动读档 / 断点恢复 / 被动退出（§16） */

/**
 * 启动读档。
 *
 * 顺序很重要：**读档必须在 `refreshModeButton()` / `refreshHome()` 之前**，
 * 因为当前模式、各模式进度、体力都来自存档；晚一步就要么显示旧值，要么白闪一下。
 */
function loadSaveAtStartup(): { recovered: boolean; discarded: boolean; issues: string[] } {
  const fresh = freshSaveData();
  const result = parseSave(save.read(), fresh, SAVE_LIMITS, Date.now());
  applySave(result.data);
  // 读完立刻退还「悬空预扣」（§12.4）：这是唯一一处能补回来的时机
  repairStaminaAfterLoad();
  return { recovered: result.recovered, discarded: result.discarded, issues: result.issues };
}

/**
 * 存档读取失败的兜底页（§16「异常页」的等价物：给重试 + 一条明确出路）。
 *
 * 灰盒原型里唯一可能"异常"的外部依赖就是本地存档，所以网络异常页在这里落到存档上；
 * 真机接服务端后，这个弹窗可以直接复用给网络异常。
 */
function showSaveErrorDialog(issues: readonly string[]): void {
  openDialog({
    title: SAVE.errorTitle,
    lines: SAVE.errorLines(issues),
    rows: [
      [
        {
          label: SAVE.btnRetry,
          onClick: () => {
            const retry = parseSave(save.read(), freshSaveData(), SAVE_LIMITS, Date.now());
            if (retry.discarded) {
              toast(SAVE.retryStillBad, 3200);
              showSaveErrorDialog(retry.issues);
              return;
            }
            applySave(retry.data);
            repairStaminaAfterLoad();
            refreshModeButton();
            refreshHome();
            refreshCollection();
            save.flush();
            toast(SAVE.repaired(retry.issues.length), 3200);
          },
        },
        {
          label: SAVE.btnReset,
          primary: true,
          onClick: () => {
            removeSave();
            applySave(freshSaveData());
            refreshModeButton();
            refreshHome();
            refreshCollection();
            save.flush();
          },
        },
      ],
    ],
  });
}

/** 启动时能恢复的断点；`null` = 没有断点，或那一关当前开不出来 */
function resumableSession(): LevelSession | null {
  if (!loadedSession) return null;
  // 关卡可玩性必须校验：素材没补齐时那一关根本没排进 `playable`（见 `buildRenderLevels`），
  // 硬恢复会开出一个没有图池的关卡
  return indexOfLevel(loadedSession.level) >= 0 ? loadedSession : null;
}

/** 玩家选「放弃并重开」：断点作废。体力不退 —— 那颗在退出前已经转正扣除了（§12.4） */
function discardLoadedSession(): void {
  const level = loadedSession?.level;
  loadedSession = null;
  session = null;
  save.flush();
  // 弹窗是模态的：这条分支漏了 closeDialog() 会把它永久挂在屏幕上、挡死全部操作。
  // `resumeSession` 那条分支有关，别只改一边。
  closeDialog();
  reopenDialog = null;
  if (currentScreen === 'home') refreshHome();
  if (level !== undefined) toast(`已放弃第 ${level} 关的进度`, 1800);
}

/**
 * 从断点恢复一局（§16 新口径：退出后倒计时照走，回来自动接着打）。
 *
 * 参数 `judgeNow`：启动时若「离开期间倒计时已经走完」，就别把玩家丢在一个 0 秒的
 * 棋盘上 —— 恢复现场后**直接出本关判定结果**（判星 → 续命 / 失败结算），走的是
 * 与局内「倒计时归零」完全相同的入口 `onLevelEnd()`。
 *
 * 三条容易写错的点：
 *   - **不再扣体力**：这局的入场费在退出前已经转正，重新 `loadLevel()` 会再收一次；
 *   - **恢复后一律停表**：不能 `paused = false`，否则玩家还没看清棋盘就先流掉几秒；
 *   - **时间照走**：`timeLeft` 已由 `resumeTimeLeft()` 按真实流逝算好，别在这里再动它。
 */
function resumeSession(from: LevelSession, judgeNow = false): void {
  const index = indexOfLevel(from.level);
  if (index < 0) {
    loadedSession = null;
    return;
  }

  const now = Date.now();
  // 断点里的模式可能与当前模式不同（切模式不会清档）→ 先切回来
  mode = from.mode;
  refreshModeButton();
  levelIndex = index;
  loadedSession = null;

  const cfg = currentConfig();
  if (!cfg) return;

  showScreen('game');
  levelSeed = from.seed;
  rng = Rng.restore(from.rngState);
  engine = new PuzzleEngine(cfg, rng, {
    cells: from.cells,
    score: from.score,
    eliminations: from.eliminations,
  });

  // 局内现场：先摆盘再定状态，顺序反了 `paintAll()` 会按旧状态上色
  drag = null;
  finished = false;
  busy = false;
  started = from.started;
  setPaused(true);
  timeLeft = resumeTimeLeft(from, now);
  revived = from.revived;
  revivedUsed = from.revivedUsed;
  swapMisses = from.swapMisses;
  eliminatedOnce = from.eliminatedOnce;
  pendingOutcome = null;
  reviveAdFailures = 0;

  closeDialog();
  reopenDialog = null;
  layoutBoard();
  // 用 `paintAll()` 而不是 `dropInAll()`：恢复不是「新开一局」，不该再播一次入场动画
  paintAll();
  updateHud();
  updateStatus();
  refreshLevelButton();
  updateHearts();

  session = { ...from, cells: from.cells.slice(), timeLeft, savedAt: now };
  save.flush();

  if (judgeNow) {
    // 离开期间时间已经走完 → 不提示「剩余 00:00」、也不给「继续」的机会，直接给本关结果。
    // 那句 toast 只负责回答「为什么一进来就在结算」，判定本身完全交给 `onLevelEnd()`。
    // `offlineSettle` 让这次结算走失败而不是「要不要续命」——玩家不在场。
    toast(SAVE.offlineTimeout, 4200);
    offlineSettle = true;
    onLevelEnd();
    return;
  }

  toast(
    `已从第 ${from.level} 关恢复 · 剩余 ${fmtMMSS(timeLeft)}` +
      (started ? '（点一下棋盘继续计时）' : ''),
    2600,
  );
}

function showResumeDialog(from: LevelSession): void {
  // 剩余时间按「离开期间照走」现算再报给玩家（§16 新口径）：直接报断点里那个旧值，
  // 玩家会以为时间还在，一进来才发现少了十分钟
  const left = resumeTimeLeft(from, Date.now());
  openDialog({
    title: SAVE.resumeTitle,
    lines: SAVE.resumeLines(MODE_LABEL[from.mode], from.level, fmtMMSS(left)),
    rows: [
      [
        { label: SAVE.resumeNo, onClick: discardLoadedSession },
        { label: SAVE.resumeYes, primary: true, onClick: () => resumeSession(from) },
      ],
    ],
  });
}

/**
 * **被动退出**（切后台 / 关页面 / 强杀前的最后机会）。
 *
 * ⚠️ 动画播放中（`busy`）**直接不写**：此刻引擎里的棋盘已经是「交换后」的状态，
 * 落下去就等于「这次交换算数了」，而 §16 要求的恰恰是回滚到交换前 ——
 * 盘上留着的上一份存档就是交换前的状态，不动它才是对的。
 * 代价是这不到一秒的动画时长会被算进「离开时长」（`savedAt` 停在更早的时刻），
 * 产品口径上认这个偏差：动画本身不计较。
 */
function handleHidden(): void {
  if (!ready || busy) return;
  if (currentScreen !== 'game' || finished || !session || !engine) return;

  // `savedAt` = 离开时刻，是回来补扣时间的唯一基准
  session.savedAt = Date.now();
  // 停表只为挡住后台那点被节流的定时器；真正的扣减在 `handleVisible()` 一次性做
  setPaused(true);
  syncSession();
  save.flush();
}

/**
 * 切回前台：把「离开期间」的时间按真实流逝**一次性**结算掉（§16 新口径）。
 *
 * 为什么不在后台逐秒扣：`setInterval` 在后台会被浏览器节流到 1 次/分钟，逐秒扣根本
 * 扣不准。所以口径是「后台一律停表 + 回前台按时间戳补扣」—— 结果与「一直在走」等价。
 */
function handleVisible(): void {
  if (!ready || currentScreen !== 'game' || finished) return;
  // 没开始计时的一局（`started=false`）不倒扣：它本来就没在走表
  if (!session || !started) return;

  const now = Date.now();
  const next = resumeTimeLeft(session, now);
  const lost = timeLeft - next;
  timeLeft = next;
  updateHud();

  if (timeLeft <= 0) {
    // 离开期间时间走完 → 直接出判定结果，不给玩家看一个 0 秒的棋盘。
    // 与启动恢复同口径：玩家不在场，不发续命机会
    toast(SAVE.offlineTimeout, 4200);
    offlineSettle = true;
    onLevelEnd();
    return;
  }
  if (lost > 0) toast(`离开 ${lost} 秒已照扣`, 2600);
  setPaused(false);
}

/* ------------------------------------------------------------------ 启动 */

/**
 * 开发工具条的整体可用开关。
 *
 * 素材探测期间按钮置灰：既避免点到「还没数据的关卡」，也让「未就绪」这件事
 * 在界面上一眼可见，而不是点了没反应或直接抛错。
 */
function setDevbarEnabled(on: boolean): void {
  for (const button of Array.from(document.querySelectorAll('#devbar button'))) {
    (button as HTMLButtonElement).disabled = !on;
  }
}

function bindDevBar(): void {
  const actions: Record<string, () => void> = {
    prev: () => loadLevel(levelIndex - 1),
    next: () => loadLevel(levelIndex + 1),
    restart: restartLevel,
    auto: autoOne,
    check: selfCheck,
    level: () => {
      if (!requireEngine()) return;
      const cfg = engine.config;
      toast(
        `${MODE_LABEL[mode]} · 第 ${cfg.level} 关 · ${cfg.rows}×${cfg.cols} · ${cfg.timeLimit}s\n` +
          `移动规则：${cfg.swapRule === 'adjacent' ? '整片一次挪一格' : '整片任意距离'}\n` +
          `本关图ID：${cfg.imageIds.join(', ')}`,
        3200,
      );
    },
    mode: () => setMode(mode === 'normal' ? 'nightmare' : 'normal'),
    // 开发期作弊：体力耗尽就没法继续试玩，必须留个口子（正式补体力走顶部的「+」看广告）
    stamina: () => {
      const now = Date.now();
      if (!addStamina(meta, now, 1)) {
        toast(ADS.staminaFull, 1400);
        return;
      }
      save.flush();
      updateHearts();
      if (currentScreen === 'home') refreshHome();
      reopenDialog?.();
      toast(`体力 +1（当前 ${meta.stamina.available}/${STAMINA_MAX}）`, 1400);
    },
  };

  for (const button of Array.from(document.querySelectorAll('#devbar button'))) {
    const act = (button as HTMLElement).dataset.act ?? '';
    const handler = actions[act];
    // 统一在入口拦一道「数据没就绪」—— 覆盖 prev/next/restart/auto/check/level/mode 全部按钮，
    // 省得每个 handler 各自去读 undefined 的 playable / engine
    if (handler) {
      button.addEventListener('click', () => {
        if (!requireReady()) return;
        handler();
      });
    }
  }
}

async function main(): Promise<void> {
  // ── M6：存档管理器 + 读档。必须在任何界面事件之前建好（handler 里会直接用它）
  save = new SaveManager({
    snapshot: currentSave,
    // 动画播放中不落盘（§16）：防抖到点时由它把这次写入推迟到动画结束
    canWrite: () => !busy,
    onWriteError: (message) => toast(message, 4200),
  });
  const loaded = loadSaveAtStartup();

  fitStage();
  window.addEventListener('resize', onViewportChange);
  // 面板折叠/展开时 window resize 不一定触发，用 ResizeObserver 兜一层
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(onViewportChange).observe(document.documentElement);
  }
  // 拖动三个事件分工不同：按下（锁定锚点所在整片）挂在棋盘上，移动/抬起挂 window ——
  // 手指滑出棋盘甚至滑出浏览器，整片也要继续跟着，不能在半路「掉」在半空
  boardEl.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerCancel);
  // 兜住原生拖放（§1.6）：棋盘上若已经存在一段选区，在里面按下并移动，浏览器会启动
  // HTML5 拖放并立刻发 pointercancel —— 拖动被收掉，整片当场不跟手。
  // CSS 的 user-select 已经掐掉了选区的来源，这里再拦一道 dragstart。
  boardEl.addEventListener('dragstart', (event) => event.preventDefault());
  exitBtn.addEventListener('click', exitToHome);

  // 浏览器要求「有用户手势才允许出声」：第一次按下时解锁音频上下文。
  // 只挂 once —— 第一次手势没解锁成功（比如被策略拦下）后面再调用也没用，
  // 而 `unlock()` 本身是幂等的，这里只是不想每次点击都走一遍。
  window.addEventListener('pointerdown', () => audio.unlock(), { once: true });

  // ── M6：「退出」的三种形态（§16：主动返回主页 / 切后台 / 进程结束）。
  // 主动返回走 `exitToHome()`，这里覆盖后两种 —— `pagehide` 是移动端最可靠的那一个
  // （`beforeunload` 在 iOS 上基本不触发）。
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) handleHidden();
    else handleVisible();
  });
  window.addEventListener('pagehide', handleHidden);

  bindDevBar();
  refreshModeButton();

  // 探测素材期间按钮置灰 + 明示「加载中」，堵掉「点了报错」的空窗期
  setDevbarEnabled(false);
  levelBtn.textContent = '加载素材中…';
  showScreen('home');
  refreshHome();
  refreshCollection();
  toast('正在加载素材（36 张），完成后从主界面开始…', 4000);

  try {
    await probeStickers();
  } catch (err) {
    // 探测本身出错也不能把界面卡在「未就绪」—— 下面仍会用色块灰盒把第 1 关开出来
    reportError('probe', err);
  }
  buildRenderLevels();
  ready = true;
  setDevbarEnabled(true);
  levelBtn.textContent = '未开局（从主界面开始）';
  // 素材到货后再刷一次进度与图鉴：主界面要显示进度关卡
  refreshHome();
  refreshCollection();

  // ── M6：存档相关的启动播报（放在素材就绪之后：断点能不能恢复要看这一关开不开得出来）
  if (save.kind === 'memory') {
    // 介质是内存就直说，不能让玩家以为存住了
    toast(SAVE.memoryOnly, 5200);
  }
  if (loaded.discarded) {
    showSaveErrorDialog(loaded.issues);
  } else if (loaded.recovered) {
    toast(SAVE.repaired(loaded.issues.length), 5200);
  }
  const resume = resumableSession();
  if (resume) {
    // §16 新口径：离开期间倒计时照走 → 时间已经走完就直接出本关判定结果，
    // 不再弹「继续上次的挑战？」（玩家也没有时间可以接着打了）
    if (resumeTimeLeft(resume, Date.now()) <= 0) resumeSession(resume, true);
    else showResumeDialog(resume);
  } else if (loadedSession) {
    // 有断点但这一关当前开不出来（素材没补齐）→ 直接作废，但要说明白为什么
    const level = loadedSession.level;
    loadedSession = null;
    session = null;
    save.flush();
    toast(`上次的第 ${level} 关素材尚未补齐，断点已作废`, 3600);
  }

  /**
   * 元系统心跳：每秒推进一次体力恢复与广告跨天重置。
   * 用时间戳推进（见 meta.ts），所以这里只负责「发现变化就重绘」，不负责累加。
   */
  window.setInterval(() => {
    const now = Date.now();
    const rolled = rollOverDay(meta, now);
    if (rolled) refreshHome();
    if (tickMeta(meta, now)) {
      // 体力恢复 / 跨天重置都改了要落盘的字段（§M6：体力变化实时存档）。
      // 频率天然很低：每 20 分钟恢复一次、每天跨天一次 —— 不会变成每秒写盘
      save.flush();
      updateHearts();
      refreshHome();
      reopenDialog?.();
    } else if (currentScreen === 'home') {
      homeScreen.tick(meta.stamina.available, staminaCountdown(meta, now));
    }
  }, 1000);

  window.setInterval(() => {
    if (!started || paused || finished) return;
    // §16 新口径：退出期间倒计时照走，但**不在这里逐秒扣** —— 后台的 `setInterval`
    // 会被节流到 1 次/分钟，逐秒扣根本扣不准。这段时间统一由 `handleVisible()`
    // 在回前台时按 `savedAt` 一次性补扣。
    if (document.hidden) return;
    timeLeft -= 1;
    // 秒针（≤30s）与加速滴答（≤10s）：与 HUD 变色同步，闭着眼也能听出余量（§15）
    if (timeLeft <= 10) audio.play('rush');
    else if (timeLeft <= 30) audio.play('tick');
    if (timeLeft <= 0) {
      timeLeft = 0;
      updateHud();
      onLevelEnd();
      return;
    }
    updateHud();
  }, 1000);

  if (available.size === 0) {
    toast('未检测到 art/stickers/sticker_*.png —— 当前为色块灰盒形态。\n把图放进 art/stickers/ 并命名 sticker_0.png 起，刷新即自动接入真图。', 6000);
  } else {
    const lines = [
      `已接入 ${available.size} 张真图，开放 ${playable.length} 关（每关图池从素材池随机抽取）`,
    ];
    if (missingStickers.length > 0) {
      lines.push(
        `⚠️ 另有 ${missingStickers.length} 张素材重试 3 次仍未加载成功（ID: ${missingStickers.join('、')}），` +
          `本次按色块灰盒处理 —— 依赖它们的关卡会被算成「图池偏离设计表」，` +
          `那不是设计表的问题：刷新重试即可，反复失败请检查网络或素材体积`,
      );
    }
    if (skipped.length > 0) {
      lines.push(`第 ${skipped.join('、')} 关所需图数超过到货张数，已暂不开放 —— 补齐素材后刷新即自动开放`);
    }
    if (poolMismatch.length > 0) {
      lines.push(
        `⚠️ 第 ${poolMismatch.join('、')} 关因素材分布不足，图池构成偏离设计表：` +
          `本关难度与设计不一致，暂请只看观感，别当正式难度验收`,
      );
    }
    if (poolIssues.length > 0) lines.push(`⚠️ ${poolIssues.join('；')}`);
    toast(lines.join('\n'), skipped.length || poolMismatch.length ? 7000 : 2600);
  }
}

void main();

/* 供控制台排查用：`__proto` 里能直接看到当前状态 */
Object.assign(window, {
  __mengchong: {
    meta,
    progressByMode,
    get engine() {
      return engine;
    },
    get playable() {
      return playable;
    },
    /** 当前断点（null = 不在局中）与存档现场 */
    get session() {
      return session;
    },
    /**
     * 局内运行态。排查「倒计时该走却没走 / 该停却停了」时先看这里 ——
     * 光看 `session.timeLeft` 是看不出「暂停中」和「刚好没走」的区别的。
     */
    state: () => ({ started, paused, busy, finished, timeLeft, screen: currentScreen, levelSeed }),
    /** M6 存档现场：介质、写入次数、以及「如果现在落盘会写成什么」 */
    save: {
      kind: () => save.kind,
      stats: () => save.stats,
      flush: () => save.flush(),
      peek: () => currentSave(),
    },
    /**
     * M7 音效现场。排查「没声音 / 暂停了还在滴答」时先看这里：
     *   unlocked=false → 还没被用户手势解锁（浏览器策略，不是代码问题）
     *   running=false  → 倒计时没在走，所以秒针与 BGM 是**应该**停的
     */
    audio: () => audio.state(),
    unlockedImageIds,
  },
});
