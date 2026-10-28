/** 地图编辑器坐标表 —— 由 tools/convert-map-json.ts 生成，请勿手改。
 *
 * 生成：node tools/convert-map-json.ts xiaozhen.map.json guoyuan.map.json ...
 * 约定：文件名 = 世界美术名（WORLDS[].art）。为空时 MapBootstrap 回退到 ROAD_X 公式。
 */
                                                                 

/** key = WORLDS[].art；坐标为轨道坐标（1536 宽、y 从上往下），与 MapNodeData 同口径 */
export const LEVELS_BY_ART                             = {
  'xiaozhen': [
    { level: 1, x: 651, y: 4864 },
    { level: 2, x: 864, y: 4544 },
    { level: 3, x: 848, y: 4160 },
    { level: 4, x: 720, y: 3792 },
    { level: 5, x: 736, y: 3408 },
    { level: 6, x: 853, y: 3040 },
    { level: 7, x: 837, y: 2651 },
    { level: 8, x: 704, y: 2288 },
    { level: 9, x: 672, y: 1899 },
    { level: 10, x: 741, y: 1515 },
    { level: 11, x: 880, y: 1152 },
    { level: 12, x: 747, y: 789 },
  ],
};
