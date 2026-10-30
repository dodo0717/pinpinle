import { Node, UITransform, Sprite, SpriteFrame, Label, Color, Layers, resources, Vec3 } from 'cc';

/**
 * 布局节点描述 —— 全部数据来自 layout/*.json，代码里不出现任何业务坐标。
 * dock=top/bottom 表示贴屏幕上下边，inset 为距边距离；屏幕比例变化时自动跟随，
 * 不需要为每种机型改坐标。
 */
export interface UINodeSpec {
    id: string;
    type?: 'sprite' | 'text' | 'node';
    res?: string;                 // resources 下的图片路径（不含扩展名）
    x?: number;                   // 相对父节点中心的 x
    y?: number;                   // 未指定 dock 时的 y
    w?: number;
    h?: number;
    dock?: 'top' | 'bottom' | 'center';
    inset?: number;               // dock 时的边距
    color?: number[];             // [r,g,b] 或 [r,g,b,a]
    text?: string;
    fontSize?: number;
    lineHeight?: number;
    slot?: boolean;               // 登记为动态挂载点
    children?: UINodeSpec[];
}

export interface UILayoutDoc {
    design: { w: number; h: number };
    nodes: UINodeSpec[];
}

const cache = new Map<string, SpriteFrame>();

/**
 * 通用 UI 构建器：把 JSON 描述变成节点树。
 * 新增页面只需新增一份 JSON，不写页面专属代码。
 */
export class UIBuilder {
    private slots = new Map<string, Node>();
    private nodes = new Map<string, Node>();
    private vw: number;
    private vh: number;

    // 不写 `constructor(private vw: number, ...)`：TS 参数属性在浏览器直跑的
    // 类型擦除（Node 的 stripTypeScriptTypes）里不受支持，会让整个模块加载失败
    constructor(vw: number, vh: number) {
        this.vw = vw;
        this.vh = vh;
    }

    /** 预加载本页用到的所有图片，避免首帧闪白 */
    static preload(doc: UILayoutDoc): Promise<void> {
        const paths: string[] = [];
        const walk = (list: UINodeSpec[]) => {
            for (const s of list) {
                if (s.res) paths.push(s.res);
                if (s.children) walk(s.children);
            }
        };
        walk(doc.nodes);
        const jobs = paths.filter(p => !cache.has(p)).map(p => new Promise<void>(res => {
            resources.load(p + '/spriteFrame', SpriteFrame, (err, sf) => {
                if (!err && sf) cache.set(p, sf);
                res();
            });
        }));
        return Promise.all(jobs).then(() => undefined);
    }

    build(root: Node, doc: UILayoutDoc) {
        for (const s of doc.nodes) this.buildOne(s, root);
    }

    private buildOne(spec: UINodeSpec, parent: Node): Node {
        const n = new Node(spec.id);
        n.parent = parent;
        n.layer = Layers.Enum.UI_2D;
        const w = spec.w ?? 0;
        const h = spec.h ?? 0;
        n.addComponent(UITransform).setContentSize(w, h);

        let y = spec.y ?? 0;
        if (spec.dock === 'top') y = this.vh / 2 - (spec.inset ?? 0) - h / 2;
        else if (spec.dock === 'bottom') y = -this.vh / 2 + (spec.inset ?? 0) + h / 2;
        n.setPosition(spec.x ?? 0, y);

        if (spec.res) {
            const sp = n.addComponent(Sprite);
            const sf = cache.get(spec.res);
            if (sf) sp.spriteFrame = sf;
            else {
                resources.load(spec.res + '/spriteFrame', SpriteFrame, (err, loaded) => {
                    if (!err && loaded && n.isValid) sp.spriteFrame = loaded;
                });
            }
            if (spec.color) {
                const c = spec.color;
                sp.color = new Color(c[0], c[1], c[2], c[3] ?? 255);
            }
        }

        if (spec.type === 'text') {
            const lb = n.addComponent(Label);
            lb.string = spec.text ?? '';
            lb.fontSize = spec.fontSize ?? 32;
            lb.lineHeight = spec.lineHeight ?? (spec.fontSize ?? 32) + 6;
            if (spec.color) {
                const c = spec.color;
                lb.color = new Color(c[0], c[1], c[2], c[3] ?? 255);
            }
        }

        this.nodes.set(spec.id, n);
        if (spec.slot) this.slots.set(spec.id, n);
        if (spec.children) for (const c of spec.children) this.buildOne(c, n);
        return n;
    }

    node(id: string) { return this.nodes.get(id) ?? null; }
    slot(id: string) { return this.slots.get(id) ?? null; }
}
