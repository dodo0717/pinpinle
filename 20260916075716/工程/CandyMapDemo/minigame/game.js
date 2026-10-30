/**
 * 纯代码微信小游戏入口（无 Cocos 引擎 / 编辑器）。
 *
 * 与 `preview/map.html` 同构：Canvas 根节点 → Bootstrap 子节点挂 MapBootstrap →
 * Renderer 驱动渲染 / 生命周期 / 触摸。区别只在画布来源：
 *   - 微信小游戏：wx.createCanvas() 的主画布（默认逻辑像素尺寸，下面按 pixelRatio 重设为物理像素；
 *     FIXED_WIDTH 可视高度见运行时）
 *   - 浏览器验证：browser.html 里的 #cv（按窗口尺寸铺满，验证长屏几何）
 *
 * 本文件由 tools/build-minigame.ts 之外手工维护（不参与 TS 剥离），纯 JS。
 */
import './polyfill.js';   // 必须第一个：真机缺 performance / rAF / globalThis（2026-10-26 黑屏）
import './src/runtime/asset-ext.js';
import { Renderer, Node, UITransform, Layers, registerFont } from './src/runtime/cc.js';
import { MapBootstrap } from './src/scripts/scenes/MapBootstrap.js';

const WX = typeof wx !== 'undefined';

// 对局三主题的自带字体（子集化，见 tools/subset-fonts.py）。别名与 玩法/theme.ts 的
// FONT_CANDY / FONT_HAND 对应；加载失败自动落到系统字体，不挡启动
registerFont('PPCandy', WX ? 'fonts/pp-candy.ttf' : './fonts/pp-candy.ttf');
registerFont('PPHand', WX ? 'fonts/pp-hand.ttf' : './fonts/pp-hand.ttf');
let canvas;
if (WX) {
  canvas = wx.createCanvas();   // 首个 createCanvas 即全屏主画布
  // 2026-10-30 真机模糊：主画布默认是「逻辑像素」尺寸（如 393×852），屏幕再按 pixelRatio（2~3）
  // 拉伸显示，地图 / 图标 / 文字全部发虚。按物理像素重设画布尺寸，渲染器按 canvas.width / 1080 缩放，
  // 布局和触摸（按逻辑窗口换算）都不受影响。pixelRatio 封顶 3，防个别安卓机报 3.5+ 时画布过大掉帧
  try {
    const info = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const dpr = Math.min(3, (info && info.pixelRatio) || 1);
    if (info && info.windowWidth > 0 && info.windowHeight > 0) {
      canvas.width = Math.round(info.windowWidth * dpr);
      canvas.height = Math.round(info.windowHeight * dpr);
    }
  } catch (e) { /* 拿不到窗口信息就保持默认尺寸 */ }
} else {
  canvas = document.getElementById('cv');
  // 浏览器验证：画布按布局矩形铺满（不信任 innerHeight —— 无头窗口里有工具条偏移，
  // 按它算画布会矮一截，底部内容全被裁掉）。长屏会得到 >1920 的可视高度，
  // 和真机的 FIXED_WIDTH 行为一致 —— map.html 那种固定 1080×1920 验不了这条
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
}

// 场景根 = Canvas；MapBootstrap 挂在子节点上（与 Map.scene / preview/map.html 一致）
const root = new Node('Canvas');
root.layer = Layers.Enum.UI_2D;
root.addComponent(UITransform).setContentSize(1080, 1920);
const boot = new Node('Bootstrap');
boot.parent = root;
boot.addComponent(UITransform).setContentSize(1080, 1920);
const map = boot.addComponent(MapBootstrap);

const renderer = new Renderer(canvas, root);
renderer.start();

// 调试句柄：浏览器测量页 / 控制台排查用（微信里也不碍事，几字节的引用）
globalThis.__map = map;
globalThis.__renderer = renderer;
