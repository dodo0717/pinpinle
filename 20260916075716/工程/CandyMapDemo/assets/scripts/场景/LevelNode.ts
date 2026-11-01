import {
  _decorator, Component, Graphics, UITransform, Color, tween, UIOpacity, Label, Node, Layers,
  Sprite, Vec2, Font, resources, SpriteFrame,
} from 'cc';
const { ccclass } = _decorator;

/**
 * 关卡珠 —— **逐值照抄 Web**（`web/ui.css:755-875` + `docs/dump/web-home.json`）
 *
 * Web 的三态（`.node` / `.n-s1` / `.n-s3`）是三条互相独立的 CSS 分支，**不是同一颗珠换色**：
 * | 状态 | 珠体渐变（上/中/下） | 外发光 | 切图 |
 * |---|---|---|---|
 * | 待完成 / 未解锁 | `#f0faff / #a6d7fa / #4a8fd4` 蓝白 | `rgba(150,210,255,.55/.26)` | `node-todo.png` |
 * | 1~2 星 | `#ffeef8 / #f99ad2 / #cf3d90` 糖果粉 | `rgba(255,130,205,.55/.26)` | `node-star1.png` |
 * | 3 星 | `#fff8d6 / #ffc63e / #ee7c00` 黄金 | `rgba(255,180,60,.6/.3)` | `node-star3.png`（星冠在图里） |
 *
 * 其它几条容易踩的口径：
 * - **锁定不是换一颗灰珠**：Web 只是在蓝白珠上加 `filter: grayscale(.82) brightness(.9)`。
 * - **锁定珠不显示数字**（`web/ui/map.ts:863` 注释写明「数字会从锁后露边」）。
 * - **Web 没有 👑 节点**：皇冠画在 `node-star3.png` 里，`ui.css` 里搜不到 `.node-crown`。
 * - **呼吸金环只给 `.node.unlocked`** —— 已通关（cleared）的珠没有。
 * - **呼吸只改 box-shadow，不动 transform**（`ui.css:862-872`，滚动翻滚角要留给 transform）。
 * - **珠底接触阴影 AO** 必须有，否则珠是飘的（`ui.css:776-790`）。
 *
 * ⚠️ 单位换算：Web 里 `--nd` 是**轨道 px**，这里都用**屏幕 px**（轨道值 × fitScale 0.703125）。
 */

/** 节点盒 / 珠面直径 / 数字字号（屏幕 px，与 `docs/dump/web-home.json` 实测一致） */
const ND = 142;
const GEL = 133.6;
const NUM_SIZE = 53;
/** Web 的 fitScale（1536 轨道宽 → 1080 屏幕宽）：所有 `nd * k` 的轨道值得乘它才是屏幕值 */
const FIT = 0.703125;

/** 三态贴图（Web `--art` 变量） */
const ART = {
  todo: 'map/node/node-todo',
  star1: 'map/node/node-star1',
  star3: 'map/node/node-star3',
} as const;

interface GelBand {
  top: Color; mid: Color; bot: Color;
  /** Web `--glow` / `--glow2` */
  glow: Color; glow2: Color;
  art: string;
}

/** 三态珠面参数（颜色/发光/贴图逐值取自 ui.css:760-765, 796-802, 809-815） */
const GEL_BANDS: Record<number, GelBand> = {
  0: {
    top: new Color(240, 250, 255, 255),
    mid: new Color(166, 215, 250, 255),
    bot: new Color(74, 143, 212, 255),
    glow: new Color(150, 210, 255, 140),
    glow2: new Color(150, 210, 255, 66),
    art: ART.todo,
  },
  1: {
    top: new Color(255, 238, 248, 255),
    mid: new Color(249, 154, 210, 255),
    bot: new Color(207, 61, 144, 255),
    glow: new Color(255, 130, 205, 140),
    glow2: new Color(255, 130, 205, 66),
    art: ART.star1,
  },
  3: {
    top: new Color(255, 248, 214, 255),
    mid: new Color(255, 198, 62, 255),
    bot: new Color(238, 124, 0, 255),
    glow: new Color(255, 180, 60, 153),
    glow2: new Color(255, 180, 60, 77),
    art: ART.star3,
  },
};

/** 数字：Web 是竖向金渐变 `#fff6d0→#ffd75e→#eda12c`（取自中间色）+ 2px #9a5a10 描边 + 双层投影 */
const NUM_FILL = new Color(255, 215, 94, 255);
const NUM_SHADOW = new Color(200, 127, 24, 255);
/** 锁 / 宠物 / 奖杯：Web `font-size: nd*0.42 / nd*0.34`（轨道 px）→ 屏幕 px */
const LOCK_SIZE = 79.8 * FIT;    // ≈56.1（`nd * 0.42`）
const EMOJI_SIZE = 64.6 * FIT;   // ≈45.4（`nd * 0.34`）

/**
 * Web 的 `filter: grayscale(.82) brightness(.9)`（`ui.css:860`）——作用在**珠体**上，
 * 所以基色仍是蓝白珠，只是褪成灰蓝，不是换成另一套灰。
 */
function grayscale(c: Color, amount: number, bright: number): Color {
  const g = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
  return new Color(
    Math.round((c.r + (g - c.r) * amount) * bright),
    Math.round((c.g + (g - c.g) * amount) * bright),
    Math.round((c.b + (g - c.b) * amount) * bright),
    c.a,
  );
}

@ccclass('LevelNode')
export class LevelNode extends Component {
    private levelNum = 0;
    private isCurrent = false;
    /** 关卡珠上所有 Label 共用的字体（MapBootstrap 加载完 `font/HarmonyOS_Sans_SC_Medium` 后下发） */
    private fontAsset: Font | null = null;

    get level() { return this.levelNum; }

    setFont(f: Font): void {
        this.fontAsset = f;
        for (const l of this.node.getComponentsInChildren(Label)) l.font = f;
    }

    /**
     * @param level 关卡号
     * @param isCurrent 是否当前关（右下角挂 🐶）
     * @param locked 是否未解锁（珠体灰化 + 🔒，且不显示数字）
     * @param stars 历史最高星级 0~3（决定珠色与贴图：0 蓝白 / 1~2 粉 / 3 金）
     * @param isWorldEnd 是否本世界最后一关（`level === WORLDS[w].to` → 挂 🏆）
     */
    init(level: number, isCurrent: boolean, locked: boolean, stars: number, isWorldEnd = false): void {
        this.levelNum = level;
        this.isCurrent = isCurrent;
        const state = stars >= 3 ? 3 : stars >= 1 ? 1 : 0;
        this.drawAo();
        this.drawGel(state, locked);
        this.paintBead(state, locked);
        if (!locked) this.drawNum();          // Web：锁定珠不显示数字
        if (locked) {
            this.drawLock();
        } else {
            if (isCurrent) this.drawPet();
            // 呼吸金环只给「已解锁未通关」（Web `.node.unlocked`，cleared 的珠没有）
            if (state === 0) this.drawRing();
        }
        // ⚠️ 🏆 与锁定无关：Web 的判断只有 `level === WORLDS[w].to`（web/ui/map.ts:867），
        //    排在 if/else 之外 —— `docs/dump/web-home.json` 里第 12 关节点文本就是 `🔒🏆`。
        if (isWorldEnd) this.drawTrophy();
        // 字体是异步加载的：本节点建好时如果字体已经到了，这里补一次
        if (this.fontAsset) this.setFont(this.fontAsset);
    }

    /* ---------------------------------------------------------------- 珠底 AO */

    /**
     * 珠下接触阴影（Web `.map .node::before`）：压扁的椭圆贴在珠底，
     * 是「坐在路面上」的关键 —— 没有它珠就是飘的（`ui.css:776-790`）。
     * 尺寸 `nd*0.95 × nd*0.24` = 126.9×32.0 屏幕 px，圆心落在珠心下方 `nd*0.56` = 74.8 屏幕 px。
     * 两层：外层大范围淡影 rgba(18,8,34,.10) + 内层小范围深影 rgba(18,8,34,.24)。
     */
    private drawAo(): void {
        const n = new Node('Ao');
        n.parent = this.node;
        n.layer = Layers.Enum.UI_2D;
        n.setSiblingIndex(0);
        const g = n.addComponent(Graphics);
        const layers: Array<[number, number]> = [
            [1.0, 26],    // .10 × 255
            [0.46, 61],   // .24 × 255（范围更小、更深）
        ];
        for (const [k, alpha] of layers) {
            for (let i = 5; i >= 0; i--) {
                const t = (i + 1) / 6;
                g.fillColor = new Color(18, 8, 34, Math.max(0, Math.round(alpha * (1 - t) ** 1.6)));
                g.ellipse(0, -74.8, (126.9 / 2) * k * t, (32 / 2) * k * t);
                g.fill();
            }
        }
    }

    /* ---------------------------------------------------------------- 珠面 */

    /** 珠面：竖向三段渐变 + 双层外发光（`--glow` / `--glow2`） */
    private drawGel(state: number, locked: boolean): void {
        const g = this.node.addComponent(Graphics);
        const raw = GEL_BANDS[state] ?? GEL_BANDS[0]!;
        const bands: [Color, Color, Color] = locked
            ? [
                grayscale(raw.top, 0.82, 0.9),
                grayscale(raw.mid, 0.82, 0.9),
                grayscale(raw.bot, 0.82, 0.9),
            ]
            : [raw.top, raw.mid, raw.bot];
        const r = GEL / 2;
        g.fillColor = locked ? grayscale(raw.glow, 0.82, 0.9) : raw.glow;
        g.circle(0, 0, r + 14);
        g.fill();
        g.fillColor = locked ? grayscale(raw.glow2, 0.82, 0.9) : raw.glow2;
        g.circle(0, 0, r + 26);
        g.fill();
        // 珠面三段渐变；条带按圆轮廓裁半宽
        for (let i = 0; i < 3; i++) {
            const cy = r - (i + 0.5) * (GEL / 3);   // 条带中心到珠心的距离（带符号）
            const half = Math.sqrt(Math.max(0, r * r - cy * cy));
            g.fillColor = bands[i]!;
            g.rect(-half, cy - GEL / 6, half * 2, GEL / 3 + 0.5);
            g.fill();
        }
    }

    /**
     * 切图 + 着色：Web 的 `.node-art` 是 `mix-blend-mode: multiply`（当纹理用），
     * 这里用「贴图 × 状态中色」等效，并把 `--art` 的三张图按星级换掉。
     */
    private paintBead(state: number, locked: boolean): void {
        const bead = this.node.getChildByName('Bead');
        const sp = bead?.getComponent(Sprite);
        if (!sp) return;
        const band = GEL_BANDS[state] ?? GEL_BANDS[0]!;
        const mid = locked ? grayscale(band.mid, 0.82, 0.9) : band.mid;
        sp.color = new Color(mid.r, mid.g, mid.b, 255);
        // 默认那张 todo 图 MapBootstrap 已经铺好了，只有 1~2 星 / 3 星要换
        if (band.art === ART.todo) return;
        resources.load(`${band.art}/spriteFrame`, SpriteFrame, (err, sf) => {
            if (err || !sf || !this.isValid) return;
            sp.spriteFrame = sf;
        });
    }

    /* ---------------------------------------------------------------- 数字 / 锁 / 宠物 / 奖杯 */

    /** 数字：金渐变立体字 + 深棕投影（Web `-webkit-text-stroke` 无等效能力，用投影近似） */
    private drawNum(): void {
        const n = new Node('Num');
        n.parent = this.node;
        n.layer = Layers.Enum.UI_2D;
        n.addComponent(UITransform).setContentSize(ND, NUM_SIZE + 8);
        const l = n.addComponent(Label);
        l.string = String(this.levelNum);
        l.fontSize = NUM_SIZE;
        l.lineHeight = NUM_SIZE + 6;
        l.color = NUM_FILL;
        const b = l as unknown as { isBold?: boolean; enableBold?: boolean };
        if (b.isBold === false || b.isBold === undefined) b.isBold = true;
        if (b.enableBold === false) b.enableBold = true;
        // ⚠️ 3.8.2 起走 Label 自带的阴影属性（`LabelShadow` 的 color/offset 已废弃）
        l.enableShadow = true;
        l.shadowColor = NUM_SHADOW;
        l.shadowOffset = new Vec2(0, -3);
    }

    /** 未解锁：🔒（Web 就是 emoji，不是程序画的锁）；`font-size: nd*0.42` → 56.1 屏幕 px */
    private drawLock(): void {
        const n = new Node('Lock');
        n.parent = this.node;
        n.layer = Layers.Enum.UI_2D;
        n.addComponent(UITransform).setContentSize(LOCK_SIZE, LOCK_SIZE);
        const l = n.addComponent(Label);
        l.string = '🔒';
        l.fontSize = LOCK_SIZE;
        l.lineHeight = LOCK_SIZE;
        l.enableShadow = true;   // drop-shadow(0 3px 6px rgba(0,0,0,.22))
        l.shadowColor = new Color(0, 0, 0, 56);
        l.shadowOffset = new Vec2(0, -3);
    }

    /** 当前关：珠右下角 🐶（Web `.node-pet` 偏移 `translate(nd*0.34, nd*0.18)` → 屏幕 45.4 / 24.3） */
    private drawPet(): void {
        this.drawEmoji('Pet', '🐶', EMOJI_SIZE, 64.6 * FIT, -34.6 * FIT);
    }

    /** 本世界最后一关：🏆（Web `.node-trophy` 偏移 `translate(nd*0.36, nd*-0.50)`） */
    private drawTrophy(): void {
        this.drawEmoji('Trophy', '🏆', EMOJI_SIZE, 68.4 * FIT, 95 * FIT);
    }

    private drawEmoji(name: string, glyph: string, size: number, x: number, y: number): void {
        const n = new Node(name);
        n.parent = this.node;
        n.layer = Layers.Enum.UI_2D;
        n.addComponent(UITransform).setContentSize(size, size);
        n.setPosition(x, y);
        const l = n.addComponent(Label);
        l.string = glyph;
        l.fontSize = size;
        l.lineHeight = size;
    }

    /* ---------------------------------------------------------------- 金环 */

    /**
     * 呼吸金环（Web `.node.unlocked::after`）：
     * - 当前关是静态双环（`.node.current.unlocked::after { animation: none; ... }`）；
     * - 其余是 1.1s 呼吸，**只动画 box-shadow 的 spread，不动节点 transform**
     *   （`ui.css:862-872`，transform 要留给地图滚动的翻滚角）。
     */
    private drawRing(): void {
        const n = new Node('Ring');
        n.parent = this.node;
        n.layer = Layers.Enum.UI_2D;
        n.addComponent(UITransform).setContentSize(ND, ND);
        n.setPosition(0, 0);
        const g = n.addComponent(Graphics);
        const r = ND / 2 - 4;
        if (this.isCurrent) {
            // 静态：0 0 0 8px rgba(255,215,0,.45) + 0 0 30px 12px rgba(255,215,0,.85)
            g.fillColor = new Color(255, 215, 0, 55);
            g.circle(0, 0, r + 16);
            g.fill();
            g.lineWidth = 8;
            g.strokeColor = new Color(255, 215, 0, 115);
            g.circle(0, 0, r);
            g.stroke();
            return;
        }
        const op = n.addComponent(UIOpacity);
        // spread 0→24px 用「描边环 + 淡出」近似：透明度呼吸，节点尺寸保持不动
        g.lineWidth = 8;
        g.strokeColor = new Color(255, 215, 0, 170);
        g.circle(0, 0, r);
        g.stroke();
        tween(op)
            .to(0.55, { opacity: 100 })
            .to(0.55, { opacity: 255 })
            .union()
            .repeatForever()
            .start();
    }
}
