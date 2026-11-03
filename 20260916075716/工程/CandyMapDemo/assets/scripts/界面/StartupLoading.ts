/**
 * 启动加载页（2026-11-03，从小游戏线 `MapBootstrap.buildLoading` 移植，改成独立组件）
 *
 * 为什么要有：小游戏端 `resources` 是远程包，引擎插屏一结束就进首页，此时底图 / 关卡珠 / 顶栏切图
 * 还在从服务器下载 —— 玩家看到的是「空壳首页，图一张张冒出来」。这里先盖一整屏加载页，
 * 进度条按首屏素材**真实下载数**走，下完（且至少停留 MIN_S）再淡出。
 *
 * 版式对齐 Web `#loading`（web/ui.css `.loading-*`）：整页背景图 cover 铺满 → 底部 920×148 进度槽
 * （槽图 `bar-bg`，填充 `bar-fill` 裁在内芯 860×104）→ 槽中央百分比 → 槽下方两行**健康游戏忠告**
 * （国内提审要求加载页常驻，文案在 `玩法/text.ts` 的 `LOADING.healthAdvice`）。
 *
 * ⚠️ 显示期间挡住所有点击。
 * ⚠️ 某张图加载失败也算「完成一项」：进度不能卡死，最多 MAX_S 秒后无论如何进首页。
 * ⚠️ 不 import `Tween`：预览 shim 没导出它。
 */

import {
  _decorator, Component, Node, UITransform, Graphics, Label, Color, Layers, Sprite, SpriteFrame,
  UIOpacity, resources, tween, HorizontalTextAlignment, VerticalTextAlignment,
} from 'cc';
import { applyUiFont, preloadUiFont } from './fontUtil';
import { LOADING } from '../玩法/text';

const { ccclass } = _decorator;

/** 最短停留：太快一闪而过反而像出错（与 Web / 小游戏线一致） */
const MIN_S = 1.2;
/** 最长等待：网络很差时也要进首页，缺的图由各自的 load 再补 */
const MAX_S = 10;
const FADE_S = 0.5;

/** 背景图原尺寸（ui/loading/bg.jpg） */
const BG_W = 1536;
const BG_H = 2730;
const BAR_W = 920;
const BAR_H = 148;
/** 填充裁在槽的内芯：左右各让 30、上下各让 22（Web `.loading-clip`） */
const FILL_W = 860;
const FILL_H = 104;
/** 槽中心离舞台底边：Web `bottom: 170px` + 槽高一半 */
const BAR_BOTTOM = 170 + BAR_H / 2;

const C_UNDER = new Color(255, 236, 200);
const C_PCT = new Color(255, 255, 255);
const C_PCT_SHADOW = new Color(140, 70, 20, 166);
const C_ADVICE = new Color(110, 72, 40);

@ccclass('StartupLoading')
export class StartupLoading extends Component {
  private fill: Node = null!;
  private pct: Label = null!;
  private pctShadow: Label = null!;
  private total = 1;
  private done = 0;
  private elapsed = 0;
  private fading = false;
  private onFinish: (() => void) | null = null;

  /**
   * @param paths 首屏要先下好的贴图（resources 路径，不含 `/spriteFrame`）
   * @param onFinish 淡出结束、节点销毁后回调（在这里开始后台预下载等后续工作）
   */
  static show(parent: Node, w: number, h: number, paths: readonly string[], onFinish: () => void): StartupLoading {
    const root = new Node('StartupLoading');
    root.layer = Layers.Enum.UI_2D;
    root.addComponent(UITransform).setContentSize(w, h);
    root.parent = parent;
    root.setSiblingIndex(parent.children.length - 1);
    const comp = root.addComponent(StartupLoading);
    comp.onFinish = onFinish;
    comp.build(w, h);
    comp.startLoading(paths);
    return comp;
  }

  private build(w: number, h: number): void {
    const root = this.node;
    const swallow = (e: { propagationStopped: boolean }): void => { e.propagationStopped = true; };
    root.on(Node.EventType.TOUCH_START, swallow, this);
    root.on(Node.EventType.TOUCH_END, swallow, this);
    root.addComponent(UIOpacity);

    // 底色：背景图到之前、以及窄长屏上下留边处都是这片暖米色（不露黑）
    const g = root.addComponent(Graphics);
    g.fillColor = C_UNDER;
    g.rect(-w, -h, w * 2, h * 2);
    g.fill();

    const cover = Math.max(w / BG_W, h / BG_H);
    this.sprite(root, 'Bg', 'ui/loading/bg', BG_W * cover, BG_H * cover, 0, 0);

    const barY = -h / 2 + BAR_BOTTOM;
    const bar = this.box(root, 'Bar', BAR_W, BAR_H, 0, barY);
    this.sprite(bar, 'Slot', 'ui/loading/bar-bg', BAR_W, BAR_H, 0, 0);
    this.fill = this.sprite(bar, 'Fill', 'ui/loading/bar-fill', 0, FILL_H, -FILL_W / 2, 0).node;

    // 百分比：白字 + 下移 3px 的棕色投影（Web `.loading-num` 的 text-shadow）
    this.pctShadow = this.label(bar, 'PctShadow', LOADING.pct(0), 46, C_PCT_SHADOW, 0, -3, 240);
    this.pct = this.label(bar, 'Pct', LOADING.pct(0), 46, C_PCT, 0, 0, 240);

    LOADING.healthAdvice.forEach((line, i) => {
      this.label(root, 'Health' + i, line, 30, C_ADVICE, 0, barY - BAR_H / 2 - 40 - i * 42, 1000, 'medium');
    });
  }

  private startLoading(paths: readonly string[]): void {
    // 字体也算一项：首页文字在字体到之前会先用系统字，到了再跳一下
    this.total = paths.length + 1;
    const step = (): void => { this.done += 1; };
    for (const p of paths) {
      resources.load(p + '/spriteFrame', SpriteFrame, (err) => {
        if (err) console.warn('[loading] 素材加载失败（不阻塞）: ' + p);
        step();
      });
    }
    void preloadUiFont().then(step, step);
    this.render(0);
  }

  update(dt: number): void {
    if (this.fading) return;
    this.elapsed += dt;
    const ratio = this.total > 0 ? this.done / this.total : 1;
    // 起步给 3%：一进来就是 0% 像卡住
    this.render(Math.round(3 + 97 * Math.min(1, ratio)));
    const loaded = this.done >= this.total;
    if ((loaded && this.elapsed >= MIN_S) || this.elapsed >= MAX_S) {
      if (!loaded) console.warn('[loading] 等待超时，直接进首页');
      this.fadeOut();
    }
  }

  private render(p: number): void {
    const w = (FILL_W * p) / 100;
    this.fill.getComponent(UITransform)!.setContentSize(w, FILL_H);
    this.fill.setPosition(-FILL_W / 2 + w / 2, 0, 0);
    this.pct.string = LOADING.pct(p);
    this.pctShadow.string = LOADING.pct(p);
  }

  private fadeOut(): void {
    this.fading = true;
    this.render(100);
    const op = this.node.getComponent(UIOpacity)!;
    tween(op)
      .to(FADE_S, { opacity: 0 })
      .call(() => {
        const cb = this.onFinish;
        this.onFinish = null;
        this.node.destroy();
        cb?.();
      })
      .start();
  }

  /* ---------------------------------------------------------------- 小工具 */

  private box(parent: Node, name: string, w: number, h: number, x: number, y: number): Node {
    const n = new Node(name);
    n.layer = Layers.Enum.UI_2D;
    n.addComponent(UITransform).setContentSize(w, h);
    n.setPosition(x, y, 0);
    n.parent = parent;
    return n;
  }

  private sprite(parent: Node, name: string, path: string, w: number, h: number, x: number, y: number): Sprite {
    const sp = this.box(parent, name, w, h, x, y).addComponent(Sprite);
    sp.sizeMode = Sprite.SizeMode.CUSTOM;
    resources.load(path + '/spriteFrame', SpriteFrame, (err, sf) => {
      if (err || !sf || !sp.node?.isValid) return;
      sp.spriteFrame = sf;
    });
    return sp;
  }

  private label(parent: Node, name: string, text: string, size: number, color: Color, x: number, y: number,
    w: number, weight: 'bold' | 'medium' = 'bold'): Label {
    const l = this.box(parent, name, w, size + 16, x, y).addComponent(Label);
    l.string = text;
    l.fontSize = size;
    l.lineHeight = size + 8;
    l.color = color;
    l.horizontalAlign = HorizontalTextAlignment.CENTER;
    l.verticalAlign = VerticalTextAlignment.CENTER;
    applyUiFont(l, weight);
    return l;
  }
}
