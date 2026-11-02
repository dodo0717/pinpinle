/**
 * 图鉴大图预览（从 web/ui/collection.ts 的 createPreviewScreen 移植，2026-10-30）
 *
 * 点图鉴里已解锁的格子 → 整屏看大图 + 动物/心情/台词 + 「保存图片 / 分享」。
 *
 * ⚠️ 保存与分享在 Cocos 端是平台能力（微信 wx.saveImageToPhotosAlbum / wx.shareAppMessage），
 * 本文件只发事件、不碰平台 API —— 调用方在 handler 里落地，可移植性守卫才过得去。
 */

import { Node, UITransform, Graphics, Label, Sprite, SpriteFrame, Color, Layers, resources } from 'cc';
import { animalOf, IMAGE_MOOD, IMAGE_TEXT_PLACEHOLDER } from '../核心/index';
import { mkLabel } from './CollectionScreen';
import { mkSprite, setSprite } from './uiPaint';

/* ↓↓↓ 常量区（照 `web/index.html:11-15` 的 CSS 变量 + `web/ui.css` 的 `.screen.sheet` 段） ↓↓↓ */
/** `--ink` #4a3b2a（标题 / 名字 / 普通按钮字） */
const C_INK = new Color(74, 59, 42);
/** `--ink-soft` #9c8768（台词） */
const C_INK_SOFT = new Color(156, 135, 104);
/** `.sheet-close` 的 ✕ 字色 #a97f45 */
const C_CLOSE_TEXT = new Color(169, 127, 69);
/* ↑↑↑ 常量区结束 ↑↑↑ */

export interface PreviewHandlers {
  onBack: () => void;
  onDownload: (imageId: number) => void;
  onShare: (imageId: number, caption: string) => void;
}

export class PreviewScreen {
  private root: Node = null!;
  private img: Sprite = null!;
  private nameLabel: Label = null!;
  private captionLabel: Label = null!;
  private h: PreviewHandlers;
  private current = 0;

  private constructor(handlers: PreviewHandlers) {
    this.h = handlers;
  }

  static create(parent: Node, handlers: PreviewHandlers): PreviewScreen {
    const p = new PreviewScreen(handlers);
    p.build(parent);
    return p;
  }

  private build(parent: Node): void {
    const root = new Node('PreviewScreen');
    root.layer = Layers.Enum.UI_2D;
    root.addComponent(UITransform).setContentSize(1080, 1920);
    root.parent = parent;
    root.setPosition(0, 0, 0);
    root.active = false;
    this.root = root;

    // 蒙版（Web `#scrim`）—— 沿用原色，Web 没有给这一层单独规定别的底色
    const bg = root.addComponent(Graphics);
    bg.rect(-540, -960, 1080, 1920);
    bg.fillColor = new Color(28, 24, 22, 230);
    bg.fill();

    /*
     * `.screen.sheet`（ui.css:1157）：`inset: 92px 40px 158px` → 1000×1670、radius 52、
     * 3px rgba(255,255,255,.92) 白边、三段渐变 #fffdf6→#fff7ec(58%)→#fdeed8。
     * ⚠️ 原来这里是一整屏深色底 + 白色标题 + 半透明白圆关闭钮，与 Web 完全不是一回事。
     * 浮层中心 y = 960 − 92 − 1670/2 = 33（顶 868 / 底 −802），内容左右各留 44 → ±456。
     */
    const sheet = new Node('sheet');
    sheet.layer = Layers.Enum.UI_2D;
    sheet.addComponent(UITransform).setContentSize(1000, 1670);
    sheet.setPosition(0, 33, 0);
    sheet.parent = root;
    mkSprite(sheet, 'fx/sheet-bg', 1000, 1670);

    /* `.screen.sheet .screen-top`：padding 40 44 10 → 内容顶 = 868 − 40 = 828 */
    const topY = 828;
    // 左侧标题 `.sheet-title`：46px / 800 / #4a3b2a
    mkLabel(sheet, '图鉴', 46, -456 + 300, topY - 27, C_INK, 600);
    // 右侧关闭 `.sheet-close`：74×74 圆 + 3px 金边 + 34px ✕（贴图 102 是给阴影留的位）
    const close = new Node('close');
    close.layer = Layers.Enum.UI_2D;
    close.addComponent(UITransform).setContentSize(102, 102);
    close.setPosition(456 - 37, topY - 37, 0);
    close.parent = sheet;
    mkSprite(close, 'fx/sheet-close', 102, 102);
    mkLabel(close, '✕', 34, 0, 0, C_CLOSE_TEXT, 74);
    close.on(Node.EventType.TOUCH_END, () => this.h.onBack());

    /*
     * `.preview-figure`：padding 8 → 图顶 = 828 − 74 − 10 − 8 = 736 → 中心 y = 426。
     * `.preview-img` 620×620（原来 640×640 且圆角 30、8px 粗边，都不对）。
     * `0 20px 50px rgba(74,59,42,.14)` 走独立阴影贴图，节点下移 20。
     */
    const imgY = 426;
    mkSprite(sheet, 'fx/preview-img-shadow', 720, 720, 0, imgY - 20);
    const frame = new Node('figure');
    frame.layer = Layers.Enum.UI_2D;
    frame.addComponent(UITransform).setContentSize(620, 620);
    frame.setPosition(0, imgY, 0);
    frame.parent = sheet;
    mkSprite(frame, 'fx/preview-img-frame', 620, 620);
    // 贴纸填到框的内容区（620 减去 3px 边 ×2）
    const imgNode = new Node('img');
    imgNode.layer = Layers.Enum.UI_2D;
    imgNode.addComponent(UITransform).setContentSize(614, 614);
    imgNode.parent = frame;
    this.img = imgNode.addComponent(Sprite);
    this.img.sizeMode = Sprite.SizeMode.CUSTOM;

    /* `.preview-meta`：padding 30 top → 名字顶 = 116 − 30 = 86 */
    this.nameLabel = mkLabel(sheet, '', 44, 0, 86 - 26, C_INK, 900);
    this.captionLabel = mkLabel(sheet, '', 36, 0, 86 - 53 - 14 - 21, C_INK_SOFT, 900);

    /* `.preview-actions`：`margin-top:auto` 贴底 → 底部 padding 20 → 按钮中心 y = −802 + 20 + 59 */
    this.mkAction(sheet, '保存图片', -228, -723, false, () => this.h.onDownload(this.current));
    this.mkAction(sheet, '分享', 228, -723, true, () => {
      this.h.onShare(this.current, this.captionLabel.string);
    });
  }

  /** `.menu-btn`：胶囊（radius 100px）→ 九宫格；`primary` = #e0a94a 底 + 白字 */
  private mkAction(parent: Node, text: string, x: number, y: number, primary: boolean, onTap: () => void): void {
    const n = new Node('act');
    n.layer = Layers.Enum.UI_2D;
    // 两个按钮 `flex:1` + gap 24：可用宽 1000 − 56*2 = 888 → 单个 (888 − 24)/2 = 432
    n.addComponent(UITransform).setContentSize(432, 118);
    n.setPosition(x, y, 0);
    n.parent = parent;
    const sp = n.addComponent(Sprite);
    sp.sizeMode = Sprite.SizeMode.CUSTOM;
    sp.type = Sprite.Type.SLICED;
    setSprite(sp, primary ? 'fx/preview-btn-primary' : 'fx/preview-btn');
    mkLabel(n, text, 44, 0, 0, primary ? new Color(255, 255, 255) : C_INK, 432);
    n.on(Node.EventType.TOUCH_END, () => onTap());
  }

  render(imageId: number): void {
    this.current = imageId;
    resources.load(`stickers/sticker_${imageId}/spriteFrame`, SpriteFrame, (err, sf) => {
      if (err || !sf || !this.img.node?.isValid) return;
      this.img.spriteFrame = sf;
    });
    const animal = animalOf(imageId) ?? '未知';
    const mood = IMAGE_MOOD[imageId] ?? '';
    this.nameLabel.string = `图${imageId}  ·  ${animal}${mood ? `·${mood}` : ''}`;
    this.captionLabel.string = IMAGE_TEXT_PLACEHOLDER[imageId] ?? '';
  }

  show(): void { this.root.active = true; }
  hide(): void { this.root.active = false; }
  rootNode(): Node { return this.root; }
  destroy(): void { if (this.root?.isValid) this.root.destroy(); }
}
