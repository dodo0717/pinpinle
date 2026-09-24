/**
 * 设置（§11.4 线框）：音效 / 背景音乐开关 + 关于游戏（版本号）。
 *
 * M7 起开关**即时生效**（由 `main.ts` 的 onChange 直接调 audio.setSound/setBgm）：
 * 声音是 WebAudio 现合成的占位音（`art/` 里没有音频素材），界面上写明这一点，
 * 否则测试者会把「音色很电子」当成音效做坏了。
 * 落盘仍在 M6 的 SaveManager 里（设置是关键点，立即 flush）。
 */

import { SETTINGS, VERSION } from './text.ts';
import { buttonEl, el } from './dom.ts';
import type { Settings } from './meta.ts';

export interface SettingsHandlers {
  onBack: () => void;
  /** 开关变化；调用方负责存状态（界面不碰 MetaState） */
  onChange: (patch: Partial<Settings>) => void;
}

export interface SettingsScreen {
  el: HTMLElement;
  render: (settings: Settings) => void;
}

export function createSettingsScreen(handlers: SettingsHandlers): SettingsScreen {
  const root = el('section', 'screen settings sheet');
  root.id = 'screen-settings';

  const top = el('div', 'screen-top');
  top.appendChild(el('div', 'sheet-title', SETTINGS.title));
  const closeBtn = buttonEl('✕', 'sheet-close', () => handlers.onBack());
  closeBtn.title = '关闭';
  top.appendChild(closeBtn);
  root.appendChild(top);

  let current: Settings = { sound: true, bgm: true };

  const rows = el('div', 'settings-rows');
  const soundBtn = buttonEl('', 'toggle', () => handlers.onChange({ sound: !current.sound }));
  const bgmBtn = buttonEl('', 'toggle', () => handlers.onChange({ bgm: !current.bgm }));

  rows.appendChild(row(SETTINGS.sound, soundBtn));
  rows.appendChild(row(SETTINGS.bgm, bgmBtn));
  root.appendChild(rows);

  const about = el('div', 'settings-about');
  about.appendChild(el('div', 'settings-about-title', SETTINGS.about));
  about.appendChild(el('div', 'settings-about-line', SETTINGS.version(VERSION)));
  root.appendChild(about);

  root.appendChild(el('div', 'settings-note', SETTINGS.audioNote));

  const render = (settings: Settings): void => {
    current = settings;
    soundBtn.textContent = settings.sound ? SETTINGS.on : SETTINGS.off;
    bgmBtn.textContent = settings.bgm ? SETTINGS.on : SETTINGS.off;
    soundBtn.classList.toggle('off', !settings.sound);
    bgmBtn.classList.toggle('off', !settings.bgm);
  };

  return { el: root, render };
}

function row(label: string, control: HTMLElement): HTMLElement {
  const line = el('div', 'settings-row');
  line.appendChild(el('span', 'settings-label', label));
  line.appendChild(control);
  return line;
}
