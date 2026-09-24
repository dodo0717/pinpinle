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
  view, ResolutionPolicy, game, Game, EventTouch,
} from 'cc';
import { BoardView, ANIM, GAP } from './BoardView';
import { GameDialog } from './GameDialog';
import { ToastLayer, fmtMMSS } from './toast';
import { GameAudio } from './audio';
import { GuideBar } from './guide';
import { GS } from './state';
import { MODE_LABEL, HOME, HONOR, REVIVE, FAIL, SAVE, ADS, GUIDE, BOARD } from './text';
import { unlockedImageIds } from './meta';
import {
  PuzzleEngine, Grid, Rng, buildLevelConfigs, computeMergeDisplay, clampShift, findHintCells,
  settleLevel, commitSettlement, recordOf, resumeTimeLeft, honorForLevel, boardSnapshot,
  TOTAL_LEVELS,
  type MoveOutcome, type ResolveStages, type LevelOutcome, type LevelSettlement,
  type LevelConfig, type LevelSession, type Cell, type ProgressData,
} from '../核心/index';

const { ccclass, property } = _decorator;

const DESIGN_W = 1080;
const DESIGN_H = 1920;
const BOARD_TOP = 780;
const BOARD_BOTTOM = -640;
/** 小于这个位移视为点击（画布 px） */
const TAP_SLOP = 14;
/** 续命加时（秒） */
const REVIVE_SECONDS = 60;
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

  /* ---------------------------------------------------------------- 拖动 */
  private dragCells: number[] = [];
  private dragAnchor = -1;
  private dragStart = new Vec2();
  private dragging = false;

  /* ---------------------------------------------------------------- HUD */
  private hudLevel: Label = null!;
  private hudTime: Label = null!;
  private hudScore: Label = null!;
  private hintTimer: ReturnType<typeof setTimeout> | null = null;
  private guideStep = 0;
  /** 进关时的图鉴已解锁数，用来只播报「本关新解锁的」 */
  private lastUnlocked = 0;

  /* ================================================================ 生命周期 */

  onLoad(): void {
    view.setDesignResolutionSize(DESIGN_W, DESIGN_H, ResolutionPolicy.FIXED_WIDTH);

    const host = new Node('BoardHost');
    host.parent = this.node;
    host.layer = Layers.Enum.UI_2D;
    host.addComponent(UITransform).setContentSize(DESIGN_W, BOARD_TOP - BOARD_BOTTOM);
    host.setPosition(0, (BOARD_TOP + BOARD_BOTTOM) / 2);
    this.view = host.addComponent(BoardView);

    this.dialog = this.mount('Dialog', GameDialog);
    this.toast = this.mount('Toast', ToastLayer);
    this.audio = this.mount('Audio', GameAudio);
    this.guide = this.mount('Guide', GuideBar);
    this.buildHud();

    // 动画播放中不落盘（§16）：此刻引擎里已是「交换后」状态，写下去等于承认这次交换
    GS.canWrite = () => !this.busy;
    GS.init();
    this.announceSaveResult();

    this.bindInput();
    this.applyAudioSettings();
    game.on(Game.EVENT_HIDE, this.handleHidden, this);
    game.on(Game.EVENT_SHOW, this.handleVisible, this);
    // 元系统心跳：跨天重置 + 体力按时间戳恢复（与原版 main() 的 1s 心跳同口径）
    this.schedule(this.onMetaTick, 1);
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
        if (pre.reason === 'already-pending') {
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
    }

    this.finished = false;
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
    this.schedule(this.onTick, 1);
    this.runGuide(1);

    if (from) {
      this.toast.show(SAVE.resumed(from.level, fmtMMSS(this.timeLeft), this.started), 2600);
    }
  }

  private layout(): void {
    const rows = this.cfg.rows;
    const cols = this.cfg.cols;
    const availW = DESIGN_W - 64;
    const availH = BOARD_TOP - BOARD_BOTTOM - 24;
    const cell = Math.floor(Math.min((availW - GAP * (cols - 1)) / cols, (availH - GAP * (rows - 1)) / rows));
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
    this.doMove(this.dragAnchor, b.index(row, col), intent);
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
            if (gained > 0) this.view.floatScore(st.eliminatedCells[0] ?? 0, `+${gained}`);
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
    if (this.busy || this.finished || !this.engine) return;
    this.setPaused(true);
    this.syncSession();
    GS.flush();
  }

  /**
   * 回前台：按时间戳一次性补扣离开期间的时间。
   *
   * 后台的 `schedule` 会被节流，逐秒扣不准，所以只能按 `savedAt` 算总账。
   */
  private handleVisible(): void {
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

    const lines = [
      HONOR.scoreLine(outcome.score),
      tierLine,
      boardBest > 0 ? HONOR.bestLine(boardBest) : '',
    ].filter(Boolean);

    const buttons: { text: string; onClick: () => void; primary?: boolean }[] = [];
    if (this.levelIndex < TOTAL_LEVELS) buttons.push({ text: HONOR.next, onClick: () => this.nextLevel(), primary: true });
    buttons.push({ text: HONOR.retry, onClick: () => this.restart(), primary: buttons.length === 0 });
    if (boardBest > 0) buttons.push({ text: HONOR.rank, onClick: () => this.showBoardDialog(boardBest) });
    buttons.push({ text: HONOR.backHome, onClick: () => this.exitToHome() });

    this.dialog.show(title, lines, buttons.slice(0, 3), settlement.stars, hero);
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

  private showFailDialog(outcome: LevelOutcome): void {
    this.dialog.show(FAIL.title, [
      FAIL.line1(outcome.score),
      FAIL.line2(this.cfg.star1, this.cfg.star2, this.cfg.star3),
      FAIL.line3,
    ], [
      { text: FAIL.backHome, onClick: () => this.exitToHome() },
      { text: FAIL.retry, onClick: () => this.restart(), primary: true },
    ]);
  }

  private showReviveDialog(): void {
    const left = GS.adStaminaLeft;
    this.dialog.show(REVIVE.title, [
      REVIVE.line1(REVIVE_SECONDS),
      REVIVE.line2,
    ], [
      { text: REVIVE.giveUp, onClick: () => this.giveUp() },
      { text: REVIVE.watch, onClick: () => this.watchRevive(), primary: true, disabled: left <= 0 },
    ]);
  }

  /** 广告续命（本地模拟：1.2 秒「观看」） */
  private watchRevive(): void {
    if (GS.adStaminaLeft <= 0) {
      this.toast.show(ADS.dailyLimit, 2600);
      return;
    }
    GS.recordAd();
    this.toast.show('广告播放中…', 1200);
    this.busy = true;
    this.scheduleOnce(() => {
      this.busy = false;
      this.revive();
    }, 1.2);
  }

  private revive(): void {
    this.revived = true;
    this.revivedUsed = true;
    this.finished = false;
    this.pendingOutcome = null;
    this.timeLeft += REVIVE_SECONDS;
    this.setPaused(false);
    this.syncSession();
    GS.flush();
    this.schedule(this.onTick, 1);
    this.toast.show(REVIVE.gained(REVIVE_SECONDS), 1800);
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
    const map = this.node.parent?.getChildByName('Map');
    if (map) {
      map.active = true;
      this.node.active = false;
    }
  }

  /* ================================================================ HUD */

  private updateHud(): void {
    if (!this.hudTime) return;
    this.hudLevel.string = `${MODE_LABEL[GS.mode]} · 第 ${this.levelIndex} 关`;
    this.hudTime.string = fmtMMSS(this.timeLeft);
    this.hudScore.string = `${this.engine ? this.engine.score : 0} 分`;
    // 颜色即信息：剩 1 分钟转橙、剩 10 秒转红（原版 #hud-timer.warn / .danger）
    this.hudTime.color = this.timeLeft <= 10
      ? new Color(226, 68, 68, 255)
      : this.timeLeft <= 60
        ? new Color(240, 150, 40, 255)
        : new Color(255, 255, 255, 255);
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

  private buildHud(): void {
    const bar = new Node('Hud');
    bar.parent = this.node;
    bar.layer = Layers.Enum.UI_2D;
    bar.addComponent(UITransform).setContentSize(DESIGN_W, 150);
    bar.setPosition(0, 885);
    const bg = bar.addComponent(Graphics);
    bg.fillColor = new Color(255, 176, 62, 255);
    bg.roundRect(-DESIGN_W / 2, -75, DESIGN_W, 150, 0);
    bg.fill();

    this.hudLevel = this.hudText(bar, 30, -330, 0, 300, new Color(255, 255, 255));
    this.hudTime = this.hudText(bar, 46, 0, 0, 260, new Color(255, 255, 255));
    this.hudScore = this.hudText(bar, 34, 300, 0, 240, new Color(255, 255, 255));

    // 返回主页
    const back = this.hudButton('BtnBack', -460, 0, 120, 96, new Color(255, 255, 255, 60), '返回', 28);
    back.on(Node.EventType.TOUCH_END, () => this.exitToHome(), this);

    // 提示
    const hint = this.hudButton('BtnHint', 0, -740, 240, 96, new Color(126, 200, 120, 255), '提示', 32);
    hint.on(Node.EventType.TOUCH_END, () => this.showHint(), this);
  }

  private hudText(parent: Node, size: number, x: number, y: number, w: number, color: Color): Label {
    const n = new Node('Txt');
    n.parent = parent;
    n.layer = Layers.Enum.UI_2D;
    n.addComponent(UITransform).setContentSize(w, size + 10);
    n.setPosition(x, y);
    const l = n.addComponent(Label);
    l.fontSize = size;
    l.lineHeight = size + 8;
    l.color = color;
    return l;
  }

  private hudButton(name: string, x: number, y: number, w: number, h: number, color: Color, text: string, size: number): Node {
    const n = new Node(name);
    n.parent = this.node;
    n.layer = Layers.Enum.UI_2D;
    n.addComponent(UITransform).setContentSize(w, h);
    n.setPosition(x, y);
    const g = n.addComponent(Graphics);
    g.fillColor = color;
    g.roundRect(-w / 2, -h / 2, w, h, h / 2);
    g.fill();
    const l = this.hudText(n, size, 0, 0, w, new Color(255, 255, 255));
    l.string = text;
    return n;
  }

  /* ================================================================ 引导（§14 五步） */

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
