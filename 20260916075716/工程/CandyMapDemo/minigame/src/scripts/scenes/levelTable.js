/** 地图编辑器坐标表 —— 由 tools/convert-map-json.ts 生成，请勿手改。
 *
 * 生成：node tools/convert-map-json.ts xiaozhen.map.json guoyuan.map.json ...
 * 约定：文件名 = 世界美术名（WORLDS[].art）。为空时 MapBootstrap 回退到 ROAD_X 公式。
 */
                                                                 

/** key = WORLDS[].art；坐标为轨道坐标（1536 宽、y 从上往下），与 MapNodeData 同口径 */
export const LEVELS_BY_ART                             = {
  'xiaozhen': [
    { level: 1, x: 1259, y: 4805 },
    { level: 2, x: 928, y: 4539 },
    { level: 3, x: 811, y: 4128 },
    { level: 4, x: 1077, y: 3803 },
    { level: 5, x: 1099, y: 3381 },
    { level: 6, x: 747, y: 2992 },
    { level: 7, x: 1019, y: 2667 },
    { level: 8, x: 843, y: 2283 },
    { level: 9, x: 816, y: 1856 },
    { level: 10, x: 896, y: 1435 },
    { level: 11, x: 891, y: 1008 },
    { level: 12, x: 709, y: 624 },
  ],
};
