/**
 * 地图编辑器 .map.json → 游戏坐标表（萌宠拼拼乐 · 试点链路）
 *
 * 用法：
 *   node tools/convert-map-json.ts <地图1.map.json> [地图2.map.json ...]
 *
 * 约定：
 * - 文件名（去扩展名）= 世界美术名（WORLDS[].art）：`xiaozhen.map.json` → 'xiaozhen'。
 *   一次传当前全部已导出的地图，每次全量重新生成 `assets/scripts/场景/levelTable.ts`。
 * - 只认「关卡节点」组件（props.level 存在）；中心点取 `x+w/2, y+h/2`（缩放围绕中心，不影响中心）。
 * - 坐标换算：编辑器格子坐标 ×(TRACK_W/widthPx) = 轨道坐标。推导链：
 *   编辑器 → 底图像素 ×(artW/widthPx)（底图铺满地图宽、地图长度随底图）→
 *   底图 → 轨道 ×(TRACK_W/artW)（bg 贴图把底图均匀铺满 1536×5462 轨道）。
 *   两步相乘 = TRACK_W/widthPx，与底图实际宽度无关（换底图不用改这里）。
 *
 * 坐标表为空时（还没有编辑器导出的地图），MapBootstrap 回退到 ROAD_X 公式，
 * 行为与之前完全一致 —— 编辑器是渐进替换，不是硬切换。
 *
 * 编辑器用法见糖果小镇仓库 `universal-map-editor/docs/地图编辑器-操作手册.md`；
 * 免安装版：`universal-map-editor/release/地图编辑器.html` 双击即用。
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_PATH = join(ROOT, 'assets', 'scripts', '场景', 'levelTable.ts');

/** 轨道宽（web 口径，与 MapBootstrap.TRACK_W 一致；场景常量是私有的，这里按事实重复一份） */
const TRACK_W = 1536;

export interface LevelPos {
  level: number;
  x: number;
  y: number;
}

interface MapComponent {
  x: number;
  y: number;
  w: number;
  h: number;
  scale?: number;
  props?: { level?: number; [k: string]: unknown };
}

export interface MapJson {
  name?: string;
  widthPx?: number;
  heightPx?: number;
  components?: MapComponent[];
}

/**
 * 从一张 .map.json 里抽出关卡节点（轨道坐标，y 从上往下，与 MapNodeData 同口径）。
 * 导出成纯函数供单测使用。
 */
export function extractLevels(map: MapJson): { levels: LevelPos[]; warnings: string[] } {
  const warnings: string[] = [];
  const widthPx = map.widthPx ?? 0;
  if (widthPx <= 0) {
    warnings.push('地图缺 widthPx，无法换算坐标');
    return { levels: [], warnings };
  }
  const k = TRACK_W / widthPx;
  const levels = (map.components ?? [])
    .filter((c) => c.props && typeof c.props.level === 'number')
    .map((c) => ({
      level: c.props!.level as number,
      // 中心 = 左上 + 半宽（scale 围绕中心缩放，不影响中心点）
      x: Math.round((c.x + c.w / 2) * k),
      y: Math.round((c.y + c.h / 2) * k),
    }))
    .sort((a, b) => a.level - b.level);

  const nums = levels.map((l) => l.level);
  const dup = nums.filter((n, i) => nums.indexOf(n) !== i);
  if (dup.length) warnings.push(`关号重复：${[...new Set(dup)].join(', ')}`);
  const gaps = nums.filter((n, i) => i > 0 && n !== nums[i - 1] + 1);
  if (gaps.length) warnings.push(`关号不连续（跳到 ${gaps.join(', ')}）`);
  return { levels, warnings };
}

/** 生成 levelTable.ts 的完整内容（art → 关卡坐标表） */
export function renderTable(artMaps: Record<string, LevelPos[]>): string {
  const entries = Object.keys(artMaps).sort();
  const body = entries
    .map((art) => {
      const rows = artMaps[art]
        .map((l) => `    { level: ${l.level}, x: ${l.x}, y: ${l.y} },`)
        .join('\n');
      return `  '${art}': [\n${rows}\n  ],`;
    })
    .join('\n');
  return `/** 地图编辑器坐标表 —— 由 tools/convert-map-json.ts 生成，请勿手改。
 *
 * 生成：node tools/convert-map-json.ts xiaozhen.map.json guoyuan.map.json ...
 * 约定：文件名 = 世界美术名（WORLDS[].art）。为空时 MapBootstrap 回退到 ROAD_X 公式。
 */
export interface LevelPos { level: number; x: number; y: number }

/** key = WORLDS[].art；坐标为轨道坐标（1536 宽、y 从上往下），与 MapNodeData 同口径 */
export const LEVELS_BY_ART: Record<string, LevelPos[]> = {${
    entries.length ? '\n' + body + '\n' : ''
  }};
`;
}

/* ---------------------------------------------------------------- 命令行入口 */

/** 只在「直接运行」时走 CLI（被测试 import 时不能执行下面的 process.exit） */
function isMain(): boolean {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try {
    return import.meta.url === pathToFileURL(resolve(argv1)).href;
  } catch {
    return false;
  }
}

if (isMain()) {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log('用法：node tools/convert-map-json.ts <地图.map.json> [...更多地图]');
    console.log('示例：node tools/convert-map-json.ts ~/Downloads/xiaozhen.map.json');
    process.exit(0);
  }

  const artMaps: Record<string, LevelPos[]> = {};
  let warned = 0;
  for (const arg of args) {
    const file = resolve(arg);
    const art = basename(file).replace(/\.map\.json$/i, '').replace(/\.json$/i, '');
    const map = JSON.parse(readFileSync(file, 'utf8')) as MapJson;
    const { levels, warnings } = extractLevels(map);
    warnings.forEach((w) => { warned++; console.warn(`[${art}] ${w}`); });
    if (levels.length === 0) {
      warned++;
      console.warn(`[${art}] 没有关卡节点（props.level），跳过`);
      continue;
    }
    artMaps[art] = levels;
    console.log(`${art}: ${levels.length} 关（${levels[0]!.level}~${levels[levels.length - 1]!.level}）`);
  }

  writeFileSync(OUT_PATH, renderTable(artMaps));
  console.log(`已写入 ${OUT_PATH}`);
  if (warned) console.log(`注意：${warned} 条警告，检查上面的输出`);
};
