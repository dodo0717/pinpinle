/**
 * 关卡详情 / 开始弹窗（从 web/ui/levelPreview.ts 移植，2026-10-30）
 *
 * 点地图节点后，一块带麻绳的牌子从屏幕上方「吊下来」—— 这是覆盖在地图之上的**浮层**
 * （不是「另一屏」），背景地图照旧在底下，关掉只是收起，地图不重建。
 *
 * 与 Web 版的差异（Cocos 化）：
 *   - 麻绳 / 木牌 / 按钮全部**程序绘制**（Graphics + Label），不引入新素材；
 *   - 下落动画用 tween（backOut 回弹）替代 CSS keyframes；
 *   - Web 版传的是 playable 下标，Cocos 端地图直接就是关卡号，少一层间接更好读。
 *
 * 数据口径（与 Web 版一致）：
 *   - 星级目标 = 该关该模式的星线 [s1, s2, s3]，设计只展示 1 星 / 3 星；
 *   - 困难模式门槛：同一关必须先在**简单模式拿到 3 星**，否则按钮置灰 + 🔒，点了也不切。
 */

import { Node, UITransform, Graphics, Label, Color, Layers, tween, Vec3 } from 'cc';

export type LevelMode = 'normal' | 'nightmare';

export interface LevelPreviewHandlers {
  /** 取某关在某模式下的星线 [s1, s2, s3]（拿不到返回 undefined） */
  starLines: (level: number, mode: LevelMode) => readonly [number, number, number] | undefined;
  /** 用户在弹窗内切换难度 */
  onMode: (mode: LevelMode) => void;
  /** 该关能不能选困难（先简单 3 星）；false 时困难按钮置灰，点了也不切 */
  canNightmare: (level: number) => boolean;
  /** 关闭弹窗（点空白 / 关闭按钮） */
  onClose: () => void;
  /** 点 Play：以选中模式进入该关 */
  onPlay: (level: number, mode: LevelMode) => void;
}

const MODE_LABEL: Record<LevelMode, string> = { normal: '简单', nightmare: '困难' };

const CARD_W = 620;
const CARD_H = 620;
/** 牌子静止时相对屏幕中心的 y */
const CARD_Y = 60;
/** 难度按钮尺寸 */
const MODE_W = 200;
const MODE_H = 96;

export class LevelPreview {
  private root: Node = null!;
  private drop: Node = null!;
  private levelLabel: Label = null!;
  private starsLabel: Label = null!;
  private modeBtns: Record<LevelMode, Node> = null!;
  private modeLabels: Record<LevelMode, Label> = null!;
  private h: LevelPreviewHandlers;
  private level = 0;
  private curMode: LevelMode = 'normal';
  private openState = false;

  private constructor(handlers: LevelPreviewHandlers) {
    this.h = handlers;
  }

  static create(parent: Node, handlers: LevelPreviewHandlers): LevelPreview {
    const p = new LevelPreview(handlers);
    p.build(parent);
    return p;
  }

  private build(parent: Node): void {
    const root = new Node('LevelPreview');
    root.layer = Layers.Enum.UI_2D;
    root.addComponent(UITransform).setContentSize(1080, 1920);
    root.parent = parent;
    root.setPosition(0, 0, 0);
    root.active = false;
    this.root = root;

    // 遮罩：点它 = 关闭（牌子上点不算）
    const mask = new Node('mask');
    mask.layer = Layers.Enum.UI_2D;
    mask.addComponent(UITransform).setContentSize(1080, 1920);
    const mg = mask.addComponent(Graphics);
    mg.rect(-540, -960, 1080, 1920);
    mg.fillColor = new Color(20, 16, 12, 120);
    mg.fill();
    mask.parent = root;
    mask.on(Node.EventType.TOUCH_END, () => this.close());

    // 吊落整体：麻绳 + 牌子一起下落
    const drop = new Node('drop');
    drop.layer = Layers.Enum.UI_2D;
    drop.addComponent(UITransform).setContentSize(1080, 1920);
    drop.parent = root;
    this.drop = drop;

    // 麻绳：屏幕顶 → 牌子上缘，两条略斜
    const rope = new Node('rope');
    rope.layer = Layers.Enum.UI_2D;
    rope.addComponent(UITransform).setContentSize(400, 1920);
    const rg = rope.addComponent(Graphics);
    rg.lineWidth = 10;
    rg.strokeColor = new Color(196, 158, 104, 255);
    const ropeEnd = CARD_Y + CARD_H / 2;
    for (const dx of [-150, 150]) {
      rg.moveTo(dx * 1.6, 960);
      rg.lineTo(dx, ropeEnd);
      rg.stroke();
    }
    rope.parent = drop;

    // 木牌
    const card = new Node('card');
    card.layer = Layers.Enum.UI_2D;
    card.addComponent(UITransform).setContentSize(CARD_W, CARD_H);
    card.setPosition(0, CARD_Y, 0);
    const cg = card.addComponent(Graphics);
    cg.roundRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, 34);
    cg.fillColor = new Color(243, 217, 164, 255);
    cg.fill();
    cg.lineWidth = 10;
    cg.strokeColor = new Color(185, 138, 75, 255);
    cg.roundRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, 34);
    cg.stroke();
    card.parent = drop;
    // 牌子上点不算关闭：吃掉事件即可
    card.on(Node.EventType.TOUCH_END, () => undefined);

    let y = CARD_H / 2 - 90;

    // ✕ 关闭
    this.mkButton(card, '✕', 76, 76, CARD_W / 2 - 58, y - 8, new Color(255, 255, 255, 70), () => this.close());

    // 关卡号
    this.levelLabel = this.mkLabel(card, '', 52, 0, y, new Color(96, 58, 26), CARD_W - 140).getComponent(Label)!;
    y -= 110;

    // 难度切换（灰=未选，橙=选中）
    this.modeBtns = {} as Record<LevelMode, Node>;
    this.modeLabels = {} as Record<LevelMode, Label>;
    for (const m of ['normal', 'nightmare'] as LevelMode[]) {
      const btn = new Node('mode-' + m);
      btn.layer = Layers.Enum.UI_2D;
      btn.addComponent(UITransform).setContentSize(MODE_W, MODE_H);
      btn.setPosition(m === 'normal' ? -112 : 112, y, 0);
      btn.addComponent(Graphics);
      btn.parent = card;
      this.modeLabels[m] = this.mkLabel(btn, MODE_LABEL[m], 40, 0, 0, new Color(90, 50, 25), MODE_W).getComponent(Label)!;
      btn.on(Node.EventType.TOUCH_END, () => this.pick(m));
      this.modeBtns[m] = btn;
    }
    y -= 120;

    // 星级目标：1★ X 分 | 3★ Y 分
    this.starsLabel = this.mkLabel(card, '', 38, 0, y, new Color(120, 80, 40), CARD_W - 80).getComponent(Label)!;
    y -= 150;

    // Play
    const play = new Node('play');
    play.layer = Layers.Enum.UI_2D;
    play.addComponent(UITransform).setContentSize(360, 120);
    play.setPosition(0, y, 0);
    const pg = play.addComponent(Graphics);
    pg.roundRect(-180, -60, 360, 120, 60);
    pg.fillColor = new Color(126, 200, 120, 255);
    pg.fill();
    play.parent = card;
    this.mkLabel(play, 'Play', 52, 0, 0, new Color(255, 255, 255), 360);
    play.on(Node.EventType.TOUCH_END, () => {
      if (!this.openState) return;
      this.h.onPlay(this.level, this.curMode);
    });
  }

  private mkLabel(parent: Node, text: string, size: number, x: number, y: number, color: Color, w: number): Node {
    const n = new Node('t');
    n.layer = Layers.Enum.UI_2D;
    n.addComponent(UITransform).setContentSize(w, size + 16);
    const l = n.addComponent(Label);
    l.string = text;
    l.fontSize = size;
    l.lineHeight = size + 12;
    l.color = color;
    n.parent = parent;
    n.setPosition(x, y, 0);
    return n;
  }

  private mkButton(parent: Node, text: string, w: number, h: number, x: number, y: number, color: Color, onTap: () => void): Node {
    const n = new Node('btn');
    n.layer = Layers.Enum.UI_2D;
    n.addComponent(UITransform).setContentSize(w, h);
    n.setPosition(x, y, 0);
    const g = n.addComponent(Graphics);
    g.roundRect(-w / 2, -h / 2, w, h, h / 2);
    g.fillColor = color;
    g.fill();
    n.parent = parent;
    this.mkLabel(n, text, Math.min(40, h - 16), 0, 0, new Color(96, 58, 26), w);
    n.on(Node.EventType.TOUCH_END, () => onTap());
    return n;
  }

  private pick(m: LevelMode): void {
    if (m === this.curMode) return;
    // 困难模式有门槛：本关简单模式没拿到 3 星就不让选
    if (m === 'nightmare' && !this.h.canNightmare(this.level)) return;
    this.curMode = m;
    this.syncModes();
    this.renderStars();
    this.h.onMode(m);
  }

  /** 重画两个难度按钮的底色与文案（Web 版 syncModes：选中橙 / 未选灰 / 困难未达门槛灰+🔒） */
  private syncModes(): void {
    const canHard = this.h.canNightmare(this.level);
    for (const m of ['normal', 'nightmare'] as LevelMode[]) {
      const g = this.modeBtns[m].getComponent(Graphics)!;
      g.clear();
      g.roundRect(-MODE_W / 2, -MODE_H / 2, MODE_W, MODE_H, MODE_H / 2);
      if (m === this.curMode) g.fillColor = new Color(255, 196, 92, 255);
      else if (m === 'nightmare' && !canHard) g.fillColor = new Color(170, 170, 178, 255);
      else g.fillColor = new Color(226, 226, 232, 255);
      g.fill();
      this.modeLabels[m].string = m === 'nightmare' && !canHard ? `🔒 ${MODE_LABEL[m]}` : MODE_LABEL[m];
    }
  }

  private renderStars(): void {
    const line = this.h.starLines(this.level, this.curMode);
    this.starsLabel.string = line ? `1★ ${line[0]} 分  |  3★ ${line[2]} 分` : '';
  }

  open(level: number, currentMode: LevelMode): void {
    this.level = level;
    // 当前是困难但这一关其实没达门槛（存档被改过等边界）→ 退回简单，不给进
    this.curMode = currentMode === 'nightmare' && !this.h.canNightmare(level) ? 'normal' : currentMode;
    this.levelLabel.string = `第 ${level} 关`;
    this.syncModes();
    this.renderStars();

    this.openState = true;
    this.root.active = true;
    // 下落动画：从屏幕上方掉下来，轻微回弹（Web 版 CSS lp-drop 同感）
    this.drop.setPosition(0, 1500, 0);
    tween(this.drop).stop();
    tween(this.drop).to(0.42, { position: new Vec3(0, 0, 0) }, { easing: 'backOut' }).start();
  }

  close(): void {
    if (!this.openState) return;
    this.openState = false;
    this.root.active = false;
    this.h.onClose();
  }

  isOpen(): boolean {
    return this.openState;
  }

  /** 根节点（挂接方用来提到最上层 / 调整层级） */
  rootNode(): Node {
    return this.root;
  }

  destroy(): void {
    if (this.root?.isValid) this.root.destroy();
  }
}
