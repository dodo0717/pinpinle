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

/**
 * 存档**备份**键：每次成功落盘前，把盘上那一份（上一次的档）抄到这里。
 *
 * 为什么要它：主档只有一份，任何一次「读到空 / 写到空」都会让玩家几十关的进度
 * 无声消失，而玩家只会说「你们又清我数据了」。有备份时：
 *   · 主档为空（被清 / 被宿主抹掉）→ 启动自动从备份恢复；
 *   · 主档坏掉（截断 / 被改）→ 同上。
 * `removeSave()`（设置页「重置存档」）会把备份一并删掉，所以「真重置」不会第二天自己长回来。
 */
export const SAVE_BACKUP_KEY = 'mengchong.save.v1.bak';

export type StorageKind = 'wx' | 'localStorage' | 'memory';

interface Port {
  kind: StorageKind;
  read(key: string): string | null;
  write(key: string, value: string): boolean;
  remove(key: string): void;
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
    read: (key) => {
      try {
        const v = getStorageSync(key);
        return typeof v === 'string' && v.length > 0 ? v : null;
      } catch {
        return null;
      }
    },
    write: (key, value) => {
      try {
        setStorageSync(key, value);
        return true;
      } catch {
        return false;
      }
    },
    remove: (key) => {
      try {
        removeStorageSync?.(key);
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
    read: (key) => {
      try {
        return ls.getItem(key);
      } catch {
        return null;
      }
    },
    write: (key, value) => {
      try {
        ls.setItem(key, value);
        return true;
      } catch {
        // 配额满 / 隐私模式：如实返回 false，界面据此提示「本次进度仅在内存」
        return false;
      }
    },
    remove: (key) => {
      try {
        ls.removeItem(key);
      } catch {
        /* 同上 */
      }
    },
  };
}

function memoryPort(): Port {
  const store = new Map<string, string>();
  return {
    kind: 'memory',
    read: (key) => store.get(key) ?? null,
    write: (key, v) => {
      store.set(key, v);
      return true;
    },
    remove: (key) => {
      store.delete(key);
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
  return port().read(SAVE_KEY);
}

/** 落盘；返回 false = 没写进去（调用方必须提示玩家，不能静默） */
export function writeSave(value: string): boolean {
  return port().write(SAVE_KEY, value);
}

/** 读上一份存档（主档被清/写坏时用来救回进度） */
export function readSaveBackup(): string | null {
  return port().read(SAVE_BACKUP_KEY);
}

/** 写备份；失败无所谓（备份是加分项，不能因为它挡住主档落盘） */
export function writeSaveBackup(value: string): boolean {
  return port().write(SAVE_BACKUP_KEY, value);
}

/** 清档：主档与备份一起清 —— 否则「重置存档」第二天会自己长回来 */
export function removeSave(): void {
  port().remove(SAVE_KEY);
  port().remove(SAVE_BACKUP_KEY);
}

/** 测试 / 诊断用：清掉探测缓存，让下一次调用重新选介质 */
export function resetStorageProbe(): void {
  cached = null;
}
