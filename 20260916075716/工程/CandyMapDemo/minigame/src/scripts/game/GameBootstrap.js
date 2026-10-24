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
  view, ResolutionPolicy, game, Game, EventTouch, input, Input, Camera, Canvas, director,
} from '../../runtime/cc.js';
import { BoardView, ANIM, GAP } from './BoardView.js';
import { GameDialog } from './GameDialog.js';
import { ToastLayer, fmtMMSS } from './toast.js';
import { GameAudio } from './audio.js';
import { GuideBar } from './guide.js';
import { GS } from './state.js';
import { syncFriendRank } from './wxFriend.js';
import { cloudSync, REPORT_MODES } from './cloud.js';
import { currentTheme, setThemeForLevel, onThemeChanged } from './theme.js';
import { showThemeWin, showThemeFail } from './themeResult.js';
import { MODE_LABEL, HOME, HONOR, REVIVE, FAIL, SAVE, ADS, GUIDE, BOARD } from './text.js';
import { unlockedImageIds } from './meta.js';
import {
  PuzzleEngine, Grid, Rng, buildLevelConfigs, computeMergeDisplay, clampShift, findHintCells,
  settleLevel, commitSettlement, recordOf, resumeTimeLeft, honorForLevel, boardSnapshot,
  TOTAL_LEVELS,
                                                                                
                                                                    
} from '../core/index.js';

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

export class GameBootstrap extends Component {
  levelIndex = 1;

  autoStart = false;

          view            = null ;
          dialog             = null ;
          toast             = null ;
          audio            = null ;
          guide           = null ;
  /** 主题化的对局背景（全屏渐变，重建于 applyThemeVisuals） */
          bgG                  = null;
  /** HUD 节点（主题化重建） */
          hudNode              = null;
  /** 最近一次 view.build 的参数（主题切换时按它重建棋盘） */
          boardSpec                                                      = null;

          engine               = null ;
          rng      = null ;
          cfg              = buildLevelConfigs('normal')[0] ;

  /* ---------------------------------------------------------------- 局内现场 */
          timeLeft = 0;
          started = false;
          paused = false;
          busy = false;
          finished = false;
          revived = false;
          revivedUsed = false;
          swapMisses = 0;
          eliminatedOnce = false;
  /** 离开期间倒计时已走完 → 恢复后直接结算，不给续命 */
          offlineSettle = false;
          levelSeed = 0;
  /** 未达星线时的结算结论，续命失败后用它出失败弹窗 */
          pendingOutcome                      = null;

  /* ---------------------------------------------------------------- 拖动 */
          dragCells           = [];
          dragAnchor = -1;
          dragStart = new Vec2();
          dragging = false;
  /** 触点换算用的 UI 相机（懒查找） */
          cam                = null;

  /* ---------------------------------------------------------------- HUD */
          hudLevel        = null ;
          hudTime        = null ;
          hudScore        = null ;
          hintTimer                                       = null;
          guideStep = 0;
  /** 进关时的图鉴已解锁数，用来只播报「本关新解锁的」 */
          lastUnlocked = 0;

  /* ================================================================ 生命周期 */

  onLoad()       {
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
    this.applyThemeVisuals();
    // 三主题切换（对局内右上角按钮触发）：背景 / HUD / 棋盘底板与融合环全部重建
    onThemeChanged(() => this.applyThemeVisuals());

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

  onDestroy()       {
    game.off(Game.EVENT_HIDE, this.handleHidden, this);
    game.off(Game.EVENT_SHOW, this.handleVisible, this);
    input.off(Input.EventType.TOUCH_START, this.onRawTouch, this);
    if (this.hintTimer !== null) clearTimeout(this.hintTimer);
  }

  start()       {
    if (this.autoStart) this.startLevel(this.levelIndex);
  }

          mount                     (name        , cls             )    {
    const n = new Node(name);
    n.parent = this.node;
    n.layer = Layers.Enum.UI_2D;
    n.addComponent(UITransform).setContentSize(DESIGN_W, DESIGN_H);
    const c = n.addComponent(cls);
    n.setSiblingIndex(this.node.children.length - 1);
    return c;
  }

  /** 读档播报：介质降级 / 整档作废 / 字段修复（原版 main() 步骤 18） */
          announceSaveResult()       {
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

          retryLoad()       {
    const r = GS.load();
    if (r.discarded) {
      this.toast.show(SAVE.retryStillBad, 3200);
      this.announceSaveResult();
      return;
    }
    this.toast.show(SAVE.repaired(r.issues.length), 3200);
    GS.flush();
  }

          onMetaTick()       {
    GS.tick();
  }

  /* ================================================================ 开局 */

  /**
   * 开一局（外部入口：地图点击 / 独立调试）。
   *
   * 若存档里有同一关的断点，先问「继续 / 放弃重开」—— 断点恢复**不重复扣体力**：
   * 入场费在退出前已经转正过一次了，再扣一次等于玩一局花两颗。
   */
  startLevel(level        )       {
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

          offerResume(s              )       {
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

          discardSession()       {
    const s = GS.session;
    const lv = s?.level ?? 0;
    GS.setSession(null);
    GS.flush();
    if (lv) this.toast.show(SAVE.discarded(lv), 1800);
  }

  /**
   * 真正建一局。`from` 为 null 表示新开（要扣体力），否则按断点恢复。
   */
          beginLevel(level        , from                     )       {
    this.unschedule(this.onTick);
    this.clearHint();

    // 关卡绑定主题：第 1/2/3/4 关 → 糖果/果冻/手账/糖果（循环），进关即换皮
    setThemeForLevel(level);

    const cfgs = buildLevelConfigs(from?.mode ?? GS.mode);
    this.cfg = cfgs[level - 1] ?? cfgs[0] ;
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
    // 图鉴按两套模式的星数合并计算（与 web 同口径），只算当前模式会漏掉另一半星
    this.lastUnlocked = unlockedImageIds(GS.data.progress.normal, GS.data.progress.nightmare).length;
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

          layout()       {
    const rows = this.cfg.rows;
    const cols = this.cfg.cols;
    const availW = DESIGN_W - 64;
    const availH = BOARD_TOP - BOARD_BOTTOM - 24;
    const cell = Math.floor(Math.min((availW - GAP * (cols - 1)) / cols, (availH - GAP * (rows - 1)) / rows));
    this.boardSpec = { rows, cols, cell };
    this.view.build(rows, cols, cell);
  }

          paintAll()       {
    this.view.setCells(this.engine.board.toArray());
    this.view.applyMerge(computeMergeDisplay(this.engine.board));
  }

  /* ================================================================ 输入 */

          bindInput()       {
    const host = this.view.node;
    host.on(Node.EventType.TOUCH_START, this.onTouchStart, this);
    host.on(Node.EventType.TOUCH_MOVE, this.onTouchMove, this);
    host.on(Node.EventType.TOUCH_END, this.onTouchEnd, this);
    host.on(Node.EventType.TOUCH_CANCEL, this.onTouchEnd, this);
    // 真机排查：引擎层收到的原始触摸。有这行、没有 [board] 开始拖动 → 触摸被别的节点吞了或没命中棋盘
    input.on(Input.EventType.TOUCH_START, this.onRawTouch, this);
    console.log('[board] 输入已绑定');
  }

          onRawTouch(e            )       {
    if (!this.node.activeInHierarchy) return;
    console.log('[board] 原始触摸', e.getUILocation().toString());
  }

  /**
   * 触点 → 棋盘本地坐标。
   *
   * ⚠️ 2026-10-23：不能用 `getUILocation()` 直接当世界坐标。它是「设计分辨率、左下角为原点」的坐标，
   * 只有 Canvas 恰好摆在屏幕中心时才等于世界坐标。微信里两者对不上，每次触摸都被判成
   * 「不在格子上」—— 而引擎自己判定命中棋盘用的是「屏幕坐标 + 相机 screenToWorld」，
   * 所以这里走同一条换算，结果和引擎的命中判定一致。
   */
          localOf(e            )       {
    const t = this.view.node.getComponent(UITransform) ;
    const cam = this.uiCamera();
    if (cam) {
      const s = e.getLocation();
      const world = cam.screenToWorld(new Vec3(s.x, s.y, 0));
      return t.convertToNodeSpaceAR(new Vec3(world.x, world.y, 0));
    }
    const p = e.getUILocation();
    return t.convertToNodeSpaceAR(new Vec3(p.x, p.y, 0));
  }

  /** 拍 UI 层的相机（Canvas 上挂的那台）；找不到时退回 UI 坐标换算 */
          uiCamera()                {
    if (this.cam?.isValid) return this.cam;
    let p              = this.node;
    while (p) {
      const canvas = p.getComponent(Canvas);
      if (canvas?.cameraComponent) { this.cam = canvas.cameraComponent; return this.cam; }
      p = p.parent;
    }
    this.cam = director.getScene()?.getComponentInChildren(Camera) ?? null;
    return this.cam;
  }

  /** 本地坐标 → 格子下标，落在缝隙或界外返回 -1 */
          hitCell(p      )         {
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
          axes(dr        , dc        )                             {
    if (this.cfg.swapRule !== 'adjacent') return { dr, dc };
    if (Math.abs(dr) >= Math.abs(dc)) return { dr: Math.sign(dr) * Math.min(1, Math.abs(dr)), dc: 0 };
    return { dr: 0, dc: Math.sign(dc) * Math.min(1, Math.abs(dc)) };
  }

          onTouchStart(e            )       {
    // 真机排查用：点了没反应时，看控制台卡在哪一步（2026-10-23 微信里拖不动）
    if (this.busy || this.finished) {
      console.log(`[board] 触摸被忽略：busy=${this.busy} finished=${this.finished}`);
      return;
    }
    const local = this.localOf(e);
    const cell = this.hitCell(local);
    if (cell < 0) {
      console.log(`[board] 触点不在格子上 ui=${e.getUILocation().toString()} 本地=(${Math.round(local.x)}, ${Math.round(local.y)})`
        + ` 格距=${this.view.step} ${this.cfg.rows}×${this.cfg.cols} 相机=${this.uiCamera() ? '有' : '无'}`);
      return;
    }
    const group = this.engine.groupOfCell(cell);
    if (!group) {
      console.log(`[board] 第 ${cell} 格是空位`);
      return;
    }
    console.log(`[board] 开始拖动第 ${cell} 格（整片 ${group.cells.length} 块）`);
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

          onTouchMove(e            )       {
    if (!this.dragging) return;
    const p = e.getUILocation();
    const raw = { dr: -(p.y - this.dragStart.y) / this.view.step, dc: (p.x - this.dragStart.x) / this.view.step };
    const a = this.axes(raw.dr, raw.dc);
    // 跟手用**连续值**（否则整片只能一格一格跳）；边界由 clampShift 兜住
    const sh = clampShift(this.engine.board, this.dragCells, a.dr, a.dc);
    this.view.setDragOffset(this.dragCells, sh.dc * this.view.step, -sh.dr * this.view.step);
  }

          onTouchEnd(e            )       {
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

          doMove(anchor        , target        , intent                            )       {
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
          playResolution(outcome             , gained        )       {
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
          playCollapse(st               )       {
    const before = st.afterEliminate;
    const final = this.engine.board.toArray();
    const cols = this.cfg.cols;
    const oldIndex = new Map                ();
    before.forEach((p, i) => { if (p !== null) oldIndex.set(p, i); });
    const drops = new Map                ();
    const spawns = new Map                ();
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

          afterResolve()       {
    this.busy = false;
    if (!this.finished) this.setPaused(false);
    this.paintAll();
    this.updateHud();
    this.syncSession();
    if (this.eliminatedOnce) this.runGuide(5);
  }

  /* ================================================================ 倒计时 */

          onTick()       {
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

          setPaused(v         )       {
    this.paused = v;
    this.audio.setRunning(this.started && !this.paused && !this.finished);
  }

  /** 把存档里的音效/音乐开关应用到播放器（设置页改完、进关、启动都要走一次） */
          applyAudioSettings()       {
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
          handleHidden()       {
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
          handleVisible()       {
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
          onLevelEnd()       {
    if (this.finished || !this.engine) return;
    this.finished = true;
    this.setPaused(true);
    this.unschedule(this.onTick);
    this.updateHud();
    // 结算后断点立即作废：否则玩家下次进关会「恢复」到一个已经结束的局
    GS.setSession(null);
    GS.flush();

    const outcome               = {
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
      // 结算落盘后把最新总分/星数报给微信托管 KV（好友榜数据源；非微信 no-op）
      syncFriendRank();
      // 云端结算上报（v1 仅简单模式：后端关卡守卫会拒困难模式的偏移关号，见 cloud.ts 头注释）。
      // 失败进离线队列，下次启动补传；不挡本地流程
      if (REPORT_MODES.includes(GS.mode)) {
        void cloudSync()?.report({
          level: outcome.level, win: true, stars: settlement.stars, score: outcome.score,
        });
      }
      this.audio.play('win');
      this.announceUnlocks(next);
      this.showHonorDialog(outcome, settlement, after.boardBest);
    } else {
      this.audio.play('fail');
      this.showFailDialog(outcome);
    }
  }

  /** 图鉴解锁播报（§10.3：首次通关即解锁） */
          announceUnlocks(next              )       {
    // `next` 是当前模式结算后的新进度，另一套模式的星数也要算上
    const other = GS.mode === 'normal' ? GS.data.progress.nightmare : GS.data.progress.normal;
    const ids = unlockedImageIds(next, other);
    if (ids.length > this.lastUnlocked) {
      const gained = ids.length - this.lastUnlocked;
      this.lastUnlocked = ids.length;
      this.toast.show(`图鉴 +${gained}（${COLLECTION_PROGRESS(ids.length)}）`, 2600);
    }
  }

  /** 荣誉弹窗三档（超神 / 王者 / 优秀）—— 主题化结算弹窗（照抄 design/ 原型布局） */
          showHonorDialog(outcome              , settlement                 , boardBest        )       {
    const honor = honorForLevel({
      level: this.levelIndex,
      line: { star1: this.cfg.star1, star2: this.cfg.star2, star3: this.cfg.star3 },
      score: outcome.score,
      stars: settlement.stars,
      revived: outcome.revived,
      boardBest,
    });

    this.audio.play(honor.tier === 'god' ? 'honorGod' : honor.tier === 'king' ? 'honorKing' : 'honorPass');

    const normal = GS.data.progress.normal;
    const nightmare = GS.data.progress.nightmare;
    let total = 0;
    for (const p of [normal, nightmare]) {
      for (const key of Object.keys(p.levels)) {
        const level = Number(key);
        if (Number.isFinite(level)) total += recordOf(p, level).personalBest;
      }
    }
    const stickers = Math.max(1, Math.floor(outcome.score / 300));

    showThemeWin(this.node, {
      stars: settlement.stars,
      score: outcome.score,
      stickers,
      totalScore: total,
      isNewBest: boardBest === outcome.score && outcome.score > 0,
    }, {
      onNext: () => this.nextLevel(),
      onBack: () => this.exitToHome(),
    });
  }

  /** 排行榜（灰盒 100 人 + 本机） */
          showBoardDialog(boardBest        )       {
    const snap = boardSnapshot(this.levelIndex, { star1: this.cfg.star1, star2: this.cfg.star2, star3: this.cfg.star3 }, boardBest);
    const lines = [`第 ${this.levelIndex} 关 · ${BOARD.total(snap.totalPlayers)}`];
    for (const r of snap.rows.slice(0, 6)) {
      lines.push(`${r.rank}. ${r.name}　${r.score} 分`);
    }
    if (snap.myRank) lines.push(`我的名次 第 ${snap.myRank} 名`);
    else lines.push('达到 3★ 才能上榜哦');
    this.dialog.show('排行榜', lines, [{ text: '关闭', onClick: () => {}, primary: true }]);
  }

  /** 失败弹窗 —— 主题化（差多少分到第 1 星 + 续命/放弃） */
          showFailDialog(outcome              )       {
    const need = this.cfg.star1 - outcome.score;
    showThemeFail(this.node, Math.max(0, need), () => this.watchRevive(), () => this.exitToHome());
  }

  /** 续命弹窗 —— 主题化（失败弹窗的续命变体） */
          showReviveDialog()       {
    showThemeFail(this.node, 0, () => this.watchRevive(), () => this.giveUp());
  }

  /** 广告续命（本地模拟：1.2 秒「观看」） */
          watchRevive()       {
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

          revive()       {
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

          giveUp()       {
    const o = this.pendingOutcome;
    this.pendingOutcome = null;
    if (o) this.showFailDialog(o);
    else this.exitToHome();
  }

  /* ================================================================ 关卡流转 */

          restart()       {
    const lv = this.levelIndex;
    GS.setSession(null);
    this.beginLevel(lv, null);
  }

          nextLevel()       {
    GS.setSession(null);
    this.beginLevel(Math.min(TOTAL_LEVELS, this.levelIndex + 1), null);
  }

  /**
   * 主动返回主页 = 中途退出（§12.4）：退还预扣体力 + 清断点。
   * 与「切后台」不同 —— 后者是被动退出，断点要留着。
   */
          exitToHome()       {
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
          findMapNode()              {
    let p = this.node.parent;
    for (let i = 0; i < 4 && p; i++) {
      const m = p.getChildByName('Map');
      if (m) return m;
      p = p.parent;
    }
    return null;
  }

  /* ================================================================ HUD */

          updateHud()       {
    if (!this.hudTime) return;
    this.hudLevel.string = `${currentTheme().copy.modeLabel} · 第 ${this.levelIndex} 关`;
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
  showHint()       {
    if (!this.engine || this.busy || this.finished) return;
    const cells = findHintCells(this.engine.board);
    if (cells.length < 2) return;
    this.view.setHint(cells);
    if (this.hintTimer !== null) clearTimeout(this.hintTimer);
    this.hintTimer = setTimeout(() => this.clearHint(), 2600);
  }

          clearHint()       {
    if (this.hintTimer !== null) { clearTimeout(this.hintTimer); this.hintTimer = null; }
    this.view?.setHint([]);
  }

          buildHud()       {
    if (this.hudNode) this.hudNode.destroy();
    const t = currentTheme();
    const bar = new Node('Hud');
    bar.parent = this.node;
    bar.layer = Layers.Enum.UI_2D;
    bar.addComponent(UITransform).setContentSize(DESIGN_W, 150);
    bar.setPosition(0, 885);
    this.hudNode = bar;

    if (t.hudStyle === 'bar') {
      // 整条横牌（糖果嘉年华的木牌 / 手账的牛皮纸）
      const g = bar.addComponent(Graphics);
      g.fillColor = t.hudFillB;
      g.roundRect(-DESIGN_W / 2, -75, DESIGN_W, 150, 26);
      g.fill();
      g.fillColor = t.hudFillA;
      g.roundRect(-DESIGN_W / 2, -30, DESIGN_W, 105, 26);
      g.fill();
    }
    // pills 形态（果冻乐园）不画整条：三只白胶囊各自带底

    const mkPill = (x        , w        )           => {
      const n = new Node('Pill');
      n.parent = bar;
      n.layer = Layers.Enum.UI_2D;
      n.addComponent(UITransform).setContentSize(w, 118);
      n.setPosition(x, 0);
      const g = n.addComponent(Graphics);
      g.fillColor = t.hudFillA;
      g.roundRect(-w / 2, -59, w, 118, 59);
      g.fill();
      return g;
    };
    const pill = t.hudStyle === 'pills';

    this.hudLevel = this.hudText(bar, 30, pill ? -432 : -330, 0, 300, t.hudText);
    this.hudTime = this.hudText(bar, 46, 0, 0, 260, t.hudAccent);
    this.hudScore = this.hudText(bar, 34, pill ? 432 : 300, 0, 240, t.hudText);
    for (const l of [this.hudLevel, this.hudTime, this.hudScore]) {
      l.fontFamily = t.fontFamily;
      if (t.textShadow) l.enableBold = true;
    }
    if (pill) { mkPill(-432, 250); mkPill(0, 260); mkPill(432, 250); }

    // 返回主页 —— 必须挂在 bar 上（bar 在棋盘上方的安全区）。
    // 挂 this.node 的话坐标原点是画面中心，(-460, 0) 会直接压在棋盘左中部，
    // 既挡视线又吞掉那一带的拖动。
    const back = this.hudButton(bar, 'BtnBack', -460, 0, 120, 88, t.backFill, '返回', 28);
    back.on(Node.EventType.TOUCH_END, () => this.exitToHome(), this);

    // 提示 —— 棋盘下沿是 BOARD_BOTTOM(-640)，-740 在其下方，属于安全区
    const hint = this.hudButton(this.node, 'BtnHint', 0, -740, 240, 96, t.hintFill, '提示', 32);
    hint.on(Node.EventType.TOUCH_END, () => this.showHint(), this);
  }

  /**
   * 主题落地：全屏背景渐变 + HUD + 棋盘（底板 / 融合环配色）。
   * 首次 onLoad 调一次，之后每次切换主题调一次 —— 只换皮，引擎与盘面数据不动。
   */
          applyThemeVisuals()       {
    const t = currentTheme();
    // ---- 背景（重建）----
    if (this.bgG) this.bgG.node.destroy();
    const bgNode = new Node('ThemeBg');
    bgNode.parent = this.node;
    bgNode.layer = Layers.Enum.UI_2D;
    bgNode.addComponent(UITransform).setContentSize(DESIGN_W, DESIGN_H);
    this.bgG = bgNode.addComponent(Graphics);
    const N = 16;
    for (let i = 0; i < N; i++) {
      const k = i / (N - 1);
      this.bgG.fillColor = new Color(
        Math.round(t.bgTop.r + (t.bgBottom.r - t.bgTop.r) * k),
        Math.round(t.bgTop.g + (t.bgBottom.g - t.bgTop.g) * k),
        Math.round(t.bgTop.b + (t.bgBottom.b - t.bgTop.b) * k),
      );
      const bandH = DESIGN_H / N + 2;
      this.bgG.rect(-DESIGN_W / 2, DESIGN_H / 2 - (i + 1) * bandH + 1, DESIGN_W, bandH);
      this.bgG.fill();
    }
    bgNode.setSiblingIndex(0);   // 垫在所有层之下（棋盘 / HUD / 弹窗之上于它）
    // ---- HUD ----
    this.buildHud();
    // ---- 棋盘（底板 + 融合环配色随主题重建；贴图与盘面数据重放）----
    this.rebuildBoard();
  }

  /** 按最近一次的棋盘规格重建视图（主题切换用）；尚未开局时跳过 */
          rebuildBoard()       {
    if (!this.boardSpec || !this.engine) return;
    const { rows, cols, cell } = this.boardSpec;
    this.view.build(rows, cols, cell);
    this.view.setCells(this.engine.board.toArray());
    this.view.applyMerge(computeMergeDisplay(this.engine.board));
  }

          hudText(parent      , size        , x        , y        , w        , color       )        {
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

          hudButton(parent      , name        , x        , y        , w        , h        , color       , text        , size        )       {
    const n = new Node(name);
    n.parent = parent;
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

          runGuide(step        )       {
    if (GS.guideDone || step <= this.guideStep) return;
    this.guideStep = step;
    const text = [GUIDE.step1, GUIDE.step2, GUIDE.step3, GUIDE.step4, GUIDE.step5][step - 1];
    if (!text) return;
    this.guide.show(text);
    if (step >= 5) GS.finishGuide();
  }

  /* ================================================================ 存档 */

          syncSession()       {
    if (!this.engine || this.finished) return;
    const s               = {
      mode: GS.mode,
      level: this.levelIndex,
      seed: this.levelSeed,
      rngState: this.rng.snapshot,
      cells: this.engine.board.toArray()          ,
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

function COLLECTION_PROGRESS(n        )         {
  return `已收集 ${n} / 36`;
}
