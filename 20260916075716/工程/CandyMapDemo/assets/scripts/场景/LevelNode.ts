import { _decorator, Component, Graphics, UITransform, Color, tween, Vec3, UIOpacity, Label, Node, Font } from 'cc';
const { ccclass } = _decorator;

/** 未解锁：在气球上叠一层半透明灰遮罩 */
const MASK_LOCKED = new Color(55, 55, 65, 150);

/**
 * 关卡节点 —— v4 定稿底图上已画好气球与数字
 * 这里只负责：当前关金色呼吸光晕、未解锁灰遮罩 + 锁
 */
@ccclass('LevelNode')
export class LevelNode extends Component {
    private isCurrent = false;
    private levelNum = 0;
    private isSelected = false;
    private glowNode: Node | null = null;
    private highlightNode: Node | null = null;
    private g: Graphics = null!;

    get level() { return this.levelNum; }

    /** @param stars 历史最高星级 0~3；>0 会在气球下方点亮对应数量的星 */
    init(level: number, isCurrent: boolean, locked = false, stars = 0) {
        this.levelNum = level;
        this.isCurrent = isCurrent;
        this.drawDecor();
        if (locked) {
            this.drawMaskAndLock();
        } else {
            if (stars > 0) this.drawStars(stars);
            if (isCurrent) this.playGlowAnimation();
        }
    }

    /**
     * 选中态 —— 首次点击只选中（数字提亮），再点一次才进入关卡，
     * 所以选中必须有明确反馈，否则用户不知道点中了没。
     */
    setSelected(on: boolean) {
        if (this.isSelected === on) return;
        this.isSelected = on;
        if (this.highlightNode?.isValid) {
            this.highlightNode.destroy();
            this.highlightNode = null;
        }
        if (on) this.drawHighlight();
    }

    /** 选中高亮：中心柔光把底图上的数字整片提亮 + 一圈亮色描边 */
    private drawHighlight() {
        const n = new Node('Selected');
        n.parent = this.node;
        n.layer = this.node.layer;
        n.addComponent(UITransform);
        const g = n.addComponent(Graphics);

        // 数字是底图的一部分，无法单独改色，只能靠叠加柔光整体提亮
        g.fillColor = new Color(255, 238, 170, 115);
        g.circle(0, 4, 74);
        g.fill();

        // 亮色描边环：和「当前关」的金色呼吸光晕区分开
        g.lineWidth = 6;
        g.strokeColor = new Color(255, 232, 120, 235);
        g.circle(0, 0, 118);
        g.stroke();

        this.highlightNode = n;
    }

    /** 星级：气球正下方 3 颗小星，已得的金色、未得的暗色 */
    private drawStars(stars: number) {
        const g = this.node.addComponent(Graphics);
        const r = 11;
        const gap = 30;
        const y = -74;
        for (let i = 0; i < 3; i++) {
            const x = (i - 1) * gap;
            g.fillColor = i < stars ? new Color(255, 208, 64, 255) : new Color(120, 110, 100, 180);
            // 五角星：外接圆 r、内接圆 r*0.45
            const pts: number[] = [];
            for (let k = 0; k < 10; k++) {
                const rad = k % 2 === 0 ? r : r * 0.45;
                const ang = -Math.PI / 2 + (k * Math.PI) / 5;
                pts.push(x + Math.cos(ang) * rad, y + Math.sin(ang) * rad);
            }
            g.moveTo(pts[0], pts[1]);
            for (let k = 2; k < pts.length; k += 2) g.lineTo(pts[k], pts[k + 1]);
            g.close();
            g.fill();
        }
    }

    /** 仅绘制交互状态装饰，不重复画气球与数字 */
    private drawDecor() {
        const r = 118;  // 光晕/遮罩半径，紧贴底图气球（缩到 1080 宽后气球直径约 230~240）

        if (this.isCurrent) {
            this.glowNode = new Node('Glow');
            this.glowNode.parent = this.node;
            this.glowNode.layer = this.node.layer;
            this.glowNode.addComponent(UITransform);
            const gg = this.glowNode.addComponent(Graphics);
            const rings = [8, 16, 26];
            const alphas = [200, 130, 70];
            for (let i = 0; i < rings.length; i++) {
                gg.lineWidth = 4;
                gg.strokeColor = new Color(255, 200, 60, alphas[i]);
                gg.circle(0, 0, r + rings[i]);
                gg.stroke();
            }
        }

        // 透明占位圆，给节点一个可点击的视觉边界
        const g = this.node.addComponent(Graphics);
        this.g = g;
        g.fillColor = new Color(0, 0, 0, 0);
        g.circle(0, 0, r);
        g.fill();
    }

    /** 未解锁：灰色遮罩 + 锁 */
    private drawMaskAndLock() {
        const r = 105;
        const g = this.node.addComponent(Graphics);
        g.fillColor = MASK_LOCKED;
        g.circle(0, 0, r);
        g.fill();
        this.drawLock();
    }

    /** 未解锁：锁（程序画，美术不出） */
    private drawLock() {
        const g = this.node.addComponent(Graphics);
        const s = 28;
        g.fillColor = new Color(250, 245, 235, 255);
        g.roundRect(-s / 2, -s / 2 - 4, s, s * 0.78, 5);
        g.fill();
        g.lineWidth = 7;
        g.strokeColor = new Color(250, 245, 235, 255);
        g.arc(0, -s / 2 - 4, s * 0.34, Math.PI, 0, true);
        g.stroke();
    }

    private playGlowAnimation() {
        tween(this.node)
            .to(0.9, { scale: new Vec3(1.10, 1.10, 1) }, { easing: 'sineInOut' })
            .to(0.9, { scale: new Vec3(1, 1, 1) }, { easing: 'sineInOut' })
            .union()
            .repeatForever()
            .start();

        if (this.glowNode) {
            const op = this.glowNode.addComponent(UIOpacity);
            tween(op)
                .to(0.9, { opacity: 120 })
                .to(0.9, { opacity: 255 })
                .union()
                .repeatForever()
                .start();
        }
    }
}
