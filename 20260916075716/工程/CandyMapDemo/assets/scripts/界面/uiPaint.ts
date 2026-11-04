/**
 * 整屏界面的**绘制原语**（2026-10-31 从排行榜/图鉴/设置三屏里抽出来共用）。
 *
 * 排行榜、图鉴、设置三屏是同一套骨架（Web 端的 `.screen.leaderboard / .collection / .settings`
 * 也是同一份 CSS 思路）：整屏蓝天渐变 + 150×150 棕色返回圆钮 + 96px 白字描边标题 +
 * `border-radius:118px` 的金框大卡。抽出来后三屏只有一个实现，改一处三处跟着变。
 *
 * ⚠️ 【切图优先，程序绘制是兜底】（2026-10-31 修正）
 * 三屏的框 / 返回钮 / 卡底 / 图标 / 开关**一律用 `web/art/**` 的现成切图**（已拷进
 * `assets/resources/ui/{collection,settings,leaderboard}/`），用 `mkSprite` 铺满节点 ——
 * Web 端对这些图全是 `background-size: 100% 100%`（整张拉伸，形变与 Web 自身同口径），
 * 所以直接铺满就是最忠实的实现，不需要九宫格。
 * 程序绘制只保留两件事：① CSS 渐变 / 阴影的等价物（`fillVGrad` / `paintShadow`）；
 * ② 贴图没加载出来时的**兜底底图**（缺图时界面仍是完整的，不会开天窗）。
 *
 * 替换关系：
 *   - CSS 的三段 `linear-gradient` → `fillVGrad`（按条带近似）
 *   - `box-shadow` → `paintShadow`（低透明同心圆角矩形近似高斯模糊）
 *   - `text-shadow` / `-webkit-text-stroke` → 八向错位文本（shim 没有 `LabelOutline`）
 *   - `background-image: url(...)` → `mkSprite`（`100% 100%` 铺满；`object-fit:contain` 见 `fitContain`）
 *
 * 颜色一律来自 `web/art/**` 切图的**真实像素采样**（`node tools/art-samples.mjs`），不靠肉眼估。
 */

import { Node, UITransform, Graphics, Label, Sprite, Color, Layers, type SpriteFrame } from 'cc';
import { resolveAsset } from '../平台/assetSource';
import { loadSpriteFrame } from '../平台/assetLoader';

/** 屏幕本性：1080×1920 逻辑分辨率（Web 端 `#stage` 也是这个尺寸） */
export const STAGE_W = 1080;
export const STAGE_H = 1920;

/**
 * 纯白 —— ⚠️ 不能写 `Color.WHITE`：那是真 Cocos 的静态常量，预览 shim 的 `Color` 没有它，
 * 用了会得到 `undefined` 并在 `drawLabel` 里炸（2026-10-31 实测踩到）。
 */
export const WHITE = new Color(255, 255, 255, 255);

/* ------------------------------------------------------------------ 整屏蓝天（三屏共用） */

export const SKY_A = new Color(63, 131, 216, 255);   // #3f83d8
export const SKY_B = new Color(111, 169, 234, 255);  // #6fa9ea（42% 处）
export const SKY_C = new Color(169, 208, 245, 255);  // #a9d0f5

/**
 * 舞台外的「出血」高度（2026-11-04）：相机按宽 1080 适配，比 9:16 更窄长的手机上下会多出一截
 * （如 9:19.5 上下各约 210）。整屏底色与全屏蒙版都往外多铺这么高，留边处不再露出黑色清屏色。
 * 600 足够覆盖到 9:24 的超长屏。
 */
export const BLEED = 600;

/** 在 w×h（居中）区域的上下各补一条 BLEED 高的纯色：上接顶部色，下接底部色 */
export function fillBleed(g: Graphics, w: number, h: number, top: Color, bot: Color): void {
  g.fillColor = top;
  g.rect(-w / 2, h / 2 - 1, w, BLEED + 1);
  g.fill();
  g.fillColor = bot;
  g.rect(-w / 2, -h / 2 - BLEED, w, BLEED + 1);
  g.fill();
}

/**
 * 整屏渐变底：`linear-gradient(180deg,#3f83d8 0%,#6fa9ea 42%,#a9d0f5 100%)`。
 *
 * ⚠️ 40 条色带的 `fillVGrad` 铺满 1080×1920 = **整屏色带台阶**（毛边最显眼的一处）→
 *    改铺预烘焙贴图 `fx/sky-screen`（16×1920，竖向渐变每一列完全相同，横拉 1080 是恒等插值）。
 *    Graphics 版本留着做缺图兜底（贴图是子节点，永远盖在上面）。
 */
export function paintScreenBg(parent: Node, name = 'bg'): Node {
  const n = new Node(name);
  n.layer = Layers.Enum.UI_2D;
  n.addComponent(UITransform).setContentSize(STAGE_W, STAGE_H);
  const g = n.addComponent(Graphics);
  fillVGrad(g, STAGE_W, STAGE_H, SKY_A, SKY_B, SKY_C, 0.42, 0, 40);
  fillBleed(g, STAGE_W, STAGE_H, SKY_A, SKY_C);
  n.parent = parent;
  mkSprite(n, 'fx/sky-screen', STAGE_W, STAGE_H);
  return n;
}

/* ------------------------------------------------------------------ 顶栏（返回钮 + 标题） */

/** 返回钮：150×150 圆底 @屏幕左上 (44,38)，中间一个 ‹ 箭头 */
export const BACK_SIZE = 150;
export const BACK_X = 44;
export const BACK_Y = 38;

/**
 * 顶栏：返回钮 + 居中大标题。
 * @param fill   圆钮底色（各屏 `back.png` 的采样均色：排行榜 #83482f / 图鉴 #c78b59 / 设置 #7e4933）—— 兜底用
 * @param glyph  箭头颜色（back.png 的中心色）—— 兜底用
 * @param art    `back.png` 切图路径（`ui/collection/back`）；给了就铺切图，箭头不再程序画
 */
export function mkBackButton(parent: Node, fill: Color, glyph: Color, onTap: () => void, art?: string): Node {
  const back = new Node('back');
  back.layer = Layers.Enum.UI_2D;
  back.addComponent(UITransform).setContentSize(BACK_SIZE, BACK_SIZE);
  back.setPosition(BACK_X + BACK_SIZE / 2 - STAGE_W / 2, STAGE_H / 2 - (BACK_Y + BACK_SIZE / 2), 0);
  const g = back.addComponent(Graphics);
  g.circle(0, 0, BACK_SIZE / 2);
  g.fillColor = fill;
  g.fill();
  g.lineWidth = 6;
  g.strokeColor = glyph;
  g.circle(0, 0, BACK_SIZE / 2 - 3);
  g.stroke();
  back.parent = parent;
  if (art) mkSprite(back, art, BACK_SIZE, BACK_SIZE);
  else mkText(back, '‹', 84, 0, 4, glyph, BACK_SIZE, true, 'center');
  back.on(Node.EventType.TOUCH_END, onTap);
  return back;
}

/* ------------------------------------------------------------------ 切图（Web `background-image` 的等价物） */

/**
 * `object-fit: contain` 的等价：把 `iw×ih` 的图等比塞进 `w×h` 的框里（不裁、不变形），
 * 返回贴图的**实际尺寸**（Cocos 没有 contain，只能把节点设成这个尺寸）。
 */
export function fitContain(iw: number, ih: number, w: number, h: number): [number, number] {
  const s = Math.min(w / iw, h / ih);
  return [iw * s, ih * s];
}

/**
 * 铺一张 `web/art` 切图（Web 端一律 `background-size: 100% 100%` → 这里就是铺满节点）。
 *
 * ⚠️ 贴图作为**子节点**存在：shim 的 `Mask` 分支只画子树，同节点的 Sprite 会被跳过；
 *    而且子节点在父节点的 Graphics 之后绘制，天然就是「内容画在底图之上」。
 * ⚠️ 加载失败就什么都不显示 —— 调用方要保留程序绘制的底（见文件头「兜底」）。
 *
 * @param res 资源名（**不含** `ui/` 前缀，也不含扩展名），如 `collection/card-blue`
 *            （`ui/` 由 `setSprite` 内部统一补；写了也没关系，会自动剥掉）
 */
export function mkSprite(parent: Node, res: string, w: number, h: number, x = 0, y = 0): Sprite {
  const n = new Node('art');
  n.layer = Layers.Enum.UI_2D;
  n.addComponent(UITransform).setContentSize(w, h);
  n.setPosition(x, y, 0);
  n.parent = parent;
  const sp = n.addComponent(Sprite);
  sp.sizeMode = Sprite.SizeMode.CUSTOM;
  setSprite(sp, res);
  return sp;
}

/**
 * 铺一张**效果贴图**（外投影 / 辉光）。
 *
 * ⚠️ 必须是**兄弟节点、且排在被装饰元素之前**加入父节点：Cocos 里子节点永远渲染在父节点之上，
 *    把阴影做成元素的子节点，它反而会盖住元素自己（阴影比元素大一圈，等于糊在脸上）。
 *
 * 贴图是 canvas `shadowBlur` 预烘的（`tools` 侧脚本产出，见 `assets/resources/ui/fx/`），
 * 与 Web 的 `box-shadow` 同口径（blur 定义都是 2σ）。
 */
export function mkFx(parent: Node, name: string, res: string, w: number, h: number, x = 0, y = 0): Sprite {
  const n = new Node(name);
  n.layer = Layers.Enum.UI_2D;
  n.addComponent(UITransform).setContentSize(w, h);
  n.setPosition(x, y, 0);
  n.parent = parent;
  const sp = n.addComponent(Sprite);
  sp.sizeMode = Sprite.SizeMode.CUSTOM;
  setSprite(sp, res);
  return sp;
}

/**
 * 取 `GRAPHICS_STENCIL` 遮罩的模板 `Graphics`。
 *
 * ⚠️ `mask.graphics` 是 **2.x 口径**，Creator 3.8 的 `MaskComponent` 没有这个属性（TS 直接报错）。
 * 3.8 的实现是「模板 Graphics 挂在 Mask 的同一节点上」——引擎 `_createGraphics()` 就是
 * `node.getComponent(Graphics) ?? node.addComponent(Graphics)`，这里照同一口径拿。
 * 预览 shim 只认 `mask.graphics`，所以两条路都兜住。
 */
export function maskStencil(mask: unknown, node: Node): Graphics {
  const g = (mask as { graphics?: Graphics }).graphics;
  if (g) return g;
  return node.getComponent(Graphics) ?? node.addComponent(Graphics);
}

/**
 * 换贴图（开关的 on / off 就靠它）；节点已销毁时静默。
 *
 * ⚠️ 路径归一化：`resolveAsset('ui', r)` 会**再拼一次** `ui/`（拼成 `ui/<r>` 才是完整 resources 路径）。
 *    所以本函数的 `res` 参数约定是**不含** `ui/` 的（如 `fx/row-set`、`leaderboard/frame`）。
 *    但实测很容易顺手写成 `ui/fx/row-set` → 变成 `ui/ui/fx/row-set` → **加载出来永远为空**
 *    （`resources.load` 对不存在的资源是静默失败，画面上就是「贴图没生效」，极难发现）。
 *    这里统一先剥掉可能的前缀，两种写法都不会错。
 */
export function setSprite(sp: Sprite, res: string): void {
  const name = res.startsWith('ui/') ? res.slice(3) : res;
  // ⚠️ 2026-11-04：拿到过的切图直接同步挂上。原来每次都走一遍异步 load —— 真机上即使已缓存，
  //    回调也要排队一两秒：排行榜每次重建领奖台都先露出空杯（奖杯里的人脸在 cup-*.png 里），
  //    PLAY 吊牌切难度时胶囊底图一片空白。
  const hit = sfCache.get(name);
  if (hit && (hit as { isValid?: boolean }).isValid !== false) { sp.spriteFrame = hit; return; }
  loadSpriteFrame(resolveAsset('ui', name, 'png'), (sf) => {
    if (sf) sfCache.set(name, sf);
    if (!sf || !sp.node || !sp.node.isValid) return;
    sp.spriteFrame = sf;
  });
}

/** 已加载的 UI 切图（键 = 不含 `ui/` 的资源名）。持有引用即可，resources.load 的资源不会被自动释放 */
const sfCache = new Map<string, SpriteFrame>();

/** 后台预热：把一批切图提前加载进缓存（之后 setSprite 同步命中）；全部结束后回调 */
export function warmUiSprites(names: readonly string[], done?: () => void): void {
  let left = names.length;
  if (left === 0) { done?.(); return; }
  for (const raw of names) {
    const name = raw.startsWith('ui/') ? raw.slice(3) : raw;
    if (sfCache.has(name)) { if (--left === 0) done?.(); continue; }
    loadSpriteFrame(resolveAsset('ui', name, 'png'), (sf) => {
      if (sf) sfCache.set(name, sf);
      if (--left === 0) done?.();
    });
  }
}

/**
 * 96px 白字大标题（Web 的 `.lb-title / .col-title / .set-title`）。
 * 实测三屏标题的字中心都在 **(540, 113)**。
 *
 * ⚠️ Web 的 text-shadow **只有三条**（ui.css:121 / 224 / 424）：
 *   `0 8px 0 rgba(90,45,10,.55), 6px 0 0 rgba(90,45,10,.35), -6px 0 0 rgba(90,45,10,.35)`
 *   原来的「八向错位」多出上侧与四条斜向，字被糊成一团（看着就是毛边）—— 这里逐条对齐 Web，
 *   只下 8、左右各 6。
 */
export const TITLE_FS = 96;
/** 投影错位：Web 的三条 text-shadow（Cocos y 向上 → CSS 的「下 8px」是 −8） */
const TITLE_STROKE_MAIN = new Color(90, 45, 10, Math.round(0.55 * 255));
const TITLE_STROKE_SIDE = new Color(90, 45, 10, Math.round(0.35 * 255));
const OUTLINE_TITLE: Array<[number, number, Color]> = [
  [0, -8, TITLE_STROKE_MAIN],   // 0 8px 0（主投影，最深）
  [6, 0, TITLE_STROKE_SIDE],    // 6px 0 0
  [-6, 0, TITLE_STROKE_SIDE],   // -6px 0 0
];

export function mkTitle(parent: Node, title: string): void {
  const y = STAGE_H / 2 - 113;
  for (const [dx, dy, c] of OUTLINE_TITLE) {
    mkText(parent, title, TITLE_FS, dx, y - dy, c, 900, true, 'center');
  }
  mkText(parent, title, TITLE_FS, 0, y, WHITE, 900, true, 'center');
}

/* ------------------------------------------------------------------ 文字 */

/**
 * 建 Label。Cocos 的 Label 用 middle baseline 画在节点中心 → **节点中心 = 字的中心**，
 * 这也是 UI 对齐全用「节点中心」对齐 Web「字的包围盒中心」的依据。
 */
export function mkText(
  parent: Node, text: string, size: number, x: number, y: number, color: Color, w: number,
  bold = false, align: 'center' | 'left' | 'right' = 'center',
): Label {
  const n = new Node('t');
  n.layer = Layers.Enum.UI_2D;
  n.addComponent(UITransform).setContentSize(w, size + 14);
  const l = n.addComponent(Label);
  l.string = text;
  l.fontSize = size;
  l.lineHeight = size + 10;
  l.color = color;
  if (bold) {
    const b = l as unknown as { isBold?: boolean; enableBold?: boolean };
    b.isBold = true;
    b.enableBold = true;
  }
  if (align === 'left') l.horizontalAlign = 0;          // HorizontalTextAlignment.LEFT
  else if (align === 'right') l.horizontalAlign = 1;    // RIGHT
  n.parent = parent;
  n.setPosition(x, y, 0);
  return l;
}

/* ------------------------------------------------------------------ 渐变 / 阴影 */

/** 颜色插值 */
export function lerpColor(a: Color, b: Color, t: number): Color {
  return new Color(
    Math.round(a.r + (b.r - a.r) * t),
    Math.round(a.g + (b.g - a.g) * t),
    Math.round(a.b + (b.b - a.b) * t),
    Math.round(a.a + (b.a - a.a) * t),
  );
}

/** 三段渐变取色（t=0 顶 → t=1 底，midAt 处取中段色） */
export function gradColor(top: Color, mid: Color, bot: Color, t: number, midAt: number): Color {
  if (t <= midAt) return lerpColor(top, mid, midAt === 0 ? 0 : t / midAt);
  return lerpColor(mid, bot, (t - midAt) / (1 - midAt));
}

/**
 * 圆角矩形内的竖向渐变。
 *
 * ⚠️ 每一条带都按「该行在圆角内的实际半宽」收窄 —— 否则矩形条带会溢出圆角，
 *    圆角 118 的大卡看着就是方角的（这个坑踩过）。
 */
export function fillVGrad(
  g: Graphics, w: number, h: number, top: Color, mid: Color, bot: Color,
  midAt: number, r: number, bands = 24,
): void {
  const lim = h / 2 - r;
  const halfAt = (y: number): number => {
    const ay = Math.abs(y);
    if (r <= 0 || ay <= lim) return w / 2;
    const dy = ay - lim;
    return w / 2 - r + Math.sqrt(Math.max(0, r * r - dy * dy));
  };
  const bh = h / bands;
  for (let i = 0; i < bands; i++) {
    const yTop = h / 2 - i * bh;
    const t = bands === 1 ? 0 : (bands - 1 - i) / (bands - 1);
    g.fillColor = gradColor(top, mid, bot, t, midAt);
    const hw = Math.min(halfAt(yTop), halfAt(yTop - bh));
    g.rect(-hw, yTop - bh, hw * 2, bh + 0.6);
    g.fill();
  }
}

/**
 * `box-shadow` 的近似：多层低透明同心圆角矩形（越往外越淡）。
 * 以 `0 26px 70px rgba(20,55,120,.35)` 为模板 —— 三屏的金框卡都是这一条。
 */
export function paintShadow(g: Graphics, w: number, h: number, r: number, dy: number, blur: number, color: Color, layers = 5): void {
  const a = color.a / 255;
  for (let i = layers - 1; i >= 0; i--) {
    const spread = (i / (layers - 1)) * blur;
    const alpha = a * (0.1 + 0.06 * (layers - 1 - i));
    g.fillColor = new Color(color.r, color.g, color.b, Math.round(alpha * 255));
    g.roundRect(-w / 2 - spread, -h / 2 - spread - dy, w + spread * 2, h + spread * 2, r + spread);
    g.fill();
  }
}

/**
 * `box-shadow: 0 0 {blur} {spread} {color}` 的外发光（**圆**版）：由外向内多层递减叠加。
 *
 * ⚠️ 千万别拿**一层实心圆**糊上去 —— 那样只会在圆的四周留下一圈**硬边色块**，
 *    和 Web 那种按 `blur` 半径由内向外柔和衰减的辉光完全是两种材质感（"质感不对"的常见根因）。
 *    多层等间距同心圆叠加：第 r 处的累积不透明度 ≈ 线性衰减，视觉上足够接近高斯模糊。
 *
 * 每层 alpha 取 `1-(1-A)^(1/N)`：N 层叠加后**正好**回到目标不透明度 A（不是简单 A/N，
 * 因为半透明叠加是非线性的）。
 *
 * @param cy    圆心纵向偏移（相对 Graphics 所在节点中心，y 轴向上为正）
 * @param r0    发光起始半径（= 圆半径 + spread）
 */
export function paintGlow(
  g: Graphics, cy: number, r0: number, blur: number, color: Color, layers = 8,
): void {
  const A = Math.min(1, Math.max(0, color.a / 255));
  if (A <= 0 || blur <= 0) return;
  const a = 1 - Math.pow(1 - A, 1 / layers);
  const alpha = Math.round(a * 255);
  for (let j = layers; j >= 1; j--) {          // 先大后小：外层垫底，内层叠在上面
    g.fillColor = new Color(color.r, color.g, color.b, alpha);
    g.circle(0, cy, r0 + (blur * j) / layers);
    g.fill();
  }
}

/** 圆角矩形填充（加一圈描边时用） */
export function fillRound(g: Graphics, w: number, h: number, r: number, fill: Color): void {
  g.fillColor = fill;
  g.roundRect(-w / 2, -h / 2, w, h, r);
  g.fill();
}

/**
 * 金框大卡的框：`leaderboard/frame.png`（674×989，镂空、只画边框，均色 #bd8e56）
 * 是整体拉伸的，没法平移管子 —— 这里用「铺满金色 + 内部再画内容 + 内描一圈亮边」等价替代：
 * 内容是**画在金底之上并内缩**，视觉结果 = 一圈金色边框 + 亮边。
 */
export const FRAME_GOLD = new Color(199, 150, 81, 255);   // leaderboard/frame.png 实测均色 #c79651
export const FRAME_EDGE = new Color(220, 173, 98, 255);   // 亮边 #dcad62

/** 五角星（Web 的 star.png 是程序替代） */
export function drawStar(g: Graphics, cx: number, cy: number, r: number, color: Color): void {
  g.fillColor = color;
  for (let i = 0; i < 10; i++) {
    const rad = (Math.PI / 5) * i - Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * 0.42;
    const x = cx + Math.cos(rad) * rr;
    const y = cy + Math.sin(rad) * rr;
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.close();
  g.fill();
}
