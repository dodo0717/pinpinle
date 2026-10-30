/**
 * 贴纸下载失败的冒烟测试（2026-10-30 真机对局整盘白块）。
 *
 * 场景 A：网络抖动 —— 每张图前 2 次请求失败，自动重试后应全部加载，不弹窗。
 * 场景 B：一直失败 —— 自动重试用完后停表 + 弹「重试 / 回地图」；网络恢复后点重试，棋盘应补齐。
 *
 * 跑法：node --import ./test/cc-resolve.mjs test/sticker-retry.mjs
 */
import assert from 'node:assert/strict';

globalThis.performance = globalThis.performance || { now: () => Date.now() };
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 16);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);

/** 每个 URL 已经失败了几次；failTimes = 每个 URL 前多少次请求失败（Infinity = 一直失败） */
const attempts = new Map();
let failTimes = 0;
globalThis.Image = class {
  constructor() { this.naturalWidth = 512; this.naturalHeight = 512; this.complete = true; }
  set src(v) {
    this._src = v;
    const isSticker = v.includes('stickers/');
    const n = attempts.get(v) ?? 0;
    attempts.set(v, n + 1);
    const fail = isSticker && n < failTimes;
    setTimeout(() => (fail ? this.onerror && this.onerror() : this.onload && this.onload()), 0);
  }
  get src() { return this._src; }
};

const noop = () => {};
const ctxStub = new Proxy(
  { canvas: { width: 1080, height: 1920 }, measureText: () => ({ width: 10 }), getImageData: () => ({ data: new Uint8ClampedArray(4) }), createLinearGradient: () => ({ addColorStop: noop }) },
  { get: (t, k) => (k in t ? t[k] : noop), set: () => true },
);
const canvasStub = {
  width: 1080, height: 1920, style: {}, getContext: () => ctxStub,
  addEventListener: noop, removeEventListener: noop,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 540, height: 960 }), setPointerCapture: noop,
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { Renderer, Node, UITransform, Layers } = await import('../preview/cc-shim.js');
const { GameBootstrap } = await import('../assets/scripts/玩法/GameBootstrap.ts');
const { GameDialog } = await import('../assets/scripts/玩法/GameDialog.ts');
const { GS } = await import('../assets/scripts/玩法/state.ts');

// 记下弹窗内容，方便断言和「点按钮」
const shown = [];
const rawShow = GameDialog.prototype.show;
GameDialog.prototype.show = function (title, lines, buttons, ...rest) {
  shown.push({ title, lines, buttons });
  return rawShow.call(this, title, lines, buttons, ...rest);
};

async function startGame(level) {
  // 上一个场景留下的断点会让新开局先弹「继续上次的挑战？」，测的就不是首次下载了
  if (GS.readResult) { GS.setSession(null); GS.flush(); }
  attempts.clear();
  shown.length = 0;
  const root = new Node('Canvas');
  root.layer = Layers.Enum.UI_2D;
  root.addComponent(UITransform).setContentSize(1080, 1920);
  const game = root.addComponent(GameBootstrap);
  game.levelIndex = level;
  game.autoStart = true;
  const renderer = new Renderer(canvasStub, root);
  renderer.mount();
  return game;
}
const framed = (game) => game.view.cells.filter((c) => c.sp.spriteFrame).length;

/* ---------- 场景 A：前 2 次失败，自动重试成功 ---------- */
failTimes = 2;
let game = await startGame(2);
await sleep(2600);   // 两次重试间隔 0.6 + 1.5 秒
let cells = game.cfg.rows * game.cfg.cols;
assert.equal(framed(game), cells, `自动重试后应 ${cells}/${cells} 格都有贴图，实际 ${framed(game)}`);
assert.ok(!shown.some((s) => s.title.includes('没加载出来')), '自动重试成功时不该弹失败窗');
const tries = Math.max(...Array.from(attempts.entries()).filter(([u]) => u.includes('stickers/')).map(([, n]) => n));
console.log(`✓ 场景 A：网络抖动，每张图最多请求 ${tries} 次后加载成功，${cells}/${cells} 格有贴图，未弹窗`);

/* ---------- 场景 B：一直失败 → 弹窗；恢复网络后点重试 ---------- */
failTimes = Infinity;
// 换一关：场景 A 已经把第 2 关的图下载成功并缓存了；第 16 关与第 2 关没有共用贴纸
game = await startGame(16);
await sleep(2600);
cells = game.cfg.rows * game.cfg.cols;
const fail = shown.find((s) => s.title.includes('没加载出来'));
assert.ok(fail, '重试用完后应弹「图片没加载出来」');
assert.equal(framed(game), 0, '失败时棋盘没有贴图');
assert.equal(game.paused, true, '弹窗期间应停表');
console.log(`✓ 场景 B：持续失败，弹窗「${fail.title}」${fail.lines.join(' / ')}，已停表`);

failTimes = 0;          // 网络恢复
const retry = fail.buttons.find((b) => b.text === '重试');
assert.ok(retry, '弹窗应有「重试」按钮');
retry.onClick();
await sleep(300);
assert.equal(framed(game), cells, `点重试后应 ${cells}/${cells} 格都有贴图，实际 ${framed(game)}`);
console.log(`✓ 场景 B：网络恢复后点「重试」，${cells}/${cells} 格补齐，paused=${game.paused}`);

console.log('\n贴纸重试冒烟通过');
process.exit(0);
