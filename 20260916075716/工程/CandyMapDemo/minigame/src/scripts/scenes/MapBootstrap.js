import {
    _decorator, Component, Node, Graphics, UITransform, Color, view, Layers, Label, ResolutionPolicy,
    HorizontalTextAlignment, VerticalTextAlignment, Sprite, SpriteFrame, resources, UIOpacity, Vec2, Vec3,
    EventTouch, sys, Texture2D, Rect,
} from '../../runtime/cc.js';
import { reportError } from '../game/runtimeError.js';
// 注意：界面 / 玩法 / 核心 是 `scripts/` 下的**兄弟目录**，不是 `场景/` 的子目录
import { GameBootstrap } from '../game/GameBootstrap.js';
import { GameDialog } from '../game/GameDialog.js';
import { ToastLayer } from '../game/toast.js';
import { GS } from '../game/state.js';
import { syncFriendRank, enableShare, getInviter, reportInviter } from '../game/wxFriend.js';
import { cloudSync,                } from '../game/cloud.js';
import { HOME, ADS, SETTINGS, MAP_TEXT, TABBAR, MODE_LABEL } from '../game/text.js';
import { MapPanels } from '../ui/MapPanels.js';
import { AvatarView, ProfilePanel } from '../ui/ProfilePanel.js';
import { ThemedPreview } from '../ui/ThemedPreview.js';
import { themeForLevel } from '../game/theme.js';
import { getProfile, onProfileChanged, trySilentWxProfile, syncProfileAfterLogin } from '../game/profile.js';
import { starPath, shadow } from '../game/paint.js';
import { LEVELS_BY_ART } from './levelTable.js';
import { MAP_ANIM } from './mapAnim.js';
import {
    levelStatus, recordOf, buildLevelConfigs, boardSnapshot, STAR_LINES_BY_MODE, TOTAL_LEVELS,
                                    
} from '../core/index.js';
const { ccclass } = _decorator;

/**
 * 首页 = 关卡地图（移植自 web/ui/map.ts + web/ui/levelPreview.ts + 加载页，2026-10-23）。
 *
 * web 版是 UI 与规则的定稿，这里逐条对齐它的口径：
 *   - 5 个世界 × 12 关，每个世界一张 1080×3840 底图（两屏），整屏翻页、松手吸附；
 *   - 节点落在底图小路上（ROAD_X 路中线表），果冻珠三态：待完成 / 1~2 星 / 3 星；
 *   - 点关卡弹 PLAY 吊牌：选「简单 / 困难」（困难要同关简单三星）→ Play 进关；
 *   - 顶栏：返回圆钮 + 木牌（头像 / 昵称）｜体力胶囊（点它加体力）；
 *   - 左右大箭头换世界，右侧「▲ · 页点 · ▼」翻页，底部四个页签。
 *
 * 坐标约定：轨道（track）沿用 web 的 1536 × 5462 坐标（y 从上往下），整条轨道按
 * `k = min(可视高度 / 2731, 1080 / 1536)` 缩放：普通屏一页正好铺满一屏（与 web 的 fitScale 同一口径）；
 * 长屏按宽铺满，左右不裁，两页上下重叠、翻页顶 / 底对齐（2026-10-29）。
 */

/* ------------------------------------------------------------------ 布局常量（与 web/ui/map.ts 一致） */

const DESIGN_W = 1080;
const DESIGN_H = 1920;
/** 轨道宽 / 高（web track 坐标）；高 = 2 页 × 2731 */
const TRACK_W = 1536;
const PAGE_H = 2731;
const PAGE_COUNT = 2;
const TRACK_H = PAGE_H * PAGE_COUNT;
/** 相邻关卡纵向间距 + 上留白：5462 = PAD_TOP + 11 × NODE_STEP + PAD_BOTTOM(472) */
const NODE_STEP = 385;
const PAD_TOP = 755;
/** 拖动位移小于它算点击（设计 px） */
const TAP_SLOP = 24;
const MAX_FLING = 95;
const FLING_PROJECT = 14;
const RUBBER = 0.32;
const SNAP_S = 0.42;
const FLIP_OUT_S = 0.28;
const FLIP_IN_S = 0.42;
const PULSE_S = 1.1;
const DROP_S = 0.55;
/** 加载页最短停留（与 web 一致：太快一闪而过反而像出错） */
const LOADING_MIN_S = 1.2;
const LOADING_FADE_S = 0.5;
/** 底部页签栏高度（三个整屏面板的卡片要让开它） */
const TABBAR_H = 170;

/** 五个世界：每世界 12 关，`art` = resources/map-v2/{art}.png */
const WORLDS = [
    { name: '小镇', from: 1, to: 12, art: 'xiaozhen' },
    { name: '果园', from: 13, to: 24, art: 'guoyuan' },
    { name: '雪地', from: 25, to: 36, art: 'xuedi' },
    { name: '沙滩', from: 37, to: 48, art: 'shatan' },
    { name: '花园', from: 49, to: 60, art: 'huayuan' },
];

/** 小路中线（归一化 x），从上到下 12 个点，最下面那个 = 本世界第 1 关。换底图只改这张表 */
const ROAD_X                           = {
    xiaozhen: [0.43, 0.54, 0.43, 0.39, 0.4, 0.51, 0.56, 0.47, 0.47, 0.5, 0.46, 0.44],
    guoyuan: [0.5, 0.46, 0.42, 0.46, 0.52, 0.55, 0.5, 0.45, 0.5, 0.55, 0.5, 0.46],
    xuedi: [0.5, 0.47, 0.45, 0.5, 0.55, 0.5, 0.45, 0.5, 0.55, 0.5, 0.47, 0.5],
    shatan: [0.52, 0.48, 0.44, 0.42, 0.48, 0.55, 0.58, 0.52, 0.46, 0.48, 0.53, 0.55],
    huayuan: [0.5, 0.47, 0.5, 0.54, 0.5, 0.46, 0.5, 0.55, 0.5, 0.47, 0.52, 0.5],
};

/** 底图没加载出来时的天空底色（取 web .map.world-N 渐变的中段色） */
const WORLD_SKY = [
    new Color(232, 247, 255), new Color(234, 248, 228), new Color(234, 233, 255),
    new Color(217, 246, 251), new Color(233, 249, 226),
];

/** 珠显示直径（track px，web --nd = --pw = 190） */
const BEAD_D = 190;

/**
 * 2026-10-25 新关卡节点 + 关卡连线（美术图：UI及角色/首页/关卡节点/，深灰底由 tools/key-map-art.py 抠成透明）：
 *   - node-candy：粉白糖果珠 190×188，珠体约占 182 → 显示时按珠径对齐 BEAD_D；
 *   - link-candy：粉白斜纹糖果条 1094×57，左右是直切口，按长度**截取**（不拉伸，斜纹比例不变）。
 * 三态不再换三张图：已通关在珠下方显示 3 颗星（点亮实得星数），未解锁盖一层灰 + 锁。
 */
const NODE_ART = { path: 'map/node/node-candy', w: 190, h: 188, k: 190 / 182 };
const LINK_ART = { path: 'map/node/link-candy', w: 1094, h: 57 };
/** 连线显示粗细（track px） */
const LINK_H = 46;
const C_NODE_NUM_EDGE = new Color(200, 70, 122);

/** 困难模式门槛：同一关简单模式要拿到的星数（web main.ts NIGHTMARE_MIN_NORMAL_STARS） */
const NIGHTMARE_MIN_NORMAL_STARS = 3;

/* 配色（取自 web ui.css） */
const C_WHITE = new Color(255, 255, 255);
const C_BROWN = new Color(107, 74, 47);
const C_GOLD = new Color(245, 197, 66);
const C_NICK = new Color(255, 233, 199);
const C_SHADOW = new Color(40, 20, 5, 110);

/** 加载页要先拉的素材（进度条的真实进度来源） */
const PRELOAD_BASE = [
    NODE_ART.path, LINK_ART.path,
    'home/back', 'home/banner', 'home/pill', 'home/heart', 'home/plus',
    'home/tab-home', 'home/tab-rank', 'home/tab-book', 'home/tab-gear',
];

                       
                  
                        
                  
                                 
                      
                                  
              
              
 

                   
               
                
                 
 

function clamp(v        , lo        , hi        )         {
    return v < lo ? lo : v > hi ? hi : v;
}
function easeOutCubic(t        )         {
    return 1 - Math.pow(1 - t, 3);
}
/** 吊牌落下的回弹（web lp-drop 的 cubic-bezier(.18,.9,.32,1.25) 近似） */
function easeOutBack(t        )         {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}
function worldIndexOf(level        )         {
    return clamp(Math.floor((Math.max(1, level) - 1) / 12), 0, WORLDS.length - 1);
}
function nodeX(local        , world        )         {
    const road = ROAD_X[WORLDS[world].art] ?? ROAD_X.xiaozhen;
    return (road[road.length - 1 - local] ?? 0.5) * TRACK_W;
}
function nodeY(local        , count        )         {
    return PAD_TOP + (count - 1 - local) * NODE_STEP;
}
function pageOfY(y        )         {
    return clamp(Math.floor(y / PAGE_H), 0, PAGE_COUNT - 1);
}

export class MapBootstrap extends Component {
            screenH = DESIGN_H;
    /** 顶栏顶边 / 页签栏底边距屏幕边的距离（已含刘海、微信胶囊、底部手势条） */
            topInset = 28;
            bottomInset = 20;
    /** 轨道缩放：一页（2731）铺满一屏 */
            k = DESIGN_H / PAGE_H;
            ready = false;
            enabledOnce = false;
            time = 0;

    /* ---- 地图 ---- */
            mapView       = null ;
            content       = null ;
            contentOpacity            = null ;
            sky           = null ;
            bgSprite         = null ;
            beadLayer       = null ;
    /** 底图动画块（tools/make-map-anim.py 生成的序列帧图集，垫在珠子下面） */
            animLayer       = null ;
            anims                                                       = [];
            world = 0;
            page = PAGE_COUNT - 1;
    /** content 的 y：-H/2 = 第 0 页（上），+H/2 = 第 1 页（下） */
            offset = 0;
            nodes                = [];
            pulses                                  = [];
    /** 底图加载令牌：快速切世界时丢弃过期的回调 */
            bgToken = 0;

            dragging = false;
            dragMoved = false;
    /** 本次触摸落在哪颗珠上（珠自己的 TOUCH_END 先于地图冒泡上来的那次触发） */
            tappedLevel = 0;
            dragStartY = 0;
            dragStartOffset = 0;
            lastY = 0;
            velocity = 0;

            snapFrom = 0;
            snapTo = 0;
            snapT = 0;
            snapDur = 0;

    /** 换世界：0 无，1 淡出，2 淡入 */
            flipPhase = 0;
            flipT = 0;
            flipTarget = 0;

    /* ---- 浮层控件 ---- */
            staminaLabel        = null ;
            countdownLabel        = null ;
            navPrev       = null ;
            navNext       = null ;
            pageUp       = null ;
            pageDown       = null ;
            dots             = [];
            tabs                                                             = [];
            tabIndex = 0;
            disabled = new Set      ();

    /* ---- PLAY 吊牌 ---- */
            preview       = null ;
            drop       = null ;
            pvLevelLabel        = null ;
            pvStarsLabel        = null ;
            pvModes                            = null ;
            pvLevel = 1;
            pvMode           = 'normal';
            dropT = -1;

    /* ---- 加载页 ---- */
            loading              = null;
            loadingOpacity                   = null;
            loadingFill       = null ;
            loadingNum        = null ;
    /**
     * 最短停留 / 淡出都用墙钟（performance.now 差值），不用累计帧 dt：
     * dt 每帧被钳到 0.05s，帧率低或 rAF 稀疏（无头验证环境）时 1.2s 的最短停留
     * 会被拉长到永远等不到 —— 加载时长本来也不该跟帧率挂钩
     */
            loadingStart = 0;
            fadeStart = 0;
            loadTotal = 0;
            loadDone = 0;
            loadingFade = -1;

            dialog             = null ;
            panels            = null ;
    /** 「我的资料」面板（点左上角木牌打开） */
            profilePanel               = null ;
    /** 第 2/3/4 关的主题版关卡详情窗口（其余关卡用原吊牌） */
            themedPreview                = null ;
            offProfile                      = null;
            toast             = null ;
            gameNode       = null ;

    /** 订阅要用同一个函数引用退订（原来用匿名函数，订阅会越叠越多） */
                     metaListener = ()       => this.refreshTopbar();

    onLoad() {
        view.setDesignResolutionSize(DESIGN_W, DESIGN_H, ResolutionPolicy.FIXED_WIDTH);
        const vs = view.getVisibleSize();
        this.screenH = vs.height || DESIGN_H;
        // 一页铺满一屏会在长屏（19.5:9 等，可视高 > 1920）上把轨道放宽到超过屏宽，左右两边被裁掉；
        // 所以取「按高铺满」与「按宽铺满」的较小者：长屏按宽铺满，上下两页有重叠，翻页改为顶 / 底对齐
        this.k = Math.min(this.screenH / PAGE_H, DESIGN_W / TRACK_W);
        // 地图与关卡共用一份全局状态；关卡层先启动时会 init 过，这里保证幂等
        if (!GS.readResult) GS.init();
        // 启动即把本人总分/星数报给微信托管 KV（好友榜数据源；非微信 no-op）
        syncFriendRank();
        // 云同步启动对齐：登录 → 补传离线队列 → 拉云档取大合并（非微信 no-op）。
        // 异步进行，不挡首帧；合并有变化时重画地图（珠子星级 / 解锁状态可能变了）
        const cloud = cloudSync();
        if (cloud) void this.bootCloud(cloud);
        this.measureInsets();

        // 创建顺序 = 叠放顺序（后建的在上层）
        this.buildMap();
        this.buildTopbar();
        this.buildWorldNav();
        this.buildPager();
        this.buildPanels();
        this.buildTabbar();
        this.buildPreview();
        this.mountDialogs();
        this.profilePanel = new ProfilePanel(this.node, { toast: (t, ms) => this.toast.show(t, ms ?? 2000) });
        this.buildLoading();
        // 以前授权过微信资料、且玩家没自己改过 → 静默换上微信头像昵称（不弹授权框）
        trySilentWxProfile();

        // GameBootstrap 返回时按 'Map' 查找本节点
        this.node.name = 'Map';
        this.ensureGameNode();
        GS.onMetaChange(this.metaListener);
        this.schedule(this.onTick, 1);

        this.world = worldIndexOf(GS.progress.unlocked);
        this.renderMap(true);
        this.refreshTopbar();
        this.ready = true;
    }

    onDestroy() {
        GS.offMetaChange(this.metaListener);
        this.offProfile?.();
        this.profilePanel?.hide();
    }

    /**
     * 云同步启动对齐（onLoad 里异步触发）。注意两点：
     * - 直接写 `GS.data.progress.normal`（setProgress 只写「当前模式」，而这里 GS.mode
     *   可能停在 nightmare）+ markDirty + flush，与 setProgress 的落盘路径一致；
     * - 合并结果与本地引用不同才重画，避免每次启动都白画一遍。
     */
            async bootCloud(cloud           )                {
        if (!(await cloud.login())) return;   // 登录失败：纯本地继续
        // 登录拿到 playerId 后开「转发带邀请人」；受邀启动的把邀请人报给后端（二期接口未上，静默）
        enableShare(cloud.playerId);
        // 本机资料推给后端（排行榜上的名字 / 头像）
        syncProfileAfterLogin();
        const inviter = getInviter();
        if (inviter) void reportInviter(inviter);
        await cloud.flush();
        const merged = await cloud.pull(GS.data.progress.normal);
        if (merged === GS.data.progress.normal) return;
        GS.data.progress.normal = merged;
        GS.markDirty();
        GS.flush();
        this.renderMap(true);
        this.refreshTopbar();
    }

    /** 从关卡返回：进度、星级、当前关都可能变了，整张地图按最新进度重画 */
    onEnable() {
        if (!this.ready) return;
        // 首次激活时 onLoad 刚画过，不重复画
        if (!this.enabledOnce) {
            this.enabledOnce = true;
            return;
        }
        this.world = worldIndexOf(GS.progress.unlocked);
        this.renderMap(true);
        this.refreshTopbar();
    }

    update(dt        ) {
        this.time += dt;

        // 整屏翻页补间
        if (this.snapDur > 0) {
            this.snapT += dt;
            const t = Math.min(1, this.snapT / this.snapDur);
            this.offset = this.snapFrom + (this.snapTo - this.snapFrom) * easeOutCubic(t);
            this.applyOffset();
            if (t >= 1) this.snapDur = 0;
        }

        // 换世界：淡出 → 换图 → 淡入
        if (this.flipPhase === 1) {
            this.flipT += dt;
            const t = Math.min(1, this.flipT / FLIP_OUT_S);
            this.contentOpacity.opacity = Math.round(255 * (1 - t));
            this.content.setScale(this.k, this.k * (1 - 0.1 * t));
            if (t >= 1) {
                this.world = this.flipTarget;
                this.renderMap(true);
                this.flipPhase = 2;
                this.flipT = 0;
            }
        } else if (this.flipPhase === 2) {
            this.flipT += dt;
            const t = Math.min(1, this.flipT / FLIP_IN_S);
            const e = easeOutCubic(t);
            this.contentOpacity.opacity = Math.round(255 * e);
            this.content.setScale(this.k, this.k * (0.9 + 0.1 * e));
            if (t >= 1) {
                this.flipPhase = 0;
                this.contentOpacity.opacity = 255;
                this.content.setScale(this.k, this.k);
            }
        }

        // 可玩关卡的呼吸光圈
        const ph = (this.time % PULSE_S) / PULSE_S;
        for (const p of this.pulses) {
            p.node.setScale(1 + 0.2 * ph, 1 + 0.2 * ph);
            p.op.opacity = Math.round(210 * (1 - ph));
        }

        // 底图动画块：来回播放，周期 = 2 × (帧数 - 1)
        for (const a of this.anims) {
            const n = a.frames.length;
            if (n < 2) continue;
            const t = Math.floor(this.time * a.fps) % (2 * (n - 1));
            a.sp.spriteFrame = a.frames[t < n ? t : 2 * (n - 1) - t];
        }

        // 吊牌从屏幕上方落下
        if (this.dropT >= 0) {
            this.dropT += dt;
            const t = Math.min(1, this.dropT / DROP_S);
            this.drop.setPosition(0, this.screenH * (1 - easeOutBack(t)));
            if (t >= 1) this.dropT = -1;
        }

        this.updateLoading(dt);
    }

    /* ================================================================ 屏幕安全区 */

    /**
     * 顶栏 / 页签栏让出刘海、底部手势条；微信小游戏里还要让出右上角的胶囊按钮，
     * 不然体力胶囊会被「··· ⊙」压住、点不到。
     */
    /**
     * ⚠️ 2026-10-23：微信里顶栏整块消失。这里任何一个平台值是 undefined，
     * `Math.max / Math.min` 就会传染成 NaN，顶栏所有节点的坐标都变 NaN、整块不渲染，
     * 而且不报错。所以每个外部值都过一遍 `finite()`，算完再夹到合理区间，并打一行日志。
     */
            measureInsets() {
        const finite = (v         , fb        )         =>
            typeof v === 'number' && Number.isFinite(v) ? v : fb;
        let safeTop = 0;
        let safeBottom = 0;
        try {
            // Cocos 的安全区以「可视区左下角」为原点（设计分辨率单位）
            const r = sys.getSafeAreaRect();
            const ry = finite(r?.y, 0);
            const rh = finite(r?.height, 0);
            if (rh > 0) {
                safeTop = Math.max(0, this.screenH - (ry + rh));
                safeBottom = Math.max(0, ry);
            }
        } catch { /* 平台不支持就按 0 处理 */ }

        // 微信胶囊底边（设计 px）。胶囊 API 在开发者工具里常取到 0（2026-10-23 有
        // 记录），只按安全区让位时顶栏会整条压在胶囊/状态栏上（10-24 截图实测：
        // 体力胶囊与微信胶囊完全重叠、木牌头像顶到状态栏）。三级来源兜底：
        // 胶囊 API → 状态栏高度 + 经验值 → 安全区顶 + 经验值
        let capBottom = 0;
        let statusBar = 0;
        let winH = 0;
        const wx = (globalThis                ).wx;
        try {
            if (wx) {
                const info = typeof wx.getWindowInfo === 'function'
                    ? wx.getWindowInfo()
                    : typeof wx.getSystemInfoSync === 'function' ? wx.getSystemInfoSync() : null;
                statusBar = finite(info?.statusBarHeight, 0);
                winH = finite(info?.windowHeight, 0);
                if (typeof wx.getMenuButtonBoundingClientRect === 'function') {
                    const bottom = finite(wx.getMenuButtonBoundingClientRect()?.bottom, 0);
                    if (winH > 0 && bottom > 0) capBottom = (bottom * this.screenH) / winH;
                }
            }
        } catch { /* 拿不到就按下面的兜底 */ }
        if (wx) {
            if (capBottom <= 0 && winH > 0 && statusBar > 0) {
                capBottom = ((statusBar + 40) * this.screenH) / winH;   // 胶囊高约 32 + 一点间隙
            }
            if (capBottom <= 0) capBottom = safeTop + 40;
            // 2026-10-24（三修）：胶囊 API 在开发者工具里报的位置和实际绘制对不上
            // （12:11 截图实测 API 折算 ≈138 设计px、实画在 safeTop+125 附近；不同预设
            // 间胶囊底在 safeTop+99~125 浮动）。统一抬到 safeTop+118 兜底，两头都盖住。
            // 顶栏顶边就是整排元素的最上沿（体力胶囊顶边 = topInset+8），只需再让 8；
            // 上一版的 +132 把偏移方向算反（叠加 API 偏小后整条下放过头，用户反馈太低）
            capBottom = Math.max(capBottom, safeTop + 118);
            const top = Math.max(28 + safeTop, capBottom + 8);
            this.topInset = clamp(finite(top, 28), 28, 480);
        } else {
            // 非微信环境（浏览器预览 / 编辑器）没有胶囊，只按安全区让位
            this.topInset = clamp(28 + finite(safeTop, 0), 28, 480);
        }
        // 页签栏底距：清出底部系统手势条，但封顶 64——设备会上报离谱的安全区值
        // （见过 ~146），全额叠加会把栏顶抬进第 1 关珠子（10-24 截图实测零间距）；
        // 只给 20 又会压到手势条黑线（同日另一张截图实测仅隔 11px）
        this.bottomInset = clamp(20 + finite(safeBottom, 0), 20, 64);
        console.log(`[map] 屏幕高 ${Math.round(this.screenH)}，安全区上 ${Math.round(safeTop)} 下 ${Math.round(safeBottom)}，`
            + `胶囊底 ${Math.round(capBottom)} → 顶栏让位 ${Math.round(this.topInset)}，页签让位 ${Math.round(this.bottomInset)}`);
    }

    /* ================================================================ 通用小工具 */

            makeNode(parent      , name        , w        , h        , x = 0, y = 0)       {
        const n = new Node(name);
        n.parent = parent;
        n.layer = Layers.Enum.UI_2D;
        n.addComponent(UITransform).setContentSize(w, h);
        n.setPosition(x, y);
        return n;
    }

            makeLabel(
        parent      , name        , text        , size        , color       ,
        w        , h        , x = 0, y = 0,
        opts                                                                                          = {},
    )        {
        const n = this.makeNode(parent, name, w, h, x, y);
        const l = n.addComponent(Label);
        l.string = text;
        l.fontSize = size;
        l.lineHeight = size + 6;
        l.color = color;
        l.isBold = true;
        l.horizontalAlign = opts.align === 'left' ? HorizontalTextAlignment.LEFT : HorizontalTextAlignment.CENTER;
        l.verticalAlign = VerticalTextAlignment.CENTER;
        if (opts.outline) {
            l.enableOutline = true;
            l.outlineColor = opts.outline;
            l.outlineWidth = opts.outlineWidth ?? 3;
        }
        if (opts.shadow) {
            l.enableShadow = true;
            l.shadowColor = C_SHADOW;
            l.shadowOffset = new Vec2(0, -3);
            l.shadowBlur = 2;
        }
        return l;
    }

    /**
     * 按 `路径/spriteFrame` 加载；没有就退回 `路径/texture` 现场包一个 SpriteFrame。
     *
     * ⚠️ 新拷进 resources 的图，Cocos 默认按 `texture` 导入，没有 spriteFrame 子资源 ——
     * 2026-10-23 整批顶栏 / 页签 / 珠子 / 加载页全因此不显示。退回 texture 之后，
     * 以后再加图忘了改导入类型也不会整块空白（控制台仍会提示一次，方便回头把类型改对）。
     */
            loadFrame(path        , cb                           , onFail             ) {
        resources.load(path + '/spriteFrame', SpriteFrame, (err, sf) => {
            if (!err && sf) {
                cb(sf);
                return;
            }
            resources.load(path + '/texture', Texture2D, (err2, tex) => {
                if (err2 || !tex) {
                    console.warn('[map] 贴图缺失: ' + path);
                    onFail?.();
                    return;
                }
                console.warn('[map] 导入类型不是 sprite-frame，已按 texture 兜底: ' + path);
                const frame = new SpriteFrame();
                frame.texture = tex;
                cb(frame);
            });
        });
    }

            makeSprite(parent      , name        , path        , w        , h        , x = 0, y = 0)         {
        const n = this.makeNode(parent, name, w, h, x, y);
        const sp = n.addComponent(Sprite);
        sp.sizeMode = Sprite.SizeMode.CUSTOM;
        this.loadFrame(path, (sf) => { if (sp.isValid) sp.spriteFrame = sf; });
        return sp;
    }

    /** 可点按钮：按下缩一下，抬手触发；`disabled` 集合里的按钮点了不响应 */
            makeButton(parent      , name        , w        , h        , x        , y        , onTap            )       {
        const n = this.makeNode(parent, name, w, h, x, y);
        n.on(Node.EventType.TOUCH_START, (e            ) => {
            e.propagationStopped = true;
            if (!this.disabled.has(n)) n.setScale(0.93, 0.93);
        }, this);
        n.on(Node.EventType.TOUCH_END, (e            ) => {
            e.propagationStopped = true;
            n.setScale(1, 1);
            if (!this.disabled.has(n)) onTap();
        }, this);
        n.on(Node.EventType.TOUCH_CANCEL, () => n.setScale(1, 1), this);
        return n;
    }

            setDisabled(n      , off         , repaint                                       ) {
        if (off) this.disabled.add(n);
        else this.disabled.delete(n);
        const op = n.getComponent(UIOpacity) ?? n.addComponent(UIOpacity);
        // 2026-10-24：只降透明度在真机上不够醒目，禁用时把金钮重绘成灰色再压一层
        // 半透明 —— 任何环境下一眼可见（web 的禁用态是 opacity .3，这里叠加灰化更强）
        op.opacity = off ? 150 : 255;
        if (repaint) {
            const g = n.getComponent(Graphics);
            if (g) repaint(g, off);
        }
    }

    /** 金色圆钮（换世界 / 翻页箭头共用，web .map-world-nav 的配色）；gray = 边界禁用态 */
            paintGoldCircle(g          , r        , gray = false) {
        g.clear();
        g.fillColor = gray ? new Color(96, 96, 96, 128) : new Color(140, 70, 10, 128);
        g.circle(0, -7, r);
        g.fill();
        g.fillColor = gray ? new Color(172, 172, 172) : new Color(247, 177, 63);
        g.circle(0, 0, r);
        g.fill();
        g.fillColor = gray ? new Color(216, 216, 216, 200) : new Color(255, 228, 155, 200);
        g.circle(0, r * 0.28, r * 0.55);
        g.fill();
        g.lineWidth = 5;
        g.strokeColor = gray ? new Color(238, 238, 238) : new Color(255, 243, 214);
        g.circle(0, 0, r - 2.5);
        g.stroke();
    }

    /* ================================================================ 地图 */

            buildMap() {
        this.mapView = this.makeNode(this.node, 'MapView', DESIGN_W, this.screenH);
        this.sky = this.makeNode(this.mapView, 'Sky', DESIGN_W, this.screenH).addComponent(Graphics);

        this.content = this.makeNode(this.mapView, 'Content', TRACK_W, TRACK_H);
        this.content.setScale(this.k, this.k);
        this.contentOpacity = this.content.addComponent(UIOpacity);

        const bg = this.makeNode(this.content, 'Bg', TRACK_W, TRACK_H);
        this.bgSprite = bg.addComponent(Sprite);
        this.bgSprite.sizeMode = Sprite.SizeMode.CUSTOM;
        this.animLayer = this.makeNode(this.content, 'Anims', TRACK_W, TRACK_H);
        this.beadLayer = this.makeNode(this.content, 'Beads', TRACK_W, TRACK_H);

        this.mapView.on(Node.EventType.TOUCH_START, this.onMapStart, this);
        this.mapView.on(Node.EventType.TOUCH_MOVE, this.onMapMove, this);
        this.mapView.on(Node.EventType.TOUCH_END, this.onMapEnd, this);
        this.mapView.on(Node.EventType.TOUCH_CANCEL, this.onMapCancel, this);
    }

    /** 当前世界的 12 个节点（状态全部由进度派生，与 web mapView() 同口径） */
            worldNodes(w        )                {
        const { from, to, art } = WORLDS[w];
        const progress = GS.progress;
        const count = to - from + 1;
        // 坐标表（地图编辑器导出）优先；没导出过的世界回退到 ROAD_X 公式，行为与旧版一致
        const table = LEVELS_BY_ART[art];
        const out                = [];
        for (let level = from; level <= to; level++) {
            const local = level - from;
            const blocked = GS.mode === 'nightmare' && !this.canNightmare(level);
            const rec = table?.find((e) => e.level === level);
            out.push({
                level,
                status: blocked ? 'locked' : levelStatus(progress, level),
                stars: recordOf(progress, level).stars,
                lockNote: blocked ? MAP_TEXT.nightmareLocked : undefined,
                x: rec ? rec.x : nodeX(local, w),
                y: rec ? rec.y : nodeY(local, count),
            });
        }
        return out;
    }

            canNightmare(level        )          {
        return recordOf(GS.data.progress.normal, level).stars >= NIGHTMARE_MIN_NORMAL_STARS;
    }

    /** 当前正在解锁的关卡 = 默认定位目标 = 宠物站的那一关 */
            currentLevel()         {
        return clamp(GS.progress.unlocked, 1, TOTAL_LEVELS);
    }

    /** 重画当前世界：底色、底图、节点、箭头与页点 */
            renderMap(focus         ) {
        this.nodes = this.worldNodes(this.world);

        this.sky.clear();
        this.sky.fillColor = WORLD_SKY[this.world];
        this.sky.rect(-DESIGN_W, -this.screenH / 2, DESIGN_W * 2, this.screenH);
        this.sky.fill();

        const token = ++this.bgToken;
        this.bgSprite.spriteFrame = null;
        this.loadFrame('map-v2/' + WORLDS[this.world].art, (sf) => {
            if (token === this.bgToken && this.bgSprite.isValid) this.bgSprite.spriteFrame = sf;
        });
        this.buildAnims(token);

        this.buildBeads();
        // r=59 与 buildWorldNav 一致：到边界（第一世界 / 最后世界）置灰，不再只是变淡
        this.setDisabled(this.navPrev, this.world <= 0, (g, gray) => this.paintGoldCircle(g, 59, gray));
        this.setDisabled(this.navNext, this.world >= WORLDS.length - 1, (g, gray) => this.paintGoldCircle(g, 59, gray));
        if (focus) this.focusWorld(false);
        else this.applyOffset();
        this.paintPager();
    }

    /**
     * 底图动画块：每块一张网格图集，按 rect 切成帧，update 里来回播放（正放再倒放，首尾不跳）。
     * 图集边缘已和底图羽化烘焙在一起（不透明 jpg），图集没加载到时这块就是静态底图，不会露空。
     */
            buildAnims(token        ) {
        for (const c of this.animLayer.children.slice()) c.destroy();
        this.anims = [];
        for (const def of MAP_ANIM[WORLDS[this.world].art] ?? []) {
            const sp = this.makeNode(this.animLayer, 'Anim', def.w, def.h,
                def.x - TRACK_W / 2, TRACK_H / 2 - def.y).addComponent(Sprite);
            sp.sizeMode = Sprite.SizeMode.CUSTOM;
            this.loadFrame(def.path, (sheet) => {
                if (token !== this.bgToken || !sp.isValid) return;
                const frames                = [];
                for (let i = 0; i < def.frames; i++) {
                    const f = new SpriteFrame();
                    f.texture = sheet.texture;
                    f.rect = new Rect((i % def.cols) * def.fw, Math.floor(i / def.cols) * def.fh, def.fw, def.fh);
                    frames.push(f);
                }
                sp.spriteFrame = frames[0];
                this.anims.push({ sp, frames, fps: def.fps });
            });
        }
    }

            buildBeads() {
        for (const c of this.beadLayer.children.slice()) c.destroy();
        this.pulses = [];
        const current = this.currentLevel();
        const last = WORLDS[this.world].to;
        // 先画连线（垫在珠子下面）
        this.buildLinks();

        for (const n of this.nodes) {
            const node = this.makeNode(this.beadLayer, 'Level_' + n.level, BEAD_D * 1.2, BEAD_D * 1.2,
                n.x - TRACK_W / 2, TRACK_H / 2 - n.y);
            // 点击由珠自己命中（引擎按节点包围盒判定，不用再自己换算坐标）；
            // 不停止冒泡：事件继续传到地图，拖动 / 翻页照常走地图那一套
            const level = n.level;
            node.on(Node.EventType.TOUCH_END, () => { this.tappedLevel = level; }, this);

            // 已解锁未通关：珠外呼吸光圈；当前关：常亮金圈
            if (n.status === 'unlocked') {
                const ring = this.makeNode(node, 'Ring', BEAD_D, BEAD_D);
                const g = ring.addComponent(Graphics);
                g.lineWidth = n.level === current ? 16 : 12;
                g.strokeColor = new Color(255, 215, 0, 255);
                g.circle(0, 0, BEAD_D / 2 + 6);
                g.stroke();
                const op = ring.addComponent(UIOpacity);
                if (n.level === current) op.opacity = 200;
                else this.pulses.push({ node: ring, op });
            }

            // 糖果珠（珠径对齐 BEAD_D）
            const nw = BEAD_D * NODE_ART.k;
            this.makeSprite(node, 'Bead', NODE_ART.path, nw, nw * NODE_ART.h / NODE_ART.w);

            if (n.status === 'locked') {
                // 未解锁：灰罩 + 锁（纯代码运行时的 Sprite 不支持着色，用一层半透明灰盖住）
                const veil = this.makeNode(node, 'Veil', BEAD_D, BEAD_D).addComponent(Graphics);
                veil.fillColor = new Color(70, 70, 82, 130);
                veil.circle(0, 0, BEAD_D / 2 - 4);
                veil.fill();
                this.makeLabel(node, 'Lock', '🔒', BEAD_D * 0.42, C_WHITE, BEAD_D, BEAD_D);
            } else {
                this.makeLabel(node, 'Num', String(n.level), BEAD_D * 0.42, C_WHITE, BEAD_D, BEAD_D, 0, 4,
                    { outline: C_NODE_NUM_EDGE, outlineWidth: 6, shadow: true });
            }
            if (n.status === 'cleared') this.buildNodeStars(node, n.stars);
            if (n.level === current) {
                this.makeLabel(node, 'Pet', '🐶', BEAD_D * 0.34, C_WHITE, 90, 90, BEAD_D * 0.34, -BEAD_D * 0.18);
            }
            if (n.level === last) {
                this.makeLabel(node, 'Trophy', '🏆', BEAD_D * 0.34, C_WHITE, 90, 90, BEAD_D * 0.36, BEAD_D * 0.5);
            }
        }
    }

    /**
     * 相邻两关之间的糖果条：从上一关珠边到下一关珠边，按方向旋转。
     * 通向未解锁关卡的那一段调暗（玩家一眼看出「路走到哪了」）。
     *
     * ⚠️ 旋转方向：纯代码运行时（cc-shim）里 `angle` 正值 = **顺时针**（与 web CSS rotate 同向，
     * MapPanels 的装饰角度也按这个调的），所以这里按顺时针算。将来回到真 Cocos 要取反。
     */
            buildLinks() {
        const nodes = this.nodes;
        for (let i = 0; i + 1 < nodes.length; i++) {
            const a = nodes[i] ;
            const b = nodes[i + 1] ;
            // track 坐标 y 向下 → 本地坐标 y 向上
            const ax = a.x - TRACK_W / 2;
            const ay = TRACK_H / 2 - a.y;
            const bx = b.x - TRACK_W / 2;
            const by = TRACK_H / 2 - b.y;
            const dx = bx - ax;
            const dy = by - ay;
            const dist = Math.hypot(dx, dy);
            // 两端各埋进珠子一点，接缝藏在珠子下面
            const len = dist - BEAD_D * 0.62;
            if (len <= 8) continue;
            const link = this.makeNode(this.beadLayer, `Link_${a.level}`, len, LINK_H, (ax + bx) / 2, (ay + by) / 2);
            link.angle = -Math.atan2(dy, dx) * 180 / Math.PI;
            // 投影：糖果条略浮起
            const sh = this.makeNode(link, 'Shadow', len, LINK_H).addComponent(Graphics);
            sh.fillColor = new Color(60, 30, 50, 60);
            sh.roundRect(-len / 2, -LINK_H / 2 - 6, len, LINK_H, LINK_H / 2);
            sh.fill();
            this.tileLink(link, len);
            if (b.status === 'locked') link.addComponent(UIOpacity).opacity = 140;
        }
    }

    /** 糖果条贴图按长度截取（超出原图长度就分段平铺），斜纹保持原比例 */
            tileLink(link      , len        ) {
        const srcPerPx = LINK_ART.h / LINK_H;          // 原图 px / 显示 px
        const maxSeg = LINK_ART.w / srcPerPx;          // 一张原图能铺的显示长度
        resources.load(LINK_ART.path + '/texture', Texture2D, (err, tex) => {
            if (err || !tex || !link.isValid) return;
            let x = -len / 2;
            let left = len;
            let k = 0;
            while (left > 0.5) {
                const seg = Math.min(left, maxSeg);
                const n = this.makeNode(link, 'Seg' + k++, seg, LINK_H, x + seg / 2, 0);
                const sp = n.addComponent(Sprite);
                sp.sizeMode = Sprite.SizeMode.CUSTOM;
                const sf = new SpriteFrame();
                sf.texture = tex;
                sf.rect = new Rect(0, 0, seg * srcPerPx, LINK_ART.h);
                sp.spriteFrame = sf;
                x += seg;
                left -= seg;
            }
        });
    }

    /** 已通关：珠下方一排 3 颗星，点亮实得星数（中间那颗略大、略低，弧形排布） */
            buildNodeStars(parent      , stars        ) {
        const g = this.makeNode(parent, 'Stars', BEAD_D * 1.2, 80, 0, -BEAD_D * 0.5 - 6).addComponent(Graphics);
        const slots                                  = [[-56, 8, 26], [0, -2, 32], [56, 8, 26]];
        slots.forEach(([x, y, r], i) => {
            const on = i < stars;
            shadow(g, new Color(80, 40, 10, 120), 4, 0, 3);
            starPath(g, x, y, r + 5, 0.5);
            g.fillColor = on ? new Color(154, 90, 16) : new Color(90, 80, 90, 200);
            g.fill();
            shadow(g, null);
            starPath(g, x, y, r, 0.5);
            g.fillColor = on ? new Color(255, 210, 60) : new Color(205, 200, 210, 230);
            g.fill();
            if (on) {
                g.fillColor = new Color(255, 248, 200, 200);
                g.circle(x - r * 0.18, y + r * 0.22, r * 0.18);
                g.fill();
            }
        });
    }

            applyOffset() {
        this.content.setPosition(0, this.offset);
    }

    /** 轨道顶边贴屏幕顶 / 底边贴屏幕底时的 offset；k 按高铺满时正好是 ∓screenH/2（与原口径一致） */
            minOffset()         { return (this.screenH - TRACK_H * this.k) / 2; }
            maxOffset()         { return (TRACK_H * this.k - this.screenH) / 2; }

    /** 第 0 页顶对齐、最后一页底对齐，中间按比例 */
            pageOffset(p        )         {
        const lo = this.minOffset();
        return lo + (this.maxOffset() - lo) * (p / (PAGE_COUNT - 1));
    }

            nearestPage(v        )         {
        const lo = this.minOffset();
        const span = this.maxOffset() - lo;
        return clamp(Math.round(span > 0 ? ((v - lo) / span) * (PAGE_COUNT - 1) : 0), 0, PAGE_COUNT - 1);
    }

            rubber(v        )         {
        const lo = this.minOffset();
        const hi = this.maxOffset();
        if (v > hi) return hi + (v - hi) * RUBBER;
        if (v < lo) return lo + (v - lo) * RUBBER;
        return v;
    }

            snapToPage(p        , animated         ) {
        this.page = clamp(p, 0, PAGE_COUNT - 1);
        this.velocity = 0;
        const target = this.pageOffset(this.page);
        if (animated && Math.abs(target - this.offset) > 0.5) {
            this.snapFrom = this.offset;
            this.snapTo = target;
            this.snapT = 0;
            this.snapDur = SNAP_S;
        } else {
            this.snapDur = 0;
            this.offset = target;
            this.applyOffset();
        }
        this.paintPager();
    }

    /** 进入世界时的定位：当前关所在页 → 最靠上的已通关关 → 最底一页（第 1 关所在） */
            focusWorld(animated         ) {
        const current = this.currentLevel();
        const hit = this.nodes.find((n) => n.level === current);
        if (hit) {
            this.snapToPage(pageOfY(hit.y), animated);
            return;
        }
        let best                     = null;
        for (const n of this.nodes) if (n.status === 'cleared') best = n;
        this.snapToPage(best ? pageOfY(best.y) : PAGE_COUNT - 1, animated);
    }

            flipTo(next        ) {
        const target = clamp(next, 0, WORLDS.length - 1);
        if (target === this.world || this.flipPhase !== 0) return;
        this.flipTarget = target;
        this.flipPhase = 1;
        this.flipT = 0;
    }

            busyForInput()          {
        return this.flipPhase !== 0 || this.loading !== null;
    }

            onMapStart(e            ) {
        console.log('[map] touch start', this.loading ? '(加载页)' : '', this.flipPhase ? '(翻页中)' : '');
        if (this.busyForInput()) {
            console.log('[map] 触摸被忽略：', this.loading ? '加载页还在' : '正在切换世界');
            return;
        }
        this.snapDur = 0;
        this.dragging = true;
        this.dragMoved = false;
        this.velocity = 0;
        const y = e.getUILocation().y;
        this.dragStartY = y;
        this.lastY = y;
        this.dragStartOffset = this.offset;
    }

            onMapMove(e            ) {
        if (!this.dragging) return;
        const y = e.getUILocation().y;
        const moved = y - this.dragStartY;
        if (!this.dragMoved && Math.abs(moved) > TAP_SLOP) this.dragMoved = true;
        this.velocity = (y - this.lastY) * 0.6 + this.velocity * 0.4;
        this.lastY = y;
        // 手指往上推 → 地图往上走 → 看到下面那页（content.y 增大）
        this.offset = this.rubber(this.dragStartOffset + moved);
        this.applyOffset();
    }

            onMapEnd(e            ) {
        const tapped = this.tappedLevel;
        this.tappedLevel = 0;
        if (!this.dragging) return;
        const wasTap = !this.dragMoved;
        this.endDrag();
        if (!wasTap) return;
        const hit = tapped ? this.nodes.find((n) => n.level === tapped) : undefined;
        console.log('[map] tap', hit ? `第 ${hit.level} 关（${hit.status}）` : '空白处，按坐标再找一次');
        if (hit) this.selectNode(hit);
        else this.tapAt(e);
    }

            onMapCancel() {
        this.endDrag();
    }

            endDrag() {
        if (!this.dragging) return;
        this.dragging = false;
        const v = clamp(this.velocity, -MAX_FLING, MAX_FLING);
        this.snapToPage(this.nearestPage(this.offset + v * FLING_PROJECT), true);
    }

    /** 点击命中哪颗珠：把触点换算回 track 坐标，找最近的那颗 */
            tapAt(e            ) {
        const ui = e.getUILocation();
        const p = this.mapView.getComponent(UITransform) .convertToNodeSpaceAR(new Vec3(ui.x, ui.y, 0));
        const tx = p.x / this.k + TRACK_W / 2;
        const ty = TRACK_H / 2 - (p.y - this.offset) / this.k;
        let best                     = null;
        let bestD = BEAD_D * 0.7;
        for (const n of this.nodes) {
            const d = Math.hypot(n.x - tx, n.y - ty);
            if (d < bestD) { bestD = d; best = n; }
        }
        if (best) {
            this.selectNode(best);
            return;
        }
        // 真机排查：点在珠子上却判成空白时，看触点换算出的 track 坐标离最近的珠子有多远
        let near                     = null;
        let nd = Infinity;
        for (const n of this.nodes) {
            const d = Math.hypot(n.x - tx, n.y - ty);
            if (d < nd) { nd = d; near = n; }
        }
        console.log(`[map] 空白处：ui=(${Math.round(ui.x)},${Math.round(ui.y)}) track=(${Math.round(tx)},${Math.round(ty)})`
            + ` 最近第 ${near ? near.level : '-'} 关，距离 ${Math.round(nd)}（阈值 ${Math.round(BEAD_D * 0.7)}）`);
    }

            selectNode(n             ) {
        if (n.status === 'locked') {
            this.toast.show(n.lockNote ?? MAP_TEXT.locked(Math.max(1, n.level - 1)), 1800);
            return;
        }
        this.openPreview(n.level);
    }

    /* ================================================================ 顶栏 */

            buildTopbar() {
        const top = this.screenH / 2 - this.topInset;

        // 左：返回圆钮（装饰）压在木牌左端；木牌里放头像与昵称
        const bannerW = 420;
        const bannerH = 118;
        const bannerX = -DESIGN_W / 2 + 36 + 122 - 46 + bannerW / 2;
        const bannerY = top - 62;
        const banner = this.makeNode(this.node, 'Banner', bannerW, bannerH, bannerX, bannerY);
        this.makeSprite(banner, 'Bg', 'home/banner', bannerW, bannerH);
        // 头像 / 昵称跟随玩家资料（玩法/profile.ts：微信头像昵称 或 自选预设头像 + 自定义昵称）；
        // 点木牌打开「我的资料」面板
        new AvatarView(banner, 88, -bannerW / 2 + 92 + 28, 0);
        const nick = this.makeLabel(banner, 'Nick', getProfile().nickname, 40, C_NICK, 220, 60, -bannerW / 2 + 92 + 56 + 18 + 110, 0,
            { shadow: true, align: 'left' });
        this.offProfile = onProfileChanged((p) => { if (nick.isValid) nick.string = p.nickname; });
        banner.on(Node.EventType.TOUCH_START, (e            ) => { e.propagationStopped = true; banner.setScale(0.96, 0.96); }, this);
        banner.on(Node.EventType.TOUCH_CANCEL, () => banner.setScale(1, 1), this);
        banner.on(Node.EventType.TOUCH_END, (e            ) => {
            e.propagationStopped = true;
            banner.setScale(1, 1);
            if (!this.busyForInput()) this.profilePanel.show();
        }, this);
        this.makeSprite(this.node, 'Back', 'home/back', 122, 124, -DESIGN_W / 2 + 36 + 61, top - 62);

        // 右：体力胶囊，整块就是「加体力」按钮
        const pillW = 300;
        const pillH = 108;
        const pillX = DESIGN_W / 2 - 36 - pillW / 2;
        const pillY = top - 62;
        const pill = this.makeButton(this.node, 'Stamina', pillW, pillH, pillX, pillY, () => this.onStaminaPlus());
        this.makeSprite(pill, 'Bg', 'home/pill', pillW, pillH);
        this.makeSprite(pill, 'Heart', 'home/heart', 78, 70, -pillW / 2 + 20 + 39, 0);
        this.staminaLabel = this.makeLabel(pill, 'Num', '0', 52, C_WHITE, 110, 70, -pillW / 2 + 20 + 78 + 14 + 55, 0,
            { shadow: true, align: 'left' });
        this.makeSprite(pill, 'Plus', 'home/plus', 84, 86, pillW / 2 - 14 - 42, 0);
        this.countdownLabel = this.makeLabel(this.node, 'Recover', '', 22, C_WHITE, 260, 32, pillX - 37, pillY - pillH / 2 - 20,
            { shadow: true });
    }

            onTick() {
        GS.tick();
        this.refreshTopbar();
    }

    /** 顶栏：体力数字 + 恢复倒计时（满格不显示倒计时） */
            refreshTopbar() {
        if (!this.staminaLabel) return;
        this.staminaLabel.string = String(GS.stamina.available);
        const cd = GS.countdownText();
        this.countdownLabel.string = cd ? MAP_TEXT.staminaCountdown(cd) : '';
    }

    /** 体力 + ：看广告（本地模拟），每日上限由 GS 收口 */
            onStaminaPlus() {
        if (GS.stamina.available >= GS.staminaMax) {
            this.toast.show(ADS.staminaFull, 1400);
            return;
        }
        if (GS.adStaminaLeft <= 0) {
            this.toast.show(ADS.dailyLimit, 2200);
            return;
        }
        this.toast.show('广告播放中…', 1200);
        this.scheduleOnce(() => {
            GS.recordAd();
            if (GS.gainStamina(1)) {
                this.toast.show(HOME.staminaGain(GS.stamina.available, GS.staminaMax), 1400);
            }
        }, 1.2);
    }

    /* ================================================================ 换世界 / 翻页 */

            tabbarTop()         {
        return -this.screenH / 2 + this.bottomInset + TABBAR_H;
    }

            buildWorldNav() {
        const r = 59;
        const y = this.tabbarTop() + 40 + r;
        const make = (name        , glyph        , x        , delta        )       => {
            const n = this.makeButton(this.node, name, r * 2, r * 2, x, y, () => this.flipTo(this.world + delta));
            this.paintGoldCircle(n.addComponent(Graphics), r);
            this.makeLabel(n, 'Glyph', glyph, 78, C_WHITE, r * 2, r * 2, delta < 0 ? -3 : 3, 6, { shadow: true });
            return n;
        };
        this.navPrev = make('WorldPrev', '‹', -DESIGN_W / 2 + 22 + r, -1);
        this.navNext = make('WorldNext', '›', DESIGN_W / 2 - 22 - r, 1);
    }

            buildPager() {
        const r = 49;
        const x = DESIGN_W / 2 - 18 - r;
        const make = (name        , glyph        , y        , delta        )       => {
            const n = this.makeButton(this.node, name, r * 2, r * 2, x, y, () => this.snapToPage(this.page + delta, true));
            this.paintGoldCircle(n.addComponent(Graphics), r);
            this.makeLabel(n, 'Glyph', glyph, 40, C_WHITE, r * 2, r * 2, 0, 0, { shadow: true });
            return n;
        };
        this.pageUp = make('PageUp', '▲', 120, -1);
        this.pageDown = make('PageDown', '▼', -120, 1);
        this.dots = [];
        for (let i = 0; i < PAGE_COUNT; i++) {
            const dot = this.makeButton(this.node, 'Dot_' + i, 40, 40, x, 16 - i * 32, () => this.snapToPage(i, true));
            this.dots.push(dot.addComponent(Graphics));
        }
    }

            paintPager() {
        if (!this.pageUp) return;
        // r=49 与 buildPager 一致：翻到顶页 / 底页时对应箭头置灰
        this.setDisabled(this.pageUp, this.page <= 0, (g, gray) => this.paintGoldCircle(g, 49, gray));
        this.setDisabled(this.pageDown, this.page >= PAGE_COUNT - 1, (g, gray) => this.paintGoldCircle(g, 49, gray));
        this.dots.forEach((g, i) => {
            g.clear();
            g.fillColor = i === this.page ? new Color(245, 183, 61) : new Color(255, 255, 255, 200);
            g.circle(0, 0, 9);
            g.fill();
        });
    }

    /* ================================================================ 底部页签 */

            buildTabbar() {
        const w = DESIGN_W - 48;
        const h = TABBAR_H;
        const bar = this.makeNode(this.node, 'Tabbar', w, h, 0, -this.screenH / 2 + this.bottomInset + h / 2);
        // 页签栏自己吞掉触摸，免得点在缝隙里拖动了地图
        bar.on(Node.EventType.TOUCH_START, (e            ) => { e.propagationStopped = true; }, this);
        const g = bar.addComponent(Graphics);
        g.fillColor = new Color(20, 10, 0, 90);
        g.roundRect(-w / 2, -h / 2 - 10, w, h, 44);
        g.fill();
        g.fillColor = new Color(90, 57, 32);
        g.roundRect(-w / 2, -h / 2, w, h, 44);
        g.fill();
        g.lineWidth = 5;
        g.strokeColor = new Color(58, 35, 18);
        g.roundRect(-w / 2, -h / 2, w, h, 44);
        g.stroke();

        const items = [
            { icon: 'home/tab-home', label: TABBAR.home },
            { icon: 'home/tab-rank', label: TABBAR.leaderboard },
            { icon: 'home/tab-book', label: TABBAR.collection },
            { icon: 'home/tab-gear', label: TABBAR.settings },
        ];
        const tabW = (w - 52) / items.length;
        this.tabs = items.map((it, i) => {
            const x = -w / 2 + 26 + tabW * (i + 0.5);
            const node = this.makeButton(bar, 'Tab_' + i, tabW, h - 28, x, 0, () => this.setTab(i));
            const bg = node.addComponent(Graphics);
            const icon = this.makeSprite(node, 'Icon', it.icon, 84, 78, 0, 20);
            const label = this.makeLabel(node, 'Label', it.label, 26, C_WHITE, tabW, 34, 0, -42);
            return { node, bg, icon, label };
        });
        this.paintTabs();
    }

            paintTabs() {
        this.tabs.forEach((t, i) => {
            const on = i === this.tabIndex;
            const size = t.node.getComponent(UITransform) .contentSize;
            t.bg.clear();
            if (on) {
                t.bg.fillColor = new Color(160, 90, 10, 140);
                t.bg.roundRect(-size.width / 2 + 10, -size.height / 2 - 6, size.width - 20, size.height, 26);
                t.bg.fill();
                t.bg.fillColor = new Color(245, 183, 61);
                t.bg.roundRect(-size.width / 2 + 10, -size.height / 2, size.width - 20, size.height, 26);
                t.bg.fill();
            }
            t.icon.color = on ? C_WHITE : new Color(175, 165, 155, 255);
            t.label.color = on ? new Color(109, 61, 10) : new Color(232, 217, 195);
        });
    }

            setTab(i        ) {
        this.tabIndex = clamp(i, 0, this.tabs.length - 1);
        this.paintTabs();
        if (i === 1) this.panels.show('board');
        else if (i === 2) this.panels.show('collection');
        else if (i === 3) this.panels.show('settings');
        else this.panels.hide();
    }

    /** 面板关掉 → 页签回到「首页」 */
            backToHomeTab = ()       => {
        this.panels.hide();
        this.tabIndex = 0;
        this.paintTabs();
    };

    /* ---- 三个整屏面板（排行榜 / 图鉴 / 设置）：实现在 界面/MapPanels.ts ---- */

    /** 建在地图与浮层控件之上、页签栏之下：面板打开时页签栏仍可切换 */
            buildPanels() {
        this.panels = new MapPanels(this.node, {
            screenH: this.screenH,
            topInset: this.topInset,
            bottomInset: this.bottomInset,
            tabbarH: TABBAR_H,
            toast: (text, ms) => this.toast.show(text, ms),
            onBack: this.backToHomeTab,
            // 「挑战本关」：与 web 同口径 —— 回到主页，弹该关的 PLAY 吊牌让玩家选模式
            onChallenge: (level) => {
                this.backToHomeTab();
                this.world = worldIndexOf(level);
                this.renderMap(false);
                this.openPreview(level);
            },
            onReset: () => this.confirmReset(),
        });
    }

            confirmReset() {
        this.dialog.confirm(SETTINGS.resetConfirmTitle, [SETTINGS.resetConfirmLine], SETTINGS.resetYes, SETTINGS.resetNo, () => {
            GS.reset();
            this.panels.refresh();
            this.world = worldIndexOf(GS.progress.unlocked);
            this.renderMap(true);
            this.refreshTopbar();
            this.toast.show(SETTINGS.resetDone, 2200);
        });
    }

    /* ================================================================ PLAY 吊牌 */

            buildPreview() {
        const H = this.screenH;
        this.preview = this.makeNode(this.node, 'Preview', DESIGN_W, H);
        const dim = this.preview.addComponent(Graphics);
        dim.fillColor = new Color(20, 12, 4, 87);
        dim.rect(-DESIGN_W, -H / 2, DESIGN_W * 2, H);
        dim.fill();
        // 只有直接点在遮罩空白处才关（牌子上的按钮会自己停止冒泡）
        this.preview.on(Node.EventType.TOUCH_END, () => this.closePreview(), this);

        const cardW = 820;
        const cardH = 654;
        this.drop = this.makeNode(this.preview, 'Drop', cardW, H);

        // 麻绳：从屏幕顶垂到牌子
        const ropeH = H / 2 - cardH / 2 + 8;
        const rope = this.makeNode(this.drop, 'Rope', 12, ropeH, 0, cardH / 2 + ropeH / 2 - 8);
        const rg = rope.addComponent(Graphics);
        rg.fillColor = new Color(201, 138, 79);
        rg.roundRect(-6, -ropeH / 2, 12, ropeH, 6);
        rg.fill();

        const card = this.makeNode(this.drop, 'Card', cardW, cardH);
        card.on(Node.EventType.TOUCH_START, (e            ) => { e.propagationStopped = true; }, this);
        card.on(Node.EventType.TOUCH_END, (e            ) => { e.propagationStopped = true; }, this);
        const cg = card.addComponent(Graphics);
        cg.fillColor = new Color(60, 40, 10, 90);
        cg.roundRect(-cardW / 2, -cardH / 2 - 20, cardW, cardH, 38);
        cg.fill();
        cg.fillColor = new Color(255, 248, 231);
        cg.roundRect(-cardW / 2, -cardH / 2, cardW, cardH, 38);
        cg.fill();
        cg.lineWidth = 6;
        cg.strokeColor = C_GOLD;
        cg.roundRect(-cardW / 2, -cardH / 2, cardW, cardH, 38);
        cg.stroke();

        const topY = cardH / 2;
        const close = this.makeButton(card, 'Close', 72, 72, cardW / 2 - 20 - 30, topY - 16 - 30, () => this.closePreview());
        const clg = close.addComponent(Graphics);
        clg.fillColor = new Color(0, 0, 0, 64);
        clg.circle(0, -3, 30);
        clg.fill();
        clg.fillColor = new Color(176, 106, 58);
        clg.circle(0, 0, 30);
        clg.fill();
        this.makeLabel(close, 'X', '✕', 34, C_WHITE, 60, 60);

        this.pvLevelLabel = this.makeLabel(card, 'Level', '', 96, C_BROWN, 700, 110, 0, topY - 72 - 48,
            { outline: C_GOLD, outlineWidth: 3 });

        const modeY = topY - 72 - 96 - 42 - 43;
        const makeMode = (m          , x        )          => {
            const node = this.makeButton(card, 'Mode_' + m, 240, 86, x, modeY, () => this.pickMode(m));
            const g = node.addComponent(Graphics);
            const label = this.makeLabel(node, 'Label', MODE_LABEL[m], 40, C_WHITE, 240, 86);
            return { node, g, label };
        };
        this.pvModes = { normal: makeMode('normal', -132), nightmare: makeMode('nightmare', 132) };

        const starsY = modeY - 43 - 28 - 12 - 30;
        this.pvStarsLabel = this.makeLabel(card, 'Stars', '', 46, C_BROWN, 760, 66, 0, starsY);

        const playY = starsY - 30 - 46 - 65;
        const play = this.makeButton(card, 'Play', 420, 130, 0, playY, () => this.playFromPreview());
        const pg = play.addComponent(Graphics);
        pg.fillColor = new Color(20, 120, 40, 128);
        pg.roundRect(-210, -73, 420, 130, 65);
        pg.fill();
        pg.fillColor = new Color(55, 184, 74);
        pg.roundRect(-210, -65, 420, 130, 65);
        pg.fill();
        pg.fillColor = new Color(107, 227, 107, 200);
        pg.roundRect(-190, 0, 380, 55, 28);
        pg.fill();
        this.makeLabel(play, 'Label', MAP_TEXT.play, 62, C_WHITE, 420, 130, 0, 0, { shadow: true });

        this.preview.active = false;

        this.themedPreview = new ThemedPreview(this.node, {
            mode: () => this.pvMode,
            canHard: (level) => this.canNightmare(level),
            pickMode: (m) => {
                if (m === 'nightmare' && !this.canNightmare(this.pvLevel)) {
                    this.toast.show(MAP_TEXT.nightmareLocked, 2000);
                    return false;
                }
                this.pvMode = m;
                this.applyMode(m);
                return true;
            },
            lines: (m, level) => {
                const l = STAR_LINES_BY_MODE[m]?.[level];
                return l ? [l[0], l[1], l[2]] : null;
            },
            bestStars: (m, level) => recordOf(GS.data.progress[m], level).stars,
            play: () => this.playFromPreview(),
            // 与原吊牌同一层（在 toast 之下）
            siblingIndex: () => this.preview.getSiblingIndex() + 1,
        });
    }

            paintModes() {
        const canHard = this.canNightmare(this.pvLevel);
        (['normal', 'nightmare']              ).forEach((m) => {
            const b = this.pvModes[m];
            const on = m === this.pvMode;
            const locked = m === 'nightmare' && !canHard;
            b.g.clear();
            b.g.fillColor = new Color(0, 0, 0, locked ? 0 : 56);
            b.g.roundRect(-120, -49, 240, 86, 43);
            b.g.fill();
            b.g.fillColor = locked ? new Color(74, 74, 74) : on ? new Color(255, 107, 53) : new Color(90, 90, 90);
            b.g.roundRect(-120, -43, 240, 86, 43);
            b.g.fill();
            b.g.lineWidth = 3;
            b.g.strokeColor = locked ? new Color(138, 138, 138) : new Color(217, 162, 39);
            b.g.roundRect(-120, -43, 240, 86, 43);
            b.g.stroke();
            b.label.string = locked ? `🔒 ${MODE_LABEL[m]}` : MODE_LABEL[m];
            b.label.color = locked ? new Color(216, 216, 216) : C_WHITE;
            // 锁住的困难按钮仍然可点：点了由 pickMode 提示「三星通关后开启」，不能毫无反应
        });
        const line = STAR_LINES_BY_MODE[this.pvMode]?.[this.pvLevel];
        this.pvStarsLabel.string = line ? MAP_TEXT.starLine(line[0], line[2]) : '';
    }

            openPreview(level        ) {
        this.pvLevel = level;
        // 当前是困难但这一关没达门槛 → 退回简单
        this.pvMode = GS.mode === 'nightmare' && !this.canNightmare(level) ? 'normal' : GS.mode;
        // 第 2/3/4 关：与对局皮肤对应的主题窗口（糖果嘉年华 / 果冻乐园 / 贴纸手账）
        const theme = themeForLevel(level).id;
        if (theme !== 'classic') {
            // 主题窗口出错时退回原吊牌：点关卡至少要有反应（错误由运行时画在屏幕顶部，便于截图排查）
            try {
                this.themedPreview.show(level, theme);
                return;
            } catch (err) {
                this.themedPreview.hide();
                reportError(`第 ${level} 关详情窗口`, err);
            }
        }
        this.pvLevelLabel.string = MAP_TEXT.level(level);
        this.paintModes();
        this.preview.active = true;
        this.drop.setPosition(0, this.screenH);
        this.dropT = 0;
    }

            closePreview() {
        this.preview.active = false;
        this.dropT = -1;
        this.themedPreview?.hide();
    }

            pickMode(m          ) {
        if (m === this.pvMode) return;
        if (m === 'nightmare' && !this.canNightmare(this.pvLevel)) {
            this.toast.show(MAP_TEXT.nightmareLocked, 2000);
            return;
        }
        this.pvMode = m;
        this.paintModes();
        this.applyMode(m);
    }

    /** 切模式 = 换一套进度：地图跟着换状态（两套进度分别存） */
            applyMode(m          ) {
        if (GS.mode === m) return;
        GS.setMode(m);
        this.world = worldIndexOf(GS.progress.unlocked);
        this.renderMap(true);
    }

            playFromPreview() {
        // 进关前最后一道闸：困难模式没达门槛不让进
        if (this.pvMode === 'nightmare' && !this.canNightmare(this.pvLevel)) {
            this.toast.show(MAP_TEXT.nightmareLocked, 2600);
            return;
        }
        this.applyMode(this.pvMode);
        this.closePreview();
        this.enterLevel(this.pvLevel);
    }

    /* ================================================================ 加载页 */

            buildLoading() {
        const H = this.screenH;
        const node = this.makeNode(this.node, 'Loading', DESIGN_W, H);
        // 加载期间挡住所有点击
        node.on(Node.EventType.TOUCH_START, (e            ) => { e.propagationStopped = true; }, this);
        const g = node.addComponent(Graphics);
        g.fillColor = new Color(255, 236, 200);
        g.rect(-DESIGN_W, -H / 2, DESIGN_W * 2, H);
        g.fill();
        // 背景图 1536×2730：按 cover 铺满
        const cover = Math.max(DESIGN_W / 1536, H / 2730);
        this.makeSprite(node, 'Bg', 'loading/bg', 1536 * cover, 2730 * cover);

        const barY = -H / 2 + this.bottomInset + 150 + 74;
        const bar = this.makeNode(node, 'Bar', 920, 148, 0, barY);
        this.makeSprite(bar, 'Slot', 'loading/bar-bg', 920, 148);
        this.loadingFill = this.makeNode(bar, 'Fill', 0, 104, -430, 0);
        const fs = this.loadingFill.addComponent(Sprite);
        fs.sizeMode = Sprite.SizeMode.CUSTOM;
        this.loadFrame('loading/bar-fill', (sf) => { if (fs.isValid) fs.spriteFrame = sf; });
        this.loadingNum = this.makeLabel(bar, 'Num', MAP_TEXT.loading(0), 46, C_WHITE, 200, 60, 0, 0, { shadow: true });

        this.loading = node;
        this.loadingOpacity = node.addComponent(UIOpacity);
        this.loadingStart = performance.now();

        // 真实进度：当前世界底图 + 节点珠 + 顶栏 / 页签切图
        const list = PRELOAD_BASE.slice();
        list.unshift('map-v2/' + WORLDS[worldIndexOf(GS.progress.unlocked)].art);
        this.loadTotal = list.length;
        this.loadDone = 0;
        for (const path of list) {
            const done = () => { this.loadDone += 1; };
            this.loadFrame(path, done, done);
        }
    }

            updateLoading(_dt        ) {
        if (!this.loading) return;
        const elapsed = (performance.now() - this.loadingStart) / 1000;

        if (this.loadingFade < 0) {
            const pct = this.loadTotal > 0 ? Math.round(3 + (97 * this.loadDone) / this.loadTotal) : 100;
            const w = (860 * pct) / 100;
            this.loadingFill.getComponent(UITransform) .setContentSize(w, 104);
            this.loadingFill.setPosition(-430 + w / 2, 0);
            this.loadingNum.string = MAP_TEXT.loading(pct);
            if (this.loadDone >= this.loadTotal && elapsed >= LOADING_MIN_S) {
                this.loadingFade = 0;
                this.fadeStart = performance.now();
            }
            return;
        }

        const t = Math.min(1, (performance.now() - this.fadeStart) / LOADING_FADE_S);
        if (this.loadingOpacity) this.loadingOpacity.opacity = Math.round(255 * (1 - t));
        if (t >= 1) {
            this.loading.destroy();
            this.loading = null;
            this.loadingOpacity = null;
        }
    }

    /* ================================================================ 弹窗 / 进关 */

            mountDialogs() {
        const dn = this.makeNode(this.node, 'Dialog', DESIGN_W, this.screenH);
        this.dialog = dn.addComponent(GameDialog);
        const tn = this.makeNode(this.node, 'Toast', DESIGN_W, this.screenH);
        this.toast = tn.addComponent(ToastLayer);
    }

    /** 保证存在名为 Game 的兄弟节点并挂上 GameBootstrap（场景里只预置了 Bootstrap） */
            ensureGameNode()              {
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

    /** 进入关卡：隐藏地图，显示兄弟节点 `Game` 并开局 */
            enterLevel(level        )       {
        const n = this.worldNodes(worldIndexOf(level)).find((x) => x.level === level);
        if (!n || n.status === 'locked') {
            this.toast.show(n?.lockNote ?? HOME.lockedToast, 1600);
            return;
        }
        const game = this.gameNode?.isValid ? this.gameNode : this.ensureGameNode();
        const gb = game?.getComponent(GameBootstrap);
        if (!game || !gb) {
            console.warn('[map] 未找到挂了 GameBootstrap 的 Game 节点');
            this.toast.show('进入关卡失败：缺少 Game 节点', 2000);
            return;
        }
        // ⚠️ 2026-10-23：微信里从 PLAY 进关后，对局里点什么都没反应（编辑器预览正常）。
        // 进关是在 PLAY 按钮的 TOUCH_END 回调里触发的 —— 此刻引擎正在分发这次触摸，
        // 对局节点在分发途中被激活、注册触摸监听，只会进「待加入」队列。
        // 推到下一帧再切换，让对局节点在触摸分发之外激活，监听直接生效。
        console.log(`[map] 进入第 ${level} 关（下一帧切换）`);
        setTimeout(() => {
            if (!game.isValid) return;
            this.node.active = false;
            game.active = true;
            // 再延迟一帧开局：等 GameBootstrap 的 onLoad / start 跑完再 startLevel
            gb.scheduleOnce(() => gb.startLevel(level), 0);
        }, 0);
    }
}
