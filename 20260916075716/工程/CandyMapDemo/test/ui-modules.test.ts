/**
 * 界面层的「接线检查」。
 *
 * 为什么需要这个文件：`web/` 走的是浏览器 + Node 原生类型擦除，**没有打包器、也没有 tsc 把关**。
 * 于是「`import { tierOfLevel } from './dom.ts'` 而它其实在 text.ts 里」这种错误，
 * 类型擦除阶段完全看不出来（`.ts` 文件照样能返回 200），要等浏览器跑到 `import` 那一刻才炸 ——
 * 表现为整页白屏，且控制台只说「does not provide an export named」。
 *
 * 这里用两条断言把这个空当补上：
 *   1. 每个 `web/ui/*.ts` 模块都能被 import，且 `main.ts` 用到的那几个入口确实存在；
 *   2. 解析 `main.ts` 的 import 语句，逐个核对目标模块的运行时导出 —— 少一个就报错。
 *
 * ⚠️ 只检查**值导出**（函数 / 常量）。`type X` 形式的类型导入在运行时不存在，按规则跳过。
 * `web/main.ts` 自身不能在这里 import（模块顶层就摸 document），所以对它只做静态核对。
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const webDir = resolve(here, '../web');

/** 逐条匹配 `import { a, b } from 'path'` / `import { a as b } from 'path'` */
const IMPORT_RE = /import\s*\{([^}]+)\}\s*from\s*'([^']+)'/g;

function specifiersOf(clause: string): { value: string[]; typeOnly: string[] } {
  const value: string[] = [];
  const typeOnly: string[] = [];
  for (const raw of clause.split(',')) {
    const item = raw.trim();
    if (!item) continue;
    if (item.startsWith('type ')) {
      typeOnly.push(item.slice(5).trim().split(/\s+as\s+/)[0] as string);
    } else {
      // `a as b`：运行时导出名是 `a`
      value.push((item.split(/\s+as\s+/)[0] as string).trim());
    }
  }
  return { value, typeOnly };
}

/** 把相对 specifier 解析成可动态 import 的 URL */
function toURL(spec: string): string {
  const abs = resolve(webDir, spec);
  return `file:///${abs.replace(/\\/g, '/')}`;
}

test('web/ui 每个模块都能被 import，且对外入口齐全', async () => {
  const dom = await import('../web/ui/dom.ts');
  for (const name of ['el', 'clear', 'buttonEl', 'fmtMMSS', 'heartRow', 'starText', 'stickerURL', 'toast', 'STICKER_DIR']) {
    assert.equal(typeof dom[name as keyof typeof dom], name === 'STICKER_DIR' ? 'string' : 'function', `dom.${name} 缺失`);
  }

  const text = await import('../web/ui/text.ts');
  for (const name of ['HOME', 'COLLECTION', 'LEADERBOARD', 'SETTINGS', 'SETTLEMENT', 'HONOR', 'FAIL', 'REVIVE', 'ADS', 'GUIDE', 'SAVE', 'STAR_PHRASE', 'tierOfLevel', 'VERSION', 'TITLE']) {
    assert.ok(name in text, `text.${name} 缺失`);
  }

  const dialog = await import('../web/ui/dialog.ts');
  for (const name of ['openDialog', 'closeDialog', 'confirmDialog', 'dialogOpen']) {
    assert.equal(typeof dialog[name as keyof typeof dialog], 'function', `dialog.${name} 缺失`);
  }

  const meta = await import('../web/ui/meta.ts');
  for (const name of ['createMeta', 'tickMeta', 'armRecovery', 'addStamina', 'adStaminaLeft', 'recordAdStamina', 'rollOverDay', 'staminaCountdown', 'unlockedImageIds', 'rewardImageOfLevel', 'COLLECTION_TOTAL', 'AD_STAMINA_DAILY_MAX', 'STAMINA_RECOVER_MS']) {
    assert.ok(name in meta, `meta.${name} 缺失`);
  }

  const guide = await import('../web/ui/guide.ts');
  assert.equal(typeof guide.createGuide, 'function');
  assert.ok(Array.isArray(guide.GUIDE_STEPS) && guide.GUIDE_STEPS.length === 5, '五步引导的步骤表缺失');

  // M6：存档相关的两个模块必须在 Node 里也能 import（无 DOM 依赖），否则接线检查就白做了
  const storage = await import('../web/ui/storage.ts');
  assert.equal(typeof storage.SAVE_KEY, 'string');
  for (const name of ['readSave', 'writeSave', 'removeSave', 'storageKind', 'resetStorageProbe']) {
    assert.equal(typeof storage[name as keyof typeof storage], 'function', `storage.${name} 缺失`);
  }

  const saveManager = await import('../web/ui/saveManager.ts');
  assert.equal(typeof saveManager.SaveManager, 'function', 'saveManager.SaveManager 缺失');

  const share = await import('../web/ui/share.ts');
  for (const name of ['downloadSticker', 'shareSticker', 'shareScore']) {
    assert.equal(typeof share[name as keyof typeof share], 'function', `share.${name} 缺失`);
  }
});

test('各界面模块的工厂函数存在（主控制器依赖它们）', async () => {
  // 首页与关卡地图合并成同一屏（web/ui/map.ts），主控制器建的就是这个工厂
  const home = await import('../web/ui/map.ts');
  assert.equal(typeof home.createMapScreen, 'function');

  const collection = await import('../web/ui/collection.ts');
  assert.equal(typeof collection.createCollectionScreen, 'function');
  assert.equal(typeof collection.createPreviewScreen, 'function');

  // 榜单数据改由 assets/scripts/core/honor.ts 的 boardSnapshot 组装（main.ts 传进 view()），
  // 界面模块自己不再造模拟数据，所以这里只核对工厂函数与「挑战」状态机。
  const leaderboard = await import('../web/ui/leaderboard.ts');
  assert.equal(typeof leaderboard.createLeaderboardScreen, 'function');
  assert.equal(typeof leaderboard.challengeState, 'function');
  assert.equal(leaderboard.LEADERBOARD_PAGE_SIZE, 20, '每页 20 名（《通关及排名》§七）');

  const settings = await import('../web/ui/settings.ts');
  assert.equal(typeof settings.createSettingsScreen, 'function');

  const ads = await import('../web/ui/ads.ts');
  assert.equal(typeof ads.runAd, 'function');
});

test('main.ts 的每个值导入都能在目标模块里找到（接线错误会当场报出来）', async () => {
  const source = readFileSync(resolve(webDir, 'main.ts'), 'utf8');
  // 先确认这个正则真的抓到了东西，否则「测试通过」只是因为它什么都没检查
  let checked = 0;

  for (const match of source.matchAll(IMPORT_RE)) {
    const clause = match[1] as string;
    const spec = match[2] as string;
    // 只核对相对路径的模块（assets/scripts/core 与 web/ui），浏览器内置的不管
    if (!spec.startsWith('./') && !spec.startsWith('../')) continue;

    const target = (await import(toURL(spec))) as Record<string, unknown>;
    const { value } = specifiersOf(clause);
    for (const name of value) {
      checked += 1;
      assert.ok(
        name in target,
        `main.ts 从 '${spec}' 导入了 ${name}，但该模块没有这个运行时导出`,
      );
    }
  }

  assert.ok(checked >= 40, `只核对了 ${checked} 个导入，正则或 import 写法变了，检查失效`);
});

/**
 * §7.2 的回归防护：`main.ts` 的关卡结束只由「倒计时归零」触发。
 *
 * 为什么用「读源码」这种笨办法：这两条规则的实现点都在 UI 层（`afterResolve` /
 * `onLevelEnd`），而 `web/main.ts` 顶层就摸 `document`，Node 里 import 不了、没有单测可写。
 *
 * 2026-09-11 这里曾经出现过「分数达到本关图数就结算」的写法 —— 效果是给每关加了
 * **隐藏分数上限**（星线最高 11 分，最大图数只有 10 张），第 3 关起 3★ 就永远拿不到；
 * 当时还留着一个 `timedOut` 入参来表达「结束原因」，等于给第二种结束条件留了门。
 * 所以宁可用两条拙一点的静态断言把它焊死。
 *
 * 判据（只查代码，不查注释 —— 注释里写「不要这么干」是好事，不该让断言炸掉）：
 *   1. `engine.score` 只允许出现在**展示与结算入参**里，不允许参与任何比较；
 *   2. 结算入口 `onLevelEnd()` 必须无参，且代码里不出现任何「结束原因」字段。
 */
test('main.ts 的关卡结束只由倒计时归零触发（§7.2 没有「达标立即通关」）', () => {
  const source = readFileSync(resolve(webDir, 'main.ts'), 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  // 先确认这个文件真的在用 engine.score，否则「没比较」可能只是因为什么都搜不到
  const reads = [...code.matchAll(/engine\.score/g)].length;
  assert.ok(reads >= 2, `main.ts 里 engine.score 只出现 ${reads} 次，正则或字段名变了，检查失效`);

  const comparisons = [...code.matchAll(/engine\.score\s*[<>]=?/g)].map((m) => m[0]);
  assert.deepStrictEqual(
    comparisons,
    [],
    `main.ts 出现了按分数结束关卡的判断（${comparisons.join('、')}）——` +
      '关卡只能由倒计时归零结束（§7.2 没有「达标立即通关」）。',
  );

  // 结束原因只能有一个：任何 timedOut 之类的入参都是在给第二种结束条件留门
  assert.ok(
    !/timedOut/.test(code),
    'main.ts 里又出现了「结束原因」字段 —— 关卡结束只有倒计时归零一种原因（§15.6 第 11 条）',
  );

  const calls = [...code.matchAll(/onLevelEnd\(\s*([^)]*)\)/g)].map((m) => m[1].trim());
  assert.ok(calls.length >= 2, `只找到 ${calls.length} 处 onLevelEnd 调用，正则或函数名变了，检查失效`);
  const withArgs = calls.filter((arg) => arg !== '');
  assert.deepStrictEqual(withArgs, [], `onLevelEnd 必须无参调用，实际出现了：${withArgs.join(' | ')}`);
});
