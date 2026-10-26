/**
 * 真机全局补丁（2026-10-26：扫码进入黑屏）—— 必须是 game.js 的第一个 import。
 *
 * 微信开发者工具里有浏览器全局（performance / requestAnimationFrame / globalThis），
 * 真机（尤其 iOS / 低版本基础库）不保证有。缺 performance 时 MapBootstrap.onLoad 第一句就抛错，
 * 渲染循环没启动 → 全黑。cc.js 里也有同一份兜底，这里是更早的一道。
 * 手工维护，不参与 TS 构建。
 */
(function () {
  var g = typeof globalThis !== 'undefined' ? globalThis
    : typeof GameGlobal !== 'undefined' ? GameGlobal
      : typeof window !== 'undefined' ? window : this;
  if (typeof globalThis === 'undefined' && g) { try { g.globalThis = g; } catch (e) { /* 只读就算了 */ } }
  if (!g) return;
  if (!g.performance || typeof g.performance.now !== 'function') {
    var ms0 = Date.now();
    g.performance = { now: function () { return Date.now() - ms0; } };
  }
  if (typeof g.requestAnimationFrame !== 'function') {
    g.requestAnimationFrame = function (cb) { return setTimeout(function () { cb(g.performance.now()); }, 16); };
    g.cancelAnimationFrame = function (id) { clearTimeout(id); };
  }
})();
