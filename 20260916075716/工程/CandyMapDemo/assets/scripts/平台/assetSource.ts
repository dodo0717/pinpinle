/**
 * 资源来源策略（2026-10-30）—— 为将来上 CDN 预留的**唯一开关**
 *
 * 背景：`assets/resources` 实测 **78.3 MB**（贴纸 46.83 / 字体 15.63 / 底图 13.37 / UI 2.48），
 * 微信小游戏主包上限 4 MB。等服务器架起来后，**图鉴贴纸与场景底图都走 CDN**，本地只留必要的。
 *
 * ⚠️ 当前策略：**默认全本地**（`cdnBase` 为空）。这样本地测试跑的是和现在完全一样的路径，
 * 完整性不受任何影响；CDN 只是「将来填个地址就能切」的能力，现在不启用。
 *
 * 用法（调用方不需要知道资源在哪）：
 *   const r = resolveAsset('map', 'w1_town', 'jpg');
 *   r.mode === 'local' → 走 resources.load(r.path)
 *   r.mode === 'cdn'   → 走远程加载 r.path（完整 URL）
 *
 * ⚠️ 可移植性：本文件不碰任何平台 API（无 window / wx / document），
 * 加载动作由调用方按 `mode` 分派 —— 守卫脚本 `tools/check-portability.mjs` 因此仍然全过。
 */

/** 可走 CDN 的资源组 */
export type AssetGroup = 'map' | 'stickers' | 'ui' | 'font' | 'mapNode';

export interface AssetSourceConfig {
  /**
   * CDN 根地址。**留空 = 全部走本地**（当前默认，保证本地测试完整性）。
   * 填上之后，只有 `cdnGroups` 里列出的组走远程，其余仍走本地。
   */
  cdnBase: string;
  /** 走 CDN 的组；空数组 = 即使配了 cdnBase 也全走本地 */
  cdnGroups: AssetGroup[];
  /** CDN 未就绪时是否回退本地（true = 加载失败还能用本地那份顶上） */
  fallbackToLocal: boolean;
}

export interface ResolvedAsset {
  /** local = 走 resources；cdn = 走远程 URL */
  mode: 'local' | 'cdn';
  /** local 时是 resources 路径（如 `map/w1_town`）；cdn 时是完整 URL */
  path: string;
  /** 资源组（便于调用方做统计或日志） */
  group: AssetGroup;
}

/** 默认配置：全本地 */
const DEFAULT_CONFIG: AssetSourceConfig = {
  cdnBase: '',
  cdnGroups: [],
  fallbackToLocal: true,
};

let current: AssetSourceConfig = { ...DEFAULT_CONFIG };

/** 当前配置（只读副本） */
export function assetSourceConfig(): AssetSourceConfig {
  return { ...current, cdnGroups: [...current.cdnGroups] };
}

/**
 * 设置配置 —— 将来服务器就绪后，只要在这里填 `cdnBase` 并把 `map` / `stickers` 列入
 * `cdnGroups` 即可，调用方一行都不用改。
 */
export function setAssetSourceConfig(patch: Partial<AssetSourceConfig>): AssetSourceConfig {
  current = { ...current, ...patch, cdnGroups: [...(patch.cdnGroups ?? current.cdnGroups)] };
  return assetSourceConfig();
}

/** 恢复默认（全本地）—— 测试用 */
export function resetAssetSourceConfig(): void {
  current = { ...DEFAULT_CONFIG };
}

/** CDN 是否已启用（有地址且非空组） */
export function isCdnEnabled(): boolean {
  return current.cdnBase.trim() !== '' && current.cdnGroups.length > 0;
}

/** 某组是否走 CDN */
export function groupUsesCdn(group: AssetGroup): boolean {
  return isCdnEnabled() && current.cdnGroups.indexOf(group) >= 0;
}

/** 拼 URL：把 base 与各组路径的斜杠规范化，避免 `//` 或漏 `/` */
export function cdnUrl(group: AssetGroup, name: string, ext?: string): string {
  const base = current.cdnBase.trim().replace(/\/+$/, '');
  const file = ext ? `${name}.${ext.replace(/^\.+/, '')}` : name;
  return `${base}/${group}/${file}`;
}

/**
 * 解析一个资源该从哪来。
 * @param group 资源组
 * @param name  资源名（不含扩展名）
 * @param ext   扩展名（CDN 拼 URL 用；本地路径不带扩展名）
 */
export function resolveAsset(group: AssetGroup, name: string, ext?: string): ResolvedAsset {
  if (groupUsesCdn(group)) {
    return { mode: 'cdn', path: cdnUrl(group, name, ext), group };
  }
  return { mode: 'local', path: `${group}/${name}`, group };
}

/** 批量解析（图鉴 108 格这类场景，一次算完再交给加载器） */
export function resolveAssets(group: AssetGroup, names: readonly string[], ext?: string): ResolvedAsset[] {
  return names.map((n) => resolveAsset(group, n, ext));
}

/** CDN 加载失败时是否允许回退本地 */
export function canFallbackToLocal(): boolean {
  return current.fallbackToLocal;
}
