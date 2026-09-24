import { _decorator, Component, Node, Graphics, UITransform, Color, ScrollView, Mask, view, Layers, Size, Label, ResolutionPolicy, HorizontalTextAlignment, VerticalTextAlignment, Sprite, SpriteFrame, resources, Font } from 'cc';
import { LevelNode } from './LevelNode';
import { HomeHUD } from './界面/HomeHUD';
import { GameBootstrap } from './玩法/GameBootstrap';
import { GameDialog } from './玩法/GameDialog';
import { ToastLayer } from './玩法/toast';
import { GS } from './玩法/state';
import { HOME, ADS, COLLECTION, BOARD, SETTINGS } from './玩法/text';
import { unlockedImageIds, COLLECTION_TOTAL } from './玩法/meta';
import { levelStatus, recordOf, buildLevelConfigs, boardSnapshot, type GameMode } from './核心/index';
const { ccclass } = _decorator;

const DESIGN_W = 1080;
const DESIGN_H = 1920;
const MAP_H = 2880;            // v4 定稿 1440×3840 按 1080 屏宽等比缩放后的高度（2 屏）
const LEVEL_COUNT = 10;        // W1 当前 10 关；后续若要扩 20 关，再补一段同规格底图即可

/**
 * 世界1（奶油果园）关卡坐标 —— 基于 v4 定稿图 1440×3840，按 1080×2880 换算
 * x / y 均为底图图片坐标（从顶部 0 往下），程序内部转成「从底部往上」的 yFromBottom
 */
const W1_LEVEL_XY: number[][] = [
  [622, 2682],   // L1
  [628, 2334],   // L2
  [558, 2006],   // L3
  [668, 1742],   // L4
  [616, 1424],   // L5
  [696, 1112],   // L6（当前关）
  [634,  816],   // L7
  [702,  526],   // L8
  [640,  246],   // L9
  [714,   60],   // L10
];

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

/** 关卡气球切片：按 1~10 顺序对应关卡 */
const BALLOON_PATHS: string[] = [
    'map/level_balloon_1', 'map/level_balloon_2', 'map/level_balloon_3', 'map/level_balloon_4', 'map/level_balloon_5',
    'map/level_balloon_6', 'map/level_balloon_7', 'map/level_balloon_8', 'map/level_balloon_9', 'map/level_balloon_10',
];
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

    onLoad() {
        view.setDesignResolutionSize(DESIGN_W, DESIGN_H, ResolutionPolicy.FIXED_WIDTH);
        this.visibleSize = view.getVisibleSize();
        this.screenH = this.visibleSize.height || DESIGN_H;
        // 地图与关卡共用一份全局状态；关卡层先启动时会 init 过，这里保证幂等
        if (!GS.readResult) GS.init();
        this.buildBackdrop();
        this.mountDialogs();
        this.buildLevelPositions();
        this.buildUI();
        this.buildMap();
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

    /** 体力 + ：看广告（本地模拟），每日上限由 GS 收口 */
    private onStaminaPlus() {
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

    /** 关卡坐标：文档 y（图片从上往下）→ 从底部往上量的 y（Cocos content 用） */
    private buildLevelPositions() {
        for (let i = 0; i < LEVEL_COUNT && i < W1_LEVEL_XY.length; i++) {
            const x = W1_LEVEL_XY[i][0];
            const yFromBottom = MAP_H - W1_LEVEL_XY[i][1];
            this.levels.push({ level: i + 1, x, y: yFromBottom });
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

    // ========== 难度切换（互斥两态：普通/困难） ==========
    /** 用户要求"底图互换"：选中项显示黄底，未选中项显示灰底，文字固定为普通/困难 */
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

        // 普通按钮
        const normal = new Node('Normal');
        normal.parent = panel;
        normal.layer = Layers.Enum.UI_2D;
        normal.addComponent(UITransform).setContentSize(bw, bh);
        normal.setPosition(-bw / 2 - gap / 2, 0);
        this.diffNormalYellow = this.makeSprite(normal, 'Yellow', 'ui/难度/home_difficulty_yellow', bw, bh, 0, 0);
        this.diffNormalGray = this.makeSprite(normal, 'Gray', 'ui/难度/home_difficulty_gray', bw, bh, 0, 0);
        this.makeLabel(normal, 'Label', '普通', 0, 0, 44, TEXT_BROWN, 200, 70);

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
        this.content.addComponent(UITransform).setContentSize(DESIGN_W, MAP_H);
        this.content.setPosition(0, MAP_H / 2 - this.viewH / 2);
        scroll.content = this.content;

        this.createMapBackground();
        this.createLevelNodes();

        // 滚动到当前关卡（= 已解锁到的那一关）
        this.scheduleOnce(() => {
            const idx = Math.min(Math.max(GS.progress.unlocked - 1, 0), this.levels.length - 1);
            const offset = Math.max(0, Math.min(MAP_H - this.viewH, this.levels[idx].y - this.viewH / 2));
            this.content.setPosition(0, MAP_H / 2 - this.viewH / 2 - offset);
        }, 0.1);
    }

    /** 底图：1080×2880 切 2 段 1080×1440，从上到下拼 */
    private createMapBackground() {
        const seg = MAP_H / 2;
        this.makeSprite(this.content, 'BgTop', 'map/w1_bg_top', DESIGN_W, seg, 0, MAP_H / 2 - seg / 2);
        this.makeSprite(this.content, 'BgBottom', 'map/w1_bg_bottom', DESIGN_W, seg, 0, -MAP_H / 2 + seg / 2);

        // 新素材藤蔓浮层，盖住原底图藤蔓
        this.makeSprite(this.content, 'Vine', 'map/vine', 152, MAP_H, 0, 0);
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
            node.setPosition(lv.x - DESIGN_W / 2, lv.y - MAP_H / 2);

            // 真实气球切片（含数字），直接覆盖原底图气球，数字即点击区
            this.makeSprite(node, 'Balloon', BALLOON_PATHS[i], BALLOON_W, BALLOON_H, 0, 0);

            const ln = node.addComponent(LevelNode);
            const st = levelStatus(p, lv.level);
            ln.init(lv.level, lv.level === cur, st === 'locked', recordOf(p, lv.level).stars);
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
        if (i === 1) this.showBoardPanel();
        else if (i === 2) this.showCollectionPanel();
        else if (i === 3) this.showSettingsPanel();
    }

    /** 排行榜：当前关的百名榜（灰盒 100 人 + 本机） */
    private showBoardPanel() {
        const level = Math.min(GS.progress.unlocked, LEVEL_COUNT);
        const cfg = buildLevelConfigs(GS.mode)[level - 1];
        if (!cfg) return;
        const best = recordOf(GS.progress, level).boardBest;
        const snap = boardSnapshot(level, { star1: cfg.star1, star2: cfg.star2, star3: cfg.star3 }, best);
        const lines = [`第 ${level} 关 · ${BOARD.total(snap.totalPlayers)}`];
        for (const r of snap.rows.slice(0, 8)) lines.push(`${r.rank}. ${r.name}　${r.score} 分`);
        lines.push(snap.myRank ? BOARD.myRank(snap.myRank) : BOARD.notOnBoard);
        this.dialog.show('排行榜', lines, [{ text: '关闭', onClick: () => {}, primary: true }]);
    }

    /** 图鉴：36 格，已解锁显示图号，未解锁显示问号 */
    private showCollectionPanel() {
        const ids = new Set(unlockedImageIds(GS.progress));
        const lines = [COLLECTION.progress(ids.size, COLLECTION_TOTAL)];
        let row = '';
        for (let i = 0; i < COLLECTION_TOTAL; i++) {
            row += ids.has(i) ? `[${String(i + 1).padStart(2, '0')}] ` : '[??] ';
            if ((i + 1) % 6 === 0) { lines.push(row.trimEnd()); row = ''; }
        }
        if (row) lines.push(row.trimEnd());
        this.dialog.show(COLLECTION.title, lines, [{ text: '关闭', onClick: () => {}, primary: true }]);
    }

    /** 设置：音效 / 背景音乐 / 重置存档 */
    private showSettingsPanel() {
        const s = GS.meta.settings;
        this.dialog.show(SETTINGS.title, [
            `${SETTINGS.sound}：${s.sound ? SETTINGS.on : SETTINGS.off}`,
            `${SETTINGS.bgm}：${s.bgm ? SETTINGS.on : SETTINGS.off}`,
        ], [
            { text: `音效 ${s.sound ? SETTINGS.off : SETTINGS.on}`, onClick: () => { GS.setSound(!s.sound); this.showSettingsPanel(); } },
            { text: `音乐 ${s.bgm ? SETTINGS.off : SETTINGS.on}`, onClick: () => { GS.setBgm(!s.bgm); this.showSettingsPanel(); } },
            { text: SETTINGS.reset, onClick: () => this.confirmReset() },
        ]);
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
            if (this.selectedLevel > 0) this.enterLevel(this.selectedLevel);
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
