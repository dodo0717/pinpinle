import { _decorator, Component, Node, Sprite, SpriteFrame, UITransform, Layers, Rect, Texture2D, resources, Vec3, tween, Color, UIOpacity, Graphics, Label, HorizontalTextAlignment } from 'cc';
const { ccclass } = _decorator;
import type { MergeDisplay } from '../核心/merge';
import { pieceGeometry, QUADRANT_PX, type PieceGeometryInput } from './geometry';
import { currentTheme, P_CANDY, P_CLEAN, P_JOURNAL } from './theme';
import { alpha, fillV, shadow, dash, setSpriteRadii, styleText, rrect4 } from './paint';

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
  /**
   * 容器层 —— 只承载动画（拖动 / 掉落 / 回弹 / 融合三阶段）。
   * 位置恒为格心，不随融合外扩改变。
   *
   * ⚠️ 分两层是为了修「去边界滞后一步」：外扩改的是 baseX/baseY，
   * 而回位 tween（clearDrag）在手指抬起那一刻就把目标位置算死了 ——
   * 目标一旦是外扩前的旧值，tween 落点就会把融合块拽回旧中心，缝又露出一半，
   * 直到下一次 applyMerge 直接 setPosition 才补上。动的（root）与变的（face）分开后，
   * 动画目标永远有效，applyMerge 什么时候调用都不会打架。
   */
  root: Node;
  /** 块体层 —— 贴图 + 外扩后的尺寸与偏移，是融合视觉的全部载体 */
  face: Node;
  /** 贴纸白边底卡（face 的兄弟、垫在 face 下，随 face 一起外扩） */
  card: Graphics;
  sp: Sprite;
  /** 融合金环（①②③ 阶段点亮） */
  ring: Graphics;
  /** 补位淡入用的透明度；Cocos 的 opacity 要额外挂组件 */
  op: UIOpacity;
  /** 本格在网格中的行列，用于坐标换算 */
  row: number;
  col: number;
  /** 融合取样几何（null = 未融合，按整图象限取样） */
  geom: PieceGeometryInput | null;
  /** 格心（本地坐标）—— 所有动画的原点，build 时定好后不再变 */
  baseX: number;
  baseY: number;
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

    // 主题化底板（最先画 = 垫在所有格子之下）：糖果=木桌 / 果冻=白卡 / 手账=贴纸页
    // 第 1 关（classic = web 原型）：透明底 + 极淡白边（web #board），无格槽
    if (this.classic) this.buildWebFrame(totalW, totalH);
    else {
      this.buildPanel(totalW, totalH);
      this.buildSockets(originX, originY, step);
    }

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const root = new Node(`Cell_${r}_${c}`);
        root.parent = this.node;
        root.layer = Layers.Enum.UI_2D;
        root.addComponent(UITransform).setContentSize(cellSize, cellSize);
        root.setPosition(originX + c * step, originY - r * step);
        // 底卡先建 = 画在贴图下面
        const cardN = new Node('Card');
        cardN.parent = root;
        cardN.layer = Layers.Enum.UI_2D;
        cardN.addComponent(UITransform).setContentSize(cellSize, cellSize);
        const card = cardN.addComponent(Graphics);
        const face = new Node('Face');
        face.parent = root;
        face.layer = Layers.Enum.UI_2D;
        face.addComponent(UITransform).setContentSize(cellSize, cellSize);
        const sp = face.addComponent(Sprite);
        sp.sizeMode = Sprite.SizeMode.CUSTOM;
        const rr = this.pieceRadius;
        setSpriteRadii(sp, [rr, rr, rr, rr]);
        // 透明度挂在 root：底卡和贴图一起淡入（挂 face 的话补位时白边先冒出来）
        const op = root.addComponent(UIOpacity);
        const ring = this.buildRing(face, cellSize);
        const p = new Vec3(originX + c * step, originY - r * step, 0);
        const ref: CellRef = { root, face, card, sp, ring, op, row: r, col: c, geom: null, baseX: p.x, baseY: p.y };
        this.cells.push(ref);
        this.drawCard(ref);
      }
    }
  }

  /**
   * 主题底板：底板在 build() 最前创建，天然在所有格子下面。
   * candy：木桌渐变 + 深描边 + 厚投影；clean：白卡圆角 + 细描边；
   * journal：奶白纸面 + 棕细框（手账的贴纸页）。
   */
  /** 碎片圆角（按主题；融合侧会清零） */
  private get pieceRadius(): number {
    const id = currentTheme().id;
    return id === 'classic' ? 14 : id === 'journal' ? 18 : id === 'clean' ? 26 : 24;
  }

  /** 原样式（第 1 关）：三主题之前的棋盘外观 */
  private get classic(): boolean {
    return currentTheme().id === 'classic';
  }

  /** web #board：透明底，1px rgba(255,255,255,.12) 边，圆角 44 */
  private buildWebFrame(totalW: number, totalH: number): void {
    const n = new Node('WebFrame');
    n.parent = this.node;
    n.layer = Layers.Enum.UI_2D;
    n.addComponent(UITransform).setContentSize(totalW + 4, totalH + 4);
    const g = n.addComponent(Graphics);
    g.lineWidth = 1;
    g.strokeColor = new Color(255, 255, 255, 31);
    g.roundRect(-totalW / 2 - 2, -totalH / 2 - 2, totalW + 4, totalH + 4, 44);
    g.stroke();
  }

  /** web 原型的得分飘字落点（棋盘本地坐标；null = 原地上飘） */
  floatTarget: Vec3 | null = null;
  /** 飘字落到分数上那一刻的回调（HUD 分数弹一下） */
  onFloatLand: (() => void) | null = null;

  /** 底板外边距（棋盘四周留出的木框 / 白卡边） */
  static readonly PAD = 30;

  private buildPanel(totalW: number, totalH: number): void {
    const t = currentTheme();
    const pad = BoardView.PAD;
    const w = totalW + pad * 2;
    const h = totalH + pad * 2;
    const n = new Node('Panel');
    n.parent = this.node;
    n.layer = Layers.Enum.UI_2D;
    n.addComponent(UITransform).setContentSize(w, h);
    const g = n.addComponent(Graphics);
    if (t.id === 'candy') {
      // 原型 A .board：木纹渐变 + 5px 深边 + 10px 厚底 + 大投影 + 顶部高光
      const P = P_CANDY;
      shadow(g, new Color(0, 0, 0, 102), 60, 0, 44);
      g.fillColor = P.woodEdge;
      g.roundRect(-w / 2, -h / 2 - 22, w, h, 52);
      g.fill();
      shadow(g, null);
      g.roundRect(-w / 2, -h / 2, w, h, 52);
      fillV(g, h / 2, -h / 2, P.wood, P.woodDark);
      g.lineWidth = 12;
      g.strokeColor = P.woodEdge;
      g.roundRect(-w / 2, -h / 2, w, h, 52);
      g.stroke();
      g.fillColor = new Color(255, 255, 255, 56);
      g.roundRect(-w / 2 + 40, h / 2 - 18, w - 80, 8, 4);
      g.fill();
    } else if (t.id === 'clean') {
      // 原型 B .board：纯白圆角卡 + 柔和大投影
      shadow(g, new Color(34, 48, 63, 40), 60, 0, 26);
      g.fillColor = P_CLEAN.card;
      g.roundRect(-w / 2, -h / 2, w, h, 60);
      g.fill();
      shadow(g, null);
    } else {
      // 原型 C .board：奶白贴纸页 + 细棕框 + 点阵底纹 + 两角和纸胶带
      const P = P_JOURNAL;
      shadow(g, new Color(74, 59, 42, 46), 36, 0, 16);
      g.fillColor = P.sheet;
      g.roundRect(-w / 2, -h / 2, w, h, 22);
      g.fill();
      shadow(g, null);
      g.lineWidth = 3;
      g.strokeColor = P.border;
      g.roundRect(-w / 2, -h / 2, w, h, 22);
      g.stroke();
      g.fillColor = P.dots;
      for (let y = -h / 2 + 30; y < h / 2 - 10; y += 54) {
        for (let x = -w / 2 + 30; x < w / 2 - 10; x += 54) {
          g.circle(x, y, 3);
          g.fill();
        }
      }
      for (const [x, y, a, col] of [
        [-w / 2 + 50, h / 2 - 6, 35, P.washiPink],
        [w / 2 - 50, -h / 2 + 6, 35, P.washiBlue],
      ] as const) {
        const tn = new Node('Tape');
        tn.parent = n;
        tn.layer = Layers.Enum.UI_2D;
        tn.addComponent(UITransform).setContentSize(150, 40);
        tn.setPosition(x, y);
        tn.angle = a;
        const tg = tn.addComponent(Graphics);
        tg.fillColor = alpha(col, 210);
        tg.roundRect(-75, -19, 150, 38, 4);
        tg.fill();
      }
    }
  }

  /**
   * 格位底槽：candy 是木桌上挖出的暗槽、clean 是浅蓝灰格、journal 是一圈淡虚线。
   * 碎片消除 / 掉落的空当里能看到底槽，棋盘就不会「露馅」成一块平板。
   */
  private buildSockets(originX: number, originY: number, step: number): void {
    const t = currentTheme();
    const n = new Node('Sockets');
    n.parent = this.node;
    n.layer = Layers.Enum.UI_2D;
    n.addComponent(UITransform).setContentSize(1, 1);
    const g = n.addComponent(Graphics);
    const s = this.cellSize;
    const r = this.pieceRadius;
    if (t.id === 'journal') {
      g.lineWidth = 3;
      g.strokeColor = new Color(74, 59, 42, 46);
      dash(g, [10, 9]);
    }
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const x = originX + col * step - s / 2;
        const y = originY - row * step - s / 2;
        if (t.id === 'candy') {
          g.fillColor = new Color(0, 0, 0, 56);
          g.roundRect(x, y, s, s, r);
          g.fill();
          g.fillColor = new Color(0, 0, 0, 40);
          g.roundRect(x + 3, y + s - 14, s - 6, 10, 5);
          g.fill();
        } else if (t.id === 'clean') {
          g.fillColor = P_CLEAN.cell;
          g.roundRect(x, y, s, s, r);
          g.fill();
        } else {
          g.roundRect(x + 4, y + 4, s - 8, s - 8, r);
          g.stroke();
        }
      }
    }
  }

  /**
   * 碎片底卡（贴纸的白边 + 投影）：画在每格 face 下面，跟着 face 一起外扩，
   * 融合侧不留边 —— 一整组看上去就是同一张贴纸。
   */
  private drawCard(ref: CellRef): void {
    const g = ref.card;
    g.clear();
    const t = currentTheme();
    const m = ref.geom;
    const ext = GAP / 2;
    const w = this.cellSize + (m?.mergeLeft ? ext : 0) + (m?.mergeRight ? ext : 0);
    const h = this.cellSize + (m?.mergeUp ? ext : 0) + (m?.mergeDown ? ext : 0);
    const r = this.pieceRadius;
    // web 原型：2px 白边；融合组的外沿改描蜜金（web .cell.merged --edge-color: honey）
    const e = this.classic ? 2 : BoardView.EDGE;
    const up = !m?.mergeUp;
    const down = !m?.mergeDown;
    const left = !m?.mergeLeft;
    const right = !m?.mergeRight;
    // 白边只长在没融合的那几侧
    const x = -w / 2 - (left ? e : 0);
    const y = -h / 2 - (down ? e : 0);
    const cw = w + (left ? e : 0) + (right ? e : 0);
    const ch = h + (up ? e : 0) + (down ? e : 0);
    const R = r + e;
    const radii: [number, number, number, number] = [
      up && left ? R : 0, up && right ? R : 0, down && right ? R : 0, down && left ? R : 0,
    ];
    if (t.id === 'candy') shadow(g, new Color(0, 0, 0, 90), 10, 0, 6);
    else if (t.id === 'clean') shadow(g, new Color(34, 48, 63, 46), 12, 0, 5);
    else if (t.id === 'classic') shadow(g, new Color(74, 59, 42, m ? 36 : 56), m ? 4 : 8, 0, m ? 1 : 3);
    else shadow(g, new Color(74, 59, 42, 50), 8, 0, 4);
    g.fillColor = t.id === 'classic' && m ? new Color(224, 169, 74) : new Color(255, 255, 255);
    rrect4(g, x, y, cw, ch, radii);
    g.fill();
    shadow(g, null);
    if (t.id === 'journal' && !m) {
      // 贴纸裁切虚线（只给散块，融合后整组是一张贴纸，不再画裁切线）
      g.lineWidth = 3;
      g.strokeColor = new Color(74, 59, 42, 52);
      dash(g, [9, 8]);
      g.roundRect(x + 3, y + 3, cw - 6, ch - 6, R - 3);
      g.stroke();
      dash(g, []);
    }
    // 贴图圆角与底卡同步：融合侧是直角，接缝两边才严丝合缝
    setSpriteRadii(ref.sp, [up && left ? r : 0, up && right ? r : 0, down && right ? r : 0, down && left ? r : 0]);
  }

  /** 碎片白边宽度 */
  static readonly EDGE = 5;

  /**
   * 金环：融合三阶段点亮它，玩家才知道「这几块是一个整体」。
   *
   * 描边**在点亮时才画**（`drawRing`）：组是随盘面变化的，预画一个方框的话，
   * 2 块融合就会显示成两个各自独立的框 —— 那正好是「看起来没融合」的样子。
   * 颜色 / 线宽随主题（candy 金 / clean 金细 / journal 印章红细线）。
   */
  private buildRing(parent: Node, size: number): Graphics {
    const t = currentTheme();
    const n = new Node('Ring');
    n.parent = parent;
    n.layer = Layers.Enum.UI_2D;
    n.addComponent(UITransform).setContentSize(size, size);
    const g = n.addComponent(Graphics);
    g.lineWidth = t.ringWidth;
    g.strokeColor = t.ringColor;
    n.active = false;
    return g;
  }

  /**
   * 按当前融合状态重画描边：**只画没融合的那几条边**。
   *
   * 组内相邻的两块之间不画 → 整组看上去是一个外框，而不是几块各自加框。
   */
  private drawRing(ref: CellRef): void {
    const g = ref.ring;
    g.clear();
    const t = currentTheme();
    const m = ref.geom;
    const ext = GAP / 2;
    const e = this.classic ? 2 : BoardView.EDGE;
    const up = !m?.mergeUp;
    const down = !m?.mergeDown;
    const left = !m?.mergeLeft;
    const right = !m?.mergeRight;
    // 描边贴着底卡外沿（未融合侧含白边），而不是原始格子边。
    // 注意 ring 挂在 face 下，face 已按外扩做了偏移，这里按 face 中心算
    const L = -(this.cellSize + (m?.mergeLeft ? ext : 0) + (m?.mergeRight ? ext : 0)) / 2 - (left ? e : 0);
    const R = (this.cellSize + (m?.mergeLeft ? ext : 0) + (m?.mergeRight ? ext : 0)) / 2 + (right ? e : 0);
    const B = -(this.cellSize + (m?.mergeUp ? ext : 0) + (m?.mergeDown ? ext : 0)) / 2 - (down ? e : 0);
    const T = (this.cellSize + (m?.mergeUp ? ext : 0) + (m?.mergeDown ? ext : 0)) / 2 + (up ? e : 0);
    const r = this.pieceRadius + e;

    g.lineWidth = t.ringWidth;
    g.strokeColor = t.ringColor;
    if (t.id === 'journal') dash(g, [14, 10]);
    if (t.id === 'candy') shadow(g, alpha(P_CANDY.gold, 190), 22, 0, 0);
    else if (t.id === 'classic') shadow(g, null);
    else if (t.id === 'clean') shadow(g, new Color(245, 166, 35, 90), 18, 0, 6);
    else shadow(g, new Color(214, 69, 69, 70), 12, 0, 4);

    if (up) this.line(g, L + (left ? r : 0), T, R - (right ? r : 0), T);
    if (down) this.line(g, L + (left ? r : 0), B, R - (right ? r : 0), B);
    if (left) this.line(g, L, T - (up ? r : 0), L, B + (down ? r : 0));
    if (right) this.line(g, R, T - (up ? r : 0), R, B + (down ? r : 0));

    // 圆角只在两条相邻边都存在时补（融合侧没有边，也就不该有角）
    if (up && left) this.corner(g, L + r, T, L, T, L, T - r);
    if (up && right) this.corner(g, R - r, T, R, T, R, T - r);
    if (down && left) this.corner(g, L + r, B, L, B, L, B + r);
    if (down && right) this.corner(g, R - r, B, R, B, R, B + r);
    g.stroke();
    shadow(g, null);
    dash(g, []);
  }

  private line(g: Graphics, x1: number, y1: number, x2: number, y2: number): void {
    g.moveTo(x1, y1);
    g.lineTo(x2, y2);
  }

  private corner(g: Graphics, x1: number, y1: number, cx: number, cy: number, x2: number, y2: number): void {
    g.moveTo(x1, y1);
    g.quadraticCurveTo(cx, cy, x2, y2);
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
    const tex = this.texCache.get(imageId);
    if (!tex) { this.loadTexture(imageId); return; }
    ref.sp.spriteFrame = this.frameFor(ref, imageId, pieceId);
  }

  /**
   * 本块该取源图的哪一块 —— 融合「无缝」的关键。
   *
   * - 未融合：取自己那个象限（与旧行为逐像素等价）。
   * - 已融合：整组用**同一个**「屏幕 px → 源 px」比例取样，
   *   相邻两块的像素边界正好落在同一个源像素上，接缝真正消失（§11.6.3）。
   */
  private frameFor(ref: CellRef, imageId: number, pieceId: number): SpriteFrame {
    const sf = new SpriteFrame();
    sf.texture = this.texCache.get(imageId)!;
    sf.packable = false;
    const g = ref.geom;
    if (!g) {
      const pos = pieceId % 4;
      sf.rect = new Rect((pos % 2) * QUAD, Math.floor(pos / 2) * QUAD, QUAD, QUAD);
      return sf;
    }
    const geo = pieceGeometry(g);
    const sx = (g.groupCols * QUADRANT_PX) / geo.groupInkW;
    const sy = (g.groupRows * QUADRANT_PX) / geo.groupInkH;
    sf.rect = new Rect(
      g.quadCol * QUADRANT_PX + geo.inkLeft * sx,
      g.quadRow * QUADRANT_PX + geo.inkTop * sy,
      geo.inkW * sx,
      geo.inkH * sy,
    );
    return sf;
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

  /**
   * 融合视觉（§6.3 / §11.6.3）：组内每块向融合侧各外扩 GAP/2，缝被吃满 → 连成一整块。
   *
   * ⚠️ 外扩只负责「把缝补上」。真正决定「看得出是一张图」的是**纹理取样**：
   * 必须按整组的统一比例取样（见 `geometry.ts`）。只外扩、各按自己的元素尺寸取样的话，
   * 每块被拉伸的倍率不同，接缝两侧的源像素对不上 —— 缝没了，错位线还在。
   *
   * 组大小 ≥2 就走这条路：两张碎块只要同图 + 相邻 + 相对位置正确即成组（核心/merge.ts）。
   */
  applyMerge(displays: readonly MergeDisplay[]): void {
    for (const ref of this.cells) this.resetGeom(ref);
    for (const d of displays) {
      const ref = this.cells[d.cellIndex];
      if (!ref) continue;
      // 单块组没有融合边：保持「散块」外观（白边四周都在、手账裁切线在）
      if (d.groupSize < 2) { this.drawCard(ref); continue; }
      ref.geom = {
        cellSize: this.cellSize,
        gap: GAP,
        edge: 0,   // Cocos 版没有白描边，块本身就是贴图
        groupCols: d.groupCols,
        groupRows: d.groupRows,
        colInGroup: d.colInGroup,
        rowInGroup: d.rowInGroup,
        quadCol: d.quadCol,
        quadRow: d.quadRow,
        mergeLeft: d.mergeLeft,
        mergeRight: d.mergeRight,
        mergeUp: d.mergeUp,
        mergeDown: d.mergeDown,
      };
      this.expand(ref, d.mergeUp, d.mergeDown, d.mergeLeft, d.mergeRight);
      this.drawCard(ref);
      // 几何变了，纹理子矩形必须跟着重算：贴图多半已就绪，不会走异步加载回调
      this.paintFace(d.cellIndex, this.faces[d.cellIndex] ?? null);
      // 未满 4 块的融合组常亮主题环（原型 .cell.g：金光 / 金细线 / 印章红虚线）——
      // 玩家一眼看出「这两三块已经粘上了，再找剩下的」
      if (d.groupSize < 4 && !this.classic) {   // web 原型靠蜜金外沿表达融合，不再套环
        this.drawRing(ref);
        ref.ring.node.active = true;
      }
    }
  }

  /** 取消外扩：尺寸回格宽、偏移归零（不动 root，免得打断正在跑的动画） */
  private resetGeom(ref: CellRef): void {
    const t = ref.face.getComponent(UITransform)!;
    t.setContentSize(this.cellSize, this.cellSize);
    ref.face.setPosition(0, 0, 0);
    ref.card.node.setPosition(0, 0, 0);
    ref.geom = null;
    ref.ring.node.active = false;
    this.drawCard(ref);
    const r = this.pieceRadius;
    setSpriteRadii(ref.sp, [r, r, r, r]);
  }

  /**
   * 外扩量固定 gap/2：相邻两块各扩一半正好吃满缝，多扩会在缝上重叠出一道错位。
   *
   * 只改 face（尺寸 + 相对偏移），root 与 baseX/baseY 一律不动 ——
   * 这样正在跑的回位/掉落 tween 的目标永远是对的，融合生效不用等下一次重绘。
   */
  private expand(ref: CellRef, up: boolean, down: boolean, left: boolean, right: boolean): void {
    const h = GAP / 2;
    const w = this.cellSize + (left ? h : 0) + (right ? h : 0);
    const hh = this.cellSize + (up ? h : 0) + (down ? h : 0);
    const t = ref.face.getComponent(UITransform)!;
    t.setContentSize(w, hh);
    // 向融合侧各挪 gap/4：块变大的同时中心跟着走，缝才真正被吃满
    const dx = (right ? h / 2 : 0) - (left ? h / 2 : 0);
    const dy = (up ? h / 2 : 0) - (down ? h / 2 : 0);
    ref.face.setPosition(dx, dy, 0);
    ref.card.node.setPosition(dx, dy, 0);
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
      if (phase !== 'off') this.drawRing(ref);   // 组会变，描边必须现画
      ref.ring.node.active = phase !== 'off';
      tween(ref.root)
        .to(phase === 'off' ? ANIM.confirm : ANIM[phase], {
          position: new Vec3(ref.baseX, ref.baseY + p.dy, 0),
          scale: new Vec3(p.scale, p.scale, 1),
        })
        .start();
    }
  }

  /**
   * 得分飘字：从消除组中心向上飘并淡出（原版 §6.3 第五步，与消除并行）。
   * 主题化：candy 金黄粗字 + 棕描边 / clean 金色粗体 / journal 印章红手写。
   */
  floatScore(index: number, text: string, indices?: readonly number[]): void {
    const ref = this.cells[index];
    if (!ref) return;
    const c = this.centerOf(indices && indices.length ? indices : [index]);
    const t = currentTheme();
    const n = new Node('Float');
    n.parent = this.node;
    n.layer = Layers.Enum.UI_2D;
    n.addComponent(UITransform).setContentSize(320, 90);
    n.setPosition(c.x, c.y, 0);
    const l = n.addComponent(Label);
    l.string = text;
    if (t.id === 'classic') {
      // web .score-float：60px 蜜金粗字 + 白投影，从消除处飞向 HUD 分数（.5s，16% 时放到 1.3）
      styleText(l, { font: t.font, size: 60, color: new Color(224, 169, 74), bold: true, shadow: { color: new Color(255, 255, 255), y: 2 } });
      const op0 = n.addComponent(UIOpacity);
      const to = this.floatTarget ?? new Vec3(c.x, c.y + 160, 0);
      n.setScale(0.6, 0.6);
      op0.opacity = 0;
      tween(op0).to(FLOAT_SEC * 0.16, { opacity: 255 }).delay(FLOAT_SEC * 0.6).to(FLOAT_SEC * 0.24, { opacity: 0 }).start();
      tween(n)
        .to(FLOAT_SEC * 0.16, { scale: new Vec3(1.3, 1.3, 1) })
        .to(FLOAT_SEC * 0.84, { position: to, scale: new Vec3(0.5, 0.5, 1) })
        .call(() => { this.onFloatLand?.(); n.destroy(); })
        .start();
      return;
    }
    styleText(l, t.id === 'candy'
      ? { font: t.font, size: 64, color: P_CANDY.goldLight, outline: new Color(138, 74, 0), outlineWidth: 5, shadow: { color: new Color(255, 160, 40, 200), blur: 16 } }
      : t.id === 'clean'
        ? { font: t.font, size: 54, color: P_CLEAN.gold, bold: true, outline: new Color(255, 255, 255), outlineWidth: 5 }
        : { font: t.font, size: 60, color: P_JOURNAL.stamp, bold: true, outline: P_JOURNAL.sheet, outlineWidth: 4 });
    l.horizontalAlign = HorizontalTextAlignment.CENTER;
    const op = n.addComponent(UIOpacity);
    if (t.id === 'journal') n.angle = 6;

    n.setScale(0.6, 0.6);
    tween(n)
      .to(FLOAT_SEC * 0.3, { scale: new Vec3(1.15, 1.15, 1), position: new Vec3(c.x, c.y + 50, 0) })
      .to(FLOAT_SEC * 1.1, { scale: new Vec3(1, 1, 1), position: new Vec3(c.x, c.y + 170, 0) })
      .start();
    tween(op).delay(FLOAT_SEC * 0.7).to(FLOAT_SEC * 0.7, { opacity: 0 }).call(() => n.destroy()).start();
  }

  /** 若干格的几何中心（本地坐标） */
  private centerOf(indices: readonly number[]): { x: number; y: number } {
    let x = 0;
    let y = 0;
    let k = 0;
    for (const i of indices) {
      const r = this.cells[i];
      if (!r) continue;
      x += r.baseX; y += r.baseY; k++;
    }
    return k ? { x: x / k, y: y / k } : { x: 0, y: 0 };
  }

  /**
   * 完整贴纸弹出（原型 .full-pop）：四块消失的同时，整张贴纸在 2×2 中心鼓出来再缩没，
   * 玩家明确看到「拼成的是这张图」。按组分别弹（一次可能消多组）。
   */
  private playFullPop(indices: readonly number[]): void {
    const byImage = new Map<number, number[]>();
    for (const i of indices) {
      const p = this.faces[i];
      if (p === null || p === undefined) continue;
      const img = Math.floor(p / 4);
      const list = byImage.get(img) ?? [];
      list.push(i);
      byImage.set(img, list);
    }
    const t = currentTheme();
    for (const [img, list] of Array.from(byImage.entries())) {
      const tex = this.texCache.get(img);
      if (!tex) continue;
      // 同图多组时按 4 个一组切（消除组恒为 2×2，下标升序时同组的 4 格并不一定相连，
      // 但同图同时消两组极少见，取中心近似即可）
      for (let k = 0; k < list.length; k += 4) {
        const part = list.slice(k, k + 4);
        const c = this.centerOf(part);
        const size = this.cellSize * 2 + GAP;
        const n = new Node('FullPop');
        n.parent = this.node;
        n.layer = Layers.Enum.UI_2D;
        n.addComponent(UITransform).setContentSize(size, size);
        n.setPosition(c.x, c.y, 0);
        // 白边贴纸底
        const bg = n.addComponent(Graphics);
        shadow(bg, new Color(0, 0, 0, 90), 30, 0, 16);
        bg.fillColor = new Color(255, 255, 255);
        bg.roundRect(-size / 2 - 10, -size / 2 - 10, size + 20, size + 20, 40);
        bg.fill();
        shadow(bg, null);
        if (t.id === 'candy') {
          bg.lineWidth = 8;
          bg.strokeColor = P_CANDY.gold;
          bg.roundRect(-size / 2 - 10, -size / 2 - 10, size + 20, size + 20, 40);
          bg.stroke();
        }
        const pic = new Node('Pic');
        pic.parent = n;
        pic.layer = Layers.Enum.UI_2D;
        pic.addComponent(UITransform).setContentSize(size, size);
        const sp = pic.addComponent(Sprite);
        sp.sizeMode = Sprite.SizeMode.CUSTOM;
        const sf = new SpriteFrame();
        sf.texture = tex;
        sf.packable = false;
        sf.rect = new Rect(0, 0, TEX_SIZE, TEX_SIZE);
        sp.spriteFrame = sf;
        setSpriteRadii(sp, [32, 32, 32, 32]);
        const op = n.addComponent(UIOpacity);
        n.setScale(0.55, 0.55);
        if (t.id === 'journal') n.angle = -6;
        tween(n)
          .to(0.18, { scale: new Vec3(1.15, 1.15, 1) })
          .delay(0.12)
          .to(0.22, { scale: new Vec3(0.2, 0.2, 1) })
          .call(() => n.destroy())
          .start();
        tween(op).delay(0.34).to(0.16, { opacity: 0 }).start();
      }
    }
  }

  /** 消除：先鼓起一下，再缩没（原版 vanish：0→35% 鼓到 1.15，35%~100% 缩到 0） */
  playVanish(indices: readonly number[]): void {
    if (!this.classic) this.playFullPop(indices);
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
      const target = new Vec3(ref.baseX, ref.baseY, 0);
      ref.root.setPosition(ref.baseX, ref.baseY + 400, 0);
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
      const target = new Vec3(ref.baseX, ref.baseY, 0);
      ref.root.setPosition(ref.baseX, ref.baseY + n * s, 0);
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
      const target = new Vec3(ref.baseX, ref.baseY, 0);
      ref.root.setPosition(ref.baseX, ref.baseY + (row + 1) * s + 30, 0);
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
      const kx = Math.sign(dx) * 12;
      const ky = Math.sign(dy) * 12;
      const home = new Vec3(ref.baseX, ref.baseY, 0);
      tween(ref.root)
        .to(ANIM.reject / 3, { position: new Vec3(ref.baseX + kx, ref.baseY + ky, 0) })
        .to(ANIM.reject / 3, { position: home })
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
      ref.root.setPosition(ref.baseX + dx, ref.baseY + dy, 0);
      ref.root.setSiblingIndex(this.cells.length - 1);
    }
  }

  /** 取消拖动：整片归位 */
  clearDrag(): void {
    for (const ref of this.cells) {
      tween(ref.root).to(ANIM.swap, { position: new Vec3(ref.baseX, ref.baseY, 0) }).start();
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
