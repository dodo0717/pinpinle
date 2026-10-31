/**
 * 表情包图鉴整屏（**2026-10-31 按 Web 实测逐元素重排**，基准 `docs/dump/web-collection.json`）
 *
 * Web 版（`web/ui/collection.ts` + `ui.css` 的 `.col-*`）：
 *   整屏蓝天渐变 → 150×150 棕色返回圆钮 @(44,38) → 96px 白字描边标题（字中心 (540,113)）
 *   → 「已收集 x/y」58px `#d9ec7d` → **1048×1328 的金框大卡**（圆角 118，框是 leaderboard/frame.png，
 *   卡内渐变 `#5ea0e9→#8dbcf0(55%)→#c3e2fb`）→ 卡内 3 列贴纸卡网格（可滚）。
 *   格子 313.34×410.47（aspect 271/355，等比放大到 1080 坐标系后的实测值），列距 323.34、
 *   行距 420.47（= 格子 + gap 10）；108 张 → 36 行。
 *
 * 素材：已解锁卡的底图是 `collection/card-{blue,pink,orange}.png` 三色轮换、未解锁是
 * `card-locked.png`，这里全部**程序绘制**，颜色取 `node tools/art-samples.mjs` 的像素采样：
 *   card-blue  #9dd1ea（上→下 #92bee2 → #afe7f3 → #92b6c9，中心 #a5e7fe）
 *   card-pink  #edd0b3（⚠️ 这张实测是**橙米色**，命名与实际观感反了，按编号照用）
 *   card-orange #ebc8ce（这张实测是**粉色**，同上，照编号用 —— 与 Web 的轮换顺序一致）
 *   card-locked #493f3a（中心 #3c3638，底部偏棕 #6a523b）
 * 贴图在最内层的「内框」里：`left 6% / top 5% / 86%×89%`（Web 的 `.col-img`，object-fit:cover）。
 *
 * ⚠️「已解锁」由调用方以集合传入（每 10 星解锁一张），界面不算 —— 解锁条件属于进度规则。
 * ⚠️ 108 张贴纸**不全量加载**：格子照建（只有 Graphics 卡底，很便宜），贴图按**可视范围**发请求
 *   （视口上下各多留 `PRELOAD_ROWS` 行），滚到哪加载到哪；走 CDN 时这条更重要。
 *
 * 【手段差异（视觉对齐、手段不同）】
 *   - 卡底切图 → `fillVGrad` 程序绘制（色值取切图采样）；
 *   - Web 的 `object-fit:cover`（512 方图放大填满竖框、左右各裁 ~13%）→ Cocos 没有 cover，
 *     用「正方形 Sprite 节点 + `Mask` 裁到内框」等价实现；
 *   - Web 网格有自己的金色滚动条（`::-webkit-scrollbar`）—— 这里用 `ScrollView`，不画滚动条；
 *   - 未解锁的锁：Web 画在 card-locked.png 里，这里程序画一个挂锁（锁梁 + 锁体 + 锁孔）。
 */

import { Node, UITransform, Graphics, Label, Sprite, Color, Layers, ScrollView, Mask } from 'cc';
import { resolveAsset, type ResolvedAsset } from '../平台/assetSource';
import { loadSpriteFrame } from '../平台/assetLoader';
import { COLLECTION } from '../玩法/text';
import {
  STAGE_H, STAGE_W, fillVGrad, mkText, mkBackButton, mkTitle, mkSprite, paintScreenBg, paintShadow,
} from './uiPaint';

/** 屏幕坐标（y 从顶向下）→ Cocos 局部（y 向上，原点卡/屏中心） */
const localY = (cy: number): number => STAGE_H / 2 - cy;

/* ------------------------------------------------------------------ 布局常量（Web 实测） */

/** 返回钮：150×150 @(44,38)，collection/back.png 采样 #c78b59（中心 #d8a570 更亮） */
const BACK_FILL = new Color(199, 139, 89, 255);
const BACK_GLYPH = new Color(216, 165, 112, 255);

/**
 * 「已收集 x/y」：整宽居中，58px `#d9ec7d`，描边 0 4px 0 rgba(90,45,10,.5)。
 * ⚠️ 取的是**字的中心** y=242（Web 实测）：`.col-count` 的盒是 198..294（中心 246），
 *    字因行高比盒中心偏上 4px —— 对齐要对齐字，不是对齐盒。
 */
const COUNT_FS = 58;
const COUNT_CY = localY(242);
const COUNT_COLOR = new Color(217, 236, 125, 255);
const COUNT_STROKE = new Color(90, 45, 10, Math.round(0.5 * 255));

/** 金框大卡：1048×1328 @(16,302)，圆角 118 */
const CARD_W = 1048;
const CARD_H = 1328;
const CARD_CX = localY(302 + CARD_H / 2);
const CARD_R = 118;
/**
 * ⚠️ Web 注释里写明：金框切图（frame.png，100% 拉伸）的边框约占卡宽高 45~55px，
 * 所以卡的 padding 58/40/88 必须让开它 —— 网格的位置常量就是照这条定的。
 */
const CARD_SHADOW = new Color(20, 55, 120, Math.round(0.35 * 255));
/** 卡内渐变（Web `.col-card`）：#5ea0e9 → #8dbcf0(55%) → #c3e2fb */
const CARD_A = new Color(94, 160, 233, 255);
const CARD_B = new Color(141, 188, 240, 255);
const CARD_C = new Color(195, 226, 251, 255);

/** 网格（可滚）：968×1182 @(56,360) —— 卡片的一个子节点 */
const GRID_W = 968;
const GRID_H = 1182;
/** ⚠️ 网格盒顶(360) 与首个格子盒顶(362) 实测差 2px（grid 的内容偏移），格子要跟着让 */
const GRID_PAD_TOP = 2;

const COLS = 3;
const CELL_W = 313.34;
const CELL_H = 410.47;
/** 列/行的实测步距（Web `gap:10px` + 格子尺寸） */
const COL_STRIDE = 323.34;
const ROW_STRIDE = 420.47;
/** 贴纸在内框里的位置（Web `.col-img`：left 6% / top 5% / 86%×89%） */
const IMG_L = 0.06;
const IMG_T = 0.05;
const IMG_W = 0.86;
const IMG_H = 0.89;
/** 卡底圆角（切图四角透明，按 298×389 的比例估 ~8%） */
const CELL_R = 24;

/** 已解锁卡底的三色轮换（与 `web/ui/collection.ts` 的 CARD_SKINS 逐字同序） */
const CARD_SKINS = ['card-blue', 'card-pink', 'card-orange'] as const;
/** 未解锁卡底（切图里已经画好金锁，不用程序画） */
const CARD_LOCKED = 'card-locked';

/**
 * 卡底的**兜底渐变**（切图没加载出来时用）：颜色是 `card-*.png` 的像素采样，
 * 锁定卡的分区采样（整体均色会被金锁拉偏）：底色 #1e2031、金锁 #d2b174、底条 #5a4839。
 */
const SKIN_FALLBACK: Array<[Color, Color, Color]> = [
  [new Color(146, 190, 226, 255), new Color(175, 231, 243, 255), new Color(146, 182, 201, 255)],
  [new Color(231, 195, 177, 255), new Color(244, 225, 184, 255), new Color(208, 186, 169, 255)],
  [new Color(227, 180, 208, 255), new Color(244, 222, 209, 255), new Color(204, 183, 177, 255)],
  [new Color(35, 38, 58, 255), new Color(30, 32, 49, 255), new Color(23, 25, 39, 255)],
];

/** 视口上下各多加载几行：滚动时不出现「刚滚到还是空的」 */
const PRELOAD_ROWS = 2;

/** 待加载的一格：只记「要加载什么、在第几行」，真正发请求由 pumpVisible() 决定 */
interface PendingCell {
  sp: Sprite;
  res: ResolvedAsset;
  row: number;
}

export interface CollectionHandlers {
  onBack: () => void;
  onOpen: (imageId: number) => void;
  /** 点未解锁格子（用于轻提示解锁条件） */
  onLockedTip?: () => void;
}

/** 兼容导出：大图预览 `PreviewScreen` 还在用这份签名 */
export function mkLabel(parent: Node, text: string, size: number, x: number, y: number, color: Color, w: number): Label {
  return mkText(parent, text, size, x, y, color, w);
}

export class CollectionScreen {
  private root: Node = null!;
  private countLabel: Label = null!;
  /** 「已收集」的下落阴影副本（`text-shadow: 0 4px 0`，shim 没有该能力，用错位文本代替） */
  private countShadow: Label = null!;
  private content: Node = null!;
  private sv: ScrollView = null!;
  /** 还没发请求的格子（可视范围外的全在这儿排队） */
  private pending: PendingCell[] = [];
  private h: CollectionHandlers;

  private constructor(handlers: CollectionHandlers) {
    this.h = handlers;
  }

  static create(parent: Node, handlers: CollectionHandlers): CollectionScreen {
    const s = new CollectionScreen(handlers);
    s.build(parent);
    return s;
  }

  private build(parent: Node): void {
    const root = new Node('CollectionScreen');
    root.layer = Layers.Enum.UI_2D;
    root.addComponent(UITransform).setContentSize(STAGE_W, STAGE_H);
    root.parent = parent;
    root.setPosition(0, 0, 0);
    root.active = false;
    this.root = root;

    paintScreenBg(root);
    mkBackButton(root, BACK_FILL, BACK_GLYPH, () => this.h.onBack(), 'collection/back');
    mkTitle(root, COLLECTION.title);

    // 「已收集 x/y」：整宽居中 + 4px 下落阴影（用一位错位的深色副本近似）
    this.countShadow = mkText(root, '', COUNT_FS, 0, COUNT_CY - 4, COUNT_STROKE, STAGE_W, true, 'center');
    this.countLabel = mkText(root, '', COUNT_FS, 0, COUNT_CY, COUNT_COLOR, STAGE_W, true, 'center');

    // 金框大卡
    const card = new Node('card');
    card.layer = Layers.Enum.UI_2D;
    card.addComponent(UITransform).setContentSize(CARD_W, CARD_H);
    card.setPosition(0, CARD_CX, 0);
    card.parent = root;
    this.paintCard(card.addComponent(Graphics));

    // 卡内可滚网格（Mask 裁剪，shim 里不滚动但会裁；真引擎可滚）
    const svNode = new Node('grid');
    svNode.layer = Layers.Enum.UI_2D;
    svNode.addComponent(UITransform).setContentSize(GRID_W, GRID_H);
    // 卡内容区顶部（padding-top 58）往下摆 → 相对卡中心是**向上** CARD_H/2 − 58 − GRID_H/2
    svNode.setPosition(0, CARD_H / 2 - 58 - GRID_H / 2, 0);
    svNode.parent = card;
    const sv = svNode.addComponent(ScrollView);
    sv.vertical = true;
    sv.horizontal = false;
    const mask = svNode.addComponent(Mask);
    mask.type = Mask.Type.GRAPHICS_STENCIL;
    const mg = mask.graphics;
    mg.roundRect(-GRID_W / 2, -GRID_H / 2, GRID_W, GRID_H, 40);
    mg.fill();

    const content = new Node('content');
    content.layer = Layers.Enum.UI_2D;
    content.addComponent(UITransform).setContentSize(GRID_W, CELL_H);
    content.parent = svNode;
    sv.content = content;
    this.content = content;
    this.sv = sv;

    // 滚动时补加载。shim（预览用）没有 ScrollView.EventType，这里做存在性判断，
    // 免得预览页在 import 阶段就炸 —— 真引擎上一定会注册上。
    const et = (ScrollView as unknown as { EventType?: { SCROLLING?: string } }).EventType;
    if (et && et.SCROLLING && typeof svNode.on === 'function') {
      svNode.on(et.SCROLLING, () => this.pumpVisible(), this);
    }

    // 金框切图 **在网格之后**添加：Web 的 `.col-card::before` 是 `z-index: 9`，框盖在内容之上
    // （框是中空的，只会压住贴着边框的那几 px，与 Web 逐像素同效果）
    mkSprite(card, 'leaderboard/frame', CARD_W, CARD_H);
  }

  /** 卡片本体：外投影 + 卡内蓝天渐变（Web `.col-card` 的 background；金框是上面的切图） */
  private paintCard(g: Graphics): void {
    g.clear();
    paintShadow(g, CARD_W, CARD_H, CARD_R, 26, 70, CARD_SHADOW);
    fillVGrad(g, CARD_W, CARD_H, CARD_A, CARD_B, CARD_C, 0.55, CARD_R, 40);
  }

  /** 重绘：`unlocked` 是已解锁的图 ID 集合 */
  render(unlocked: ReadonlySet<number>, total: number): void {
    this.setCount(unlocked.size, total);
    const rows = Math.ceil(total / COLS);
    const ct = this.content.getComponent(UITransform)!;
    const contentH = rows * CELL_H + (rows - 1) * (ROW_STRIDE - CELL_H);
    ct.setContentSize(GRID_W, contentH);
    // 滚动初始位置 = 顶部（content 顶边贴住视口顶边 + grid 的那 2px 让位），与 Web 的 scrollTop=0 一致
    this.content.setPosition(0, GRID_H / 2 - contentH / 2 - GRID_PAD_TOP, 0);

    // 重绘 = 清空旧格（content 自身保留）
    for (const c of this.content.children.slice()) c.destroy();
    this.pending = [];

    const top = ct.height / 2 - CELL_H / 2;
    for (let imageId = 0; imageId < total; imageId++) {
      const owned = unlocked.has(imageId);
      const r = Math.floor(imageId / COLS);
      const c = imageId % COLS;
      const cell = new Node('cell' + imageId);
      cell.layer = Layers.Enum.UI_2D;
      cell.addComponent(UITransform).setContentSize(CELL_W, CELL_H);
      cell.setPosition((c - 1) * COL_STRIDE, top - r * ROW_STRIDE, 0);
      // 兜底渐变（切图没加载出来时的底）；切图本身 `100% 100%` 铺满（与 Web 同口径）
      const [a, b, d] = owned
        ? SKIN_FALLBACK[imageId % SKIN_FALLBACK.length]!
        : SKIN_FALLBACK[SKIN_FALLBACK.length - 1]!;
      const g = cell.addComponent(Graphics);
      // ⚠️ 条带要够细：圆角只有 24px，条带 40px 高时圆角处会出现方形台阶（露出底下的卡内渐变）
      fillVGrad(g, CELL_W, CELL_H, a, b, d, 0.5, CELL_R, 32);
      cell.parent = this.content;
      // 卡底切图（已解锁三色轮换 / 未解锁的锁卡——锁画在图里，不用程序画）
      mkSprite(cell, `collection/${owned ? CARD_SKINS[imageId % CARD_SKINS.length]! : CARD_LOCKED}`, CELL_W, CELL_H);

      if (owned) {
        this.mkSticker(cell, imageId);
        cell.on(Node.EventType.TOUCH_END, () => this.h.onOpen(imageId));
      } else {
        cell.on(Node.EventType.TOUCH_END, () => this.h.onLockedTip?.());
      }
    }

    this.pumpVisible();
  }

  /**
   * 贴纸：`object-fit:cover` 的等价实现 —— 512 方图等比放大到内框高（左右必然溢出），
   * 再用 `Mask` 裁回内框（Web 的 hidden overflow + border-radius 6%）。
   */
  private mkSticker(cell: Node, imageId: number): void {
    const iw = CELL_W * IMG_W;
    const ih = CELL_H * IMG_H;
    // 内框中心相对格子中心（Cocos y 向上）
    const cx = -CELL_W / 2 + CELL_W * IMG_L + iw / 2;
    const cy = CELL_H / 2 - CELL_H * IMG_T - ih / 2;

    const frame = new Node('imgFrame');
    frame.layer = Layers.Enum.UI_2D;
    frame.addComponent(UITransform).setContentSize(iw, ih);
    frame.setPosition(cx, cy, 0);
    frame.parent = cell;
    const mk = frame.addComponent(Mask);
    mk.type = Mask.Type.GRAPHICS_STENCIL;
    const mg = mk.graphics;
    mg.roundRect(-iw / 2, -ih / 2, iw, ih, iw * 0.06);
    mg.fill();

    // ⚠️ Sprite 必须是 Mask 的**子节点**：shim 的 Mask 分支只画子树，同节点的其它组件会被跳过
    const imgNode = new Node('img');
    imgNode.layer = Layers.Enum.UI_2D;
    imgNode.addComponent(UITransform).setContentSize(iw, ih);
    imgNode.parent = frame;
    const sp = imgNode.addComponent(Sprite);
    sp.sizeMode = Sprite.SizeMode.CUSTOM;
    // 只登记不加载 —— 108 张一次全下会卡（走 CDN 时更糟），由 pumpVisible() 按可视范围发
    this.pending.push({ sp, res: resolveAsset('stickers', `sticker_${imageId}`, 'png'), row: Math.floor(imageId / COLS) });
  }

  private setCount(owned: number, total: number): void {
    const s = COLLECTION.collected(owned, total);
    this.countLabel.string = s;
    this.countShadow.string = s;
  }

  /** 从顶部滚过的像素（拿不到就当没滚 —— 首屏照常加载） */
  private scrollOffsetY(): number {
    const sv = this.sv as unknown as { getScrollOffset?: () => { x: number; y: number } } | null;
    if (sv && typeof sv.getScrollOffset === 'function') {
      const o = sv.getScrollOffset();
      // 不同版本 y 的正负方向可能相反，取绝对值即可（只需要「滚了多远」）
      if (o && typeof o.y === 'number') return Math.abs(o.y);
    }
    return 0;
  }

  /** 当前可视行区间（闭区间，含上下各 PRELOAD_ROWS 行缓冲） */
  private visibleRows(): [number, number] {
    const off = this.scrollOffsetY();
    const top = Math.max(0, off - PRELOAD_ROWS * ROW_STRIDE);
    const bottom = off + GRID_H + PRELOAD_ROWS * ROW_STRIDE;
    return [Math.floor(top / ROW_STRIDE), Math.ceil(bottom / ROW_STRIDE)];
  }

  /** 把落在可视范围内的待加载项发出去，其余继续排队（滚动事件会再调） */
  private pumpVisible(): void {
    if (this.pending.length === 0) return;
    const [r0, r1] = this.visibleRows();
    const rest: PendingCell[] = [];
    for (const p of this.pending) {
      if (p.row < r0 || p.row > r1) { rest.push(p); continue; }
      const sp = p.sp;
      loadSpriteFrame(p.res, (sf) => {
        if (!sf || !sp.node || !sp.node.isValid) return;
        sp.spriteFrame = sf;
      });
    }
    this.pending = rest;
  }

  show(): void { this.root.active = true; this.pumpVisible(); }
  hide(): void { this.root.active = false; }
  rootNode(): Node { return this.root; }
  destroy(): void { if (this.root?.isValid) this.root.destroy(); }
}

