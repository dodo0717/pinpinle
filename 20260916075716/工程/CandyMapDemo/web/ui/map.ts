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

import { MODE_LABEL, type LevelStatus } from '../../assets/scripts/核心/index.ts';
import { HOME, MAP, TUTORIAL } from './text.ts';
import { buttonEl, el, toast } from './dom.ts';
import { closeDialog, openDialog } from './dialog.ts';

/** 单张地图上的一个关卡节点（状态来自 core，界面不自己判） */
export interface MapNode {
  level: number;
  status: LevelStatus;
  /**
   * 额外的锁原因（如「困难模式要简单模式三星」）。
   * 有值时点节点的提示用这句，而不是默认的 `MAP.locked`（先通关第 N 关）。
   */
  lockNote?: string;
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
  /** 当前模式 —— 首页上直接给「简单 / 困难」两个按钮切（两套进度各自独立） */
  mode: MapMode;
  /** 当前模式文案（简单 / 困难），与 `mode` 同源，别各写一套 */
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
  /** 切玩法模式（简单 / 困难）：两套进度各自独立，切了要换一套关卡状态 */
  onMode: (mode: MapMode) => void;
  /** 点了某个可玩关卡（已通关的也能再挑战一次） */
  onPick: (level: number) => void;
  /** 点体力：加体力分支由调用方判定 */
  onAddStamina: () => void;
  /** 点首页右侧「教学」按钮：打开新手教学（序章）抽屉 */
  onTutorial: () => void;
}

export interface MapScreen {
  el: HTMLElement;
  render: (view: MapView) => void;
  /** 进入该屏时调用：重新量视口并定位到当前解锁关（首帧隐藏时量不到高度） */
  enter: () => void;
  /** 每秒只刷体力这两处（避免整屏重绘打断滚动） */
  tick: (available: number, countdown: string | null) => void;
  /**
   * 教学入口是否显示。
   * 隐藏条件（策划案 §4.4）：**困难模式累计通关 ≥ 10 关**后入口消失 ——
   * 已经玩到那个程度的玩家不需要教学，别长期占着首页。
   */
  setTutorialVisible: (visible: boolean) => void;
}

/* ------------------------------------------------------------------ 布局常量（画布 px） */

const STAGE_W = 1536;
/**
 * 相邻关卡的纵向间距。
 * 与 PAD_TOP / PAD_BOTTOM 一起凑成轨道总高 = 2 × SEG_H = 5462：
 * 正式版《底图》每世界一整张 1080 × 3840 = 两屏 9:16，铺满整条轨道（两页）。
 * 改这三个值之前先确认：5462 = PAD_TOP + 11 × NODE_STEP + PAD_BOTTOM（每世界 12 关）。
 * ⚠️ 上下留白与 ROAD_X 路中线表是配套标定的（节点 y 定了才能对准路面），改一个就要重标另一个。
 */
/**
 * 轨道的上下留白（**默认值**，两屏长卷专用）：第 1 关不能贴着屏幕底，最后一关上方也要有落脚处。
 * ⚠️ 间距不再写死 —— 由「轨道高 − 上下留白」均分推出（见 `nodeStep`），
 *    因为小镇改成**单屏**（用动效视频当背景）后留白必须留小，否则 12 个珠子挤不下。
 */
const PAD_TOP = 755;
const PAD_BOTTOM = 472;

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

/**
 * 五张地图（糖果传奇式「世界」），每世界 12 关、共 60 关。
 * `art` = 该世界的底图文件名（web/art/map-v2/{art}.{ext}，1080×3840 两屏一张）。
 * `anim` = 该世界的**循环动效**（可选）：能播就盖在底图上，播不了自动退回底图。
 */
interface WorldDef {
  name: string;
  from: number;
  to: number;
  /** 底图文件名（**不含扩展名**，扩展名见 `ext`；同时也是 `ROAD_X` 的 key） */
  art: string;
  /** 底图扩展名：新换的小镇 v27 交付的是 jpg，其余仍是 png */
  ext: string;
  /** 循环动效视频（可选）：**盖在底图上做光影混合**（`mix-blend-mode: soft-light`，不改变底图画风） */
  anim?: string;
  /**
   * 用视频**直接当背景地图**（可选，2026-10-29 用户要求）：视频画面本身就是地图，
   * 节点/UI 浮在上面，底图退化成「视频加载失败时的兜底」（必须与该视频同构图 ——
   * 用 `ffmpeg` 从视频首帧导出的 `xiaozhen-poster.jpg`）。
   * ⚠️ 与 `anim` 互斥：`bgVideo` 优先（它是主背景，不是混合层）。
   */
  bgVideo?: string;
  /**
   * 背景内容的**高宽比**（高 ÷ 宽）。轨道总高 = `STAGE_W × aspect`，这样底图/视频
   * 铺上去永远是等比、不变形不裁切。默认 3840/1080（两屏长卷）。
   */
  aspect?: number;
  /** 该世界的上下留白（不写 = 用 PAD_TOP / PAD_BOTTOM）。单屏世界必须写小，否则 12 关挤不下 */
  padTop?: number;
  padBottom?: number;
}

/**
 * 15 张地图（糖果传奇式「世界」），每世界 12 关、共 **180 关**（2026-10-29 扩充，原 5 世界 60 关）。
 *
 * 底图全部来自 `美术/场景图/`（15 张 1080×3840 jpg，每世界一张，**不重复**），
 * 导入时把中文文件名改成了英文 key（中文文件名在 URL 里要编码，容易踩坑），
 * 对应关系见 `web/UI_README.md` §32。旧底图整体备份在 `web/art/map-v2_backup_20261029/`。
 *
 * 世界顺序：前 5 个沿用原主题（小镇 / 果园 / 雪地→滑雪场 / 沙滩→海岸线 / 花园→花海山丘），
 * 之后按「自然 → 幻想」递进。
 */
const WORLDS: readonly WorldDef[] = [
  { name: '小镇', from: 1, to: 12, art: 'town', ext: 'jpg' },
  { name: '果园', from: 13, to: 24, art: 'orchard', ext: 'jpg' },
  { name: '滑雪场', from: 25, to: 36, art: 'ski', ext: 'jpg' },
  { name: '海岸线', from: 37, to: 48, art: 'coast', ext: 'jpg' },
  { name: '花海山丘', from: 49, to: 60, art: 'flowerhill', ext: 'jpg' },
  { name: '冰原', from: 61, to: 72, art: 'icefield', ext: 'jpg' },
  { name: '山谷', from: 73, to: 84, art: 'valley', ext: 'jpg' },
  { name: '草原', from: 85, to: 96, art: 'grassland', ext: 'jpg' },
  { name: '农场', from: 97, to: 108, art: 'farm', ext: 'jpg' },
  { name: '蘑菇森林', from: 109, to: 120, art: 'mushroom', ext: 'jpg' },
  { name: '高山云端', from: 121, to: 132, art: 'cloudpeak', ext: 'jpg' },
  { name: '沙漠', from: 133, to: 144, art: 'desert', ext: 'jpg' },
  { name: '城堡童话', from: 145, to: 156, art: 'castle', ext: 'jpg' },
  { name: '糖果王国', from: 157, to: 168, art: 'candy', ext: 'jpg' },
  { name: '星空城堡', from: 169, to: 180, art: 'starcastle', ext: 'jpg' },
];

/** 关卡号 → 地图下标（越界兜底到首/末张，避免素材缺关时崩掉） */
function worldIndexOf(level: number): number {
  const idx = Math.floor((Math.max(1, level) - 1) / 12);
  return Math.max(0, Math.min(WORLDS.length - 1, idx));
}

/**
 * 每张底图的小路中线：归一化 x（0 = 图最左，1 = 最右），
 * **从上到下 12 个点，与该世界的 12 个关卡一一对应**（第 1 个点 = 第 12 关，
 * 最下面那个点 = 第 1 关）。节点就压在这些点上 —— 「读图放路中间」。
 * 数值按底图人工标定；换底图时改这张表即可，不用动布局公式。
 */
const ROAD_X: Record<string, readonly number[]> = {
  /**
   * 小镇（**唯一经过像素验证的一张**）：2026-10-29 用**路网追踪**标定 ——
   * 从画面顶端最宽的路面段起，逐行跟着「离上一行最近的路面段」往下走，再做平滑校验。
   * **12/12 个点经像素验证确实在路面上**（中心 + 左右各 20px 都是路面色），
   * 且相邻点连线中点离最近路面 ≤123px（没有「断路」）。
   * ⚠️ 新交付的 `town.jpg` 与旧 `xiaozhen.jpg` **MD5 一致（同一张图）**，所以这张表直接沿用。
   */
  town: [0.487, 0.495, 0.573, 0.537, 0.589, 0.587, 0.405, 0.687, 0.619, 0.454, 0.716, 0.874],
  /**
   * ⚠️ 以下 14 张是**居中蜿蜒曲线的兜底值，不是实测路中线** —— 需要人工目视校正。
   *
   * 为什么没测出来：自动标定试了两套办法都失败（详见 UI_README §32）：
   *   ① 颜色判定（暖色=土路）→ 在这 14 张图上把整片地面/雪地/沙地都算成了路
   *      （行内路面占比 61%~98%，冰原 95%、高山云端 98%），且「在路上 12/12」是用
   *      同一套判定自证的，没有意义；
   *   ② 边缘对跟踪（找路的两条边界）→ 大量结果被夹到画面边缘（0.08 / 0.92）、
   *      相邻节点横向跳变最高 0.74，明显跟错了目标。
   * 根因：**我看不到图**，而这些场景的路面材质（雪 / 沙 / 草地 / 奇幻地面）各不相同，
   * 没有一套颜色规则能通用。
   *
   * → 现在的取值是「居中 + 正弦蜿蜒」（幅度 0.16~0.26、相位按世界错开、夹在 16%~84%），
   *   保证节点**连续、居中、不贴边、不压到画面外**，但**不保证压在真实路面上**。
   * 校正方法：打开游戏挨个世界看一眼，或直接在图上点出正确的路中线给我，我按值改这张表
   *   （表里一行就是 12 个数，改完即生效，不用动任何布局公式）。
   */
  'orchard': [0.5, 0.58, 0.638, 0.66, 0.64, 0.582, 0.503, 0.424, 0.364, 0.34, 0.359, 0.415],
  'ski': [0.706, 0.699, 0.64, 0.544, 0.436, 0.345, 0.295, 0.299, 0.356, 0.451, 0.559, 0.652],
  'coast': [0.602, 0.469, 0.345, 0.262, 0.242, 0.29, 0.393, 0.525, 0.65, 0.736, 0.759, 0.714],
  'flowerhill': [0.348, 0.316, 0.332, 0.394, 0.483, 0.577, 0.65, 0.684, 0.669, 0.61, 0.521, 0.427],
  'icefield': [0.331, 0.434, 0.555, 0.661, 0.725, 0.729, 0.673, 0.571, 0.45, 0.342, 0.277, 0.27],
  'valley': [0.586, 0.642, 0.66, 0.636, 0.576, 0.496, 0.417, 0.36, 0.34, 0.362, 0.421, 0.501],
  'grassland': [0.696, 0.633, 0.534, 0.427, 0.339, 0.293, 0.302, 0.364, 0.461, 0.569, 0.658, 0.706],
  'farm': [0.457, 0.335, 0.257, 0.243, 0.297, 0.404, 0.537, 0.66, 0.741, 0.758, 0.707, 0.601],
  'mushroom': [0.315, 0.336, 0.401, 0.491, 0.584, 0.655, 0.685, 0.666, 0.603, 0.513, 0.419, 0.347],
  'cloudpeak': [0.445, 0.566, 0.669, 0.728, 0.726, 0.665, 0.56, 0.439, 0.334, 0.273, 0.272, 0.331],
  'desert': [0.645, 0.659, 0.632, 0.569, 0.488, 0.411, 0.357, 0.34, 0.366, 0.428, 0.508, 0.586],
  'castle': [0.625, 0.525, 0.418, 0.333, 0.292, 0.306, 0.371, 0.471, 0.578, 0.665, 0.708, 0.696],
  'candy': [0.326, 0.253, 0.245, 0.305, 0.416, 0.549, 0.67, 0.745, 0.756, 0.699, 0.589, 0.456],
  'starcastle': [0.34, 0.408, 0.5, 0.592, 0.66, 0.685, 0.661, 0.595, 0.504, 0.411, 0.342, 0.315],
};

/** 节点横坐标：查该世界底图的小路中线表（local 0 = 第 1 关 = 表里最下面的点） */
function nodeX(local: number, world: number): number {
  const road = ROAD_X[WORLDS[world]!.art] ?? ROAD_X.xiaozhen!;
  const frac = road[road.length - 1 - local] ?? 0.5;
  return frac * STAGE_W;
}

/** 某世界的轨道总高：由背景内容的比例决定（1536 × 高/宽），保证底图/视频铺上去等比不变形 */
function trackHeight(world: number): number {
  return Math.round(STAGE_W * (WORLDS[world]!.aspect ?? 3840 / 1080));
}

/** 该世界的上下留白 */
function pads(world: number): { top: number; bottom: number } {
  return { top: WORLDS[world]!.padTop ?? PAD_TOP, bottom: WORLDS[world]!.padBottom ?? PAD_BOTTOM };
}

/**
 * 节点间距：由「轨道高 − 上下留白」均分推出（不再写死 NODE_STEP）。
 * 两屏世界算出来 ≈ 385（与原值一致），单屏小镇 ≈ 221。
 */
function nodeStep(world: number, count: number): number {
  const { top, bottom } = pads(world);
  return (trackHeight(world) - top - bottom) / Math.max(1, count - 1);
}

/** 节点纵坐标：`local` 0 是第 1 关 —— y 越大越靠下，所以第 1 关在最底部，往上推进 */
function nodeY(local: number, count: number, world: number): number {
  return pads(world).top + (count - 1 - local) * nodeStep(world, count);
}

/** 该世界的页数：一页 = 一屏（PAGE_H）。两屏世界 = 2 页，单屏小镇 = 1 页（不翻页） */
function pageCount(world: number): number {
  return Math.max(1, Math.round(trackHeight(world) / PAGE_H));
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

/**
 * 美术底图：每个世界一整张 1080 × 3840 = 两屏 9:16（xiaozhen/guoyuan/xuedi/shatan/huayuan），
 * 等比铺到轨道上（轨道 1536 宽 → 高 5462）正好是两页。
 */
const MAP_ART_DIR = '/web/art/map-v2';
/** 单页底图高度：两段 2731 + 2731，拼起来正好 = track 的 5462 */
const SEG_H = 2731;
/** 一页 = 一屏：整屏翻页的最小单位（也是吸附的步长） */
const PAGE_H = SEG_H;
/** 一条轨道的页数 = 2（底图就是两屏） */
/**
 * ⚠️ 页数**不再是常量**：小镇改成单屏（用视频当背景）后只有 1 页，其余世界仍是 2 页。
 * 用 `pageCount(world)` 取（按轨道高 ÷ 页高算）。这里保留常量只是为了兼容旧注释里的说法。
 */
const PAGE_COUNT = 2;
/** 页名（仅用于翻页圆点的 title） */
const SEG_NAMES = ['top', 'bottom'] as const;

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

  /* ---- 顶栏：左 = 返回圆钮（装饰）+ 木牌（头像 + 昵称），右 = 体力胶囊 ❤ N ＋ ---- */
  const top = el('div', 'home-top');

  // 正式版（设计稿《首页》）：左上是一组「返回圆钮 + 木牌」，木牌里放头像与昵称
  const homeLeft = el('div', 'home-left');
  const backBtn = el('span', 'home-back');
  backBtn.setAttribute('aria-hidden', 'true');
  homeLeft.appendChild(backBtn);

  const userBox = el('div', 'home-user');
  const avatarEl = el('span', 'home-avatar', HOME.avatar);
  const nickEl = el('span', 'home-nick', HOME.nickname);
  userBox.appendChild(avatarEl);
  userBox.appendChild(nickEl);
  homeLeft.appendChild(userBox);
  top.appendChild(homeLeft);

  // 体力整块是一个按钮：点它 = 加体力（原来的「＋」并进来了，顶栏只留一个元素）
  const staminaBox = el('button', 'home-stamina');
  staminaBox.type = 'button';
  staminaBox.title = HOME.addStaminaTip;
  // 正式版：红心是切图，数字单独一个大号白字
  staminaBox.appendChild(el('span', 'home-heart'));
  const heartsText = el('span', 'hearts-text');
  staminaBox.appendChild(heartsText);
  const recoverEl = el('span', 'home-recover');
  staminaBox.appendChild(recoverEl);
  // 设计图里的绿色「＋」：加体力入口（点整块体力胶囊都触发加体力）
  staminaBox.appendChild(el('span', 'home-plus'));
  staminaBox.addEventListener('click', () => handlers.onAddStamina());
  /* ---- 右上角：一列（上 = 体力胶囊，下 = 教学入口） ----
     ⚠️ 用户要求（2026-10-26）：**教学图标放在体力下方**，所以右侧整体是一个纵向容器，
     不再把教学按钮并排塞在顶栏行里（那会挤掉体力胶囊、也压到地图）。 */
  const homeRight = el('div', 'home-right');
  homeRight.appendChild(staminaBox);
  /* ---- 教学入口：**体力下方**（新手教学 · 序章，2026-10-26）----
     默认隐藏，由 `main.ts` 按「困难模式累计通关 < 10 关」决定是否显示。 */
  const tutorialBtn = el('button', 'home-tutorial');
  tutorialBtn.type = 'button';
  tutorialBtn.hidden = true;
  tutorialBtn.title = TUTORIAL.drawerTitle;
  tutorialBtn.appendChild(el('span', 'home-tutorial-icon', '❓'));
  tutorialBtn.appendChild(el('span', 'home-tutorial-text', TUTORIAL.entry));
  tutorialBtn.addEventListener('click', () => handlers.onTutorial());
  homeRight.appendChild(tutorialBtn);
  top.appendChild(homeRight);
  root.appendChild(top);

  /* ---- 世界切换：左右两侧各一颗大箭头（不挂标题行，设计上要显眼） ---- */
  // `flipTo` 内部会做越界钳制；这里额外在两端禁用按钮，避免点出边界
  const navPrev = buttonEl('‹', 'map-world-nav nav-left', () => flipTo(world - 1));
  const navNext = buttonEl('›', 'map-world-nav nav-right', () => flipTo(world + 1));
  navPrev.title = '上一张地图';
  navNext.title = '下一张地图';
  root.appendChild(navPrev);
  root.appendChild(navNext);

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
    return clamp(Math.round(-v / pageSpan), 0, Math.max(0, pageCount(world) - 1));
  }

  /** 某个轨道坐标落在第几页（底图坐标：一段 = 一页 = 1920） */
  function pageOfY(y: number): number {
    return clamp(Math.floor(y / PAGE_H), 0, Math.max(0, pageCount(world) - 1));
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
    page = clamp(p, 0, Math.max(0, pageCount(world) - 1));
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

  /** 页码点与箭头：到头就置灰。⚠️ 单屏世界（小镇）只有 1 页 —— 多余的点要藏掉 */
  function paintPager(): void {
    const pc = pageCount(world);
    dotEls.forEach((dot, i) => {
      dot.classList.toggle('on', i === page);
      dot.style.display = i < pc ? '' : 'none';
    });
    pageUp.disabled = page <= 0;
    pageDown.disabled = page >= pc - 1;
    // 单屏世界没有"翻页"这回事，整列控件藏掉（否则两个灰箭头摆在那儿像坏了）
    pager.style.display = pc > 1 ? '' : 'none';
  }

  function worldNodes(w: number): MapNode[] {
    const { from, to } = WORLDS[w]!;
    return (view?.nodes ?? []).filter((n) => n.level >= from && n.level <= to);
  }

  /** 选中某个关卡：锁定的给提示，可玩的交给主控制器 */
  function selectNode(node: MapNode): void {
    if (flipping) return;
    if (node.status === 'locked') {
      toast(node.lockNote ?? MAP.locked(Math.max(1, node.level - 1)), 1800);
      return;
    }
    handlers.onPick(node.level);
  }

  /**
   * 顶栏与主题色（原「世界名 · 进度」标题行与难度按钮已按设计去掉，这里只留主题色与箭头置灰）。
   */
  function paintChrome(): void {
    nickEl.textContent = view?.profile.nickname ?? HOME.nickname;
    avatarEl.textContent = view?.profile.avatar ?? HOME.avatar;
    // 世界主题色：五张地图各一套天空渐变（见 ui.css 的 .map.world-N）
    root.classList.remove('world-0', 'world-1', 'world-2', 'world-3', 'world-4');
    root.classList.add(`world-${world}`);
    // 世界切页箭头到头置灰
    navPrev.disabled = world <= 0;
    navNext.disabled = world >= WORLDS.length - 1;
  }

  function buildWorld(w: number): void {
    const list = worldNodes(w);
    const h = trackHeight(w);
    track.style.height = `${h}px`;
    track.replaceChildren();
    nodeEls.length = 0;

    /* 美术底图：该世界一整张（1080×3840 = 两屏），从头铺到尾盖满整条轨道。
       节点坐标与底图共用同一套坐标系（横坐标查 ROAD_X 路中线表），缺图时
       这层是透明的，自动退回 CSS 天空渐变。 */
    const bg = el('div', 'map-bg');
    const layer = el('div', 'map-bg-seg');
    layer.style.top = '0px';
    layer.style.height = `${h}px`;
    layer.style.backgroundImage = `url("${MAP_ART_DIR}/${WORLDS[w]!.art}.${WORLDS[w]!.ext}")`;
    bg.appendChild(layer);

    /* 视频**直接当背景地图**（小镇，2026-10-29 用户要求）：视频画面本身就是地图，
       节点与 UI 浮在上面。三重保障：
         1. 底图用的是 `xiaozhen-poster.jpg` = **视频首帧**（ffmpeg 导出），所以视频没加载、
            播不了、被 error 移除时，画面构图与节点位置**依然完全正确**；
         2. 视频比例 720×1280 = 9:16，单屏轨道 1536×2731 也是 9:16 → `object-fit: fill`
            在这里就是等比铺满，**不变形、不裁切**（这也是小镇敢改单屏的前提）；
         3. `playing` 才淡入，避免解码慢时黑帧闪一下。 */
    const bgVideoSrc = WORLDS[w]!.bgVideo;
    if (bgVideoSrc) {
      const v = el('video', 'map-bg-video') as HTMLVideoElement;
      v.src = `${MAP_ART_DIR}/${bgVideoSrc}`;
      v.muted = true;
      v.loop = true;
      v.autoplay = true;
      v.setAttribute('playsinline', '');
      v.preload = 'auto';
      v.addEventListener('error', () => v.remove());
      v.addEventListener('playing', () => {
        v.style.opacity = '1';
      });
      bg.appendChild(v);
    }

    /* 循环动效层（可选）：底图上叠一条会动的视频（炊烟/云影/飘动物）。
       ⚠️ 三重兜底，保证「播不了 = 等于没这层」，绝不让视频层把地图搞挂：
         1. `error` 事件 → 整层移除，露出底下的 jpg；
         2. 3 秒内没解出首帧（readyState < 2）→ 同样移除（canPlayType 会误报
            "probably"，比如无 HEVC 硬解的 Chrome —— 只能靠真解一遍验证）；
         3. 解码成功但还没开播前 opacity=0，避免黑帧闪一下。 */
    const animSrc = WORLDS[w]!.anim;
    if (animSrc) {
      const video = el('video', 'map-bg-anim') as HTMLVideoElement;
      video.src = `${MAP_ART_DIR}/${animSrc}`;
      video.muted = true;
      video.loop = true;
      video.autoplay = true;
      video.setAttribute('playsinline', '');
      video.preload = 'auto';
      video.addEventListener('error', () => video.remove());
      video.addEventListener('playing', () => {
        // 不是 1：这一层是 soft-light 光影叠加，全强度会把画面压脏（强度在 CSS 里调）
        video.style.opacity = '0.5';
      });
      window.setTimeout(() => {
        if (video.isConnected && video.readyState < 2) video.remove();
      }, 3000);
      bg.appendChild(video);
    }

    /* 程序化动效（2026-10-29，零素材）：目前只有小镇有 —— 云影 / 樱花瓣 /
       喷泉水花 / 水面波光 / 光尘，全部 canvas 粒子（见 map-fx.ts 顶部说明）。
       AI 整张动效视频与底图构图对不上（帧差验证过），所以不用视频、也不返工等素材。 */
    /* ⚠️ 程序化动效（map-fx.ts）**当前停用**（2026-10-29 用户要求"动画先放着"）：
       等美术的新动效视频到位再一起上。接回只需两行：
         import { mountTownFx, type MapFx } from './map-fx.ts';
         if (w === 0) townFx = mountTownFx(bg, { located: true, height: h });
       （还要把 `let townFx: MapFx | null = null;` 和 buildWorld 开头的 destroy 块加回来，
         否则切世界重建 DOM 时旧的 rAF 循环会空转泄漏 —— 见 map-fx.ts 与 UI_README §29。） */
    track.appendChild(bg);

    const pos = list.map((_, i) => ({ x: nodeX(i, w), y: nodeY(i, list.length, w) }));

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
      // 果冻珠切图三态：蓝白 todo = 待完成/锁定；粉 star1 = 1~2 星；金 star3（冠+星在图里）= 3 星
      const cls = ['node', node.status];
      if (node.level === currentLevel) cls.push('current');
      if (node.status === 'cleared') cls.push(node.stars >= 3 ? 'n-s3' : 'n-s1');
      const nodeEl = el('div', cls.join(' '));
      nodeEl.style.left = `${pos[i]!.x}px`;
      nodeEl.style.top = `${pos[i]!.y}px`;
      nodeEl.dataset.level = String(node.level);
      // 透视参数：CSS 里按这三个变量把牌压成跟美术石台同一形状的椭圆
      const shape = stoneShape(i, list.length, w);
      nodeEl.style.setProperty('--pw', `${shape.w.toFixed(1)}px`);
      nodeEl.style.setProperty('--ph', `${shape.h.toFixed(1)}px`);
      nodeEl.style.setProperty('--prot', `${shape.rot.toFixed(2)}deg`);

      // ① 原图切图层（提纯提亮的 filter 只加在这层，不波及数字/锁/宠物）
      // ② 果冻质感层（白色高光 + 中性暗角 + 珠外光环），样式在 ui.css .map .node-gel。
      // 两层都必须插在数字/锁/宠物之前：它们是后来者，DOM 顺序保证叠在上层。
      nodeEl.appendChild(el('span', 'node-art'));
      nodeEl.appendChild(el('span', 'node-gel'));
      // 珠面上只放关卡数字（星星/皇冠都画在切图里）；锁珠不显示数字（🔒 挂珠心，别让数字从锁后露边）
      if (node.status !== 'locked') nodeEl.appendChild(el('span', 'node-num', String(node.level)));
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
      snapToPage(pageCount(world) - 1, animated);
      return;
    }
    snapToPage(pageOfY(nodeY(local, list.length, world)), animated);
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
      snapToPage(pageCount(world) - 1, animated);
      return;
    }
    snapToPage(pageOfY(nodeY(best, list.length, world)), animated);
  }

  /** 切地图：整张地图绕 X 轴翻滚出场，再从另一侧翻滚进场 */
  function flipTo(next: number): void {
    const last = WORLDS.length - 1;
    const target = clamp(next, 0, last);
    if (target === world || flipping || !view) return;
    flipping = true;
    const up = target > world;
    const out = up ? 'flip-out-up' : 'flip-out-down';
    const into = up ? 'flip-in-up' : 'flip-in-down';

    const onOut = (): void => {
      track.removeEventListener('animationend', onOut);
      world = target;
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
    heartsText.textContent = String(available);
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

  return {
    el: root,
    render,
    enter,
    tick: tickStamina,
    setTutorialVisible(visible: boolean): void {
      tutorialBtn.hidden = !visible;
    },
  };
}
