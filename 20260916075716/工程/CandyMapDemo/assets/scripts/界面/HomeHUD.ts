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
  tween, Vec3, Vec2, UIOpacity, resources, SpriteFrame,
} from 'cc';
const { ccclass } = _decorator;

import { HOME, TABBAR, TUTORIAL } from '../玩法/text';
// ⚠️ 这里原本从 uiPaint 引 `paintShadow / paintGlow`，已移除：
//    那两个是「多层同心形状叠加」的模糊近似，每层都是硬边 → 叠出一圈圈同心台阶（毛边）。
//    阴影/辉光现在一律用 `assets/resources/ui/fx/` 下预烘好的模糊贴图（canvas `shadowBlur`），
//    与 Web 的 `box-shadow` 同口径（blur 定义都是 2σ），边缘天然平滑。

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

const ARROW_TOP = new Color(255, 228, 155, 255);   // #ffe49b
const ARROW_MID = new Color(247, 177, 63, 255);    // #f7b13f
const ARROW_BOTTOM = new Color(217, 123, 18, 255); // #d97b12

@ccclass('HomeHUD')
export class HomeHUD extends Component {
  /** 教学按钮（体力胶囊正下方） */
  btnTutorial: Node = null!;
  private plusNode: Node = null!;
  /** 体力胶囊本体（Web `.home-stamina` 整块可点，不只是那个 ＋） */
  private staminaNode: Node = null!;
  /** 底栏 4 个页签节点（顺序与 Web 一致：首页 / 排行榜 / 图鉴 / 设置） */
  tabs: Node[] = [];
  private nickLabel: Label = null!;
  private staminaLabel: Label = null!;
  private recoverLabel: Label = null!;
  private tabIcons: Sprite[] = [];
  private tabLabels: Label[] = [];
  private tabPills: Node[] = [];
  /** 页签图标：选中（原色）/ 未选中（灰度）两套切图路径 */
  private tabArtOn: string[] = [];
  private tabArtOff: string[] = [];
  /** 每个页签换图的代次（防异步回调乱序覆盖） */
  private tabArtToken: number[] = [];
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
    // 头像：84×84 圆徽章 = 奶白底 #FFF8E7 + 4px 金边 #F5C542 + 0 3px 0 rgba(0,0,0,.18)
    // （Web `.home-avatar`，ui.css:938-943 —— 只写一个 🐶 emoji 会少掉整块圆牌）
    const av = this.mkNode(user, 'AvatarBadge', AVATAR.w, AVATAR.h, AVATAR.x, AVATAR.y);
    const ag = av.addComponent(Graphics);
    const ar = AVATAR.w / 2;
    ag.fillColor = new Color(0, 0, 0, 46);              // 0 3px 0 rgba(0,0,0,.18)
    ag.circle(0, -3, ar);
    ag.fill();
    ag.fillColor = new Color(255, 248, 231, 255);       // #FFF8E7
    ag.circle(0, 0, ar);
    ag.fill();
    ag.lineWidth = 4;
    ag.strokeColor = new Color(245, 197, 66, 255);      // #F5C542
    ag.circle(0, 0, ar - 2);
    ag.stroke();
    this.label(user, '🐶', 56, new Color(255, 255, 255, 255), AVATAR.w, AVATAR.h, AVATAR.x, AVATAR.y);
    // 昵称：棕胶囊底 #6B4A2F + radius 100 + padding 8/22 + 0 3px 0 rgba(0,0,0,.18)
    // （Web `.home-nick`，ui.css:944-949；实测框 124×68 = 文字 80 + padding 44）
    const nb = this.mkNode(user, 'NickBg', NICK.w, NICK.h, NICK.x, NICK.y);
    const ng = nb.addComponent(Graphics);
    ng.fillColor = new Color(0, 0, 0, 46);
    this.roundRect(ng, -NICK.w / 2, -NICK.h / 2 - 3, NICK.w, NICK.h, NICK.h / 2);
    ng.fill();
    ng.fillColor = new Color(107, 74, 47, 255);         // #6B4A2F
    this.roundRect(ng, -NICK.w / 2, -NICK.h / 2, NICK.w, NICK.h, NICK.h / 2);
    ng.fill();
    this.nickLabel = this.label(user, HOME.nickname, 40, new Color(255, 233, 199, 255), NICK.w, NICK.h, NICK.x, NICK.y, true,
      { color: new Color(40, 20, 5, 89), dx: 0, dy: -3 });

    // 体力胶囊 + 红心 + 数字 + ＋
    // Web 的 `.home-stamina` 是**一整个 button**（300×108）包住红心 / 数字 / ＋（`web/ui/map.ts:402-413`），
    // 子元素全是 span 不单独响应 —— 点胶囊任意位置都触发加体力。只有 ＋ 可点是热区缩水。
    const stamina = this.mkNode(root, 'TopStamina', STAMINA.w, STAMINA.h, STAMINA.x, STAMINA.y);
    this.staminaNode = stamina;
    this.makeSprite(stamina, 'Img', 'ui/home/pill', STAMINA.w, STAMINA.h, 0, 0);
    this.makeSprite(stamina, 'Heart', 'ui/home/heart', HEART.w, HEART.h, HEART.x, HEART.y);
    this.staminaLabel = this.label(stamina, '0', 32, new Color(255, 255, 255, 255), HEARTS.w, HEARTS.h, HEARTS.x, HEARTS.y, true);
    this.plusNode = this.makeSprite(stamina, 'Plus', 'ui/home/plus', PLUS.w, PLUS.h, PLUS.x, PLUS.y).node;
    // 恢复倒计时（Web：满体力时空串 —— 不显示任何东西）
    // ⚠️ 生效的是后写那条规则（ui.css:1238）：白色 #fff + text-shadow 0 2px 4px rgba(40,20,5,.6)，
    //    不是早先那条 #FFE9C7（ui.css:960）——后者被同源选择器覆盖了。
    this.recoverLabel = this.label(root, '', 22, new Color(255, 255, 255, 255), RECOVER.w, RECOVER.h, RECOVER.x, RECOVER.y, false,
      { color: new Color(40, 20, 5, 153), dx: 0, dy: -2 });

    // 教学按钮：预烘焙切图 `fx/home-tutorial`（渐变 #ffe9a8→#f0b445 + 双阴影已在图里；
    // 原来的 Graphics 版渐变拆条带 + 阴影是放大实心矩形 → 正是"毛边/材质不对"的来源）。
    // 贴图 400×134（temp/_panel6.html:65-83）：本体 84 画在 canvas 16..100，四周是
    // `0 6px 0` 硬影 + `0 10px 22px` 柔影的留白 → 本体中心比贴图中心高 67−58=9px，
    // 节点整体下移 9、内部图标/文字上移 9，本体中心才落在 Web 实测的 196（=TUT.y）。
    const TUT_BODY_DY = 9;
    this.btnTutorial = this.mkNode(root, 'BtnTutorial', TUT.w, 134, TUT.x, TUT.y - TUT_BODY_DY);
    const tsp = this.makeSprite(this.btnTutorial, 'Img', 'ui/fx/home-tutorial', TUT.w, 134, 0, 0);
    tsp.type = Sprite.Type.SLICED;   // 九宫格 [58,58,58,76]：横向拉伸圆角不变形
    // Web 拆两段（padding 0 30px + gap 10）：❓ 46px + 文字 44px letter-spacing 2px
    const iconX = -TUT.w / 2 + 30 + 23;
    const textX = iconX + 23 + 10 + (TUT.w - 60 - 46 - 10) / 2;
    this.label(this.btnTutorial, '❓', 46, new Color(107, 58, 0, 255), 46, 46, iconX, TUT_BODY_DY);
    const tutText = this.label(this.btnTutorial, TUTORIAL.entry, 44, new Color(107, 58, 0, 255),
      TUT.w - 60 - 46 - 10, TUT.h, textX, TUT_BODY_DY, true);
    tutText.spacingX = 2;   // Web `.home-tutorial-text { letter-spacing: 2px }`
  }

  /* ---------------------------------------------------------------- 换世界箭头 / 翻页 */

  private buildNav(root: Node): void {
    // navLeft/navRight/pagerUp/pagerDown = **点击盒**；navLeftV 等 = 可见的圆（用于调透明度）
    this.navLeftV = this.goldCircle(root, 'NavLeft', '‹', NAV_L.x, NAV_L.y, NAV_SIZE);
    this.navRightV = this.goldCircle(root, 'NavRight', '›', NAV_R.x, NAV_R.y, NAV_SIZE);
    // 翻页箭头的字形是 46px（`ui.css:1304-1312`），比换世界箭头的 78px 小 —— 别混用
    this.pagerUpV = this.goldCircle(root, 'PagerUp', '▲', PAGER_X, PAGER_UP_Y, PAGER_SIZE, 46, 22);
    this.pagerDownV = this.goldCircle(root, 'PagerDown', '▼', PAGER_X, PAGER_DOWN_Y, PAGER_SIZE, 46, 22);
    this.navLeft = this.navLeftV.hit;
    this.navRight = this.navRightV.hit;
    this.pagerUp = this.pagerUpV.hit;
    this.pagerDown = this.pagerDownV.hit;
    // 页点：两页（每个世界固定 2 屏，与 Web 的 PAGE 数一致）
    for (let i = 0; i < 2; i++) {
      const d = this.mkNode(root, `PagerDot${i}`, 18, 18, PAGER_X, (i === 0 ? DOT_GAP / 2 : -DOT_GAP / 2));
      this.paintDot(d, i === 0);
      this.dots.push(d);
    }
  }

  /**
   * 页点（Web `.map-pager-dot`，ui.css:922-926）：**两点都是 18×18，选中不变大**，只换底色。
   *   未选中 rgba(255,255,255,.78) + 0 2px 0 rgba(198,140,50,.3)
   *   选中    var(--honey) #e0a94a  + 0 2px 0 rgba(180,120,40,.45)
   * ⚠️ 之前这里把选中的半径加到 10、还用了页签金 #ffd977，是 Cocos 端自创的。
   */
  private paintDot(d: Node, on: boolean): void {
    const g = d.getComponent(Graphics) ?? d.addComponent(Graphics);
    g.clear();
    const r = 9;
    g.fillColor = on ? new Color(180, 120, 40, 115) : new Color(198, 140, 50, 77);
    g.circle(0, -2, r);
    g.fill();
    g.fillColor = on ? new Color(224, 169, 74, 255) : new Color(255, 255, 255, 199);
    g.circle(0, 0, r);
    g.fill();
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
  private goldCircle(root: Node, name: string, glyph: string, x: number, y: number, size: number,
      glyphSize = 78, glowBlur = 26): { visual: Node; hit: Node } {
    // 外发光 halo（ui.css:1262 的 `0 0 26px rgba(255,206,110,.8)`）—— 垫在最底
    // ⚠️ 同底栏：辉光用预烘焙贴图（`shadowBlur` 原生高斯），不做多层同心圆叠加（会出台阶/毛边）。
    //    贴图是白色的，颜色与强度由 `sprite.color` 调制。
    const glowRes = glowBlur === 22 ? 'ui/fx/glow-pager' : 'ui/fx/glow-nav';
    const glowSize = (size / 2 + glowBlur) * 2;
    this.mkFx(root, `${name}Glow`, glowRes, glowSize, glowSize, x, y).color = new Color(255, 206, 110, 204);
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
    // 字形：text-shadow 0 3px 0 rgba(120,60,0,.45)（ui.css:1259）
    this.label(n, glyph, glyphSize, new Color(255, 255, 255, 255), size, size, 0, 0, true,
      { color: new Color(120, 60, 0, 115), dx: 0, dy: -3 });
    // ⚠️ 这里原本有个 `scale 1→1.06→1` 的循环呼吸，已删：
    //    Web 的 `@keyframes nav-breathe` 只改 drop-shadow 辉光，**不动 transform**。
    //    动 scale 会让圆钮连同它的圆形命中盒一起缩放，边界珠的点击时灵时不灵。
    return { visual: n, hit };
  }

  /* ---------------------------------------------------------------- 底栏 */

  private buildTabbar(root: Node): void {
    // 外投影 `box-shadow: 0 18px 40px rgba(20,10,0,.5)`（ui.css:1284）
    // ⚠️ 用**预烘焙的模糊贴图**（canvas `shadowBlur`），不要再用程序画：
    //    ① 单层实心矩形 → 在棕底板四周糊出一圈硬边深色块（"材质质感不对"）；
    //    ② 多层同心矩形叠加 → 每一层都是硬边，叠出一圈圈同心台阶（"毛边很多"）。
    //    canvas 的 `shadowBlur` 与 CSS `box-shadow` 的 blur **定义相同**（都等于 2σ），
    //    所以这张贴图就是浏览器原生的高斯模糊，边缘天然平滑。
    // 贴图 1112x267（= 栏 1032x169 + 四周 40 + 下方留出 18 的位移），中心比栏中心低 9（= dy/2）
    this.mkFx(root, 'TabbarShadow', 'ui/fx/tabbar-shadow', 1112, 267, TABBAR_POS.x, TABBAR_POS.y - 9);
    // 底板本体（木纹渐变 #6b4426→#4a2d18 + 圆角 44 + 5px 描边 #3a2312）→ 预烘焙切图。
    // ⚠️ 原来用 Graphics 硬画：圆角被**三角化成多边形**（硬边，Web 的 border-radius 是浏览器
    //    渲染、带 AA），渐变被拆成 16 条纯色条带（阶梯）—— 这就是「底板材质不一样 + 毛边」的根源。
    //    canvas 与 CSS 走同一套渲染管线，烘出来的像素与 Web 同口径，圆角自带抗锯齿。
    this.mkFx(root, 'TabbarBody', 'ui/home/tabbar-body', TABBAR_POS.w, TABBAR_POS.h, TABBAR_POS.x, TABBAR_POS.y);
    const bar = this.mkNode(root, 'Tabbar', TABBAR_POS.w, TABBAR_POS.h, TABBAR_POS.x, TABBAR_POS.y);

    // 页签顺序与 Web 一致：首页 / 排行榜 / 图鉴 / 设置
    // `icon` = 原色切图（选中态），`dim` = 同一张图按 Web 的滤镜预算好的灰度版（未选中态）
    const order = [
      { label: TABBAR.home, icon: 'ui/home/tab-home', dim: 'ui/home/tab-home-gray' },
      { label: TABBAR.leaderboard, icon: 'ui/home/tab-rank', dim: 'ui/home/tab-rank-gray' },
      { label: TABBAR.collection, icon: 'ui/home/tab-book', dim: 'ui/home/tab-book-gray' },
      { label: TABBAR.settings, icon: 'ui/home/tab-gear', dim: 'ui/home/tab-gear-gray' },
    ];
    this.tabs = [];
    this.tabIcons = [];
    this.tabLabels = [];
    this.tabPills = [];
    this.tabArtOn = [];
    this.tabArtOff = [];
    order.forEach((t, i) => {
      const tab = this.mkNode(bar, `Tab${i}`, TAB.w, TAB.h, -TAB.dx * 1.5 + i * TAB.dx, TAB.y);
      // 选中态金胶囊（默认隐藏）
      // 选中态金胶囊 → 预烘焙切图（与底板同一口径）。
      //    贴图 235x137：多出的 6px 高是 Web `box-shadow: 0 6px 0 rgba(160,90,10,.55)` 的硬边下影，
      //    所以胶囊本体仍在原位 → 贴图中心要下移 3（`offY = dy/2`，同外投影那套换算）。
      const pill = this.mkFx(tab, 'Sel', 'ui/home/tab-pill', 235, 137, 0, -3).node;
      pill.active = false;
      // ⚠️ 图标 Sprite **自己建、不预铺贴图**：贴图一律由 `setTabArt()` 异步换。
      //    若这里让 `makeSprite()` 顺手 load 一张，它和 `setTabArt()` 就是两条独立的异步回调，
      //    谁后到谁生效 —— 实测会出现「选中的页签图标却是灰的」（灰度图把原色图顶掉了）。
      const iconNode = new Node('Icon');
      iconNode.parent = tab;
      iconNode.layer = Layers.Enum.UI_2D;
      iconNode.addComponent(UITransform).setContentSize(TAB_ICON.w, TAB_ICON.h);
      iconNode.setPosition(0, TAB_ICON.dy, 0);
      const sp = iconNode.addComponent(Sprite);
      sp.sizeMode = Sprite.SizeMode.CUSTOM;
      sp.color = new Color(255, 255, 255, 255);
      const lb = this.label(tab, t.label, 26, new Color(232, 217, 195, 255), TAB.w, 36, 0, TAB_LABEL.dy, true);
      this.tabs.push(tab);
      this.tabIcons.push(sp);
      this.tabLabels.push(lb);
      this.tabPills.push(pill);
      this.tabArtOn.push(t.icon);
      this.tabArtOff.push(t.dim);
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
    // ⚠️ 事件挂在**整个胶囊**上（`staminaNode`），不是 `plusNode`：Web 那里红心 / 数字 / ＋
    //    都只是胶囊内部的 span，点哪都冒泡到 button 触发 `onAddStamina()`。
    this.staminaNode.on(Node.EventType.TOUCH_END, () => cbs.onPlus(), this);
    this.navLeft.on(Node.EventType.TOUCH_END, () => cbs.onNav(-1), this);
    this.navRight.on(Node.EventType.TOUCH_END, () => cbs.onNav(1), this);
    this.pagerUp.on(Node.EventType.TOUCH_END, () => cbs.onPage(-1), this);
    this.pagerDown.on(Node.EventType.TOUCH_END, () => cbs.onPage(1), this);
    this.tabs.forEach((t, i) => {
      t.on(Node.EventType.TOUCH_END, () => cbs.onTab(i), this);
      // :active 反馈：Web 是 `transform: scale(.94)`（ui.css:1018）——别写成别的数
      t.on(Node.EventType.TOUCH_START, () => tween(t).to(0.08, { scale: new Vec3(0.94, 0.94, 1) }).start(), this);
      t.on(Node.EventType.TOUCH_CANCEL, () => tween(t).to(0.1, { scale: new Vec3(1, 1, 1) }).start(), this);
    });
    void cbs.onBack;
  }

  setNickname(name: string): void { this.nickLabel.string = name; }
  setStamina(text: string): void { this.staminaLabel.string = text; }
  /** 满体力时传空串（Web：`.home-recover` 只在有倒计时时才有文本） */
  setCountdown(text: string): void { this.recoverLabel.string = text; }
  setTutorialVisible(v: boolean): void { this.btnTutorial.active = v; }

  /**
   * 切换页签图标：选中用原色切图，未选中用灰度切图。
   *
   * ⚠️ Web 的未选中态是 CSS `filter: grayscale(.55) brightness(.82)` 实时滤镜作用在**彩色切图**上；
   *    Cocos 的 `Sprite` 只有**乘算调制**（`color` 是逐通道相乘），做不到「去饱和 + 压暗」的
   *    分离运算——乘一个灰色只会整体变暗，饱和度几乎不掉。所以这里改为**预先按同一公式把
   *    切图算成灰度版**（`tools/` 下脚本产出 `*-gray.png`），未选中时直接换图，
   *    视觉结果 = Web 的 filter 结果。
   */
  private setTabArt(i: number, on: boolean): void {
    const sp = this.tabIcons[i]!;
    sp.color = new Color(255, 255, 255, 255);   // 不再靠乘算假装灰度
    const path = on ? this.tabArtOn[i]! : this.tabArtOff[i]!;
    // 代次标记：只认**最后一次**发起的换图请求。
    // 连续切页签时，先发起的旧请求可能后到，没有这层判断就会把新图标覆盖回旧图标。
    const token = (this.tabArtToken[i] ?? 0) + 1;
    this.tabArtToken[i] = token;
    resources.load(`${path}/spriteFrame`, SpriteFrame, (err, sf) => {
      if (err || !sf || !sp.node?.isValid) return;
      if (this.tabArtToken[i] !== token) return;
      sp.spriteFrame = sf;
    });
  }

  setTab(index: number): void {
    this.tabs.forEach((t, i) => {
      const on = i === index;
      this.tabPills[i]!.active = on;
      this.setTabArt(i, on);
      const lab = this.tabLabels[i]!;
      lab.color = on ? new Color(109, 61, 10, 255) : new Color(232, 217, 195, 255);
      // Web `.tabbar .tab.on .tab-label { text-shadow: 0 1px 0 rgba(255,255,255,.4) }`（ui.css:1301）
      lab.enableShadow = on;
      if (on) { lab.shadowColor = new Color(255, 255, 255, 102); lab.shadowOffset = new Vec2(0, -1); }
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
    this.dots.forEach((d, i) => this.paintDot(d, i === page));
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
  /**
   * 铺一张**效果贴图**（外投影 / 辉光）。
   *
   * ⚠️ 必须是**兄弟节点、且排在被装饰元素之前**：Cocos 里子节点永远渲染在父节点之上，
   *    把阴影做成元素的子节点，它反而会盖住元素自己（阴影比元素大一圈，等于糊在脸上）。
   */
  private mkFx(parent: Node, name: string, res: string, w: number, h: number, x: number, y: number): Sprite {
    const n = new Node(name);
    n.layer = Layers.Enum.UI_2D;
    n.addComponent(UITransform).setContentSize(w, h);
    n.setPosition(x, y, 0);
    n.parent = parent;
    const sp = n.addComponent(Sprite);
    sp.sizeMode = Sprite.SizeMode.CUSTOM;
    resources.load(`${res}/spriteFrame`, SpriteFrame, (err, sf) => {
      if (err || !sf || !n.isValid) return;
      sp.spriteFrame = sf;
    });
    return sp;
  }

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
      // ⚠️ 3.8.2 起走 Label 自带的阴影属性（`LabelShadow` 的 color/offset 已废弃）
      l.enableShadow = true;
      l.shadowColor = shadow.color;
      l.shadowOffset = new Vec2(shadow.dx, shadow.dy);
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

