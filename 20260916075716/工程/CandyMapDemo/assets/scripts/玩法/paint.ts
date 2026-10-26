/**
 * 对局界面的绘制小工具（2026-10-25，三主题重做时抽出来）。
 *
 * 纯代码运行时（preview/cc-shim.js）给 Graphics 扩了渐变 / 投影 / 虚线、给 Sprite 扩了
 * 四角圆角裁切 —— 真 Cocos 没有这些 API，这里统一做鸭子类型探测：
 * 有就用，没有就退回纯色 / 无投影 / 实线 / 直角，界面照样能用，只是朴素一点。
 */

import { _decorator, Component, Color, Graphics, Label, Node, UITransform, Layers, Vec2, Sprite, view, sys, HorizontalTextAlignment, VerticalTextAlignment } from 'cc';
const { ccclass } = _decorator;

/**
 * 逐帧回调（弹窗里的倒计时环 / 弧线描金 / 摆动这类「每帧重画」的动效用）。
 * tween 只能插值节点属性，画 Graphics 进度得自己每帧算。
 */
@ccclass('FrameTicker')
export class FrameTicker extends Component {
  fn: ((dt: number) => void) | null = null;
  update(dt: number): void {
    if (this.fn) this.fn(dt);
  }
}

/** 挂一个逐帧回调到节点上（节点销毁即停） */
export function onFrame(n: Node, fn: (dt: number) => void): void {
  n.addComponent(FrameTicker).fn = fn;
}

export type Stops = Array<[number, Color]>;

/** '#RRGGBB' → Color */
export function hex(s: string, a = 255): Color {
  const v = s.replace('#', '');
  return new Color(parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16), a);
}

/** 同色换透明度 */
export function alpha(c: Color, a: number): Color {
  return new Color(c.r, c.g, c.b, a);
}

/** 两色插值 */
export function mix(a: Color, b: Color, k: number): Color {
  return new Color(
    Math.round(a.r + (b.r - a.r) * k),
    Math.round(a.g + (b.g - a.g) * k),
    Math.round(a.b + (b.b - a.b) * k),
    Math.round(a.a + (b.a - a.a) * k),
  );
}

type Ext = Graphics & {
  fillLinear?: (x0: number, y0: number, x1: number, y1: number, s: Stops) => void;
  fillRadial?: (x0: number, y0: number, r0: number, x1: number, y1: number, r1: number, s: Stops) => void;
  setShadow?: (c: Color | null, blur: number, ox: number, oy: number) => void;
  setDash?: (a: number[]) => void;
};

/** 线性渐变填充当前路径（y-up 本地坐标，从 (x0,y0) 到 (x1,y1)）；不支持时用中间色 */
export function fillLinear(g: Graphics, x0: number, y0: number, x1: number, y1: number, stops: Stops): void {
  const e = g as Ext;
  if (typeof e.fillLinear === 'function') { e.fillLinear(x0, y0, x1, y1, stops); return; }
  g.fillColor = mix(stops[0]![1], stops[stops.length - 1]![1], 0.5);
  g.fill();
}

/** 纵向渐变（上 → 下）的便捷写法 */
export function fillV(g: Graphics, top: number, bottom: number, a: Color, b: Color): void {
  fillLinear(g, 0, top, 0, bottom, [[0, a], [1, b]]);
}

/** 径向渐变填充当前路径 */
export function fillRadial(g: Graphics, cx: number, cy: number, r: number, stops: Stops, fx = cx, fy = cy): void {
  const e = g as Ext;
  if (typeof e.fillRadial === 'function') { e.fillRadial(fx, fy, 0, cx, cy, r, stops); return; }
  g.fillColor = mix(stops[0]![1], stops[stops.length - 1]![1], 0.5);
  g.fill();
}

/** 之后的填充 / 描边带投影（oy 为正 = 向下）；传 null 关闭 */
export function shadow(g: Graphics, c: Color | null, blur = 0, ox = 0, oy = 0): void {
  const e = g as Ext;
  if (typeof e.setShadow === 'function') e.setShadow(c, blur, ox, oy);
}

/** 之后的描边用虚线；空数组恢复实线 */
export function dash(g: Graphics, arr: number[]): void {
  const e = g as Ext;
  if (typeof e.setDash === 'function') e.setDash(arr);
}

/** 五角星路径（尖朝上） */
export function starPath(g: Graphics, cx: number, cy: number, R: number, inner = 0.48): void {
  const r = R * inner;
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? R : r;
    const a = Math.PI / 2 + (i * Math.PI) / 5;
    const x = cx + Math.cos(a) * rad;
    const y = cy + Math.sin(a) * rad;
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.close();
}

/** 爱心路径（s = 半宽） */
export function heartPath(g: Graphics, cx: number, cy: number, s: number): void {
  g.moveTo(cx, cy - s * 0.95);
  g.bezierCurveTo(cx - s * 1.1, cy - s * 0.2, cx - s * 1.05, cy + s * 0.85, cx - s * 0.5, cy + s * 0.85);
  g.bezierCurveTo(cx - s * 0.15, cy + s * 0.85, cx, cy + s * 0.5, cx, cy + s * 0.4);
  g.bezierCurveTo(cx, cy + s * 0.5, cx + s * 0.15, cy + s * 0.85, cx + s * 0.5, cy + s * 0.85);
  g.bezierCurveTo(cx + s * 1.05, cy + s * 0.85, cx + s * 1.1, cy - s * 0.2, cx, cy - s * 0.95);
  g.close();
}

/**
 * 四角各自圆角的矩形路径（y-up：x,y 为左下角）。radii = [左上, 右上, 右下, 左下]。
 * 融合块的底卡 / 描边只在「两条邻边都没融合」的角上留圆角。
 */
export function rrect4(g: Graphics, x: number, y: number, w: number, h: number, radii: [number, number, number, number]): void {
  const m = Math.min(w, h) / 2;
  const [tl, tr, br, bl] = radii.map((v) => Math.max(0, Math.min(v, m))) as [number, number, number, number];
  const top = y + h;
  const right = x + w;
  g.moveTo(x + tl, top);
  g.lineTo(right - tr, top);
  if (tr) g.quadraticCurveTo(right, top, right, top - tr);
  g.lineTo(right, y + br);
  if (br) g.quadraticCurveTo(right, y, right - br, y);
  g.lineTo(x + bl, y);
  if (bl) g.quadraticCurveTo(x, y, x, y + bl);
  g.lineTo(x, top - tl);
  if (tl) g.quadraticCurveTo(x, top, x + tl, top);
  g.close();
}

/** 播放三角（续命按钮 / 广告标） */
export function playPath(g: Graphics, cx: number, cy: number, s: number): void {
  g.moveTo(cx - s * 0.45, cy + s * 0.6);
  g.lineTo(cx + s * 0.65, cy);
  g.lineTo(cx - s * 0.45, cy - s * 0.6);
  g.close();
}

/** 返回箭头（左） */
export function backArrow(g: Graphics, cx: number, cy: number, s: number, color: Color, width: number): void {
  g.lineWidth = width;
  g.strokeColor = color;
  g.moveTo(cx + s * 0.25, cy + s * 0.55);
  g.lineTo(cx - s * 0.35, cy);
  g.lineTo(cx + s * 0.25, cy - s * 0.55);
  g.stroke();
}

/** 贴图四角圆角 [左上, 右上, 右下, 左下]（运行时扩展；Cocos 下是无害的多余字段） */
export function setSpriteRadii(sp: Sprite, radii: [number, number, number, number] | null): void {
  (sp as Sprite & { radii?: number[] | null }).radii = radii;
}

/** 可视区高度（FIXED_WIDTH：长屏手机 > 1920） */
export function screenH(): number {
  const h = view.getVisibleSize().height;
  return h > 0 ? h : 1920;
}

/**
 * 顶 / 底让位（设计 px）——与 MapBootstrap.measureInsets 同口径：
 *   顶：微信里让出状态栏 + 胶囊那一行（胶囊 API 在开发者工具里不准，统一按 safeTop+118 兜底），
 *       返回键就放在这一行的左侧，与胶囊同高；
 *   底：清出系统手势条，封顶 64（见过离谱的安全区值）。
 */
export function screenInsets(): { safeTop: number; navY: number; contentTop: number; bottom: number } {
  const H = screenH();
  let safeTop = 0;
  let safeBottom = 0;
  try {
    const r = sys.getSafeAreaRect();
    if (r && r.height > 0) {
      safeTop = Math.max(0, H - (r.y + r.height));
      safeBottom = Math.max(0, r.y);
    }
  } catch { /* 平台不支持就按 0 */ }
  const wx = (globalThis as { wx?: unknown }).wx;
  const capRow = wx ? Math.max(safeTop + 118, 150) : 120;   // 胶囊行底边（距顶）
  const navY = H / 2 - (capRow - 58);                         // 胶囊行中心
  return {
    safeTop,
    navY,
    contentTop: H / 2 - capRow - 8,
    bottom: -H / 2 + Math.min(64, 20 + safeBottom),
  };
}

/* ---------------------------------------------------------------- 节点 / 文字 */

export function mkNode(parent: Node, name: string, w: number, h: number, x = 0, y = 0): Node {
  const n = new Node(name);
  n.parent = parent;
  n.layer = Layers.Enum.UI_2D;
  n.addComponent(UITransform).setContentSize(w, h);
  n.setPosition(x, y);
  return n;
}

export function mkGfx(parent: Node, name: string, w: number, h: number, x = 0, y = 0): Graphics {
  return mkNode(parent, name, w, h, x, y).addComponent(Graphics);
}

export interface TextStyle {
  font: string;
  size: number;
  color: Color;
  bold?: boolean;
  italic?: boolean;
  align?: 'left' | 'center' | 'right';
  outline?: Color;
  outlineWidth?: number;
  /** 投影：y 为正 = 向下（与 CSS text-shadow 同口径，内部换成 Cocos 的 y 向上） */
  shadow?: { color: Color; x?: number; y?: number; blur?: number };
  lineHeight?: number;
}

/** 建一个文字节点并按样式设好 */
export function mkText(parent: Node, text: string, x: number, y: number, w: number, st: TextStyle, name = 'Txt'): Label {
  const lh = st.lineHeight ?? Math.round(st.size * 1.25);
  const lines = String(text).split('\n').length;
  const n = mkNode(parent, name, w, lh * lines + 8, x, y);
  const l = n.addComponent(Label);
  l.string = text;
  styleText(l, st);
  return l;
}

export function styleText(l: Label, st: TextStyle): void {
  const any = l as Label & Record<string, unknown>;
  l.fontSize = st.size;
  l.lineHeight = st.lineHeight ?? Math.round(st.size * 1.25);
  l.color = st.color;
  l.fontFamily = st.font;
  any.useSystemFont = true;
  l.isBold = !!st.bold;
  any.enableBold = !!st.bold;
  l.isItalic = !!st.italic;
  l.horizontalAlign = st.align === 'left' ? HorizontalTextAlignment.LEFT
    : st.align === 'right' ? HorizontalTextAlignment.RIGHT : HorizontalTextAlignment.CENTER;
  l.verticalAlign = VerticalTextAlignment.CENTER;
  l.enableOutline = !!st.outline;
  if (st.outline) {
    l.outlineColor = st.outline;
    l.outlineWidth = st.outlineWidth ?? 3;
  }
  l.enableShadow = !!st.shadow;
  if (st.shadow) {
    l.shadowColor = st.shadow.color;
    l.shadowOffset = new Vec2(st.shadow.x ?? 0, -(st.shadow.y ?? 0));
    l.shadowBlur = st.shadow.blur ?? 0;
  }
}
