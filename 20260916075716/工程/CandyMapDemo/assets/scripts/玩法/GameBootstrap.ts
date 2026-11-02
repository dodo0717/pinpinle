/**
 * 关卡启动器 —— Cocos 版，对应 web/main.ts 的「局内」那一半（开局 / 交互 / 消除 /
 * 结算 / 存档 / 体力 / 引导 / 音效）。
 *
 * ── 与原版的口径差异 ──────────────────────────────────────────────
 * 原版是单页应用，`main.ts` 里的模块级变量天然就是全局状态；Cocos 里地图与关卡是
 * 两个节点、来回切换，所以全局状态收进了 `state.ts`（`GS`），本文件只管局内现场。
 *
 * ── 存档单位（§16）────────────────────────────────────────────────
 * 一次**交换事务**结束后才落盘。动画播放中不写（`canWrite` 挡一道），
 * 所以中途被杀进程时盘上留的一定是上一个事务结束时的合法状态。
 */

import {
  _decorator, Component, Node, UITransform, Vec3, Vec2, Layers, Graphics, Label, Color,
  view, ResolutionPolicy, game, Game, EventTouch, UIOpacity, tween,
} from 'cc';
import { BoardView, ANIM, GAP } from './BoardView';
import { GameDialog } from './GameDialog';
import { ToastLayer, fmtMMSS } from './toast';
import { GameAudio } from './audio';
import { GuideBar } from './guide';
import { GS } from './state';
import { MODE_LABEL, HOME, HONOR, REVIVE, FAIL, SAVE, ADS, SHARE, GUIDE, BOARD, TUTORIAL, TUTORIAL_VOICE } from './text';
import {
  adDenyText, flushTracking, playAd, reportLevelEnd, reportLevelFail, reportLevelStart,
  setPlatformToast, shareCard, sharer, startTracking,
} from './platformBridge';
import { unlockedImageIds, clearedCount } from './meta';
import { createSpeech, type GameSpeech } from './speech';
import { ResultPopup, type ResultButton } from '../界面/ResultPopup';
import { SpotlightLayer, type SpotlightRect } from './spotlight';
import { HandHint } from './handHint';
import {
  TutorialBanner, TutorialHud, tutorialConfig, buildTutorialLayout, tutorialScript,
  tutorialSayDuration, TUTORIAL_SEED, TUTORIAL_LEVEL,
} from './tutorial';
import {
  PuzzleEngine, Grid, Rng, buildLevelConfigs, computeMergeDisplay, clampShift, findHintCells,
  settleLevel, commitSettlement, recordOf, resumeTimeLeft, honorForLevel, boardSnapshot,
  TOTAL_LEVELS, reviveSecondsFor,
  type MoveOutcome, type ResolveStages, type LevelOutcome, type LevelSettlement,
  type LevelConfig, type LevelSession, type Cell, type ProgressData, type GameMode,
} from '../核心/index';

const { ccclass, property } = _decorator;

const DESIGN_W = 1080;
const DESIGN_H = 1920;
/* ── 对局屏布局 —— 与 web/index.html 的 .game-card / .game-topbar / #board-wrap 逐项对齐 ──
   数值全部是 1080×1920 逻辑坐标里的 CSS 盒（y 向下），用到 Cocos 里再换算成 y 向上。 */
/** .game-card：margin 8、金边 border 10（#D9A227）、圆角 52、蓝底 #0058B0 */
const CARD_MARGIN = 8;
const CARD_BORDER = 10;
const CARD_RADIUS = 52;
const CARD_INNER_X = CARD_MARGIN + CARD_BORDER;                  // 18：内容盒左沿
const CARD_INNER_W = DESIGN_W - CARD_INNER_X * 2;                // 1044
const CARD_INNER_TOP = CARD_MARGIN + CARD_BORDER;                // 18
const CARD_INNER_BOTTOM = DESIGN_H - CARD_MARGIN - CARD_BORDER;  // 1902
/** .game-topbar：高 240（≈12.5% 屏高），下 margin 10（天空蓝赛场计分条） */
const TOPBAR_H = 240;
const TOPBAR_MARGIN_BOTTOM = 10;
/** #board-wrap：顶栏之下到卡片内沿的整块区域（web flex:1） */
const WRAP_TOP = CARD_INNER_TOP + TOPBAR_H + TOPBAR_MARGIN_BOTTOM; // 268
const WRAP_H = CARD_INNER_BOTTOM - WRAP_TOP;                     // 1634
/** 棋盘容器（沿用旧名）：CSS 盒 y ∈ [268, 1902] → Cocos 中心原点 y ∈ [-942, 692] */
const BOARD_TOP = DESIGN_H / 2 - WRAP_TOP;                       // 692
const BOARD_BOTTOM = DESIGN_H / 2 - CARD_INNER_BOTTOM;           // -942
/** #board 的边框（web：border: 1px solid rgba(255,255,255,.12)，圆角 44） */
const BOARD_BORDER = 1;
/** 棋盘目标占屏比（web main.ts `BOARD_FILL = 0.98`） */
const BOARD_FILL = 0.98;
/** 小于这个位移视为点击（画布 px） */
const TAP_SLOP = 14;
/** 续命加时（秒）—— **按关段取值**，见 `reviveSecondsFor()`（2026-10-29 起分段） */
/** 融合三阶段 + 消除 + 掉落的总时长，用于排下一次动作 */
const RESOLVE_TAIL = 0.05;

@ccclass('GameBootstrap')
export class GameBootstrap extends Component {
  @property({ tooltip: '关卡序号，1~60' })
  levelIndex = 1;

  @property({ tooltip: '独立调试时自动开局；接地图时保持 false' })
  autoStart = false;

  private view: BoardView = null!;
  private dialog: GameDialog = null!;
  /** 结算吊牌（星级 + 滚动分数；与通用 dialog 共存 —— 复活/提示仍走 dialog） */
  private result: ResultPopup = null!;
  private toast: ToastLayer = null!;
  private audio: GameAudio = null!;
  private guide: GuideBar = null!;

  private engine: PuzzleEngine = null!;
  private rng: Rng = null!;
  private cfg: LevelConfig = buildLevelConfigs('normal')[0]!;

  /* ---------------------------------------------------------------- 局内现场 */
  private timeLeft = 0;
  private started = false;
  private paused = false;
  private busy = false;
  private finished = false;
  private revived = false;
  private revivedUsed = false;
  private swapMisses = 0;
  private eliminatedOnce = false;
  /** 离开期间倒计时已走完 → 恢复后直接结算，不给续命 */
  private offlineSettle = false;
  private levelSeed = 0;
  /** 未达星线时的结算结论，续命失败后用它出失败弹窗 */
  private pendingOutcome: LevelOutcome | null = null;
  /** 开局时刻（埋点的 durationSec 用它算，不靠 timeLeft 反推 —— 续命会把时间加回去） */
  private levelStartedAt = 0;
  /** 本次打开里每关的尝试次数（埋点 level_start 的 attempt） */
  private attempts = new Map<number, number>();

  /* ---------------------------------------------------------------- 拖动 */
  private dragCells: number[] = [];
  private dragAnchor = -1;
  private dragStart = new Vec2();
  private dragging = false;

  /* ---------------------------------------------------------------- HUD
   * 结构照 web/index.html：.game-card（金边卡片）> .game-topbar（四栏）+
   * #board-wrap。四栏 = 返回 ← / 目标旗 + 星线数 / 深蓝翻牌计分 ×2 / 🕒 倒计时。 */
  private hudGoalNum: Label = null!;
  private hudTime: Label = null!;
  /** 翻牌两位计分（web #score-tens / #score-units，显示 score % 100） */
  private flapTens: Label = null!;
  private flapUnits: Label = null!;
  private flapTensVal = '';
  private flapUnitsVal = '';
  private flapTensBusy = false;
  private flapUnitsBusy = false;
  /** 计分面板（bump 动画的载体）与计时器（danger 脉冲的载体） */
  private scorePanel: Node = null!;
  private timerNode: Node = null!;
  private timerPulsing = false;
  private timerPulseTween: ReturnType<typeof tween> | null = null;
  private hintTimer: ReturnType<typeof setTimeout> | null = null;
  private guideStep = 0;
  /** 进关时的图鉴已解锁数，用来只播报「本关新解锁的」 */
  private lastUnlocked = 0;

  /* ---------------------------------------------------------------- 新手教学（序章） */
  /** 教学：首页「教学」入口 / 抽屉调 startTutorial() 进入；finishTutorial() 置回 null */
  private tut: {
    mode: GameMode;
    step: number;
    demoing: boolean;
    locked: boolean;
    targetIndex: number;
    gapIndex: number;
    fixed: number[];
    groupCells: number[];
  } | null = null;
  private tutBanner: TutorialBanner = null!;
  /** 序章的三颗进度点 + 右上角「跳过教学」（Web `main.ts:652-673`） */
  private tutHud: TutorialHud = null!;
  private tutHand: HandHint = null!;
  private tutSpot: SpotlightLayer = null!;
  private speech: GameSpeech = null!;
  /** 隐藏条件：困难模式累计通关 ≥ 10 关之后，首页教学入口消失（main.ts TUTORIAL_HIDE_AFTER） */
  static readonly TUTORIAL_HIDE_AFTER = 10;

  /* ================================================================ 生命周期 */

  onLoad(): void {
    view.setDesignResolutionSize(DESIGN_W, DESIGN_H, ResolutionPolicy.FIXED_WIDTH);

    const host = new Node('BoardHost');
    host.parent = this.node;
    host.layer = Layers.Enum.UI_2D;
    host.addComponent(UITransform).setContentSize(CARD_INNER_W, BOARD_TOP - BOARD_BOTTOM);
    host.setPosition(0, (BOARD_TOP + BOARD_BOTTOM) / 2);
    this.view = host.addComponent(BoardView);

    this.dialog = this.mount('Dialog', GameDialog);
    this.result = ResultPopup.create(this.node);
    this.result.rootNode().setSiblingIndex(this.node.children.length - 1); // 压在 HUD 之上
    this.toast = this.mount('Toast', ToastLayer);
    this.audio = this.mount('Audio', GameAudio);
    this.guide = this.mount('Guide', GuideBar);
    this.buildHud();

    // 动画播放中不落盘（§16）：此刻引擎里已是「交换后」状态，写下去等于承认这次交换
    GS.canWrite = () => !this.busy;
    GS.init();
    startTracking();   // 埋点：建身份 + first_open / session_start（幂等）
    this.announceSaveResult();

    this.bindInput();
    this.applyAudioSettings();
    game.on(Game.EVENT_HIDE, this.handleHidden, this);
    game.on(Game.EVENT_SHOW, this.handleVisible, this);
    // 元系统心跳：跨天重置 + 体力按时间戳恢复（与原版 main() 的 1s 心跳同口径）
    this.schedule(this.onMetaTick, 1);

    // 教学全家桶（序章）：横幅钉在棋盘上方、手指挂在棋盘里、聚光灯盖全屏
    this.tutBanner = TutorialBanner.create(this.node);
    // Web `.tut-banner` 是 `top: 250px` **顶部锚定**（挂 #stage）→ Cocos 顶边 y = 960 − 250 = 710，
    //    单行本体高 101 → 中心 y = 710 − 50.5 ≈ 660。之前放 700 是拍脑袋，偏下 40px。
    this.tutBanner.setPosition(0, 660);
    this.tutHud = TutorialHud.create(this.node, () => this.exitTutorial());
    this.tutHand = HandHint.create(this.view.node);
    this.tutSpot = SpotlightLayer.create(this.node);
    this.speech = createSpeech();
  }

  onDestroy(): void {
    game.off(Game.EVENT_HIDE, this.handleHidden, this);
    game.off(Game.EVENT_SHOW, this.handleVisible, this);
    if (this.hintTimer !== null) clearTimeout(this.hintTimer);
  }

  start(): void {
    if (this.autoStart) this.startLevel(this.levelIndex);
  }

  private mount<T extends Component>(name: string, cls: new () => T): T {
    const n = new Node(name);
    n.parent = this.node;
    n.layer = Layers.Enum.UI_2D;
    n.addComponent(UITransform).setContentSize(DESIGN_W, DESIGN_H);
    const c = n.addComponent(cls);
    n.setSiblingIndex(this.node.children.length - 1);
    return c;
  }

  /** 读档播报：介质降级 / 整档作废 / 字段修复（原版 main() 步骤 18） */
  private announceSaveResult(): void {
    const r = GS.readResult;
    if (!r) return;
    if (GS.save.kind === 'memory') this.toast.show(SAVE.memoryOnly, 5200);
    if (r.discarded) {
      this.dialog.show(SAVE.errorTitle, SAVE.errorLines(r.issues), [
        { text: SAVE.retry, onClick: () => { this.retryLoad(); } },
        { text: SAVE.reset, onClick: () => { GS.reset(); this.toast.show('存档已重置', 2600); }, primary: true },
      ]);
      return;
    }
    if (r.recovered) this.toast.show(SAVE.repaired(r.issues.length), 5200);
  }

  private retryLoad(): void {
    const r = GS.load();
    if (r.discarded) {
      this.toast.show(SAVE.retryStillBad, 3200);
      this.announceSaveResult();
      return;
    }
    this.toast.show(SAVE.repaired(r.issues.length), 3200);
    GS.flush();
  }

  private onMetaTick(): void {
    GS.tick();
  }

  /* ================================================================ 开局 */

  /**
   * 开一局（外部入口：地图点击 / 独立调试）。
   *
   * 若存档里有同一关的断点，先问「继续 / 放弃重开」—— 断点恢复**不重复扣体力**：
   * 入场费在退出前已经转正过一次了，再扣一次等于玩一局花两颗。
   */
  startLevel(level: number): void {
    const lv = Math.min(Math.max(level, 1), TOTAL_LEVELS);
    const s = GS.session;
    if (s && s.level === lv) {
      this.offerResume(s);
      return;
    }
    if (s && s.level !== lv) {
      // 换了关 → 旧断点作废
      GS.setSession(null);
      this.toast.show(SAVE.discarded(s.level), 1800);
    }
    this.beginLevel(lv, null);
  }

  private offerResume(s: LevelSession): void {
    const left = resumeTimeLeft(s, Date.now());
    if (left <= 0) {
      // 离开期间已经走完：直接判，不给玩家看一个 0 秒的棋盘
      this.beginLevel(s.level, s);
      this.offlineSettle = true;
      this.scheduleOnce(() => this.onLevelEnd(), 0.5);
      return;
    }
    this.dialog.show(
      SAVE.resumeTitle,
      SAVE.resumeLines(MODE_LABEL[s.mode], s.level, fmtMMSS(left)).slice(),
      [
        { text: SAVE.resumeNo, onClick: () => { this.discardSession(); this.beginLevel(s.level, null); } },
        { text: SAVE.resumeYes, onClick: () => this.beginLevel(s.level, s), primary: true },
      ],
    );
  }

  private discardSession(): void {
    const s = GS.session;
    const lv = s?.level ?? 0;
    GS.setSession(null);
    GS.flush();
    if (lv) this.toast.show(SAVE.discarded(lv), 1800);
  }

  /**
   * 真正建一局。`from` 为 null 表示新开（要扣体力），否则按断点恢复。
   */
  private beginLevel(level: number, from: LevelSession | null): void {
    this.unschedule(this.onTick);
    this.clearHint();

    const cfgs = buildLevelConfigs(from?.mode ?? GS.mode);
    this.cfg = cfgs[level - 1] ?? cfgs[0]!;
    this.levelIndex = level;

    if (from) {
      this.rng = Rng.restore(from.rngState);
      this.levelSeed = from.seed;
      this.engine = new PuzzleEngine(this.cfg, this.rng, {
        cells: from.cells,
        score: from.score,
        eliminations: from.eliminations,
      });
      this.timeLeft = resumeTimeLeft(from, Date.now());
      this.revived = from.revived;
      this.revivedUsed = from.revivedUsed;
      this.swapMisses = from.swapMisses;
      this.eliminatedOnce = from.eliminatedOnce;
      this.started = from.started;
    } else {
      // 入场计费（§12.4 第一步）
      const pre = GS.preDeduct();
      if (!pre.ok) {
        // 已经预扣过说明上一局没走完退出流程，这里把那颗退回去再重扣，不让玩家白花
        // ⚠️ 同上：`strict:false` 下联合类型不做判别式收窄，显式取一次（运行期不变）
        if ((pre as { reason?: 'exhausted' | 'already-pending' }).reason === 'already-pending') {
          GS.refundStamina();
          const again = GS.preDeduct();
          if (!again.ok) { this.toast.show(HOME.staminaShort, 2600); return; }
        } else {
          this.toast.show(HOME.staminaShort, 2600);
          return;
        }
      }
      this.levelSeed = Date.now() % 0xffffffff;
      this.rng = new Rng(this.levelSeed);
      this.engine = new PuzzleEngine(this.cfg, this.rng);
      this.timeLeft = this.cfg.timeLimit;
      this.revived = false;
      this.revivedUsed = false;
      this.swapMisses = 0;
      this.eliminatedOnce = false;
      this.started = false;
      // 埋点的 attempt：同一次打开里第几次开这一关（通关后清零，见 onLevelEnd）
      this.attempts.set(level, (this.attempts.get(level) ?? 0) + 1);
    }

    this.finished = false;
    this.levelStartedAt = Date.now();
    this.busy = false;
    this.pendingOutcome = null;
    this.lastUnlocked = unlockedImageIds(GS.progress).length;
    // 设置页可能在地图场景改过开关，进关时重新应用一次
    this.applyAudioSettings();
    this.dragCells = [];
    this.dragAnchor = -1;
    this.dragging = false;

    this.layout();
    // 先探一遍本关贴图（原版 probeStickers）：避免开局铺一盘空白再一张张冒出来
    this.view.prewarm(this.cfg.imageIds, (missing) => {
      if (missing.length > 0) {
        this.toast.show(`第 ${level} 关有 ${missing.length} 张图未到货，显示为灰块`, 3200);
      }
    });
    this.paintAll();
    if (from) {
      // 恢复不重播入场动画（玩家已经看过一遍了）
      this.setPaused(true);
    } else {
      this.view.playDropIn();
      this.setPaused(false);
      // 渲染完成 → 入场费转正（§12.4 第二步）
      GS.confirmStamina();
    }

    this.syncSession();
    GS.flush();
    this.updateHud();
    reportLevelStart({
      level: this.levelIndex,
      mode: GS.mode,
      attempt: this.attempts.get(this.levelIndex) ?? 1,
    });
    this.schedule(this.onTick, 1);
    this.runGuide(1);

    if (from) {
      this.toast.show(SAVE.resumed(from.level, fmtMMSS(this.timeLeft), this.started), 2600);
    }
  }

  /**
   * 排盘 —— 逐行照抄 web/main.ts `layoutBoard()` 的口径：
   * 先按「棋盘占屏 98%」算目标格宽（`BOARD_FILL × 整屏`，不是包裹层），
   * 再夹包裹层可用空间（内容盒 − 棋盘自身边框），最后 `max(36, floor(min))`。
   * 第 1 关（4×3）解出 cell = 339、棋盘宽 1041 —— 与 Web 实测一致。
   */
  private layout(): void {
    const rows = this.cfg.rows;
    const cols = this.cfg.cols;
    const byW = (BOARD_FILL * DESIGN_W - GAP * (cols - 1)) / cols;
    const byH = (BOARD_FILL * DESIGN_H - GAP * (rows - 1)) / rows;
    const maxW = (CARD_INNER_W - BOARD_BORDER * 2 - GAP * (cols - 1)) / cols;
    const maxH = (WRAP_H - BOARD_BORDER * 2 - GAP * (rows - 1)) / rows;
    const cell = Math.max(36, Math.floor(Math.min(byW, byH, maxW, maxH)));
    this.view.build(rows, cols, cell);
  }

  private paintAll(): void {
    this.view.setCells(this.engine.board.toArray());
    this.view.applyMerge(computeMergeDisplay(this.engine.board));
  }

  /* ================================================================ 输入 */

  private bindInput(): void {
    const host = this.view.node;
    host.on(Node.EventType.TOUCH_START, this.onTouchStart, this);
    host.on(Node.EventType.TOUCH_MOVE, this.onTouchMove, this);
    host.on(Node.EventType.TOUCH_END, this.onTouchEnd, this);
    host.on(Node.EventType.TOUCH_CANCEL, this.onTouchEnd, this);
  }

  private localOf(e: EventTouch): Vec3 {
    const p = e.getUILocation();
    const t = this.view.node.getComponent(UITransform)!;
    return t.convertToNodeSpaceAR(new Vec3(p.x, p.y, 0));
  }

  /** 本地坐标 → 格子下标，落在缝隙或界外返回 -1 */
  private hitCell(p: Vec3): number {
    const s = this.view.step;
    const rows = this.cfg.rows;
    const cols = this.cfg.cols;
    const totalW = cols * s - GAP;
    const totalH = rows * s - GAP;
    const col = Math.floor((p.x + totalW / 2) / s);
    const row = Math.floor((totalH / 2 - p.y) / s);
    if (row < 0 || col < 0 || row >= rows || col >= cols) return -1;
    // 格缝不再判空：手指落在缝上就归给相邻格，否则会有「明明按在图上却拖不动」的死角
    return this.engine.board.index(row, col);
  }

  /**
   * 拖动方向收敛（对应原版 dragAxes）：困难模式只允许「一次挪一格」，
   * 斜着拖必须收敛到主导轴 —— 否则算出 (1,1) 的位移会被规则直接拒绝，
   * 玩家只会觉得「这游戏有时候拖不动」。
   */
  private axes(dr: number, dc: number): { dr: number; dc: number } {
    if (this.cfg.swapRule !== 'adjacent') return { dr, dc };
    if (Math.abs(dr) >= Math.abs(dc)) return { dr: Math.sign(dr) * Math.min(1, Math.abs(dr)), dc: 0 };
    return { dr: 0, dc: Math.sign(dc) * Math.min(1, Math.abs(dc)) };
  }

  private onTouchStart(e: EventTouch): void {
    if (this.busy || this.finished) return;
    const cell = this.hitCell(this.localOf(e));
    if (cell < 0) return;
    this.speech.warmup(); // 首次手势拿朗读许可（Web 版 main.ts 首次 pointerdown 同款）
    if (!this.tutorialGuardDown(cell)) return; // 教学输入锁：不是这一步该动的块就不响应
    const group = this.engine.groupOfCell(cell);
    if (!group) return;
    this.dragCells = group.cells.slice();
    this.dragAnchor = cell;
    this.dragStart = e.getUILocation();
    this.dragging = true;
    // 第一次真实手势时解锁音频（自动播放会被拦，必须等到用户操作）
    this.audio.unlock();
    // 点选只恢复计时，**不开表**：开表交给真正拖动的那一下（原版 ensureRunning(allowStart)）
    if (this.started && this.paused) this.setPaused(false);
    this.runGuide(2);
  }

  private onTouchMove(e: EventTouch): void {
    if (!this.dragging) return;
    const p = e.getUILocation();
    const raw = { dr: -(p.y - this.dragStart.y) / this.view.step, dc: (p.x - this.dragStart.x) / this.view.step };
    const a = this.axes(raw.dr, raw.dc);
    // 跟手用**连续值**（否则整片只能一格一格跳）；边界由 clampShift 兜住
    const sh = clampShift(this.engine.board, this.dragCells, a.dr, a.dc);
    this.view.setDragOffset(this.dragCells, sh.dc * this.view.step, -sh.dr * this.view.step);
  }

  private onTouchEnd(e: EventTouch): void {
    if (!this.dragging) return;
    this.dragging = false;
    const p = e.getUILocation();
    const dx = p.x - this.dragStart.x;
    const dy = p.y - this.dragStart.y;
    this.view.clearDrag();

    if (Math.abs(dx) < TAP_SLOP && Math.abs(dy) < TAP_SLOP) return;

    // intent = 玩家想挪几格；shift = 实际能挪几格。两者分开，
    // 贴着盘边往上拖（intent≠0 但 shift=0）才有依据给「这个方向被挡住了」的回弹
    const intent = this.axes(Math.round(-dy / this.view.step), Math.round(dx / this.view.step));
    const shift = clampShift(this.engine.board, this.dragCells, intent.dr, intent.dc);
    const dr = Math.round(shift.dr);
    const dc = Math.round(shift.dc);

    if (intent.dr === 0 && intent.dc === 0) return;
    if (dr === 0 && dc === 0) {
      // 不是「没拖动」，是「拖了但那个方向走不了」—— 必须给反馈
      this.view.playReject(this.dragCells, intent.dc * 10, -intent.dr * 10);
      this.view.playBoardReject();
      return;
    }

    const b = this.engine.board;
    const row = b.rowOf(this.dragAnchor) + dr;
    const col = b.colOf(this.dragAnchor) + dc;
    const target = b.index(row, col);
    if (!this.tutorialGuardMove(this.dragAnchor, target)) return; // 教学落点锁
    this.doMove(this.dragAnchor, target, intent);
  }

  private doMove(anchor: number, target: number, intent: { dr: number; dc: number }): void {
    if (this.busy || this.finished) return;
    const before = this.engine.score;
    this.busy = true;
    const outcome = this.engine.move(anchor, target);

    if (!outcome.accepted) {
      this.swapMisses += 1;
      this.view.playReject(this.dragCells, intent.dc * 12, -intent.dr * 12);
      this.view.playBoardReject();
      this.scheduleOnce(() => { this.busy = false; }, ANIM.reject);
      // web doMove 的 hint4 分支：挪了 2 次还没消除 → 自动把最优可拼组圈出来（2.6s 后自撤）。
      // （引导文案的接线归教学屏批次，这里只补「提示」这条行为。）
      if (this.swapMisses >= 2) this.showHint();
      return;
    }

    // 第一次成功拖动 = 开表（原版 ensureRunning 的 allowStart 分支）
    if (!this.started) {
      this.started = true;
      this.setPaused(false);
    }
    this.setPaused(true);
    this.audio.play('swap');
    this.runGuide(3);
    this.tutorialAfterMove(); // 第 4 步「整片一起走」在此推进（动画播放前，Web 版同口径）
    this.playResolution(outcome, outcome.score - before);
  }

  /* ================================================================ 消除演出 */

  /**
   * 一次交换的完整演出（§6.3）：
   *   移动完成帧 → ① 识别 → ② 拼合 → ③ 确认 → ④ 消除 → ⑤ 得分飘字（并行）→ ⑥ 掉落/补位
   *
   * ①②③ 是「融合」这件事的全部说服力：4 块必须**同时**进入同一阶段，
   * 差一帧就会被看成「有一块没跟上」。原版为此写了 keyframes，这里靠同一时刻触发的
   * tween 保证同步。
   */
  private playResolution(outcome: MoveOutcome, gained: number): void {
    const st = outcome.stages;
    if (!st) {
      this.afterResolve();
      return;
    }

    const g = new Grid(this.cfg.rows, this.cfg.cols, st.afterMove);
    this.view.setCells(st.afterMove);
    this.view.applyMerge(computeMergeDisplay(g));

    this.scheduleOnce(() => {
      this.view.setMergePhase(st.eliminatedCells, 'recognize');
      this.scheduleOnce(() => {
        this.view.setMergePhase(st.eliminatedCells, 'fit');
        this.scheduleOnce(() => {
          this.view.setMergePhase(st.eliminatedCells, 'confirm');
          this.scheduleOnce(() => {
            this.view.setMergePhase(st.eliminatedCells, 'off');
            this.audio.play('eliminate');
            this.view.playVanish(st.eliminatedCells);
            if (gained > 0) {
              this.view.floatScore(st.eliminatedCells[0] ?? 0, `+${gained}`);
              this.bumpScore();   // web showScoreFloat：飘字的同时 #hud-score.bump（0.26s）
              // Web `main.ts:974`：序章里每拼成 1 组，进度点亮一颗（score 就是拼成的组数）
              if (this.tut) this.tutHud.setProgress(Math.min(3, this.engine.score));
            }
            this.eliminatedOnce = true;
            this.runGuide(4);
            this.scheduleOnce(() => this.playCollapse(st), ANIM.vanish);
          }, ANIM.confirm);
        }, ANIM.fit);
      }, ANIM.recognize);
    }, ANIM.swap);
  }

  /** 下压 + 补位：由「碎片ID 从哪格到哪格」反推位移 */
  private playCollapse(st: ResolveStages): void {
    const before = st.afterEliminate;
    const final = this.engine.board.toArray();
    const cols = this.cfg.cols;
    const oldIndex = new Map<number, number>();
    before.forEach((p, i) => { if (p !== null) oldIndex.set(p, i); });
    const drops = new Map<number, number>();
    const spawns = new Map<number, number>();
    final.forEach((p, i) => {
      if (p === null) return;
      const oi = oldIndex.get(p);
      if (oi === undefined) { spawns.set(i, Math.floor(i / cols)); return; }
      const d = Math.floor(i / cols) - Math.floor(oi / cols);
      if (d > 0) drops.set(i, d);
    });
    this.audio.play('drop');
    this.view.setCells(final);
    this.view.applyMerge(computeMergeDisplay(this.engine.board));
    this.view.playFall(drops, spawns);
    this.scheduleOnce(() => this.afterResolve(), ANIM.fall + cols * ANIM.stagger + RESOLVE_TAIL);
  }

  private afterResolve(): void {
    this.tutorialAfterResolve(); // 消除一组后推进教学（step 1 → 2 / 拼满 3 组 → 完成）
    this.busy = false;
    if (!this.finished) this.setPaused(false);
    this.paintAll();
    this.updateHud();
    this.syncSession();
    if (this.eliminatedOnce) this.runGuide(5);
  }

  /* ================================================================ 倒计时 */

  private onTick(): void {
    if (!this.started || this.paused || this.finished) return;
    this.timeLeft -= 1;
    if (this.timeLeft <= 10) this.audio.play('rush');
    else if (this.timeLeft <= 30) this.audio.play('tick');
    if (this.timeLeft <= 0) {
      this.timeLeft = 0;
      this.updateHud();
      this.onLevelEnd();
      return;
    }
    this.updateHud();
  }

  private setPaused(v: boolean): void {
    this.paused = v;
    this.audio.setRunning(this.started && !this.paused && !this.finished);
  }

  /** 把存档里的音效/音乐开关应用到播放器（设置页改完、进关、启动都要走一次） */
  private applyAudioSettings(): void {
    const s = GS.meta.settings;
    this.audio.setSound(s.sound);
    this.audio.setBgm(s.bgm);
  }

  /**
   * 切后台：记下离开时刻、停表、落盘。
   *
   * ⚠️ `busy` 时**不写** —— 此刻引擎里已是「交换后」状态，落盘等于承认这次交换；
   * 盘上留着的上一份存档才是交换前状态（§16 要求回滚到这儿）。
   */
  private handleHidden(): void {
    if (this.tut) return; // 序章不写档：教学盘面绝不能落成正式断点（§16 之外的例外）
    if (this.busy || this.finished || !this.engine) return;
    this.setPaused(true);
    this.syncSession();
    GS.flush();
    flushTracking();   // 切后台：把攒下的埋点尽力交出去（没有端点时只是整理本地缓冲）
  }

  /**
   * 回前台：按时间戳一次性补扣离开期间的时间。
   *
   * 后台的 `schedule` 会被节流，逐秒扣不准，所以只能按 `savedAt` 算总账。
   */
  private handleVisible(): void {
    if (this.tut) return; // 教学不计时：runTimeDemo 自己管演示窗口的表状态，这里别抢
    if (this.finished || !this.engine || !this.started) {
      if (!this.finished) this.setPaused(false);
      return;
    }
    const s = GS.session;
    if (!s) { this.setPaused(false); return; }
    const next = resumeTimeLeft(s, Date.now());
    const lost = this.timeLeft - next;
    this.timeLeft = next;
    this.updateHud();

    if (this.timeLeft <= 0) {
      this.toast.show(SAVE.offlineTimeout, 4200);
      this.offlineSettle = true;
      this.onLevelEnd();
      return;
    }
    if (lost > 0) this.toast.show(`离开 ${lost} 秒已照扣`, 2600);
    this.setPaused(false);
  }

  /* ================================================================ 结算 */

  /** 倒计时归零 —— 唯一的关卡结束入口 */
  private onLevelEnd(): void {
    if (this.finished || !this.engine) return;
    this.finished = true;
    this.setPaused(true);
    this.unschedule(this.onTick);
    this.updateHud();
    // 结算后断点立即作废：否则玩家下次进关会「恢复」到一个已经结束的局
    GS.setSession(null);
    GS.flush();

    const outcome: LevelOutcome = {
      level: this.levelIndex,
      score: this.engine.score,
      star1: this.cfg.star1,
      star2: this.cfg.star2,
      star3: this.cfg.star3,
      revived: this.revived,
    };
    const before = recordOf(GS.progress, this.levelIndex);
    const settlement = settleLevel(outcome, before);

    if (!settlement && !this.revivedUsed && !this.offlineSettle) {
      this.pendingOutcome = outcome;
      this.showReviveDialog();
      return;
    }
    if (settlement) {
      const next = commitSettlement(GS.progress, outcome, settlement, TOTAL_LEVELS);
      const after = recordOf(next, this.levelIndex);
      GS.setProgress(next);
      GS.flush();
      // 埋点：通关（分数 / 星级 / 是否续命 / 耗时）；这一关打过了，尝试次数归零
      reportLevelEnd({
        level: this.levelIndex,
        mode: GS.mode,
        score: outcome.score,
        stars: settlement.stars,
        revived: outcome.revived,
        durationSec: Math.max(0, Math.round((Date.now() - this.levelStartedAt) / 1000)),
      });
      this.attempts.delete(this.levelIndex);
      this.audio.play('win');
      this.announceUnlocks(next);
      this.showHonorDialog(outcome, settlement, after.boardBest);
    } else {
      this.audio.play('fail');
      this.showFailDialog(outcome);
    }
  }

  /** 图鉴解锁播报（§10.3：首次通关即解锁） */
  private announceUnlocks(next: ProgressData): void {
    const ids = unlockedImageIds(next);
    if (ids.length > this.lastUnlocked) {
      const gained = ids.length - this.lastUnlocked;
      this.lastUnlocked = ids.length;
      this.toast.show(`图鉴 +${gained}（${COLLECTION_PROGRESS(ids.length)}）`, 2600);
    }
  }

  /** 荣誉弹窗三档（超神 / 王者 / 优秀） */
  private showHonorDialog(outcome: LevelOutcome, settlement: LevelSettlement, boardBest: number): void {
    const honor = honorForLevel({
      level: this.levelIndex,
      line: { star1: this.cfg.star1, star2: this.cfg.star2, star3: this.cfg.star3 },
      score: outcome.score,
      stars: settlement.stars,
      revived: outcome.revived,
      boardBest,
    });

    const hero = honor.tier === 'god' ? '🏆' : honor.tier === 'king' ? '👑' : '🎉';
    const title = honor.tier === 'god' ? HONOR.godTitle : honor.tier === 'king' ? HONOR.kingTitle : HONOR.passTitle;
    const tierLine = honor.tier === 'god'
      ? HONOR.godLine(honor.stats.rank)
      : honor.tier === 'king'
        ? HONOR.kingLine(honor.percentText)
        : HONOR.starLine(settlement.stars);
    this.audio.play(honor.tier === 'god' ? 'honorGod' : honor.tier === 'king' ? 'honorKing' : 'honorPass');

    // 结算吊牌（对齐 web/ui/result.ts）：星级英雄区 + 滚动分数 + 按钮两行，✕ = 回主界面
    const row1: ResultButton[] = [];
    if (this.levelIndex < TOTAL_LEVELS) row1.push({ text: HONOR.next, onClick: () => this.nextLevel(), primary: true });
    row1.push({ text: HONOR.retry, onClick: () => this.restart(), primary: row1.length === 0 });
    const row2: ResultButton[] = [];
    if (boardBest > 0) row2.push({ text: HONOR.rank, onClick: () => this.showBoardDialog(boardBest) });
    // 分享入口：宿主没有分享能力时**连按钮都不摆**（摆了点不动比没有更糟）
    if (sharer().available()) row2.push({ text: SHARE.btn, onClick: () => this.shareResult(outcome, settlement) });
    row2.push({ text: HONOR.backHome, onClick: () => this.exitToHome() });

    this.result.show({
      mode: 'win',
      stars: settlement.stars,
      icon: hero,              // 星级优先（stars 传了就用星级，icon 只作兜底）
      title,
      sub: tierLine,
      score: outcome.score,
      scoreLabel: HONOR.scoreLabel,
      hint: boardBest > 0 ? HONOR.bestLine(boardBest) : '',
      rows: [row1, row2],
      onHome: () => this.exitToHome(),
    });
  }

  /** 排行榜（灰盒 100 人 + 本机） */
  private showBoardDialog(boardBest: number): void {
    const snap = boardSnapshot(this.levelIndex, { star1: this.cfg.star1, star2: this.cfg.star2, star3: this.cfg.star3 }, boardBest);
    const lines = [`第 ${this.levelIndex} 关 · ${BOARD.total(snap.totalPlayers)}`];
    for (const r of snap.rows.slice(0, 6)) {
      lines.push(`${r.rank}. ${r.name}　${r.score} 分`);
    }
    if (snap.myRank) lines.push(`我的名次 第 ${snap.myRank} 名`);
    else lines.push('达到 3★ 才能上榜哦');
    this.dialog.show('排行榜', lines, [{ text: '关闭', onClick: () => {}, primary: true }]);
  }

  /** 失败结算也走吊牌（同一骨架，没到星线就不画星级） */
  private showFailDialog(outcome: LevelOutcome): void {
    // 埋点：走到这里才是「确认失败」（弹续命窗那一档不算，见 `平台/track.ts`）
    reportLevelFail({ level: outcome.level, mode: GS.mode, score: outcome.score });
    this.result.show({
      mode: 'lose',
      title: FAIL.title,
      sub: FAIL.line1(outcome.score),
      score: outcome.score,
      scoreLabel: HONOR.scoreLabel,
      note: `${FAIL.line2(this.cfg.star1, this.cfg.star2, this.cfg.star3)}　${FAIL.line3}`,
      rows: [[
        { text: FAIL.backHome, onClick: () => this.exitToHome() },
        { text: FAIL.retry, onClick: () => this.restart(), primary: true },
      ]],
      onHome: () => this.exitToHome(),
    });
  }

  private showReviveDialog(): void {
    const left = GS.adStaminaLeft;
    this.dialog.show(REVIVE.title, [
      REVIVE.line1(reviveSecondsFor(this.levelIndex)),
      REVIVE.line2,
    ], [
      { text: REVIVE.giveUp, onClick: () => this.giveUp() },
      { text: REVIVE.watch, onClick: () => this.watchRevive(), primary: true, disabled: left <= 0 },
    ]);
  }

  /**
   * 广告续命 —— 走 `平台/ads.ts` 的激励视频（批次⑧ 接线）。
   *
   * 三分支怎么落地：
   *   - `watched`（看完）→ 发奖励，加时继续；
   *   - `skipped`（没看完）→ 不给奖励，**回到续命弹窗**让玩家再选一次（放弃 / 再看）；
   *   - `failed`（加载失败 / 被拦）→ 提示原因，同样回到续命弹窗。
   *
   * ⚠️ 额度仍由 `GS.adStaminaLeft` 把关（与改动前一致）：它是唯一落盘的口径。
   *    `平台/ads.ts` 里 `revive` 的每日上限是「不限」（§13.4），两者不一致的那一处
   *   属于既有规则，未在本批次改动 —— 见 README「待用户决策」。
   */
  private watchRevive(): void {
    if (GS.adStaminaLeft <= 0) {
      this.toast.show(ADS.dailyLimit, 2600);
      return;
    }
    setPlatformToast((m) => this.toast.show(m, 2200));
    this.toast.show('广告播放中…', 1200);
    this.busy = true;
    void playAd('revive')
      .then((out) => {
        this.busy = false;
        if (out.result === 'watched') {
          GS.recordAd();
          this.revive();
          return;
        }
        this.toast.show(
          out.result === 'skipped' ? '没看完广告，续命没生效' : adDenyText(out.reason),
          2600,
        );
        this.showReviveDialog();
      })
      .catch(() => {
        this.busy = false;
        this.toast.show(ADS.notReady, 2600);
      });
  }

  /**
   * 分享本关成绩（结算吊牌上的「分享成绩」）。
   *
   * ⚠️ `imageUrl` 现在**不传**：小游戏会退回首屏截图，成绩卡那张图要等美术给；
   *    真要固定卡片图，把地址填在这里即可（`平台/share.ts` 建议 500×400 横图）。
   */
  private shareResult(outcome: LevelOutcome, settlement: LevelSettlement): void {
    setPlatformToast((m) => this.toast.show(m, 2200));
    const title = SHARE.resultTitle(outcome.level, outcome.score, settlement.stars);
    void shareCard({ title, query: `level=${outcome.level}&score=${outcome.score}` })
      .then((out) => {
        if (out.ok) { this.toast.show(SHARE.done, 2000); return; }
        this.toast.show(out.reason === 'cancel' ? SHARE.cancel : SHARE.fail, 2200);
      })
      .catch(() => this.toast.show(SHARE.fail, 2200));
  }

  private revive(): void {
    this.revived = true;
    this.revivedUsed = true;
    this.finished = false;
    this.pendingOutcome = null;
    this.timeLeft += reviveSecondsFor(this.levelIndex);
    this.setPaused(false);
    this.syncSession();
    GS.flush();
    this.schedule(this.onTick, 1);
    this.toast.show(REVIVE.gained(reviveSecondsFor(this.levelIndex)), 1800);
  }

  private giveUp(): void {
    const o = this.pendingOutcome;
    this.pendingOutcome = null;
    if (o) this.showFailDialog(o);
    else this.exitToHome();
  }

  /* ================================================================ 关卡流转 */

  private restart(): void {
    const lv = this.levelIndex;
    GS.setSession(null);
    this.beginLevel(lv, null);
  }

  private nextLevel(): void {
    GS.setSession(null);
    this.beginLevel(Math.min(TOTAL_LEVELS, this.levelIndex + 1), null);
  }

  /**
   * 主动返回主页 = 中途退出（§12.4）：退还预扣体力 + 清断点。
   * 与「切后台」不同 —— 后者是被动退出，断点要留着。
   */
  private exitToHome(): void {
    this.unschedule(this.onTick);
    this.clearHint();
    if (!this.finished) GS.refundStamina();
    GS.setSession(null);
    GS.flush();
    this.finished = true;
    const map = this.findMapNode();
    if (map) {
      map.active = true;
      this.node.active = false;
      return;
    }
    // 找不到主页时不能「静默什么都不做」——玩家点完没反应会以为按钮坏了。
    // 本局已经停掉（计时停、体力已退），这里如实说明跳转没发生。
    this.toast.show('已退出本局（当前场景没有主页节点，无法跳转）', 2000);
  }

  /**
   * 找主页节点。只在亲兄弟里找是不够的：对局节点可能被包在容器里，
   * 那样 `parent.getChildByName('Map')` 恒为 null，表现就是「点了返回没反应」。
   * 往上多找几层，找到就停。
   */
  private findMapNode(): Node | null {
    let p = this.node.parent;
    for (let i = 0; i < 4 && p; i++) {
      const m = p.getChildByName('Map');
      if (m) return m;
      p = p.parent;
    }
    return null;
  }

  /* ================================================================ HUD */

  /**
   * HUD 数值 —— 与 web/main.ts `updateHud()` 同口径：
   * - 倒计时 mm:ss；≤60s 转 #ffcc66（warn）、≤10s 转 #ff8080 且整块 0.8s 脉冲（danger）。
   * - 计分翻牌显示 `score % 100`（机械计数器式回滚，永远两位）。
   * - 目标旗数字 = 本关 1 星线（`star1`，固定目标值，不是剩余量）。
   */
  private updateHud(): void {
    if (!this.hudTime) return;
    const mm = String(Math.floor(this.timeLeft / 60)).padStart(2, '0');
    const ss = String(this.timeLeft % 60).padStart(2, '0');
    this.hudTime.string = `${mm}:${ss}`;
    const warn = this.timeLeft <= 60 && this.timeLeft > 10;
    const danger = this.timeLeft <= 10;
    this.hudTime.color = danger
      ? new Color(255, 128, 128, 255)   // #ff8080
      : warn
        ? new Color(255, 204, 102, 255) // #ffcc66
        : new Color(255, 233, 176, 255); // #FFE9B0
    this.setTimerDanger(danger);
    const score = this.engine ? this.engine.score : 0;
    const disp = ((score % 100) + 100) % 100;
    this.setDigit(this.flapTens, Math.floor(disp / 10) % 10, 'tens');
    this.setDigit(this.flapUnits, disp % 10, 'units');
    this.hudGoalNum.string = String(this.cfg ? this.cfg.star1 : 0);
  }

  /** #hud-timer.danger：整个计时块 0.8s 无限脉冲（50% 时透明度 .45） */
  private setTimerDanger(danger: boolean): void {
    if (danger === this.timerPulsing) return;
    this.timerPulsing = danger;
    const op = this.timerNode?.getComponent(UIOpacity);
    if (!op) return;
    if (this.timerPulseTween) { this.timerPulseTween.stop(); this.timerPulseTween = null; }
    op.opacity = 255;
    if (danger) {
      this.timerPulseTween = tween(op).repeatForever(
        tween<UIOpacity>().to(0.4, { opacity: 115 }).to(0.4, { opacity: 255 }),
      ).start();
    }
  }

  /**
   * 翻牌式两位数计分（web `setDigit()`）：每位独立判断是否变化；
   * 只给真正变化的位翻（个位每次加分都翻、十位只在进位时翻）。
   * 动画中不重入 —— 翻完的回调直接套用最新值（与 Web 的 timeout 收尾一致）。
   * Web 用 rotateX 翻牌；Cocos 2D 用 scaleY 1→0→1 复刻同一节奏（0.26s × 2）。
   */
  private setDigit(label: Label, val: number, which: 'tens' | 'units'): void {
    const v = String(val);
    const cur = which === 'tens' ? this.flapTensVal : this.flapUnitsVal;
    if (which === 'tens') { if (this.flapTensVal === v) return; this.flapTensVal = v; }
    else { if (this.flapUnitsVal === v) return; this.flapUnitsVal = v; }
    label.string = v;
    if (cur === '') return;   // 首帧直接落数，不翻（web setDigit 的 dataset 初始化分支）
    const busyKey = which === 'tens' ? 'flapTensBusy' : 'flapUnitsBusy';
    if (this[busyKey]) return;
    this[busyKey] = true;
    const node = label.node;
    tween(node)
      .to(0.26, { scale: new Vec3(1, 0, 1) })
      .call(() => { label.string = which === 'tens' ? this.flapTensVal : this.flapUnitsVal; })
      .to(0.26, { scale: new Vec3(1, 1, 1) })
      .call(() => { this[busyKey] = false; })
      .start();
  }

  /** #hud-score.bump：加分时面板 1 → 1.14 → 1（0.26s，与得分飘字并行） */
  private bumpScore(): void {
    if (!this.scorePanel) return;
    tween(this.scorePanel)
      .to(0.13, { scale: new Vec3(1.14, 1.14, 1) })
      .to(0.13, { scale: new Vec3(1, 1, 1) })
      .start();
  }

  /** 提示：高亮当前最优可拼组（原版 2.6s 后自动撤销） */
  showHint(): void {
    if (!this.engine || this.busy || this.finished) return;
    const cells = findHintCells(this.engine.board);
    if (cells.length < 2) return;
    this.view.setHint(cells);
    if (this.hintTimer !== null) clearTimeout(this.hintTimer);
    this.hintTimer = setTimeout(() => this.clearHint(), 2600);
  }

  private clearHint(): void {
    if (this.hintTimer !== null) { clearTimeout(this.hintTimer); this.hintTimer = null; }
    this.view?.setHint([]);
  }

  /* ---------------------------------------------------------------- HUD 构建
   * 逐元素对照 web/index.html:451-472 的 DOM 结构与 :68-177 的样式重建。
   * 坐标是 1080×1920 逻辑值（已按 Web 实测几何校准，见 docs/dump/web-game.json），
   * CSS y 向下 → 这里统一换算成 Cocos y 向上（相对画面中心）。
   *
   * 与 Web 的已知实现手段差异（视觉尽量对齐，手段不同，均记录在 docs/核对-界面.md）：
   * - 渐变用「逐条带填色」近似（真引擎 Graphics 无渐变/无模糊）；
   * - box-shadow 用「扩散 + 低透明圆角矩形」近似；
   * - 文字 text-shadow 用 LabelShadow 组件复刻；
   * - 翻牌 rotateX 用 scaleY 1→0→1 复刻同一节奏。
   */
  private buildHud(): void {
    this.buildScreenBg();
    this.buildCard();
    // 层级（web z-index 表）：页面底色 < 顶栏卡片 < 棋盘 < 弹窗/吊牌/Toast
    this.view.node.setSiblingIndex(2);
  }

  /** 页面底色：`#stage` 的 radial-gradient(120% 80% at 50% 0%, #fffdf6 → #fff7ec 45% → #fdeed8) */
  private buildScreenBg(): void {
    const n = new Node('ScreenBg');
    n.parent = this.node;
    n.layer = Layers.Enum.UI_2D;
    n.addComponent(UITransform).setContentSize(DESIGN_W, DESIGN_H);
    const g = n.addComponent(Graphics);
    const c0 = new Color(255, 253, 246, 255);
    const c1 = new Color(255, 247, 236, 255);
    const c2 = new Color(253, 238, 216, 255);
    const ry = DESIGN_H * 0.8;
    const steps = 48;
    const sh = DESIGN_H / steps;
    for (let i = 0; i < steps; i++) {
      const cssY = (i + 0.5) * sh;   // 条带中心的 CSS y（向下），径向渐变取中心列颜色
      const t = cssY / ry;
      g.fillColor = t <= 0.45
        ? this.lerpColor(c0, c1, t / 0.45)
        : this.lerpColor(c1, c2, Math.min(1, (t - 0.45) / 0.55));
      g.rect(-DESIGN_W / 2, DESIGN_H / 2 - (i + 1) * sh, DESIGN_W, sh + 0.5);
      g.fill();
    }
    n.setSiblingIndex(0);
  }

  /** `.game-card`：金边 10px #D9A227 + 蓝底 #0058B0 + 圆角 52（margin 8 / border 10） */
  private buildCard(): void {
    const card = new Node('GameCard');
    card.parent = this.node;
    card.layer = Layers.Enum.UI_2D;
    const w = DESIGN_W - CARD_MARGIN * 2;    // 1064
    const h = DESIGN_H - CARD_MARGIN * 2;    // 1904
    card.addComponent(UITransform).setContentSize(w, h);
    const g = card.addComponent(Graphics);
    const iw = w - CARD_BORDER * 2;
    const ih = h - CARD_BORDER * 2;
    // 蓝底：铺满 border 以内的内容盒
    g.fillColor = new Color(0, 88, 176, 255);            // #0058B0
    this.roundRectPath(g, -iw / 2, -ih / 2, iw, ih, CARD_RADIUS - CARD_BORDER);
    g.fill();
    // 内侧 2px 高光：inset 0 0 0 2px rgba(255,255,255,.08)
    g.lineWidth = 2;
    g.strokeColor = new Color(255, 255, 255, 20);
    this.roundRectPath(g, -iw / 2 + 1, -ih / 2 + 1, iw - 2, ih - 2, CARD_RADIUS - CARD_BORDER - 1);
    g.stroke();
    // 金边：CSS border 画在盒内 → 描边路径整体内缩半条边
    g.lineWidth = CARD_BORDER;
    g.strokeColor = new Color(217, 162, 39, 255);        // #D9A227
    this.roundRectPath(g, -w / 2 + CARD_BORDER / 2, -h / 2 + CARD_BORDER / 2, w - CARD_BORDER, h - CARD_BORDER, CARD_RADIUS - CARD_BORDER / 2);
    g.stroke();
    // 外投影 0 18px 50px rgba(0,0,0,.35)：真引擎无模糊，省略（已记录）
    this.buildTopbar(card);
    card.setSiblingIndex(1);
  }

  /** `.game-topbar`：1044×240 天空蓝渐变 + 金边 + 圆角 26，四栏内容 */
  private buildTopbar(card: Node): void {
    const bar = new Node('Topbar');
    bar.parent = card;
    bar.layer = Layers.Enum.UI_2D;
    bar.addComponent(UITransform).setContentSize(CARD_INNER_W, TOPBAR_H);
    bar.setPosition(0, DESIGN_H / 2 - CARD_INNER_TOP - TOPBAR_H / 2);   // y=822（CSS 盒 18..258）
    const g = bar.addComponent(Graphics);
    const r = 26;
    // 天空蓝：linear-gradient(180deg, #5cb0ef, #3d8fd8)
    this.fillVGradientRounded(g, -CARD_INNER_W / 2, -TOPBAR_H / 2, CARD_INNER_W, TOPBAR_H, r,
      new Color(92, 176, 239, 255), new Color(61, 143, 216, 255), 24);
    // 金边 2px rgba(255,210,74,.7)
    g.lineWidth = 2;
    g.strokeColor = new Color(255, 210, 74, 179);
    this.roundRectPath(g, -CARD_INNER_W / 2 + 1, -TOPBAR_H / 2 + 1, CARD_INNER_W - 2, TOPBAR_H - 2, r - 1);
    g.stroke();
    // 顶部内高光 inset 0 2px 10px rgba(255,255,255,.4)：顶端 10px 白光渐隐
    for (let i = 0; i < 8; i++) {
      const dTop = 1 + (i + 0.5) * (10 / 8);
      const inset = dTop < r ? r - Math.sqrt(r * r - (r - dTop) ** 2) : 0;
      g.fillColor = new Color(255, 255, 255, Math.round(102 * (1 - (i + 0.5) / 8)));
      g.rect(-CARD_INNER_W / 2 + 1 + inset, TOPBAR_H / 2 - 1 - (i + 1) * (10 / 8), CARD_INNER_W - 2 - inset * 2, 10 / 8 + 0.5);
      g.fill();
    }
    this.buildExit(bar);
    this.buildGoal(bar);
    this.buildScore(bar);
    this.buildTimer(bar);
  }

  /** `#hud-exit`：84×84 棕底 #6B4A2F + 奶黄 ←（44px/800 #FFE9B0），底影 0 4px 0 #4A3321 */
  private buildExit(bar: Node): void {
    const n = new Node('HudExit');
    n.parent = bar;
    n.layer = Layers.Enum.UI_2D;
    n.addComponent(UITransform).setContentSize(84, 84);
    n.setPosition(-462, 0);
    const g = n.addComponent(Graphics);
    g.fillColor = new Color(74, 51, 33, 255);            // #4A3321 底影
    this.roundRectPath(g, -42, -46, 84, 84, 18);
    g.fill();
    g.fillColor = new Color(107, 74, 47, 255);           // #6B4A2F
    this.roundRectPath(g, -42, -42, 84, 84, 18);
    g.fill();
    g.lineWidth = 2;
    g.strokeColor = new Color(255, 255, 255, 20);
    this.roundRectPath(g, -40, -40, 80, 80, 16);
    g.stroke();
    this.hudLabel(n, '←', 44, new Color(255, 233, 176, 255), 84, 84, true);
    // :active translateY(2px)
    n.on(Node.EventType.TOUCH_START, () => n.setPosition(-462, -2), this);
    n.on(Node.EventType.TOUCH_END, () => { n.setPosition(-462, 0); this.exitToHome(); }, this);
    n.on(Node.EventType.TOUCH_CANCEL, () => n.setPosition(-462, 0), this);
  }

  /** `#hud-goal`：旗帜 SVG（60×72）+ 1 星线数字（66px/800 #FFD24A） */
  private buildGoal(bar: Node): void {
    const flag = new Node('HudGoalFlag');
    flag.parent = bar;
    flag.layer = Layers.Enum.UI_2D;
    flag.addComponent(UITransform).setContentSize(60, 72);
    flag.setPosition(-269.6, 0);
    const g = flag.addComponent(Graphics);
    // SVG viewBox 0 0 60 72（y 向下）→ 本地中心原点（y 向上）：x-30, 36-y
    g.fillColor = new Color(241, 244, 249, 255);         // 旗杆 rect(10,8,6,58,r3) #f1f4f9
    this.roundRectPath(g, -20, -30, 6, 58, 3);
    g.fill();
    g.fillColor = new Color(255, 210, 74, 255);          // 顶球 circle(13,8,r7) #FFD24A
    g.strokeColor = new Color(202, 161, 47, 255);        // stroke #caa12f
    g.lineWidth = 1.5;
    g.circle(-17, 28, 7);
    g.fill();
    g.stroke();
    g.fillColor = new Color(255, 91, 74, 255);           // 三角旗 #ff5b4a
    g.strokeColor = new Color(216, 59, 44, 255);         // stroke #d83b2c
    g.lineWidth = 2;
    g.moveTo(-14, 22); g.lineTo(20, 6); g.lineTo(-14, -10); g.close();
    g.fill();
    g.stroke();
    g.fillColor = new Color(255, 255, 255, 71);          // 高光 rgba(255,255,255,.28)
    g.moveTo(-14, 22); g.lineTo(4, 13); g.lineTo(-14, 4); g.close();
    g.fill();
    // text-shadow 0 2px 0 #000
    this.hudGoalNum = this.hudLabel(bar, '0', 66, new Color(255, 210, 74, 255), 72, 72, true,
      { color: new Color(0, 0, 0, 255), dx: 0, dy: -2 }, 'HudGoalNum');
    this.hudGoalNum.node.setPosition(-210, 0);
  }

  /** `#hud-score`：深蓝凹陷面板（246×162）+ 两枚 92×128 翻牌（数字 90px/800 #FFD24A） */
  private buildScore(bar: Node): void {
    const panel = new Node('HudScore');
    panel.parent = bar;
    panel.layer = Layers.Enum.UI_2D;
    panel.addComponent(UITransform).setContentSize(246, 162);
    panel.setPosition(51, 0);
    this.scorePanel = panel;
    const g = panel.addComponent(Graphics);
    // 外圈金晕 0 0 0 2px rgba(255,210,74,.18)
    g.lineWidth = 2;
    g.strokeColor = new Color(255, 210, 74, 46);
    this.roundRectPath(g, -123, -81, 246, 162, 17);
    g.stroke();
    // 面板渐变 linear-gradient(180deg, #0c2e57, #07203f)
    this.fillVGradientRounded(g, -123, -81, 246, 162, 16,
      new Color(12, 46, 87, 255), new Color(7, 32, 63, 255), 16);
    // 内阴影 inset 0 4px 14px rgba(0,0,0,.45)：顶端 14px 暗带渐隐
    for (let i = 0; i < 8; i++) {
      g.fillColor = new Color(0, 0, 0, Math.round(115 * (1 - (i + 0.5) / 8)));
      g.rect(-120, 81 - 3 - (i + 1) * (14 / 8), 240, 14 / 8 + 0.5);
      g.fill();
    }
    // 边框 3px rgba(255,255,255,.25)
    g.lineWidth = 3;
    g.strokeColor = new Color(255, 255, 255, 64);
    this.roundRectPath(g, -121.5, -79.5, 243, 159, 14.5);
    g.stroke();
    this.flapTens = this.buildFlap(panel, -52, 'FlapTens');
    this.flapUnits = this.buildFlap(panel, 52, 'FlapUnits');
  }

  /** `.flap`：92×128 翻牌（上 49% #163a64 / 下 51% #0a2444 + 中缝 + 内描边 + 底影） */
  private buildFlap(panel: Node, x: number, name: string): Label {
    const n = new Node(name);
    n.parent = panel;
    n.layer = Layers.Enum.UI_2D;
    n.addComponent(UITransform).setContentSize(92, 128);
    n.setPosition(x, 0);
    const g = n.addComponent(Graphics);
    const r = 12;
    g.fillColor = new Color(0, 0, 0, 102);               // 底影 0 3px 0 rgba(0,0,0,.4)
    this.roundRectPath(g, -46, -67, 92, 128, r);
    g.fill();
    g.fillColor = new Color(10, 36, 68, 255);            // 下段 #0a2444
    this.roundRectPath(g, -46, -64, 92, 128, r);
    g.fill();
    g.fillColor = new Color(22, 58, 100, 255);           // 上段 49% #163a64
    this.roundRectPath(g, -46, 64 - 128 * 0.49, 92, 128 * 0.49, r, r, 0, 0);
    g.fill();
    g.lineWidth = 2;
    g.strokeColor = new Color(0, 0, 0, 102);             // inset 0 0 0 2px rgba(0,0,0,.4)
    this.roundRectPath(g, -45, -63, 90, 126, r - 1);
    g.stroke();
    g.fillColor = new Color(0, 0, 0, 140);               // 中缝 ::after 3px rgba(0,0,0,.55)
    g.rect(-46, -1.5, 92, 3);
    g.fill();
    // text-shadow 0 0 12px rgba(255,210,74,.45) → 零偏移金色影近似辉光
    return this.hudLabel(n, '0', 90, new Color(255, 210, 74, 255), 92, 128, true,
      { color: new Color(255, 210, 74, 115), dx: 0, dy: 0 }, 'Face');
  }

  /** `#hud-timer`：🕒（54px #FFF8E7）+ mm:ss（60px/800 #FFE9B0），右对齐 */
  private buildTimer(bar: Node): void {
    const t = new Node('HudTimer');
    t.parent = bar;
    t.layer = Layers.Enum.UI_2D;
    t.addComponent(UITransform).setContentSize(228, 60);
    t.setPosition(390, 0);
    this.timerNode = t;
    const clock = this.hudLabel(t, '🕒', 54, new Color(255, 248, 231, 255), 74, 54, false, undefined, 'TimerClock');
    clock.node.setPosition(-76.6, 0);
    this.hudTime = this.hudLabel(t, '03:00', 60, new Color(255, 233, 176, 255), 142, 60, true,
      { color: new Color(0, 0, 0, 255), dx: 0, dy: -2 }, 'TimerNum');
    this.hudTime.node.setPosition(43, 0);
    t.addComponent(UIOpacity);
  }

  /* ---------------------------------------------------------------- HUD 绘制辅助 */

  /** 文本（居中、行高=字号、可加粗、可带 text-shadow 等效物 LabelShadow）。
   *  name 会进入节点名 —— ui-dump 的几何比对按「节点名路径」与 Web 的选择器对齐。 */
  private hudLabel(
    parent: Node, text: string, size: number, color: Color, w: number, h: number,
    bold = false, shadow?: { color: Color; dx: number; dy: number }, name = 'Txt',
  ): Label {
    const n = new Node(name);
    n.parent = parent;
    n.layer = Layers.Enum.UI_2D;
    n.addComponent(UITransform).setContentSize(w, h);
    const l = n.addComponent(Label);
    l.string = text;
    l.fontSize = size;
    l.lineHeight = size;   // web 数字全部 line-height:1
    l.color = color;
    if (bold) {
      const b = l as unknown as { isBold?: boolean; enableBold?: boolean };
      if (b.isBold === false || b.isBold === undefined) b.isBold = true;
      if (b.enableBold === false) b.enableBold = true;
    }
    if (shadow) {
      // ⚠️ 3.8.2 起阴影属性搬到了 Label 上（`LabelShadow.color/offset` 已废弃，且 3.8 的
      //    LabelShadow 上写这两个属性在 TS 里直接报错、运行时也不生效）
      l.enableShadow = true;
      l.shadowColor = shadow.color;
      l.shadowOffset = new Vec2(shadow.dx, shadow.dy);
    }
    return l;
  }

  /** 圆角矩形路径（四角半径可不同）—— CSS `border-radius: tl tr br bl` 的等效物 */
  private roundRectPath(g: Graphics, x: number, y: number, w: number, h: number, rtl: number, rtr = rtl, rbr = rtl, rbl = rtl): void {
    const cap = (v: number) => Math.max(0, Math.min(v, Math.min(w, h) / 2));
    const a = cap(rtl);
    const b = cap(rtr);
    const c = cap(rbr);
    const d = cap(rbl);
    g.moveTo(x + a, y);
    g.lineTo(x + w - b, y);
    if (b) g.quadraticCurveTo(x + w, y, x + w, y + b);
    g.lineTo(x + w, y + h - c);
    if (c) g.quadraticCurveTo(x + w, y + h, x + w - c, y + h);
    g.lineTo(x + d, y + h);
    if (d) g.quadraticCurveTo(x, y + h, x, y + h - d);
    g.lineTo(x, y + a);
    if (a) g.quadraticCurveTo(x, y, x + a, y);
  }

  /** 圆角矩形内的竖向渐变：先铺顶色盖住四角，再逐条带填色（条带按圆角轮廓内缩） */
  private fillVGradientRounded(g: Graphics, x: number, y: number, w: number, h: number, r: number, top: Color, bottom: Color, steps = 24): void {
    g.fillColor = top;
    this.roundRectPath(g, x, y, w, h, r);
    g.fill();
    const sh = h / steps;
    for (let i = 0; i < steps; i++) {
      const t = (i + 0.5) / steps;                 // 0 = 顶
      const cy = y + h - (i + 0.5) * sh;           // 条带中心（y 向上）
      const dTop = y + h - cy;
      const dBottom = cy - y;
      const inset = Math.max(
        dTop < r ? r - Math.sqrt(r * r - (r - dTop) ** 2) : 0,
        dBottom < r ? r - Math.sqrt(r * r - (r - dBottom) ** 2) : 0,
      );
      g.fillColor = this.lerpColor(top, bottom, t);
      g.rect(x + inset, cy - sh / 2, w - inset * 2, sh + 0.5);
      g.fill();
    }
  }

  private lerpColor(a: Color, b: Color, t: number): Color {
    return new Color(
      Math.round(a.r + (b.r - a.r) * t),
      Math.round(a.g + (b.g - a.g) * t),
      Math.round(a.b + (b.b - a.b) * t),
      255,
    );
  }

  /* ================================================================ 引导（§14 五步） */

  /* ================================================================ 新手教学（序章） */

  /**
   * 进序章：**不走** startLevel/beginLevel —— 那里会扣体力、建断点、写进度，序章一样都不要。
   * 序章不进排行榜 / 图鉴 / 星数（结算不走 settleLevel）。
   */
  startTutorial(mode: GameMode): void {
    this.unschedule(this.onTick);
    this.clearHint();
    this.dialog.hide();
    this.tutSpot.hide();
    this.tutBanner.hide();
    // Web `main.ts:893-897`：序章开始 → 跳过按钮与三颗进度点一起出现，进度从 0 起
    this.tutHud.show();

    const cfg = tutorialConfig(mode);
    this.cfg = cfg;
    this.levelIndex = TUTORIAL_LEVEL;
    this.levelSeed = TUTORIAL_SEED;
    this.rng = new Rng(TUTORIAL_SEED);

    // ⭐ 手工摆「3 缺 1」：引擎只在构造时接受快照，所以从这条入口把盘面塞进去。
    //    规则决定缺块摆多远：简单 = 最远（远距一步到位）；困难 = 2 步（多走几步）
    const built = buildTutorialLayout(cfg.rows, cfg.cols, cfg.imageIds, this.rng, cfg.swapRule);
    this.engine = new PuzzleEngine(cfg, this.rng, {
      cells: built.grid.toArray(),
      score: 0,
      eliminations: 0,
    });

    // 局内现场（对齐 beginLevel 的重置，但不扣体力、不建断点、不写进度）
    this.timeLeft = cfg.timeLimit;
    this.revived = false;
    this.revivedUsed = false;
    this.swapMisses = 0;
    this.eliminatedOnce = false;
    this.started = false;
    this.finished = false;
    this.busy = false;
    this.pendingOutcome = null;
    this.offlineSettle = false;
    this.dragCells = [];
    this.dragAnchor = -1;
    this.dragging = false;
    this.applyAudioSettings();

    this.layout();
    this.view.prewarm(cfg.imageIds);
    this.paintAll();
    this.view.playDropIn();
    this.setPaused(true); // 序章不计时：onTick 也不 schedule，时间永远不走

    const lay = built.layout;
    this.tut = {
      mode,
      step: 1,
      demoing: false,
      locked: lay !== null,
      targetIndex: lay?.targetIndex ?? -1,
      gapIndex: lay?.gapIndex ?? -1,
      fixed: lay?.fixed ?? [],
      groupCells: [],
    };

    // 进过序章就算"见过"（老玩家不必再看抽屉自动展开）
    if (!GS.tutorial.seen) GS.updateTutorial({ seen: true });

    // 落盘动画结束后再摆教学视觉：此刻棋盘刚重建，早了会标到旧格子上
    this.scheduleOnce(() => this.tutorialStep1(true), 1.2);
  }

  /** 教学「说一句话」：同一句既显示在横幅上，也念出来（Web 版 v4 口径） */
  private tutorialSay(text: string): void {
    if (!text) return;
    this.tutBanner.show(text, tutorialSayDuration(text));
    this.speech.speak(text);
  }

  /** 当前模式的语音文案（简单/困难两套，取不到的字段就是"这一步不讲"） */
  private tutScript(): ReturnType<typeof tutorialScript> {
    return tutorialScript(this.tut!.mode);
  }

  /** 开局说两句：先讲规则，5 秒后再讲这一步怎么拖（只说一次） */
  private tutorialSayIntro(): void {
    const s = this.tutScript();
    this.tutorialSay(s.rule);
    this.scheduleOnce(() => {
      if (this.tut && this.tut.step === 1) this.tutorialSay(s.drag);
    }, tutorialSayDuration(s.rule) / 1000);
  }

  /** 清掉「压暗 / 缺口框 / 脉冲」这些强制教学的视觉 */
  private tutClearMarks(): void {
    const total = this.cfg.rows * this.cfg.cols;
    for (let i = 0; i < total; i++) {
      const n = this.view.cellNode(i);
      const dim = n.getChildByName('tutDim');
      if (dim) dim.destroy();
      const gap = n.getChildByName('tutGap');
      if (gap) gap.destroy();
      const pulse = n.getChildByName('tutPulse');
      if (pulse) {
        tween(pulse.getComponent(UIOpacity)!).stop();
        pulse.destroy();
      }
    }
    this.view.setHint([]); // 恢复提示缩放（BoardView 无 clearHint，空数组 = 全部还原）
  }

  /** 教学压暗：除 `keep` 之外的格子全盖上半透明罩 */
  private tutDim(keep: number[]): void {
    const total = this.cfg.rows * this.cfg.cols;
    for (let i = 0; i < total; i++) {
      const n = this.view.cellNode(i);
      let dim = n.getChildByName('tutDim');
      if (keep.includes(i)) {
        if (dim) dim.destroy();
        continue;
      }
      if (dim) continue;
      dim = new Node('tutDim');
      dim.layer = Layers.Enum.UI_2D;
      dim.addComponent(UITransform).setContentSize(this.view.step - GAP, this.view.step - GAP);
      const g = dim.addComponent(Graphics);
      const s = this.view.step - GAP;
      g.rect(-s / 2, -s / 2, s, s);
      g.fillColor = new Color(40, 42, 52, 150);
      g.fill();
      dim.parent = n;
      dim.setPosition(0, 0, 0);
    }
  }

  /** 缺口框：金色描边提示"拖到这里" */
  private tutGapBox(index: number): void {
    const n = this.view.cellNode(index);
    if (n.getChildByName('tutGap')) return;
    const gap = new Node('tutGap');
    gap.layer = Layers.Enum.UI_2D;
    const s = this.view.step - GAP;
    gap.addComponent(UITransform).setContentSize(s, s);
    const g = gap.addComponent(Graphics);
    g.roundRect(-s / 2 + 4, -s / 2 + 4, s - 8, s - 8, 12);
    g.strokeColor = new Color(255, 214, 90, 255);
    g.lineWidth = 6;
    g.stroke();
    gap.parent = n;
    gap.setPosition(0, 0, 0);
  }

  /** 目标块脉冲：金色呼吸圈（循环 tween，玩家一按即被 guard 停掉） */
  private tutPulse(index: number): void {
    const n = this.view.cellNode(index);
    if (!n || index < 0) return;
    const old = n.getChildByName('tutPulse');
    if (old) old.destroy();
    const p = new Node('tutPulse');
    p.layer = Layers.Enum.UI_2D;
    const s = this.view.step - GAP;
    p.addComponent(UITransform).setContentSize(s, s);
    const g = p.addComponent(Graphics);
    g.roundRect(-s / 2 - 6, -s / 2 - 6, s + 12, s + 12, 16);
    g.strokeColor = new Color(255, 214, 90, 255);
    g.lineWidth = 8;
    g.stroke();
    const op = p.addComponent(UIOpacity);
    p.parent = n;
    p.setPosition(0, 0, 0);
    tween(op).repeatForever(tween(op).to(0.5, { opacity: 90 }).to(0.5, { opacity: 255 })).start();
  }

  /** 教学 step1：摆盘 + 演示落点（简单指缺口；困难指"下一步"） */
  private tutorialStep1(sayIntro: boolean): void {
    if (!this.tut) return;
    this.tutHand.stop();
    this.clearHint();
    this.tutClearMarks();
    if (!this.tut.locked) {
      // 摆盘降级：不锁输入，退回引擎的「可拼提示」（保证不会卡死）
      const picked = findHintCells(this.engine.board);
      if (picked.length >= 2) this.view.setHint(picked.slice());
      if (sayIntro) this.tutorialSayIntro();
      return;
    }
    const all: number[] = [];
    for (let i = 0; i < this.cfg.rows * this.cfg.cols; i++) all.push(i);
    this.tutDim([this.tut.targetIndex]);
    this.tutGapBox(this.tut.gapIndex);
    this.tutPulse(this.tut.targetIndex);

    // 演示落点：简单 = 直接指缺口（远距一步到位）；困难 = 指「下一步」那一格
    const board = this.engine.board;
    const from = board.index(board.rowOf(this.tut.targetIndex), board.colOf(this.tut.targetIndex));
    const toIdx = this.tut.mode === 'nightmare' ? this.tutorialNextStep() : this.tut.gapIndex;
    this.tutHand.play(this.cellCenter(from), this.cellCenter(toIdx));
    if (sayIntro) this.tutorialSayIntro();
  }

  /** 格子中心（棋盘局部坐标，HandHint 与格子同一坐标系） */
  private cellCenter(index: number): Vec3 {
    const board = this.engine.board;
    const row = board.rowOf(index);
    const col = board.colOf(index);
    return this.view.posOf(row, col);
  }

  /**
   * 困难模式：缺块朝缺口挪一格应该落到哪一格（绕开已拼好的 3 块）。
   * BFS 从缺口反推每格「还要挪几步」，再选相邻的、步数更少的那格。
   */
  private tutorialNextStep(): number {
    if (!this.tut) return this.tut?.gapIndex ?? -1;
    const board = this.engine.board;
    const cols = board.cols;
    const rows = board.rows;
    const blocked = new Set(this.tut.fixed);
    const from = this.tut.targetIndex;
    const goal = this.tut.gapIndex;
    const dist: Array<number | null> = new Array(rows * cols).fill(null);
    dist[goal] = 0;
    const queue = [goal];
    for (let head = 0; head < queue.length; head++) {
      const cur = queue[head]!;
      const r = Math.floor(cur / cols);
      const c = cur % cols;
      for (const [nr, nc] of [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]] as const) {
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
        const next = nr * cols + nc;
        if (blocked.has(next) || dist[next] !== null) continue;
        dist[next] = dist[cur]! + 1;
        queue.push(next);
      }
    }
    const curDist = dist[from];
    if (curDist === null) return goal;
    const r0 = Math.floor(from / cols);
    const c0 = from % cols;
    for (const [nr, nc] of [[r0 - 1, c0], [r0 + 1, c0], [r0, c0 - 1], [r0, c0 + 1]] as const) {
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
      const next = nr * cols + nc;
      if (blocked.has(next)) continue;
      if (dist[next] !== null && dist[next]! < curDist) return next;
    }
    return goal;
  }

  /** 【输入锁】按下时：不是"这一步该动的块"就直接不响应（+ 抖一下把视线拉回去） */
  private tutorialGuardDown(index: number): boolean {
    if (!this.tut) return true;
    this.tutHand.stop(); // 玩家一按就停，动画不再打扰
    if (!this.tut.locked) return true;
    const allowed =
      this.tut.step === 1
        ? index === this.tut.targetIndex
        : this.tut.step === 4
          ? this.tut.groupCells.includes(index)
          : true;
    if (allowed) return true;
    // 零文字反馈：按错的那块抖一下 + 目标块脉冲一次
    this.view.playReject([index], 0, -8);
    const hintAt = this.tut.step === 1 ? this.tut.targetIndex : this.tut.groupCells[0];
    if (hintAt !== undefined && hintAt >= 0) this.tutPulse(hintAt);
    return false;
  }

  /**
   * 【落点锁】松手时：
   *   - 简单（any）：必须一次远距拖到缺口（规则允许任意位置，所以直接要求落到缺口）；
   *   - 困难（adjacent）：一次只能挪一格 —— 落点必须是「手指演示的那一格」，不许往别处绕。
   */
  private tutorialGuardMove(anchor: number, target: number): boolean {
    if (!this.tut || !this.tut.locked || this.tut.step !== 1) return true;
    const board = this.engine.board;
    if (this.tut.mode === 'nightmare') {
      const dr = Math.abs(board.rowOf(anchor) - board.rowOf(target));
      const dc = Math.abs(board.colOf(anchor) - board.colOf(target));
      const want = this.tutorialNextStep();
      if (dr + dc !== 1 || target !== want) {
        this.view.playReject([anchor], 0, -8); // 回弹：说明"一次只能挪一格、且要往缺口方向"
        return false;
      }
      this.tut.targetIndex = target; // 缺块挪到新格了，教学标记跟着它走
      return true;
    }
    if (target === this.tut.gapIndex) return true;
    this.view.playReject([anchor], 0, -8); // 回弹：要放到缺口那一格
    return false;
  }

  /** 一次成功移动之后推进教学（第 4 步：体验过「整片一起走」即通过） */
  private tutorialAfterMove(): void {
    if (!this.tut) return;
    // 困难序章缺块要走好几步：挪一步提醒一句（只说话，视觉重摆在 afterResolve）
    if (this.tut.step === 1 && this.tut.mode === 'nightmare') {
      if (this.tut.targetIndex !== this.tut.gapIndex) this.tutorialSay(TUTORIAL_VOICE.nightmare.nextStep);
      return;
    }
    if (this.tut.step !== 4) return;
    this.tut.step = 5;
    this.tut.locked = false;
    this.tutHand.stop();
    this.tutClearMarks();
  }

  /** 消除一组之后推进教学（由 afterResolve 调用） */
  private tutorialAfterResolve(): void {
    if (!this.tut) return;
    if (this.tut.demoing) return;
    this.tutHand.stop();
    const score = this.engine.score;
    this.updateHud();

    if (score >= this.engine.config.star3) {
      this.finishTutorial();
      return;
    }
    if (this.tut.step === 1) {
      // 困难序章：还没挪到缺口（这一步没拼成）→ 动画播完了，重摆教学视觉 + 演示下一步
      if (this.tut.mode === 'nightmare' && this.tut.targetIndex !== this.tut.gapIndex) {
        this.tutorialStep1(false);
        return;
      }
      // S1 完成 → 解锁，讲旗子（聚光灯圈分数 = 过关分数；短句 + 一点后自动给"下一步"入口）
      this.tut.locked = false;
      this.tut.step = 2;
      this.tutClearMarks();
      this.scheduleOnce(() => {
        if (!this.tut || this.tut.step !== 2) return;
        // ⚠️ 与 Web 端同口径：聚光灯步骤**只用气泡 + 语音**，
        //    不许再弹横幅 —— 否则同一句话横幅和气泡各显示一遍，屏幕上全是字
        const tip = this.tutScript().flag;
        this.speech.speak(tip);
        this.tutSpot.show(this.hudRectOf('score'), {
          tip,
          onNext: () => this.tutorialStepTime(),
        });
      }, 0.9);
    }
  }

  /**
   * 讲完旗子 → 简单序章讲倒计时（困难不讲，直接自由拼）。
   * ⚠️ 每一步都要玩家操作才推进：这里只把话讲完、把聚光灯挂着，玩家点「▾ 继续」才演示。
   */
  private tutorialStepTime(): void {
    if (!this.tut) return;
    if (this.tut.mode === 'nightmare') {
      this.tut.step = 5;
      return;
    }
    this.tut.step = 3;
    this.tut.demoing = true;
    const tip = this.tutScript().time ?? '';
    this.speech.speak(tip);
    this.tutSpot.show(this.hudRectOf('time'), { tip, onNext: () => this.runTimeDemo() });
  }

  /** 玩家点了「继续」→ 让倒计时真的走 3 秒（眼见为实），走完再挂一次聚光灯 */
  private runTimeDemo(): void {
    if (!this.tut) return;
    this.started = true;
    this.setPaused(false);
    this.scheduleOnce(() => {
      if (!this.tut) return;
      this.started = false; // ⚠️ 不能留成 true，否则序章后面会真的开始扣时间
      this.setPaused(true);
      this.timeLeft = this.engine.config.timeLimit;
      this.updateHud();
      this.tut.demoing = false;
      // 演示完了 → 再等玩家点一次「继续」，不自动跳
      const tip = this.tutScript().timeDone ?? '';
      this.speech.speak(tip);
      this.tutSpot.show(this.hudRectOf('time'), { tip, onNext: () => this.tutorialStepGroup() });
    }, 3);
  }

  /** 讲完时间 → 教整片拖拉：只准拖这一片（落点不限），手指演示指路 */
  private tutorialStepGroup(): void {
    if (!this.tut) return;
    const group = this.engine.mergeGroups().find((g) => g.cells.length >= 2);
    if (!group) {
      this.tut.step = 5; // 场上没有成片的，跳过这一步
      return;
    }
    this.tut.step = 4;
    this.tut.locked = true;
    const groupCells = group.cells.slice();
    this.tut.groupCells = groupCells;
    this.tutClearMarks();
    this.tutDim(groupCells);
    for (const i of groupCells) this.tutPulse(i);
    this.tutorialSay(this.tutScript().group ?? '');

    // 演示：把这一片往斜下方挪一格（落点不限，只是指个方向）
    const board = this.engine.board;
    const anchor = groupCells[0]!;
    const toRow = board.rowOf(anchor) + 1;
    const toCol = board.colOf(anchor) + (board.colOf(anchor) + 1 < board.cols ? 1 : -1);
    if (board.inBounds(toRow, toCol)) {
      const ok = groupCells.every((i) =>
        board.inBounds(board.rowOf(i) + 1, board.colOf(i) + (board.colOf(anchor) + 1 < board.cols ? 1 : -1)));
      if (ok) this.tutHand.play(this.cellCenter(anchor), this.cellCenter(board.index(toRow, toCol)));
    }
  }

  /** 教学奖励：第 1 关免 1 颗体力 + 体力 +5（不送星、不送图鉴 —— 免得污染两套系统） */
  private grantTutorialReward(): void {
    // ⚠️ GameState 上叫 `gainStamina(count)`（`addStamina` 是 meta 层的纯函数，签名是 (state, now, count)）
    GS.gainStamina(5);
    GS.updateTutorial({ freeLevel: true });
  }

  /** 序章达成 3 星：结束教学（不写 progress / 不进排行榜 / 不进图鉴星数） */
  finishTutorial(): void {
    if (!this.tut) return;
    const m = this.tut.mode;
    this.tut = null;
    this.tutBanner.hide();
    this.tutHud.hide();                 // Web `main.ts:1155`：结算前收起进度点与跳过按钮
    this.tutHand.stop();
    this.tutSpot.hide();
    this.tutClearMarks();
    this.finished = true;
    this.setPaused(true);
    if (m === 'nightmare') GS.updateTutorial({ nightmareCleared: true });
    else GS.updateTutorial({ normalCleared: true });
    this.grantTutorialReward();
    GS.flush();
    this.audio.play('win');
    this.speech.speak(TUTORIAL_VOICE.done);
    // 用结算弹窗底板：只有「教学完成 + 继续第 1 关 + 回首页」（用户要求能多简就多简）
    this.dialog.show(TUTORIAL.doneTitle, [TUTORIAL.rewardFreeLevel], [
      { text: TUTORIAL.doneSecondary, onClick: () => this.exitToHome() },
      { text: TUTORIAL.donePrimary, onClick: () => { this.dialog.hide(); this.startLevel(1); }, primary: true },
    ]);
  }

  /**
   * 序章右上角「跳过教学」（Web `main.ts:1190`）：收起序章 UI → 记 seen → 回首页。
   * ⚠️ 与 `finishTutorial()` 的界线：**不发奖励、不弹教学完成**，只是退出。
   * ⚠️ Web 这里还有一句 `track(EVENT.tutorialSkip, { mode, step })`；Cocos 端 track 模块
   *    目前全项目零调用点（尚未接线），先不接，避免凭空造一条没接通的上报。
   */
  private exitTutorial(): void {
    if (!this.tut) return;
    this.tutorialReset();
    GS.updateTutorial({ seen: true });
    GS.flush();
    this.exitToHome();
  }

  /** 收起序章专属 UI（Web `tutorialReset`，main.ts:1201；不碰体力 —— 序章从没扣过） */
  private tutorialReset(): void {
    this.tut = null;
    this.tutHud.hide();
    this.tutBanner.hide();
    this.speech.stop();   // 跳过 / 退出时别让语音继续念
    this.tutHand.stop();
    this.tutSpot.hide();
    this.clearHint();
    this.tutClearMarks();
    this.finished = true;
    this.setPaused(true);
  }

  /** 跳过教学（横幅旁的「跳过」入口）—— 发奖励但不算完成 */
  skipTutorial(): void {
    if (!this.tut) return;
    this.tut = null;
    this.tutBanner.hide();
    this.tutHand.stop();
    this.tutSpot.hide();
    this.tutClearMarks();
    this.finished = true;
    this.setPaused(true);
    this.dialog.show(TUTORIAL.doneTitle, [], [
      { text: TUTORIAL.doneSecondary, onClick: () => this.exitToHome() },
      { text: TUTORIAL.donePrimary, onClick: () => { this.dialog.hide(); this.startLevel(1); }, primary: true },
    ]);
  }

  /** 聚光灯目标矩形（顶栏固定坐标：计分面板 (51,822) 246×162 / 计时块 (390,822) 228×160）。
   *  用常量而非 getBoundingBoxToWorld / node.position —— 预览 shim 未实现这两个 API。 */
  private hudRectOf(kind: 'score' | 'time'): SpotlightRect {
    return kind === 'score'
      ? { cx: 51, cy: 822, w: 246, h: 162 }
      : { cx: 390, cy: 822, w: 228, h: 160 };
  }

  private runGuide(step: number): void {
    if (GS.guideDone || step <= this.guideStep) return;
    this.guideStep = step;
    const text = [GUIDE.step1, GUIDE.step2, GUIDE.step3, GUIDE.step4, GUIDE.step5][step - 1];
    if (!text) return;
    this.guide.show(text);
    if (step >= 5) GS.finishGuide();
  }

  /* ================================================================ 存档 */

  private syncSession(): void {
    if (!this.engine || this.finished) return;
    const s: LevelSession = {
      mode: GS.mode,
      level: this.levelIndex,
      seed: this.levelSeed,
      rngState: this.rng.snapshot,
      cells: this.engine.board.toArray() as Cell[],
      score: this.engine.score,
      eliminations: this.engine.eliminations,
      timeLeft: this.timeLeft,
      started: this.started,
      revived: this.revived,
      revivedUsed: this.revivedUsed,
      swapMisses: this.swapMisses,
      eliminatedOnce: this.eliminatedOnce,
      savedAt: Date.now(),
    };
    GS.setSession(s);
  }
}

function COLLECTION_PROGRESS(n: number): string {
  return `已收集 ${n} / 36`;
}
