/**
 * 贴图加载分派（2026-10-30）—— 调用方只拿 `ResolvedAsset`，不关心资源在哪
 *
 * 与 `assetSource.ts` 的分工：
 *   - `assetSource.ts` **只回答「从哪来」**（local 的 resources 路径 / cdn 的完整 URL），不碰引擎；
 *   - 本文件 **只负责「怎么加载」**，按 `mode` 分派，并统一兜底。
 *
 * ⚠️ 默认（`cdnBase` 为空）时所有组都走 local，落到的就是 `resources.load('map/w1_town/spriteFrame')`
 * —— 与改造前**逐字相同**，所以本地渲染路径没有任何变化。
 *
 * ⚠️ CDN 分支（`mode === 'cdn'`）的实现程度：
 *   按 Cocos 3.x 文档写了 `assetManager.loadRemote(url, { ext }, cb)` → 拿到 Texture2D → 包成 SpriteFrame；
 *   失败时若 `canFallbackToLocal()` 为真，再把 URL 还原成本地 resources 路径重试一次。
 *   **本机没有 Cocos Creator，这条分支没在真机/编辑器上跑过**（签名与回调形态未实机验证）。
 *   真机联调时若对不上，只需要改 `loadRemoteSpriteFrame()` 这一个函数，调用方一行都不用动。
 *
 * ⚠️ 可移植性：不用 window / wx / document，`assetManager` 走命名空间动态取
 * （浏览器预览用的 `preview/cc-shim.js` 没导出它，静态 import 会让整个模块 import 失败）。
 */

import { resources, SpriteFrame, Texture2D } from 'cc';
import * as ccns from 'cc';
import { canFallbackToLocal, type ResolvedAsset } from './assetSource';

/** `assetManager.loadRemote` 的最小形状（只为拿到类型，不引入引擎依赖） */
interface RemoteAssetManager {
  loadRemote?(
    url: string,
    options: { ext?: string },
    onComplete: (err: Error | null, tex: Texture2D | null) => void,
  ): void;
}

/** URL → 扩展名（远程加载要带 `ext`，否则引擎认不出格式） */
function extOf(url: string): string | undefined {
  const i = url.lastIndexOf('.');
  if (i < 0) return undefined;
  const ext = url.slice(i + 1).split(/[?#]/)[0];
  return ext ? ext.toLowerCase() : undefined;
}

/**
 * CDN 路径 → 本地 resources 路径（`resolveAsset` 的 local 形式就是 `组名/资源名`）。
 * `https://cdn/map/w1_town.jpg` → `map/w1_town`，与 `resolveAsset('map','w1_town')` 完全一致。
 */
export function localPathOf(res: ResolvedAsset): string {
  const file = res.path.slice(res.path.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '');
  return `${res.group}/${file}`;
}

/** 远程加载：拿 Texture2D 包成 SpriteFrame（失败回 null，由调用方决定怎么兜底） */
function loadRemoteSpriteFrame(res: ResolvedAsset, cb: (sf: SpriteFrame | null) => void): void {
  // TODO(未实机验证)：本机无 Cocos Creator，`assetManager.loadRemote` 的回调形态没跑过。
  const am = (ccns as unknown as { assetManager?: RemoteAssetManager }).assetManager;
  if (!am || typeof am.loadRemote !== 'function') {
    console.warn('[asset] assetManager 不可用，远程加载跳过: ' + res.path);
    cb(null);
    return;
  }
  am.loadRemote(res.path, { ext: extOf(res.path) }, (err, tex) => {
    if (err || !tex) {
      console.warn('[asset] 远程加载失败: ' + res.path);
      cb(null);
      return;
    }
    const sf = new SpriteFrame();
    sf.texture = tex;
    cb(sf);
  });
}

/**
 * 按 `mode` 分派贴图加载。
 * @param cb 拿到 SpriteFrame 或 null（null = 失败，调用方负责占位/提示）
 */
export function loadSpriteFrame(res: ResolvedAsset, cb: (sf: SpriteFrame | null) => void): void {
  inflight += 1;
  loadSpriteFrameRaw(res, (sf) => {
    inflight = Math.max(0, inflight - 1);
    try { cb(sf); } finally { if (inflight === 0) flushIdle(); }
  });
}

/* ------------------------------------------------------------ 在途计数（2026-11-04） */
/**
 * 整屏第一次打开时，「加载中」过场要等这一屏发出的切图**全部到手**才收起：
 * 真机上即使文件已下载到缓存，解码几十张图仍要一两秒，过场先收起就会看到半成品界面。
 */
let inflight = 0;
let idleWaiters: Array<() => void> = [];

function flushIdle(): void {
  const list = idleWaiters;
  idleWaiters = [];
  for (const fn of list) fn();
}

/** 当前没有在途的贴图加载时回调（已空闲则下一次检查立即回调） */
export function whenSpritesIdle(cb: () => void): void {
  if (inflight === 0) { cb(); return; }
  idleWaiters.push(cb);
}

function loadSpriteFrameRaw(res: ResolvedAsset, cb: (sf: SpriteFrame | null) => void): void {
  if (res.mode === 'local') {
    resources.load(res.path + '/spriteFrame', SpriteFrame, (err, sf) => {
      if (err || !sf) {
        console.warn('[asset] 贴图缺失: ' + res.path);
        cb(null);
        return;
      }
      cb(sf);
    });
    return;
  }

  loadRemoteSpriteFrame(res, (sf) => {
    if (sf) { cb(sf); return; }
    if (!canFallbackToLocal()) { cb(null); return; }
    // CDN 没就绪 → 拿本地那份顶上（路径与 local 模式逐字一致）
    const localPath = localPathOf(res);
    console.warn('[asset] 回退本地: ' + localPath);
    resources.load(localPath + '/spriteFrame', SpriteFrame, (err2, sf2) => {
      if (err2 || !sf2) { cb(null); return; }
      cb(sf2);
    });
  });
}
