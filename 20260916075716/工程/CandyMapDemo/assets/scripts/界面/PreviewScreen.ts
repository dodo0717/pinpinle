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

    const bg = root.addComponent(Graphics);
    bg.rect(-540, -960, 1080, 1920);
    bg.fillColor = new Color(28, 24, 22, 230);
    bg.fill();

    mkLabel(root, '图鉴', 52, 0, 850, new Color(255, 255, 255), 400);

    const close = new Node('close');
    close.layer = Layers.Enum.UI_2D;
    close.addComponent(UITransform).setContentSize(96, 96);
    close.setPosition(450, 850, 0);
    const cg = close.addComponent(Graphics);
    cg.circle(0, 0, 48);
    cg.fillColor = new Color(255, 255, 255, 60);
    cg.fill();
    close.parent = root;
    mkLabel(close, '✕', 52, 0, 2, new Color(255, 255, 255), 96);
    close.on(Node.EventType.TOUCH_END, () => this.h.onBack());

    const board = new Node('figure');
    board.layer = Layers.Enum.UI_2D;
    board.addComponent(UITransform).setContentSize(640, 640);
    board.setPosition(0, 240, 0);
    const bgr = board.addComponent(Graphics);
    bgr.roundRect(-320, -320, 640, 640, 30);
    bgr.fillColor = new Color(255, 250, 240, 255);
    bgr.fill();
    bgr.lineWidth = 8;
    bgr.strokeColor = new Color(240, 196, 110, 255);
    bgr.roundRect(-320, -320, 640, 640, 30);
    bgr.stroke();
    board.parent = root;

    const imgNode = new Node('img');
    imgNode.layer = Layers.Enum.UI_2D;
    imgNode.addComponent(UITransform).setContentSize(560, 560);
    imgNode.parent = board;
    this.img = imgNode.addComponent(Sprite);
    this.img.sizeMode = Sprite.SizeMode.CUSTOM;

    this.nameLabel = mkLabel(root, '', 44, 0, -180, new Color(255, 255, 255), 960);
    this.captionLabel = mkLabel(root, '', 36, 0, -250, new Color(226, 220, 210), 960);

    this.mkAction(root, '保存图片', -180, -480, new Color(255, 196, 92, 255), () => this.h.onDownload(this.current));
    this.mkAction(root, '分享', 180, -480, new Color(126, 200, 120, 255), () => {
      this.h.onShare(this.current, this.captionLabel.string);
    });
  }

  private mkAction(parent: Node, text: string, x: number, y: number, color: Color, onTap: () => void): void {
    const n = new Node('act');
    n.layer = Layers.Enum.UI_2D;
    n.addComponent(UITransform).setContentSize(320, 110);
    n.setPosition(x, y, 0);
    const g = n.addComponent(Graphics);
    g.roundRect(-160, -55, 320, 110, 55);
    g.fillColor = color;
    g.fill();
    n.parent = parent;
    mkLabel(n, text, 40, 0, 0, new Color(90, 50, 25), 320);
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
