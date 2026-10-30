/**
 * 资源来源策略（CDN 预留）的单测。
 *
 * 为什么值得测：这是将来**唯一**决定「资源从本地还是 CDN 来」的地方，
 * 而且它带全局状态配置 —— 一旦切错，图鉴和地图会整片加载失败，
 * 但错的地方离报错的地方很远（调用方只拿到一个 URL），很难查。
 *
 * 覆盖重点：
 *   - **默认必须全本地**：现在服务器还没架起来，本地测试的完整性完全依赖这一点；
 *   - 只有被明确列入 `cdnGroups` 的组才走远程，其余照旧本地（避免「一开全开」）；
 *   - URL 拼接的斜杠规范化（base 带不带尾斜杠都不能拼出 `//`）；
 *   - 回退开关与 reset（测试之间不留脏配置）。
 */

import assert from 'node:assert/strict';
import { test, beforeEach } from 'node:test';

import {
  resolveAsset,
  resolveAssets,
  groupUsesCdn,
  isCdnEnabled,
  setAssetSourceConfig,
  resetAssetSourceConfig,
  canFallbackToLocal,
  type AssetSourceConfig,
} from '../assets/scripts/平台/assetSource';

beforeEach(() => {
  resetAssetSourceConfig();
});

test('默认全本地 —— 服务器没架起来之前，本地测试路径必须和现在完全一致', () => {
  assert.equal(isCdnEnabled(), false);
  assert.equal(groupUsesCdn('map'), false);
  assert.equal(groupUsesCdn('stickers'), false);

  // 世界底图与贴纸都仍走 resources 路径（不带扩展名，与 resources.load 口径一致）
  assert.deepEqual(resolveAsset('map', 'w1_town', 'jpg'), { mode: 'local', path: 'map/w1_town', group: 'map' });
  assert.deepEqual(resolveAsset('stickers', 'sticker_0', 'png'), { mode: 'local', path: 'stickers/sticker_0', group: 'stickers' });
});

test('只配 cdnBase 但没列组 —— 仍然全本地（避免一开全开）', () => {
  setAssetSourceConfig({ cdnBase: 'https://cdn.example.com' });
  assert.equal(isCdnEnabled(), false, '没列组就不该启用');
  assert.equal(resolveAsset('map', 'w1_town', 'jpg').mode, 'local');
});

test('列了 map 就只有 map 走 CDN，贴纸照旧本地', () => {
  const cfg: Partial<AssetSourceConfig> = { cdnBase: 'https://cdn.example.com', cdnGroups: ['map'] };
  setAssetSourceConfig(cfg);

  assert.equal(isCdnEnabled(), true);
  assert.equal(groupUsesCdn('map'), true);
  assert.equal(groupUsesCdn('stickers'), false);

  const bg = resolveAsset('map', 'w1_town', 'jpg');
  assert.equal(bg.mode, 'cdn');
  assert.equal(bg.path, 'https://cdn.example.com/map/w1_town.jpg');

  const sticker = resolveAsset('stickers', 'sticker_0', 'png');
  assert.equal(sticker.mode, 'local');
  assert.equal(sticker.path, 'stickers/sticker_0');
});

test('图鉴与场景都上 CDN（服务器就绪后的目标形态）', () => {
  setAssetSourceConfig({ cdnBase: 'https://cdn.example.com', cdnGroups: ['map', 'stickers'] });
  assert.equal(resolveAsset('map', 'w15_starcastle', 'jpg').mode, 'cdn');
  assert.equal(resolveAsset('stickers', 'sticker_107', 'png').mode, 'cdn');
  assert.equal(resolveAsset('ui', 'home_tabbar_bg', 'png').mode, 'local', 'UI 切图仍留本地');
});

test('URL 斜杠规范化：base 带尾斜杠、扩展名带点都不拼出双斜杠', () => {
  setAssetSourceConfig({ cdnBase: 'https://cdn.example.com/', cdnGroups: ['map'] });
  assert.equal(resolveAsset('map', 'w1_town', 'jpg').path, 'https://cdn.example.com/map/w1_town.jpg');
  assert.equal(resolveAsset('map', 'w1_town', '.jpg').path, 'https://cdn.example.com/map/w1_town.jpg');
  assert.equal(resolveAsset('map', 'w1_town').path, 'https://cdn.example.com/map/w1_town');
});

test('批量解析：顺序与输入一一对应（图鉴 108 格一次算完）', () => {
  setAssetSourceConfig({ cdnBase: 'https://cdn.example.com', cdnGroups: ['stickers'] });
  const out = resolveAssets('stickers', ['sticker_0', 'sticker_1'], 'png');
  assert.equal(out.length, 2);
  assert.equal(out[0].path, 'https://cdn.example.com/stickers/sticker_0.png');
  assert.equal(out[1].path, 'https://cdn.example.com/stickers/sticker_1.png');
});

test('CDN 失败可回退本地（默认开），reset 能回到全本地', () => {
  assert.equal(canFallbackToLocal(), true, '默认允许回退，避免 CDN 一挂就白屏');
  setAssetSourceConfig({ cdnBase: 'https://cdn.example.com', cdnGroups: ['map'] });
  assert.equal(isCdnEnabled(), true);
  resetAssetSourceConfig();
  assert.equal(isCdnEnabled(), false, 'reset 后必须回到本地');
});
