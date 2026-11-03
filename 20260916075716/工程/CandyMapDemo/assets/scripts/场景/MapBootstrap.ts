import {
  _decorator, Component, Node, Graphics, UITransform, Color, ScrollView, Mask, view, Layers,
  Size, Label, ResolutionPolicy, HorizontalTextAlignment, VerticalTextAlignment, Sprite,
  SpriteFrame, resources, Font, tween, Vec3, EventTouch, Canvas, Camera,
} from 'cc';
import { LevelNode } from './LevelNode';
// 注意：界面 / 玩法 / 核心 是 `scripts/` 下的**兄弟目录**，不是 `场景/` 的子目录
import { HomeHUD } from '../界面/HomeHUD';
import { preloadUiFont } from '../界面/fontUtil';
import { LevelPreview, type LevelMode } from '../界面/LevelPreview';
import { CollectionScreen } from '../界面/CollectionScreen';
import { PreviewScreen } from '../界面/PreviewScreen';
import { SettingsScreen } from '../界面/SettingsScreen';
import { LeaderboardScreen } from '../界面/LeaderboardScreen';
import { challengeState, type LeaderboardView } from '../界面/leaderboardModel';
import { TutorialDrawer } from '../玩法/tutorial';
import { GameBootstrap } from '../玩法/GameBootstrap';
// 音效单例（WebAudio 合成，与 web/ui/audio.ts 同口径）：首页没有 Game 节点，
// 播放器只在关卡层挂着的话，地图页的点击就解不了锁 —— Web 版是一个全局 audio。
import { sfx } from '../玩法/sfx';
import { speech } from '../玩法/speech';
import { GameDialog } from '../玩法/GameDialog';
import { ToastLayer } from '../玩法/toast';
import { GS } from '../玩法/state';
import { HOME, ADS, SHARE, COLLECTION, SETTINGS, TUTORIAL, MAP } from '../玩法/text';
import { STAMINA_PER_AD } from '../平台/ads';
import {
  adDenyText, playAd, setMenuShare, setPlatformToast, shareCard, startTracking,
} from '../玩法/platformBridge';
import { unlockedImageIds, clearedCount, totalStars, COLLECTION_TOTAL } from '../玩法/meta';
import { levelStatus, recordOf, buildLevelConfigs, boardSnapshot, type GameMode, TOTAL_LEVELS } from '../核心/index';
// 世界表 / 路中线全部在 worlds.ts（15 世界 × 12 关 = 180 关），本文件只按结果摆节点
import { WORLDS, levelsOfWorld, roadPoint, worldIndexOf, worldArtAsset } from './worlds';
// 底图固定走本地 resources（Web 口径：`/web/art/map-v2/*.jpg` 是静态本地图）
const { ccclass } = _decorator;

const DESIGN_W = 1080;
const DESIGN_H = 1920;
const MAP_H = 3840;            // 每个世界一张底图 1080×3840（手机 2 屏，完整高度）
const LEVEL_COUNT = TOTAL_LEVELS;   // 180 关（核心层 TOTAL_LEVELS，地图按世界分段渲染）

/**
 * 上下留白 —— 与 Web 同口径（web/ui/map.ts 的 PAD_TOP 755 / PAD_BOTTOM 472 是**轨道坐标**，
 * 乘 fitScale = 1080/1536 = 0.703125 落到 1080 宽的图上）：
 *   PAD_TOP    = 755 × 0.703125 ≈ 531   —— 顶边到第 12 关（本世界最后一关）
 *   PAD_BOTTOM = 472 × 0.703125 ≈ 332   —— 第 1 关到底边
 * 这两段留白在**图内**（不是额外加的滚动空白），所以内容高度就是图高本身，
 * 页面数 = 3840 / 1920 = 2 屏，与 Web 的 `pageOfY()` 一致。
 */
const PAD_TOP = 531;
const PAD_BOTTOM = 332;
const CONTENT_H = MAP_H;
/** 一屏高（翻页步长）：内容 3840 恰好 2 屏 */
const PAGE_H = 1920;
const PAGES = 2;
/** 翻页物理参数（web/ui/map.ts 同名常量） */
const MAX_FLING = 64;      // 单帧最大甩动速度
const FLING_PROJECT = 14;  // 松手后按速度外推的帧数
const CLICK_SLOP = 14;     // 超过这个位移就算拖动，不再当成点击
const SNAP_MS = 420;       // 吸附时长（easeOutCubic）
const FLIP_OUT_MS = 280;   // 换世界：翻出
const FLIP_IN_MS = 420;    // 换世界：翻入

/**
 * ⚠️ 风车 / 湖面 / 角色这 3 个浮层（w1_windmill / w1_water / w1_bear）已按 2026-10-31 的要求删除：
 * 它们是 Cocos 端自己加的动效层，Web 版首页没有，且会一直挂在 tick 上做动画。
 * 地图现在只有「静态底图 + 关卡珠」两层。
 */

/**
 * ⚠️ 关卡坐标**不再写在这里** —— 15 个世界的路中线搬到了 `worlds.ts`（`ROAD_X` 归一化表）。
 * 之前这张 `W1_LEVEL_XY` 是 10 关的临时值，且与 Web 版不是同一套标定；
 * 现在按 `roadPoint(level)` 取，换底图/校正路中线只改 `worlds.ts` 那张表。
 */

/**
 * 水晶果冻球的**素球**贴图（2026-10-31 起三态只用这一张，颜色由 `LevelNode` 按星级着色）。
 * ⚠️ 不再用 star1 / star3 两张成品色贴图：用户口径改成「粉 / 紫 / 金」三色分别代表
 * 未过关 / 1~2 星 / 3 星，用统一素球着色才能保证三态只差颜色这一件事。
 * （更早的 `level_balloon_1~10` 那 10 个贴图**从来就不存在**，早已废弃。）
 */
// ⚠️ 这里原本有 `const BEADS = { plain: 'map/node/node-todo' }`，已删除：
//    三张关卡珠贴图（`node-todo / node-star1 / node-star3`）由 `LevelNode.paintArt()`
//    按**星级**自行挑选，这里不再预铺任何默认图。
/** 节点盒初值；真实大小由 `LevelNode.init()` 按星级重算（142.1 / 180.5 / 215.5） */
const NODE_BOX = 142;

/**
 * 兜底背景层（Web `.map { background: var(--map-sky) }`，web/ui.css:616-621）。
 *
 * ⚠️ Web 是**四段线性渐变**，而且**每 5 个世界换一套**（15 个世界循环 3 轮），
 *    不是「上半天空色 + 下半草地色」两条硬边 —— 之前那种画法会把天地切成两个色块。
 */
const MAP_SKY: Color[][] = [
    // world-0 小镇：#bfe6ff → #e8f7ff → #fff3d6 → #ffe1a8
    [new Color(191, 230, 255, 255), new Color(232, 247, 255, 255), new Color(255, 243, 214, 255), new Color(255, 225, 168, 255)],
    // world-1 果园：#cfe9d2 → #eaf8e4 → #fff2cf → #ffdca0
    [new Color(207, 233, 210, 255), new Color(234, 248, 228, 255), new Color(255, 242, 207, 255), new Color(255, 220, 160, 255)],
    // world-2 滑雪场：#d7d9ff → #eae9ff → #ffe6c9 → #ffd7a0
    [new Color(215, 217, 255, 255), new Color(234, 233, 255, 255), new Color(255, 230, 201, 255), new Color(255, 215, 160, 255)],
    // world-3 海岸线：#aee7f5 → #d9f6fb → #ffefc9 → #ffe0a6
    [new Color(174, 231, 245, 255), new Color(217, 246, 251, 255), new Color(255, 239, 201, 255), new Color(255, 224, 166, 255)],
    // world-4 花海山丘：#cdeec9 → #e9f9e2 → #fff3d0 → #ffddb0
    [new Color(205, 238, 201, 255), new Color(233, 249, 226, 255), new Color(255, 243, 208, 255), new Color(255, 221, 176, 255)],
];
/** 渐变站点的位置（0 = 顶，1 = 底） */
const SKY_STOPS = [0, 0.38, 0.72, 1];

/** 在四段渐变里按位置插值取色（t: 0 = 屏幕顶，1 = 屏幕底） */
function skyColorAt(stops: Color[], t: number): Color {
    let i = 0;
    while (i < SKY_STOPS.length - 2 && t > SKY_STOPS[i + 1]!) i++;
    const a = SKY_STOPS[i]!;
    const b = SKY_STOPS[i + 1]!;
    const k = b > a ? (t - a) / (b - a) : 0;
    const c0 = stops[i]!;
    const c1 = stops[i + 1]!;
    return new Color(
        Math.round(c0.r + (c1.r - c0.r) * k),
        Math.round(c0.g + (c1.g - c0.g) * k),
        Math.round(c0.b + (c1.b - c0.b) * k),
        255,
    );
}

const TEXT_BROWN = new Color(90, 50, 25);
const TEXT_WHITE = new Color(255, 255, 255);

/**
 * 地图启动器 —— 世界1（奶油果园）正式版：真底图 + 真 UI 素材
 * 关卡石台 / 数字 / 星级 / 锁由程序画，小路在底图里（程序不再画藤蔓）
 */
@ccclass('MapBootstrap')
export class MapBootstrap extends Component {
    private content: Node = null!;
    private levels: { level: number; x: number; y: number }[] = [];
    /** 当前显示的世界下标（0 = 小镇）；地图上同时只挂这一个世界的底图与节点 */
    private worldIndex = 0;
    private visibleSize = new Size(0, 0);
    private screenH = DESIGN_H;   // SHOW_ALL 下恒等于 1920（Web #stage 是死尺寸）
    private viewH = 0;

    private levelNodes: LevelNode[] = [];
    private gameNode: Node = null!;   // 玩法层（挂 GameBootstrap），与本节点互为兄弟
    private hud: HomeHUD = null!;     // HUD 层：顶栏 + 换世界箭头 + 翻页 + 底栏（Web 版逐元素重建）
    private diffIndex = 0;   // 0 = 简单，1 = 困难（互斥，必选其一）
    private tabIndex = 0;    // 0 首页 / 1 排行榜 / 2 图鉴 / 3 设置（顺序与 Web 一致）
    /** 翻页：当前页 / 总页数（每个世界 2 屏） */
    private page = 0;
    /** 拖动状态：地图整屏拖动 + 甩动吸附（Web 的 drag/fling/snap 同口径） */
    private drag: {
        active: boolean; startY: number; startOffset: number;
        lastY: number; vel: number; moved: boolean;
    } | null = null;
    // ⚠️ 这里原本有个 `tapSuppressedUntil` 时间戳闸门，已删除：
    //    Web 用状态位 `dragMoved`（本次手势内的持久标志），不是「接下来 220ms 内的点击都屏蔽」，
    //    时间戳口径会误伤刚拖完紧接着点下一颗的正常操作。现在统一看 `this.drag.moved`。

    private dialog: GameDialog = null!;
    private toast: ToastLayer = null!;
    /** 关卡详情吊牌（点「开始游戏」先吊下来，再按 Play 进关） */
    private preview: LevelPreview = null!;
    /** 图鉴整屏 / 大图预览（懒创建：首次点图鉴页签才建） */
    private collection: CollectionScreen = null!;
    private previewScreen: PreviewScreen = null!;
    /** 设置整屏 / 新手教学抽屉（懒创建） */
    private settingsScreen: SettingsScreen = null!;
    private drawer: TutorialDrawer = null!;
    /** 排行榜整屏（懒创建：首次点排行榜页签才建，100 行榜单不该在进地图时就摆一遍） */
    private leaderboard: LeaderboardScreen = null!;

    onLoad() {
        // ⚠️ 适配策略必须吃 Web 口径：**SHOW_ALL**（等比缩放 + 完整显示 + 两侧/上下留边）。
        //    Web 的 `#stage` 是写死的 1080×1920，再由 JS `fitStage()` 等比缩放摆正
        //    （web/index.html:58-65），任何窗口下画面都是完整的 9:16 手机比例。
        //    之前用 FIXED_WIDTH 是错的：它锁宽度、**高度随窗口变**，宽屏时可视高度只剩 ±304，
        //    表现为「画面只有中间一条」、教学 UI（气泡 y=549）整个落到屏幕外。
        view.setDesignResolutionSize(DESIGN_W, DESIGN_H, ResolutionPolicy.SHOW_ALL);
        this.visibleSize = view.getVisibleSize();
        this.screenH = this.visibleSize.height || DESIGN_H;
        this.ensureCamera();   // 打包后场景里的相机绑定会丢，运行时兜底补一台正交 UI 相机
        // 地图与关卡共用一份全局状态；关卡层先启动时会 init 过，这里保证幂等
        if (!GS.readResult) GS.init();
        startTracking();   // 埋点：建身份 + first_open / session_start（幂等）
        // UI 字体：教学/弹窗/气泡等**不走** makeLabel 的文字此前一直用 Cocos 默认字体，
        //    与 Web（PingFang SC / 微软雅黑）不是一套字形。这里开局预读一次，避免首次弹面板时字突然跳。
        void preloadUiFont();
        // 读档后声音开关要真的生效（否则界面上是「关」，耳朵里还在响）—— web/main.ts:479-481
        sfx.setSound(GS.meta.settings.sound);
        sfx.setBgm(GS.meta.settings.bgm);
        // 打包后模块懒执行：onLoad 这一刻 `speech` 可能还没被赋值（GameBootstrap 那侧实测过）
        if (speech) speech.setEnabled(GS.meta.settings.voice);
        // 右上角菜单转发：只有小游戏有这个入口，别的宿主一律 false（这里不弹提示，没入口就当没有）
        setMenuShare(() => ({ title: SHARE.menuTitle, query: 'from=menu' }));
        // 从「已解锁到的那一关」所在世界开局，而不是永远从第 1 世界（否则 180 关要一路翻过去）
        this.worldIndex = worldIndexOf(GS.progress.unlocked);
        this.buildBackdrop();
        this.mountDialogs();
        this.buildLevelPositions();
        this.buildUI();
        this.buildMap();
        this.raiseOverlays();
        // 场景里挂本组件的节点实际叫 Bootstrap，而 GameBootstrap 返回时按 'Map' 查找，
        // 两边名字对不上会造成「进得去、回不来」，这里统一成 Map
        this.node.name = 'Map';
        this.ensureGameNode();
        // 顶栏跟着体力/倒计时走：体力变化由 GS 通知，恢复倒计时由每秒心跳推进
        GS.onMetaChange(() => this.refreshTopbar());
        this.schedule(this.onTick, 1);
    }

    onDestroy() {
        // 场景来回切换时不清订阅会越叠越多
        GS.offMetaChange(() => this.refreshTopbar());
    }

    /**
     * 从关卡返回时重新读一次进度：通关会解锁下一关、星级也会变，
     * 地图不重建就会显示「打完了但还是锁着」。
     */
    onEnable() {
        if (!this.content?.isValid) return;
        this.rebuildLevelNodes();
        this.refreshTopbar();
    }

    /**
     * **UI 相机兜底 —— 打包产物必须有这一段**
     *
     * 场景文件里写了 Canvas + Camera（正交、orthoHeight 960）的绑定，但构建打包后
     * `Canvas.cameraComponent` 这个引用会丢，引擎只剩默认 3D 相机：透视投影、
     * orthoHeight 10、clearColor #333333。而所有 UI 都是按 1080×1920 设计坐标
     * 摆的（坐标动辄几百上千），全落在这台相机的视野之外 —— 症状就是
     * 「控制台干净、场景也加载成功，但屏幕一片灰」。
     *
     * 预览环境（preview/game.html）由 shim 自动补相机，所以一直看不出问题。
     * 这里在运行时把参数补齐：正交投影、正交高度 = 可视高度/2、相机放到可视区中心、
     * 底色换成 Web 首页那片夜空蓝。
     */
    private ensureCamera(): void {
        const canvasNode = this.node.parent ?? this.node;
        const canvas = canvasNode.getComponent(Canvas) ?? canvasNode.addComponent(Canvas);

        // 场景那台相机是直接挂在 **Canvas 节点本身** 上的，位置跟着 Canvas 走，
        // 于是相机和 UI（都在同一坐标系里）永远贴在一起、距离为 0，全被近裁剪面切掉。
        // 这里改成 Cocos 的标准结构：Canvas 留在原点，**相机放到独立子节点、退到 z=1000 往 -Z 看**，
        // UI 节点在 z≈0 → 与相机相距约 1000，正好落在 near(1)~far(2000) 之内。
        const stale = canvasNode.getComponent(Camera);
        if (stale) stale.destroy();

        let camNode = canvasNode.getChildByName('Camera');
        if (!camNode) {
            camNode = new Node('Camera');
            camNode.parent = canvasNode;
        }
        camNode.setPosition(0, 0, 1000);
        const cam = camNode.getComponent(Camera) ?? camNode.addComponent(Camera);
        // ⚠️ Canvas 节点保持在原点，别去移动它：UI 全是它的子节点，一起移等于没动

        // ⚠️ 运行时 cc 命名空间**没有导出** CameraProjection / Camera.ClearFlag 枚举
        // （tsc 能过是因为 d.ts 里有声明，但打包后取不到），只能写数值：
        //    projection: 0 = CameraProjection.ORTHO（1 = PERSPECTIVE，默认值，就是灰屏元凶）
        //    clearFlags: 7 = Camera.ClearFlag.SOLID_COLOR
        cam.projection = 0;
        // 相机要退到 z=1000 处往 -Z 看，UI 都在 z≈0：远裁剪面必须 > 1000，
        // 否则 UI 距离正好等于 far，会被远裁剪面切掉（同样表现为灰屏）
        cam.near = 1;
        cam.far = 2000;
        cam.priority = 1073741824;          // 压在其它相机之上
        cam.visibility = Layers.Enum.UI_2D;  // 只渲染 2D UI 层
        cam.clearFlags = 7;
        // 舞台**之外**的留边色 = Web 版 html/body 的 `background: #2b2419`（web/index.html:26）。
        // 舞台之内由 Backdrop 自己铺（对应 #stage 的 radial-gradient 米白渐变），别在这儿替它决定。
        cam.clearColor = new Color(43, 36, 25, 255);

        // 关键：把打包时丢掉的绑定补回去，Canvas 之后会自己维护它
        canvas.cameraComponent = cam;

        const fit = (): void => {
            cam.orthoHeight = view.getVisibleSize().height / 2;
        };
        fit();
        view.on('design-resolution-changed', fit);
        console.log(
            '[map] ensureCamera: 相机数=' + canvasNode.getComponents(Camera).length +
            ' ortho=' + cam.orthoHeight +
            ' proj=' + cam.projection +
            ' vis=' + cam.visibility +
            ' 可视高度=' + view.getVisibleSize().height,
        );
    }

    // ========== 兜底背景 / 屏幕自适应 ==========
    /** 铺满整屏的底色层：上半天空、下半草地，任何屏幕比例都不露黑 */
    private buildBackdrop() {
        const w = this.visibleSize.width || DESIGN_W;
        const h = this.screenH;
        const bg = new Node('Backdrop');
        bg.parent = this.node;
        bg.layer = Layers.Enum.UI_2D;
        bg.addComponent(UITransform).setContentSize(w, h);
        bg.setPosition(0, 0);

        const g = bg.addComponent(Graphics);
        const halfW = w / 2;
        const halfH = h / 2;
        // Web 是四段渐变（180deg），逐条带插值；条带数只为够平滑，不影响观感
        const stops = MAP_SKY[this.worldIndex % MAP_SKY.length]!;
        const BANDS = 64;
        for (let i = 0; i < BANDS; i++) {
            const yTop = halfH - (h * i) / BANDS;
            const yBot = halfH - (h * (i + 1)) / BANDS;
            g.fillColor = skyColorAt(stops, (i + 0.5) / BANDS);
            g.rect(-halfW, yBot, w, yTop - yBot + 1);
            g.fill();
        }
    }

    /** 贴顶：inset = 元素顶边到屏幕顶边的距离 + 元素半高 */
    private topY(inset: number) { return this.screenH / 2 - inset; }
    /** 贴底：inset = 元素底边到屏幕底边的距离 + 元素半高 */
    private botY(inset: number) { return -this.screenH / 2 + inset; }

    private mountDialogs() {
        const dn = new Node('Dialog');
        dn.parent = this.node;
        dn.layer = Layers.Enum.UI_2D;
        dn.addComponent(UITransform).setContentSize(DESIGN_W, this.screenH);
        this.dialog = dn.addComponent(GameDialog);

        const tn = new Node('Toast');
        tn.parent = this.node;
        tn.layer = Layers.Enum.UI_2D;
        tn.addComponent(UITransform).setContentSize(DESIGN_W, this.screenH);
        this.toast = tn.addComponent(ToastLayer);
    }

    private onTick() {
        GS.tick();
        this.refreshTopbar();
    }

    /** 顶栏：体力数字 + 恢复倒计时（Web：满体力时倒计时是**空串**，不显示「已满」） */
    private refreshTopbar() {
        if (!this.hud) return;
        this.hud.setStamina(String(GS.stamina.available));
        const cd = GS.countdownText();
        this.hud.setCountdown(cd ? HOME.staminaCountdown(cd) : '');
        // 教学按钮隐藏条件：**恒看困难模式**的累计通关数（Web web/main.ts:688-692 写死 nightmare）。
        // ⚠️ 不能拿 GS.progress（那是当前模式这份）——否则简单模式通关 10 关入口就提前消失，
        //    而困难模式通关 10 关了却还在。
        this.hud.setTutorialVisible(clearedCount(GS.progressOf('nightmare')) < GameBootstrap.TUTORIAL_HIDE_AFTER);
    }

    /**
     * 体力 + ：看广告 —— 走 `平台/ads.ts` 的激励视频（批次⑧ 接线）。
     *
     * 与改动前一致的两道闸：**体力已满**不看、**今日额度用完**不看（额度仍由 `GS.adStaminaLeft` 把关，
     * 它是唯一落盘的口径）。真看完（`watched`）才记一次额度并发体力；
     * `skipped` / `failed` 一律不发 —— 与 `平台/ads.ts` 的三分支口径一致。
     */
    private onStaminaPlus() {
        if (GS.stamina.available >= GS.staminaMax) {
            this.toast.show(ADS.staminaFull, 1400);
            return;
        }
        if (GS.adStaminaLeft <= 0) {
            this.toast.show(ADS.dailyLimit, 2200);
            return;
        }
        setPlatformToast((m) => this.toast.show(m, 2000));
        this.toast.show('广告播放中…', 1200);
        void playAd('stamina')
            .then((out) => {
                if (out.result !== 'watched') {
                    this.toast.show(adDenyText(out.reason), 2400);
                    return;
                }
                GS.recordAd();
                if (GS.gainStamina(STAMINA_PER_AD)) {
                    this.toast.show(HOME.staminaGain(GS.stamina.available, GS.staminaMax), 1400);
                }
            })
            .catch(() => this.toast.show(ADS.notReady, 2400));
    }

    /**
     * 关卡坐标：只算**当前世界**的 12 关（15 张 3840 长图同时挂进 content 会爆小游戏内存，
     * 所以地图上永远只有一张底图 + 12 个节点，靠 `switchWorld` 换）。
     */
    private buildLevelPositions() {
        this.levels = [];
        for (const lv of levelsOfWorld(this.worldIndex)) {
            const { x, yFromBottom } = roadPoint(lv);
            this.levels.push({ level: lv, x, y: yFromBottom });
        }
    }

    // ========== 通用小工具 ==========
    /** 免费商用字体：HarmonyOS Sans SC（华为官方免费商用许可） */
    private fontAsset: Font | null = null;

    private applyFont(l: Label) {
        if (this.fontAsset) { l.font = this.fontAsset; return; }
        resources.load('font/HarmonyOS_Sans_SC_Medium', Font, (err, f) => {
            if (err || !f) return;   // 加载失败就用系统默认字体，不阻塞
            this.fontAsset = f;
            l.font = f;
            for (const ln of this.levelNodes) ln.setFont(f);
        });
    }

    private makeLabel(parent: Node, name: string, str: string, x: number, y: number, size: number, color: Color, w = 300, h = 60): Label {
        const n = new Node(name);
        n.parent = parent;
        n.layer = parent.layer;
        n.addComponent(UITransform).setContentSize(w, h);
        n.setPosition(x, y);
        const l = n.addComponent(Label);
        l.string = str;
        l.fontSize = size;
        l.lineHeight = size + 6;
        l.color = color;
        l.horizontalAlign = HorizontalTextAlignment.CENTER;
        l.verticalAlign = VerticalTextAlignment.CENTER;
        this.applyFont(l);
        return l;
    }

    /** 贴图节点：资源从 assets/resources 异步加载，尺寸固定 */
    private makeSprite(parent: Node, name: string, path: string, w: number, h: number, x: number, y: number): Sprite {
        const n = new Node(name);
        n.parent = parent;
        n.layer = Layers.Enum.UI_2D;
        n.addComponent(UITransform).setContentSize(w, h);
        n.setPosition(x, y);
        const sp = n.addComponent(Sprite);
        sp.sizeMode = Sprite.SizeMode.CUSTOM;
        resources.load(path + '/spriteFrame', SpriteFrame, (err, sf) => {
            if (err || !sf) {
                console.warn('[map] 贴图缺失: ' + path);
                return;
            }
            if (sp.isValid) sp.spriteFrame = sf;
        });
        return sp;
    }

    /** 透明热区 */
    private makeHit(parent: Node, name: string, w: number, h: number, x: number, y: number, fn: () => void): Node {
        const n = new Node(name);
        n.parent = parent;
        n.layer = Layers.Enum.UI_2D;
        n.addComponent(UITransform).setContentSize(w, h);
        n.setPosition(x, y);
        n.on(Node.EventType.TOUCH_END, fn, this);
        return n;
    }

    /**
     * 切换难度 = 切换模式（两套进度分别存，切模式不丢）。
     * 只有**关卡吊牌**里才有难度切换 —— Web 版已删掉首页的入口，这里只保留模式切换本身。
     */
    private setDifficulty(i: number) {
        this.diffIndex = i === 1 ? 1 : 0;   // 只能 0 或 1，不能都选 / 都不选
        GS.setMode((this.diffIndex === 1 ? 'nightmare' : 'normal') as GameMode);
        this.rebuildLevelNodes();
    }

    // ========== 地图 ==========
    private buildMap() {
        this.viewH = this.screenH;   // 铺满整屏，顶栏 / 底导航浮在地图之上
        const viewY = 0;

        const scrollNode = new Node('ScrollView');
        scrollNode.parent = this.node;
        scrollNode.layer = Layers.Enum.UI_2D;
        scrollNode.addComponent(UITransform).setContentSize(DESIGN_W, this.viewH);
        scrollNode.setPosition(0, viewY);

        const maskNode = new Node('view');   // Cocos 标准结构：ScrollView > view(Mask) > content
        maskNode.parent = scrollNode;
        maskNode.layer = Layers.Enum.UI_2D;
        maskNode.addComponent(UITransform).setContentSize(DESIGN_W, this.viewH);
        // Mask 默认是 GRAPHICS_STENCIL，靠节点上的 Graphics 取模板形状；
        // 本节点没有 Graphics，模板为空会把整张地图裁掉 —— 必须显式改成矩形裁剪
        // ⚠️ 3.8 的枚举是 `MaskType.GRAPHICS_RECT`（没有 `RECT`，写 `RECT` 是 2.x 口径，TS 会报错）
        const mask = maskNode.addComponent(Mask);
        mask.type = Mask.Type.GRAPHICS_RECT;

        const scroll = scrollNode.addComponent(ScrollView);
        scroll.horizontal = false;
        scroll.vertical = true;
        scroll.inertia = true;
        scroll.brake = 0.5;
        scroll.elastic = true;
        // 默认为 true，滚动相关逻辑会把 content 内部节点（关卡气球）的点击吞掉，
        // 表现就是「气球看得见，点下去毫无反应」
        scroll.cancelInnerEvents = false;

        this.content = new Node('Content');
        this.content.parent = maskNode;
        this.content.layer = Layers.Enum.UI_2D;
        this.content.addComponent(UITransform).setContentSize(DESIGN_W, CONTENT_H);
        this.content.setPosition(0, CONTENT_H / 2 - this.viewH / 2);
        scroll.content = this.content;

        this.createMapBackground();
        this.createLevelNodes();
        this.bindMapDrag(scrollNode);

        // 落在「已解锁到的那一关」所在的那一屏（Web 同口径：pageOfY(当前关)）
        this.scheduleOnce(() => this.snapToPage(this.pageOfLevel(GS.progress.unlocked)), 0.1);
    }

    /** 地图坐标（从底往上量的 y）→ content 局部 y（原点在 content 中心） */
    private localY(yFromBottom: number): number {
        return yFromBottom - CONTENT_H / 2;
    }

    /* ---------------------------------------------------------------- 翻页 / 拖动
     * 与 web/ui/map.ts 同口径：整屏拖动 → 松手甩动外推 → 吸附到最近一屏（420ms easeOutCubic）。
     * 圆柱透视（SPHERE_ON）在 Web 是关的，所以这里也没有缩放/倾斜，只有位移。
     */

    /** 某关在第几屏（0 = 地图上屏）：按「距底边的高度」整除一屏 */
    private pageOfLevel(level: number): number {
        if (!this.levels.length) return 0;
        const idx = Math.min(Math.max(level - 1, 0), this.levels.length - 1);
        const yFromBottom = this.levels[idx]!.y;
        const p = PAGES - 1 - Math.floor(yFromBottom / PAGE_H);
        return Math.max(0, Math.min(PAGES - 1, p));
    }

    /** 把某一屏摆到屏幕正中（无动画） */
    private snapToPage(page: number): void {
        if (!this.content?.isValid) return;
        this.page = Math.max(0, Math.min(PAGES - 1, page));
        this.content.setPosition(0, -PAGE_H / 2 + this.page * PAGE_H);
        this.hud?.setPager(this.page, PAGES);
    }

    /** 吸附动画：420ms easeOutCubic */
    private animateToPage(page: number): void {
        if (!this.content?.isValid) return;
        this.page = Math.max(0, Math.min(PAGES - 1, page));
        const y = -PAGE_H / 2 + this.page * PAGE_H;
        tween(this.content).to(SNAP_MS / 1000, { position: new Vec3(0, y, 0) }, { easing: 'backOut' }).start();
        this.hud?.setPager(this.page, PAGES);
    }

    /**
     * 拖动：绑在卷轴节点上，同时也由关卡节点转发（预览 shim 的触摸只派发给最深的命中节点，
     * 不会冒泡；真引擎会冒泡 —— 两种环境下都靠 `drag` 单一状态去重，所以行为一致）。
     */
    private bindMapDrag(scrollNode: Node): void {
        scrollNode.on(Node.EventType.TOUCH_START, this.onDragStart, this);
        scrollNode.on(Node.EventType.TOUCH_MOVE, this.onDragMove, this);
        scrollNode.on(Node.EventType.TOUCH_END, this.onDragEnd, this);
        scrollNode.on(Node.EventType.TOUCH_CANCEL, this.onDragEnd, this);
    }

    private onDragStart(e: EventTouch): void {
        // 真实手势 → 解锁音频（浏览器要求手势后才能出声）。web/main.ts:3726 挂在全局 pointerdown 上，
        // 这里挂在地图拖动起手（首页最主要的手势）与关卡珠点击（enterLevel）两处，等价覆盖。
        sfx.unlock();
        if (this.drag) return;
        const y = e.getUILocation().y;
        this.drag = {
            active: true, startY: y, startOffset: this.currentOffset(),
            lastY: y, vel: 0, moved: false,
        };
    }

    private onDragMove(e: EventTouch): void {
        const d = this.drag;
        if (!d) return;
        const y = e.getUILocation().y;
        const dy = y - d.lastY;
        d.lastY = y;
        if (Math.abs(y - d.startY) > CLICK_SLOP) d.moved = true;
        // 速度：新位移占 6 成、历史占 4 成（与 Web 的 vel = vel * .6 + (-dy) * .4 同形）
        d.vel = Math.max(-MAX_FLING, Math.min(MAX_FLING, d.vel * 0.6 + dy * 0.4));
        this.applyOffset(d.startOffset + (y - d.startY));
    }

    private onDragEnd(): void {
        const d = this.drag;
        this.drag = null;
        if (!d) return;
        const projected = this.currentOffset() + d.vel * FLING_PROJECT;
        this.animateToPage(Math.round(projected / PAGE_H));
    }

    private currentOffset(): number {
        return (this.content?.isValid ? this.content.position.y : 0) + PAGE_H / 2;
    }

    /** 越界橡皮筋 0.32（Web RUBBER） */
    private applyOffset(v: number): void {
        if (!this.content?.isValid) return;
        const max = (PAGES - 1) * PAGE_H;
        let o = v;
        if (o < 0) o = o * 0.32;
        else if (o > max) o = max + (o - max) * 0.32;
        this.content.setPosition(0, -PAGE_H / 2 + o);
        const near = Math.round(o / PAGE_H);
        if (near !== this.page) { this.page = Math.max(0, Math.min(PAGES - 1, near)); this.hud?.setPager(this.page, PAGES); }
    }

    /**
     * 把浮层按 Web 的 z-index 表排一次（看不见 ack）：
     * 底图(1) → 地图(auto) → HUD(顶栏/底栏 70) → **关卡吊牌(90)** → 弹窗 → Toast。
     *
     * ⚠️ 关卡吊牌必须在这一步里：它是 `buildUI()` 里最早建出来的，排在兄弟序列最前，
     * 不显式提上来就会被后来的地图 / HUD 整块盖住 —— 表现是「点关卡珠没反应」
     * （吊牌其实开了，只是藏在地图底下，看不见也点不到）。
     */
    private raiseOverlays() {
        const order = ['Backdrop', 'ScrollView', 'HUD', 'LevelPreview', 'Dialog', 'Toast'];
        for (const name of order) {
            const n = this.node.getChildByName(name);
            if (n?.isValid) n.setSiblingIndex(this.node.children.length - 1);
        }
    }

    /**
     * 底图：整张静态背景层 1080×3840（每世界一张，`worlds.ts` 的 WORLDS 决定哪张）。
     *
     * ⚠️ `resources/map/*.jpg` 就是 Web 端 `web/art/map-v2/*.jpg` **那一批原图** —— 15 张已逐一比对
     *    MD5 完全相同（这边只是多加了个 `wN_` 前缀），图本身没做错，**不要重画也不要再替换**。
     *    Web 的加载口径就是本地一张静态图：`backgroundImage: url('/web/art/map-v2/{art}.jpg')`
     *    （web/ui/map.ts:755 + :298 的 `MAP_ART_DIR`），没有 CDN、没有占位层、没有加载文案。
     */
    private createMapBackground() {
        this.makeSprite(this.content, 'BgMain', worldArtAsset(this.worldIndex).path, DESIGN_W, MAP_H, 0, this.localY(MAP_H / 2));
    }

    // ⚠️ 这里原本有一整套「远程底图」逻辑（`bgToken` + `makeResolvedSprite` + `makeRemoteSprite`：
    //    纯色占位底 →「底图加载中…」→ 远程图到了替换 / 失败改「底图加载失败」），已删除。
    //    Web 端底图就是本地一张静态图（web/ui/map.ts:755），没有 CDN、没有占位、没有加载文案；
    //    本地模式下那条分支**永远走不到**，只是让「图片来源」多了一条没人验证的路径。
    //    底图现在只走本地 resources，与 `worldArtAsset().path` 一致。

    // ========== 世界切换（15 个世界，地图上同时只驻留一张底图）==========
    /**
     * ⚠️ 原来的「‹ 世界名 关卡区间 ›」切换条已删除 —— Web 版首页没有这条：
     * 换世界只用底栏两侧的 ‹ › 金箭头，世界信息不单独占一行文字。
     */

    /**
     * 切到相邻世界：销毁当前世界的底图/浮层/节点后重建（不保留旧图，省内存）
     *
     * ⚠️ 底图走 CDN 时这里有个时间差：旧图已销毁、新图还没到。
     * 所以 `createMapBackground()` 会先挂占位，迟到的回调由 `bgToken` 判掉 —— 切世界不会白屏。
     */
    private switchWorld(next: number): void {
        const w = Math.max(0, Math.min(WORLDS.length - 1, next));
        if (w === this.worldIndex || !this.content?.isValid) return;
        this.worldIndex = w;
        this.rebuildWorld();
        this.hud?.setNavEnabled(this.worldIndex > 0, this.worldIndex < WORLDS.length - 1);
        this.snapToPage(this.pageOfLevel(levelsOfWorld(w)[0]!));
    }

    /** 换世界动画：整块翻出 → 换底图与节点 → 翻入（Web `flipTo()`：280ms 出 / 420ms 入） */
    private rebuildWorld(): void {
        const map = this.node.getChildByName('ScrollView');
        if (!map) return;
        tween(map)
            .to(FLIP_OUT_MS / 1000, { scale: new Vec3(0.86, 0.86, 1) })
            .call(() => {
                for (const n of this.content.children.slice()) {
                    if (n.name === 'BgMain' || n.name.indexOf('Level_') === 0) n.destroy();
                }
                this.buildLevelPositions();
                this.createMapBackground();
                this.createLevelNodes();
            })
            .to(FLIP_IN_MS / 1000, { scale: new Vec3(1, 1, 1) })
            .start();
    }

    /**
     * 关卡节点的状态全部由进度派生（§7.3.3）：
     * 锁定 / 解锁 / 已通关 + 星级。
     * 「当前关」= 已解锁到的最后一关，不另存一份 —— 存了就会和进度分叉。
     */
    private createLevelNodes() {
        this.levelNodes = [];
        const p = GS.progress;
        const cur = Math.min(p.unlocked, LEVEL_COUNT);
        for (let i = 0; i < this.levels.length; i++) {
            const lv = this.levels[i];
            const node = new Node('Level_' + lv.level);
            node.parent = this.content;
            node.layer = Layers.Enum.UI_2D;
            node.addComponent(UITransform).setContentSize(NODE_BOX, NODE_BOX);
            node.setPosition(lv.x - DESIGN_W / 2, this.localY(lv.y));

            // 困难档被 3 星门槛挡住的关，外观必须是**锁定态**（Web: status = 'locked'）
            const st = this.isNightmareBlocked(lv.level) ? 'locked' : levelStatus(p, lv.level);
            const stars = recordOf(p, lv.level).stars;
            // ⚠️ 这里原本有一句 `this.makeSprite(node, 'Bead', BEADS.plain, ...)` 预铺 todo 图，已删除：
            //    它和 LevelNode.paintArt 的 `resources.load` 是两条独立的异步回调，
            //    谁后到谁覆盖 —— 实测跑出来 1~2 星/3 星珠的贴图被写死成 todo 图。
            //    贴图整块交给 `LevelNode.paintArt()` 负责（`map.ts:860` 的 `.node-art`）。

            const ln = node.addComponent(LevelNode);
            // 本世界最后一关挂 🏆（Web：`node.level === WORLDS[w].to`，web/ui/map.ts:867）
            ln.init(lv.level, lv.level === cur, st === 'locked', stars, lv.level === WORLDS[this.worldIndex]!.to);
            if (this.fontAsset) ln.setFont(this.fontAsset);
            this.levelNodes.push(ln);
            node.on(Node.EventType.TOUCH_END, () => this.onLevelTap(lv.level), this);
            // 预览 shim 触摸不冒泡：把地图拖动需要的事件转发上去（真引擎会自己冒泡，两边都只有一份状态）
            node.on(Node.EventType.TOUCH_START, this.onDragStart, this);
            node.on(Node.EventType.TOUCH_MOVE, this.onDragMove, this);
            node.on(Node.EventType.TOUCH_END, this.onDragEnd, this);
            node.on(Node.EventType.TOUCH_CANCEL, this.onDragEnd, this);
        }
    }

    /** 切模式 / 通关回来后重建（解锁范围与星级都变了） */
    private rebuildLevelNodes() {
        for (const ln of this.levelNodes) {
            if (ln.node?.isValid) ln.node.destroy();
        }
        this.createLevelNodes();
    }

    /**
     * 点关卡珠 = 直接吊出关卡详情牌（Web：`.node` 的 click → `levelPreview.open()`，
     * 没有「先选中再开始」这道中间态）。未解锁的只给一句提示。
     * 拖动结束的那一下不算点击（Web 用 CLICK_SLOP 判别，这里是时间戳闸门）。
     */
    private onLevelTap(level: number) {
        // 拖过就一律不算点击 —— 与 Web 的 `dragMoved` 同口径：**状态位**，不是时间戳闸门。
        // 时间戳闸门（`Date.now() < x`）会误伤「刚拖完紧接着点下一颗」的正常操作，
        // 而且 Web 根本没这回事（web/ui/map.ts:876 `if (dragMoved || flipping) return`）。
        if (this.drag?.moved) return;
        // 困难档门槛要先判：被门槛挡住时用的是另一句提示，不是「先通关第 N 关」
        const blocked = this.isNightmareBlocked(level);
        if (blocked || levelStatus(GS.progress, level) === 'locked') {
            this.toast.show(
                blocked ? MAP.nightmareLocked : MAP.locked(Math.max(1, level - 1)),
                1800,   // Web 用的是 1800（web/ui/map.ts:721）
            );
            return;
        }
        this.openPreview(level);
    }

    /**
     * 困难档门槛：同一关必须先在**简单模式**拿到 3 星（Web `nightmareUnlocked()`，
     * `NIGHTMARE_MIN_NORMAL_STARS = 3`）。两套进度各自独立，必须跨模式去查简单档。
     */
    private isNightmareBlocked(level: number): boolean {
        return GS.mode === 'nightmare' && recordOf(GS.progressOf('normal'), level).stars < 3;
    }

    // ========== 底部导航：非首页的 3 个页以面板形式弹出 ==========
    /**
     * **外部入口**（结算页「查看排行榜」）：直接落到指定关的关卡榜，并翻到「我」所在页。
     *
     * 结算算的是「本关名次」，所以默认页签是关卡榜、默认关卡是调用方传的那一关 ——
     * 让玩家点一下就看见自己在榜上的位置，而不是落在总分榜第 1 页从头找。
     * 底栏同步高亮到「排行榜」（否则界面上是排行榜、底栏却还停在首页）。
     */
    openLeaderboard(opts: { tab?: 'total' | 'level'; level?: number; focusMine?: boolean } = {}): void {
        const tab = opts.tab ?? 'level';
        const focusMine = opts.focusMine !== false;
        const level = Math.min(Math.max(1, opts.level ?? GS.progress.unlocked), LEVEL_COUNT);
        this.setTab(1);                      // 底栏高亮 + 建屏（内部先按默认关渲染一次）
        this.leaderboard?.openAt(tab, level, focusMine);
    }

    /** 页签顺序与 Web 一致：0 首页 / 1 排行榜 / 2 图鉴 / 3 设置 */
    private setTab(i: number) {
        this.tabIndex = Math.min(Math.max(i, 0), 3);   // 必选其一
        this.hud?.setTab(this.tabIndex);
        if (i === 1) this.showLeaderboardScreen();
        else if (i === 2) this.showCollectionScreen();
        else if (i === 3) this.showSettingsScreen();
    }

    /**
     * 排行榜整屏（取代原来的灰盒文字弹窗）—— 双页签（总分榜 / 关卡榜）+ 金银铜奖杯台
     * + 我的成绩条与「我」行高亮 + 关卡榜内的**「挑战本关」**按钮。
     *
     * ⚠️ 榜单名次一律由核心层 `boardSnapshot` 算，界面不自己排一遍（避免两处口径分叉）；
     *    模拟玩家只有一份成绩 → 只落在当前模式那一列，另一列 0（不按比例拆分数）。
     */
    private showLeaderboardScreen() {
        if (!this.leaderboard) {
            this.leaderboard = LeaderboardScreen.create(this.node, {
                onBack: () => this.leaderboard.hide(),
                // 「挑战本关」= 收起整屏 + 吊出关卡牌（Web 版同口径：先回主页再开吊牌，让玩家选模式）
                onChallenge: (level) => { this.leaderboard.hide(); this.openPreview(level); },
                view: (level) => this.leaderboardView(level),
                myTotals: () => ({ simple: this.totalScoreOf('normal'), hard: this.totalScoreOf('nightmare') }),
                // 累计星数 = 两套模式之和（与图鉴「每 10 星解锁一张」同一口径）
                myStars: () => totalStars(GS.data.progress.normal) + totalStars(GS.data.progress.nightmare),
                onHint: (msg) => this.toast.show(msg, 2200),
            });
            this.leaderboard.rootNode().setSiblingIndex(this.node.children.length - 1);
        }
        // 默认落在「已解锁到的那一关」：还没打过的关看榜没有意义
        const level = Math.min(Math.max(1, GS.progress.unlocked), LEVEL_COUNT);
        this.leaderboard.render(level, LEVEL_COUNT);
        this.leaderboard.show();
    }

    /**
     * 某关的榜单数据（与 web/main.ts 的 `leaderboardView` 同口径）。
     *
     * 「简单 / 困难」两列只能取两套进度的真值（`myScores`），绝不由单个分数按比例拆。
     */
    private leaderboardView(level: number): LeaderboardView {
        const progress = GS.progress;
        const rec = recordOf(progress, level);
        const status = levelStatus(progress, level);
        const cfg = buildLevelConfigs(GS.mode)[level - 1];
        const line = cfg ? { star1: cfg.star1, star2: cfg.star2, star3: cfg.star3 } : { star1: 1, star2: 2, star3: 3 };
        const board = boardSnapshot(level, line, rec.boardBest);
        return {
            level,
            rows: board.rows,
            totalPlayers: board.totalPlayers,
            myRank: board.myRank,
            boardBest: board.myBoardBest,
            personalBest: rec.personalBest,
            myScores: {
                simple: recordOf(GS.data.progress.normal, level).personalBest,
                hard: recordOf(GS.data.progress.nightmare, level).personalBest,
            },
            mode: GS.mode,
            // 已通关但素材不足（被跳过）的关卡也进不去，challengeState 会给出对应文案
            challenge: challengeState(level, status, !!cfg),
        };
    }

    /**
     * 某模式下「所有关卡本关最高分之和」= 该模式的累计分（总分榜用）。
     *
     * 累加的是 `personalBest`（每关取历史最高），所以重复挑战只会刷新单关最高分，
     * 不会重复累加；没玩过的模式自然得 0 —— 不去虚构另一模式的分。
     */
    private totalScoreOf(mode: GameMode): number {
        const p = GS.data.progress[mode];
        let sum = 0;
        for (const key of Object.keys(p.levels)) {
            const level = Number(key);
            if (!Number.isFinite(level)) continue;
            sum += recordOf(p, level).personalBest;
        }
        return sum;
    }

    /**
     * 图鉴整屏（取代原来的灰盒文字弹窗）—— 3 列网格 + 滚动 + 点开大图预览。
     * 首次点击才创建：108 张缩略图不该在进地图时就全加载。
     */
    private showCollectionScreen() {
        if (!this.collection) {
            this.collection = CollectionScreen.create(this.node, {
                onBack: () => { this.collection.hide(); this.previewScreen?.hide(); },
                onOpen: (imageId) => this.openPreviewScreen(imageId),
                onLockedTip: () => this.toast.show(COLLECTION.lockedToast, 1800),
            });
            this.collection.rootNode().setSiblingIndex(this.node.children.length - 1);
        }
        if (!this.previewScreen) {
            this.previewScreen = PreviewScreen.create(this.node, {
                onBack: () => this.previewScreen?.hide(),
                // 保存到相册是另一条平台能力（`平台/` 这一批没有做），先留提示
                onDownload: () => this.toast.show(COLLECTION.download + '（待接入小游戏能力）', 2000),
                // 分享：走 `平台/share.ts`（小游戏转发 / 复制链接 / 不可用降级，批次⑧ 已接）
                onShare: (_imageId, caption) => {
                    setPlatformToast((m) => this.toast.show(m, 2000));
                    void shareCard({ title: caption || COLLECTION.share, query: `img=${_imageId}` })
                        .then((out) => {
                            if (out.ok) { this.toast.show(SHARE.done, 2000); return; }
                            this.toast.show(out.reason === 'cancel' ? SHARE.cancel : SHARE.fail, 2200);
                        })
                        .catch(() => this.toast.show(SHARE.fail, 2200));
                },
            });
            this.previewScreen.rootNode().setSiblingIndex(this.node.children.length - 1);
        }
        this.collection.render(new Set(unlockedImageIds(GS.progress)), COLLECTION_TOTAL);
        this.collection.show();
    }

    private openPreviewScreen(imageId: number): void {
        if (!this.previewScreen) return;
        this.previewScreen.render(imageId);
        this.previewScreen.show();
    }

    /**
     * 设置整屏（取代原来的灰盒弹窗）：音乐 / 音效 / 教学语音三个开关**即时生效**，
     * 另有新手教学回看入口（首页按钮会按进度隐藏，设置页永久保留 —— 策划案 §14 决策 3）。
     * ⚠️ 重置存档放在整屏底部：整屏没有按钮位给第三级弹窗，仍走 dialog.confirm。
     */
    private showSettingsScreen(): void {
        if (!this.settingsScreen) {
            this.settingsScreen = SettingsScreen.create(this.node, {
                onBack: () => this.settingsScreen.hide(),
                onChange: (p) => {
                    if (p.sound !== undefined) GS.setSound(p.sound);
                    if (p.bgm !== undefined) GS.setBgm(p.bgm);
                    // 开关要**立刻**作用到声音上：等刷新才生效会让人以为开关坏了（web/main.ts:551-553）
                    if (p.sound !== undefined) sfx.setSound(p.sound);
                    if (p.bgm !== undefined) sfx.setBgm(p.bgm);
                    if (p.voice !== undefined) GS.setVoice(p.voice);
                    // 关掉就立刻闭嘴（正念到一半也要停）—— web/main.ts:555
                    if (p.voice !== undefined) speech.setEnabled(p.voice);
                    this.settingsScreen.render(GS.meta.settings);
                },
                onTutorial: () => this.openTutorialDrawer(),
            });
            this.settingsScreen.rootNode().setSiblingIndex(this.node.children.length - 1);
        }
        this.settingsScreen.render(GS.meta.settings);
        this.settingsScreen.show();
    }

    /** 新手教学抽屉：困难序章要求先完成简单序章（由 setStatus 置灰按钮挡一道） */
    private openTutorialDrawer(): void {
        if (!this.drawer) {
            this.drawer = TutorialDrawer.create(this.node, {
                onStartNormal: () => { this.drawer.close(); this.enterTutorial('normal'); },
                onStartNightmare: () => { this.drawer.close(); this.enterTutorial('nightmare'); },
                onClose: () => { if (!GS.tutorial.seen) GS.updateTutorial({ seen: true }); },
            });
            this.drawer.rootNode().setSiblingIndex(this.node.children.length - 1);
        }
        this.drawer.setStatus(GS.tutorial.normalCleared, GS.tutorial.nightmareCleared);
        this.drawer.open();
    }

    /** 进序章：与 enterLevel 同构，但走 startTutorial（不扣体力 / 不建断点 / 不写进度） */
    private enterTutorial(mode: GameMode): void {
        const game = this.gameNode?.isValid ? this.gameNode : this.ensureGameNode();
        const gb = game?.getComponent(GameBootstrap);
        if (!game || !gb) {
            this.toast.show('进入教学失败：缺少 Game 节点', 2000);
            return;
        }
        this.node.active = false;
        game.active = true;
        gb.scheduleOnce(() => gb.startTutorial(mode), 0);
    }

    private confirmReset() {
        this.dialog.confirm(SETTINGS.resetConfirmTitle, [SETTINGS.resetConfirmLine], SETTINGS.resetYes, SETTINGS.resetNo, () => {
            GS.reset();
            this.rebuildLevelNodes();
            this.refreshTopbar();
            this.toast.show(SETTINGS.resetDone, 2200);
        });
    }

    private buildUI() {
        this.mountHUD();
        this.createLevelPreview();
        // ⚠️ 这里原本有一句「首启自动开教学抽屉」（`if (!GS.tutorial.seen) ...`），已删除。
        //    Web 端 openTutorialDrawer 只有**两个调用点**：地图屏的教学按钮（web/main.ts:1222）
        //    和设置屏的教学按钮（web/main.ts:546）——**没有任何自动弹出**。
        //    Cocos 端多出来的这句会让新玩家一进游戏就被满屏教学文字糊脸。
        //    教学入口就是 HUD 右上角那个「❓教学」按钮，玩家自己点。
    }

    /** 教学入口：按钮在 HUD 里（体力胶囊正下方，与 Web 同位置），这里只接行为 */
    private onTutorialTap(): void {
        this.openTutorialDrawer();
    }

    /**
     * 关卡详情吊牌（对应 web/ui/levelPreview.ts）：显示关卡号、难度切换、1★/3★ 星线、Play。
     * 困难模式有门槛 —— 本关简单模式没拿到 3 星时按钮置灰 + 🔒，点了也不切模式。
     */
    private createLevelPreview(): void {
        this.preview = LevelPreview.create(this.node, {
            starLines: (level, mode) => {
                const cfg = buildLevelConfigs(mode)[level - 1];
                return cfg ? [cfg.star1, cfg.star2, cfg.star3] as const : undefined;
            },
            onMode: (mode) => {
                // 难度切换是全局的（换模式解锁范围会变），所以走地图原有的 setDifficulty
                this.setDifficulty(mode === 'nightmare' ? 1 : 0);
            },
            // ⚠️ 跨模式查**简单档**（Web main.ts:1349 nightmareUnlocked = recordOf(progressByMode.normal, level).stars >= 3）。
            //    原来用 GS.progress 查的是**当前模式**那份进度 —— 玩家切到困难模式后再开弹窗，
            //    困难档自己永远 0 星 → 困难按钮永久锁死（state.ts 里写的规矩这里没照做）。
            canNightmare: (level) => recordOf(GS.progressOf('normal'), level).stars >= 3,
            onClose: () => { /* 收起吊牌即可，地图不重建 */ },
            onPlay: (level) => this.enterLevel(level),
        });
        // 吊牌必须压在 HUD / 关卡节点之上
        this.preview.rootNode().setSiblingIndex(this.node.children.length - 1);
    }

    /** 「开始游戏」→ 吊出关卡详情牌（不再直接进关） */
    private openPreview(level: number): void {
        this.preview.open(level, (this.diffIndex === 1 ? 'nightmare' : 'normal') as LevelMode);
    }

    /**
     * ⚠️ 原来的「开始游戏」按钮已删除 —— Web 版首页**没有**这个按钮：
     * 点关卡珠 = 直接吊出关卡详情牌（吊牌里才有难度切换与 Play）。
     * 多出来的按钮就是多出来的交互，会让人以为要先选再开始。
     */

    /**
     * HUD（顶栏 / 难度切换 / 底导航）完全由 layout/home_hud.json 驱动。
     * 换场景或新增页面时直接挂载 HomeHUD 即可，不要再手写任何坐标。
     */
    /**
     * HUD 层：顶栏（返回 / 木牌 / 体力 / 教学）、换世界箭头、翻页、底栏 —— 全部由
     * `HomeHUD` 按 Web 实测几何重建，本文件只接行为。
     */
    private mountHUD() {
        const n = new Node('HUD');
        n.parent = this.node;
        n.layer = Layers.Enum.UI_2D;
        n.addComponent(UITransform).setContentSize(DESIGN_W, this.screenH);
        const hud = n.addComponent(HomeHUD);
        this.hud = hud;
        hud.build();
        hud.onReady({
            onTutorial: () => this.onTutorialTap(),
            onBack: () => { /* Web 的返回圆钮在首页是装饰，不做跳转 */ },
            onTab: (i) => this.setTab(i),
            onNav: (dir) => this.switchWorld(this.worldIndex + dir),
            onPage: (dir) => this.animateToPage(this.page + dir),
            onPlus: () => this.onStaminaPlus(),
        });
        hud.setNickname(HOME.nickname);
        hud.setTab(this.tabIndex);
        hud.setNavEnabled(this.worldIndex > 0, this.worldIndex < WORLDS.length - 1);
        hud.setPager(this.page, PAGES);
        this.refreshTopbar();
    }

    /**
     * 保证存在名为 Game 的兄弟节点并挂上 GameBootstrap。
     * 场景里只预置了 Bootstrap 一个节点，根本没有 Game —— enterLevel 找不到它就静默
     * return，这正是「点关卡没反应」的根因。这里补建，不再依赖场景手工摆节点。
     */
    private ensureGameNode(): Node | null {
        const parent = this.node.parent;
        if (!parent) return null;
        let g = parent.getChildByName('Game');
        if (!g?.isValid) {
            g = new Node('Game');
            g.parent = parent;
            g.layer = Layers.Enum.UI_2D;
            g.addComponent(UITransform).setContentSize(DESIGN_W, this.screenH);
            g.active = false;
            g.addComponent(GameBootstrap);
        }
        this.gameNode = g;
        return g;
    }

    /**
     * 进入关卡：隐藏地图，显示兄弟节点 `Game`（挂 GameBootstrap）并开局。
     */
    private enterLevel(level: number): void {
        sfx.unlock();   // 真实手势解锁音频（与地图拖动起手那处等价，Web 是全局 pointerdown）
        if (levelStatus(GS.progress, level) === 'locked') {
            this.toast.show(HOME.lockedToast, 1600);
            return;
        }
        // ⚠️ 体力 0 时**必须放弃本次进入**（对齐 web/main.ts:1759 `enterWithStamina`）。
        //    原来的流程是「先隐藏地图 → 显示 Game → 在 beginLevel 里预扣体力」，扣不出来就
        //    toast 后原地 return —— 玩家被留在一个**没建引擎的空关卡**里：棋盘是空的/残留的，
        //    点哪都没反应（hitCell 还会因为 engine 为 null 抛异常），只能靠左上角返回退出。
        //    `pending > 0` 不算（beginLevel 会先退还再重扣，那一颗能补上）。
        if (GS.stamina.available <= 0 && GS.stamina.pending === 0) {
            this.toast.show(HOME.staminaShort, 2600);
            return;
        }
        const game = this.gameNode?.isValid ? this.gameNode : this.ensureGameNode();
        const gb = game?.getComponent(GameBootstrap);
        if (!game || !gb) {
            console.warn('[map] 未找到挂了 GameBootstrap 的 Game 节点');
            this.toast.show('进入关卡失败：缺少 Game 节点', 2000);
            return;
        }
        // 进关前先把吊牌收掉：整张地图虽然隐藏了，但返回地图时它会留在原地再弹一次
        this.preview.close();
        this.node.active = false;
        game.active = true;
        // 延迟一帧开局：等 GameBootstrap 的 onLoad / start 跑完再 startLevel
        gb.scheduleOnce(() => gb.startLevel(level), 0);
    }
}
