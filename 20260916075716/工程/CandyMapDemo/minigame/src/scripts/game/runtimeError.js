/**
 * 运行时错误上屏（2026-10-25）：纯代码运行时（cc-shim）把错误画在屏幕顶部红条上，
 * 微信开发者工具 / 真机里不看控制台也能截图定位。真 Cocos 里没有这个能力，退回 console.error。
 */
import * as cc from '../../runtime/cc.js';

export function reportError(where        , err         )       {
  const fn = (cc                                                                ).reportError;
  if (typeof fn === 'function') fn(where, err);
  else console.error(`[runtime] ${where}:`, err);
}
