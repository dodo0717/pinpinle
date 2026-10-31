import { _decorator, Component, Graphics, UITransform, Color, tween, Vec3, UIOpacity, Label, Node, Layers, Sprite, Vec2, LabelShadow } from 'cc';
const { ccclass } = _decorator;

/**
 * 关卡节点（果冻珠）—— 2026-10-31 按 Web 版逐层重建。
 *
 * Web 实测（docs/dump/web-home.json，`--probe web-home`）：
 * - `.node` 盒 142.08×142.08 屏幕 px（= 轨道 202 px × fitScale 0.703）
 * - `.node-gel` 直径 133.57 屏幕 px（= 轨道 `--nd` 190 px）
 * - `.node-num` 字号 76 轨道 px → 53 屏幕 px（金色渐变字 + 深棕描边）
 * - `.node-lock` 🔒 79.8 屏幕 px
 * - `.node-pet` 🐶 只在**当前关**出现；`.node-trophy` 🏆 只在**本世界最后一关**出现
 * - 珠面外发光：`rgba(150,210,255,.55) 0 0 30.4px 8.55px` + `.26 0 0 68.4px 20.9px`
 * - 未解锁的一律 `grayscale(.82) brightness(.9)`（不换珠形，只是变灰）
 * - 当前关：静态金环（`0 0 0 8px rgba(255,215,0,.45)` + `0 0 30px 12px rgba(255,215,0,.85)`）
 *   其余已解锁珠：金环 1.1s 呼吸
 * - 圆柱透视 `SPHERE_ON = false` → **所有珠子一样大，没有缩放/倾斜**
 */

/** 节点盒（屏幕 px） */
const ND = 142;
/** 珠面直径（屏幕 px） */
const GEL = 133.6;
/** 数字字号（屏幕 px） */
const NUM_SIZE = 53;

/** 三态珠面渐变（上 / 中 / 下），与 web/index.html 的 .node-gel 一致 */
const GEL_BANDS: Record<number, [Color, Color, Color]> = {
  0: [new Color(220, 243, 255, 255), new Color(166, 215, 250, 255), new Color(255, 255, 255, 255)], // todo：#dcf3ff → #a6d7fa → #ffffff
  1: [new Color(255, 225, 245, 255), new Color(249, 154, 210, 255), new Color(255, 255, 255, 255)], // 1 星：#ffe1f5 → #f99ad2
  3: [new Color(255, 238, 198, 255), new Color(255, 198, 62, 255), new Color(255, 242, 206, 255)],  // 3 星：#ffeec6 → #ffc63e → #fff2ce
};
/** 未解锁：grayscale(.82) brightness(.9) 的等效渐变（灰化后按亮度折算） */
const GEL_GRAY: [Color, Color, Color] = [
  new Color(214, 214, 214, 255),
  new Color(152, 152, 152, 255),
  new Color(230, 230, 230, 255),
];

@ccclass('LevelNode')
export class LevelNode extends Component {
    private levelNum = 0;
    private isCurrent = false;
    private ringNode: Node | null = null;

    get level() { return this.levelNum; }

    /**
     * @param level 关卡号
     * @param isCurrent 是否当前关
     * @param locked 是否未解锁
     * @param stars 历史最高星级 0~3（决定珠形：todo / 1星 / 3星）
     * @param toLevel 本世界最后一关号（挂 🏆）
     */
    init(level: number, isCurrent: boolean, locked: boolean, stars: number, toLevel = 0): void {
        this.levelNum = level;
        this.isCurrent = isCurrent;
        const state = stars >= 3 ? 3 : stars >= 1 ? 1 : 0;
        this.drawGel(state, locked);
        this.tintBead(state, locked);
        this.drawNum(locked);
        if (locked) {
            this.drawLock();
        } else {
            if (isCurrent) this.drawPet();
            if (toLevel > 0 && level === toLevel) this.drawTrophy();
            this.drawRing();
        }
    }

    /* ---------------------------------------------------------------- 珠面 */

    /** 珠面：竖向三段渐变 + 外发光（真引擎无渐变/无模糊 → 逐条带 + 低透明圆近似） */
    private drawGel(state: number, locked: boolean): void {
        const g = this.node.addComponent(Graphics);
        const bands = locked ? GEL_GRAY : (GEL_BANDS[state] ?? GEL_BANDS[0]!);
        const r = GEL / 2;
        // 外发光：两层低透明圆（对应 Web 的 30.4px/68.4px 双阴影）
        const gt = locked ? new Color(180, 180, 180, 255) : bands[0]!;
        g.fillColor = new Color(gt.r, gt.g, gt.b, locked ? 60 : 70);
        g.circle(0, 0, r + 14);
        g.fill();
        g.fillColor = new Color(gt.r, gt.g, gt.b, 40);
        g.circle(0, 0, r + 26);
        g.fill();
        // 珠面三段渐变（上 1/3 / 中 1/3 / 下 1/3）：条带按圆轮廓裁半宽
        for (let i = 0; i < 3; i++) {
            const cy = r - (i + 0.5) * (GEL / 3);   // 条带中心到珠心的距离（带符号）
            const half = Math.sqrt(Math.max(0, r * r - cy * cy));
            g.fillColor = bands[i]!;
            g.rect(-half, cy - GEL / 6, half * 2, GEL / 3 + 0.5);
            g.fill();
        }
    }

    /**
     * 珠面贴图着色 —— Web 是 `.node-art { mix-blend-mode: multiply }`，
     * 真引擎的 Sprite 没有现成的混合模式开关，用「贴图 × 中段色」的乘法着色等效。
     */
    private tintBead(state: number, locked: boolean): void {
        const bead = this.node.getChildByName('Bead');
        const sp = bead?.getComponent(Sprite);
        if (!sp) return;
        sp.color = locked
            ? new Color(150, 150, 150, 255)
            : new Color(
                Math.round(((GEL_BANDS[state] ?? GEL_BANDS[0]!)[1].r + 255) / 2),
                Math.round(((GEL_BANDS[state] ?? GEL_BANDS[0]!)[1].g + 255) / 2),
                Math.round(((GEL_BANDS[state] ?? GEL_BANDS[0]!)[1].b + 255) / 2),
                255,
            );
    }

    /* ---------------------------------------------------------------- 数字 / 锁 / 宠物 / 奖杯 */

    /** 数字：金色（Web 是 `background-clip:text` 的渐变 + 深棕描边，这里用金 + 深影近似立体感） */
    private drawNum(locked: boolean): void {
        const n = new Node('Num');
        n.parent = this.node;
        n.layer = Layers.Enum.UI_2D;
        n.addComponent(UITransform).setContentSize(ND, NUM_SIZE + 8);
        const l = n.addComponent(Label);
        l.string = String(this.levelNum);
        l.fontSize = NUM_SIZE;
        l.lineHeight = NUM_SIZE + 6;
        l.color = locked ? new Color(150, 150, 150, 255) : new Color(255, 210, 100, 255);
        const b = l as unknown as { isBold?: boolean; enableBold?: boolean };
        if (b.isBold === false || b.isBold === undefined) b.isBold = true;
        if (b.enableBold === false) b.enableBold = true;
        const s = n.addComponent(LabelShadow);
        s.shadowColor = new Color(90, 45, 5, 200);
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

    /** 本世界最后一关：珠右上角 🏆（Web `.node-trophy`） */
    private drawTrophy(): void {
        this.drawEmoji('Trophy', '🏆', 53, 68.4, 95);
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
     * 已解锁珠的金环：当前关是**静态双环**，其余是 1.1s 呼吸。
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
        this.ringNode = n;
        // 呼吸 1.1s：与 Web 的 keyframes 同周期（shim 只跑一轮，真引擎 repeatForever）
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
