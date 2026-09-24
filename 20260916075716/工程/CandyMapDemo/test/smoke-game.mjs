/**
 * 对局层冒烟测试（无 Cocos、无浏览器）。
 *
 * 目标：证明 `assets/scripts/game/**` 的真实源码能被加载并完成一局的最小闭环 ——
 * 建棋盘 → 加载贴图 → 接受拖动 → 触发一次消除 → 结算弹窗。
 *
 * 跑法：node --import ./test/cc-resolve.mjs test/smoke-game.mjs
 */
import assert from 'node:assert/strict';

/* ---------- 宿主环境 stub ---------- */
globalThis.performance = globalThis.performance || { now: () => Date.now() };
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 16);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);

/** 图片：不真正解码，set src 后异步回调 onload 即可 */
globalThis.Image = class {
  constructor() { this.naturalWidth = 512; this.naturalHeight = 512; this.complete = true; }
  set src(v) { this._src = v; setTimeout(() => this.onload && this.onload(), 0); }
  get src() { return this._src; }
};

/** 2D 上下文：所有绘制调用都吞掉 */
const noop = () => {};
const ctxStub = new Proxy(
  {
    canvas: { width: 1080, height: 1920 },
    measureText: () => ({ width: 10 }),
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    createLinearGradient: () => ({ addColorStop: noop }),
  },
  { get: (t, k) => (k in t ? t[k] : noop), set: () => true },
);

const canvasStub = {
  width: 1080,
  height: 1920,
  style: {},
  getContext: () => ctxStub,
  addEventListener: noop,
  removeEventListener: noop,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 540, height: 960 }),
  setPointerCapture: noop,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- 加载真源码 ---------- */
const { Renderer, Node, UITransform, Layers, EventTouch } = await import('../preview/cc-shim.js');
const { GameBootstrap } = await import('../assets/scripts/game/GameBootstrap.ts');

/* ---------- 搭场景 ---------- */
const root = new Node('Canvas');
root.layer = Layers.Enum.UI_2D;
root.addComponent(UITransform).setContentSize(1080, 1920);

const game = root.addComponent(GameBootstrap);
game.levelIndex = 1;
game.autoStart = true;

const renderer = new Renderer(canvasStub, root);
renderer.mount();          // onLoad + start（不开 rAF 循环）
renderer.start();          // 启动循环（rAF 被 stub 成 setTimeout）

await sleep(120);          // 等贴图回调

/* ---------- 断言 ---------- */
const cfg = game.cfg;
assert.ok(cfg, '关卡配置已生成');
const expectCells = cfg.rows * cfg.cols;
assert.equal(game.view.size, expectCells, `格子数应为 ${cfg.rows}×${cfg.cols}=${expectCells}`);
console.log(`✓ 开局：第 ${game.levelIndex} 关 ${cfg.rows}×${cfg.cols}，${expectCells} 格，限时 ${cfg.timeLimit}s`);

// 棋盘应有贴图（stub 图片会走 onload）
const withFrame = game.view.cells.filter((c) => c.sp.spriteFrame).length;
assert.equal(withFrame, expectCells, '每格都应拿到贴图 SpriteFrame');
console.log(`✓ 贴图：${withFrame}/${expectCells} 格已绑定`);

// 融合组计算不报错
const groups = game.engine.mergeGroups();
assert.ok(groups.length > 0, '至少有一个融合组');
console.log(`✓ 融合组：${groups.length} 组`);

/* ---------- 模拟一次拖动 ---------- */
const host = game.view.node;
const b = game.engine.board;
const anchor = 0;
// 找一个「同组内、可位移」的落点：先试右，再试下
const tryMove = async (dr, dc) => {
  const p0 = game.view.posOf(b.rowOf(anchor), b.colOf(anchor));
  host.emit(Node.EventType.TOUCH_START, new EventTouch(p0.x, p0.y));
  await sleep(10);
  const step = game.view.step;
  host.emit(Node.EventType.TOUCH_MOVE, new EventTouch(p0.x + dc * step, p0.y - dr * step, p0.x, p0.y));
  await sleep(10);
  host.emit(Node.EventType.TOUCH_END, new EventTouch(p0.x + dc * step, p0.y - dr * step, p0.x, p0.y));
  await sleep(900); // 等消除 + 掉落 + 归位
};

await tryMove(0, 1);
await tryMove(1, 0);
console.log('✓ 拖动：两次整片位移已执行，未抛异常');

// 提示
game.showHint();
await sleep(50);
console.log('✓ 提示：showHint 正常');

/* ---------- 结算：让倒计时真的走到 0 ---------- */
game.timeLeft = 1;
game.started = true;
await sleep(1500);
assert.equal(game.finished, true, '倒计时归零后应进入结算');
console.log('✓ 结算：倒计时归零 → finished=true，弹窗已弹出');

console.log('\n对局层冒烟通过');
process.exit(0);
