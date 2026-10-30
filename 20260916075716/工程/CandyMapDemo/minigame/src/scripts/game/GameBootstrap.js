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
  _decorator, Component, Node, UITransform, Vec3, Vec2, Layers,
  view, ResolutionPolicy, game, Game, EventTouch, input, Input, Camera, Canvas, director,
} from '../../runtime/cc.js';
import { BoardView, ANIM, GAP } from './BoardView.js';
import { GameDialog } from './GameDialog.js';
import { ToastLayer, fmtMMSS } from './toast.js';
import { GameAudio } from './audio.js';
import { GuideBar } from './guide.js';
import { GS } from './state.js';
import { showRewardedAd } from './ads.js';
import { track } from './analytics.js';
import { SERVER_RETENTION_API } from '../core/release.js';
import { syncFriendRank, setShareChallenge, shareChallengeNow } from './wxFriend.js';
import { cloudSync, REPORT_MODES } from './cloud.js';
import { setThemeForLevel, onThemeChanged, currentTheme } from './theme.js';
import { showThemeWin, showThemeFail } from './themeResult.js';
import { showComboWord, showThemeGuideOnce } from './themeExtras.js';
import { ThemeHud, buildThemeBg,                } from './themeHud.js';
import { screenH, screenInsets } from './paint.js';
import { WebHud, webLayout } from './webHud.js';
import { showWebResult,                } from './webResult.js';
import {
  MODE_LABEL, HOME, REVIVE, SAVE, ADS, GUIDE, BOARD, PANEL, DAILY, TICKET, SHARE,
  WEB_HONOR, WEB_FAIL, WEB_REVIVE, WEB_GUIDE, webScoreLabel,
} from './text.js';
import { unlockedImageIds, AD_STAMINA_GAIN } from './meta.js';
import {
  PuzzleEngine, Grid, Rng, buildLevelConfigs, computeMergeDisplay, clampShift, findHintCells,
  settleLevel, commitSettlement, recordOf, rankTotals, resumeTimeLeft, honorForLevel, boardSnapshot,
  TOTAL_LEVELS, reviveSecondsFor, createTally, addElimination, onRevive, newlyEarned, starsFor,
  startDailyPlay, finishDailyPlay, dailyPlaysLeft, dailyLevel, dailySeed, dayKeyOf, DAILY_CLEAR_STAMINA,
  useReviveTicket, SCORE_RULE,
                                                                                                  
                                                                    
} from '../core/index.js';

const { ccclass, property } = _decorator;

const DESIGN_W = 1080;
const DESIGN_H = 1920;
/** 棋盘左右留白（屏幕边 → 底板外沿） */
const BOARD_SIDE = 24;
/** 第 1 关（web 原型）棋盘目标占屏宽比 —— web main.ts 的 BOARD_FILL */
const WEB_BOARD_FILL = 0.98;
/** 单格上限：3×4 的早期关卡格子太大反而显得粗糙 */
const CELL_MAX = 236;
/** 小于这个位移视为点击（画布 px） */
const TAP_SLOP = 14;
/** 续命加时（秒）—— **按关段取值**，见 `reviveSecondsFor()`（2026-10-29 起分段） */
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
  /** 主题化的对局背景（全屏，重建于 applyThemeVisuals） */
          bgNode              = null;
  /** 主题 HUD（顶栏 + 星线 + 底栏 + 提示键，重建于 applyThemeVisuals） */
          hud                  = null;
  /** 纵向排版（按可视高度 + 安全区算一次） */
          L            = null ;
  /** 棋盘可用区的上下沿（设计坐标，屏幕中心为原点） */
          boardTop = 0;
          boardBottom = 0;
  /** 最近一次 view.build 的参数（主题切换时按它重建棋盘） */
          boardSpec                                                      = null;

          engine               = null ;
          rng      = null ;
          cfg              = buildLevelConfigs('normal')[0] ;

  /* ---------------------------------------------------------------- 局内现场 */
          timeLeft = 0;
  /** 本局是每日挑战（startDaily 开的）：不耗体力、不写进度 / 断点、不续命 */
          daily = false;
  /** 本局排行分计分器（2026-10-27 评审 P1-1，核心/scoring.ts）；判星仍看 engine.score（组数） */
          tally              = createTally(0);
          started = false;
          paused = false;
          busy = false;
  /** 本回合连锁数（一次交换引发的连续消除次数，≥2 弹连击词） */
          chainCount = 0;
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
  /** 第 1 关（web 原型）HUD —— 与三主题 ThemeHud 二选一 */
          webHud                = null;
          hintTimer                                       = null;
          guideStep = 0;
  /** 进关时的图鉴已解锁数，用来只播报「本关新解锁的」 */
          lastUnlocked = 0;

  /* ================================================================ 生命周期 */

  onLoad()       {
    view.setDesignResolutionSize(DESIGN_W, DESIGN_H, ResolutionPolicy.FIXED_WIDTH);
    this.measureLayout();

    const host = new Node('BoardHost');
    host.parent = this.node;
    host.layer = Layers.Enum.UI_2D;
    host.addComponent(UITransform).setContentSize(DESIGN_W, this.boardTop - this.boardBottom);
    host.setPosition(0, (this.boardTop + this.boardBottom) / 2);
    this.view = host.addComponent(BoardView);

    this.dialog = this.mount('Dialog', GameDialog);
    this.toast = this.mount('Toast', ToastLayer);
    this.audio = this.mount('Audio', GameAudio);
    this.guide = this.mount('Guide', GuideBar);
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

  update(dt        )       {
    this.hud?.tick(dt);
  }

  /**
   * 纵向排版：顶部让出状态栏 + 微信胶囊那一行（返回键放这一行），
   * 下面依次是 HUD 行、星线行；底部是底栏 + 操作提示；中间全给棋盘。
   * 长屏手机（可视高 > 1920）多出来的高度自然落到棋盘区，棋盘居中。
   */
          measureLayout()       {
    const H = screenH();
    const ins = screenInsets();
    const hudY = ins.contentTop - 112;
    const goalY = hudY - 172;
    const footerY = ins.bottom + 58;
    const hintY = footerY + 104;
    this.L = { W: DESIGN_W, H, navY: ins.navY, hudY, goalY, hintY, footerY };
    this.boardTop = goalY - 66;
    this.boardBottom = hintY + 40;
  }

          mount                     (name        , cls             )    {
    const n = new Node(name);
    n.parent = this.node;
    n.layer = Layers.Enum.UI_2D;
    n.addComponent(UITransform).setContentSize(DESIGN_W, screenH());
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
    this.daily = false;
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

  /**
   * 每日挑战（2026-10-27 评审 P1-6，核心/retention.ts）：
   * 日期作种子固定开局、不耗体力、不写关卡进度 / 断点、不能续命；每天最多 3 次，当天首次通关送体力。
   * 返回是否开成（次数用完 false，已 toast）。
   */
  startDaily()          {
    const r = GS.meta.retention;
    if (!startDailyPlay(r, Date.now())) {
      this.toast.show(DAILY.noPlays, 2400);
      return false;
    }
    GS.markDirty();
    // 正常关卡的断点与每日挑战不共存：同「换了关」一样作废
    const s = GS.session;
    if (s) {
      GS.setSession(null);
      this.toast.show(SAVE.discarded(s.level), 1800);
    }
    this.daily = true;
    this.beginLevel(dailyLevel(dayKeyOf(Date.now())), null);
    return true;
  }

  /** 每日挑战结算：只记今日最好 + 首次通关体力，不碰关卡进度 / 排行 / 云同步 */
          finishDaily(outcome              )       {
    const r = GS.meta.retention;
    const now = Date.now();
    const cleared = starsFor(outcome.score, outcome.star1, outcome.star2, outcome.star3) >= 1;
    const first = finishDailyPlay(r, now, cleared, outcome.points);
    if (first && GS.gainStamina(DAILY_CLEAR_STAMINA)) this.toast.show(DAILY.firstClear(DAILY_CLEAR_STAMINA), 2600);
    GS.markDirty();
    GS.flush();
    track('level_end', {
      level: outcome.level, mode: 'daily', result: cleared ? 'win' : 'fail',
      stars: cleared ? 1 : 0, groups: outcome.score, time_left: 0, revived: false,
    });
    this.audio.play(cleared ? 'win' : 'fail');
    const left = dailyPlaysLeft(r, now);
    // 日榜（2026-10-27 服务端 /daily/result）：异步上报，回来后 toast 名次；离线 / 失败静默
    // 服务端回访接口没部署时不调（release.ts SERVER_RETENTION_API），免得控制台报 404
    const cloud = SERVER_RETENTION_API ? cloudSync() : null;
    if (cloud && outcome.points > 0) {
      void cloud.api('POST', '/game/api/daily/result', { day: dayKeyOf(now), score: outcome.points }).then((res) => {
        const rank = Number(res?.myRank);
        const total = Number(res?.total);
        if (Number.isFinite(rank) && rank > 0) this.toast.show(DAILY.boardRank(rank, Number.isFinite(total) ? total : rank), 3000);
      });
    }
    this.dialog.show(
      DAILY.resultTitle,
      [cleared ? DAILY.cleared : DAILY.failed, DAILY.resultLine(outcome.points, r.dailyBest), DAILY.playsLeft(left), cloud ? '' : DAILY.boardOffline].filter(Boolean),
      [
        { text: DAILY.back, onClick: () => this.exitToHome() },
        { text: DAILY.again, onClick: () => this.restart(), primary: true, disabled: left <= 0 },
      ],
    );
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
    // （levelIndex 先改：换皮回调重建 HUD 时要读到新关号）
    // 每日挑战一律按简单模式的配置（所有人同一盘，与玩家当前模式无关）
    const cfgs = buildLevelConfigs(this.daily ? 'normal' : (from?.mode ?? GS.mode));
    this.cfg = cfgs[level - 1] ?? cfgs[0] ;
    this.levelIndex = level;
    setThemeForLevel(level);
    this.hud?.setLevel(this.daily ? DAILY.label : MODE_LABEL[from?.mode ?? GS.mode], level);

    if (from) {
      this.rng = Rng.restore(from.rngState);
      this.levelSeed = from.seed;
      this.engine = new PuzzleEngine(this.cfg, this.rng, {
        cells: from.cells,
        score: from.score,
        eliminations: from.eliminations,
      });
      this.timeLeft = resumeTimeLeft(from, Date.now());
      // 离线流逝的秒数不算进速度分间隔：基准跟着剩余时间一起扣（不超过原基准）
      this.tally = { points: from.points, lastTimeLeft: Math.min(from.lastTimeLeft, from.lastTimeLeft - (from.timeLeft - this.timeLeft)) };
      this.revived = from.revived;
      this.revivedUsed = from.revivedUsed;
      this.swapMisses = from.swapMisses;
      this.eliminatedOnce = from.eliminatedOnce;
      this.started = from.started;
    } else {
      // 入场计费（§12.4 第一步）；每日挑战不耗体力
      const pre = this.daily ? { ok: true          } : GS.preDeduct();
      if (!pre.ok) {
        // 已经预扣过说明上一局没走完退出流程，这里把那颗退回去再重扣，不让玩家白花
        if (pre.reason === 'already-pending') {
          GS.refundStamina();
          const again = GS.preDeduct();
          if (!again.ok) { track('stamina_empty', { level }); this.toast.show(HOME.staminaShort, 2600); return; }
        } else {
          track('stamina_empty', { level });
          this.toast.show(HOME.staminaShort, 2600);
          return;
        }
      }
      // 每日挑战：日期作种子，同一天所有人、每一次都是同一盘
      this.levelSeed = this.daily ? dailySeed(dayKeyOf(Date.now())) : Date.now() % 0xffffffff;
      this.rng = new Rng(this.levelSeed);
      this.engine = new PuzzleEngine(this.cfg, this.rng);
      this.timeLeft = this.cfg.timeLimit;
      this.tally = createTally(this.timeLeft);
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
      if (!this.daily) GS.confirmStamina();
      track('level_start', { level, mode: this.daily ? 'daily' : GS.mode });
    }

    this.syncSession();
    GS.flush();
    this.updateHud();
    this.schedule(this.onTick, 1);
    // 首次进关弹三步视觉指引（落盘记住，之后不再弹）；它关掉之后才出引导条第 1 步
    if (this.isClassic) { if (level === 1) this.webGuide('swap'); }
    else showThemeGuideOnce(this.node, () => this.runGuide(1));

    if (from) {
      this.toast.show(SAVE.resumed(from.level, fmtMMSS(this.timeLeft), this.started), 2600);
    }
  }

          get isClassic()          {
    return currentTheme().id === 'classic';
  }

          layout()       {
    const rows = this.cfg.rows;
    const cols = this.cfg.cols;
    this.placeBoardHost();
    let cell        ;
    if (this.isClassic) {
      // web 原型：横向铺满金边内沿（BOARD_FILL × 屏宽），纵向受棋盘区高度限制
      const wl = webLayout();
      const byW = (WEB_BOARD_FILL * DESIGN_W - GAP * (cols - 1)) / cols;
      const maxW = (wl.innerW - 2 - GAP * (cols - 1)) / cols;
      const maxH = (wl.boardTop - wl.boardBottom - 2 - GAP * (rows - 1)) / rows;
      cell = Math.max(36, Math.floor(Math.min(byW, maxW, maxH)));
    } else {
      // 底板外边距 + 碎片白边都在格子外面，按它们扣掉
      const frame = BoardView.PAD + BoardView.EDGE;
      const availW = DESIGN_W - 2 * (BOARD_SIDE + frame);
      const availH = this.boardTop - this.boardBottom - 2 * frame;
      cell = Math.min(CELL_MAX, Math.floor(Math.min((availW - GAP * (cols - 1)) / cols, (availH - GAP * (rows - 1)) / rows)));
    }
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
      if (this.isClassic && this.swapMisses >= 2) {
        this.webGuide('hint4');
        this.showHint();
      }
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
    // 每消一组记一次排行分（基础 100 + 速度分），飘字显示这一组得了多少
    const gained = outcome.score > before ? addElimination(this.tally, this.timeLeft) : 0;
    this.playResolution(outcome, gained);
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
            // 第 1 关（classic）HUD 是「组数 / 1★ 线」翻牌，飘 +1；主题关飘本组排行分
            if (gained > 0) {
              // 速度分占满额的比例 → 飘字热度（评审 P2-1）
              const heat = (gained - SCORE_RULE.base) / SCORE_RULE.speedMax;
              this.view.floatScore(st.eliminatedCells[0] ?? 0, this.isClassic ? '+1' : `+${gained}`, st.eliminatedCells, heat);
            }
            this.chainCount++;
            if (this.chainCount >= 2 && !this.isClassic) showComboWord(this.node, this.chainCount, this.boardTop - 200);
            this.updateHud();
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
    this.chainCount = 0;   // 本轮连锁结束
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
      points: this.tally.points,
      star1: this.cfg.star1,
      star2: this.cfg.star2,
      star3: this.cfg.star3,
      revived: this.revived,
    };
    // 每日挑战：不续命、不写关卡进度，单独结算
    if (this.daily) {
      this.finishDaily(outcome);
      return;
    }
    const before = recordOf(GS.progress, this.levelIndex);
    const settlement = settleLevel(outcome, before);

    if (!settlement && !this.revivedUsed && !this.offlineSettle) {
      this.pendingOutcome = outcome;
      this.showReviveDialog();
      return;
    }
    track('level_end', {
      level: outcome.level, mode: GS.mode, result: settlement ? 'win' : 'fail',
      stars: settlement ? settlement.stars : 0, groups: outcome.score,
      time_left: Math.max(0, Math.round(this.timeLeft)), revived: outcome.revived,
    });
    if (settlement) {
      const next = commitSettlement(GS.progress, outcome, settlement, TOTAL_LEVELS);
      const after = recordOf(next, this.levelIndex);
      // 结算前后的奖励快照（金卡 / 章节宝箱，评审 P0-4）：都从进度派生，比一下就知道这局新拿了什么
      const snap = () => {
        const n = GS.data.progress.normal;
        const h = GS.data.progress.nightmare;
        return { normal: n, nightmare: h, owned: unlockedImageIds(n, h).length };
      };
      const rewardsBefore = snap();
      GS.setProgress(next);
      const earned = newlyEarned(rewardsBefore, snap());
      for (const c of earned.chests) this.toast.show(HOME.chestGain(c.name), 3200);
      if (earned.gold > 0) this.toast.show(HOME.goldGain(earned.gold), 2600);
      // 首次 3★ 返还本局体力 1 颗（评审 P1-5）；满格时 gainStamina 返回 false，不提示
      if (settlement.refundStamina && GS.gainStamina(1)) this.toast.show(HOME.staminaRefund, 2200);
      GS.flush();
      // 结算落盘后把最新总分/星数报给微信托管 KV（好友榜数据源；非微信 no-op）
      syncFriendRank();
      // 云端结算上报（v1 仅简单模式：后端关卡守卫会拒困难模式的偏移关号，见 cloud.ts 头注释）。
      // 失败进离线队列，下次启动补传；不挡本地流程
      if (REPORT_MODES.includes(GS.mode)) {
        void cloudSync()?.report({
          // 上报排行分（2026-10-27）；cloud.ts 带上 scoreUnit:'points'，服务端据此不再 ×100
          level: outcome.level, win: true, stars: settlement.stars, score: outcome.points,
          mode: GS.mode, revived: outcome.revived,
        });
      }
      // 之后右上角转发变成挑战式文案，卡片带关卡号（评审 P2-2）
      setShareChallenge(this.levelIndex, settlement.stars);
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
    // 没上榜时写明原因（评审 P1-2）：玩家最常问的就是「为什么我的分没进排行」
    const offBoard = outcome.revived ? PANEL.offBoardRevived : settlement.stars < 3 ? PANEL.offBoardStars : '';
    if (offBoard) this.toast.show(`💡 ${offBoard}`, 3000);

    if (this.isClassic) {
      this.showWebHonor(honor, settlement.stars);
      return;
    }

    // 累计 = 总积分（与排行榜同一口径，核心/rank.ts）
    const total = rankTotals(GS.data.progress.normal, GS.data.progress.nightmare).total;
    showThemeWin(this.node, {
      stars: settlement.stars,
      score: outcome.points,
      stickers: this.engine.eliminations,
      totalScore: total,
      isNewBest: boardBest === outcome.points && outcome.points > 0,
      level: this.levelIndex,
      modeLabel: MODE_LABEL[GS.mode],
      shareText: SHARE.btn,
    }, {
      onNext: () => this.nextLevel(),
      onBack: () => this.exitToHome(),
      // 「挑战好友」（评审 P2-2）：点了不关弹窗，非微信给提示
      onShare: () => { if (!shareChallengeNow()) this.toast.show(SHARE.na, 2000); },
    });
  }

  /**
   * 第 1 关通关吊牌（web showHonorDialog 同口径）：
   *   超神 👑 —— 下一关 /（再战本关、查看排行榜）；王者 🏆 / 优秀 ⭐ —— 下一关 / 再战本关。
   *   分数 = 本模式本关历史最高分，标签「简单分数 / 困难分数」。
   */
          showWebHonor(honor                                  , stars        )       {
    const tier = honor.tier;
    const H = WEB_HONOR;
    const title = tier === 'god' ? H.god.title : tier === 'king' ? H.king.title : H.pass.title;
    const desc = tier === 'god' ? H.god.desc : tier === 'king' ? H.king.desc(honor.percentText) : H.pass.desc(stars);
    const sub = tier === 'god' ? H.god.sub(honor.stats.rank) : tier === 'king' ? H.king.sub : H.pass.sub;
    const hasNext = this.levelIndex < TOTAL_LEVELS;
    const next            = hasNext
      ? { label: H.btnNext, primary: true, onClick: () => this.nextLevel() }
      : { label: H.btnHome, primary: true, onClick: () => { this.toast.show(H.lastLevelToast, 2600); this.exitToHome(); } };
    const retry = this.costButton(H.btnRetry, H.noStamina, () => this.restart());
    const rows                = [[next]];
    if (tier === 'god') {
      const best = recordOf(GS.progress, this.levelIndex).boardBest;
      rows.push([retry, { label: H.btnLeaderboard, onClick: () => this.showBoardDialog(best) }]);
    } else {
      rows.push([retry]);
    }
    // 第 1 关原样式吊牌：「挑战好友」并进最后一行（点了会关吊牌，分享后玩家回到地图前仍在结算页）
    rows[rows.length - 1] .push({ label: SHARE.btn, onClick: () => { if (!shareChallengeNow()) this.toast.show(SHARE.na, 2000); } });
    if (this.levelIndex === 1) this.webGuide('clear');
    showWebResult(this.node, {
      mode: 'win',
      icon: tier === 'pass' ? undefined : H[tier].icon,
      stars: tier === 'pass' ? stars : undefined,
      title,
      sub: desc,
      scoreLabel: webScoreLabel(MODE_LABEL[GS.mode]),
      score: recordOf(GS.progress, this.levelIndex).personalBest,
      hint: sub,
      rows,
      onHome: () => this.exitToHome(),
      toast: (t) => this.toast.show(t, 2600),
    });
  }

  /** 要扣体力的按钮：体力为 0 时置灰（仍可点，点了提示）—— web costButton */
          costButton(label        , hint        , run            )            {
    return { label, dim: GS.stamina.available <= 0, disabledHint: hint, onClick: run };
  }

  /** 第 1 关「看广告 +2 体力」（失败吊牌上的次按钮），看完把失败吊牌还回去 */
          watchStaminaAd(back            )       {
    if (GS.stamina.available >= GS.staminaMax) { this.toast.show(ADS.staminaFull, 1800); back(); return; }
    if (GS.adStaminaLeft <= 0) { this.toast.show(ADS.dailyLimit, 2600); back(); return; }
    this.toast.show(ADS.playing, 1200);
    showRewardedAd('stamina', (r) => {
      if (r === 'ended') {
        GS.recordAd();
        if (GS.gainStamina(AD_STAMINA_GAIN)) this.toast.show(HOME.staminaGain(GS.stamina.available, GS.staminaMax), 2200);
      } else {
        this.toast.show(r === 'closed' ? ADS.notEnded : ADS.notReady, 2200);
      }
      back();
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

  /** 最终失败（续命已用 / 离线超时）—— 只给「再来一局 / 回地图」 */
          showFailDialog(outcome              )       {
    if (this.isClassic) {
      // web showFailDialog：💡 + 差一点就成功了 + 分数卡 + 还差 N 组；重试 / 看广告+1体力 / 返回主页
      const gap = Math.max(1, outcome.star1 - outcome.score);
      const detail           = [WEB_FAIL.gap(gap)];
      if (this.revivedUsed) detail.push(`💡 ${WEB_FAIL.reviveUsed}`);
      if (this.offlineSettle) detail.push(`💡 ${WEB_FAIL.offline}`);
      const build = ()       => {
        showWebResult(this.node, {
          mode: 'lose',
          icon: '💡',
          title: WEB_FAIL.title,
          scoreLabel: webScoreLabel(MODE_LABEL[GS.mode]),
          score: recordOf(GS.progress, this.levelIndex).personalBest,
          note: detail.join('   '),
          rows: [
            [{ ...this.costButton(WEB_FAIL.btnRetry, WEB_HONOR.noStamina, () => this.restart()), primary: true }],
            [
              { label: WEB_FAIL.btnAdStamina, onClick: () => this.watchStaminaAd(build) },
              { label: WEB_FAIL.btnHome, onClick: () => this.exitToHome() },
            ],
          ],
          onHome: () => this.exitToHome(),
          toast: (t) => this.toast.show(t, 2600),
        });
      };
      build();
      return;
    }
    const need = Math.max(0, this.cfg.star1 - outcome.score);
    showThemeFail(this.node, { need, canRevive: false, reviveSec: reviveSecondsFor(this.levelIndex) }, {
      onRevive: () => {},
      onGiveUp: () => this.exitToHome(),
      onRetry: () => this.restart(),
    });
  }

  /**
   * 未达星线、还能续命 —— 失败页带续命入口（10 秒倒计时，走完视同放弃）。
   * 10-25 修：原来 need 恒传 0，文案显示「就差 0 分」。
   */
          showReviveDialog()       {
    if (this.isClassic) {
      // web showReviveDialog：⏰ 时间到 / 要再试一次吗？/ 分数卡 + 还差 N 组就能通关；看广告 +1分钟 / ❌ 放弃
      const o = this.pendingOutcome;
      const gap = Math.max(1, this.cfg.star1 - (o?.score ?? this.engine.score));
      showWebResult(this.node, {
        mode: 'lose',
        icon: '⏰',
        title: WEB_REVIVE.title,
        sub: WEB_REVIVE.ask,
        scoreLabel: webScoreLabel(MODE_LABEL[GS.mode]),
        score: recordOf(GS.progress, this.levelIndex).personalBest,
        hint: WEB_REVIVE.gap(gap),
        rows: [
          [{ label: WEB_REVIVE.btnAd, primary: true, onClick: () => this.watchRevive() }],
          [{ label: WEB_REVIVE.btnGiveUp, onClick: () => this.giveUp() }],
        ],
        onHome: () => this.exitToHome(),
        toast: (t) => this.toast.show(t, 2600),
      });
      return;
    }
    const o = this.pendingOutcome;
    const need = Math.max(0, this.cfg.star1 - (o?.score ?? this.engine.score));
    showThemeFail(this.node, { need, canRevive: true, reviveSec: reviveSecondsFor(this.levelIndex) }, {
      onRevive: () => this.watchRevive(),
      onGiveUp: () => this.giveUp(),
      onRetry: () => this.restart(),
    });
  }

  /**
   * 广告续命：看完才续（ads.ts；非微信 / 未配广告位时本地模拟 1.2 秒）。
   * 续命额度与加体力分开计数（2026-10-26 评审 P0-2）。
   */
          watchRevive()       {
    // 有续命券（签到 / 回流礼包送的）先用券，不用看广告
    if (useReviveTicket(GS.meta.retention)) {
      GS.markDirty();
      this.toast.show(TICKET.used(GS.meta.retention.reviveTickets), 2000);
      this.revive();
      return;
    }
    if (GS.adReviveLeft <= 0) {
      // 弹窗已经关了：不能停在一个既没结算也没弹窗的盘面上，按最终失败处理
      this.toast.show(ADS.reviveLimit, 2600);
      this.giveUp();
      return;
    }
    this.toast.show(ADS.playing, 1200);
    this.busy = true;
    showRewardedAd('revive', (r) => {
      this.busy = false;
      if (r === 'ended') {
        GS.recordAdRevive();
        this.revive();
        return;
      }
      // 没看完 / 没拉到：不扣次数，把续命弹窗还回去让玩家再选
      this.toast.show(r === 'closed' ? ADS.notEnded : ADS.notReady, 2200);
      this.showReviveDialog();
    });
  }

          revive()       {
    this.revived = true;
    this.revivedUsed = true;
    this.finished = false;
    this.pendingOutcome = null;
    // 续命加时按关段取值（main 规则 +60 / +90 / +120）；计分侧同步记一笔（评审分支的速度分口径）
    const reviveSec = reviveSecondsFor(this.levelIndex);
    this.timeLeft += reviveSec;
    onRevive(this.tally, reviveSec);
    this.setPaused(false);
    this.syncSession();
    GS.flush();
    this.schedule(this.onTick, 1);
    this.toast.show(this.isClassic ? WEB_REVIVE.granted : REVIVE.gained(reviveSecondsFor(this.levelIndex)), this.isClassic ? 2600 : 1800);
  }

  /** 放弃续命 → 出最终失败页（再来一局 / 回地图） */
          giveUp()       {
    const o = this.pendingOutcome;
    this.pendingOutcome = null;
    this.audio.play('fail');
    if (o) this.showFailDialog(o);
    else this.exitToHome();
  }

  /* ================================================================ 关卡流转 */

          restart()       {
    // 每日挑战「再来一次」要扣当天次数，走同一个入口
    if (this.daily) {
      if (!this.startDaily()) this.exitToHome();
      return;
    }
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
    if (!this.finished) {
      track('level_end', { level: this.levelIndex, mode: GS.mode, result: 'quit', stars: 0, groups: this.engine?.score ?? 0, time_left: Math.max(0, Math.round(this.timeLeft)), revived: this.revived });
      GS.refundStamina();
    }
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
    if (this.webHud) {
      if (this.engine) this.webHud.update(this.engine.score, this.cfg.star1, this.timeLeft);
      return;
    }
    if (!this.hud || !this.engine) return;
    this.hud.update({
      score: this.engine.score,
      points: this.tally.points,
      lines: [this.cfg.star1, this.cfg.star2, this.cfg.star3],
      timeLeft: this.timeLeft,
      timeLimit: this.cfg.timeLimit,
      stamina: GS.stamina.available,
      staminaMax: GS.staminaMax,
    });
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

  /**
   * 主题落地：全屏背景 + HUD（themeHud.ts 按主题三套排版）+ 棋盘（底板 / 碎片底卡 / 融合环）。
   * 首次 onLoad 调一次，之后每次换主题调一次 —— 只换皮，引擎与盘面数据不动。
   */
          applyThemeVisuals()       {
    if (this.bgNode?.isValid) this.bgNode.destroy();
    this.bgNode = null;
    this.hud?.destroy();
    this.hud = null;
    this.webHud?.destroy();
    this.webHud = null;
    this.view.floatTarget = null;
    this.guide.setWeb(this.isClassic);
    if (this.isClassic) {
      // 第 1 关：web 原型（奶油底 + 深蓝金边卡片 + 天空蓝计分条），没有提示键（web 改为拖错两次自动圈出）
      this.webHud = new WebHud(this.node, () => this.exitToHome());
      this.webHud.root.setSiblingIndex(0);
      this.guide.setY(-screenH() / 2 + 300 + 65);
      this.rebuildBoard();
      this.bindFloatTarget();
      this.updateHud();
      return;
    }
    this.guide.setY(this.L.hintY + 30);
    this.bgNode = buildThemeBg(this.node, DESIGN_W, this.L.H);
    this.hud = new ThemeHud(this.node, this.L, {
      onBack: () => this.exitToHome(),
      onHint: () => this.showHint(),
    });
    // HUD 在棋盘之下、弹窗 / 提示条之上（棋盘拖动时的碎片要盖住 HUD 阴影）
    this.hud.root.setSiblingIndex(1);
    this.hud.setLevel(MODE_LABEL[GS.mode], this.levelIndex);
    this.rebuildBoard();
    this.updateHud();
  }

  /** web 原型的得分飘字要真的落到 HUD 分数上（落点 = 分数面板中心，换算到棋盘本地坐标） */
          bindFloatTarget()       {
    if (!this.webHud) return;
    const a = this.webHud.scoreAnchor;
    const host = this.view.node.getPosition();
    this.view.floatTarget = new Vec3(a.x - host.x, a.y - host.y, 0);
    const hud = this.webHud;
    this.view.onFloatLand = () => hud.bump();
  }

  /** 棋盘宿主节点的位置 / 尺寸：原样式固定区域，三主题按排版算 */
          placeBoardHost()       {
    const wl = this.isClassic ? webLayout() : null;
    const top = wl ? wl.boardTop : this.boardTop;
    const bottom = wl ? wl.boardBottom : this.boardBottom;
    const n = this.view.node;
    n.getComponent(UITransform) .setContentSize(DESIGN_W, top - bottom);
    n.setPosition(0, (top + bottom) / 2);
  }

  /**
   * 按当前主题重排并重建棋盘视图（换主题用）；尚未开局时跳过。
   * 原样式与三主题的格子尺寸 / 棋盘区不同，所以走 layout() 整盘重排。
   */
          rebuildBoard()       {
    if (!this.boardSpec || !this.engine) return;
    // 进关换皮时 cfg 已是新关、engine 还是上一关：盘面尺寸对不上就不重放（beginLevel 随后会整盘重建）
    if (this.engine.board.size !== this.cfg.rows * this.cfg.cols) return;
    this.layout();
    this.view.setCells(this.engine.board.toArray());
    this.view.applyMerge(computeMergeDisplay(this.engine.board));
    this.bindFloatTarget();
  }

  /* ================================================================ 引导（§14 五步） */

  /**
   * 第 1 关的引导按 web 原型走（文案 / 时机同 web main.ts 的 showGuide）：
   * swap 进关 → hint4 拖错两次 → eliminate 首次消除 → refill 首次补位 → clear 首次通关（走完落盘）。
   */
          webGuide(step                        )       {
    if (GS.guideDone || this.webGuideSeen.has(step)) return;
    this.webGuideSeen.add(step);
    track('guide_step', { step });
    this.guide.show(WEB_GUIDE[step]);
    if (step === 'clear') GS.finishGuide();
  }
          webGuideSeen = new Set        ();

          runGuide(step        )       {
    if (this.isClassic) {
      if (step === 4) this.webGuide('eliminate');
      else if (step === 5) this.webGuide('refill');
      return;
    }
    if (GS.guideDone || step <= this.guideStep) return;
    this.guideStep = step;
    const text = [GUIDE.step1, GUIDE.step2, GUIDE.step3, GUIDE.step4, GUIDE.step5][step - 1];
    if (!text) return;
    track('guide_step', { step });
    this.guide.show(text);
    if (step >= 5) GS.finishGuide();
  }

  /* ================================================================ 存档 */

          syncSession()       {
    // 每日挑战不落断点：切后台回来就是新的一局（不耗体力，丢了也不心疼；断点会和正常关卡串）
    if (!this.engine || this.finished || this.daily) return;
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
      points: this.tally.points,
      lastTimeLeft: this.tally.lastTimeLeft,
      savedAt: Date.now(),
    };
    GS.setSession(s);
  }
}

function COLLECTION_PROGRESS(n        )         {
  return `已收集 ${n} / 36`;
}
