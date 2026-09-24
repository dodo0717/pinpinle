import { _decorator, Component, Node, Sprite, SpriteFrame, UITransform, Layers, Rect, Texture2D, resources, Vec3, tween, Color, UIOpacity, Graphics, Label, HorizontalTextAlignment } from 'cc';
const { ccclass } = _decorator;

/** 得分飘字时长（秒）—— 原版 FLOAT_MS = 500，与消除并行 */
const FLOAT_SEC = 0.5;

/** 格子之间的缝隙（画布 px） */
export const GAP = 12;
/** 贴图源尺寸（sticker_*.png 为 512×512，四象限各 256） */
const TEX_SIZE = 512;
const QUAD = TEX_SIZE / 2;

/** 动效时长（秒）—— 与 DOM 版 web/main.ts 的 *_MS 一一对应 */
export const ANIM = {
  swap: 0.09,
  recognize: 0.06,
  fit: 0.05,
  confirm: 0.04,
  vanish: 0.35,
  fall: 0.26,
  spawn: 0.26,
  stagger: 0.012,
  reject: 0.3,
};

/** 融合三阶段（§6.3）：抬起识别 → 落回拼合 → 一顿确认 */
export type MergePhase = 'recognize' | 'fit' | 'confirm' | 'off';

/** 三阶段的位移/缩放，与 web/main.ts 的 @keyframes recog/fit/confirm 同值 */
const PHASE = {
  recognize: { dy: 4, scale: 1 },
  fit: { dy: 0, scale: 1 },
  confirm: { dy: 0, scale: 1.07 },
  off: { dy: 0, scale: 1 },
} as const;

interface CellRef {
  root: Node;
  sp: Sprite;
  /** 融合金环（①②③ 阶段点亮） */
  ring: Graphics;
  /** 补位淡入用的透明度；Cocos 的 opacity 要额外挂组件 */
  op: UIOpacity;
  /** 本格在网格中的行列，用于坐标换算 */
  row: number;
  col: number;
}

/**
 * 棋盘视图 —— 只负责「把 core 的数据画出来」和播放动效，不含任何玩法规则。
 * DOM 版对应 web/main.ts 的 layoutBoard / applyPieceFace / applyPieceGeometry。
 */
@ccclass('BoardView')
export class BoardView extends Component {
  private rows = 0;
  private cols = 0;
  private cellSize = 96;
  private cells: CellRef[] = [];
  private texCache = new Map<number, Texture2D>();
  /** 正在加载中的图 ID（防止同一张图被并发重复加载） */
  private loading = new Set<number>();
  /** 已确认缺失的图 ID（缺素材时不该每次重画都再请求一遍） */
  private missing = new Set<number>();
  /** 贴图加载完成后需要重绘的格子 */
  private dirty = new Set<number>();
  /** 每格当前显示的碎片 ID */
  private faces: (number | null)[] = [];

  /** 建格：rows×cols，cellSize 由外部按可用空间算好 */
  build(rows: number, cols: number, cellSize: number): void {
    this.rows = rows;
    this.cols = cols;
    this.cellSize = cellSize;
    this.cells = [];
    this.faces = new Array(rows * cols).fill(null);
    this.node.removeAllChildren();

    const step = cellSize + GAP;
    const totalW = cols * step - GAP;
    const totalH = rows * step - GAP;
    const originX = -totalW / 2 + cellSize / 2;
    const originY = totalH / 2 - cellSize / 2;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const root = new Node(`Cell_${r}_${c}`);
        root.parent = this.node;
        root.layer = Layers.Enum.UI_2D;
        root.addComponent(UITransform).setContentSize(cellSize, cellSize);
        root.setPosition(originX + c * step, originY - r * step);
        const sp = root.addComponent(Sprite);
        sp.sizeMode = Sprite.SizeMode.CUSTOM;
        const op = root.addComponent(UIOpacity);
        const ring = this.buildRing(root, cellSize);
        this.cells.push({ root, sp, ring, op, row: r, col: c });
      }
    }
  }

  /** 金环：融合三阶段点亮它，玩家才知道「这 4 块是一个整体」 */
  private buildRing(parent: Node, size: number): Graphics {
    const n = new Node('Ring');
    n.parent = parent;
    n.layer = Layers.Enum.UI_2D;
    n.addComponent(UITransform).setContentSize(size, size);
    const g = n.addComponent(Graphics);
    g.lineWidth = 5;
    g.strokeColor = new Color(255, 214, 92, 255);
    g.roundRect(-size / 2, -size / 2, size, size, 12);
    g.stroke();
    n.active = false;
    return g;
  }

  get step(): number { return this.cellSize + GAP; }
  get cellW(): number { return this.cellSize; }
  get size(): number { return this.cells.length; }
  cellNode(i: number): Node { return this.cells[i]!.root; }
  /** 网格坐标 → 本地坐标（用于拖动落点换算） */
  posOf(row: number, col: number): Vec3 {
    const s = this.step;
    const totalW = this.cols * s - GAP;
    const totalH = this.rows * s - GAP;
    return new Vec3(-totalW / 2 + this.cellSize / 2 + col * s, totalH / 2 - this.cellSize / 2 - row * s, 0);
  }

  /** 整盘重绘：cells 为 Grid.toArray() 的结果 */
  setCells(cells: readonly (number | null)[]): void {
    for (let i = 0; i < this.cells.length; i++) this.setCellFace(i, cells[i] ?? null);
  }

  /** 单格贴图：按碎片的位置码取原图对应象限 */
  setCellFace(i: number, pieceId: number | null): void {
    const ref = this.cells[i];
    if (!ref) return;
    this.faces[i] = pieceId;
    // ⚠️ 必须无条件复位：消除动画会把格子缩到 0.2 再 active=false，
    // 而下压/补位正是往这些格子里填新块 —— 不复位的表现就是「消除后再也没有图掉下来」。
    ref.root.active = pieceId !== null;
    ref.root.setScale(1, 1, 1);
    ref.op.opacity = 255;
    ref.ring.node.active = false;
    this.paintFace(i, pieceId);
  }

  /** 只换贴图，不动可见性与缩放（异步加载回调走这里，避免打断消除/掉落动画） */
  private paintFace(i: number, pieceId: number | null): void {
    const ref = this.cells[i];
    if (!ref) return;
    if (pieceId === null) { ref.sp.spriteFrame = null; return; }
    const imageId = Math.floor(pieceId / 4);
    const pos = pieceId % 4;
    const tex = this.texCache.get(imageId);
    if (!tex) { this.loadTexture(imageId); return; }
    ref.sp.spriteFrame = this.quadFrame(tex, pos);
  }

  private loadTexture(imageId: number): void {
    if (this.loading.has(imageId) || this.missing.has(imageId)) return;
    this.loading.add(imageId);
    resources.load(`stickers/sticker_${imageId}/texture`, Texture2D, (err, tex) => {
      this.loading.delete(imageId);
      if (err || !tex) { this.missing.add(imageId); console.warn('[board] 贴图缺失 sticker_' + imageId); return; }
      this.texCache.set(imageId, tex);
      this.repaintImage(imageId);
    });
  }

  /**
   * 预加载本关用到的贴图（对应原版 probeStickers 的「先探明哪些图真的到货」）。
   *
   * 不预加载的话，开局会先铺一盘空白格再一张张冒出来 —— 玩家看到的是
   * 「棋盘闪了一下才出来」。加载完回调上报缺失的图 ID，由界面决定要不要提示。
   */
  prewarm(imageIds: readonly number[], onDone?: (missing: number[]) => void): void {
    const missing: number[] = [];
    let left = imageIds.length;
    if (left === 0) { onDone?.(missing); return; }
    for (const id of imageIds) {
      if (this.texCache.has(id) || this.loading.has(id) || this.missing.has(id)) {
        // 已有 / 已在加载 / 已确认缺失：都不必再请求一遍
        if (--left === 0) onDone?.(missing);
        continue;
      }
      this.loading.add(id);
      resources.load(`stickers/sticker_${id}/texture`, Texture2D, (err, tex) => {
        this.loading.delete(id);
        if (err || !tex) { this.missing.add(id); missing.push(id); }
        else { this.texCache.set(id, tex); this.repaintImage(id); }
        if (--left === 0) onDone?.(missing);
      });
    }
  }

  private repaintImage(imageId: number): void {
    for (let i = 0; i < this.faces.length; i++) {
      const p = this.faces[i];
      if (p !== null && Math.floor(p / 4) === imageId) this.paintFace(i, p);
    }
  }

  private quadFrame(tex: Texture2D, pos: number): SpriteFrame {
    const sf = new SpriteFrame();
    sf.texture = tex;
    const col = pos % 2;
    const row = Math.floor(pos / 2);
    sf.rect = new Rect(col * QUAD, row * QUAD, QUAD, QUAD);
    sf.packable = false;
    return sf;
  }

  /** 融合视觉：整片向缝隙方向各外扩 GAP/2，连成一块（对应 DOM 版的 --pt/--pb/--pl/--pr） */
  applyMerge(displays: readonly { cellIndex: number; mergeUp: boolean; mergeDown: boolean; mergeLeft: boolean; mergeRight: boolean }[]): void {
    for (const ref of this.cells) this.resetGeom(ref);
    for (const d of displays) {
      const ref = this.cells[d.cellIndex];
      if (ref) this.expand(ref, d.mergeUp, d.mergeDown, d.mergeLeft, d.mergeRight);
    }
  }

  private resetGeom(ref: CellRef): void {
    const t = ref.root.getComponent(UITransform)!;
    t.setContentSize(this.cellSize, this.cellSize);
    const p = this.posOf(ref.row, ref.col);
    ref.root.setPosition(p);
  }

  private expand(ref: CellRef, up: boolean, down: boolean, left: boolean, right: boolean): void {
    const h = GAP / 2;
    const w = this.cellSize + (left ? h : 0) + (right ? h : 0);
    const hh = this.cellSize + (up ? h : 0) + (down ? h : 0);
    const t = ref.root.getComponent(UITransform)!;
    t.setContentSize(w, hh);
    const p = this.posOf(ref.row, ref.col);
    const dx = (right ? h / 2 : 0) - (left ? h / 2 : 0);
    const dy = (up ? h / 2 : 0) - (down ? h / 2 : 0);
    ref.root.setPosition(p.x + dx, p.y + dy, 0);
  }

  /**
   * 融合三阶段（§6.3）—— 消除动画的「说服力」全在这里。
   *
   * 4 块必须**同时**进入同一阶段：差一帧就会被看成「有一块没跟上」，
   * 而融合的全部说服力就在「这 4 块是一个整体」。所以这里不做逐格错开。
   */
  setMergePhase(indices: readonly number[], phase: MergePhase): void {
    const p = PHASE[phase];
    for (const i of indices) {
      const ref = this.cells[i];
      if (!ref) continue;
      const base = this.posOf(ref.row, ref.col);
      ref.ring.node.active = phase !== 'off';
      tween(ref.root)
        .to(phase === 'off' ? ANIM.confirm : ANIM[phase], {
          position: new Vec3(base.x, base.y + p.dy, 0),
          scale: new Vec3(p.scale, p.scale, 1),
        })
        .start();
    }
  }

  /** 得分飘字：从格子位置向上飘并淡出（原版 §6.3 第五步，与消除并行 500ms） */
  floatScore(index: number, text: string): void {
    const ref = this.cells[index];
    if (!ref) return;
    const n = new Node('Float');
    n.parent = this.node;
    n.layer = Layers.Enum.UI_2D;
    n.addComponent(UITransform).setContentSize(160, 60);
    const p = this.posOf(ref.row, ref.col);
    n.setPosition(p.x, p.y, 0);
    const l = n.addComponent(Label);
    l.string = text;
    l.fontSize = 34;
    l.lineHeight = 40;
    l.color = new Color(255, 214, 92, 255);
    l.horizontalAlign = HorizontalTextAlignment.CENTER;
    const op = n.addComponent(UIOpacity);

    tween(n).to(FLOAT_SEC, { position: new Vec3(p.x, p.y + 140, 0) }).start();
    tween(op).to(FLOAT_SEC, { opacity: 0 }).call(() => n.destroy()).start();
  }

  /** 消除：先鼓起一下，再缩没（原版 vanish：0→35% 鼓到 1.15，35%~100% 缩到 0） */
  playVanish(indices: readonly number[]): void {
    for (const i of indices) {
      const ref = this.cells[i];
      if (!ref) continue;
      ref.ring.node.active = false;
      tween(ref.root)
        .to(ANIM.vanish * 0.35, { scale: new Vec3(1.15, 1.15, 1) })
        .to(ANIM.vanish * 0.65, { scale: new Vec3(0, 0, 1) })
        .call(() => { ref.root.active = false; })
        .start();
    }
  }

  /** 入场：从上方逐个落下（按格错开，原版 --delay = i*18ms） */
  playDropIn(): void {
    for (let i = 0; i < this.cells.length; i++) {
      const ref = this.cells[i]!;
      const target = this.posOf(ref.row, ref.col);
      ref.root.setPosition(target.x, target.y + 400, 0);
      ref.op.opacity = 0;
      tween(ref.root).delay(i * 0.018).to(ANIM.spawn, { position: target }).start();
      tween(ref.op).delay(i * 0.018).to(ANIM.spawn * 0.55, { opacity: 255 }).start();
    }
  }

  /**
   * 掉落/补位：drops 为「原有块下落格数」，spawns 为「新块从上方进入」。
   *
   * 两者视觉上必须能分开，否则玩家以为「补位的新块是掉下来的老块」：
   *   - fall  —— 落地时压扁回弹（有重量感）
   *   - spawn —— 从上方淡入（凭空出现，一看就知道是新的）
   */
  playFall(drops: ReadonlyMap<number, number>, spawns: ReadonlyMap<number, number>): void {
    const s = this.step;
    for (const [i, n] of drops) {
      const ref = this.cells[i];
      if (!ref || n <= 0) continue;
      const target = this.posOf(ref.row, ref.col);
      ref.root.setPosition(target.x, target.y + n * s, 0);
      ref.op.opacity = 255;
      tween(ref.root)
        .delay(ref.col * ANIM.stagger)
        .to(ANIM.fall, { position: target })
        .to(ANIM.fall * 0.15, { scale: new Vec3(1.08, 0.93, 1) })
        .to(ANIM.fall * 0.15, { scale: new Vec3(1, 1, 1) })
        .start();
    }
    for (const [i, row] of spawns) {
      const ref = this.cells[i];
      if (!ref) continue;
      const target = this.posOf(ref.row, ref.col);
      ref.root.setPosition(target.x, target.y + (row + 1) * s + 30, 0);
      ref.op.opacity = 0;
      tween(ref.root).delay(ref.col * ANIM.stagger).to(ANIM.spawn, { position: target }).start();
      tween(ref.op).delay(ref.col * ANIM.stagger).to(ANIM.spawn * 0.55, { opacity: 255 }).start();
    }
  }

  /**
   * 非法交换：整片按**意图方向**弹一下再回原位。
   *
   * 方向必须由调用方给（拖动方向），不能固定左右抖 ——
   * 玩家往上拖被挡住，反馈却是左右抖，会以为是自己点错了地方。
   */
  playReject(indices: readonly number[], dx = 0, dy = 0): void {
    for (const i of indices) {
      const ref = this.cells[i];
      if (!ref) continue;
      const p = this.posOf(ref.row, ref.col);
      const kx = Math.sign(dx) * 12;
      const ky = Math.sign(dy) * 12;
      tween(ref.root)
        .to(ANIM.reject / 3, { position: new Vec3(p.x + kx, p.y + ky, 0) })
        .to(ANIM.reject / 3, { position: p })
        .start();
    }
  }

  /** 整盘抖一下（规则拒绝时的第二层反馈，原版 #board.reject-board） */
  playBoardReject(): void {
    const y = this.node.position.y;
    tween(this.node)
      .to(ANIM.reject / 5, { position: new Vec3(0, y - 3, 0) })
      .to(ANIM.reject / 5, { position: new Vec3(0, y + 3, 0) })
      .to(ANIM.reject / 5, { position: new Vec3(0, y, 0) })
      .start();
  }

  /** 拖动预览：整片跟随手指偏移 */
  setDragOffset(indices: readonly number[], dx: number, dy: number): void {
    for (const i of indices) {
      const ref = this.cells[i];
      if (!ref) continue;
      const p = this.posOf(ref.row, ref.col);
      ref.root.setPosition(p.x + dx, p.y + dy, 0);
      ref.root.setSiblingIndex(this.cells.length - 1);
    }
  }

  /** 取消拖动：整片归位 */
  clearDrag(): void {
    for (const ref of this.cells) {
      tween(ref.root).to(ANIM.swap, { position: this.posOf(ref.row, ref.col) }).start();
    }
  }

  /** 提示：整片轻微放大 */
  setHint(indices: readonly number[]): void {
    for (const ref of this.cells) tween(ref.root).to(0.12, { scale: new Vec3(1, 1, 1) }).start();
    for (const i of indices) {
      const ref = this.cells[i];
      if (ref) tween(ref.root).to(0.12, { scale: new Vec3(1.08, 1.08, 1) }).start();
    }
  }
}
