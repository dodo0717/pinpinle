/**
 * 运行时错误上屏（2026-10-25）：纯代码运行时（cc-shim）把错误画在屏幕顶部红条上，
 * 微信开发者工具 / 真机里不看控制台也能截图定位。真 Cocos 里没有这个能力，退回 console.error。
 *
 * 2026-10-26：红条是否显示由发布口径决定（`核心/release.ts`，正式包关闭）。
 * 模块加载时就设置 —— MapBootstrap 顶部 import 本模块，早于 onLoad，启动期的错误也受控。
 */
import * as cc from 'cc';
import { RELEASE } from '../核心/release';

type Shim = {
  reportError?: (w: string, e: unknown) => void;
  setErrorBarEnabled?: (on: boolean) => void;
};

const shim = cc as unknown as Shim;
if (typeof shim.setErrorBarEnabled === 'function') shim.setErrorBarEnabled(RELEASE.runtimeErrorBar);

export function reportError(where: string, err: unknown): void {
  if (typeof shim.reportError === 'function') shim.reportError(where, err);
  else console.error(`[runtime] ${where}:`, err);
}
