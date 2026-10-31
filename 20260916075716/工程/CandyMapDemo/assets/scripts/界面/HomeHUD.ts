/**
 * 首页 / 地图屏的顶栏与底栏 —— 2026-10-31 按 Web 版逐元素重建。
 *
 * 几何不是估的：来自 `node tools/ui-dump.mjs --probe web-home` 在 /web/index.html 上测出的
 * 真实 `getBoundingClientRect`（基准快照 docs/dump/web-home.json，1080×1920 逻辑坐标、y 向下），
 * 本文件里统一换算成 Cocos 的「画面中心原点 + y 向上」。
 *
 * 对照表（Web 实测 → 本文件常量）：
 *   返回圆钮 122×124 @(36,28)     —— 纯装饰（Web 首页没有实际返回功能）
 *   木牌     468×118 @(112,31)    —— banner.png
 *   头像      84×84  @(204,48)    —— 🐶 emoji 56px（Web 就是 emoji，用系统 emoji 字体）
 *   昵称     124×68  @(306,56)    —— 40px/800 #ffe9c7
 *   体力胶囊 300×108 @(744,28)    —— pill.png；红心 78×70 @(764,47)；数字 @(856,66) 32px/800；＋ 84×86 @(946,39)
 *   恢复倒计时 —— 胶囊下方（left 744 / right 970 / bottom −40），22px，满体力时为空串
 *   教学按钮 225×84  @(818.83,154) —— 金渐变 + 底影，❓教学 44px/900 #6b3a00
 *   换世界箭头 118×118 @(22|940,1582)
 *   翻页 ▲ 98×98 @(964,825) · 页点 · ▼ 98×98 @(964,997)
 *   底栏 1032×169 @(24,1731)，4 个页签 235×131
 *
 * 与 Web 的手段差异（视觉对齐、手段不同，已登记在 docs/核对-界面.md）：
 * - 渐变用「逐条带填色」近似（真引擎 Graphics 无渐变）；
 * - box-shadow 无模糊 → 用「扩散 + 低透明」或实心底影近似；
 * - 页签未选中态的 `grayscale(.55) brightness(.82)` → 用 Sprite 着色近似；
 * - 呼吸动画用 tween（真引擎 repeatForever；预览 shim 只跑一轮）。
 */

import {
  _decorator, Component, Node, UITransform, Layers, Graphics, Label, Sprite, Color,
  tween, Vec3, Vec2, UIOpacity, resources, SpriteFrame, LabelShadow,
} from 'cc';
const { ccclass } = _decorator;

import { HOME, TABBAR, TUTORIAL } from '../玩法/text';

/* ------------------------------------------------------------------ 常量（Web 实测几何） */

/** Web 实测 → Cocos：x' = x − 540，y' = 960 − y（矩形中心） */
const CX = (x: number, w: number): number => x + w / 2 - 540;
const CY = (y: number, h: number): number => 960 - (y + h / 2);

const BACK = { x: CX(36, 122), y: CY(28, 124), w: 122, h: 124 };
const USER = { x: CX(112, 468), y: CY(31, 118), w: 468, h: 118 };
const AVATAR = { x: CX(204, 84) - USER.x, y: CY(48, 84) - USER.y, w: 84, h: 84 };
const NICK = { x: CX(306, 124) - USER.x, y: CY(56, 68) - USER.y, w: 124, h: 68 };
const STAMINA = { x: CX(744, 300), y: CY(28, 108), w: 300, h: 108 };
const HEART = { x: CX(764, 78) - STAMINA.x, y: CY(47, 70) - STAMINA.y, w: 78, h: 70 };
const HEARTS = { x: CX(856, 76) - STAMINA.x, y: CY(66, 32) - STAMINA.y, w: 76, h: 32 };
const PLUS = { x: CX(946, 84) - STAMINA.x, y: CY(39, 86) - STAMINA.y, w: 84, h: 86 };
/** 恢复倒计时：left 744 / right 970 → 中心 857；胶囊底边(136)下方 40 */
const RECOVER = { x: CX(744, 226), y: CY(176, 26), w: 226, h: 26 };
const TUT = { x: CX(818.83, 225), y: CY(154, 84), w: 225, h: 84 };
const NAV_L = { x: CX(22, 118), y: CY(1582, 118) };
const NAV_R = { x: CX(940, 118), y: CY(1582, 118) };
const NAV_SIZE = 118;
const PAGER_X = CX(964, 98);
const PAGER_UP_Y = CY(825, 98);
const PAGER_DOWN_Y = CY(997, 98);
const PAGER_SIZE = 98;
const DOT_GAP = 28;   // 18px 圆点 + 10px 间距（实测 dots 高 46 = 18+10+18）
const TABBAR_POS = { x: CX(24, 1032), y: CY(1731, 169), w: 1032, h: 169 };
const TAB = { w: 235, h: 131, dx: 245, y: CY(1750, 131) - TABBAR_POS.y };
const TAB_ICON = { w: 84, h: 78, dy: CY(1758, 78) - CY(1750, 131) };
const TAB_LABEL = { h: 36, dy: CY(1840, 36) - CY(1750, 131) };

const GOLD_TOP = new Color(255, 233, 168, 255);   // #ffe9a8
const GOLD_BOTTOM = new Color(240, 180, 69, 255);  // #f0b445
const ARROW_TOP = new Color(255, 228, 155, 255);   // #ffe49b
const ARROW_MID = new Color(247, 177, 63, 255);    // #f7b13f
const ARROW_BOTTOM = new Color(217, 123, 18, 255); // #d97b12

@ccclass('HomeHUD')
export class HomeHUD extends Component {
  /** 教学按钮（体力胶囊正下方） */
  btnTutorial: Node = null!;
  private plusNode: Node = null!;
  /** 底栏 4 个页签节点（顺序与 Web 一致：首页 / 排行榜 / 图鉴 / 设置） */
  tabs: Node[] = [];
  private nickLabel: Label = null!;
  private staminaLabel: Label = null!;
  private recoverLabel: Label = null!;
  private tabIcons: Sprite[] = [];
  private tabLabels: Label[] = [];
  private tabPills: Node[] = [];
  private navLeft: Node = null!;
  private navRight: Node = null!;
  private pagerUp: Node = null!;
  private pagerDown: Node = null!;
  /** 可见的圆形本体（调透明度用；点击不挂在它身上，见 `goldCircle`） */
  private navLeftV: { visual: Node; hit: Node } = null!;
  private navRightV: { visual: Node; hit: Node } = null!;
  private pagerUpV: { visual: Node; hit: Node } = null!;
  private pagerDownV: { visual: Node; hit: Node } = null!;
  private dots: Node[] = [];

  build(): void {
    const root = this.node;
    root.removeAllChildren();
    this.buildTopbar(root);
    this.buildNav(root);
    this.buildTabbar(root);
  }

  /* ---------------------------------------------------------------- 顶栏 */

  private buildTopbar(root: Node): void {
    // 返回圆钮（装饰）：Web 的 .home-back 是背景图，首页不做实际返回
    this.makeSprite(root, 'BtnBack', 'ui/home/back', BACK.w, BACK.h, BACK.x, BACK.y);

    // 木牌 + 头像 + 昵称
    const user = this.mkNode(root, 'TopUser', USER.w, USER.h, USER.x, USER.y);
    this.makeSprite(user, 'Img', 'ui/home/banner', USER.w, USER.h, 0, 0);
    this.label(user, '🐶', 56, new Color(255, 255, 255, 255), AVATAR.w, AVATAR.h, AVATAR.x, AVATAR.y);
    this.nickLabel = this.label(user, HOME.nickname, 40, new Color(255, 233, 199, 255), NICK.w, NICK.h, NICK.x, NICK.y, true,
      { color: new Color(40, 20, 5, 89), dx: 0, dy: -3 });

    // 体力胶囊 + 红心 + 数字 + ＋
    const stamina = this.mkNode(root, 'TopStamina', STAMINA.w, STAMINA.h, STAMINA.x, STAMINA.y);
    this.makeSprite(stamina, 'Img', 'ui/home/pill', STAMINA.w, STAMINA.h, 0, 0);
    this.makeSprite(stamina, 'Heart', 'ui/home/heart', HEART.w, HEART.h, HEART.x, HEART.y);
    this.staminaLabel = this.label(stamina, '0', 32, new Color(255, 255, 255, 255), HEARTS.w, HEARTS.h, HEARTS.x, HEARTS.y, true);
    this.plusNode = this.makeSprite(stamina, 'Plus', 'ui/home/plus', PLUS.w, PLUS.h, PLUS.x, PLUS.y).node;
    // 恢复倒计时（Web：满体力时空串 —— 不显示任何东西）
    this.recoverLabel = this.label(root, '', 22, new Color(255, 233, 176, 255), RECOVER.w, RECOVER.h, RECOVER.x, RECOVER.y, false,
      { color: new Color(0, 0, 0, 140), dx: 0, dy: -2 });

    // 教学按钮：金渐变胶囊 + 底影
    this.btnTutorial = this.mkNode(root, 'BtnTutorial', TUT.w, TUT.h, TUT.x, TUT.y);
    const g = this.btnTutorial.addComponent(Graphics);
    g.fillColor = new Color(140, 80, 20, 140);   // 底影 0 6px 0 rgba(140,80,20,.55)
    this.roundRect(g, -TUT.w / 2, -TUT.h / 2 - 6, TUT.w, TUT.h, 42);
    g.fill();
    this.fillVGradient(g, -TUT.w / 2, -TUT.h / 2, TUT.w, TUT.h, 42, GOLD_TOP, GOLD_BOTTOM, 14);
    this.label(this.btnTutorial, `❓${TUTORIAL.entry}`, 44, new Color(107, 58, 0, 255), TUT.w, TUT.h, 0, 0, true);
  }

  /* ---------------------------------------------------------------- 换世界箭头 / 翻页 */

  private buildNav(root: Node): void {
    // navLeft/navRight/pagerUp/pagerDown = **点击盒**；navLeftV 等 = 可见的圆（用于调透明度）
    this.navLeftV = this.goldCircle(root, 'NavLeft', '‹', NAV_L.x, NAV_L.y, NAV_SIZE);
    this.navRightV = this.goldCircle(root, 'NavRight', '›', NAV_R.x, NAV_R.y, NAV_SIZE);
    this.pagerUpV = this.goldCircle(root, 'PagerUp', '▲', PAGER_X, PAGER_UP_Y, PAGER_SIZE);
    this.pagerDownV = this.goldCircle(root, 'PagerDown', '▼', PAGER_X, PAGER_DOWN_Y, PAGER_SIZE);
    this.navLeft = this.navLeftV.hit;
    this.navRight = this.navRightV.hit;
    this.pagerUp = this.pagerUpV.hit;
    this.pagerDown = this.pagerDownV.hit;
    // 页点：两页（每个世界固定 2 屏，与 Web 的 PAGE 数一致）
    for (let i = 0; i < 2; i++) {
      const d = this.mkNode(root, `PagerDot${i}`, 18, 18, PAGER_X, (i === 0 ? DOT_GAP / 2 : -DOT_GAP / 2));
      const g = d.addComponent(Graphics);
      g.fillColor = new Color(255, 246, 218, 255);
      g.circle(0, 0, 9);
      g.fill();
      this.dots.push(d);
    }
  }

  /**
   * 圆形按钮：视觉圆 + **圆形点击**。
   *
   * ⚠️ 为什么点击盒要单独做成一个内接正方形：Cocos 的命中区域是**矩形**，而 Web 的圆钮有
   * `border-radius: 50%`，浏览器按**圆形**命中 —— 圆外的四个角根本不接事件。
   * 少了这一层，换世界箭头的方框会把它旁边的关卡珠按纽所在的尖角一并吃掉：
   * 第 1 世界的第 1 关珠心正好落在右边箭头的方框角上，导致「点关卡珠没反应」。
   * 内接正方形边长 = size / √2，整个都落在可见圆内 —— 视觉不变，命中范围与 Web 的圆形相当。
   */
  private goldCircle(root: Node, name: string, glyph: string, x: number, y: number, size: number): { visual: Node; hit: Node } {
    const n = this.mkNode(root, name, size, size, x, y);
    const hit = this.mkNode(n, 'Hit', Math.round(size / Math.SQRT2), Math.round(size / Math.SQRT2), 0, 0);
    const g = n.addComponent(Graphics);
    // 底影 0 8px 0 rgba(140,70,10,.5)
    g.fillColor = new Color(140, 70, 10, 128);
    g.circle(0, -8, size / 2);
    g.fill();
    // 径向渐变 #ffe49b → #f7b13f → #d97b12（无径向：用三层同心圆近似）
    g.fillColor = ARROW_BOTTOM;
    g.circle(0, 0, size / 2);
    g.fill();
    g.fillColor = ARROW_MID;
    g.circle(0, 0, size / 2 * 0.78);
    g.fill();
    g.fillColor = ARROW_TOP;
    g.circle(0, 0, size / 2 * 0.5);
    g.fill();
    // 描边 5px #fff3d6
    g.lineWidth = 5;
    g.strokeColor = new Color(255, 243, 214, 255);
    g.circle(0, 0, size / 2 - 2.5);
    g.stroke();
    this.label(n, glyph, 78, new Color(255, 255, 255, 255), size, size, 0, 0, true);
    // 呼吸：1 → 1.06 → 1
    tween(n).repeatForever(tween<Node>().to(0.8, { scale: new Vec3(1.06, 1.06, 1) }).to(0.8, { scale: new Vec3(1, 1, 1) })).start();
    return { visual: n, hit };
  }

  /* ---------------------------------------------------------------- 底栏 */

  private buildTabbar(root: Node): void {
    const bar = this.mkNode(root, 'Tabbar', TABBAR_POS.w, TABBAR_POS.h, TABBAR_POS.x, TABBAR_POS.y);
    const g = bar.addComponent(Graphics);
    // 外投影 0 18px 40px rgba(0,0,0,.18)：扩散近似
    g.fillColor = new Color(0, 0, 0, 46);
    this.roundRect(g, -TABBAR_POS.w / 2 - 10, -TABBAR_POS.h / 2 - 18 + 10, TABBAR_POS.w + 20, TABBAR_POS.h + 20, 44);
    g.fill();
    // 木纹渐变 #6b4426 → #4a2d18
    this.fillVGradient(g, -TABBAR_POS.w / 2, -TABBAR_POS.h / 2, TABBAR_POS.w, TABBAR_POS.h, 44, new Color(107, 68, 38, 255), new Color(74, 45, 24, 255), 16);
    // 描边 5px #3a2312
    g.lineWidth = 5;
    g.strokeColor = new Color(58, 35, 18, 255);
    this.roundRect(g, -TABBAR_POS.w / 2 + 2.5, -TABBAR_POS.h / 2 + 2.5, TABBAR_POS.w - 5, TABBAR_POS.h - 5, 41.5);
    g.stroke();

    // 页签顺序与 Web 一致：首页 / 排行榜 / 图鉴 / 设置
    const order = [
      { label: TABBAR.home, icon: 'ui/home/tab-home' },
      { label: TABBAR.leaderboard, icon: 'ui/home/tab-rank' },
      { label: TABBAR.collection, icon: 'ui/home/tab-book' },
      { label: TABBAR.settings, icon: 'ui/home/tab-gear' },
    ];
    this.tabs = [];
    this.tabIcons = [];
    this.tabLabels = [];
    this.tabPills = [];
    order.forEach((t, i) => {
      const tab = this.mkNode(bar, `Tab${i}`, TAB.w, TAB.h, -TAB.dx * 1.5 + i * TAB.dx, TAB.y);
      // 选中态金胶囊（默认隐藏）
      const pill = this.mkNode(tab, 'Sel', TAB.w, TAB.h, 0, 0);
      const pg = pill.addComponent(Graphics);
      pg.fillColor = new Color(160, 90, 10, 140);   // 底影 0 6px 0 rgba(160,90,10,.55)
      this.roundRect(pg, -TAB.w / 2, -TAB.h / 2 - 6, TAB.w, TAB.h, 26);
      pg.fill();
      this.fillVGradient(pg, -TAB.w / 2, -TAB.h / 2, TAB.w, TAB.h, 26, new Color(255, 217, 119, 255), new Color(245, 183, 61, 255), 12);
      pill.active = false;
      const sp = this.makeSprite(tab, 'Icon', t.icon, TAB_ICON.w, TAB_ICON.h, 0, TAB_ICON.dy);
      sp.color = new Color(160, 160, 160, 255);   // 未选中：grayscale(.55) brightness(.82) 的近似
      const lb = this.label(tab, t.label, 26, new Color(232, 217, 195, 255), TAB.w, 36, 0, TAB_LABEL.dy, true);
      this.tabs.push(tab);
      this.tabIcons.push(sp);
      this.tabLabels.push(lb);
      this.tabPills.push(pill);
    });
  }

  /* ---------------------------------------------------------------- 对外接口 */

  onReady(cbs: {
    onTutorial: () => void;
    onBack: () => void;
    onTab: (index: number) => void;
    onNav: (dir: -1 | 1) => void;
    onPage: (dir: -1 | 1) => void;
    onPlus: () => void;
  }): void {
    this.btnTutorial.on(Node.EventType.TOUCH_END, () => cbs.onTutorial(), this);
    this.plusNode.on(Node.EventType.TOUCH_END, () => cbs.onPlus(), this);
    this.navLeft.on(Node.EventType.TOUCH_END, () => cbs.onNav(-1), this);
    this.navRight.on(Node.EventType.TOUCH_END, () => cbs.onNav(1), this);
    this.pagerUp.on(Node.EventType.TOUCH_END, () => cbs.onPage(-1), this);
    this.pagerDown.on(Node.EventType.TOUCH_END, () => cbs.onPage(1), this);
    this.tabs.forEach((t, i) => {
      t.on(Node.EventType.TOUCH_END, () => cbs.onTab(i), this);
      // :active 反馈：按下缩一点
      t.on(Node.EventType.TOUCH_START, () => tween(t).to(0.08, { scale: new Vec3(0.96, 0.96, 1) }).start(), this);
      t.on(Node.EventType.TOUCH_CANCEL, () => tween(t).to(0.1, { scale: new Vec3(1, 1, 1) }).start(), this);
    });
    void cbs.onBack;
  }

  setNickname(name: string): void { this.nickLabel.string = name; }
  setStamina(text: string): void { this.staminaLabel.string = text; }
  /** 满体力时传空串（Web：`.home-recover` 只在有倒计时时才有文本） */
  setCountdown(text: string): void { this.recoverLabel.string = text; }
  setTutorialVisible(v: boolean): void { this.btnTutorial.active = v; }

  setTab(index: number): void {
    this.tabs.forEach((t, i) => {
      const on = i === index;
      this.tabPills[i]!.active = on;
      this.tabIcons[i]!.color = on ? new Color(255, 255, 255, 255) : new Color(160, 160, 160, 255);
      this.tabLabels[i]!.color = on ? new Color(109, 61, 10, 255) : new Color(232, 217, 195, 255);
      void t;
    });
  }

  setNavEnabled(left: boolean, right: boolean): void {
    this.setOpacity(this.navLeftV.visual, left ? 255 : 77);
    this.setOpacity(this.navRightV.visual, right ? 255 : 77);
    // 到边界就别再接点击：Web 的 disabled 按钮不响应短按
    this.navLeftV.hit.active = left;
    this.navRightV.hit.active = right;
  }

  /** 翻页：当前页高亮、到边界时按钮变淡 */
  setPager(page: number, pages: number): void {
    this.dots.forEach((d, i) => {
      const g = d.getComponent(Graphics);
      if (g) { g.clear(); g.fillColor = i === page ? new Color(255, 217, 119, 255) : new Color(255, 246, 218, 255); g.circle(0, 0, i === page ? 10 : 9); g.fill(); }
    });
    this.setOpacity(this.pagerUpV.visual, page > 0 ? 255 : 77);
    this.setOpacity(this.pagerDownV.visual, page < pages - 1 ? 255 : 77);
    this.pagerUpV.hit.active = page > 0;
    this.pagerDownV.hit.active = page < pages - 1;
  }

  /* ---------------------------------------------------------------- 绘制小工具 */

  private setOpacity(n: Node, v: number): void {
    let op = n.getComponent(UIOpacity);
    if (!op) op = n.addComponent(UIOpacity);
    op.opacity = v;
  }

  /** 贴图节点：资源从 assets/resources 异步加载（与 MapBootstrap.makeSprite 同口径） */
  private makeSprite(parent: Node, name: string, path: string, w: number, h: number, x: number, y: number): Sprite {
    const n = this.mkNode(parent, name, w, h, x, y);
    const sp = n.addComponent(Sprite);
    sp.sizeMode = Sprite.SizeMode.CUSTOM;
    resources.load(path + '/spriteFrame', SpriteFrame, (err, sf) => {
      if (err || !sf) { console.warn('[home] 贴图缺失: ' + path); return; }
      if (sp.isValid) sp.spriteFrame = sf;
    });
    return sp;
  }

  private mkNode(parent: Node, name: string, w: number, h: number, x: number, y: number): Node {
    const n = new Node(name);
    n.parent = parent;
    n.layer = Layers.Enum.UI_2D;
    n.addComponent(UITransform).setContentSize(w, h);
    n.setPosition(x, y);
    return n;
  }

  private label(
    parent: Node, text: string, size: number, color: Color, w: number, h: number,
    x: number, y: number, bold = false, shadow?: { color: Color; dx: number; dy: number },
  ): Label {
    const n = this.mkNode(parent, 'Txt', w, h, x, y);
    const l = n.addComponent(Label);
    l.string = text;
    l.fontSize = size;
    l.lineHeight = size;
    l.color = color;
    if (bold) {
      const b = l as unknown as { isBold?: boolean; enableBold?: boolean };
      if (b.isBold === false || b.isBold === undefined) b.isBold = true;
      if (b.enableBold === false) b.enableBold = true;
    }
    if (shadow) {
      const s = n.addComponent(LabelShadow);
      s.shadowColor = shadow.color;
      s.shadowOffset = new Vec2(shadow.dx, shadow.dy);
    }
    return l;
  }

  private roundRect(g: Graphics, x: number, y: number, w: number, h: number, r: number): void {
    g.moveTo(x + r, y);
    g.lineTo(x + w - r, y);
    g.quadraticCurveTo(x + w, y, x + w, y + r);
    g.lineTo(x + w, y + h - r);
    g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    g.lineTo(x + r, y + h);
    g.quadraticCurveTo(x, y + h, x, y + h - r);
    g.lineTo(x, y + r);
    g.quadraticCurveTo(x, y, x + r, y);
  }

  private fillVGradient(g: Graphics, x: number, y: number, w: number, h: number, r: number, top: Color, bottom: Color, steps: number): void {
    g.fillColor = top;
    this.roundRect(g, x, y, w, h, r);
    g.fill();
    const sh = h / steps;
    for (let i = 0; i < steps; i++) {
      const t = (i + 0.5) / steps;
      const cy = y + h - (i + 0.5) * sh;
      const dTop = y + h - cy;
      const dBot = cy - y;
      const inset = Math.max(
        dTop < r ? r - Math.sqrt(r * r - (r - dTop) ** 2) : 0,
        dBot < r ? r - Math.sqrt(r * r - (r - dBot) ** 2) : 0,
      );
      g.fillColor = new Color(
        Math.round(top.r + (bottom.r - top.r) * t),
        Math.round(top.g + (bottom.g - top.g) * t),
        Math.round(top.b + (bottom.b - top.b) * t),
        255,
      );
      g.rect(x + inset, cy - sh / 2, w - inset * 2, sh + 0.5);
      g.fill();
    }
  }
}

/** UIOpacity 的本地别名（避免多引一个名字进来，语义更清楚） */

