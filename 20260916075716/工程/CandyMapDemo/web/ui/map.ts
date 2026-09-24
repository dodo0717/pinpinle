/**
 * 首页 = 关卡地图（糖果传奇式纵向卷轴选关）。
 *
 * ⚠️ 首页与关卡地图是**同一屏**：进游戏第一眼就是地图，图鉴 / 排行榜 / 设置的
 * 「返回」也回到这一屏。所以这一屏同时承担两件事：
 *   1. **首页该有的**：LOGO、体力与倒计时、当前进度（第 N 关 · 星级 · 进度条）；
 *   2. **地图该有的**：选关、看星级与最高分、点关卡直接开打（已通关的可以再挑战）。
 *
 * 三条口径：
 *   1. **3 张地图**：第 1~20 / 21~40 / 41~60 关各一张，页签切换，各自一套配色；
 *   2. **整屏翻页**：一屏 = 一段美术图（1080×1920）= 一页。上下滑动 / 点右侧箭头 / 键盘
 *      ↑↓ 都只翻整页，松手自动吸附到页边界 —— 美术三段的接缝落在屏外（最多在翻页途中一闪
 *      而过），不会像连续卷轴那样把拼缝摆在画面正中。切地图时整张地图绕 X 轴翻转进出；
 *   3. **默认定位**：进入时直接翻到「当前正在解锁的关卡」所在的那一页 ——
 *      玩家进来第一眼就该看见自己该打哪一关，而不是从头翻。
 *
 * ⚠️ 翻页是**自实现**的，刻意不用 `overflow-y: auto`：
 * `#viewport / #stage` 上挂着 `touch-action: none`（为真机边缘手势让路，见 §1.6.9），
 * 浏览器不会替我们滚 —— 图鉴/排行榜那种 `overflow-y:auto` 在真机上只有鼠标滚轮能滚。
 * 自己实现的代价是要管边界与吸附，好处是页高、吸附曲线、倾斜角全在本地可调。
 *
 * 界面只做显示与转发点击：关卡状态（locked / unlocked / cleared、星级、最高分、网格）
 * 由 main.ts 从 core 派生后传进来，与 collection.ts / leaderboard.ts 同一分层。
 */

import { MODE_LABEL, type LevelStatus } from '../../assets/scripts/core/index.ts';
import { HOME, MAP } from './text.ts';
import { buttonEl, el, starText, toast } from './dom.ts';
import { closeDialog, openDialog } from './dialog.ts';

/** 单张地图上的一个关卡节点（状态来自 core，界面不自己判） */
export interface MapNode {
  level: number;
  status: LevelStatus;
  /** 历史最高星级（0 = 未通关） */
  stars: number;
  /** 历史最高分（0 = 没打过） */
  best: number;
  /** 网格标签，如 `4×4`（来自 `GRID_BY_LEVEL`） */
  grid: string;
}

/** 玩法模式（与 core 的 `GameMode` 同字面量；两套进度各自独立） */
export type MapMode = 'normal' | 'nightmare';

export interface MapView {
  /** 当前模式 —— 首页上直接给「普通 / 困难」两个按钮切（两套进度各自独立） */
  mode: MapMode;
  /** 当前模式文案（普通 / 困难），与 `mode` 同源，别各写一套 */
  modeLabel: string;
  /** 当前正在解锁的关卡 = 默认定位目标 = 进度区显示的那一关 */
  currentLevel: number;
  /** `currentLevel` 的历史最高星级（0 = 未通关） */
  stars: number;
  /** 关卡总数 */
  totalLevels: number;
  /** 全部关卡（1~60），按关卡号升序 */
  nodes: MapNode[];
  /** 顶栏资料：头像 + 昵称（还没有账号系统，main 先用占位值） */
  profile: { avatar: string; nickname: string };
  /** 体力：进关要消耗，所以首页上直接显示（糖果传奇的做法） */
  stamina: { available: number; max: number; countdown: string | null };
}

export interface MapHandlers {
  /** 切玩法模式（普通 / 困难）：两套进度各自独立，切了要换一套关卡状态 */
  onMode: (mode: MapMode) => void;
  /** 点了某个可玩关卡（已通关的也能再挑战一次） */
  onPick: (level: number) => void;
  /** 点体力：加体力分支由调用方判定 */
  onAddStamina: () => void;
}

export interface MapScreen {
  el: HTMLElement;
  render: (view: MapView) => void;
  /** 进入该屏时调用：重新量视口并定位到当前解锁关（首帧隐藏时量不到高度） */
  enter: () => void;
  /** 每秒只刷体力这两处（避免整屏重绘打断滚动） */
  tick: (available: number, countdown: string | null) => void;
}

/* ------------------------------------------------------------------ 布局常量（画布 px） */

const STAGE_W = 1536;
/**
 * 相邻关卡的纵向间距。
 * 与 PAD_TOP / PAD_BOTTOM 一起凑成轨道总高 = 3 × 1920 = 5760：
 * 竖屏每段正好 1080 × 1920（9:16），美术按「三段」出底图，边界还刚好落在
 * 两关之间的空隙上（上 6 关 / 中 8 关 / 下 6 关），不会把关卡牌切成两半。
 * 改这三个值之前先确认：5760 = PAD_TOP + 19 × NODE_STEP + PAD_BOTTOM。
 */
const NODE_STEP = 341;
/** 轨道的上下留白：第 1 关不能贴着屏幕底，最后一关上方也要有落脚处 */
const PAD_TOP = 860;
const PAD_BOTTOM = 853;
/** 左右摆动幅度（蜿蜒路径的幅度） */
const SWING = 356;

/** 拖动速度上限（px/帧），防止一甩甩到底 */
const MAX_FLING = 95;
/** 松手后按速度多翻一页的投影系数（px/帧 → px）：轻轻一甩就翻页，不用拖到底 */
const FLING_PROJECT = 14;
/** 拖动位移小于它算「点击」而不是「翻页」 */
const CLICK_SLOP = 14;
/** 速度 → 倾斜角系数，以及角度上限（度）：只在拖动中倾，翻页到位就回正 */
const ROLL_FACTOR = 0.22;
const MAX_ROLL = 13;
/** 越界拖动的橡皮筋阻尼（0.32 = 只走三分之一行程） */
const RUBBER = 0.32;

/** 三张地图（糖果传奇式「世界」）。名字是占位文案，等主美给正式主题名 */
const WORLDS = [
  { name: '奶油果园', from: 1, to: 20 },
  { name: '蜂蜜森林', from: 21, to: 40 },
  { name: '星糖夜空', from: 41, to: 60 },
] as const;

/** 关卡号 → 地图下标（越界兜底到首/末张，避免素材缺关时崩掉） */
function worldIndexOf(level: number): number {
  const idx = Math.floor((Math.max(1, level) - 1) / 20);
  return Math.max(0, Math.min(WORLDS.length - 1, idx));
}

/** 节点横坐标：正弦摆动，每张地图错开相位，三张地图才不会看起来是同一张 */
function nodeX(local: number, world: number): number {
  return STAGE_W / 2 + Math.sin((local + 1) * 0.85 + world * 1.9) * SWING;
}

/** 节点纵坐标：`local` 0 是第 1 关 —— y 越大越靠下，所以第 1 关在最底部，往上推进 */
function nodeY(local: number, count: number): number {
  return PAD_TOP + (count - 1 - local) * NODE_STEP;
}

function trackHeight(count: number): number {
  return PAD_TOP + Math.max(0, count - 1) * NODE_STEP + PAD_BOTTOM;
}

/** 两节点之间的 S 形曲线：控制点取垂直方向的 45%，正是糖果传奇那种「绕着往上爬」的观感 */
function segmentPath(
  p0: { x: number; y: number },
  p1: { x: number; y: number },
): string {
  const my = (p0.y + p1.y) / 2;
  return `M ${p0.x.toFixed(1)} ${p0.y.toFixed(1)} C ${p0.x.toFixed(1)} ${my.toFixed(1)}, ` +
    `${p1.x.toFixed(1)} ${my.toFixed(1)}, ${p1.x.toFixed(1)} ${p1.y.toFixed(1)}`;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/* ------------------------------------------------------------------ 美术底图 */

/** 美术底图目录（九张 1080×1920，三段拼成 1080×5760 的整条地图） */
const MAP_ART_DIR = '/art/map';
/** 单段底图高度：顶 2731 + 中 2731 + 底 2730，拼起来正好 = track 的 8192 */
const SEG_H = 2731;
/** segment offsets: cumulative top of top / mid / bottom (2731 + 2731 + 2730 = 8192) */
const SEG_TOPS = [0, 2731, 5462];
const SEG_HEIGHTS = [2731, 2731, 2730];
/** 底图分段名，按 track 从上到下：段3顶部 → 段2中部 → 段1底部（见 map-slices/底图规格与坐标.md） */
const SEG_NAMES = ['top', 'mid', 'bottom'] as const;
/** 一页 = 一段底图 = 一屏：整屏翻页的最小单位（也是吸附的步长） */
const PAGE_H = SEG_H;
/** 一条轨道的页数 = 段数 = 3 */
const PAGE_COUNT = SEG_NAMES.length;

/* ------------------------------------------------- 石台透视（与美术约定，改这里就够） */

/** 石台基准直径（底图画的就是 190，见底图规格 §五） */
const STONE_W = 190;
/**
 * 压扁比：地面是斜俯视坡面，石台躺上去从镜头看是椭圆，高 = 宽 × 0.62。
 * ⚠️ 美术必须按同一个压扁比画所有石台，程序这边只认这一个数。
 */
const SQUASH = 0.62;
/** 倾斜角上限（度）：石台越偏离画面中心，长轴越跟着坡向倾斜；左右各 ±6° */
const TILT_MAX = 6;
/** 远近系数：越往上（远）越小 —— 底部 1.0，顶部 0.85，线性过渡 */
const DEPTH_NEAR = 1;
const DEPTH_FAR = 0.85;

/* ------------------------------------------- 圆柱滚动（糖果传奇式焦点纵深） */

/**
 * 地图卷在一个横轴圆柱上，镜头只看到正对着的一小段 —— 滚动就是在转这个圆柱。
 * 注意这是**正交投影下的圆柱几何**，不是透视，所以底图仍然是无透视的平面图：
 *   θ = s / R          s = 节点到视口中心的弧长
 *   y' = R·sin θ       纵向位置（弧线投影，越远越往中心收）
 *   scale = cos θ      纯几何，不是 1/d 那种近大远小
 * R 是唯一的坡度旋钮，越大越平缓：
 *   R=2500 → 视口边缘缩到 0.93、位移 24px（微弱，底图不必跟着弯）
 *   R=1500 → 视口边缘缩到 0.80、位移 64px（明显，但底图要一起弯才不脱节）
 * 滚进滚出时节点会经历完整的 0.4 → 1.0，「从远景拉到近景」就是这么来的。
 */
/**
 * depth/focus switch. OFF = flat vertical scroll (art background is a plain
 * upward map, no perspective); keep the code so it can be turned back on if
 * orthographic art ever becomes available.
 */
const SPHERE_ON = false;
const SPHERE_R = 2500;
/** 绕到这个倾角之后算转到背面，直接藏起来（再往下 cos 会变负） */
const SPHERE_BACK = 85;
/** 最远离中心时压暗多少（0.38 = 最暗 0.62 倍亮度） */
const SPHERE_DIM = 0.38;
/** 翻页动画时长（ms）：改成 JS 驱动就是为了让它和焦点缩放同一帧算 */
const SNAP_MS = 420;

/**
 * 第 `local` 个石台的透视参数（与美术约定一致的一套公式，不逐个量）：
 * 宽 = 基准 × 远近系数，高 = 宽 × 压扁比，倾斜 = 横向偏移 × TILT_MAX。
 */
function stoneShape(
  local: number,
  count: number,
  world: number,
): { w: number; h: number; rot: number } {
  if (!SPHERE_ON) return { w: STONE_W, h: STONE_W * SQUASH, rot: 0 };
  const x = nodeX(local, world);
  // 横向偏移 -1（最左）~ 1（最右）
  const dx = clamp((x - STAGE_W / 2) / SWING, -1, 1);
  // local 0 在最底部（离镜头最近），最后一个在最顶部（最远）
  const t = count > 1 ? local / (count - 1) : 0;
  const depth = DEPTH_NEAR + (DEPTH_FAR - DEPTH_NEAR) * t;
  const w = STONE_W * depth;
  return { w, h: w * SQUASH, rot: dx * TILT_MAX };
}

/* ------------------------------------------------------------------ 屏幕 */

export function createMapScreen(handlers: MapHandlers): MapScreen {
  // has-art：美术底图已接入 → CSS 云与程序画的小路让位给底图
  const cls = ['screen', 'home', 'map', 'has-art'];
  // ?debug=stone → 画出程序算出的石台椭圆轮廓，和美术画的石台对比，一眼看出哪个对不上
  if (new URLSearchParams(location.search).get('debug') === 'stone') cls.push('debug-stone');
  const root = el('section', cls.join(' '));
  root.id = 'screen-home';

  /* ---- 顶栏：左 = 头像 + 昵称，右 = 体力 ❤ N/M ---- */
  const top = el('div', 'home-top');

  const userBox = el('div', 'home-user');
  const avatarEl = el('span', 'home-avatar', HOME.avatar);
  const nickEl = el('span', 'home-nick', HOME.nickname);
  userBox.appendChild(avatarEl);
  userBox.appendChild(nickEl);
  top.appendChild(userBox);

  // 体力整块是一个按钮：点它 = 加体力（原来的「＋」并进来了，顶栏只留一个元素）
  const staminaBox = el('button', 'home-stamina');
  staminaBox.type = 'button';
  staminaBox.title = HOME.addStaminaTip;
  const heartsText = el('span', 'hearts-text');
  staminaBox.appendChild(heartsText);
  const recoverEl = el('span', 'home-recover');
  staminaBox.appendChild(recoverEl);
  staminaBox.addEventListener('click', () => handlers.onAddStamina());
  top.appendChild(staminaBox);
  root.appendChild(top);

  /* ---- 世界名 · 本世界进度（两侧小箭头切三张地图） ---- */
  const titleRow = el('div', 'map-title-row');
  // `flipTo` 是函数声明，定义在本函数后面也能用；越界它在内部自己挡掉
  titleRow.appendChild(buttonEl('‹', 'map-world-nav', () => flipTo(world - 1)));
  const titleText = el('span', 'map-title');
  titleRow.appendChild(titleText);
  titleRow.appendChild(buttonEl('›', 'map-world-nav', () => flipTo(world + 1)));
  root.appendChild(titleRow);

  /* ---- 难度切换：普通 / 困难（两套进度各自独立，必须能当场切） ---- */
  const modes = el('div', 'map-modes');
  const modeBtns = ([
    { key: 'normal', label: MODE_LABEL.normal },
    { key: 'nightmare', label: MODE_LABEL.nightmare },
  ] as const).map((m) => {
    const btn = buttonEl(m.label, 'map-mode-btn', () => handlers.onMode(m.key));
    modes.appendChild(btn);
    return { key: m.key as MapMode, btn };
  });
  root.appendChild(modes);

  /* ---- 卷轴 ---- */
  const scroll = el('div', 'map-scroll');
  const track = el('div', 'map-track');
  scroll.appendChild(track);
  root.appendChild(scroll);

  /* ---- 翻页控件：整屏翻页的显式入口（右侧一列「▲ · 页点 · ▼」） ---- */
  const pager = el('div', 'map-pager');
  const pageUp = buttonEl('▲', 'map-pager-btn', () => snapToPage(page - 1, true));
  const pageDown = buttonEl('▼', 'map-pager-btn', () => snapToPage(page + 1, true));
  const dots = el('div', 'map-pager-dots');
  const dotEls = SEG_NAMES.map((_, i) => {
    const dot = buttonEl('', 'map-pager-dot', () => snapToPage(i, true));
    dot.title = `第 ${i + 1} 屏`;
    dots.appendChild(dot);
    return dot;
  });
  pager.appendChild(pageUp);
  pager.appendChild(dots);
  pager.appendChild(pageDown);
  // 控件不能把手势抢走：自己吞掉 pointerdown，只让 click 生效
  pager.addEventListener('pointerdown', (e) => e.stopPropagation());
  scroll.appendChild(pager);

  /* ---------------------------------------------------------------- 滚动状态 */

  let view: MapView | null = null;
  let world = 0;
  /** 体力上限（由 view 传入，首帧还没渲染时按 10 兜底） */
  let staminaMax = 10;
  /** track 的位移（stage px，<= 0 表示内容上移）—— 单位与节点坐标同一套，不含 fitScale */
  let offset = 0;
  /** 拖动中的速度（px/帧）：只用来算倾斜角与松手后的翻页投影，不做惯性滑行 */
  let velocity = 0;
  /** 倾斜角（度）：拖动中跟着速度倾，翻页到位就回正 */
  let roll = 0;
  let viewH = 0;
  let minOffset = 0;
  const maxOffset = 0;
  /** 屏幕像素 ÷ 画布像素（指针坐标换算用，从卷轴自身量，不依赖 main.ts） */
  /** 本世界的节点元素 + 它在轨道上的 y：圆柱滚动每帧要按它算倾角 */
  const nodeEls: { el: HTMLElement; y: number; hidden: boolean }[] = [];
  /** 翻页补间的 rAF id（拖动时要掐掉，否则会和手指抢 offset） */
  let rafId = 0;

  let scale = 1;
  /** 一页铺满可视高度所需的缩放（手机上约 0.7，视口够高时封顶 1） */
  let fitScale = 1;
  /** 一页在 stage 坐标里的高度 = PAGE_H × fitScale，也是吸附步长 */
  let pageSpan = PAGE_H;
  /** 当前页（0 = 段3 顶部 L15~L20，2 = 段1 底部 L1~L6） */
  let page = 0;

  let dragging = false;
  let dragMoved = false;
  let dragStartY = 0;
  let dragStartClientY = 0;
  let dragStartOffset = 0;
  let lastY = 0;
  /** 翻转动画中：屏蔽拖动与点击，避免动画被打断成半张地图 */
  let flipping = false;
  /** pointerup 里已经处理了本次点击，屏蔽紧随其后的 click 事件，避免重复进关 */
  let tapHandled = false;

  function measure(): void {
    viewH = scroll.clientHeight;
    // 一页 = 一段美术图（1080×1920）：按可视高度等比缩小，让整段正好铺满一屏
    fitScale = viewH > 0 ? Math.min(1, viewH / PAGE_H) : 1;
    pageSpan = PAGE_H * fitScale;
    // 内容总高（stage px）= 三页之和；fitScale 被截断到 1 时才可能出现零头
    const content = track.offsetHeight * fitScale;
    minOffset = Math.min(0, -(content - viewH));
    // 元素隐藏时 rect 为 0 → 兜底 1，进入屏时会重新量
    const box = scroll.getBoundingClientRect().height;
    scale = scroll.offsetHeight > 0 && box > 0 ? box / scroll.offsetHeight : 1;
  }

  /** 第 p 页对应的位移（整页边界，夹在可滚范围内） */
  function pageOffset(p: number): number {
    return clamp(-p * pageSpan, minOffset, maxOffset);
  }

  /** 离 `v` 最近的那一页 */
  function nearestPage(v: number): number {
    return clamp(Math.round(-v / pageSpan), 0, Math.max(0, PAGE_COUNT - 1));
  }

  /** 某个轨道坐标落在第几页（底图坐标：一段 = 一页 = 1920） */
  function pageOfY(y: number): number {
    return clamp(Math.floor(y / PAGE_H), 0, Math.max(0, PAGE_COUNT - 1));
  }

  function applyOffset(): void {
    // 先缩放再平移：translate 的量是 stage px（不受 fitScale 影响），页高换算见 pageSpan
    track.style.transform =
      `translate3d(0, ${offset.toFixed(2)}px, 0) scale(${fitScale.toFixed(4)})`;
    // 自定义属性写在 track 上 → 所有节点继承，省掉每帧遍历 20 个节点
    track.style.setProperty('--roll', `${roll.toFixed(2)}deg`);
    // 给翻转动画的 keyframes 用（见 ui.css 的 mapFlip*）
    track.style.setProperty('--fit', fitScale.toFixed(4));
    track.style.setProperty('--anchor', `${offset.toFixed(2)}px`);
    applyFocus();
  }

  /**
   * 圆柱滚动：按每个节点到**视口中心**的距离算倾角，给出缩放 / 弧线位移 / 层级 / 明暗。
   * 视口中心那一刻对应的轨道坐标是纯算式 `(viewH/2 - offset) / fitScale`，
   * 所以不读 DOM、不触发重排；谁滚到中心谁就是核心节点，不用预先指定。
   */
  function applyFocus(): void {
    if (nodeEls.length === 0 || fitScale <= 0) return;
    if (!SPHERE_ON) return;
    const focusY = (viewH / 2 - offset) / fitScale;
    const back = (SPHERE_BACK * Math.PI) / 180;
    for (const it of nodeEls) {
      const s = it.y - focusY;      // 到核心点的弧长：>0 在下方，<0 在上方
      const th = s / SPHERE_R;      // 绕圆柱转过的倾角
      const a = Math.abs(th);
      if (a >= back) {              // 绕到背面了：藏起来省得算
        if (!it.hidden) {
          it.el.style.visibility = 'hidden';
          it.hidden = true;
        }
        continue;
      }
      if (it.hidden) {
        it.el.style.visibility = '';
        it.hidden = false;
      }
      const sc = Math.cos(th);
      it.el.style.setProperty('--focus', sc.toFixed(4));
      it.el.style.setProperty('--fy', `${(SPHERE_R * Math.sin(th) - s).toFixed(1)}px`);
      it.el.style.zIndex = String(100 + Math.round(sc * 90));
      // 离中心越远越暗：视口内只压几个百分点，滚进滚出时才有明显的「远景感」
      it.el.style.filter = sc < 0.995
        ? `brightness(${(1 - SPHERE_DIM * (1 - sc)).toFixed(3)})`
        : '';
    }
  }

  /**
   * 整屏翻页的补间。用 JS 而不是 CSS transition 驱动，是因为焦点缩放要跟滚动同一帧算 ——
   * 交给 CSS 的话 offset 瞬间跳到终值，缩放会「瞬移」而轨道还在慢慢滚。
   */
  function animateTo(target: number, ms: number): void {
    if (rafId) window.cancelAnimationFrame(rafId);
    const from = offset;
    const roll0 = roll;
    if (ms <= 0 || Math.abs(target - from) < 0.5) {
      offset = target;
      roll = 0;
      rafId = 0;
      applyOffset();
      return;
    }
    const t0 = performance.now();
    const step = (now: number): void => {
      const k = Math.min(1, (now - t0) / ms);
      const e = 1 - Math.pow(1 - k, 3);   // easeOutCubic
      offset = from + (target - from) * e;
      roll = roll0 * (1 - e);             // 松手后倾斜跟着一起回正
      applyOffset();
      rafId = k < 1 ? requestAnimationFrame(step) : 0;
    };
    rafId = requestAnimationFrame(step);
  }

  /** 倾斜角只跟拖动速度走，松手即回正（分页后没有惯性滑行，不需要每帧循环） */
  function updateRoll(): void {
    roll = clamp(-velocity * ROLL_FACTOR, -MAX_ROLL, MAX_ROLL);
  }

  /** 拖动越界时只走一部分行程（橡皮筋），松手后吸附回页边界 */
  function rubber(v: number): number {
    if (v > maxOffset) return maxOffset + (v - maxOffset) * RUBBER;
    if (v < minOffset) return minOffset + (v - minOffset) * RUBBER;
    return v;
  }

  /** 整屏翻到第 p 页（定位与拖动吸附共用；带 CSS 过渡，读起来就是「整屏翻过去」） */
  function snapToPage(p: number, animated: boolean): void {
    page = clamp(p, 0, Math.max(0, PAGE_COUNT - 1));
    velocity = 0;
    // 补间交给 animateTo（JS 逐帧），CSS 的 .snap 过渡会跟每帧写入的 transform 打架
    animateTo(pageOffset(page), animated ? SNAP_MS : 0);
    paintPager();
  }

  /* ---------------------------------------------------------------- 指针手势 */

  scroll.addEventListener('pointerdown', (e) => {
    if (flipping) return;
    // 手指按下就掐掉翻页补间，否则 rAF 会和手指抢 offset
    if (rafId) {
      window.cancelAnimationFrame(rafId);
      rafId = 0;
    }
    dragging = true;
    dragMoved = false;
    tapHandled = false;
    velocity = 0;
    // 每次按下都重新量：旋屏 / 高度变化后页高跟着变
    measure();
    dragStartClientY = e.clientY;
    dragStartY = e.clientY / scale;
    dragStartOffset = offset;
    lastY = dragStartY;
    // 拖动期间不能有过渡，否则整片会「追着手指慢慢飘」
    track.classList.remove('snap');
    scroll.setPointerCapture(e.pointerId);
  });

  scroll.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const y = e.clientY / scale;
    // 用「屏幕像素」判定是不是在拖动，避免手机上缩放后阈值过严（canvas 14px 只剩 5~6 屏幕 px）
    const movedScreen = e.clientY - dragStartClientY;
    if (!dragMoved && Math.abs(movedScreen) > CLICK_SLOP) dragMoved = true;
    const moved = y - dragStartY;
    // 速度取平滑值（原始逐帧差抖动太大，倾斜角会一抽一抽）
    velocity = (y - lastY) * 0.6 + velocity * 0.4;
    lastY = y;
    // 拖动跟手，松手再整页吸附
    offset = rubber(dragStartOffset + moved);
    updateRoll();
    applyOffset();
  });

  const endDrag = (): void => {
    if (!dragging) return;
    dragging = false;
    velocity = clamp(velocity, -MAX_FLING, MAX_FLING);
    // 松手 → 整页吸附：位移 + 速度投影（轻轻一甩就翻页，不用拖到底）
    snapToPage(nearestPage(offset + velocity * FLING_PROJECT), true);
  };

  scroll.addEventListener('pointerup', (e) => {
    if (!dragging) return;
    const wasTap = !dragMoved;
    endDrag();
    // 真机上 pointer capture 会拦截节点 click， tap 在这里直接处理；桌面浏览器若再发 click 则由 tapHandled 屏蔽
    if (wasTap && !flipping) {
      const target = document.elementFromPoint(e.clientX, e.clientY);
      const nodeEl = target?.closest('[data-level]');
      if (nodeEl) {
        const level = Number(nodeEl.dataset.level);
        const n = worldNodes(world).find((x) => x.level === level);
        if (n) {
          tapHandled = true;
          selectNode(n);
        }
      }
    }
  });
  scroll.addEventListener('pointercancel', endDrag);

  /* ---------------------------------------------------------------- 渲染 */

  /** 页码点与箭头：到头就置灰 */
  function paintPager(): void {
    dotEls.forEach((dot, i) => dot.classList.toggle('on', i === page));
    pageUp.disabled = page <= 0;
    pageDown.disabled = page >= PAGE_COUNT - 1;
  }

  function worldNodes(w: number): MapNode[] {
    const { from, to } = WORLDS[w]!;
    return (view?.nodes ?? []).filter((n) => n.level >= from && n.level <= to);
  }

  /** 选中某个关卡：锁定的给提示，可玩的交给主控制器 */
  function selectNode(node: MapNode): void {
    if (flipping) return;
    if (node.status === 'locked') {
      toast(MAP.locked(Math.max(1, node.level - 1)), 1800);
      return;
    }
    handlers.onPick(node.level);
  }

  /**
   * 顶栏与标题行（世界名 · 进度 / 难度高亮 / 主题色）。
   * 这一行就是美术结构里的第 2 行：`奶油果园 · 1/20`。
   */
  function paintChrome(): void {
    const item = WORLDS[world]!;
    const list = worldNodes(world);
    const idx = list.findIndex((n) => n.level === (view?.currentLevel ?? 1));
    // 当前关不在这张地图上（玩家手动翻到了别的世界）→ 显示这张地图自己的进度
    const local = clamp(
      idx >= 0 ? idx + 1 : list.filter((n) => n.status === 'cleared').length + 1,
      1,
      Math.max(1, list.length),
    );
    titleText.textContent = HOME.worldProgress(item.name, local, Math.max(1, list.length));

    for (const m of modeBtns) m.btn.classList.toggle('on', m.key === (view?.mode ?? 'normal'));
    nickEl.textContent = view?.profile.nickname ?? HOME.nickname;
    avatarEl.textContent = view?.profile.avatar ?? HOME.avatar;
    // 世界主题色：三张地图各一套天空渐变（见 ui.css 的 .map.world-N）
    root.classList.remove('world-0', 'world-1', 'world-2');
    root.classList.add(`world-${world}`);
  }

  function buildWorld(w: number): void {
    const list = worldNodes(w);
    const h = trackHeight(list.length);
    track.style.height = `${h}px`;
    track.replaceChildren();
    nodeEls.length = 0;

    /* 美术底图：三段从上到下铺满整条轨道（顶段 y=0 / 中段 1920 / 底段 3840）。
       节点坐标与底图共用同一套坐标系（见 map-slices/底图规格与坐标.md），所以关卡牌
       正好落在底图画好的糖果石台上。缺图时这层是透明的，自动退回 CSS 天空渐变。 */
    const bg = el('div', 'map-bg');
    SEG_NAMES.forEach((seg, i) => {
      const layer = el('div', 'map-bg-seg');
      layer.style.top = `${SEG_TOPS[i]}px`;
      layer.style.height = `${SEG_HEIGHTS[i]}px`;
      layer.style.backgroundImage = `url("${MAP_ART_DIR}/map-w${w + 1}-${seg}.png")`;
      bg.appendChild(layer);
    });
    track.appendChild(bg);

    const pos = list.map((_, i) => ({ x: nodeX(i, w), y: nodeY(i, list.length) }));

    /* 路径：逐段画，段的「点亮」由**下方那个节点是否已通关**决定 ——
       打通第 N 关 → 从 N 到 N+1 的那一段跟着亮，不需要算 dasharray 长度。 */
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'map-path');
    svg.setAttribute('viewBox', `0 0 ${STAGE_W} ${h}`);
    svg.setAttribute('width', String(STAGE_W));
    svg.setAttribute('height', String(h));
    for (let i = 0; i < list.length - 1; i++) {
      const d = segmentPath(pos[i]!, pos[i + 1]!);
      // 先铺一条更宽的浅色路基，再画路面 —— 路才有「压在草地上」的厚度
      const casing = document.createElementNS(SVG_NS, 'path');
      casing.setAttribute('d', d);
      casing.setAttribute('class', 'seg-case');
      svg.appendChild(casing);
      const seg = document.createElementNS(SVG_NS, 'path');
      seg.setAttribute('d', d);
      seg.setAttribute('class', list[i]!.status === 'cleared' ? 'seg lit' : 'seg');
      svg.appendChild(seg);
    }
    track.appendChild(svg);

    const currentLevel = view?.currentLevel ?? 1;
    list.forEach((node, i) => {
      const cls = ['node', node.status];
      if (node.level === currentLevel) cls.push('current');
      const nodeEl = el('div', cls.join(' '));
      nodeEl.style.left = `${pos[i]!.x}px`;
      nodeEl.style.top = `${pos[i]!.y}px`;
      nodeEl.dataset.level = String(node.level);
      // 透视参数：CSS 里按这三个变量把牌压成跟美术石台同一形状的椭圆
      const shape = stoneShape(i, list.length, w);
      nodeEl.style.setProperty('--pw', `${shape.w.toFixed(1)}px`);
      nodeEl.style.setProperty('--ph', `${shape.h.toFixed(1)}px`);
      nodeEl.style.setProperty('--prot', `${shape.rot.toFixed(2)}deg`);

      nodeEl.appendChild(el('span', 'node-num', String(node.level)));
      // 已通关：星级 + 历史最高分（可以直接再挑战，所以分数要看得见）；
      // 没打过：显示网格尺寸，让玩家知道这一关多大
      if (node.status === 'cleared') {
        nodeEl.appendChild(el('span', 'node-stars', starText(node.stars)));
        if (node.best > 0) nodeEl.appendChild(el('span', 'node-best', `最高 ${node.best}`));
      } else {
        nodeEl.appendChild(el('span', 'node-meta', node.grid));
      }
      if (node.status === 'locked') nodeEl.appendChild(el('span', 'node-lock', '🔒'));
      // 当前该打的那一关：宠物站在牌上（美术主界面结构里路径上的那只狗）
      if (node.level === currentLevel) nodeEl.appendChild(el('span', 'node-pet', '🐶'));
      // 每张地图的最后一关 = 该世界的通关奖励，挂个奖杯角标
      if (node.level === WORLDS[w]!.to) nodeEl.appendChild(el('span', 'node-trophy', '🏆'));

      nodeEl.addEventListener('click', () => {
        // pointerup 已处理过本次点击，紧随其后的 click 事件不再响应，避免重复进关
        if (tapHandled) {
          tapHandled = false;
          return;
        }
        // 刚拖动过就不算点击 —— 滚动中抬手不该把关卡点开
        if (dragMoved || flipping) return;
        selectNode(node);
      });

      nodeEls.push({ el: nodeEl, y: pos[i]!.y, hidden: false });
      track.appendChild(nodeEl);
    });

    measure();
    applyOffset();
    paintPager();
  }

  /**
   * 翻到某一关所在的那一页。
   *
   * 分页之后不再有「把它放到视口下 1/3」这种取巧 —— 一屏就是一页，页内位置由美术构图
   * 决定（石台画在哪儿，牌就落在哪儿）。所以这里只做一件事：算它落在第几页，整屏翻过去。
   */
  function focusLevel(level: number, animated: boolean): void {
    const list = worldNodes(world);
    const local = list.findIndex((n) => n.level === level);
    if (local < 0) {
      snapToPage(PAGE_COUNT - 1, animated);
      return;
    }
    snapToPage(pageOfY(nodeY(local, list.length)), animated);
  }

  /** 进入某个世界时的定位：优先当前解锁关，否则退到「最靠上的已通关关」，再退到最底一页 */
  function focusWorld(w: number, animated: boolean): void {
    const list = worldNodes(w);
    if (list.length === 0) return;
    const current = view?.currentLevel ?? 1;
    if (list.some((n) => n.level === current)) {
      focusLevel(current, animated);
      return;
    }
    let best = -1;
    list.forEach((n, i) => {
      if (n.status === 'cleared') best = i;
    });
    if (best < 0) {
      snapToPage(PAGE_COUNT - 1, animated);
      return;
    }
    snapToPage(pageOfY(nodeY(best, list.length)), animated);
  }

  /** 切地图：整张地图绕 X 轴翻滚出场，再从另一侧翻滚进场 */
  function flipTo(next: number): void {
    if (next === world || flipping || !view) return;
    flipping = true;
    const up = next > world;
    const out = up ? 'flip-out-up' : 'flip-out-down';
    const into = up ? 'flip-in-up' : 'flip-in-down';

    const onOut = (): void => {
      track.removeEventListener('animationend', onOut);
      world = next;
      buildWorld(world);
      paintChrome();
      // 先量高度再定位：新地图的高度和上一张不一定一样
      focusWorld(world, false);
      track.classList.remove(out);
      track.classList.add(into);
      const onIn = (): void => {
        track.removeEventListener('animationend', onIn);
        track.classList.remove(into);
        flipping = false;
        applyOffset();
      };
      track.addEventListener('animationend', onIn);
    };
    track.addEventListener('animationend', onOut);
    track.classList.add(out);
  }

  /** 体力只刷这两处：整屏重绘会打断滚动 */
  function tickStamina(available: number, countdown: string | null): void {
    // 顶栏只有一行位置，画满 10 颗心太挤 —— 用紧凑的「❤️ 8/10」（与玩法屏 HUD 同口径）
    heartsText.textContent = `❤️ ${available}/${staminaMax}`;
    heartsText.title = `体力 ${available}/${staminaMax}`;
    recoverEl.textContent = countdown ? HOME.staminaCountdown(countdown) : '';
    recoverEl.hidden = countdown === null;
  }

  const render = (next: MapView): void => {
    const prevLevel = view?.currentLevel;
    const prevMode = view?.modeLabel;
    const first = view === null;
    view = next;
    staminaMax = next.stamina.max;
    tickStamina(next.stamina.available, next.stamina.countdown);

    const nextWorld = worldIndexOf(next.currentLevel);
    // 首次进入 / 当前关跨到另一张地图 → 跟着走；否则留在玩家自己翻到的那张
    if (first || nextWorld !== world) world = nextWorld;

    buildWorld(world);
    paintChrome();

    const changed = first || prevLevel !== next.currentLevel || prevMode !== next.modeLabel;
    if (changed) focusWorld(world, !first);
    else applyOffset();
  };

  const enter = (): void => {
    measure();
    focusWorld(world, false);
  };

  // 键盘翻页（桌面调试 / 无障碍都方便）：↑ 上一屏 ↓ 下一屏
  window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp' || e.key === 'PageUp') {
      snapToPage(page - 1, true);
      e.preventDefault();
    } else if (e.key === 'ArrowDown' || e.key === 'PageDown') {
      snapToPage(page + 1, true);
      e.preventDefault();
    }
  });

  // 旋屏 / 改窗口大小 → 一页的高度跟着可视高度变：重新量并停回原来的页
  window.addEventListener('resize', () => {
    measure();
    snapToPage(page, false);
  });

  return { el: root, render, enter, tick: tickStamina };
}
