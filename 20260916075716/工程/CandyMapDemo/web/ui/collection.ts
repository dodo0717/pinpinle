/**
 * 表情包图鉴（§11.3 线框）：3 列 × 12 行、共 36 格 + 大图预览。
 *
 * 「已解锁」由调用方以集合传入，不在界面里算 —— 解锁条件（首次通关）属于进度规则，
 * 界面只负责「彩色 / 灰 + 🔒」的呈现。
 * 缩略图与大图都用同一张 PNG（512×512，比 jpg 清晰），缩略图靠 CSS 缩放。
 */

import { IMAGE_MOOD, IMAGE_TEXT_PLACEHOLDER, animalOf } from '../../assets/scripts/core/index.ts';
import { COLLECTION, TITLE, GAME_LINK } from './text.ts';
import { buttonEl, el, stickerURL, toast } from './dom.ts';

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
  const root = el('section', 'screen collection sheet');
  root.id = 'screen-collection';

  const top = el('div', 'screen-top');
  top.appendChild(el('div', 'sheet-title', COLLECTION.title));
  const closeBtn = buttonEl('✕', 'sheet-close', () => handlers.onBack());
  closeBtn.title = '关闭';
  top.appendChild(closeBtn);
  root.appendChild(top);

  const countEl = el('div', 'collection-count');
  root.appendChild(countEl);

  const grid = el('div', 'collection-grid');
  root.appendChild(grid);

  const render = (unlocked: ReadonlySet<number>, total: number): void => {
    countEl.textContent = COLLECTION.collected(unlocked.size, total);
    grid.replaceChildren();

    for (let imageId = 0; imageId < total; imageId++) {
      const owned = unlocked.has(imageId);
      const cell = el('div', owned ? 'cell' : 'cell locked');
      const img = el('img', 'cell-img');
      img.src = stickerURL(imageId);
      img.alt = owned ? `图${imageId}` : COLLECTION.lockedCell;
      img.loading = 'lazy';
      img.draggable = false;
      cell.appendChild(img);

      const label = el('div', 'cell-label', owned ? `图${imageId}` : COLLECTION.lockedCell);
      cell.appendChild(label);

      if (!owned) {
        cell.appendChild(el('div', 'cell-lock', '🔒'));
        cell.addEventListener('click', () => toast('通关对应关卡后解锁', 1800));
      } else {
        cell.addEventListener('click', () => handlers.onOpen(imageId));
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
  const noteEl = el('div', 'preview-note', COLLECTION.captionNote);
  meta.appendChild(nameEl);
  meta.appendChild(captionEl);
  meta.appendChild(noteEl);
  root.appendChild(meta);

  const actions = el('div', 'preview-actions');
  let current = 0;
  actions.appendChild(buttonEl(COLLECTION.download, 'menu-btn', () => handlers.onDownload(current)));
  actions.appendChild(
    buttonEl(COLLECTION.share, 'menu-btn primary', () => handlers.onShare(current, captionEl.textContent ?? '')),
  );
  root.appendChild(actions);

  const sourceEl = el('div', 'preview-source', `${TITLE}  ${GAME_LINK}`);
  root.appendChild(sourceEl);

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
