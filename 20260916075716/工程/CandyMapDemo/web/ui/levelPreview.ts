/**
 * 关卡详情 / 开始弹窗（PLAY UI）：点地图节点后，一块带麻绳的牌子从屏幕上方「吊下来」。
 *
 * 这是覆盖在地图之上的浮层（不是「另一屏」），背景的地图照旧在底下，
 * 关掉浮层只是把它收起，地图不重建。难度切换只改全局模式并重算，不触发回主页/清局。
 *
 * 数据口径：
 *   - 关卡号 = `playable[index].level`（由 main 传入，1 基）；
 *   - 星级目标 = `STAR_LINES_BY_MODE[mode][level]`（[1星, 2星, 3星]），设计只展示 1星 / 3星；
 *   - 点 Play = 以当前选中的模式进关。
 */

import { buttonEl, el } from './dom.ts';

export type LevelMode = 'normal' | 'nightmare';

export interface LevelPreviewHandlers {
  /** 取某关在某模式下的星线 [s1,s2,s3]（拿不到返回 undefined） */
  starLines: (playableIndex: number, mode: LevelMode) => readonly [number, number, number] | undefined;
  /** 用户在弹窗内切换难度 */
  onMode: (mode: LevelMode) => void;
  /**
   * 该关**能不能选困难模式**（规则：同一关必须先在简单模式拿到 3 星）。
   * 返回 false 时困难按钮置灰并给出提示，点了也不切模式。
   */
  canNightmare: (playableIndex: number) => boolean;
  /** 关闭弹窗（点空白 / 关闭按钮） */
  onClose: () => void;
  /** 点 Play：以选中模式进入该关（playable 下标） */
  onPlay: (playableIndex: number, mode: LevelMode) => void;
}

export interface LevelPreview {
  el: HTMLElement;
  open: (playableIndex: number, levelNumber: number, currentMode: LevelMode) => void;
  close: () => void;
}

const MODE_LABEL: Record<LevelMode, string> = { normal: '简单', nightmare: '困难' };

export function createLevelPreview(h: LevelPreviewHandlers): LevelPreview {
  const root = el('div', 'level-preview');

  // 整体吊牌：麻绳 + 牌子，一起做下落动画
  const drop = el('div', 'lp-drop');
  const rope = el('div', 'lp-rope');
  drop.appendChild(rope);

  const card = el('div', 'lp-card');
  const closeBtn = buttonEl('✕', 'lp-close', () => h.onClose());
  closeBtn.title = '关闭';
  card.appendChild(closeBtn);

  const levelEl = el('div', 'lp-level');
  card.appendChild(levelEl);

  // 难度切换：简单 / 困难（灰色未选 · 橙色选中，与设计图一致）
  const modes = el('div', 'lp-modes');
  const modeBtns: Record<LevelMode, HTMLButtonElement> = {
    normal: buttonEl(MODE_LABEL.normal, 'lp-mode', () => pick('normal')),
    nightmare: buttonEl(MODE_LABEL.nightmare, 'lp-mode', () => pick('nightmare')),
  };
  modes.appendChild(modeBtns.normal);
  modes.appendChild(modeBtns.nightmare);
  card.appendChild(modes);

  // 星级目标：1星 X分 | 3星 Y分
  const stars = el('div', 'lp-stars');
  card.appendChild(stars);

  const playBtn = buttonEl('Play', 'lp-play', () => h.onPlay(idx, curMode));
  card.appendChild(playBtn);

  drop.appendChild(card);
  // 底部占位：与绳子各 flex:1，把牌子在整屏里垂直居中（绳子高度不计入牌子尺寸）
  drop.appendChild(el('div', 'lp-spacer'));
  root.appendChild(drop);

  let idx = 0;
  let curMode: LevelMode = 'normal';

  function pick(m: LevelMode): void {
    if (m === curMode) return;
    // 困难模式有门槛：本关简单模式没拿到 3 星就不让选
    if (m === 'nightmare' && !h.canNightmare(idx)) return;
    curMode = m;
    syncModes();
    renderStars();
    h.onMode(m);
  }

  function syncModes(): void {
    const canHard = h.canNightmare(idx);
    (Object.keys(modeBtns) as LevelMode[]).forEach((k) =>
      modeBtns[k].classList.toggle('on', k === curMode),
    );
    // 困难按钮：未达门槛 = 置灰 + 挂锁，点不动（pick 里也挡了一层）
    const hard = modeBtns.nightmare;
    hard.disabled = !canHard;
    hard.classList.toggle('locked', !canHard);
    hard.title = canHard ? MODE_LABEL.nightmare : '三星通关后开启困难模式';
    hard.textContent = canHard ? MODE_LABEL.nightmare : `🔒 ${MODE_LABEL.nightmare}`;
  }

  function renderStars(): void {
    const line = h.starLines(idx, curMode);
    stars.replaceChildren();
    if (!line) return;
    const s1 = el('span', 'lp-star');
    s1.innerHTML = `1星 <b>${line[0]}</b> 分`;
    const sep = el('span', 'lp-sep', '|');
    const s3 = el('span', 'lp-star');
    s3.innerHTML = `3星 <b>${line[2]}</b> 分`;
    stars.append(s1, sep, s3);
  }

  function open(playableIndex: number, levelNumber: number, currentMode: LevelMode): void {
    idx = playableIndex;
    // 当前是困难但这一关其实没达门槛（存档被改过等边界情况）→ 退回简单，不给进
    curMode = currentMode === 'nightmare' && !h.canNightmare(idx) ? 'normal' : currentMode;
    levelEl.textContent = `第 ${levelNumber} 关`;
    syncModes();
    renderStars();
    // 重启下落动画：先移除再强制重排再添加
    root.classList.remove('on');
    void root.offsetWidth;
    root.classList.add('on');
  }

  function close(): void {
    root.classList.remove('on');
  }

  // 点浮层空白处 = 关闭（牌子上点不算）
  root.addEventListener('click', (e) => {
    if (e.target === root) h.onClose();
  });

  return { el: root, open, close };
}
