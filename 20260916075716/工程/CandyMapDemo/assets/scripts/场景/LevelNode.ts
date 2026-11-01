import {
  _decorator, Component, Graphics, UITransform, Color, tween, UIOpacity, Label, Node, Layers,
  Sprite, Vec2, Font, resources, SpriteFrame,
} from 'cc';
const { ccclass } = _decorator;

// ⚠️ 这里原本引 `paintGlow`（多层同心圆叠出的模糊近似），已移除：
//    每层都是硬边，叠加后是一圈圈同心台阶（毛边）。
//    珠体外发光改用 `assets/resources/ui/fx/` 下预烘好的模糊贴图（canvas `shadowBlur`，
//    与 CSS `box-shadow` 的 blur 同定义 = 2σ），见 `mkGlow()`。

/**
 * 关卡珠 —— **逐值照抄 Web**（`web/ui.css:737-875` + `web/ui/map.ts:857-868`）
 *
 * ## Web 的真实分层（DOM 顺序决定叠放，后来者在上）
 *   ① `.node-art`   `inset:0` 铺满**整个盒**，切图 + `mix-blend-mode: multiply`
 *   ② `.node-gel`   直径 `--nd` 的圆，**不透明**渐变珠体 + 高光 + box-shadow 外发光
 *   ③ 数字 / 🔒 / 🐶 / 🏆（都在 `top: var(--ncy)`，跟着珠圆心走）
 *   ④ `.node::before` AO 椭圆接地影
 *
 * ⚠️ 三个最容易搞错的点：
 * - **珠色来自 gel 的自绘渐变，不是给切图染色**：Web 从头到尾没有给 `--art` 上过色，
 *   切图只做 multiply 纹理与「超出圆外的装饰」（星冠等）。之前把 `sprite.color` 设成状态中色
 *   是自创的，会让整张图连星冠一起被染掉。
 * - **gel 圆心不在盒中心**：`top: var(--ncy)` 是个比例，三态各不相同（47.5% / 37% / 47%）。
 *   之前画在 (0,0)，整个珠体、数字、锁都偏了一点点。
 * - **盒子三态大小不同**：`.node` 宽高 = `nd × 1.0638 / 1.3514 / 1.6129`，
 *   1~2 星珠比待完成珠大 27%，3 星珠大 52% —— 之前统一 142 是错的。
 *
 * 其余口径：
 * - **锁定不是换一颗灰珠**：`filter: grayscale(.82) brightness(.9)` 只加在 `.node-gel` 上。
 * - **锁定珠不显示数字**（`web/ui/map.ts:863`：数字会从锁后露边）。
 * - **Web 没有 👑 节点**：皇冠画在 `node-star3.png` 里。
 * - **呼吸金环只给 `.node.unlocked`**（已通关的珠没有），且**只动画 box-shadow，不动 transform**。
 *
 * ⚠️ 单位换算：Web 的 `--nd` 是**轨道 px**，这里一律用**屏幕 px**（轨道值 × fitScale 0.703125）。
 */

/** Web 的 fitScale（1536 轨道宽 → 1080 屏幕宽）：所有 `nd * k` 的轨道值得乘它才是屏幕值 */
const FIT = 0.703125;

/** 珠面直径 `--nd`（轨道 190 / current 时 206 → 屏幕 px） */
const GEL_D = 190 * FIT;          // ≈133.6
const GEL_D_CURRENT = 206 * FIT;  // ≈144.8（`.map .node.current { --nd: 206px }`，ui.css:874）

/** 数字字号 `nd * 0.40`、锁 `nd * 0.42`、emoji `nd * 0.34`（轨道 px → 屏幕 px） */
const NUM_SIZE = 76 * FIT;        // ≈53.4
const LOCK_SIZE = 79.8 * FIT;     // ≈56.1
const EMOJI_SIZE = 64.6 * FIT;    // ≈45.4

/** 三态贴图（Web `--art` 变量，ui.css:746 / 795 / 808） */
const ART = {
  todo: 'map/node/node-todo',
  star1: 'map/node/node-star1',
  star3: 'map/node/node-star3',
} as const;

/**
 * 三态几何（ui.css:742-743 / 792-794 / 805-807）
 * `boxK` = 盒宽相对 nd 的倍数；`ncy` = 珠圆心在盒内的纵向比例（从**盒顶**往下算）
 */
const GEO: Record<number, { boxK: number; ncy: number }> = {
  0: { boxK: 1.0638, ncy: 0.475 },   // 待完成 / 未解锁
  1: { boxK: 1.3514, ncy: 0.37 },    // 1~2 星
  3: { boxK: 1.6129, ncy: 0.47 },    // 3 星
};

interface GelBand {
  top: Color; mid: Color; bot: Color;
  /** 底部透光色 `--gel-lower`（ui.css:763 / 800 / 813） */
  lower: Color;
  /** 外发光 `--glow` / `--glow2` */
  glow: Color; glow2: Color;
  art: string;
}

/** 三态珠面参数（颜色/发光/贴图逐值取自 ui.css:760-765, 796-802, 809-815） */
const GEL_BANDS: Record<number, GelBand> = {
  0: {
    top: new Color(240, 250, 255, 255),
    mid: new Color(166, 215, 250, 255),
    bot: new Color(74, 143, 212, 255),
    lower: new Color(194, 229, 255, 255),      // #c2e5ff
    glow: new Color(150, 210, 255, 140),
    glow2: new Color(150, 210, 255, 66),
    art: ART.todo,
  },
  1: {
    top: new Color(255, 238, 248, 255),
    mid: new Color(249, 154, 210, 255),
    bot: new Color(207, 61, 144, 255),
    lower: new Color(255, 188, 226, 255),      // #ffbcE2
    glow: new Color(255, 130, 205, 140),
    glow2: new Color(255, 130, 205, 66),
    art: ART.star1,
  },
  3: {
    top: new Color(255, 248, 214, 255),
    mid: new Color(255, 198, 62, 255),
    bot: new Color(238, 124, 0, 255),
    lower: new Color(255, 210, 122, 255),      // #ffd27a
    glow: new Color(255, 180, 60, 153),
    glow2: new Color(255, 180, 60, 77),
    art: ART.star3,
  },
};

/** 数字：Web 是竖向金渐变 `#fff6d0→#ffd75e→#eda12c`（取中间色）+ 2px #9a5a10 描边 + 双层投影 */
const NUM_FILL = new Color(255, 215, 94, 255);
const NUM_SHADOW = new Color(200, 127, 24, 255);

/**
 * Web 的 `filter: grayscale(.82) brightness(.9)`（`ui.css:860`）——作用在**珠体 gel** 上，
 * 不是整颗珠也不是贴图：基色仍是本状态那套渐变，只是褪成灰调。
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

/** 按站点插值：`linear-gradient(180deg, top 5%, mid 46%, bot 94%)`（ui.css:831） */
function gradientAt(stops: Color[], pos: number[], t: number): Color {
  let i = 0;
  while (i < pos.length - 1 && t > pos[i + 1]!) i++;
  const a = i === 0 ? 0 : pos[i]!;
  const b = pos[i + 1] ?? 1;
  const k = b > a ? Math.min(1, Math.max(0, (t - a) / (b - a))) : 0;
  const c0 = stops[i]!;
  const c1 = stops[Math.min(i + 1, stops.length - 1)]!;
  return new Color(
    Math.round(c0.r + (c1.r - c0.r) * k),
    Math.round(c0.g + (c1.g - c0.g) * k),
    Math.round(c0.b + (c1.b - c0.b) * k),
    255,
  );
}

@ccclass('LevelNode')
export class LevelNode extends Component {
    private levelNum = 0;
    private isCurrent = false;
    /** 关卡珠上所有 Label 共用的字体（MapBootstrap 加载完 `font/HarmonyOS_Sans_SC_Medium` 后下发） */
    private fontAsset: Font | null = null;
    /** 珠圆心相对**盒中心**的纵向偏移（+ 为上）—— 数字/锁/宠物/奖杯/金环都以它为基准 */
    private gelY = 0;
    /** 本颗珠的实际盒边长的 nd（屏幕 px） */
    private gelD = GEL_D;

    get level() { return this.levelNum; }

    setFont(f: Font): void {
        this.fontAsset = f;
        for (const l of this.node.getComponentsInChildren(Label)) l.font = f;
    }

    /**
     * @param level 关卡号
     * @param isCurrent 是否当前关（右下角挂 🐶，且整颗珠放大一圈）
     * @param locked 是否未解锁（珠体灰化 + 🔒，且不显示数字）
     * @param stars 历史最高星级 0~3（决定珠色、贴图与**盒子大小**：0 蓝白 / 1~2 粉 / 3 金）
     * @param isWorldEnd 是否本世界最后一关（`level === WORLDS[w].to` → 挂 🏆）
     */
    init(level: number, isCurrent: boolean, locked: boolean, stars: number, isWorldEnd = false): void {
        this.levelNum = level;
        this.isCurrent = isCurrent;
        const state = stars >= 3 ? 3 : stars >= 1 ? 1 : 0;
        const geo = GEO[state] ?? GEO[0]!;

        // ⚠️ 盒子大小与珠心位置都由这里统一决定：MapBootstrap 建节点时给的是初值，
        //    真正该多大要等拿到 stars / isCurrent 才知道。
        this.gelD = isCurrent ? GEL_D_CURRENT : GEL_D;
        const box = this.gelD * geo.boxK;
        this.gelY = box / 2 - geo.ncy * box;   // `top: var(--ncy)` → 换算到以盒中心为原点
        this.node.getComponent(UITransform)?.setContentSize(box, box);

        const band = GEL_BANDS[state] ?? GEL_BANDS[0]!;
        this.paintArt(band, box);
        this.drawAo();
        this.drawGel(state, locked);
        if (!locked) this.drawNum();          // Web：锁定珠不显示数字
        if (locked) {
            this.drawLock();
        } else {
            if (isCurrent) this.drawPet();
            // 呼吸金环只给「已解锁未通关」（Web `.node.unlocked`，cleared 的珠没有）
            if (state === 0) this.drawRing();
        }
        // ⚠️ 🏆 与锁定无关：Web 的判断只有 `level === WORLDS[w].to`（web/ui/map.ts:868），
        //    排在 if/else 之外 —— `docs/dump/web-home.json` 里第 12 关节点文本就是 `🔒🏆`。
        if (isWorldEnd) this.drawTrophy();
        // 字体是异步加载的：本节点建好时如果字体已经到了，这里补一次
        if (this.fontAsset) this.setFont(this.fontAsset);
    }

    /* ---------------------------------------------------------------- 切图层 */

    /**
     * `.node-art`（ui.css:771-775）：`position:absolute; inset:0` → **铺满整个盒子**，
     * `background: var(--art) 0 0 / 100% 100% no-repeat`，`mix-blend-mode: multiply`。
     *
     * ⚠️ 之前这里干了三件 Web 没有的事：给贴图 `color` 染色、 MonoBehaviour染色、把贴图往下挪 3.5px。
     *    Web 只是把它整块铺在盒子上当纹理（白底透出下面 gel 的浓郁渐变，深色细节保留），
     *     Cocos 的 Sprite 没有 multiply 混合模式，这里退化为「原图直接铺满 + 不染色」。
     */
    private paintArt(band: GelBand, box: number): void {
        // ⚠️ 贴图节点由这里自己建：**不能让 MapBootstrap 先用 todo 图铺一个**。
        //    两条 `resources.load` 回调谁后到谁生效，实测结果是 todo 图把 star1/star3 顶掉了。
        let bead = this.node.getChildByName('Bead');
        if (!bead) {
            bead = new Node('Bead');
            bead.parent = this.node;
            bead.layer = Layers.Enum.UI_2D;
            bead.addComponent(UITransform);
            bead.addComponent(Sprite).sizeMode = Sprite.SizeMode.CUSTOM;
        }
        bead.getComponent(UITransform)?.setContentSize(box, box);
        bead.setPosition(0, 0);
        const sp = bead.getComponent(Sprite)!;
        sp.color = new Color(255, 255, 255, 255);   // 不染色
        resources.load(`${band.art}/spriteFrame`, SpriteFrame, (err, sf) => {
            if (err || !sf || !this.isValid) return;
            sp.spriteFrame = sf;
        });
    }

    /* ---------------------------------------------------------------- 珠底 AO */

    /**
     * 珠下接触阴影（Web `.map .node::before`，ui.css:779-790）：
     * `top: calc(var(--ncy) + var(--nd) * 0.56)`（从盒顶算），`nd*0.95 × nd*0.24` 的椭圆，
     * 两层 radial：内层 `rgba(18,8,34,.24)` 小而深（42%×46%）、外层 `rgba(18,8,34,.10)` 大而淡（66%×60%）。
     */
    private drawAo(): void {
        const n = new Node('Ao');
        n.parent = this.node;
        n.layer = Layers.Enum.UI_2D;
        n.setSiblingIndex(0);
        // Web 是从盒顶往下量 `top: calc(var(--ncy) + var(--nd) * 0.56)`；
        // 换算到以盒中心为原点就是「珠心再往下 nd*0.56」（`gelY` 已经是珠心）。
        const aoY = this.gelY - this.gelD * 0.56;
        // Web 的 AO 是两层 `radial-gradient`（**纯 CSS 平滑渐变**）：
        //   radial(42% 46% at 50% 48%, rgba(18,8,34,.24), 72%) + radial(66% 60% at 50% 46%, ...10%, 74%)
        // ⚠️ 用预烘贴图（canvas `createRadialGradient`，与 CSS 同口径），
        //    不要用「8 层同心椭圆叠加」——那是一圈圈同心台阶（毛边）。
        n.addComponent(UITransform).setContentSize(this.gelD * 0.95, this.gelD * 0.24);
        n.setPosition(0, aoY);
        const sp = n.addComponent(Sprite);
        sp.sizeMode = Sprite.SizeMode.CUSTOM;
        resources.load('ui/fx/ao-bead/spriteFrame', SpriteFrame, (err, sf) => {
            if (err || !sf || !n.isValid) return;
            sp.spriteFrame = sf;
        });
    }

    /* ---------------------------------------------------------------- 珠面 */

    /**
     * `.node-gel`（ui.css:822-836）：直径 `--nd` 的圆，背景是**四层**叠加，
     *   ① 左上大白高光  `radial(26% 18% at 27% 18%, #fff, 70%)`
     *   ② 中上柔白光    `radial(44% 34% at 33% 25%, rgba(255,255,255,.92), 64%)`
     *   ③ 底部透光      `radial(64% 52% at 50% 96%, var(--gel-lower), 72%)`
     *   ④ 竖向主渐变    `linear(180deg, top 5%, mid 46%, bot 94%)`
     * 外加两层 box-shadow 外发光：`0 0 nd*.16 nd*.045 glow` + `0 0 nd*.36 nd*.11 glow2`。
     */
    private drawGel(state: number, locked: boolean): void {
        const raw = GEL_BANDS[state] ?? GEL_BANDS[0]!;
        const dim = (c: Color): Color => (locked ? grayscale(c, 0.82, 0.9) : c);
        // ⚠️ gel 必须是**子节点**：Cocos 里子节点永远渲染在父节点之上，
        //    直接把 Graphics 加到 this.node 的话，它会被 Bead 子节点盖住；
        //    而 Web 的顺序是 art 在下、gel 在上（`map.ts:860-861`，后来者居上）。
        const r = this.gelD / 2;
        const d = this.gelD;
        const cy = this.gelY;

        // ① 外发光（Web 的两层 `box-shadow`：`0 0 d*.16 d*.045 glow` + `0 0 d*.36 d*.11 glow2`）
        // ⚠️ 用**预烘焙的模糊贴图**（canvas `shadowBlur`，与 CSS box-shadow 的 blur 同定义=2σ），
        //    不要用「多层同心圆叠加」—— 每层都是硬边，叠出来就是一圈圈同心台阶（毛边）。
        //    贴图是白色，颜色/强度由 `sprite.color` 调制；形状只跟 `r0:blur` 比例有关，
        //    所以 d 变化时整张等比缩放即可复用（`GEL_D` 基准）。
        // ⚠️ 发光要在 gel **之前**插为兄弟节点，否则子节点会盖住珠体。
        this.mkGlow('Glow2', 'ui/fx/glow-bead-2', (r + d * 0.11 + d * 0.36) * 2, cy, dim(raw.glow2));
        this.mkGlow('Glow1', 'ui/fx/glow-bead-1', (r + d * 0.045 + d * 0.16) * 2, cy, dim(raw.glow));

        const gel = new Node('Gel');
        gel.parent = this.node;
        gel.layer = Layers.Enum.UI_2D;
        gel.addComponent(UITransform).setContentSize(this.gelD, this.gelD);
        const g = gel.addComponent(Graphics);

        // ② 珠体主渐变：站点 5% / 46% / 94%
        const stops = [dim(raw.top), dim(raw.mid), dim(raw.bot)];
        const N = 40;
        for (let i = 0; i < N; i++) {
            const t = (i + 0.5) / N;                    // 0 = 顶
            const rel = (r - d * t);                    // 条带中心相对圆心的纵向偏移（带符号）
            const half = Math.sqrt(Math.max(0, r * r - rel * rel));
            if (half <= 0.5) continue;
            g.fillColor = gradientAt(stops, [0.05, 0.46, 0.94], t);
            g.rect(-half, cy + rel - d / N / 2, half * 2, d / N + 0.6);
            g.fill();
        }

        // ③ 三层高光（坐标以 gel 盒左上为原点的百分比 → 换算到圆心为原点，y 轴向上为正）
        this.radial(g, cy, -0.23 * d, 0.32 * d, 0.26 * d, 0.18 * d, new Color(255, 255, 255, 255), 0.70);
        this.radial(g, cy, -0.17 * d, 0.25 * d, 0.44 * d, 0.34 * d, new Color(255, 255, 255, 235), 0.64);
        this.radial(g, cy, 0, -0.46 * d, 0.64 * d, 0.52 * d, dim(raw.lower), 0.72);
    }

    /** 铺一张预烘焙的辉光贴图（白色贴图 + `color` 调制），插在 gel 之前当底层 */
    private mkGlow(name: string, res: string, size: number, cy: number, c: Color): Node {
        const n = new Node(name);
        n.parent = this.node;
        n.layer = Layers.Enum.UI_2D;
        n.addComponent(UITransform).setContentSize(size, size);
        n.setPosition(0, cy);          // 跟着珠心（`--ncy`）走
        const sp = n.addComponent(Sprite);
        sp.sizeMode = Sprite.SizeMode.CUSTOM;
        sp.color = c;
        resources.load(`${res}/spriteFrame`, SpriteFrame, (err, sf) => {
            if (err || !sf || !n.isValid) return;
            sp.spriteFrame = sf;
        });
        return n;
    }

    /** `radial-gradient(rx ry at cx cy, color, transparent stop)`：多层椭圆近似（Graphics 无渐变） */
    private radial(g: Graphics, baseY: number, dx: number, dy: number, rx: number, ry: number, c: Color, stop: number): void {
        for (let i = 10; i >= 1; i--) {
            const t = i / 10;
            if (t > stop * 1.35) continue;
            const a = Math.max(0, Math.round(c.a * Math.max(0, (stop - t) / stop) ** 1.2));
            if (a <= 0) continue;
            g.fillColor = new Color(c.r, c.g, c.b, a);
            g.ellipse(dx, baseY + dy, rx * t, ry * t);
            g.fill();
        }
    }

    /* ---------------------------------------------------------------- 数字 / 锁 / 宠物 / 奖杯 */

    /** 数字：金渐变立体字 + 深棕投影（Web `-webkit-text-stroke` 无等效能力，用投影近似） */
    private drawNum(): void {
        const n = new Node('Num');
        n.parent = this.node;
        n.layer = Layers.Enum.UI_2D;
        n.addComponent(UITransform).setContentSize(this.gelD, NUM_SIZE + 8);
        n.setPosition(0, this.gelY);   // `top: var(--ncy)`
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
        n.setPosition(0, this.gelY);
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
        this.drawEmoji('Pet', '🐶', EMOJI_SIZE, 64.6 * FIT, this.gelY - 34.6 * FIT);
    }

    /** 本世界最后一关：🏆（Web `.node-trophy` 偏移 `translate(nd*0.36, nd*-0.50)`） */
    private drawTrophy(): void {
        this.drawEmoji('Trophy', '🏆', EMOJI_SIZE, 68.4 * FIT, this.gelY + 95 * FIT);
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
     * 呼吸金环（Web `.node.unlocked::after`，ui.css:863-875）：**圆心也在 `--ncy`**，
     * - 当前关是静态双环（`.node.current.unlocked::after { animation: none; ... }`）；
     * - 其余是 1.1s 呼吸，**只动画 box-shadow 的 spread，不动节点 transform**
     *   （transform 要留给地图滚动的翻滚角）。
     */
    private drawRing(): void {
        // 金环的辉光 `0 0 30px 12px rgba(255,215,0,.85)` → 预烘焙贴图（和珠子外发光同口径），
        //    不用「多层同心圆叠加」（那是一圈圈硬边台阶 = 毛边）。
        //    白色贴图 + `color` 调制；必须排在 Ring **之前**（兄弟），否则会盖住环。
        const glow = this.mkGlow('RingGlow', 'ui/fx/glow-ring', (this.gelD / 2 - 4 + 12 + 30) * 2, this.gelY, new Color(255, 215, 0, 217));
        const n = new Node('Ring');
        n.parent = this.node;
        n.layer = Layers.Enum.UI_2D;
        n.addComponent(UITransform).setContentSize(this.gelD, this.gelD);
        n.setPosition(0, this.gelY);
        const g = n.addComponent(Graphics);
        const r = this.gelD / 2 - 4;
        if (this.isCurrent) {
            // 静态：0 0 0 8px rgba(255,215,0,.45) + 0 0 30px 12px rgba(255,215,0,.85)
            g.lineWidth = 8;
            g.strokeColor = new Color(255, 215, 0, 115);
            g.circle(0, 0, r);
            g.stroke();
            return;
        }
        const op = n.addComponent(UIOpacity);
        // Web 呼吸的是 `box-shadow` 的 spread，所以**辉光要跟着环一起呼吸**，不能环在动辉光不动
        const gop = glow.addComponent(UIOpacity);
        // spread 0→24px 用「描边环 + 淡出」近似：透明度呼吸，节点尺寸保持不动
        g.lineWidth = 8;
        g.strokeColor = new Color(255, 215, 0, 170);
        g.circle(0, 0, r);
        g.stroke();
        const pulse = (o: UIOpacity): void => {
            tween(o)
                .to(0.55, { opacity: 100 })
                .to(0.55, { opacity: 255 })
                .union()
                .repeatForever()
                .start();
        };
        pulse(op);
        pulse(gop);
    }
}
