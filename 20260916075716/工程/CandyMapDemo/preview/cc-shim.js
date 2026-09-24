/* ============================================================
 * cc 引擎 API 的浏览器 shim（只覆盖本项目用到的那部分）
 *
 * 目的：让 `assets/scripts/**` 的真实 Cocos 源码可以原样跑在浏览器里预览，
 * 从而「预览到的 == Cocos 里跑的」。渲染走 Canvas 2D。
 * ========================================================== */

/* ---------- 基础值类型 ---------- */
export class Color {
  constructor(r = 0, g = 0, b = 0, a = 255) { this.r = r; this.g = g; this.b = b; this.a = a === undefined ? 255 : a; }
  toString() { return `rgba(${this.r},${this.g},${this.b},${(this.a / 255).toFixed(3)})`; }
}
export class Vec2 { constructor(x = 0, y = 0) { this.x = x; this.y = y; } }
export class Vec3 { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } }
export class Size { constructor(w = 0, h = 0) { this.width = w; this.height = h; } }
export class Rect { constructor(x = 0, y = 0, w = 0, h = 0) { this.x = x; this.y = y; this.width = w; this.height = h; } }

export const Layers = { Enum: { UI_2D: 1 << 25 } };
export const ResolutionPolicy = { FIXED_WIDTH: 1, FIXED_HEIGHT: 2 };
export const HorizontalTextAlignment = { LEFT: 0, CENTER: 1, RIGHT: 2 };
export const VerticalTextAlignment = { TOP: 0, CENTER: 1, BOTTOM: 2 };

/* ---------- 视图 / 导演 ---------- */
export const DESIGN_W = 1080;
export const DESIGN_H = 1920;

export const view = {
  _w: DESIGN_W,
  _h: DESIGN_H,
  _policy: ResolutionPolicy.FIXED_WIDTH,
  setDesignResolutionSize(w, h, policy) { this._w = w; this._h = h; if (policy !== undefined) this._policy = policy; },
  getVisibleSize() { return new Size(this._w, this._h); },
  getDesignResolutionSize() { return new Size(this._w, this._h); },
};

/** 渲染器在启动时把 canvas / ctx 注册进来 */
export const director = {
  _canvas: null,
  _ctx: null,
  _scale: 1,
  _ox: 0,
  _oy: 0,
  scene: null,
};

/* ---------- 资源 ---------- */
const imgCache = new Map();

/** 加载一张图片并缓存（Promise） */
export function loadImage(url) {
  if (imgCache.has(url)) return imgCache.get(url);
  const p = new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片加载失败 ' + url));
    img.src = url;
  });
  imgCache.set(url, p);
  return p;
}

export class Texture2D {
  constructor(img) {
    this.img = img;
    this.width = img.naturalWidth || img.width;
    this.height = img.naturalHeight || img.height;
  }
}

export class SpriteFrame {
  constructor() { this.texture = null; this.rect = null; this.packable = false; }
}

/**
 * 布局 / 配置类资源（HomeHUD 用它读 layout/home_hud.json）。
 * 真引擎里是 `cc.JsonAsset`，预览里只要把 JSON 原样带出来即可。
 */
export class JsonAsset {
  constructor(json) { this.json = json; }
}

/** 资源表：把 Cocos 的 `resources.load('ui/xxx/texture')` 映射成本站图片路径 */
const RES_BASE = '/assets/resources/';
/** 素材库里 png / jpg 混放（stickers 有一半是 jpg），逐个后缀试过去 */
const IMG_EXT = ['.png', '.jpg', '.jpeg', '.webp'];

function loadImageAny(base) {
  let chain = Promise.reject(new Error('init'));
  for (const ext of IMG_EXT) chain = chain.catch(() => loadImage(base + ext));
  return chain;
}

export const resources = {
  load(path, type, cb) {
    // 预览环境没有音频素材（也不该在预览里放声音）：直接回错误。
    // 不回的话会去请求 `audio/xxx.png`，刷一屏 404，还会把真正的缺图警告淹掉。
    // 这里用 `type.name` 而不是 `type === AudioClip`，因为 AudioClip 定义在文件末尾，
    // class 不提升，直接引用会踩 TDZ。
    const name = type && type.name;
    if (name === 'AudioClip') {
      cb && cb(new Error('preview: audio not supported'), null);
      return;
    }
    const base = RES_BASE + String(path).replace(/\/(texture|spriteFrame)$/, '');

    if (name === 'JsonAsset') {
      fetch(base + '.json')
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error('404 ' + base + '.json'))))
        .then((j) => cb && cb(null, new JsonAsset(j)), (e) => cb && cb(e, null));
      return;
    }

    loadImageAny(base).then(
      (img) => {
        const tex = new Texture2D(img);
        // 源码侧两种用法：BoardView 直接要 Texture2D；地图 / HUD 要 SpriteFrame 挂到 Sprite 上
        if (name === 'Texture2D') { cb && cb(null, tex); return; }
        const sf = new SpriteFrame();
        sf.texture = tex;
        cb && cb(null, sf);
      },
      (err) => cb && cb(err, null),
    );
  },
  loadDir() { /* 预览用不到 */ },
};

export function resourceUrl(path) {
  return RES_BASE + String(path).replace(/\/texture$/, '') + '.png';
}

/* ---------- 装饰器（shim 里只做「不干预」，源码侧的装饰器已被服务端剥掉） ---------- */
export const _decorator = {
  ccclass(name) { return (C) => { if (name) C.ccName = name; return C; }; },
  property() { return () => {}; },
  type() { return () => {}; },
  tooltip() { return () => {}; },
};

/* ---------- 组件 ---------- */
export class Component {
  constructor() {
    this.node = null;
    this.enabled = true;
    this._timers = new Map();
  }
  /** 周期回调由宿主在合适时机调用（onLoad / start / update） */
  schedule(cb, interval = 0) {
    this.unschedule(cb);
    const id = setInterval(() => cb && cb.call(this), Math.max(1, interval) * 1000);
    this._timers.set(cb, { id, once: false });
  }
  scheduleOnce(cb, delay = 0) {
    this.unschedule(cb);
    const id = setTimeout(() => { this._timers.delete(cb); cb && cb.call(this); }, Math.max(0, delay) * 1000);
    this._timers.set(cb, { id, once: true });
  }
  unschedule(cb) {
    const t = this._timers.get(cb);
    if (!t) return;
    if (t.once) clearTimeout(t.id); else clearInterval(t.id);
    this._timers.delete(cb);
  }
  unscheduleAllCallbacks() {
    for (const [, t] of this._timers) { if (t.once) clearTimeout(t.id); else clearInterval(t.id); }
    this._timers.clear();
  }
}

export class UITransform extends Component {
  constructor() { super(); this.width = 0; this.height = 0; this.anchorX = 0.5; this.anchorY = 0.5; }
  setContentSize(w, h) { this.width = w; if (h !== undefined) this.height = h; return this; }
  getContentSize() { return new Size(this.width, this.height); }
  /** 世界坐标 → 本节点本地坐标（忽略旋转/缩放，本项目够用） */
  convertToNodeSpaceAR(v) {
    const wp = this.node ? this.node.worldPos() : { x: 0, y: 0 };
    return new Vec3(v.x - wp.x, v.y - wp.y, 0);
  }
  convertToWorldSpaceAR(v) {
    const wp = this.node ? this.node.worldPos() : { x: 0, y: 0 };
    return new Vec3(v.x + wp.x, v.y + wp.y, 0);
  }
}

export class UIOpacity extends Component {
  constructor() { super(); this.opacity = 255; }
}

export class Sprite extends Component {
  constructor() {
    super();
    this.spriteFrame = null;
    this.color = new Color(255, 255, 255);
    this.sizeMode = 1; // CUSTOM
    this.type = 0;
  }
  static SizeMode = { CUSTOM: 1, RAW: 0, TRIMMED: 2 };
}

export class Label extends Component {
  constructor() {
    super();
    this.string = '';
    this.fontSize = 24;
    this.lineHeight = 0;
    this.color = new Color(255, 255, 255);
    this.horizontalAlign = HorizontalTextAlignment.CENTER;
    this.verticalAlign = VerticalTextAlignment.CENTER;
    this.fontFamily = '"HarmonyOS Sans SC","PingFang SC","Microsoft YaHei",sans-serif';
    this.enableBold = false;
    this.enableWrapText = true;
  }
}

export class Graphics extends Component {
  constructor() {
    super();
    this.cmds = [];
    this.fillColor = new Color(255, 255, 255);
    this.strokeColor = new Color(0, 0, 0);
    this.lineWidth = 1;
    this.lineCap = 0;
    this.lineJoin = 0;
  }
  clear() { this.cmds.length = 0; return this; }
  moveTo(x, y) { this.cmds.push({ t: 'moveTo', x, y }); return this; }
  lineTo(x, y) { this.cmds.push({ t: 'lineTo', x, y }); return this; }
  bezierCurveTo(a, b, c, d, e, f) { this.cmds.push({ t: 'bezier', a, b, c, d, e, f }); return this; }
  quadraticCurveTo(a, b, c, d) { this.cmds.push({ t: 'quad', a, b, c, d }); return this; }
  close() { this.cmds.push({ t: 'close' }); return this; }
  rect(x, y, w, h) { this.cmds.push({ t: 'rect', x, y, w, h }); return this; }
  roundRect(x, y, w, h, r) { this.cmds.push({ t: 'rrect', x, y, w, h, r }); return this; }
  circle(x, y, r) { this.cmds.push({ t: 'circle', x, y, r }); return this; }
  ellipse(x, y, rx, ry) { this.cmds.push({ t: 'ellipse', x, y, rx, ry }); return this; }
  arc(x, y, r, a1, a2, ccw) { this.cmds.push({ t: 'arc', x, y, r, a1, a2, ccw: !!ccw }); return this; }
  fill() { this.cmds.push({ t: 'fill', c: new Color(this.fillColor.r, this.fillColor.g, this.fillColor.b, this.fillColor.a) }); return this; }
  stroke() { this.cmds.push({ t: 'stroke', c: new Color(this.strokeColor.r, this.strokeColor.g, this.strokeColor.b, this.strokeColor.a), w: this.lineWidth }); return this; }
}

/* ---------- 节点 ---------- */
export class Node {
  static EventType = {
    TOUCH_START: 'touch-start',
    TOUCH_MOVE: 'touch-move',
    TOUCH_END: 'touch-end',
    TOUCH_CANCEL: 'touch-cancel',
  };

  constructor(name = 'Node') {
    this.name = name;
    this.children = [];
    this.comps = [];
    this._parent = null;
    this.layer = Layers.Enum.UI_2D;
    this.active = true;
    this.isValid = true;
    this._x = 0; this._y = 0; this._z = 0;
    this._sx = 1; this._sy = 1;
    this.angle = 0;
    this._listeners = new Map();
  }

  set parent(p) {
    if (this._parent) {
      const i = this._parent.children.indexOf(this);
      if (i >= 0) this._parent.children.splice(i, 1);
    }
    this._parent = p || null;
    if (p) p.children.push(this);
  }
  get parent() { return this._parent; }

  setPosition(x, y, z) { this._x = x; this._y = y; if (z !== undefined) this._z = z; }
  getPosition() { return new Vec3(this._x, this._y, this._z); }
  setScale(x, y) { this._sx = x; this._sy = y === undefined ? x : y; }
  setSiblingIndex(i) {
    if (!this._parent) return;
    const arr = this._parent.children;
    const cur = arr.indexOf(this);
    if (cur < 0) return;
    arr.splice(cur, 1);
    arr.splice(Math.max(0, Math.min(arr.length, i)), 0, this);
  }
  getSiblingIndex() { return this._parent ? this._parent.children.indexOf(this) : 0; }

  removeAllChildren() {
    for (const c of this.children) { c._parent = null; c.isValid = false; c._destroyDeep(); }
    this.children.length = 0;
  }
  _destroyDeep() {
    for (const c of this.children) c._destroyDeep();
    this.children.length = 0;
    this.isValid = false;
    if (this._parent) {
      const i = this._parent.children.indexOf(this);
      if (i >= 0) this._parent.children.splice(i, 1);
      this._parent = null;
    }
  }
  destroy() { this._destroyDeep(); }

  addComponent(C) {
    const c = new C();
    c.node = this;
    this.comps.push(c);
    return c;
  }
  getComponent(C) {
    for (const c of this.comps) if (c instanceof C) return c;
    return null;
  }
  getComponents(C) { return this.comps.filter((c) => c instanceof C); }
  getChildByName(n) { return this.children.find((c) => c.name === n) || null; }

  on(type, cb, thisArg) {
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push({ cb, thisArg });
  }
  off(type, cb) {
    const arr = this._listeners.get(type);
    if (!arr) return;
    const i = arr.findIndex((e) => e.cb === cb);
    if (i >= 0) arr.splice(i, 1);
  }
  emit(type, ...args) {
    const arr = this._listeners.get(type);
    if (!arr) return;
    for (const e of arr.slice()) e.cb.apply(e.thisArg || this, args);
  }

  /** 世界坐标（累加父链，忽略旋转/缩放） */
  worldPos() {
    let x = this._x, y = this._y;
    let p = this._parent;
    while (p) { x += p._x; y += p._y; p = p._parent; }
    return { x, y };
  }
  /** 节点在世界里是否有效可见 */
  isActiveInHierarchy() {
    let n = this;
    while (n) { if (!n.active) return false; n = n._parent; }
    return true;
  }
}

/* ---------- tween ---------- */
const activeTweens = [];

function readProp(target, key) {
  if (key === 'position') { const p = target.getPosition(); return { x: p.x, y: p.y, z: p.z }; }
  if (key === 'scale') return { x: target._sx, y: target._sy, z: 1 };
  return target[key];
}
function lerpNum(a, b, t) { return a + (b - a) * t; }
function applyProp(target, key, from, to, t) {
  if (key === 'position') {
    target.setPosition(lerpNum(from.x, to.x, t), lerpNum(from.y, to.y, t), lerpNum(from.z || 0, to.z || 0, t));
    return;
  }
  if (key === 'scale') {
    target.setScale(lerpNum(from.x, to.x, t), lerpNum(from.y, to.y, t));
    return;
  }
  if (typeof from === 'number' && typeof to === 'number') { target[key] = lerpNum(from, to, t); return; }
  if (t >= 1) target[key] = to;
}

function startTween(target, steps) {
  // 同一目标上的旧 tween 直接作废，避免两个动画抢同一个属性（归位动画会打架）
  for (let i = activeTweens.length - 1; i >= 0; i--) {
    if (activeTweens[i].target === target) activeTweens.splice(i, 1);
  }
  activeTweens.push({ target, steps, idx: 0, elapsed: 0, from: null, t: 0 });
}

export function tween(target) {
  const steps = [];
  const api = {
    to(dur, props) { steps.push({ k: 'to', dur: Math.max(0, dur), props }); return api; },
    delay(d) { steps.push({ k: 'delay', dur: Math.max(0, d) }); return api; },
    call(fn) { steps.push({ k: 'call', fn }); return api; },
    union() { return api; },
    repeat() { return api; },
    repeatForever() { return api; },
    sequence() { return api; },
    parallel() { return api; },
    start() { startTween(target, steps); return api; },
    stop() {
      const i = activeTweens.findIndex((x) => x.target === target);
      if (i >= 0) activeTweens.splice(i, 1);
      return api;
    },
    tag() { return api; },
    target() { return api; },
  };
  return api;
}

/** 由渲染循环每帧驱动，dt 单位秒 */
export function stepTweens(dt) {
  for (let i = activeTweens.length - 1; i >= 0; i--) {
    const tw = activeTweens[i];
    if (tw.idx >= tw.steps.length) { activeTweens.splice(i, 1); continue; }
    const st = tw.steps[tw.idx];
    if (st.k === 'call') { st.fn && st.fn(); tw.idx++; continue; }
    if (st.k === 'delay') {
      tw.elapsed += dt;
      if (tw.elapsed >= st.dur) { tw.idx++; tw.elapsed = 0; }
      continue;
    }
    // to
    if (!tw.from) {
      tw.from = {};
      for (const k in st.props) tw.from[k] = readProp(tw.target, k);
    }
    tw.elapsed += dt;
    const t = st.dur <= 0 ? 1 : Math.min(1, tw.elapsed / st.dur);
    for (const k in st.props) applyProp(tw.target, k, tw.from[k], st.props[k], t);
    if (t >= 1) { tw.idx++; tw.elapsed = 0; tw.from = null; }
  }
}

export function stopAllTweens() { activeTweens.length = 0; }

/* ---------- 渲染 ---------- */
function drawSprite(ctx, node, sp) {
  const t = node.getComponent(UITransform);
  const w = t ? t.width : 0;
  const h = t ? t.height : 0;
  if (!sp.spriteFrame || !sp.spriteFrame.texture) return;
  const img = sp.spriteFrame.texture.img;
  if (!img || !img.complete) return;
  const r = sp.spriteFrame.rect;
  ctx.save();
  ctx.scale(1, -1); // 抵消外层的 y 翻转，保证贴图正立
  ctx.globalAlpha *= (sp.color ? sp.color.a : 255) / 255;
  try {
    if (r) ctx.drawImage(img, r.x, r.y, r.width, r.height, -w / 2, -h / 2, w, h);
    else ctx.drawImage(img, -w / 2, -h / 2, w, h);
  } catch (e) { /* 贴图未就绪 */ }
  ctx.restore();
}

function drawGraphics(ctx, g) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (const c of g.cmds) {
    switch (c.t) {
      case 'moveTo': ctx.moveTo(c.x, c.y); break;
      case 'lineTo': ctx.lineTo(c.x, c.y); break;
      case 'bezier': ctx.bezierCurveTo(c.a, c.b, c.c, c.d, c.e, c.f); break;
      case 'quad': ctx.quadraticCurveTo(c.a, c.b, c.c, c.d); break;
      case 'close': ctx.closePath(); break;
      case 'rect': ctx.rect(c.x, c.y, c.w, c.h); break;
      case 'rrect': ctx.roundRect(c.x, c.y, c.w, c.h, c.r); break;
      case 'circle': ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2); break;
      case 'ellipse': ctx.ellipse(c.x, c.y, c.rx, c.ry, 0, 0, Math.PI * 2); break;
      case 'arc': ctx.arc(c.x, c.y, c.r, c.a1, c.a2, !!c.ccw); break;
      case 'fill': ctx.fillStyle = c.c.toString(); ctx.fill(); break;
      case 'stroke': ctx.lineWidth = c.w; ctx.strokeStyle = c.c.toString(); ctx.stroke(); break;
    }
  }
}

function drawLabel(ctx, node, lb) {
  const t = node.getComponent(UITransform);
  const w = t ? t.width : 0;
  const h = t ? t.height : 0;
  if (!lb.string) return;
  ctx.save();
  ctx.scale(1, -1); // 文字不受 y 翻转影响
  ctx.fillStyle = lb.color.toString();
  ctx.font = `${lb.enableBold ? '700 ' : ''}${lb.fontSize}px ${(lb.font && lb.font.family) || lb.fontFamily}`;
  ctx.textBaseline = 'middle';
  const lines = String(lb.string).split('\n');
  const lh = lb.lineHeight || lb.fontSize + 6;
  let x = 0;
  if (lb.horizontalAlign === HorizontalTextAlignment.LEFT) { ctx.textAlign = 'left'; x = -w / 2; }
  else if (lb.horizontalAlign === HorizontalTextAlignment.RIGHT) { ctx.textAlign = 'right'; x = w / 2; }
  else { ctx.textAlign = 'center'; x = 0; }
  const total = lines.length * lh;
  let y = lb.verticalAlign === VerticalTextAlignment.TOP ? -h / 2 + lh / 2
    : lb.verticalAlign === VerticalTextAlignment.BOTTOM ? h / 2 - total + lh / 2
      : -total / 2 + lh / 2;
  for (const line of lines) { ctx.fillText(line, x, y); y += lh; }
  ctx.restore();
}

function drawNode(ctx, node) {
  if (!node.active) return;
  ctx.save();
  ctx.translate(node._x, node._y);
  if (node.angle) ctx.rotate((-node.angle * Math.PI) / 180);
  if (node._sx !== 1 || node._sy !== 1) ctx.scale(node._sx, node._sy);
  const op = node.getComponent(UIOpacity);
  if (op) ctx.globalAlpha *= op.opacity / 255;
  for (const c of node.comps) {
    if (c instanceof Sprite) drawSprite(ctx, node, c);
    else if (c instanceof Graphics) drawGraphics(ctx, c);
    else if (c instanceof Label) drawLabel(ctx, node, c);
  }
  for (const ch of node.children) drawNode(ctx, ch);
  ctx.restore();
}

/* ---------- 触摸事件 ---------- */
export class EventTouch {
  constructor(x, y, sx, sy) {
    this._x = x; this._y = y; this._sx = sx === undefined ? x : sx; this._sy = sy === undefined ? y : sy;
  }
  getUILocation() { return new Vec2(this._x, this._y); }
  getLocation() { return new Vec2(this._x, this._y); }
  getStartLocation() { return new Vec2(this._sx, this._sy); }
  getDelta() { return new Vec2(this._x - this._sx, this._y - this._sy); }
  getPreviousLocation() { return new Vec2(this._sx, this._sy); }
}

/** 收集命中的节点（深的在前）；只有注册了监听的节点才参与命中 */
function hitTest(node, x, y, out) {
  if (!node.active) return;
  for (let i = node.children.length - 1; i >= 0; i--) hitTest(node.children[i], x, y, out);
  const t = node.getComponent(UITransform);
  if (!t || !t.width || !t.height || node._listeners.size === 0) return;
  const wp = node.worldPos();
  const hw = (t.width * Math.abs(node._sx)) / 2;
  const hh = (t.height * Math.abs(node._sy)) / 2;
  if (x >= wp.x - hw && x <= wp.x + hw && y >= wp.y - hh && y <= wp.y + hh) out.push(node);
}

/* ---------- 渲染器 / 生命周期宿主 ---------- */
export class Renderer {
  constructor(canvas, root) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.root = root;
    this.scale = 1;
    this._last = 0;
    this._target = null;
    this._start = null;
    director._canvas = canvas;
    director._ctx = this.ctx;
    this._bindInput();
  }

  /** 调用整棵树的 onLoad / start（含 onLoad 中动态创建的子节点） */
  mount() {
    const q = [this.root];
    while (q.length) {
      const n = q.shift();
      for (const c of n.comps) if (!c._loaded) { c._loaded = true; if (c.onLoad) c.onLoad(); }
      for (const ch of n.children.slice()) q.push(ch);
    }
    const q2 = [this.root];
    while (q2.length) {
      const n = q2.shift();
      for (const c of n.comps) if (!c._started) { c._started = true; if (c.start) c.start(); }
      for (const ch of n.children.slice()) q2.push(ch);
    }
  }

  start() {
    this.mount();
    this._last = performance.now();
    const loop = (now) => {
      const dt = Math.min(0.05, (now - this._last) / 1000);
      this._last = now;
      // 每帧补一次生命周期：节点经常是在别的组件 onLoad 里动态创建的
      // （Game 节点就是 MapBootstrap.onLoad 建的），只在启动时 mount 一次的话，
      // 这些节点的 onLoad / start 永远不会被调用 —— 表现是「进了关但棋盘不存在」
      this.mount();
      stepTweens(dt);
      this._update(this.root, dt);
      this._draw();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  _update(node, dt) {
    if (!node.active) return;
    for (const c of node.comps) if (c.enabled && c.update) c.update(dt);
    for (const ch of node.children) this._update(ch, dt);
  }

  _draw() {
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#20242c';
    ctx.fillRect(0, 0, W, H);
    const s = W / view._w;
    this.scale = s;
    ctx.setTransform(s, 0, 0, -s, W / 2, H / 2);
    ctx.globalAlpha = 1;
    drawNode(ctx, this.root);
  }

  /** 屏幕坐标 → 设计坐标（原点在中心，y 向上） */
  _toDesign(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    const px = (clientX - r.left) * (this.canvas.width / r.width);
    const py = (clientY - r.top) * (this.canvas.height / r.height);
    return { x: (px - this.canvas.width / 2) / this.scale, y: (this.canvas.height / 2 - py) / this.scale };
  }

  _bindInput() {
    const cv = this.canvas;
    const pick = (clientX, clientY) => {
      const p = this._toDesign(clientX, clientY);
      const out = [];
      hitTest(this.root, p.x, p.y, out);
      return { node: out[0] || null, p };
    };

    cv.addEventListener('pointerdown', (e) => {
      const hit = pick(e.clientX, e.clientY);
      if (!hit.node) return;
      cv.setPointerCapture && cv.setPointerCapture(e.pointerId);
      this._target = hit.node;
      this._start = hit.p;
      hit.node.emit(Node.EventType.TOUCH_START, new EventTouch(hit.p.x, hit.p.y));
      e.preventDefault();
    });

    cv.addEventListener('pointermove', (e) => {
      if (!this._target) return;
      const p = this._toDesign(e.clientX, e.clientY);
      const s = this._start || p;
      this._target.emit(Node.EventType.TOUCH_MOVE, new EventTouch(p.x, p.y, s.x, s.y));
      e.preventDefault();
    });

    const end = (e, cancel) => {
      if (!this._target) return;
      const p = this._toDesign(e.clientX, e.clientY);
      const s = this._start || p;
      const t = this._target;
      this._target = null;
      this._start = null;
      t.emit(cancel ? Node.EventType.TOUCH_CANCEL : Node.EventType.TOUCH_END, new EventTouch(p.x, p.y, s.x, s.y));
      e.preventDefault();
    };
    cv.addEventListener('pointerup', (e) => end(e, false));
    cv.addEventListener('pointercancel', (e) => end(e, true));
    cv.addEventListener('pointerleave', (e) => { if (this._target) end(e, true); });
  }
}

/* ============================================================
 * 游戏事件 / 音频 —— GameBootstrap.ts 与 game/audio.ts 用到
 *
 * 浏览器里没有真正的「切后台」，所以 EVENT_HIDE / EVENT_SHOW 由
 * document.visibilitychange 转发：「切后台停表、回前台按时间戳补扣」这条路径
 * 在预览里也能走一遍，否则只能到真机才发现对不上。
 * ========================================================== */

export const Game = {
  EVENT_HIDE: 'game-hide',
  EVENT_SHOW: 'game-show',
  EVENT_RESTART: 'game-restart',
};

export const game = {
  _handlers: new Map(),
  on(type, cb, target) {
    if (!this._handlers.has(type)) this._handlers.set(type, []);
    this._handlers.get(type).push({ cb, target });
  },
  off(type, cb, target) {
    const arr = this._handlers.get(type);
    if (!arr) return;
    const i = arr.findIndex((h) => h.cb === cb && (!target || h.target === target));
    if (i >= 0) arr.splice(i, 1);
  },
  emit(type, ...args) {
    for (const h of (this._handlers.get(type) || []).slice()) {
      if (h.target) h.cb.apply(h.target, args);
      else h.cb(...args);
    }
  },
};

if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('visibilitychange', () => {
    game.emit(document.hidden ? Game.EVENT_HIDE : Game.EVENT_SHOW);
  });
}

export class AudioClip {
  constructor(name = '') {
    this.name = name;
    this.duration = 0;
  }
}

/**
 * 预览环境不发声（没有音频素材，也不该在预览里放声音），
 * 但 play / stop / playing 这几个状态要**真实维护**：
 * 「BGM 跟着倒计时停」「设置里关掉音乐就停」这类联动是靠 `playing` 判的，
 * 一律返回 true 会让这些联动在预览里根本查不出来。
 */
/**
 * 以下三个是**占位**：MapBootstrap 只是拿它们做类型 / 挂组件，预览页目前
 * 是 `index.html`（自包含原型），不需要真行为。
 * 将来若要把地图也接进预览，ScrollView 的滚动与 Mask 的裁剪必须补真实现 ——
 * 挂个空壳上去不报错，但也裁不出东西，比报错更难查。
 */
export class Font extends Component {
  constructor() { super(); this.family = 'HarmonyOS Sans SC'; }
}
export class Mask extends Component {
  constructor() { super(); this.type = 0; this.inverted = false; }
}
/** MapBootstrap 会写 `mask.type = Mask.Type.RECT` —— 缺了就是运行时 TypeError */
Mask.Type = { RECT: 0, ELLIPSE: 1, GRAPHICS_STENCIL: 2, GRAPHICS_RECT: 3, IMAGE_STENCIL: 4 };
export class ScrollView extends Component {
  constructor() {
    super();
    this.content = null;
    this.vertical = true;
    this.horizontal = false;
  }
  scrollToBottom() {}
  scrollToTop() {}
  stopAutoScroll() {}
}

export class AudioSource extends Component {
  constructor() {
    super();
    this.clip = null;
    this.loop = false;
    this.volume = 1;
    this._playing = false;
  }
  get playing() { return this._playing; }
  play() { this._playing = !!this.clip; }
  stop() { this._playing = false; }
  pause() { this._playing = false; }
  resume() { this._playing = !!this.clip; }
  playOneShot(clip, volume) { /* 静默 */ }
}
