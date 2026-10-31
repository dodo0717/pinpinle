import { _decorator, Component, Graphics, UITransform, Color, tween, Vec3, UIOpacity, Label, Node, Layers, Sprite, Vec2, LabelShadow } from 'cc';
const { ccclass } = _decorator;

/**
 * 关卡节点 —— 三色**水晶果冻球**（2026-10-31 按用户口径重做）
 *
 *   3 星            = 金色水晶果冻球 + 👑
 *   1~2 星          = 紫色水晶果冻球
 *   未过关（含锁）= 粉色水晶果冻球（锁定的再多一层灰化 + 🔒）
 *
 * 小球几何仍照 Web 实测（docs/dump/web-home.json）：
 * - `.node` 盒 142.08 屏幕 px（= 轨道 202 px × fitScale 0.703）
 * - 珠面直径 133.6 屏幕 px（= 轨道 `--nd` 190 px）
 * - 数字 76 轨道 px → 53 屏幕 px；锁 🔒 79.8 屏幕 px
 * - 珠面外发光双层：`rgba(top,.55) 0 0 30.4px 8.55px` + `.26 0 0 68.4px 20.9px`
 * - 圆柱透视 `SPHERE_ON = false` → 所有珠子一样大，没有缩放 / 倾斜
 * - 当前关珠右下角挂 🐶（Web `.node-pet`）
 *
 * ⚠️ 手段差异（视觉对齐、手段不同）：竖向渐变用逐条带近似；发光/投影用低透明同心圆近似；
 * Web 里 `.node-art` 的 `mix-blend-mode: multiply` 用「贴图 × 状态色」的乘法着色等效。
 */

/** 节点盒（屏幕 px） */
const ND = 142;
/** 珠面直径（屏幕 px） */
const GEL = 133.6;
/** 数字字号（屏幕 px） */
const NUM_SIZE = 53;

/** 三态珠面渐变（上 / 中 / 下）—— 2026-10-31 用户指定的三种水晶色 */
const GEL_BANDS: Record<number, [Color, Color, Color]> = {
  0: [new Color(255, 217, 236, 255), new Color(255, 143, 200, 255), new Color(255, 242, 247, 255)],  // 未过关：粉水晶
  1: [new Color(234, 220, 255, 255), new Color(154, 95, 240, 255), new Color(244, 236, 255, 255)],   // 1~2 星：紫水晶
  3: [new Color(255, 238, 198, 255), new Color(255, 198, 62, 255), new Color(255, 242, 206, 255)],   // 3 星：金水晶
};
/** 锁定态：棕灰色的一颗（谁都不表示的「不可以」色） */
const GEL_LOCKED: [Color, Color, Color] = [
  new Color(198, 196, 196, 255),
  new Color(138, 136, 136, 255),
  new Color(226, 224, 224, 255),
];

@ccclass('LevelNode')
export class LevelNode extends Component {
    private levelNum = 0;
    private isCurrent = false;

    get level() { return this.levelNum; }

    /**
     * @param level 关卡号
     * @param isCurrent 是否当前关（右下角挂 🐶）
     * @param locked 是否未解锁（灰化 + 🔒）
     * @param stars 历史最高星级 0~3（决定球色：0 粉 / 1~2 紫 / 3 金 + 👑）
     */
    init(level: number, isCurrent: boolean, locked: boolean, stars: number): void {
        this.levelNum = level;
        this.isCurrent = isCurrent;
        const state = stars >= 3 ? 3 : stars >= 1 ? 1 : 0;
        this.drawGel(state, locked);
        this.tintBead(state, locked);
        this.drawNum(state, locked);
        if (locked) {
            this.drawLock();
        } else {
            if (isCurrent) this.drawPet();
            if (state === 3) this.drawCrown();
            this.drawRing();
        }
    }

    /* ---------------------------------------------------------------- 珠面 */

    /** 珠面：竖向三段渐变 + 双层外发光 */
    private drawGel(state: number, locked: boolean): void {
        const g = this.node.addComponent(Graphics);
        const bands = locked ? GEL_LOCKED : (GEL_BANDS[state] ?? GEL_BANDS[0]!);
        const r = GEL / 2;
        // 外发光两层（对应 Web 的 30.4px / 68.4px 双阴影）
        g.fillColor = new Color(bands[0]!.r, bands[0]!.g, bands[0]!.b, locked ? 60 : 70);
        g.circle(0, 0, r + 14);
        g.fill();
        g.fillColor = new Color(bands[0]!.r, bands[0]!.g, bands[0]!.b, 40);
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

    /** 珠面贴图着色：Web 是 `mix-blend-mode: multiply`，这里用「贴图 × 状态色」等效 */
    private tintBead(state: number, locked: boolean): void {
        const bead = this.node.getChildByName('Bead');
        const sp = bead?.getComponent(Sprite);
        if (!sp) return;
        if (locked) { sp.color = new Color(150, 150, 150, 255); return; }
        const mid = (GEL_BANDS[state] ?? GEL_BANDS[0]!)[1];
        // 直接乘到状态色上：素材本体是浅灰白（实测平均 rgb(221,226,234)），乘完就是那颗水晶色
        sp.color = new Color(mid.r, mid.g, mid.b, 255);
    }

    /* ---------------------------------------------------------------- 数字 / 锁 / 宠物 / 皇冠 */

    /** 数字：金球上用深棕、粉紫球上用奶白，都加深色投影（近似 Web 的描边 + 投影） */
    private drawNum(state: number, locked: boolean): void {
        const n = new Node('Num');
        n.parent = this.node;
        n.layer = Layers.Enum.UI_2D;
        n.addComponent(UITransform).setContentSize(ND, NUM_SIZE + 8);
        const l = n.addComponent(Label);
        l.string = String(this.levelNum);
        l.fontSize = NUM_SIZE;
        l.lineHeight = NUM_SIZE + 6;
        l.color = locked
            ? new Color(150, 150, 150, 255)
            : state === 3 ? new Color(122, 74, 18, 255) : new Color(255, 246, 230, 255);
        const b = l as unknown as { isBold?: boolean; enableBold?: boolean };
        if (b.isBold === false || b.isBold === undefined) b.isBold = true;
        if (b.enableBold === false) b.enableBold = true;
        const s = n.addComponent(LabelShadow);
        s.shadowColor = state === 3 && !locked ? new Color(255, 240, 200, 180) : new Color(90, 45, 5, 200);
        s.shadowOffset = new Vec2(0, -3);
    }

    /** 未解锁：🔒（Web 就是 emoji，不是程序画的锁） */
    private drawLock(): void {
        const n = new Node('Lock');
        n.parent = this.node;
        n.layer = Layers.Enum.UI_2D;
        n.addComponent(UITransform).setContentSize(80, 80);
        const l = n.addComponent(Label);
        l.string = '🔒';
        l.fontSize = 80;
        l.lineHeight = 80;
    }

    /** 当前关：珠右下角 🐶（Web `.node-pet`） */
    private drawPet(): void {
        this.drawEmoji('Pet', '🐶', 53, 64.6, -34.2);
    }

    /** 3 星：珠右上角 👑 */
    private drawCrown(): void {
        this.drawEmoji('Crown', '👑', 53, 68.4, 95);
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
     * 已解锁珠的金环：当前关是**静态双环**，其余是 1.1s 呼吸（Web 同款）。
     * 圆柱透视关着，所以只有环在动，珠子本身不动。
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
        g.lineWidth = 8;
        g.strokeColor = new Color(255, 215, 0, 170);
        g.circle(0, 0, r);
        g.stroke();
        // 呼吸 1.1s（shim 只跑一轮，真引擎 repeatForever）
        tween(op)
            .to(0.55, { opacity: 100 })
            .to(0.55, { opacity: 255 })
            .union()
            .repeatForever()
            .start();
        tween(n)
            .to(0.55, { scale: new Vec3(1.04, 1.04, 1) })
            .to(0.55, { scale: new Vec3(1, 1, 1) })
            .union()
            .repeatForever()
            .start();
    }
}
