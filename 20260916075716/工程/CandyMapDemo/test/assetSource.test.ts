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

/**
 * 接线检查：`worlds.ts` 的底图已经改走 `resolveAsset`，这条是**本地渲染完整性**的保险丝 ——
 * 只要有人把路径拼错（多一层目录、带了扩展名、写死成别的组），地图立刻整片缺图，
 * 而错的地方（assetSource）离报错的地方（MapBootstrap 的 resources.load）很远。
 */
test('世界底图：默认 15 个世界全部本地，路径与改造前的字面值逐字一致', async () => {
  const { WORLDS, worldArtPath, worldArtAsset } = await import('../assets/scripts/场景/worlds');

  assert.equal(WORLDS.length, 15);
  for (let i = 0; i < WORLDS.length; i++) {
    const a = worldArtAsset(i);
    assert.equal(a.mode, 'local', `第 ${i + 1} 世界不该走 CDN`);
    assert.equal(a.group, 'map');
    assert.equal(a.path, `map/w${i + 1}_${WORLDS[i]!.art}`, `第 ${i + 1} 世界路径与字面值不一致`);
    assert.equal(a.path, worldArtPath(i), 'worldArtAsset 与 worldArtPath 必须同口径');
  }

  // 这两个字面值是 MapBootstrap 改造前 `resources.load` 用的，钉死防回归
  assert.equal(worldArtAsset(0).path, 'map/w1_town');
  assert.equal(worldArtAsset(14).path, 'map/w15_starcastle');
  // 越界钳制：不能因为下标越界就返回 undefined 之类的坏路径
  assert.equal(worldArtAsset(-5).path, 'map/w1_town');
  assert.equal(worldArtAsset(99).path, 'map/w15_starcastle');
});

test('世界底图与图鉴贴纸切到 CDN：整组变远程，UI 仍留本地', async () => {
  const { worldArtAsset } = await import('../assets/scripts/场景/worlds');
  setAssetSourceConfig({ cdnBase: 'https://cdn.example.com/', cdnGroups: ['map', 'stickers'] });

  assert.equal(worldArtAsset(0).mode, 'cdn');
  assert.equal(worldArtAsset(0).path, 'https://cdn.example.com/map/w1_town.jpg');
  assert.equal(resolveAsset('stickers', 'sticker_107', 'png').path, 'https://cdn.example.com/stickers/sticker_107.png');
  assert.equal(resolveAsset('ui', '底栏/home_tabbar_bg', 'png').mode, 'local', 'UI 切图不跟着上 CDN');
});
