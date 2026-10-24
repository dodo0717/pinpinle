/**
 * 融合组的**纹理取样几何**（纯函数，Node 里可单测 —— 不碰 DOM）。
 *
 * ## 为什么单独一个文件
 *
 * §11.6.3 的验收标准是「4 块拼成 512×512 与原图逐像素一致」。做「无缝」有两种写法，
 * 差别只在**接缝处有没有一次缩放台阶**：
 *
 * ① 每块各按自己的元素尺寸取样（CSS `background-size: 200% 200%`，本文件之前的写法）：
 *    融合时元素向外扩了半个缝隙填裂缝，而百分比是跟着元素尺寸走的 → 每块被放大的
 *    倍率都不一样，接缝两侧显示的原图坐标**对不上**。肉眼看不出白线，但放大截图能
 *    看到接缝两侧的内容错位（1 个源像素以上）。
 *
 * ② 按**整组**的统一比例取样（本文件的算法）：
 *    「组内容宽度 inkW」对应「组内象限数 × 256」个源像素，组内每块的取样比例完全相同，
 *    相邻两块的像素边界正好落在同一个源像素上 → 真正无缝、无重采样断层。
 *    单块（未融合）时本算法退化成 ①，即与旧行为**逐像素等价**。
 *
 * ## 坐标系与术语
 *
 * - 象限(quadrant)：一张图切成 2×2 后的一份，即 512×512 里的 256×256。
 * - 组内容原点：组内**第一块**（最左列/最上行）的 padding-box 左上角。
 *   为什么是 padding-box：CSS 里 `background-origin: padding-box`，白色描边不吃纹理。
 * - 块边距：向外扩的量固定为 `gap/2` —— 相邻两块各扩一半，缝正好被吃满；
 *   ⚠️ 不能多扩（曾经为"保险"多给 1px），多扩会让两块在缝上重叠，
 *   重叠处两块显示的原图位置差 1px，接缝上就多出一道错位。
 */

/** 象限尺寸（源像素）：512 / 2 */
export const QUADRANT_PX = 256;

/** 整图尺寸（源像素）：与 `art/stickers` 的 512×512 一致 */
export const TEXTURE_PX = QUADRANT_PX * 2;

/** 融合时单侧向外扩展的量：正好半个缝隙 */
export function mergeExtent(gap        )         {
  return gap / 2;
}

                                     
                       
                   
                 
              
                   
               
                
                    
                    
                         
                     
                     
                                                    
                  
                  
                                     
                     
                      
                   
                     
 

                                
                                                      
              
              
                                           
               
               
                                  
                  
                 
               
               
                            
                    
                    
 

/**
 * 算出某一块的纹理取样几何。
 *
 * 屏幕坐标 → 源像素的映射（在「组内容原点」坐标系里）：
 *   sourceX = x * groupCols * QUADRANT_PX / groupInkW
 * 组内每块的 `bgW/posX` 都满足这条映射，所以接缝两侧的像素是连续的。
 */
export function pieceGeometry(input                    )                {
  const { cellSize, gap, edge, groupCols, groupRows, colInGroup, rowInGroup, quadCol, quadRow } = input;
  const ext = mergeExtent(gap);
  const step = cellSize + gap;

  // 整组内容尺寸：第一块的 padding-box 左边 → 最后一块的 padding-box 右边
  const groupInkW = groupCols * cellSize + (groupCols - 1) * gap - 4 * edge;
  const groupInkH = groupRows * cellSize + (groupRows - 1) * gap - 4 * edge;

  // 本块的 padding-box（相对组内容原点）
  const padLeft = colInGroup * step + (input.mergeLeft ? -ext : 2 * edge);
  const padRight = colInGroup * step + (input.mergeRight ? cellSize + ext : cellSize - 2 * edge);
  const padTop = rowInGroup * step + (input.mergeUp ? -ext : 2 * edge);
  const padBottom = rowInGroup * step + (input.mergeDown ? cellSize + ext : cellSize - 2 * edge);

  const inkLeft = padLeft - 2 * edge;
  const inkTop = padTop - 2 * edge;

  // 整图在屏幕上的尺寸：组内容宽 inkW 承载 groupCols 个象限
  const bgW = (TEXTURE_PX * groupInkW) / (groupCols * QUADRANT_PX);
  const bgH = (TEXTURE_PX * groupInkH) / (groupRows * QUADRANT_PX);

  // 纹理偏移 = 组原点象限的偏移 + 本块在组内的偏移
  const posX = -(quadCol * (groupInkW / groupCols) + inkLeft);
  const posY = -(quadRow * (groupInkH / groupRows) + inkTop);

  return {
    bgW,
    bgH,
    posX,
    posY,
    inkLeft,
    inkTop,
    inkW: padRight - padLeft,
    inkH: padBottom - padTop,
    groupInkW,
    groupInkH,
  };
}

/** 组内容坐标系里的屏幕 x → 原图源像素 x（验收脚本与单测用） */
export function sourceXAt(x        , groupCols        , groupInkW        )         {
  return (x * groupCols * QUADRANT_PX) / groupInkW;
}

/** 组内容坐标系里的屏幕 y → 原图源像素 y */
export function sourceYAt(y        , groupRows        , groupInkH        )         {
  return (y * groupRows * QUADRANT_PX) / groupInkH;
}
