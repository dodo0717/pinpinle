import { _decorator, Component, Node, Graphics, UITransform, Color, ScrollView, Mask, view, Layers, Size, Label, ResolutionPolicy, HorizontalTextAlignment, VerticalTextAlignment, Sprite, SpriteFrame, resources, Font } from 'cc';
import { LevelNode } from './LevelNode';
// 注意：界面 / 玩法 / 核心 是 `scripts/` 下的**兄弟目录**，不是 `场景/` 的子目录
import { HomeHUD } from '../界面/HomeHUD';
import { LevelPreview, type LevelMode } from '../界面/LevelPreview';
import { CollectionScreen } from '../界面/CollectionScreen';
import { PreviewScreen } from '../界面/PreviewScreen';
import { SettingsScreen } from '../界面/SettingsScreen';
import { LeaderboardScreen } from '../界面/LeaderboardScreen';
import { challengeState, type LeaderboardView } from '../界面/leaderboardModel';
import { TutorialDrawer } from '../玩法/tutorial';
import { GameBootstrap } from '../玩法/GameBootstrap';
import { GameDialog } from '../玩法/GameDialog';
import { ToastLayer } from '../玩法/toast';
import { GS } from '../玩法/state';
import { HOME, ADS, SHARE, COLLECTION, SETTINGS, TUTORIAL } from '../玩法/text';
import { STAMINA_PER_AD } from '../平台/ads';
import {
  adDenyText, playAd, setMenuShare, setPlatformToast, shareCard, startTracking,
} from '../玩法/platformBridge';
import { unlockedImageIds, clearedCount, totalStars, COLLECTION_TOTAL } from '../玩法/meta';
import { levelStatus, recordOf, buildLevelConfigs, boardSnapshot, type GameMode, TOTAL_LEVELS } from '../核心/index';
// 世界表 / 路中线全部在 worlds.ts（15 世界 × 12 关 = 180 关），本文件只按结果摆节点
import { WORLDS, levelsOfWorld, roadPoint, worldIndexOf, worldArtAsset } from './worlds';
// 底图走资源来源分派：默认全本地（path 与改造前逐字一致），将来填 cdnBase 才走远程
import { loadSpriteFrame } from '../平台/assetLoader';
import type { ResolvedAsset } from '../平台/assetSource';
const { ccclass } = _decorator;

const DESIGN_W = 1080;
const DESIGN_H = 1920;
const MAP_H = 3840;            // 每个世界一张底图 1080×3840（手机 2 屏，完整高度）
const LEVEL_COUNT = TOTAL_LEVELS;   // 180 关（核心层 TOTAL_LEVELS，地图按世界分段渲染）

/**
 * 地图上下留白 —— 顶栏 / 底导航是浮在地图之上的，如果没有留白：
 * 滚到底时 L1 落在底栏热区里（点气球 = 点排行榜）、滚到顶时 L10 被顶栏压住。
 * 留白让首尾关卡都能滚进「顶栏底边 ~ 底栏顶边」这条安全区。
 */
const PAD_TOP = 560;
const PAD_BOTTOM = 340;
const CONTENT_H = MAP_H + PAD_TOP + PAD_BOTTOM;

/**
 * 分层浮层资源 —— 全部 ≤1M：
 * 静态背景层(整张1080×3840) + 风车/水面/角色 3 个透明浮层，动画由 updateFloats 驱动。
 * 坐标 yFromTop 为底图图片坐标（从顶部往下），程序转成 yFromBottom。
 */
const FLOAT = {
    bg: 'map/w1_bg',                                              // 静态背景层整张
    windmill: { path: 'map/w1_windmill', w: 260, h: 260, x: 800, yFromTop: 550 },  // 上段右侧风车
    water:    { path: 'map/w1_water',    w: 520, h: 320, x: 540, yFromTop: 3300 }, // 下段湖面
    bear:     { path: 'map/w1_bear',     w: 200, h: 200, x: 300, yFromTop: 1850 }, // 中段左侧角色(可调)
};

/**
 * ⚠️ 关卡坐标**不再写在这里** —— 15 个世界的路中线搬到了 `worlds.ts`（`ROAD_X` 归一化表）。
 * 之前这张 `W1_LEVEL_XY` 是 10 关的临时值，且与 Web 版不是同一套标定；
 * 现在按 `roadPoint(level)` 取，换底图/校正路中线只改 `worlds.ts` 那张表。
 */

/** UI 落位（1080×1920 基准，Cocos 坐标，屏幕中心为原点）—— 与美术落位文档一致 */
const UI_POS = {
    topbarLeft:  { w: 683,  h: 274, x: -258, y: 820 },
    avatar:      { w: 180,  h: 180, x: -200, y: 10 },     // 相对 topbarLeft
    nickname:    { w: 280,  h: 55,  x: 50,   y: 20 },     // 相对 topbarLeft
    level:       { w: 200,  h: 40,  x: 50,   y: -25 },    // 相对 topbarLeft
    topbarRight: { w: 692,  h: 163, x: 288,  y: 852 },
    staminaNum:  { w: 120,  h: 60,  x: 30,   y: 10 },      // 相对 topbarRight
    countdown:   { w: 180,  h: 24,  x: 30,   y: -35 },     // 相对 topbarRight
    plusHit:     { w: 90,   h: 90,  x: 220,  y: 0 },        // 相对 topbarRight
    difficulty:  { w: 880,  h: 180, x: -228, y: 580 },
    diffBtnW:    400,
    diffBtnH:    180,
    diffHit:     { w: 360,  h: 160, dx: 220 },             // 相对 difficulty 中心
    tabbar:      { w: 1080, h: 260, x: 0,    y: -826 },
    tabSliceW:   270,                                      // 1080 / 4
    tabIcon:     { w: 200,  h: 180, dx: 270, dy: 0 },     // 相对 tabbar 中心
    tabHit:      { w: 220,  h: 220, dx: 270, dy: 0 },
};

/**
 * 节点珠三态（从 web/art/map/node/ 拷来）：未通关 / 1~2 星 / 3 星。
 * ⚠️ 取代旧的 `level_balloon_1~10` —— 那 10 个贴图**从来就不存在**（运行时一直走「贴图缺失」
 * 分支，靠底图自带的数字顶着）；而且每世界 12 关，10 个切片本来也会越界。
 */
const BEADS = {
    todo: 'map/node/node-todo',
    star1: 'map/node/node-star1',
    star3: 'map/node/node-star3',
} as const;
const BALLOON_W = 240;
const BALLOON_H = 320;

/**
 * 兜底背景层配色 —— 采样自底图上下边缘，保证铺满时与地图无缝衔接：
 * 上半 = w1_bg_top 顶部天空色，下半 = w1_bg_bottom 底部草地色。
 */
const BACKDROP_TOP = new Color(122, 169, 202, 255);
const BACKDROP_BOTTOM = new Color(184, 195, 68, 255);

/** 选中 / 未选中：只差色调（Sprite 只能乘色变暗，故「高亮」= 保持原色，未选中压暗） */
const TINT_ON = new Color(255, 255, 255, 255);
const TINT_OFF = new Color(150, 150, 150, 255);

/**
 * 难度切换 —— 素材只有「普通=黄 / 困难=灰」两张常态图，没有按下 / 置灰态：
 * 选中 = 相乘着色偏暖黄（两张都会变黄），未选中 = 留原色 + 叠灰罩压成灰调。
 */
const TINT_DIFF_ON = new Color(255, 236, 150, 255);
const TINT_DIFF_OFF = new Color(255, 255, 255, 255);

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
    private screenH = DESIGN_H;   // 实际可视高度（FIXED_WIDTH 下可能 > 1920）
    private viewH = 0;

    private levelNodes: LevelNode[] = [];
    private diffNormalYellow: Sprite = null!;
    private diffNormalGray: Sprite = null!;
    private diffHardYellow: Sprite = null!;
    private diffHardGray: Sprite = null!;
    private tabSprites: Sprite[] = [];
    private selectedLevel = 0;        // 已选中的关卡；0 = 未选中任何关
    private playBtn: Node = null!;    // 「开始」按钮：选中关卡后才出现，点击进入
    private playLabel: Label = null!;
    private gameNode: Node = null!;   // 玩法层（挂 GameBootstrap），与本节点互为兄弟
    private hud: HomeHUD = null!;     // HUD 层：由 layout/home_hud.json 驱动，换场景直接复用
    private diffIndex = 0;   // 0 = 普通，1 = 困难（互斥，必选其一）
    private tabIndex = 0;    // 0 首页 / 1 排行 / 2 图鉴 / 3 设置（互斥，必选其一）

    private staminaLabel: Label = null!;
    private countdownLabel: Label = null!;
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
        view.setDesignResolutionSize(DESIGN_W, DESIGN_H, ResolutionPolicy.FIXED_WIDTH);
        this.visibleSize = view.getVisibleSize();
        this.screenH = this.visibleSize.height || DESIGN_H;
        // 地图与关卡共用一份全局状态；关卡层先启动时会 init 过，这里保证幂等
        if (!GS.readResult) GS.init();
        startTracking();   // 埋点：建身份 + first_open / session_start（幂等）
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
        g.fillColor = BACKDROP_TOP;
        g.rect(-halfW, 0, w, halfH);
        g.fill();
        g.fillColor = BACKDROP_BOTTOM;
        g.rect(-halfW, -halfH, w, halfH);
        g.fill();
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

    /** 顶栏：体力数字 + 恢复倒计时（满格不显示倒计时，§11.1） */
    private refreshTopbar() {
        const cur = String(GS.stamina.available);
        const cd = GS.countdownText();
        const cdText = cd ? `${cd} 后 +1` : '已满';
        if (this.hud) {
            this.hud.setText('staminaNum', cur);
            this.hud.setText('countdown', cdText);
            return;
        }
        if (!this.staminaLabel) return;
        this.staminaLabel.string = cur;
        this.countdownLabel.string = cdText;
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

    // ========== 顶栏 ==========
    private buildTopbar() {
        const L = UI_POS.topbarLeft;
        const left = new Node('TopbarLeft');
        left.parent = this.node;
        left.layer = Layers.Enum.UI_2D;
        left.addComponent(UITransform).setContentSize(L.w, L.h);
        left.setPosition(L.x, this.topY(L.h / 2));
        this.makeSprite(left, 'Bg', 'ui/顶栏/home_topbar_left', L.w, L.h, 0, 0);

        // 真实兔子头像（新素材切片 006）
        const av = new Node('Avatar');
        av.parent = left;
        av.layer = Layers.Enum.UI_2D;
        av.addComponent(UITransform).setContentSize(UI_POS.avatar.w, UI_POS.avatar.h);
        av.setPosition(UI_POS.avatar.x, UI_POS.avatar.y);
        this.makeSprite(av, 'AvatarImg', 'ui/顶栏/home_avatar', UI_POS.avatar.w, UI_POS.avatar.h, 0, 0);

        this.makeLabel(left, 'Nickname', '小兔兔', UI_POS.nickname.x, UI_POS.nickname.y, 34, TEXT_BROWN, UI_POS.nickname.w, UI_POS.nickname.h);
        this.makeLabel(left, 'Level', 'Lv.23', UI_POS.level.x, UI_POS.level.y, 26, TEXT_BROWN, UI_POS.level.w, UI_POS.level.h);

        const R = UI_POS.topbarRight;
        const right = new Node('TopbarRight');
        right.parent = this.node;
        right.layer = Layers.Enum.UI_2D;
        right.addComponent(UITransform).setContentSize(R.w, R.h);
        right.setPosition(R.x, R.y);
        this.makeSprite(right, 'Bg', 'ui/顶栏/home_topbar_right', R.w, R.h, 0, 0);

        this.staminaLabel = this.makeLabel(right, 'StaminaNum', '0', UI_POS.staminaNum.x, UI_POS.staminaNum.y, 34, TEXT_WHITE, UI_POS.staminaNum.w, UI_POS.staminaNum.h);
        this.countdownLabel = this.makeLabel(right, 'Countdown', '', UI_POS.countdown.x, UI_POS.countdown.y, 18, TEXT_WHITE, UI_POS.countdown.w, UI_POS.countdown.h);
        this.makeHit(right, 'PlusHit', UI_POS.plusHit.w, UI_POS.plusHit.h, UI_POS.plusHit.x, UI_POS.plusHit.y, () => this.onStaminaPlus());
        this.refreshTopbar();
    }

    // ========== 难度切换（互斥两态：简单/困难） ==========
    /** 用户要求"底图互换"：选中项显示黄底，未选中项显示灰底，文字固定为简单/困难 */
    private buildModePanel() {
        const D = UI_POS.difficulty;
        const panel = new Node('ModeSwitch');
        panel.parent = this.node;
        panel.layer = Layers.Enum.UI_2D;
        panel.addComponent(UITransform).setContentSize(D.w, D.h);
        panel.setPosition(D.x, D.y);

        const bw = D.diffBtnW;
        const bh = D.diffBtnH;
        const gap = 80;

        // 简单按钮
        const normal = new Node('Normal');
        normal.parent = panel;
        normal.layer = Layers.Enum.UI_2D;
        normal.addComponent(UITransform).setContentSize(bw, bh);
        normal.setPosition(-bw / 2 - gap / 2, 0);
        this.diffNormalYellow = this.makeSprite(normal, 'Yellow', 'ui/难度/home_difficulty_yellow', bw, bh, 0, 0);
        this.diffNormalGray = this.makeSprite(normal, 'Gray', 'ui/难度/home_difficulty_gray', bw, bh, 0, 0);
        this.makeLabel(normal, 'Label', '简单', 0, 0, 44, TEXT_BROWN, 200, 70);

        // 困难按钮
        const hard = new Node('Hard');
        hard.parent = panel;
        hard.layer = Layers.Enum.UI_2D;
        hard.addComponent(UITransform).setContentSize(bw, bh);
        hard.setPosition(bw / 2 + gap / 2, 0);
        this.diffHardYellow = this.makeSprite(hard, 'Yellow', 'ui/难度/home_difficulty_yellow', bw, bh, 0, 0);
        this.diffHardGray = this.makeSprite(hard, 'Gray', 'ui/难度/home_difficulty_gray', bw, bh, 0, 0);
        this.makeLabel(hard, 'Label', '困难', 0, 0, 44, TEXT_BROWN, 200, 70);

        const hit = UI_POS.diffHit;
        this.makeHit(panel, 'NormalHit', hit.w, hit.h, -hit.dx, 0, () => this.setDifficulty(0));
        this.makeHit(panel, 'HardHit', hit.w, hit.h, hit.dx, 0, () => this.setDifficulty(1));

        this.applyDifficulty();
    }

    /**
     * 切换难度 = 切换模式（两套进度分别存，切模式不丢）。
     * 必须重建关卡节点：解锁范围与星级都跟着模式变。
     */
    private setDifficulty(i: number) {
        this.diffIndex = i === 1 ? 1 : 0;   // 只能 0 或 1，不能都选 / 都不选
        GS.setMode((this.diffIndex === 1 ? 'nightmare' : 'normal') as GameMode);
        this.selectedLevel = 0;             // 换模式解锁范围会变，清空选中免得选到锁定关
        this.applyDifficulty();
        this.hud?.setDifficulty(this.diffIndex);
        this.rebuildLevelNodes();
    }

    private applyDifficulty() {
        const normalOn = this.diffIndex === 0;
        this.diffNormalYellow.node.active = normalOn;
        this.diffNormalGray.node.active = !normalOn;
        this.diffHardYellow.node.active = !normalOn;
        this.diffHardGray.node.active = normalOn;
    }

    // ========== 底部导航（互斥四选一） ==========
    /** 底条背景 + 四个独立图标，选中后高亮（放大+原色），未选中压暗 */
    private buildNavbar() {
        const T = UI_POS.tabbar;
        const nav = new Node('Navbar');
        nav.parent = this.node;
        nav.layer = Layers.Enum.UI_2D;
        nav.addComponent(UITransform).setContentSize(T.w, T.h);
        nav.setPosition(T.x, this.botY(T.h / 2));

        this.makeSprite(nav, 'Bg', 'ui/底栏/home_tabbar_bg', T.w, T.h, 0, 0);

        const icons = [
            'ui/底栏/home_tab_home',
            'ui/底栏/home_tab_rank',
            'ui/底栏/home_tab_collection',
            'ui/底栏/home_tab_settings',
        ];
        const hit = UI_POS.tabHit;
        const iconPos = UI_POS.tabIcon;
        const startX = -T.w / 2 + UI_POS.tabSliceW / 2;   // -405
        this.tabSprites = [];
        for (let i = 0; i < 4; i++) {
            const ix = startX + i * iconPos.dx;
            const icon = new Node('TabIcon_' + i);
            icon.parent = nav;
            icon.layer = Layers.Enum.UI_2D;
            icon.addComponent(UITransform).setContentSize(iconPos.w, iconPos.h);
            icon.setPosition(ix, iconPos.dy);
            const sp = this.makeSprite(icon, 'Icon', icons[i], iconPos.w, iconPos.h, 0, 0);
            this.tabSprites.push(sp);

            const hx = startX + i * hit.dx;
            this.makeHit(nav, 'TabHit_' + i, hit.w, hit.h, hx, hit.dy, () => this.setTab(i));
        }

        this.applyTab();
    }

    private applyTab() {
        for (let i = 0; i < this.tabSprites.length; i++) {
            const on = i === this.tabIndex;
            const sp = this.tabSprites[i];
            if (!sp) continue;
            sp.color = on ? TINT_ON : TINT_OFF;   // 选中原色，未选中压暗
            sp.node.setScale(on ? 1.15 : 1, on ? 1.15 : 1);
        }
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
        const mask = maskNode.addComponent(Mask);
        mask.type = Mask.Type.RECT;

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
        this.createWorldSwitcher();

        // 滚动到当前关卡（= 已解锁到的那一关）
        this.scheduleOnce(() => this.scrollToLevel(GS.progress.unlocked), 0.1);
    }

    /** 地图坐标（从底往上量的 y）→ content 局部 y（原点在 content 中心） */
    private localY(yFromBottom: number): number {
        return yFromBottom - CONTENT_H / 2 + PAD_BOTTOM;
    }

    /** 把某关滚到视口正中：offset = 关卡 y − 半屏高 + 底部留白 */
    private scrollToLevel(level: number): void {
        if (!this.content?.isValid || this.levels.length === 0) return;
        const idx = Math.min(Math.max(level - 1, 0), this.levels.length - 1);
        const max = Math.max(0, CONTENT_H - this.viewH);
        const offset = Math.max(0, Math.min(max, this.levels[idx].y - this.viewH / 2 + PAD_BOTTOM));
        this.content.setPosition(0, (CONTENT_H / 2 - this.viewH / 2) - offset);
    }

    /**
     * 把浮层提到地图之上 —— 地图是 onLoad 里最后建的节点，默认排在最上层，
     * 会把顶栏 / 底导航 / 「开始」按钮整个盖住（看得见代码、看不见画面）。
     * 真引擎里的 Mask 只负责裁剪溢出，管不了层级，所以这里显式排一次：
     * 底图 → 地图 → HUD → 开始按钮 → 弹窗 → Toast。
     */
    private raiseOverlays() {
        const order = ['Backdrop', 'ScrollView', 'HUD', 'WorldSwitcher', 'PlayButton', 'Dialog', 'Toast'];
        for (const name of order) {
            const n = this.node.getChildByName(name);
            if (n?.isValid) n.setSiblingIndex(this.node.children.length - 1);
        }
    }

    /**
     * 底图：整张静态背景层 1080×3840（每世界一张，`worlds.ts` 的 WORLDS 决定哪张）。
     * ⚠️ 风车 / 水面 / 角色是**小镇底图专属**浮层，其他世界没有这些切片，只在第 1 世界挂。
     */
    private createMapBackground() {
        this.makeResolvedSprite(this.content, 'BgMain', worldArtAsset(this.worldIndex), DESIGN_W, MAP_H, 0, this.localY(MAP_H / 2));
        if (this.worldIndex === 0) this.createFloatLayers();
    }

    /**
     * 底图代次：`switchWorld` 换世界时，上一张底图的远程回调可能还没回来，
     * 靠这个 token 把迟到的结果丢掉（否则会看到上一世界的图盖在新世界上）。
     */
    private bgToken = 0;

    /**
     * 按 `resolveAsset` 的结果挂贴图：
     *   - local：走 `makeSprite()`，**与改造前同一条** `resources.load('map/w1_town/spriteFrame')`；
     *   - cdn  ：先挂占位（纯色底 + 「加载中」），远程到了再换上；失败按 `canFallbackToLocal()`
     *            退回本地，再失败就留着占位 —— 切世界时不会白屏。
     */
    private makeResolvedSprite(parent: Node, name: string, res: ResolvedAsset, w: number, h: number, x: number, y: number): void {
        if (res.mode === 'local') {
            this.makeSprite(parent, name, res.path, w, h, x, y);
            return;
        }
        this.makeRemoteSprite(parent, name, res, w, h, x, y);
    }

    /** 远程底图：占位 → 加载 → 换图 / 回退 / 提示失败 */
    private makeRemoteSprite(parent: Node, name: string, res: ResolvedAsset, w: number, h: number, x: number, y: number): void {
        const token = ++this.bgToken;
        const n = new Node(name);
        n.parent = parent;
        n.layer = Layers.Enum.UI_2D;
        n.addComponent(UITransform).setContentSize(w, h);
        n.setPosition(x, y);

        // 占位：CDN 未到之前先铺一块底色，避免整屏白
        const g = n.addComponent(Graphics);
        g.rect(-w / 2, -h / 2, w, h);
        g.fillColor = new Color(176, 214, 238, 255);
        g.fill();
        const tip = this.makeLabel(n, 'LoadingTip', '底图加载中…', 0, 0, 36, new Color(90, 60, 40), 620, 80);

        const sp = n.addComponent(Sprite);
        sp.sizeMode = Sprite.SizeMode.CUSTOM;
        loadSpriteFrame(res, (sf) => {
            if (token !== this.bgToken || !n.isValid) return;   // 已经切到别的世界，丢弃这次结果
            if (sf) {
                sp.spriteFrame = sf;
                if (tip.node?.isValid) tip.node.destroy();
                return;
            }
            if (tip.node?.isValid) tip.string = '底图加载失败';
        });
    }

    // ========== 世界切换（15 个世界，地图上同时只驻留一张底图）==========
    private worldTitle: Label = null!;

    /** 世界切换条：‹ 世界名 关卡区间 ›（顶栏下方，不吃地图点击） */
    private createWorldSwitcher(): void {
        const bar = new Node('WorldSwitcher');
        bar.parent = this.node;
        bar.layer = Layers.Enum.UI_2D;
        bar.addComponent(UITransform).setContentSize(620, 110);
        bar.setPosition(0, this.screenH / 2 - 260);
        const g = bar.addComponent(Graphics);
        g.roundRect(-310, -55, 620, 110, 55);
        g.fillColor = new Color(60, 44, 30, 160);
        g.fill();
        this.worldTitle = this.makeLabel(bar, 'wtitle', '', 0, 0, 40, new Color(255, 240, 210), 420, 60);
        this.mkArrow(bar, '‹', -270, () => this.switchWorld(this.worldIndex - 1));
        this.mkArrow(bar, '›', 270, () => this.switchWorld(this.worldIndex + 1));
        this.refreshWorldTitle();
    }

    private mkArrow(parent: Node, text: string, x: number, onTap: () => void): void {
        const n = new Node('arrow');
        n.parent = parent;
        n.layer = Layers.Enum.UI_2D;
        n.addComponent(UITransform).setContentSize(90, 90);
        n.setPosition(x, 0, 0);
        const g = n.addComponent(Graphics);
        g.circle(0, 0, 45);
        g.fillColor = new Color(255, 255, 255, 70);
        g.fill();
        this.makeLabel(n, 'a', text, 0, 0, 56, new Color(255, 255, 255), 90, 90);
        n.on(Node.EventType.TOUCH_END, onTap, this);
    }

    private refreshWorldTitle(): void {
        const w = WORLDS[this.worldIndex]!;
        if (this.worldTitle?.isValid) this.worldTitle.string = `${w.name} ${w.from}-${w.to}`;
    }

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
        this.selectedLevel = 0;
        for (const n of this.content.children.slice()) {
            if (n.name === 'BgMain' || n.name === 'Windmill' || n.name === 'Water'
                || n.name === 'Bear' || n.name.indexOf('Level_') === 0) n.destroy();
        }
        this.floatNodes = [];
        this.buildLevelPositions();
        this.createMapBackground();
        this.createLevelNodes();
        this.refreshWorldTitle();
        this.scheduleOnce(() => this.scrollToLevel(levelsOfWorld(w)[0]!), 0.1);
    }

    private floatNodes: { node: Node; kind: 'wm' | 'water' | 'bear'; baseX: number }[] = [];
    private floatTime = 0;

    /** 挂一个透明浮层 Sprite（资源异步加载），返回节点 */
    private addFloat(name: string, path: string, w: number, h: number, x: number, yFromBottom: number): Node {
        const n = new Node(name);
        n.parent = this.content;
        n.layer = Layers.Enum.UI_2D;
        n.addComponent(UITransform).setContentSize(w, h);
        n.setPosition(x - DESIGN_W / 2, this.localY(yFromBottom));
        resources.load(path + '/spriteFrame', SpriteFrame, (err, sf) => {
            if (err || !sf) { console.warn('[map] 浮层缺失: ' + path); return; }
            if (!n.isValid) return;
            const sp = n.addComponent(Sprite);
            sp.sizeMode = Sprite.SizeMode.CUSTOM;
            sp.spriteFrame = sf;
        });
        return n;
    }

    /** 创建 3 个浮层并注册动画驱动 */
    private createFloatLayers() {
        const wm = FLOAT.windmill;
        const wmNode = this.addFloat('Windmill', wm.path, wm.w, wm.h, wm.x, MAP_H - wm.yFromTop);
        this.floatNodes.push({ node: wmNode, kind: 'wm', baseX: wmNode.position.x });

        const wa = FLOAT.water;
        const waNode = this.addFloat('Water', wa.path, wa.w, wa.h, wa.x, MAP_H - wa.yFromTop);
        this.floatNodes.push({ node: waNode, kind: 'water', baseX: waNode.position.x });

        const be = FLOAT.bear;
        const beNode = this.addFloat('Bear', be.path, be.w, be.h, be.x, MAP_H - be.yFromTop);
        this.floatNodes.push({ node: beNode, kind: 'bear', baseX: beNode.position.x });

        this.schedule(this.updateFloats, 0);
    }

    /** 每帧驱动浮层动画：风车旋转 / 水面流动 / 角色眨眼 */
    private updateFloats() {
        this.floatTime += 0.016;
        for (const f of this.floatNodes) {
            if (!f.node?.isValid) continue;
            const t = this.floatTime;
            if (f.kind === 'wm') {
                f.node.angle = Math.sin(t * 2.2) * 10;                       // 风车往复旋转（叶片转动感）
            } else if (f.kind === 'water') {
                f.node.setPosition(f.baseX + Math.sin(t * 1.6) * 55, f.node.position.y);  // 水面横向流动
            } else if (f.kind === 'bear') {
                const sc = Math.max(0.25, Math.abs(Math.sin(t * 3.2)));      // 眨眼（纵向缩放）
                f.node.setScale(1, sc, 1);
            }
        }
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
            node.addComponent(UITransform).setContentSize(BALLOON_W, BALLOON_H);
            node.setPosition(lv.x - DESIGN_W / 2, this.localY(lv.y));

            const st = levelStatus(p, lv.level);
            const stars = recordOf(p, lv.level).stars;
            const bead = stars >= 3 ? BEADS.star3 : stars > 0 ? BEADS.star1 : BEADS.todo;
            this.makeSprite(node, 'Bead', bead, BALLOON_W, BALLOON_H, 0, 0);

            const ln = node.addComponent(LevelNode);
            ln.init(lv.level, lv.level === cur, st === 'locked', stars);
            if (this.fontAsset) ln.setFont(this.fontAsset);
            this.levelNodes.push(ln);
            node.on(Node.EventType.TOUCH_END, () => this.onLevelTap(lv.level), this);
        }
        this.applySelection();   // 重建后把选中态套回新节点
    }

    /** 切模式 / 通关回来后重建（解锁范围与星级都变了） */
    private rebuildLevelNodes() {
        for (const ln of this.levelNodes) {
            if (ln.node?.isValid) ln.node.destroy();
        }
        this.createLevelNodes();
    }

    /**
     * 关卡点击：选中并提亮，底部随即出现「开始第 N 关」按钮，点按钮进入。
     * 再点一次同一关也直接进入（保留快捷操作）。未解锁的关卡不给选中。
     */
    private onLevelTap(level: number) {
        if (levelStatus(GS.progress, level) === 'locked') {
            this.toast.show(HOME.lockedToast, 1600);
            return;
        }
        if (this.selectedLevel === level) {
            this.enterLevel(level);
            return;
        }
        this.selectedLevel = level;
        this.applySelection();
    }

    /** 选中态由各 LevelNode 自己绘制，节点重建后重新套用；同时刷新「开始」按钮 */
    private applySelection() {
        for (const ln of this.levelNodes) {
            ln.setSelected(ln.level === this.selectedLevel);
        }
        const has = this.selectedLevel > 0;
        if (this.playBtn?.isValid) {
            this.playBtn.active = has;
            if (has && this.playLabel) this.playLabel.string = `开始第 ${this.selectedLevel} 关`;
        }
    }

    // ========== 底部导航：非首页的 3 个页以面板形式弹出 ==========
    private setTab(i: number) {
        this.tabIndex = Math.min(Math.max(i, 0), 3);   // 必选其一
        this.applyTab();
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
                    if (p.voice !== undefined) GS.setVoice(p.voice);
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
        this.createPlayButton();
        this.createLevelPreview();
        this.createTutorialButton();
        // 首启自动开教学抽屉（Web 版同口径：没进过序章就先带一遍；关掉即记 seen，不会反复弹）
        if (!GS.tutorial.seen) this.scheduleOnce(() => this.openTutorialDrawer(), 0.6);
    }

    /**
     * 首页教学入口 —— 通关数够了就隐藏（策划案 §14 决策 3）。
     * ⚠️ 隐藏只是首页这一个入口：设置页里的回看入口**永久保留**，老玩家想再看随时能看。
     */
    private createTutorialButton(): void {
        if (clearedCount(GS.progress) >= GameBootstrap.TUTORIAL_HIDE_AFTER) return;
        const n = new Node('TutorialBtn');
        n.parent = this.node;
        n.layer = Layers.Enum.UI_2D;
        n.addComponent(UITransform).setContentSize(240, 100);
        n.setPosition(370, 400, 0);   // 难度切换面板下方右侧，不压底栏
        const g = n.addComponent(Graphics);
        g.roundRect(-120, -50, 240, 100, 50);
        g.fillColor = new Color(255, 196, 92, 255);
        g.fill();
        this.makeLabel(n, 't', TUTORIAL.drawerTitle, 0, 0, 34, new Color(90, 50, 25), 240, 100);
        n.on(Node.EventType.TOUCH_END, () => this.openTutorialDrawer(), this);
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
            canNightmare: (level) => recordOf(GS.progress, level).stars >= 3,
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
     * 「开始」按钮 —— 选中关卡后出现在底栏上方，点击直接进关。
     * 之前只有「再点一次进入」这种隐式操作，没有可见入口，用户找不到怎么开始。
     */
    private createPlayButton() {
        const w = 380, h = 130;
        const n = new Node('PlayButton');
        n.parent = this.node;
        n.layer = Layers.Enum.UI_2D;
        n.addComponent(UITransform).setContentSize(w, h);
        n.setPosition(0, -this.screenH / 2 + 330);   // 底栏（高 260）上方，不重叠
        n.active = false;

        const g = n.addComponent(Graphics);
        g.fillColor = new Color(255, 205, 70, 255);
        g.roundRect(-w / 2, -h / 2, w, h, 65);
        g.fill();
        g.lineWidth = 6;
        g.strokeColor = new Color(255, 255, 255, 240);
        g.roundRect(-w / 2, -h / 2, w, h, 65);
        g.stroke();

        const lbNode = new Node('Label');
        lbNode.parent = n;
        lbNode.layer = Layers.Enum.UI_2D;
        lbNode.addComponent(UITransform).setContentSize(w, h);
        const lb = lbNode.addComponent(Label);
        lb.string = '开始游戏';
        lb.fontSize = 48;
        lb.lineHeight = 58;
        lb.color = new Color(90, 50, 25);
        lb.horizontalAlign = HorizontalTextAlignment.CENTER;
        lb.verticalAlign = VerticalTextAlignment.CENTER;
        this.playLabel = lb;

        n.on(Node.EventType.TOUCH_END, () => {
            if (this.selectedLevel > 0) this.openPreview(this.selectedLevel);
        }, this);

        this.playBtn = n;
    }

    /**
     * HUD（顶栏 / 难度切换 / 底导航）完全由 layout/home_hud.json 驱动。
     * 换场景或新增页面时直接挂载 HomeHUD 即可，不要再手写任何坐标。
     */
    private mountHUD() {
        const n = new Node('HUD');
        n.parent = this.node;
        n.layer = Layers.Enum.UI_2D;
        n.addComponent(UITransform).setContentSize(DESIGN_W, this.screenH);
        const hud = n.addComponent(HomeHUD);
        this.hud = hud;

        hud.onDifficulty = (i) => this.setDifficulty(i);
        hud.onTab = (i) => this.setTab(i);
        hud.onPlus = () => this.onStaminaPlus();
        hud.onReady = () => {
            hud.setText('nickname', '小兔兔');
            hud.setText('level', 'Lv.23');
            hud.setDifficulty(this.diffIndex);
            this.refreshTopbar();
        };
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
        if (levelStatus(GS.progress, level) === 'locked') {
            this.toast.show(HOME.lockedToast, 1600);
            return;
        }
        const game = this.gameNode?.isValid ? this.gameNode : this.ensureGameNode();
        const gb = game?.getComponent(GameBootstrap);
        if (!game || !gb) {
            console.warn('[map] 未找到挂了 GameBootstrap 的 Game 节点');
            this.toast.show('进入关卡失败：缺少 Game 节点', 2000);
            return;
        }
        this.node.active = false;
        game.active = true;
        // 延迟一帧开局：等 GameBootstrap 的 onLoad / start 跑完再 startLevel
        gb.scheduleOnce(() => gb.startLevel(level), 0);
    }
}
