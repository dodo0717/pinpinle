/**
 * 表情包图鉴整屏（从 web/ui/collection.ts 移植，2026-10-30）
 *
 * Web 版是 3 列 × 12 行共 36 格；素材扩到 108 张后改为 **3 列 × 36 行**，
 * 内容超出一屏 → 用 `ScrollView` 竖向滚动（Cocos 标准做法，真机惯性滚动/回弹都有）。
 *
 * ⚠️「已解锁」由调用方以集合传入，界面不算 —— 解锁条件属于进度规则（§10.2），
 *   界面只负责「彩色 + 可点开大图」/「灰底 + 🔒 + 点一下提示解锁条件」的呈现。
 *
 * 素材：卡底三色轮换（蓝 / 粉 / 橙）**程序绘制**（Web 版是三张切图 PNG），
 * 贴纸复用 `stickers/sticker_N/spriteFrame`，与棋盘碎片同一套资源 —— 不引入新素材。
 *
 * ⚠️ 108 张贴纸**不再全量加载**：格子照建（只有 Graphics 卡底，很便宜），
 * 贴图按**可视范围**发请求（视口上下各多留 `PRELOAD_ROWS` 行），滚到哪加载到哪；
 * 走 CDN 时这条更重要 —— 一次性 108 个远程请求既卡又容易超时。
 * 来源由 `平台/assetSource.ts` 分派：默认全本地（`stickers/sticker_N`，与改造前逐字一致）。
 */

import {
  Node, UITransform, Graphics, Label, Sprite, Color, Layers, ScrollView,
} from 'cc';
import { resolveAsset, type ResolvedAsset } from '../平台/assetSource';
import { loadSpriteFrame } from '../平台/assetLoader';

/** 卡底三色轮换（对齐 Web 版 card-blue / card-pink / card-orange） */
const CARD_SKINS: Color[] = [
  new Color(150, 198, 240, 255),
  new Color(247, 186, 208, 255),
  new Color(250, 205, 150, 255),
];
const LOCK_BG = new Color(178, 178, 186, 255);

const COLS = 3;
const CELL = 280;
const GAP = 24;
const GRID_W = COLS * CELL + (COLS - 1) * GAP;
/** 一行占的纵向步距（cell 高 + 间距） */
const ROW_STRIDE = CELL + GAP;
/** 滚动视口高度，与 build() 里 svNode 的 1400 对齐 */
const VIEW_H = 1400;
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

export function mkLabel(parent: Node, text: string, size: number, x: number, y: number, color: Color, w: number): Label {
  const n = new Node('t');
  n.layer = Layers.Enum.UI_2D;
  n.addComponent(UITransform).setContentSize(w, size + 14);
  const l = n.addComponent(Label);
  l.string = text;
  l.fontSize = size;
  l.lineHeight = size + 10;
  l.color = color;
  n.parent = parent;
  n.setPosition(x, y, 0);
  return l;
}

/** 图鉴整屏：蓝天 + 返回钮 + 计数 + 3 列网格（可滚动） */
export class CollectionScreen {
  private root: Node = null!;
  private countLabel: Label = null!;
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
    root.addComponent(UITransform).setContentSize(1080, 1920);
    root.parent = parent;
    root.setPosition(0, 0, 0);
    root.active = false;
    this.root = root;

    const bg = new Node('bg');
    bg.layer = Layers.Enum.UI_2D;
    bg.addComponent(UITransform).setContentSize(1080, 1920);
    const g = bg.addComponent(Graphics);
    g.rect(-540, -960, 1080, 1920);
    g.fillColor = new Color(155, 215, 242, 255);
    g.fill();
    bg.parent = root;

    // 顶栏：返回圆钮 + 标题 + 计数
    const back = new Node('back');
    back.layer = Layers.Enum.UI_2D;
    back.addComponent(UITransform).setContentSize(96, 96);
    back.setPosition(-450, 850, 0);
    const bgc = back.addComponent(Graphics);
    bgc.circle(0, 0, 48);
    bgc.fillColor = new Color(150, 106, 62, 255);
    bgc.fill();
    back.parent = root;
    mkLabel(back, '‹', 64, 0, 4, new Color(255, 255, 255), 96);
    back.on(Node.EventType.TOUCH_END, () => this.h.onBack());

    mkLabel(root, '图鉴', 56, 0, 850, new Color(90, 50, 25), 400);
    this.countLabel = mkLabel(root, '', 36, 0, 770, new Color(80, 60, 40), 800);

    // 滚动网格
    const svNode = new Node('grid');
    svNode.layer = Layers.Enum.UI_2D;
    svNode.addComponent(UITransform).setContentSize(GRID_W + 40, 1400);
    svNode.setPosition(0, -30, 0);
    svNode.parent = root;
    const sv = svNode.addComponent(ScrollView);
    sv.vertical = true;
    sv.horizontal = false;

    const content = new Node('content');
    content.layer = Layers.Enum.UI_2D;
    content.addComponent(UITransform).setContentSize(GRID_W, CELL);
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
  }

  /** 重绘：`unlocked` 是已解锁的图 ID 集合 */
  render(unlocked: ReadonlySet<number>, total: number): void {
    this.countLabel.string = `已收集 ${unlocked.size} / ${total}`;
    const rows = Math.ceil(total / COLS);
    const ct = this.content.getComponent(UITransform)!;
    ct.setContentSize(GRID_W, rows * CELL + (rows - 1) * GAP);

    // 重绘 = 清空旧格（content 自身保留）
    for (const c of this.content.children.slice()) c.destroy();
    this.pending = [];

    const top = ct.height / 2 - CELL / 2;
    for (let imageId = 0; imageId < total; imageId++) {
      const owned = unlocked.has(imageId);
      const r = Math.floor(imageId / COLS);
      const c = imageId % COLS;
      const cell = new Node('cell' + imageId);
      cell.layer = Layers.Enum.UI_2D;
      cell.addComponent(UITransform).setContentSize(CELL, CELL);
      cell.setPosition(-GRID_W / 2 + CELL / 2 + c * (CELL + GAP), top - r * (CELL + GAP), 0);
      const g = cell.addComponent(Graphics);
      g.roundRect(-CELL / 2, -CELL / 2, CELL, CELL, 26);
      g.fillColor = owned ? CARD_SKINS[imageId % CARD_SKINS.length]! : LOCK_BG;
      g.fill();
      cell.parent = this.content;

      if (owned) {
        const sp = cell.addComponent(Sprite);
        sp.sizeMode = Sprite.SizeMode.CUSTOM;
        // 只登记不加载 —— 108 张一次全下会卡（走 CDN 时更糟），由 pumpVisible() 按可视范围发
        this.pending.push({ sp, res: resolveAsset('stickers', `sticker_${imageId}`, 'png'), row: r });
        cell.on(Node.EventType.TOUCH_END, () => this.h.onOpen(imageId));
      } else {
        mkLabel(cell, '🔒', 76, 0, 0, new Color(255, 255, 255, 230), CELL);
        cell.on(Node.EventType.TOUCH_END, () => this.h.onLockedTip?.());
      }
    }

    this.pumpVisible();
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
    const bottom = off + VIEW_H + PRELOAD_ROWS * ROW_STRIDE;
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
