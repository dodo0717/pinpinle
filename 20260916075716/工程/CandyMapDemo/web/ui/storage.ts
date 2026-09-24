/**
 * M6 存储适配器：把「存档字符串」落到当前平台，**只关心读写一个 key**。
 *
 * 优先级（§M6 决策 6「本地存档」）：
 *   1. `wx.setStorageSync` —— 微信小游戏（正式环境）。上限 10MB，存档数据量极小；
 *   2. `localStorage`     —— 浏览器灰盒原型；
 *   3. **内存兜底**        —— 都不支持（隐私模式 / 沙箱 iframe）时，界面照常用，
 *      只是刷新会丢。此时 `storageKind()` 返回 `'memory'`，界面必须明示，不能装作存上了。
 *
 * ⚠️ 所有读写都必须 try/catch：`localStorage.setItem` 在 Safari 隐私模式下会直接抛
 * （`QuotaExceededError`），一个没包住的异常会让「点一下保存」变成整页白屏。
 *
 * 本模块**不 import `assets/scripts/core`**，也不碰 DOM —— 可以在 Node 里直接 import 做接线检查。
 */

/** 存档在介质里的键名（带版本号：改格式就换 key，旧档自然失效而不是被读坏） */
export const SAVE_KEY = 'mengchong.save.v1';

export type StorageKind = 'wx' | 'localStorage' | 'memory';

interface Port {
  kind: StorageKind;
  read(): string | null;
  write(value: string): boolean;
  remove(): void;
}

/** 微信小游戏全局对象的最小形状（只声明用到的三个 API，避免给 lib.dom 引入 wx 类型） */
interface WxLike {
  getStorageSync?: (key: string) => unknown;
  setStorageSync?: (key: string, value: string) => void;
  removeStorageSync?: (key: string) => void;
}

function wxPort(): Port | null {
  const wx = (globalThis as { wx?: WxLike }).wx;
  if (!wx) return null;
  const { getStorageSync, setStorageSync, removeStorageSync } = wx;
  if (typeof setStorageSync !== 'function' || typeof getStorageSync !== 'function') return null;
  return {
    kind: 'wx',
    read: () => {
      try {
        const v = getStorageSync(SAVE_KEY);
        return typeof v === 'string' && v.length > 0 ? v : null;
      } catch {
        return null;
      }
    },
    write: (value) => {
      try {
        setStorageSync(SAVE_KEY, value);
        return true;
      } catch {
        return false;
      }
    },
    remove: () => {
      try {
        removeStorageSync?.(SAVE_KEY);
      } catch {
        /* 清不掉就算了，下一次 write 会覆盖 */
      }
    },
  };
}

function localStoragePort(): Port | null {
  const ls = (globalThis as { localStorage?: Storage }).localStorage;
  if (!ls) return null;
  return {
    kind: 'localStorage',
    read: () => {
      try {
        return ls.getItem(SAVE_KEY);
      } catch {
        return null;
      }
    },
    write: (value) => {
      try {
        ls.setItem(SAVE_KEY, value);
        return true;
      } catch {
        // 配额满 / 隐私模式：如实返回 false，界面据此提示「本次进度仅在内存」
        return false;
      }
    },
    remove: () => {
      try {
        ls.removeItem(SAVE_KEY);
      } catch {
        /* 同上 */
      }
    },
  };
}

function memoryPort(): Port {
  let value: string | null = null;
  return {
    kind: 'memory',
    read: () => value,
    write: (v) => {
      value = v;
      return true;
    },
    remove: () => {
      value = null;
    },
  };
}

let cached: Port | null = null;

/** 当前生效的存储介质（懒探测一次；换平台只发生在启动前，不需要监听变化） */
function port(): Port {
  if (!cached) cached = wxPort() ?? localStoragePort() ?? memoryPort();
  return cached;
}

export function storageKind(): StorageKind {
  return port().kind;
}

export function readSave(): string | null {
  return port().read();
}

/** 落盘；返回 false = 没写进去（调用方必须提示玩家，不能静默） */
export function writeSave(value: string): boolean {
  return port().write(value);
}

export function removeSave(): void {
  port().remove();
}

/** 测试 / 诊断用：清掉探测缓存，让下一次调用重新选介质 */
export function resetStorageProbe(): void {
  cached = null;
}
