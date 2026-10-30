/**
 * 世界（地图）数据层 —— 15 个世界 × 12 关 = **180 关**（从 `web/ui/map.ts` 移植，2026-10-30）
 *
 * ⚠️ 为什么单独一个文件：`MapBootstrap` 已经 800 多行了，世界表 + 路中线塞进去只会更看不清。
 * 数据与换算全在这里，地图脚本只管按结果摆节点 —— 换底图/改路中线只动这一张表。
 *
 * 坐标口径（与 Web 版一致，只是把归一化值换算成 Cocos 的设计像素）：
 *   - 底图固定 1080 × 3840（两屏长卷），`DESIGN_W = 1080`；
 *   - `ROAD_X` 是**归一化 x**（0 = 图最左，1 = 最右），**从上到下 12 个点与该世界 12 关一一对应**：
 *     表里**第 1 个点 = 第 12 关（最上）**，**最后 1 个点 = 第 1 关（最下）**；
 *   - y 由「轨道高 − 上下留白」均分推出（不再写死步长），再翻成「距底」坐标；
 *   - 换算结果就是节点压在路面上的位置 —— 「读图放路中间」。
 *
 * ⚠️ 已知未标定项（与 Web 版同）：只有 **town 是像素验证过的**（12/12 点确实在路面上）；
 * 其余 14 张是「居中 + 正弦蜿蜒」的兜底值 —— 保证连续、居中、不贴边，**但不保证压在真实路面上**。
 * 校正方法：在真机/编辑器里挨个世界看一眼，把正确的路中线按值填回 `ROAD_X`（一行 12 个数，改完即生效）。
 */

/** 每世界底图尺寸（与 assets/resources/map/ 下的 jpg 一致） */
export const MAP_W = 1080;
export const MAP_H = 3840;
/** 每世界关卡数 */
export const LEVELS_PER_WORLD = 12;
/** 底图上下留白（关卡节点不压到图边缘） */
export const PAD_TOP = 560;
export const PAD_BOTTOM = 340;

export interface WorldDef {
  name: string;
  /** 该世界首关 / 末关（1 基，闭区间） */
  from: number;
  to: number;
  /** 底图资源名（assets/resources/map/ 下，不含扩展名） */
  art: string;
}

/**
 * 15 张地图（糖果传奇式「世界」），每世界 12 关、共 180 关。
 * 世界顺序：前 5 个是小镇 / 果园 / 滑雪场 / 海岸线 / 花海山丘，之后按「自然 → 幻想」递进。
 */
export const WORLDS: readonly WorldDef[] = [
  { name: '小镇', from: 1, to: 12, art: 'town' },
  { name: '果园', from: 13, to: 24, art: 'orchard' },
  { name: '滑雪场', from: 25, to: 36, art: 'ski' },
  { name: '海岸线', from: 37, to: 48, art: 'coast' },
  { name: '花海山丘', from: 49, to: 60, art: 'flowerhill' },
  { name: '冰原', from: 61, to: 72, art: 'icefield' },
  { name: '山谷', from: 73, to: 84, art: 'valley' },
  { name: '草原', from: 85, to: 96, art: 'grassland' },
  { name: '农场', from: 97, to: 108, art: 'farm' },
  { name: '蘑菇森林', from: 109, to: 120, art: 'mushroom' },
  { name: '高山云端', from: 121, to: 132, art: 'cloudpeak' },
  { name: '沙漠', from: 133, to: 144, art: 'desert' },
  { name: '城堡童话', from: 145, to: 156, art: 'castle' },
  { name: '糖果王国', from: 157, to: 168, art: 'candy' },
  { name: '星空城堡', from: 169, to: 180, art: 'starcastle' },
];

/**
 * 每张底图的小路中线（归一化 x）。**从上到下 12 个点 = 该世界第 12 关 → 第 1 关**。
 * town 是像素验证过的；其余 14 张为兜底蜿蜒值，需人工目视校正（详见文件头说明）。
 */
const ROAD_X: Record<string, readonly number[]> = {
  town: [0.487, 0.495, 0.573, 0.537, 0.589, 0.587, 0.405, 0.687, 0.619, 0.454, 0.716, 0.874],
  orchard: [0.5, 0.58, 0.638, 0.66, 0.64, 0.582, 0.503, 0.424, 0.364, 0.34, 0.359, 0.415],
  ski: [0.706, 0.699, 0.64, 0.544, 0.436, 0.345, 0.295, 0.299, 0.356, 0.451, 0.559, 0.652],
  coast: [0.602, 0.469, 0.345, 0.262, 0.242, 0.29, 0.393, 0.525, 0.65, 0.736, 0.759, 0.714],
  flowerhill: [0.348, 0.316, 0.332, 0.394, 0.483, 0.577, 0.65, 0.684, 0.669, 0.61, 0.521, 0.427],
  icefield: [0.331, 0.434, 0.555, 0.661, 0.725, 0.729, 0.673, 0.571, 0.45, 0.342, 0.277, 0.27],
  valley: [0.586, 0.642, 0.66, 0.636, 0.576, 0.496, 0.417, 0.36, 0.34, 0.362, 0.421, 0.501],
  grassland: [0.696, 0.633, 0.534, 0.427, 0.339, 0.293, 0.302, 0.364, 0.461, 0.569, 0.658, 0.706],
  farm: [0.457, 0.335, 0.257, 0.243, 0.297, 0.404, 0.537, 0.66, 0.741, 0.758, 0.707, 0.601],
  mushroom: [0.315, 0.336, 0.401, 0.491, 0.584, 0.655, 0.685, 0.666, 0.603, 0.513, 0.419, 0.347],
  cloudpeak: [0.445, 0.566, 0.669, 0.728, 0.726, 0.665, 0.56, 0.439, 0.334, 0.273, 0.272, 0.331],
  desert: [0.645, 0.659, 0.632, 0.569, 0.488, 0.411, 0.357, 0.34, 0.366, 0.428, 0.508, 0.586],
  castle: [0.625, 0.525, 0.418, 0.333, 0.292, 0.306, 0.371, 0.471, 0.578, 0.665, 0.708, 0.696],
  candy: [0.326, 0.253, 0.245, 0.305, 0.416, 0.549, 0.67, 0.745, 0.756, 0.699, 0.589, 0.456],
  starcastle: [0.34, 0.408, 0.5, 0.592, 0.66, 0.685, 0.661, 0.595, 0.504, 0.411, 0.342, 0.315],
};

/** 关卡号 → 世界下标（越界兜底到首/末，避免缺素材时崩掉） */
export function worldIndexOf(level: number): number {
  const idx = Math.floor((Math.max(1, level) - 1) / LEVELS_PER_WORLD);
  return Math.max(0, Math.min(WORLDS.length - 1, idx));
}

/** 世界下标 → 底图资源路径（assets/resources 下，不含扩展名；命名 `w序号_主题`） */
export function worldArtPath(worldIndex: number): string {
  const i = Math.max(0, Math.min(WORLDS.length - 1, worldIndex));
  return `map/w${i + 1}_${WORLDS[i]!.art}`;
}

/** 某关卡在所属世界内的序号（0 = 该世界第 1 关 = 最下面那个点） */
export function localIndexOf(level: number): number {
  const w = worldIndexOf(level);
  const from = WORLDS[w]!.from;
  return Math.max(0, Math.min(LEVELS_PER_WORLD - 1, level - from));
}

/** 节点纵向步长：由「轨道高 − 上下留白」均分推出 */
function nodeStep(count: number): number {
  return (MAP_H - PAD_TOP - PAD_BOTTOM) / Math.max(1, count - 1);
}

/**
 * 关卡节点坐标：节点压在该世界底图的小路中线上。
 * 返回 `yFromBottom`（距底图底部的像素）—— 与地图脚本里「y 越大越靠上」的口径一致。
 */
export function roadPoint(level: number): { x: number; yFromBottom: number } {
  const w = worldIndexOf(level);
  const art = WORLDS[w]!.art;
  const road = ROAD_X[art] ?? ROAD_X.town!;
  const local = localIndexOf(level);
  // 表里第 1 个点 = 第 12 关（最上），所以从末尾往前取
  const frac = road[road.length - 1 - local] ?? 0.5;
  const yDoc = PAD_TOP + (LEVELS_PER_WORLD - 1 - local) * nodeStep(LEVELS_PER_WORLD);
  return { x: Math.round(frac * MAP_W), yFromBottom: Math.round(MAP_H - yDoc) };
}

/** 该世界的关卡号列表（1 基） */
export function levelsOfWorld(worldIndex: number): number[] {
  const w = WORLDS[Math.max(0, Math.min(WORLDS.length - 1, worldIndex))]!;
  const out: number[] = [];
  for (let lv = w.from; lv <= w.to; lv++) out.push(lv);
  return out;
}
