/**
 * 平台探测的最小公共件（批次⑧：分享 / 广告 / 埋点适配层共用）。
 *
 * 为什么要有这一层：**判定的地方只有一处**。
 * 分享要知道有没有小游戏分享能力，广告要知道能不能建激励视频，埋点要知道能不能落盘 ——
 * 三个模块各自去猜宿主，迟早会猜出三套互相矛盾的结论（比如「埋点说有存储、存档说没有」）。
 *
 * ⚠️ 这里是整个工程**唯一**允许出现宿主 API 的地方，写法只有一种：
 *    用字符串键从宿主对象里取，取到的东西再按「最小形状」校验。
 *    这样既满足可移植性守卫（不出现裸的平台标识符），也能在 Node 里直接单测
 *    —— 测试只要往 `globalThis` 上塞一个假对象就能跑完三条降级分支。
 *
 * 参考先例：`玩法/storage.ts` 的 `wxPort() / localStoragePort() / memoryPort()` 三级降级链。
 */

/**
 * 宿主类别。
 *   - `'wx'`     微信小游戏（有平台命名空间对象）
 *   - `'web'`    浏览器 / WebView（有剪贴板、导航器之类的 Web 能力）
 *   - `'unknown'` 都没有（Creator 模拟器、纯 Node 单测、被裁剪的运行时）
 */
export type HostKind = 'wx' | 'web' | 'unknown';

/**
 * 按名字从宿主对象里取一个对象，**失败一律返回 null**。
 *
 * 用「键 + 泛型」而不是写死引用，是为了让守卫 of 平台依赖只在本文件出现一次：
 * 上层模块拿到的是已经在类型层面收窄过的最小接口。
 */
export function pickHostApi<T>(key: string): T | null {
  const bag = globalThis as unknown as Record<string, unknown>;
  const value = bag[key];
  if (typeof value !== 'object' || value === null) return null;
  return value as T;
}

/** 宿主有没有某个 Web 能力（剪贴板 / 导航器 …）；取不到一律 false */
export function hasWebApi(key: string): boolean {
  return pickHostApi<object>(key) !== null;
}

/**
 * 当前宿主类别（懒探测、不缓存 —— 换平台只发生在启动前，但单测需要能来回切）。
 *
 * 判据刻意粗：只要宿主对象存在就认为是它，不做版本号 / API 枚举推断
 * —— 那些细则交给每个模块自己按「最小形状」校验（少具体的某个方法就降级到下一档）。
 */
export function detectHost(): HostKind {
  if (pickHostApi<object>('wx')) return 'wx';
  if (hasWebApi('navigator') || hasWebApi('document')) return 'web';
  return 'unknown';
}

/** 「今天」的日期键（YYYY-MM-DD），跨天重置的唯一口径（与 `玩法/meta.ts` 的 dayKey 同算法） */
export function dayStamp(now: number): string {
  const d = new Date(now);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** 两个时间戳是否跨了自然天（0 点分界，和国家 timezone 无关：小游戏与 Web 都按本地时间） */
export function crossedDay(from: number, to: number): boolean {
  return dayStamp(from) !== dayStamp(to);
}

/** 把数夹成非负有限值（配额类算术的统一收口，免得每个调用点各写一次 Math.max(0, …)） */
export function clampNonNegative(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 0;
}
