/**
 * 设置整屏（**2026-10-31 按 Web 实测逐元素重排**，基准 `docs/dump/web-settings.json`）
 *
 * Web 版（`web/ui/settings.ts` + `ui.css` 的 `.set-*`）：
 *   整屏蓝天渐变 → 150×150 棕返回钮 @(44,38) → 96px 白字描边标题（字中心 (540,113)）
 *   → **960×1350 的金框棕木卡**（圆角 118；卡内是木纹渐变 `#6a4632→#5c3a27(55%)→#4f3122`
 *     + 93deg 的 9px 周期细木纹）→ 卡内 4 条 152 高的木纹行条（gap 34）：
 *     音乐 / 音效 / 教学语音（各行一个 150×78 的开关切图）+ 新手教学「查看」
 *   → 卡下方版本号（40px `#44507a`，`text-shadow 0 2px 0 rgba(255,255,255,.35)`）。
 *
 * 素材全部**程序绘制**，颜色取 `node tools/art-samples.mjs` 的像素采样：
 *   settings/back.png #7e4933（中心 #9b653f）  icon-music #dda04a   icon-sfx #c28d5a
 *   toggle-on #93cb7d（上→下 #77b565 → #ade097 → #5a9a40，旋钮在第 5 段 = 右侧，米白 #d1d9c2）
 *   toggle-off #8c898f（上→下 #716d75 → #9e9ca1 → #6a666c，旋钮在第 2 段 = 左侧）
 *
 * ⚠️ 开关即时生效：onChange 交给调用方（MapBootstrap 直接改 GS.setSound/setBgm/setVoice，
 * 与 web/main.ts 的 onChange → audio.setSound 同口径），界面自己不碰存档。
 * ⚠️ 新手教学入口永久保留：首页按钮会在「困难模式累计通关 ≥10 关」后隐藏，
 * 但玩家可能还想回看（策划案 §14 决策 3）。
 *
 * 【毛边根治（2026-11-02）】原来卡内木纹、开关、查看钮全是 Graphics 硬画：
 *   - 卡：木纹被拆成 8 条色带 + 三角化圆角 118 → 预烘焙贴图 `fx/card-set`（480×675）；
 *   - 开关：`fillVGrad` 胶囊 + `circle()` 圆旋钮（三角化多边形 = 硬边圆）→ 只留 Web 的两张
 *     `toggle-on/off` 切图切换（`web/ui/settings.ts:53-61` 的 `backgroundImage` 切换，旋钮在图里）；
 *   - 查看钮：色带 + 放大实心矩形当投影 → 预烘焙 `fx/btn-view`（含 `0 5px 0` 硬投影）。
 *   现在程序绘制只剩**缺图兜底**（卡节点的 `drawWood()`，子节点贴图永远盖在上面）。
 *
 * 【手段差异（视觉对齐、手段不同）】
 *   - `text-shadow` → 错位深色文本副本（shim 没有描边组件）；
 *   - `.set-toggle:active` 的 `scale(.94)`、`.set-tutorial-btn:active` 的 `translateY(3px)` 未做。
 */

import { Node, UITransform, Graphics, Label, Color, Layers } from 'cc';
import { SETTINGS, TUTORIAL, VERSION } from '../玩法/text';
import {
  STAGE_H, STAGE_W, WHITE, fillVGrad, mkText, mkBackButton, mkTitle, mkSprite, setSprite,
  fitContain, paintScreenBg, mkFx,
} from './uiPaint';

/** 屏幕坐标（y 从顶向下）→ Cocos 局部（y 向上，原点屏幕中心） */
const localY = (cy: number): number => STAGE_H / 2 - cy;

/* ------------------------------------------------------------------ 布局常量（Web 实测） */

/** 返回钮：settings/back.png 采样 #7e4933（中心 #9b653f） */
const BACK_FILL = new Color(126, 73, 51, 255);
const BACK_GLYPH = new Color(155, 101, 63, 255);

/** 金框棕木卡：960×1350 @(60,222)，圆角 118；Web 的 `padding: 46px 44px 40px` */
const CARD_W = 960;
const CARD_H = 1350;
const CARD_CY = localY(222 + CARD_H / 2);
const CARD_R = 118;
const CARD_FRAME = 50;
const CARD_PAD_T = 46;
const CARD_SHADOW = new Color(20, 55, 120, Math.round(0.35 * 255));
/** 卡内木纹渐变（Web `.set-card`） */
const CARD_A = new Color(106, 70, 50, 255);    // #6a4632
const CARD_B = new Color(92, 58, 39, 255);     // #5c3a27（55%）
const CARD_C = new Color(79, 49, 34, 255);     // #4f3122

/** 行：872×152，gap 34（pitch 186），圆角 34 */
const ROW_W = 872;
const ROW_H = 152;
const ROW_GAP = 34;
const ROW_R = 34;
const ROW_A = new Color(122, 81, 56, 255);     // #7a5138
const ROW_B = new Color(102, 66, 44, 255);     // #66422c
const ROW_SHADOW = new Color(30, 15, 5, Math.round(0.25 * 255));
const ROW_INSET_TOP = new Color(255, 255, 255, Math.round(0.14 * 255));
const ROW_INSET_BOTTOM = new Color(0, 0, 0, Math.round(0.22 * 255));

/** 行内：图标 96×96 → gap 28 → 标签 → gap 28 → 开关 150×78（右端距行右 40） */
const ICON_SIZE = 96;
/** 两张图标的**原始像素**（`web/art/settings/`：icon-music 156×174、icon-sfx 188×170） */
const ICON_SRC: Array<[number, number]> = [[156, 174], [188, 170]];
const ROW_GAP_X = 28;
const ROW_PAD_X = 40;
const TOGGLE_W = 150;
const TOGGLE_H = 78;
const LABEL_FS = 60;
const LABEL_COLOR = new Color(255, 233, 196, 255);   // #ffe9c4
const LABEL_STROKE = new Color(40, 20, 5, Math.round(0.45 * 255));
/** 图标 / 开关相对行中心的偏移（行宽 872、行右 padding 40） */
const ICON_X = -ROW_W / 2 + ROW_PAD_X + ICON_SIZE / 2;
const TOGGLE_X = ROW_W / 2 - ROW_PAD_X - TOGGLE_W / 2;
/** 标签盒：图标右边 + gap → 开关左边 − gap */
const LABEL_X = ICON_X + ICON_SIZE / 2 + ROW_GAP_X;
const LABEL_W = TOGGLE_X - TOGGLE_W / 2 - ROW_GAP_X - LABEL_X;

/**
 * 「查看」钮：Web `.set-tutorial-btn` 140×76，38px 白字 900，橙渐变 `#ffd479→#ef9b28`
 * + `0 5px 0 rgba(150,80,10,.6)`。本体 + 硬投影都烘在 `fx/btn-view` 里（见 `mkTutorialRow`）。
 */
const TUT_BTN_W = 140;
const TUT_BTN_H = 76;
const TUT_BTN_FS = 38;

/**
 * 版本号：整宽居中，40px `#44507a` + `text-shadow 0 2px 0 rgba(255,255,255,.35)`。
 * ⚠️ 取的是**字的中心** y=1632（Web 实测）：`.set-version` 的盒是 1592..1788（含
 *    `padding:14px 0 130px`，中心 1690），字在顶部实体区 —— 对齐对齐字。
 */
const VERSION_FS = 40;
const VERSION_CY = localY(1632);
const VERSION_COLOR = new Color(68, 80, 122, 255);   // #44507a
const VERSION_STROKE = new Color(255, 255, 255, Math.round(0.35 * 255));

/** 木纹周期（Web 的 repeating-linear-gradient 是 9px 一个循环），几乎垂直的细条纹 —— Web 里很淡 */
const WOOD_PERIOD = 9;
const WOOD_DARK = new Color(0, 0, 0, Math.round(0.03 * 255));
const WOOD_LIGHT = new Color(255, 255, 255, Math.round(0.015 * 255));

interface ToggleRow {
  sync: (on: boolean) => void;
}

export interface SettingsPatch {
  sound?: boolean;
  bgm?: boolean;
  voice?: boolean;
}

export interface SettingsHandlers {
  onBack: () => void;
  onChange: (patch: SettingsPatch) => void;
  onTutorial: () => void;
}

export class SettingsScreen {
  private root: Node = null!;
  private rows: ToggleRow[] = [];
  private h: SettingsHandlers;
  private cur = { sound: true, bgm: true, voice: true };

  private constructor(handlers: SettingsHandlers) {
    this.h = handlers;
  }

  static create(parent: Node, handlers: SettingsHandlers): SettingsScreen {
    const s = new SettingsScreen(handlers);
    s.build(parent);
    return s;
  }

  private build(parent: Node): void {
    const root = new Node('SettingsScreen');
    root.layer = Layers.Enum.UI_2D;
    root.addComponent(UITransform).setContentSize(STAGE_W, STAGE_H);
    root.parent = parent;
    root.setPosition(0, 0, 0);
    root.active = false;
    this.root = root;

    paintScreenBg(root);
    mkBackButton(root, BACK_FILL, BACK_GLYPH, () => this.h.onBack(), 'settings/back');
    mkTitle(root, SETTINGS.title);

    // 金框棕木卡：框是 `leaderboard/frame.png` 切图（Web `.set-card::before` 明写复用它），
    // 内板是木纹渐变（程序绘制 —— Web 也是 CSS 渐变，没有切图）
    // 外投影 `0 26px 70px rgba(20,55,120,.35)` → 预烘焙贴图 1100x1516（图鉴屏同口径）
    mkFx(root, 'CardShadow', 'ui/fx/shadow-card-set', 1100, 1516, 0, CARD_CY - 13);
    const card = new Node('card');
    card.layer = Layers.Enum.UI_2D;
    card.addComponent(UITransform).setContentSize(CARD_W, CARD_H);
    card.setPosition(0, CARD_CY, 0);
    card.parent = root;
    const cg = card.addComponent(Graphics);
    drawWood(cg, CARD_W, CARD_H, CARD_A, CARD_B, CARD_C, CARD_R);
    // 木纹内板（Web `.set-card`：93deg 的 9px 周期细木纹 + 三段棕渐变，radius 118）→
    // 预烘焙贴图 `fx/card-set`（480×675 半分辨率，含 clip 在圆角内的木纹）。
    // ⚠️ 必须**先于**行条加入（子节点按加入顺序绘制），否则卡底会盖住行条；
    //    上面 `drawWood()` 的 Graphics 留在卡节点上做缺图兜底（子节点永远盖在父节点之上）。
    mkSprite(card, 'fx/card-set', CARD_W, CARD_H);

    // 行容器：顶部对齐卡的内容区（padding-top 46）
    const rowsY = CARD_H / 2 - CARD_PAD_T;
    for (let i = 0; i < 4; i++) {
      const y = rowsY - ROW_H / 2 - i * (ROW_H + ROW_GAP);
      if (i < 3) this.rows.push(this.mkToggleRow(card, i, y));
      else this.mkTutorialRow(card, y);
    }
    // 金框切图在**行之后**添加：Web 的 `::before` 盖在内容之上（图鉴屏同口径）
    mkSprite(card, 'leaderboard/frame', CARD_W, CARD_H);

    // 版本号（卡下方；screen 内侧 y = 1592：卡底 + card 的下 margin 20）
    mkText(root, SETTINGS.version(VERSION), VERSION_FS, 0, VERSION_CY - 2, VERSION_STROKE, STAGE_W, true, 'center');
    mkText(root, SETTINGS.version(VERSION), VERSION_FS, 0, VERSION_CY, VERSION_COLOR, STAGE_W, true, 'center');
  }

  /** 前三行：图标 + 60px 标签 + 150×78 开关 */
  private mkToggleRow(card: Node, i: number, y: number): ToggleRow {
    const row = new Node('row' + i);
    row.layer = Layers.Enum.UI_2D;
    row.addComponent(UITransform).setContentSize(ROW_W, ROW_H);
    row.setPosition(0, y, 0);
    // 行外投影 `0 6px 14px rgba(30,15,5,.25)` → 预烘焙贴图 900x186，中心比行中心低 3
    mkFx(card, 'RowShadow' + i, 'ui/fx/shadow-row', 900, 186, 0, y - 3);
    row.parent = card;
    // 行条本体（木纹底 + 88° 木纹细纹 + inset 上下边）→ 预烘焙切图。
    //    ⚠️ 原来 Graphics 硬画有三处不对：木纹被拆成 8 条色带；`inset 0 3px 0` 的高光被画成
    //    **整圈描边**（底部也白了，Web 只在上边）；圆角是三角化硬边。canvas 渲染与 Web 同口径。
    mkFx(row, 'Body', 'ui/fx/row-set', ROW_W, ROW_H, 0, 0);

    // 图标：Web 是 `<img>` + `object-fit: contain`（`.set-icon` 96×96）→ 用 `fitContain` 算实际尺寸
    const icon = new Node('icon');
    icon.layer = Layers.Enum.UI_2D;
    icon.addComponent(UITransform).setContentSize(ICON_SIZE, ICON_SIZE);
    icon.setPosition(ICON_X, 0, 0);
    icon.parent = row;
    const [iw, ih] = ICON_SRC[i === 0 ? 0 : 1]!;
    const [cw, ch] = fitContain(iw, ih, ICON_SIZE, ICON_SIZE);
    mkSprite(icon, `settings/${i === 0 ? 'icon-music' : 'icon-sfx'}`, cw, ch);

    // 标签（60px + 4px 下落阴影）
    const text = ['', SETTINGS.bgm, SETTINGS.sound, SETTINGS.voice][i + 1] ?? '';
    mkText(row, text, LABEL_FS, LABEL_X + LABEL_W / 2, -4, LABEL_STROKE, LABEL_W, true, 'left');
    mkText(row, text, LABEL_FS, LABEL_X + LABEL_W / 2, 0, LABEL_COLOR, LABEL_W, true, 'left');

    // 开关：切图 `toggle-on/off`（Web 直接换 background-image）；下面程序画的胶囊+旋钮是兜底
    const slot = new Node('toggle');
    slot.layer = Layers.Enum.UI_2D;
    slot.addComponent(UITransform).setContentSize(TOGGLE_W, TOGGLE_H);
    slot.setPosition(TOGGLE_X, 0, 0);
    slot.parent = row;
    const art = mkSprite(slot, 'settings/toggle-off', TOGGLE_W, TOGGLE_H);

    // ⚠️ 开关与 Web 口径一致：**只有背景切图切换**（`web/ui/settings.ts:53-61` 的
    //    `btn.style.backgroundImage = toggle-on/off`），没有任何程序绘制 —— 旋钮是画在
    //    toggle-on/off 两张切图里的。原来这里在切图之上又叠了 `fillVGrad` 胶囊 + 一个
    //    Graphics 圆旋钮（`circle()` 是三角化多边形 = 硬边圆），正是毛边的来源，已删。
    //    切图缺失时开关为空（Web 同样只有 background-image，缺图也是空）。
    const sync = (on: boolean): void => {
      setSprite(art, `settings/toggle-${on ? 'on' : 'off'}`);
    };
    const keys: Array<keyof SettingsPatch> = ['bgm', 'sound', 'voice'];
    slot.on(Node.EventType.TOUCH_END, () => {
      const k = keys[i]!;
      this.h.onChange({ [k]: !this.cur[k] } as SettingsPatch);
    });
    return { sync };
  }

  /** 第 4 行：新手教学（永久保留的回看入口）+ 「查看」钮 */
  private mkTutorialRow(card: Node, y: number): void {
    const row = new Node('row-tutorial');
    row.layer = Layers.Enum.UI_2D;
    row.addComponent(UITransform).setContentSize(ROW_W, ROW_H);
    row.setPosition(0, y, 0);
    mkFx(card, 'RowShadowTut', 'ui/fx/shadow-row', 900, 186, 0, y - 3);
    row.parent = card;
    mkFx(row, 'Body', 'ui/fx/row-set', ROW_W, ROW_H, 0, 0);
    // 这行没有图标：标签从图标的位置开始
    const x = ICON_X - ICON_SIZE / 2;
    const w = TOGGLE_X + TOGGLE_W / 2 - x;
    mkText(row, TUTORIAL.drawerTitle, LABEL_FS, x + w / 2, -4, LABEL_STROKE, w, true, 'left');
    mkText(row, TUTORIAL.drawerTitle, LABEL_FS, x + w / 2, 0, LABEL_COLOR, w, true, 'left');

    // Web `.set-tutorial-btn`：140×76 胶囊 + 渐变 #ffd479→#ef9b28 + `0 5px 0 rgba(150,80,10,.6)`。
    // 贴图 `fx/btn-view` 是 140×**81**（本体 76 画在**顶部**、下方 5 是硬投影）→
    // 本体中心比贴图中心高 2.5 → 节点整体**下移** 2.5（本体中心才落在行的 0 位），
    // 文字相对节点**上移** 2.5（回到本体中心）。别搞反，反了按钮会整体偏高 5px。
    const TUT_BTN_DY = 5;
    const btn = new Node('btn');
    btn.layer = Layers.Enum.UI_2D;
    btn.addComponent(UITransform).setContentSize(TUT_BTN_W, TUT_BTN_H + TUT_BTN_DY);
    btn.setPosition(TOGGLE_X + TOGGLE_W / 2 - TUT_BTN_W / 2, -TUT_BTN_DY / 2, 0);
    btn.parent = row;
    mkSprite(btn, 'fx/btn-view', TUT_BTN_W, TUT_BTN_H + TUT_BTN_DY);
    mkText(btn, SETTINGS.tutorialView, TUT_BTN_FS, 0, TUT_BTN_DY / 2, WHITE, TUT_BTN_W, true, 'center');
    btn.on(Node.EventType.TOUCH_END, () => this.h.onTutorial());
  }

  // ⚠️ 原 `paintRow()` 已删除：行条本体改用预烘焙切图 `ui/fx/row-set`，
  //    外投影改用 `ui/fx/shadow-row`，两者都由 `mkFx()` 铺成兄弟/子节点，见 `mkToggleRow()`。

  /** 同步三个开关（每次打开设置页时调一次） */
  render(settings: { sound: boolean; bgm: boolean; voice: boolean }): void {
    this.cur = { ...settings };
    this.rows[0]!.sync(settings.bgm);
    this.rows[1]!.sync(settings.sound);
    this.rows[2]!.sync(settings.voice);
  }

  show(): void { this.root.active = true; }
  hide(): void { this.root.active = false; }
  rootNode(): Node { return this.root; }
  destroy(): void { if (this.root?.isValid) this.root.destroy(); }
}

/* ------------------------------------------------------------------ 绘制小工具 */

/** 木纹底：竖向渐变 + 等宽的低透明竖条纹（Web 的 repeating-linear-gradient 是 9px 一个循环） */
function drawWood(
  g: Graphics, w: number, h: number, a: Color, b: Color, c: Color, r: number,
): void {
  fillVGrad(g, w, h, a, b, c, 0.55, r, 24);
  // ⚠️ 条纹也得跟着圆角走，否则两侧会把直角条纹戳出圆角外。
  //    这里按**列**算允许的高度（与 fillVGrad 的按行收窄是同一个圆的另一半几何）
  const lim = w / 2 - r;
  const halfTopAt = (x: number): number => {
    const ax = Math.abs(x);
    if (r <= 0 || ax <= lim) return h / 2;
    const dx = ax - lim;
    return h / 2 - r + Math.sqrt(Math.max(0, r * r - dx * dx));
  };
  for (let x = -w / 2; x < w / 2; x += WOOD_PERIOD) {
    const top = Math.min(halfTopAt(x), halfTopAt(x + WOOD_PERIOD));
    const hh = top * 2;
    g.fillColor = WOOD_DARK;
    g.rect(x, -top, 3, hh);
    g.fill();
    g.fillColor = WOOD_LIGHT;
    g.rect(x + 3, -top, 6, hh);
    g.fill();
  }
}

