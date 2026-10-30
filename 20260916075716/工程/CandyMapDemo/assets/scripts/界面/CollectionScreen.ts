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
 */

import {
  Node, UITransform, Graphics, Label, Sprite, SpriteFrame, Color, Layers, ScrollView, resources,
} from 'cc';

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
  }

  /** 重绘：`unlocked` 是已解锁的图 ID 集合 */
  render(unlocked: ReadonlySet<number>, total: number): void {
    this.countLabel.string = `已收集 ${unlocked.size} / ${total}`;
    const rows = Math.ceil(total / COLS);
    const ct = this.content.getComponent(UITransform)!;
    ct.setContentSize(GRID_W, rows * CELL + (rows - 1) * GAP);

    // 重绘 = 清空旧格（content 自身保留）
    for (const c of this.content.children.slice()) c.destroy();

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
        resources.load(`stickers/sticker_${imageId}/spriteFrame`, SpriteFrame, (err, sf) => {
          if (err || !sf || !cell.isValid) return;
          sp.spriteFrame = sf;
        });
        cell.on(Node.EventType.TOUCH_END, () => this.h.onOpen(imageId));
      } else {
        mkLabel(cell, '🔒', 76, 0, 0, new Color(255, 255, 255, 230), CELL);
        cell.on(Node.EventType.TOUCH_END, () => this.h.onLockedTip?.());
      }
    }
  }

  show(): void { this.root.active = true; }
  hide(): void { this.root.active = false; }
  rootNode(): Node { return this.root; }
  destroy(): void { if (this.root?.isValid) this.root.destroy(); }
}
