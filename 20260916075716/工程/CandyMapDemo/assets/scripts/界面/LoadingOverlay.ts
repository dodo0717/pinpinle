/**
 * 「加载中」过场层（2026-11-03）
 *
 * 小游戏端 `resources` 是远程包：排行榜 / 图鉴 / 设置 / 教学整屏第一次打开时，切图还在从服务器下载，
 * 直接建整屏会先出一个空壳、图再一张张冒出来（用户反馈「卡两三秒才出现正常界面」）。
 * 这里先盖一层半透明遮罩 + 转圈 + 文案，等切图下完再进整屏（调度在 `MapBootstrap.openWithLoading`）。
 *
 * ⚠️ 纯程序绘制，不依赖任何切图 —— 它本身就是在等切图。
 * ⚠️ 显示期间挡住所有点击，避免玩家在等待时又点了别的页签。
 * ⚠️ 不 import `Tween`：预览 shim 没导出它，转圈用 `tween()` 返回的句柄自己 stop。
 */

import { Node, UITransform, Graphics, Label, Color, Layers, tween, HorizontalTextAlignment, VerticalTextAlignment } from 'cc';
import { applyUiFont } from './fontUtil';

/** 遮罩底色：与相机留边色同一系（`#2b2419`），压暗但仍能看出底下是首页 */
const C_DIM = new Color(43, 36, 25, 190);
const C_RING_BG = new Color(255, 255, 255, 60);
const C_RING = new Color(255, 214, 102, 255);
const C_TEXT = new Color(255, 255, 255, 255);
const SPIN_R = 46;
const SPIN_W = 10;
/** 转一圈的秒数 */
const SPIN_PERIOD = 0.9;

interface Stoppable { stop(): unknown }

export class LoadingOverlay {
  private root: Node = null!;
  private spinner: Node = null!;
  private spin: Stoppable | null = null;

  static create(parent: Node, w: number, h: number, text: string): LoadingOverlay {
    const o = new LoadingOverlay();
    o.build(parent, w, h, text);
    return o;
  }

  private build(parent: Node, w: number, h: number, text: string): void {
    const root = new Node('LoadingOverlay');
    root.layer = Layers.Enum.UI_2D;
    root.addComponent(UITransform).setContentSize(w, h);
    root.parent = parent;
    root.active = false;
    // 挡点击：遮罩下面的页签 / 关卡珠都不能响应
    const swallow = (e: { propagationStopped: boolean }): void => { e.propagationStopped = true; };
    root.on(Node.EventType.TOUCH_START, swallow, this);
    root.on(Node.EventType.TOUCH_END, swallow, this);

    // 比舞台大一圈：窄长屏上下的留边也一起压暗
    const g = root.addComponent(Graphics);
    g.fillColor = C_DIM;
    g.rect(-w, -h, w * 2, h * 2);
    g.fill();

    const spinner = new Node('Spinner');
    spinner.layer = Layers.Enum.UI_2D;
    spinner.addComponent(UITransform).setContentSize(SPIN_R * 2 + SPIN_W, SPIN_R * 2 + SPIN_W);
    spinner.parent = root;
    spinner.setPosition(0, 40, 0);
    const sg = spinner.addComponent(Graphics);
    sg.lineWidth = SPIN_W;
    sg.strokeColor = C_RING_BG;
    sg.circle(0, 0, SPIN_R);
    sg.stroke();
    sg.strokeColor = C_RING;
    sg.arc(0, 0, SPIN_R, Math.PI / 2, Math.PI / 2 - Math.PI * 1.4, true);
    sg.stroke();
    this.spinner = spinner;

    const ln = new Node('Text');
    ln.layer = Layers.Enum.UI_2D;
    ln.addComponent(UITransform).setContentSize(600, 70);
    ln.parent = root;
    ln.setPosition(0, -70, 0);
    const l = ln.addComponent(Label);
    l.string = text;
    l.fontSize = 44;
    l.lineHeight = 52;
    l.color = C_TEXT;
    l.horizontalAlign = HorizontalTextAlignment.CENTER;
    l.verticalAlign = VerticalTextAlignment.CENTER;
    applyUiFont(l, 'bold');

    this.root = root;
  }

  show(): void {
    if (this.root.active) return;
    this.root.active = true;
    // 每次都压到最上层：整屏是后建的，会排在遮罩之后
    this.root.setSiblingIndex((this.root.parent?.children.length ?? 1) - 1);
    const n = this.spinner;
    n.angle = 0;
    this.spin = tween(n)
      .repeatForever(tween(n).to(SPIN_PERIOD, { angle: -360 }).call(() => { n.angle = 0; }))
      .start();
  }

  hide(): void {
    this.spin?.stop();
    this.spin = null;
    this.root.active = false;
  }

  rootNode(): Node { return this.root; }
}
