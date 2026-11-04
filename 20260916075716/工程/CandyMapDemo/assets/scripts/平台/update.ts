/**
 * 新版本检测（2026-11-03）—— 发布新版后，让老用户**这一次打开**就能用上，而不是等下次冷启动。
 *
 * 微信默认行为：启动时后台检查新版本，有就下载，但本次仍运行旧代码，下次冷启动才换新。
 * 这里接 `getUpdateManager().onUpdateReady`：新包下载完弹一次确认框，用户点「重启」就立刻切到新版。
 *
 * ⚠️ 资源缓存不归这里管：远程资源靠构建时勾「MD5 缓存」（文件名带内容指纹，内容一变网址就变）。
 * ⚠️ 只在小游戏宿主生效；Web / 预览 / 单测里取不到宿主对象，直接什么都不做。
 */

import { pickHostApi } from './host';

interface UpdateManager {
  onUpdateReady(cb: () => void): void;
  applyUpdate(): void;
  onUpdateFailed?(cb: () => void): void;
}

interface ModalResult { confirm: boolean }

interface HostUpdateApi {
  getUpdateManager?: () => UpdateManager;
  showModal?: (o: {
    title: string;
    content: string;
    confirmText?: string;
    cancelText?: string;
    success?: (r: ModalResult) => void;
  }) => void;
}

export interface UpdateText {
  title: string;
  content: string;
  confirm: string;
  cancel: string;
}

let watching = false;

/** 开始监听新版本（幂等，进首页时调一次即可） */
export function watchForUpdate(text: UpdateText): void {
  if (watching) return;
  const api = pickHostApi<HostUpdateApi>('wx');
  if (!api || typeof api.getUpdateManager !== 'function') return;
  let mgr: UpdateManager;
  try {
    mgr = api.getUpdateManager();
  } catch {
    return;
  }
  watching = true;
  mgr.onUpdateReady(() => {
    // 没有弹窗能力就直接切新版（新包已下载完，重启很快）
    if (typeof api.showModal !== 'function') { mgr.applyUpdate(); return; }
    api.showModal({
      title: text.title,
      content: text.content,
      confirmText: text.confirm,
      cancelText: text.cancel,
      success: (r) => { if (r.confirm) mgr.applyUpdate(); },
    });
  });
  // 新包下载失败：不打扰用户，下次冷启动微信会再试
  mgr.onUpdateFailed?.(() => console.warn('[update] 新版本下载失败，下次启动再试'));
}
