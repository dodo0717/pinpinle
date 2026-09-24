import {
    _decorator, Component, Node, view, Sprite, Label, Graphics,
    Color, Layers, UITransform, resources, JsonAsset,
} from 'cc';
import { UIBuilder } from './UIBuilder';
// `UILayoutDoc` 只是类型：浏览器直跑时会被擦掉，必须走 `import type`，
// 否则运行时报 "does not provide an export named 'UILayoutDoc'"，整页黑屏
import type { UILayoutDoc } from './UIBuilder';

const { ccclass } = _decorator;

const TINT_DIFF_ON = new Color(255, 236, 150, 255);
const TINT_DIFF_OFF = new Color(255, 255, 255, 255);
const MASK_GRAY = new Color(146, 146, 152, 190);

const DIFF_IDS = ['diffNormal', 'diffHard'];
const TAB_IDS = ['tabHome', 'tabCollection', 'tabRank', 'tabSettings'];

/**
 * 首页 HUD —— 顶栏 / 难度切换 / 底导航。
 * 布局全部来自 layout/home_hud.json，本文件不含任何坐标常量。
 * 任何场景只要挂上这个组件就有一套完整 HUD，换场景不需要重新调位置。
 */
@ccclass('HomeHUD')
export class HomeHUD extends Component {

    onDifficulty: (index: number) => void = () => { };
    onTab: (index: number) => void = () => { };
    onPlus: () => void = () => { };
    /** 布局构建完成（异步加载 JSON 之后），业务方可在此填动态文本 */
    onReady: () => void = () => { };

    private builder: UIBuilder = null!;
    private diffBtns: Node[] = [];
    private diffMasks: Node[] = [];
    private diffIndex = 0;

    start() {
        if (!this.node.getComponent(UITransform)) this.node.addComponent(UITransform);
        const vs = view.getVisibleSize();
        resources.load('layout/home_hud', JsonAsset, (err, asset) => {
            if (err || !asset) { console.warn('[HomeHUD] 布局加载失败', err); return; }
            const doc = (asset as JsonAsset).json as UILayoutDoc;
            UIBuilder.preload(doc).then(() => {
                if (!this.node?.isValid) return;
                this.builder = new UIBuilder(vs.width, vs.height);
                this.builder.build(this.node, doc);
                this.setupDifficulty();
                this.bindTabs();
                this.onReady();
            });
        });
    }

    /** 更新文本节点（昵称 / 等级 / 体力 / 倒计时） */
    setText(id: string, value: string) {
        const n = this.builder?.node(id);
        if (!n) return;
        const lb = n.getComponent(Label);
        if (lb) lb.string = value;
    }

    setDifficulty(index: number) {
        this.diffIndex = index;
        this.applyDifficulty();
    }

    private setupDifficulty() {
        for (const id of DIFF_IDS) {
            const n = this.builder.node(id);
            if (!n) continue;
            const ui = n.getComponent(UITransform);
            const w = ui ? ui.width : 0;
            const h = ui ? ui.height : 0;

            const mask = new Node('GrayMask');
            mask.parent = n;
            mask.layer = Layers.Enum.UI_2D;
            mask.addComponent(UITransform).setContentSize(w, h);
            const g = mask.addComponent(Graphics);
            g.fillColor = MASK_GRAY;
            g.roundRect(-w / 2, -h / 2, w, h, 26);
            g.fill();

            this.diffBtns.push(n);
            this.diffMasks.push(mask);
            const idx = this.diffBtns.length - 1;
            n.on(Node.EventType.TOUCH_END, () => this.onDifficulty(idx), this);
        }
        this.applyDifficulty();
    }

    private applyDifficulty() {
        for (let i = 0; i < this.diffBtns.length; i++) {
            const sp = this.diffBtns[i].getComponent(Sprite);
            const on = i === this.diffIndex;
            if (sp) sp.color = on ? TINT_DIFF_ON : TINT_DIFF_OFF;
            if (this.diffMasks[i]) this.diffMasks[i].active = !on;
        }
    }

    private bindTabs() {
        TAB_IDS.forEach((id, i) => {
            const n = this.builder.node(id);
            if (n) n.on(Node.EventType.TOUCH_END, () => this.onTab(i), this);
        });
        const plus = this.builder.node('plusHit');
        if (plus) plus.on(Node.EventType.TOUCH_END, () => this.onPlus(), this);
    }
}
