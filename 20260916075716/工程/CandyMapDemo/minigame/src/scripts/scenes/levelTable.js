/** 地图编辑器坐标表 —— 由 tools/convert-map-json.ts 生成，请勿手改。
 *
 * 生成：node tools/convert-map-json.ts xiaozhen.map.json guoyuan.map.json ...
 * 约定：文件名 = 世界美术名（WORLDS[].art）。为空时 MapBootstrap 回退到 ROAD_X 公式。
 */
                                                                 

/** key = WORLDS[].art；坐标为轨道坐标（1536 宽、y 从上往下），与 MapNodeData 同口径 */
export const LEVELS_BY_ART                             = {};
