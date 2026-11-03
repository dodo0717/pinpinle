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

/**
 * 自身三张图（背景 / 槽 / 填充）最多等多久就开始建首页：网络很差时也不能一直停在纯色底上。
 * ⚠️ 2026-11-03：原来首页与加载页同时发请求，背景图（700 KB）排在首页 28 张切图后面，
 *    实测「一片黄，进度快到 100 才出背景」。现在先只下这三张，到齐（或超时）才建首页。
 */
const SELF_MAX_S = 1.5;
/** 背景图尺寸（ui/loading/bg.jpg，2026-11-03 从 1536×2730 缩到 1080×1920，700 KB → 360 KB） */
const BG_W = 1080;
const BG_H = 1920;
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
  /** 自身三张图到了几张（到齐或超时 SELF_MAX_S 才进第二阶段） */
  private selfDone = 0;
  private selfTotal = 0;
  private started = false;
  private paths: readonly string[] = [];
  /** 第一阶段建的文字，等第二阶段再套 UI 字体 */
  private labels: Array<[Label, 'bold' | 'medium']> = [];
  private onReady: (() => void) | null = null;
  private onFinish: (() => void) | null = null;

  /**
   * 两阶段：① 先只下加载页自己的三张图（背景 / 槽 / 填充），让玩家第一眼就看到完整加载页；
   * ② 到齐（或 SELF_MAX_S 超时）后回调 `onReady` 让调用方建首页，再开始下首屏素材、推进度条。
   *
   * @param paths 首屏要先下好的贴图（resources 路径，不含 `/spriteFrame`）
   * @param onReady 第二阶段开始前回调：在这里建首页（建完后加载页会自动压回最上层）
   * @param onFinish 淡出结束、节点销毁后回调（在这里开始后台预下载等后续工作）
   */
  static show(parent: Node, w: number, h: number, paths: readonly string[],
    onReady: () => void, onFinish: () => void): StartupLoading {
    const root = new Node('StartupLoading');
    root.layer = Layers.Enum.UI_2D;
    root.addComponent(UITransform).setContentSize(w, h);
    root.parent = parent;
    root.setSiblingIndex(parent.children.length - 1);
    const comp = root.addComponent(StartupLoading);
    comp.paths = paths;
    comp.onReady = onReady;
    comp.onFinish = onFinish;
    // 进度分母一开始就定：自身 3 张 + 首屏素材 + 字体
    comp.total = 3 + paths.length + 1;
    comp.build(w, h);
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

    // 自身三张图：每到一张（成功或失败）都算一项进度，也推进第一阶段
    const selfStep = (): void => { this.selfDone += 1; this.done += 1; };
    this.selfTotal = 3;

    const cover = Math.max(w / BG_W, h / BG_H);
    this.sprite(root, 'Bg', 'ui/loading/bg', BG_W * cover, BG_H * cover, 0, 0, selfStep);

    const barY = -h / 2 + BAR_BOTTOM;
    const bar = this.box(root, 'Bar', BAR_W, BAR_H, 0, barY);
    this.sprite(bar, 'Slot', 'ui/loading/bar-bg', BAR_W, BAR_H, 0, 0, selfStep);
    this.fill = this.sprite(bar, 'Fill', 'ui/loading/bar-fill', 0, FILL_H, -FILL_W / 2, 0, selfStep).node;

    // 百分比：白字 + 下移 3px 的棕色投影（Web `.loading-num` 的 text-shadow）
    this.pctShadow = this.label(bar, 'PctShadow', LOADING.pct(0), 46, C_PCT_SHADOW, 0, -3, 240);
    this.pct = this.label(bar, 'Pct', LOADING.pct(0), 46, C_PCT, 0, 0, 240);

    LOADING.healthAdvice.forEach((line, i) => {
      this.label(root, 'Health' + i, line, 30, C_ADVICE, 0, barY - BAR_H / 2 - 40 - i * 42, 1000, 'medium');
    });
  }

  /** 第二阶段：让调用方建首页，再把加载页压回最上层，开始下首屏素材 */
  private startLoading(): void {
    this.started = true;
    const ready = this.onReady;
    this.onReady = null;
    try {
      ready?.();
    } catch (e) {
      // 建首页出错也要把加载页走完，不能卡在这一屏
      console.error('[loading] 建首页出错', e);
    }
    if (this.node.parent) this.node.setSiblingIndex(this.node.parent.children.length - 1);

    // 加载页自己的文字此时再套字体（字体到了自动回填）
    for (const [l, weight] of this.labels) applyUiFont(l, weight);
    this.labels = [];

    // 字体也算一项：首页文字在字体到之前会先用系统字，到了再跳一下
    const step = (): void => { this.done += 1; };
    for (const p of this.paths) {
      resources.load(p + '/spriteFrame', SpriteFrame, (err) => {
        if (err) console.warn('[loading] 素材加载失败（不阻塞）: ' + p);
        step();
      });
    }
    void preloadUiFont().then(step, step);
  }

  update(dt: number): void {
    if (this.fading) return;
    this.elapsed += dt;
    if (!this.started && (this.selfDone >= this.selfTotal || this.elapsed >= SELF_MAX_S)) this.startLoading();
    const ratio = this.total > 0 ? this.done / this.total : 1;
    // 起步给 3%：一进来就是 0% 像卡住
    this.render(Math.round(3 + 97 * Math.min(1, ratio)));
    const loaded = this.started && this.done >= this.total;
    if ((loaded && this.elapsed >= MIN_S) || this.elapsed >= MAX_S) {
      if (!this.started) this.startLoading();
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

  private sprite(parent: Node, name: string, path: string, w: number, h: number, x: number, y: number,
    onDone?: () => void): Sprite {
    const sp = this.box(parent, name, w, h, x, y).addComponent(Sprite);
    sp.sizeMode = Sprite.SizeMode.CUSTOM;
    resources.load(path + '/spriteFrame', SpriteFrame, (err, sf) => {
      onDone?.();
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
    // ⚠️ 不在这里套字体：字体没到时 applyUiFont 会立刻触发下载（2×340 KB），第一阶段又和背景抢带宽。
    //    先用系统字，第二阶段统一套（见 startLoading）。
    this.labels.push([l, weight]);
    return l;
  }
}
