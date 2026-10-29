/** 首页底图动画块 —— 由 tools/make-map-anim.py 生成，请勿手改。
 *
 * 每块 = 一张网格图集（从左到右、从上到下排帧），运行时来回播放（正放再倒放）。
 * x / y = 块中心、w / h = 显示尺寸，都是轨道坐标（1536 × 5462，y 从上往下），与 levelTable 同口径。
 * 图集已把动区边缘羽化烘焙进底图，所以是不透明 jpg，叠在底图上看不出接缝。
 */
                             
                                                                                    
                                               
 

/** key = WORLDS[].art */
export const MAP_ANIM                               = {
  'xiaozhen': [
    { path: 'map-anim/xiaozhen-0', fps: 8.05, frames: 33, cols: 8, fw: 244, fh: 265, x: 1362, y: 974, w: 347, h: 377 },
    { path: 'map-anim/xiaozhen-1', fps: 8.05, frames: 33, cols: 6, fw: 294, fh: 294, x: 223, y: 1082, w: 418, h: 418 },
    { path: 'map-anim/xiaozhen-2', fps: 8.05, frames: 33, cols: 7, fw: 275, fh: 295, x: 1340, y: 2083, w: 391, h: 420 },
    { path: 'map-anim/xiaozhen-3', fps: 8.05, frames: 33, cols: 9, fw: 209, fh: 295, x: 154, y: 2518, w: 297, h: 420 },
    { path: 'map-anim/xiaozhen-4', fps: 8.05, frames: 33, cols: 8, fw: 232, fh: 324, x: 1354, y: 3013, w: 330, h: 461 },
    { path: 'map-anim/xiaozhen-5', fps: 8.05, frames: 33, cols: 8, fw: 232, fh: 263, x: 488, y: 3446, w: 330, h: 374 },
    { path: 'map-anim/xiaozhen-6', fps: 8.05, frames: 33, cols: 6, fw: 299, fh: 324, x: 224, y: 4052, w: 425, h: 461 },
    { path: 'map-anim/xiaozhen-7', fps: 8.05, frames: 33, cols: 10, fw: 192, fh: 274, x: 415, y: 4463, w: 273, h: 390 },
  ],
};
