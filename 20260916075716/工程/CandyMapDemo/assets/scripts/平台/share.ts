/**
 * 分享 —— 平台适配层（批次⑧）。
 *
 * 对应原版 `web/ui/share.ts`。原版是「canvas 画成绩卡 → navigator.share(带文件) → 不支持就下载」，
 * 这套降级链在 Cocos / 小游戏里**整条都不成立**：没有 DOM、没有 Blob、也没有文件系统。
 * 所以这里把能力判断彻底换掉，只保留**界面要的那三个语义**：
 *
 *   1. 能不能分享（`available()`）—— 不能就该把按钮置灰，而不是点了没反应；
 *   2. 分享一张卡片（`shareCard()`）—— 小游戏是标题 + 一张图 + query 串；
 *   3. 「分享得奖励」能不能结算（`hooks.onShared`）—— 见下面那条重要口径。
 *
 * ⚠️ **分享得奖励的口径**：小游戏 `shareAppMessage` 的 success 回调只表示
 * **玩家拉起了转发界面并确认**，官方并不承诺「真的发出去了」。所以 `onShared` 是
 * 「给奖励的最大善意」，**不能**拿它当月活 / 拉新的确数。真要按「分享成功」结算，
 * 得靠服务端收到别人从这条卡片进来的那条 `query` 才敢记 —— 那是后端的活，本层不pretend。
 *
 * 三分支：
 *   | 分支 | 触发条件 | 行为 |
 *   |------|---------|------|
 *   | 小游戏 | 宿主有 `shareAppMessage` | 弹转发面板；success → `ok`，fail → `cancel` |
 *   | Web/浏览器 | 有剪贴板能力 | 复制链接 text，提示「已复制」 |
 *   | 无能力 | 都没有 | `available() === false`，调用方给轻提示（`界面/PreviewScreen.ts` 已在这么做）|
 *
 * 平台 API 全部通过 `平台/host.ts` 的 `pickHostApi()` 取得，遵循 `玩法/storage.ts` 的既有写法。
 */

import { pickHostApi } from './host';

/** 分享介质 */
export type SharePort = 'wx' | 'web' | 'none';

/** 分享失败原因：`cancel` 玩家取消，`error` 平台报错，`unavailable` 本环境没有能力 */
export type ShareReason = 'ok' | 'cancel' | 'error' | 'unavailable';

/** 一张分享卡片（小游戏口径：标题 + 一张图 + 一串 query） */
export interface ShareCard {
  title: string;
  /** 5:4 横向图，建议 500×400；可以是本地临时路径（canvas 转出来的）或图床地址 */
  imageUrl?: string;
  /** 带跳转参数，如 `level=3&pid=xxx`；别人从卡片进来时在启动参数里能取回 */
  query?: string;
}

export interface ShareOutcome {
  ok: boolean;
  port: SharePort;
  reason: ShareReason;
}

/** 宿主注入：界面层负责「怎么提示」，本层只负责「发生了什么」 */
export interface ShareHooks {
  /** 轻提示（Cocos 端接 `玩法/toast.ts`） */
  toast?(msg: string): void;
  /** 「分享得奖励」回调 —— 只代表「拉起并确认」，不代表真的发出去了（见文件头） */
  onShared?(card: ShareCard): void;
  /** 复制链接的落地实现（宿主可能有原生剪贴板；默认走 `copy text` 能力探测） */
  copy?(text: string): boolean;
}

export interface ShareConfig {
  /** 强制指定介质；不填自动探测 */
  port?: SharePort | 'auto';
  /** 卡片里那句「来玩同款」的落地页 —— ⚠️ **待填写**：现在是占位地址 */
  link?: string;
  hooks?: ShareHooks;
  /**
   * 转发结果兜底时间（毫秒）：宿主迟迟不回调 success / fail 时，多久按「已拉起」结算。
   * 不想要兜底就传 0（Promise 会一直挂着，直到宿主回调为止）。
   */
  settleMs?: number;
}

/** 转发结果的兜底时间（略慢于一次真实转发确认，够用又不至于让玩家干等） */
export const SHARE_SETTLE_MS = 3000;

export interface Sharer {
  /** 当前介质（给埋点和错误排查用） */
  kind(): SharePort;
  /** 能否分享 —— 界面据此决定按钮要不要置灰 */
  available(): boolean;
  /** 分享一张卡片（成绩卡 / 图鉴图 / 商品图都走这里） */
  shareCard(card: ShareCard): Promise<ShareOutcome>;
  /** 分享一段文字（多半是小游戏里转发给好友那段开场白） */
  shareText(text: string): Promise<ShareOutcome>;
  /**
   * 注册「右上角菜单 → 转发」的默认卡片。返回是否注册成功
   * （只有小游戏有这个入口，别的宿主一律 false，界面要把这条分支考虑进去）。
   */
  setMenuShare(builder: () => ShareCard): boolean;
}

/**
 * 分享落地链接：**占位值**。
 * 原版 `web/ui/text.ts` 的 `GAME_LINK` 也是同一个占位串，等真实推广页由运营给（不要写进 release）。
 */
export const SHARE_LINK = 'https://example.com/mengchong-puzzle';

/* ------------------------------------------------------------------ 宿主形状（只用得到的最小接口） */

interface HostShareMessage {
  title?: string;
  imageUrl?: string;
  query?: string;
  success?: () => void;
  fail?: () => void;
  complete?: () => void;
}

interface HostShareApi {
  shareAppMessage?: (msg: HostShareMessage) => void;
  onShareAppMessage?: (builder: () => HostShareMessage) => void;
  setClipboardData?: (o: { data: string; success?: () => void; fail?: () => void }) => void;
}

interface HostClipboard {
  writeText?: (text: string) => Promise<unknown>;
}

/** 宿主那套「转发」能力；少 `shareAppMessage` 就等于没有 */
function hostShareApi(): HostShareApi | null {
  const api = pickHostApi<HostShareApi>('wx');
  if (!api || typeof api.shareAppMessage !== 'function') return null;
  return api;
}

/** Web 侧的剪贴板（宿主偏好 `navigator.clipboard`；小游戏也有 text 版，两者都兼容） */
function hostClipboard(): ((text: string) => boolean) | null {
  const clip = pickHostApi<{ clipboard?: HostClipboard }>('navigator')?.clipboard;
  if (clip && typeof clip.writeText === 'function') {
    return (text: string): boolean => {
      void clip.writeText?.(text).catch(() => undefined);
      return true;
    };
  }
  const api = pickHostApi<HostShareApi>('wx');
  if (api && typeof api.setClipboardData === 'function') {
    return (text: string): boolean => {
      try {
        api.setClipboardData?.({ data: text });
        return true;
      } catch {
        return false;
      }
    };
  }
  return null;
}

/* ------------------------------------------------------------------ 工厂 */

export function createShare(config: ShareConfig = {}): Sharer {
  const hooks = config.hooks ?? {};
  const link = config.link ?? SHARE_LINK;

  /** 介质解析：显式指定优先，否则按能力降级（小游戏 → Web → none） */
  function resolvePort(): SharePort {
    const want = config.port ?? 'auto';
    if (want !== 'auto') return want;
    if (hostShareApi()) return 'wx';
    if (hooks.copy || hostClipboard()) return 'web';
    return 'none';
  }

  const port = resolvePort();

  /** copy 实现优先级：注入的 > 探测到的 > 没有 */
  function copyText(text: string): boolean {
    if (hooks.copy) return hooks.copy(text);
    const cb = hostClipboard();
    if (!cb) return false;
    return cb(text);
  }

  function ok(reason: ShareReason = 'ok'): ShareOutcome {
    return { ok: true, port, reason };
  }

  function denied(reason: ShareReason): ShareOutcome {
    return { ok: false, port, reason };
  }

  /** Web / 降级：把「链接 + 一句话」复制出去，实在没有剪贴板就给一句轻提示 */
  async function copyFallback(card: ShareCard): Promise<ShareOutcome> {
    const text = `${card.title}\n${link}`;
    if (copyText(text)) {
      hooks.toast?.('链接已复制，去粘贴给好友吧');
      hooks.onShared?.(card);
      return ok();
    }
    hooks.toast?.('当前环境不支持分享');
    return denied('unavailable');
  }

  return {
    kind(): SharePort {
      return port;
    },

    available(): boolean {
      return port !== 'none';
    },

    async shareCard(card: ShareCard): Promise<ShareOutcome> {
      const title = card.title.trim();
      if (!title) return denied('error'); // 空标题转发出去是一张什么都没有的卡片
      try {
        if (port === 'none') {
          hooks.toast?.('当前环境不支持分享');
          return denied('unavailable');
        }
        if (port !== 'wx') return await copyFallback(card);

        const api = hostShareApi();
        if (!api) {
          // 探测过了说有，真用时没了（极端情况：宿主能力被回收）→ 降级而不是抛
          return await copyFallback(card);
        }
        return await new Promise<ShareOutcome>((resolve) => {
          let settled = false;
          let guard: ReturnType<typeof setTimeout> | null = null;
          const done = (reason: ShareReason, success: boolean): void => {
            if (settled) return;
            settled = true;
            if (guard !== null) clearTimeout(guard);
            if (success) hooks.onShared?.(card);
            resolve(success ? ok() : denied(reason));
          };
          const settleMs = config.settleMs ?? SHARE_SETTLE_MS;
          try {
            api.shareAppMessage?.({
              title,
              imageUrl: card.imageUrl,
              query: card.query,
              success: () => done('ok', true),
              fail: () => done('cancel', false),
            });
          } catch {
            done('error', false);
            return;
          }
          // 宿主迟迟不回调（老版本只回 success、取消时静默）时不能让玩家干等。
          // 转发面板已经交出去了，按「已拉起」结算，奖励照给 —— 见文件头的口径说明。
          if (!settled && settleMs > 0) {
            guard = setTimeout(() => done('ok', true), settleMs);
          }
        });
      } catch {
        return denied('error');
      }
    },

    async shareText(text: string): Promise<ShareOutcome> {
      return await this.shareCard({ title: text, query: '' });
    },

    setMenuShare(builder: () => ShareCard): boolean {
      const api = hostShareApi();
      if (!api || typeof api.onShareAppMessage !== 'function') return false;
      try {
        api.onShareAppMessage(() => {
          const card = builder();
          return { title: card.title, imageUrl: card.imageUrl, query: card.query };
        });
        return true;
      } catch {
        return false;
      }
    },
  };
}

let cached: Sharer | null = null;

/** 进程内的默认实例（懒建一次）；界面层不用自己管生命周期 */
export function share(): Sharer {
  if (!cached) cached = createShare();
  return cached;
}

/** 测试 / 换宿主时清掉默认实例 */
export function resetShareProbe(): void {
  cached = null;
}
