/**
 * 碎片 / 图的编号模型（《策划案V10》§3.1、§3.3、§5.1）
 *
 * 程序只认 ID，不认任何名称。
 *   图ID：  0 ~ 35   共 36 张
 *   碎片ID：0 ~ 143  共 144 块
 *   图ID   = 碎片ID ÷ 4 取整
 *   位置   = 碎片ID ÷ 4 取余   0=左上 1=右上 2=左下 3=右下
 */

/** 每张图拆成的碎片数 */
export const PIECES_PER_IMAGE = 4;

/** 图总量 */
export const TOTAL_IMAGES = 36;

/** 位置编码：0 = 左上 */
export const POS_TL = 0;
/** 位置编码：1 = 右上 */
export const POS_TR = 1;
/** 位置编码：2 = 左下 */
export const POS_BL = 2;
/** 位置编码：3 = 右下 */
export const POS_BR = 3;

/** 全部位置 */
export const ALL_POSITIONS: readonly number[] = [POS_TL, POS_TR, POS_BL, POS_BR];

/** 碎片ID → 图ID */
export function imageOf(pieceId: number): number {
  return Math.floor(pieceId / PIECES_PER_IMAGE);
}

/** 碎片ID → 位置（0/1/2/3） */
export function positionOf(pieceId: number): number {
  return pieceId % PIECES_PER_IMAGE;
}

/** 图ID + 位置 → 碎片ID */
export function pieceOf(imageId: number, position: number): number {
  return imageId * PIECES_PER_IMAGE + position;
}
