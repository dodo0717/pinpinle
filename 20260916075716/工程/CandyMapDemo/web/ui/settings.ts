/**
 * 设置（§11.4 线框，2026-10-22 按《UI及角色/设置》设计图整版重做）：
 * 音乐 / 音效开关（切图开关）+ 合成占位音说明 + 卡下版本号。
 *
 * 结构同图鉴：**整屏**（蓝天 + 棕返回钮 + 白字描边标题 + 金框棕木卡），
 * 不再是 sheet 浮层 —— `main.ts` 的 `SHEET_SCREENS` 已同步移除 `settings`。
 *
 * M7 起开关**即时生效**（由 `main.ts` 的 onChange 直接调 audio.setSound/setBgm）：
 * 声音是 WebAudio 现合成的占位音（`art/` 里没有音频素材），界面上写明这一点，
 * 否则测试者会把「音色很电子」当成音效做坏了。
 * 落盘仍在 M6 的 SaveManager 里（设置是关键点，立即 flush）。
 */

import { SETTINGS, TUTORIAL, VERSION } from './text.ts';
import { buttonEl, el } from './dom.ts';
import type { Settings } from './meta.ts';

export interface SettingsHandlers {
  onBack: () => void;
  /** 开关变化；调用方负责存状态（界面不碰 MetaState） */
  onChange: (patch: Partial<Settings>) => void;
  /**
   * 打开新手教学（序章）抽屉。
   * 首页的教学按钮会在「困难模式累计通关 ≥10 关」后隐藏，但玩家可能还想回看 ——
   * 所以设置页**永久保留**这个入口（策划案 §14 决策 3）。
   */
  onTutorial: () => void;
}

export interface SettingsScreen {
  el: HTMLElement;
  render: (settings: Settings) => void;
}

export function createSettingsScreen(handlers: SettingsHandlers): SettingsScreen {
  const root = el('section', 'screen settings');
  root.id = 'screen-settings';

  const top = el('div', 'set-top');
  const backBtn = buttonEl('', 'set-back', () => handlers.onBack());
  backBtn.title = '返回';
  const title = el('div', 'set-title', SETTINGS.title);
  top.append(backBtn, title);
  root.appendChild(top);

  // 金框大卡：内板是棕色木纹（切图没给空行底板，行条用 CSS 模拟木纹）
  const card = el('div', 'set-card');
  const rows = el('div', 'set-rows');

  let current: Settings = { sound: true, bgm: true, voice: true };

  /** 开关钮：底图在 on/off 两张切图间切换，aria 同步 */
  const toggleBtn = (get: () => boolean, flip: () => void): { btn: HTMLButtonElement; sync: (on: boolean) => void } => {
    const btn = buttonEl('', 'set-toggle', flip);
    const sync = (on: boolean): void => {
      btn.style.backgroundImage = `url('/web/art/settings/${on ? 'toggle-on' : 'toggle-off'}.png')`;
      btn.setAttribute('aria-pressed', String(on));
    };
    sync(get());
    return { btn, sync };
  };

  // 行序对齐设计图：音乐在前、音效在后（main 的 onChange 按字段分发，与顺序无关）
  const bgm = toggleBtn(
    () => current.bgm,
    () => handlers.onChange({ bgm: !current.bgm }),
  );
  const sfx = toggleBtn(
    () => current.sound,
    () => handlers.onChange({ sound: !current.sound }),
  );
  // 教学语音（2026-10-26 新增）：序章里那句简短文本要不要念出来
  const voice = toggleBtn(
    () => current.voice,
    () => handlers.onChange({ voice: !current.voice }),
  );

  rows.appendChild(row('/web/art/settings/icon-music.png', SETTINGS.bgm, bgm.btn));
  rows.appendChild(row('/web/art/settings/icon-sfx.png', SETTINGS.sound, sfx.btn));
  rows.appendChild(row('/web/art/settings/icon-sfx.png', SETTINGS.voice, voice.btn));
  // 新手教学：首页按钮会按进度隐藏，这里永远留一个回看入口
  const tutLine = el('div', 'set-row');
  tutLine.append(
    el('span', 'set-label', TUTORIAL.drawerTitle),
    buttonEl('查看', 'set-tutorial-btn', () => handlers.onTutorial()),
  );
  rows.appendChild(tutLine);
  card.appendChild(rows);
  root.appendChild(card);

  // 版本号：设计图位置 = 卡下方小字
  root.appendChild(el('div', 'set-version', SETTINGS.version(VERSION)));

  const render = (settings: Settings): void => {
    current = settings;
    bgm.sync(settings.bgm);
    sfx.sync(settings.sound);
    voice.sync(settings.voice);
  };

  return { el: root, render };
}

function row(icon: string, label: string, control: HTMLElement): HTMLElement {
  const line = el('div', 'set-row');
  const img = el('img', 'set-icon');
  img.src = icon;
  img.alt = '';
  img.draggable = false;
  line.append(img, el('span', 'set-label', label), control);
  return line;
}
