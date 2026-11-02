/**
 * 结算吊牌（从 web/ui/result.ts 移植，2026-10-30）
 *
 * 复用 PLAY 吊牌骨架：麻绳 + 木牌从上方掉下来。与通用 `GameDialog` 的区别：
 *   - 顶部**英雄区**（三颗星 ⭐ 或 emoji 🏆/👑），一眼看出打得好不好；
 *   - **得分卡带滚动数字**（从 0 滚上去）；
 *   - **不传 score 就不画得分卡** —— 教学完成这类「没有分数可结」的弹窗用它省掉一整块；
 *   - 按钮**按行排布**，支持「置灰仍可点 + 弹提示」；
 *   - ✕ 关闭 = 回主页（给玩家一个一致的逃生口）。
 *
 * ⚠️ 滚动分数用全局 `setTimeout` 分段推进（不用 `window.setTimeout` —— 小游戏没有 window；
 * 也不用 tween 的 onUpdate —— 预览 shim 未实现）。
 */

import { Node, UITransform, Graphics, Label, Color, Layers, tween, Vec3, UIOpacity, Sprite } from 'cc';
import { mkFx, mkSprite, setSprite } from './uiPaint';

export interface ResultButton {
  text: string;
  onClick?: () => void;
  primary?: boolean;
  /** 置灰仍可点（点了弹 `disabledHint` 不执行）—— 与 GameDialog 同语义 */
  dim?: boolean;
  disabledHint?: string;
}

export interface ResultOptions {
  mode: 'win' | 'lose';
  /** emoji 占位图标（🏆 / 👑 / 💡）；传了 `stars` 时以星级优先 */
  icon?: string;
  /** 画三颗星（1~3 颗点亮），优先于 `icon` */
  stars?: number;
  title: string;
  /** 标题下方、得分上方的副文案（如「您的分数超越了 X% 的玩家」） */
  sub?: string;
  scoreLabel?: string;
  /** 不传 = 不画得分卡 */
  score?: number;
  hint?: string;
  note?: string;
  /** 按钮按行排布 */
  rows: ResultButton[][];
  /** ✕ 关闭的行为（默认等同「回主页」） */
  onHome?: () => void;
}

const CARD_W = 640;
const CARD_H = 780;
const CARD_Y = 40;

/** 滚动分数：总时长与缓动对齐 Web 版 rollNumber（620ms，cubic-out） */
const ROLL_MS = 620;

export class ResultPopup {
  private root: Node = null!;
  private drop: Node = null!;
  private card: Node = null!;
  private openState = false;
  /** 滚动分数的定时器（关闭/重开时清掉，避免旧动画改新弹窗的数字） */
  private rollTimer = 0;

  private constructor() { }

  static create(parent: Node): ResultPopup {
    const p = new ResultPopup();
    p.build(parent);
    return p;
  }

  private build(parent: Node): void {
    const root = new Node('ResultPopup');
    root.layer = Layers.Enum.UI_2D;
    root.addComponent(UITransform).setContentSize(1080, 1920);
    root.parent = parent;
    root.setPosition(0, 0, 0);
    root.active = false;
    this.root = root;

    const mask = new Node('mask');
    mask.layer = Layers.Enum.UI_2D;
    mask.addComponent(UITransform).setContentSize(1080, 1920);
    const mg = mask.addComponent(Graphics);
    mg.rect(-540, -960, 1080, 1920);
    mg.fillColor = new Color(20, 16, 12, 120);
    mg.fill();
    mask.parent = root;

    const drop = new Node('drop');
    drop.layer = Layers.Enum.UI_2D;
    drop.addComponent(UITransform).setContentSize(1080, 1920);
    drop.parent = root;
    this.drop = drop;

    const rope = new Node('rope');
    rope.layer = Layers.Enum.UI_2D;
    rope.addComponent(UITransform).setContentSize(400, 1920);
    const rg = rope.addComponent(Graphics);
    rg.lineWidth = 10;
    rg.strokeColor = new Color(196, 158, 104, 255);
    for (const dx of [-150, 150]) {
      rg.moveTo(dx * 1.6, 960);
      rg.lineTo(dx, CARD_Y + CARD_H / 2);
      rg.stroke();
    }
    rope.parent = drop;

    // 吊牌外投影 `0 26px 64px rgba(60,40,10,.45)`（Web `.lp-card`）→ 预烘焙模糊贴图。
    //    贴图 768x934（= 640x780 + 2*64，再留出 26 的下移），中心比牌中心低 13（dy/2）
    mkFx(drop, 'cardShadow', 'fx/shadow-card-result', 768, 934, 0, CARD_Y - 13);

    const card = new Node('card');
    card.layer = Layers.Enum.UI_2D;
    card.addComponent(UITransform).setContentSize(CARD_W, CARD_H);
    card.setPosition(0, CARD_Y, 0);
    // 牌面（米色渐变 #FFF8E7→#fdeccb + 6px 金边 #F5C542 + 圆角 38）→ 预烘焙切图。
    //    ⚠️ 原来画的是 #F3D9A4 实色 + 10px 棕边 + 圆角 34，与 Web `.lp-card` 不是同一套材质。
    //    ⚠️ 必须挂在 `drop` 上做**兄弟节点**、排在 `card` 之前：`show()` 每次都会
    //    `card.children.destroy()` 清空内容，牌面若放进 card 会在第一次刷新时被一起销毁
    //    （实测表现：牌面消失，只剩分数卡和按钮飘在半空）。
    mkSprite(drop, 'fx/card-result', CARD_W, CARD_H, 0, CARD_Y);
    card.parent = drop;
    card.on(Node.EventType.TOUCH_END, () => undefined); // 牌子上点不算关闭
    this.card = card;
  }

  private mkLabel(parent: Node, text: string, size: number, x: number, y: number, color: Color, w: number): Label {
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
    return l;
  }

  show(opts: ResultOptions): void {
    this.clearRoll();
    const card = this.card;
    // 重绘：清空旧内容（保留 card 自身）
    for (const c of card.children.slice()) c.destroy();

    let y = CARD_H / 2 - 80;

    // 英雄区：星级优先，其次 emoji；两个都没有就整块不画
    if (opts.stars !== undefined || opts.icon !== undefined) {
      if (opts.stars !== undefined) {
        const row = new Node('stars');
        row.layer = Layers.Enum.UI_2D;
        row.addComponent(UITransform).setContentSize(CARD_W - 80, 70);
        row.setPosition(0, y, 0);
        row.parent = card;
        for (let i = 0; i < 3; i++) {
          const s = this.mkLabel(row, i < opts.stars ? '⭐' : '☆', 56, -120 + i * 120, 0,
            new Color(i < opts.stars ? 255 : 150, i < opts.stars ? 190 : 140, 60, 255), 110);
          void s;
        }
      } else {
        this.mkLabel(card, opts.icon ?? '', 78, 0, y, new Color(255, 226, 130), CARD_W - 80);
      }
      y -= 100;
    }

    this.mkLabel(card, opts.title, 52, 0, y, new Color(96, 58, 26), CARD_W - 60);
    y -= 66;
    if (opts.sub) { this.mkLabel(card, opts.sub, 34, 0, y, new Color(130, 95, 55), CARD_W - 60); y -= 52; }

    // 得分卡（不传 score 就不画）
    if (opts.score !== undefined) {
      const box = new Node('scorebox');
      box.layer = Layers.Enum.UI_2D;
      box.addComponent(UITransform).setContentSize(CARD_W - 80, 150);
      box.setPosition(0, y - 60, 0);
      // 分数卡（米白渐变 #FFFDF6→#FBEFD2 + 3px 浅金边 #EAD08A + 圆角 28）→ 预烘焙切图
      //    ⚠️ 原来是 #FFFAEE 实色 + 圆角 22，少了渐变和描边
      mkSprite(box, 'fx/score-card', CARD_W - 80, 150);
      box.parent = card;
      this.mkLabel(box, opts.scoreLabel ?? '本关得分', 30, 0, 46, new Color(140, 110, 80), CARD_W - 100);
      const value = this.mkLabel(box, '0', 64, 0, -6, new Color(90, 50, 25), CARD_W - 100);
      if (opts.hint) this.mkLabel(box, opts.hint, 28, 0, -52, new Color(140, 110, 80), CARD_W - 100);
      this.rollNumber(value, opts.score);
      y -= 170;
    }

    if (opts.note) { this.mkLabel(card, opts.note, 32, 0, y, new Color(130, 95, 55), CARD_W - 60); y -= 54; }

    // 按钮（置灰仍可点 + 提示；非置灰才关弹窗并执行）
    for (const row of opts.rows) {
      const btnRow = new Node('btnrow');
      btnRow.layer = Layers.Enum.UI_2D;
      btnRow.addComponent(UITransform).setContentSize(CARD_W - 60, 110);
      btnRow.setPosition(0, y - 30, 0);
      btnRow.parent = card;
      const n = row.length;
      const bw = n > 1 ? Math.min(260, (CARD_W - 100) / n) : 320;
      for (let i = 0; i < n; i++) {
        const item = row[i]!;
        const btn = new Node('btn');
        btn.layer = Layers.Enum.UI_2D;
        // 贴图 320x102：多出的 6px 是 Web `box-shadow: 0 6px 0` 的硬边下影，
        // 所以节点按 102 建、整体上移 3，让**本体**（96 高）的圆心仍在 btnRow 的 0 位
        btn.addComponent(UITransform).setContentSize(bw, 102);
        btn.setPosition(-(n - 1) * bw / 2 + i * bw, 3, 0);
        // 胶囊按钮（Web `.rs-btn` 深灰+金边 / `.primary` 绿渐变+深绿边）→ 九宫格切图：
        // 左右各 48 是不拉伸的圆角区，中间横拉，任意宽度圆角都不会变成椭圆
        const bs = btn.addComponent(Sprite);
        bs.sizeMode = Sprite.SizeMode.CUSTOM;
        bs.type = Sprite.Type.SLICED;
        setSprite(bs, item.primary ? 'fx/rs-btn-primary' : 'fx/rs-btn');
        // 置灰：Web 是 `.rs-btn.dim { opacity: .5 }` —— 换的是透明度，不是换一套灰底
        if (item.dim) btn.addComponent(UIOpacity).opacity = 128;
        btn.parent = btnRow;
        this.mkLabel(btn, item.text, 36, 0, -3, new Color(255, 255, 255), bw - 12);
        btn.on(Node.EventType.TOUCH_END, () => {
          if (item.dim) return; // 置灰：只弹提示（由调用方 toast）——这里静默，避免重复提示
          this.hide();
          item.onClick?.();
        });
      }
      y -= 116;
    }

    // ✕ 关闭 = 回主页
    const close = new Node('close');
    close.layer = Layers.Enum.UI_2D;
    close.addComponent(UITransform).setContentSize(76, 76);
    close.setPosition(CARD_W / 2 - 52, CARD_H / 2 - 52, 0);
    const cg2 = close.addComponent(Graphics);
    cg2.circle(0, 0, 38);
    cg2.fillColor = new Color(255, 255, 255, 70);
    cg2.fill();
    close.parent = card;
    this.mkLabel(close, '✕', 40, 0, 2, new Color(96, 58, 26), 76);
    close.on(Node.EventType.TOUCH_END, () => {
      this.hide();
      opts.onHome?.();
    });

    this.openState = true;
    this.root.active = true;
    this.drop.setPosition(0, 1500, 0);
    tween(this.drop).stop();
    tween(this.drop).to(0.42, { position: new Vec3(0, 0, 0) }, { easing: 'backOut' }).start();
  }

  hide(): void {
    if (!this.openState) return;
    this.openState = false;
    this.clearRoll();
    this.root.active = false;
  }

  get open(): boolean {
    return this.openState;
  }

  rootNode(): Node {
    return this.root;
  }

  destroy(): void {
    this.clearRoll();
    if (this.root?.isValid) this.root.destroy();
  }

  private clearRoll(): void {
    if (this.rollTimer) {
      clearTimeout(this.rollTimer as unknown as number);
      this.rollTimer = 0;
    }
  }

  /** 分数从 0 滚到目标值（分段 setTimeout，避免依赖 tween 的 onUpdate） */
  private rollNumber(label: Label, target: number): void {
    const steps = 24;
    let i = 0;
    const step = (): void => {
      i++;
      const t = Math.min(1, i / steps);
      const eased = 1 - Math.pow(1 - t, 3);
      if (label.node?.isValid) label.string = String(Math.round(target * eased));
      if (i < steps) this.rollTimer = setTimeout(step, ROLL_MS / steps) as unknown as number;
      else this.rollTimer = 0;
    };
    step();
  }
}
