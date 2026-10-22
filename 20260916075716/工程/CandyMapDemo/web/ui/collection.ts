/**
 * 表情包图鉴（§11.3 线框）：3 列 × 12 行、共 36 格 + 大图预览。
 *
 * 「已解锁」由调用方以集合传入，不在界面里算 —— 解锁条件（首次通关）属于进度规则，
 * 界面只负责「彩色 / 灰 + 🔒」的呈现。
 * 缩略图与大图都用同一张 PNG（512×512，比 jpg 清晰），缩略图靠 CSS 缩放。
 */

import { IMAGE_MOOD, IMAGE_TEXT_PLACEHOLDER, animalOf } from '../../assets/scripts/核心/index.ts';
import { COLLECTION } from './text.ts';
import { buttonEl, el, stickerURL, toast } from './dom.ts';

/** 已解锁贴纸卡的底图三色轮换（设计图：蓝 / 粉 / 橙三种渐变卡） */
const CARD_SKINS = ['card-blue', 'card-pink', 'card-orange'] as const;

export interface CollectionHandlers {
  onBack: () => void;
  onOpen: (imageId: number) => void;
}

export interface CollectionScreen {
  el: HTMLElement;
  /** 重绘：`unlocked` 是已解锁的图 ID 集合 */
  render: (unlocked: ReadonlySet<number>, total: number) => void;
}

export function createCollectionScreen(handlers: CollectionHandlers): CollectionScreen {
  // 2026-10-22 按《UI及角色/图鉴》设计图改整屏：蓝天 + 棕色返回圆钮 + 金框大卡 3 列网格。
  // 不再用 .sheet（SHEET_SCREENS 已同步移除，否则 scrim 会吃掉所有点击）。
  const root = el('section', 'screen collection');
  root.id = 'screen-collection';

  const top = el('div', 'col-top');
  const backBtn = buttonEl('', 'col-back', () => handlers.onBack());
  backBtn.title = '返回';
  const title = el('div', 'col-title', COLLECTION.title);
  top.append(backBtn, title);
  root.appendChild(top);

  const countEl = el('div', 'col-count');
  root.appendChild(countEl);

  // 金框大卡（框是切图 ::before，内部透出蓝天）
  const card = el('div', 'col-card');
  const grid = el('div', 'col-grid');
  card.appendChild(grid);
  root.appendChild(card);

  const render = (unlocked: ReadonlySet<number>, total: number): void => {
    countEl.textContent = COLLECTION.collected(unlocked.size, total);
    grid.replaceChildren();

    for (let imageId = 0; imageId < total; imageId++) {
      const owned = unlocked.has(imageId);
      const cell = el('div', owned ? 'col-cell' : 'col-cell locked');
      // 卡底三色轮换（蓝 / 粉 / 橙，设计图三种渐变卡）；未解锁换灰锁卡
      cell.style.backgroundImage = `url('/web/art/collection/${owned ? CARD_SKINS[imageId % CARD_SKINS.length] : 'card-locked'}.png')`;

      if (owned) {
        // 不显示文字标签：用户一眼能认出是什么动物，省下的高度全给图（设计总原则：图尽量大）
        const img = el('img', 'col-img');
        img.src = stickerURL(imageId);
        img.alt = `图${imageId}`;
        img.loading = 'lazy';
        img.draggable = false;
        cell.appendChild(img);
        cell.addEventListener('click', () => handlers.onOpen(imageId));
      } else {
        // 锁已画在 card-locked.png 里；点击提示解锁条件（原功能）
        cell.addEventListener('click', () => toast(COLLECTION.lockedToast, 1800));
      }

      grid.appendChild(cell);
    }
  };

  return { el: root, render };
}

/* ---------------------------------------------------------------- 大图预览（§11.3） */

export interface PreviewHandlers {
  onBack: () => void;
  onDownload: (imageId: number) => void;
  onShare: (imageId: number, caption: string) => void;
}

export interface PreviewScreen {
  el: HTMLElement;
  render: (imageId: number) => void;
}

export function createPreviewScreen(handlers: PreviewHandlers): PreviewScreen {
  const root = el('section', 'screen preview sheet');
  root.id = 'screen-preview';

  const top = el('div', 'screen-top');
  top.appendChild(el('div', 'sheet-title', COLLECTION.title));
  const closeBtn = buttonEl('✕', 'sheet-close', () => handlers.onBack());
  closeBtn.title = '返回图鉴';
  top.appendChild(closeBtn);
  root.appendChild(top);

  const figure = el('div', 'preview-figure');
  const img = el('img', 'preview-img');
  img.draggable = false;
  figure.appendChild(img);
  root.appendChild(figure);

  const meta = el('div', 'preview-meta');
  const nameEl = el('div', 'preview-name');
  const captionEl = el('div', 'preview-caption');
  meta.appendChild(nameEl);
  meta.appendChild(captionEl);
  root.appendChild(meta);

  const actions = el('div', 'preview-actions');
  let current = 0;
  actions.appendChild(buttonEl(COLLECTION.download, 'menu-btn', () => handlers.onDownload(current)));
  actions.appendChild(
    buttonEl(COLLECTION.share, 'menu-btn primary', () => handlers.onShare(current, captionEl.textContent ?? '')),
  );
  root.appendChild(actions);

  const render = (imageId: number): void => {
    current = imageId;
    img.src = stickerURL(imageId);
    img.alt = `图${imageId}`;
    const animal = animalOf(imageId) ?? '未知';
    const mood = IMAGE_MOOD[imageId] ?? '';
    nameEl.textContent = `图${imageId}  ·  ${animal}${mood ? `·${mood}` : ''}`;
    captionEl.textContent = IMAGE_TEXT_PLACEHOLDER[imageId] ?? '';
  };

  return { el: root, render };
}
