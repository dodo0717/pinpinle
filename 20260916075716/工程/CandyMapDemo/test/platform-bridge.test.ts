/**
 * 批次⑧ 接线单测 —— 重点是**没有 `wx` 时不能崩**。
 *
 * 为什么值得单独一个文件：平台层的三个模块（`平台/ads|share|track`）已经能跑，
 * 但「接进游戏之后在预览 shim / 浏览器里会不会因为拿不到宿主能力而抛异常」
 * 只有跑一遍才知道。这里把三条降级路径各跑一次，并顺手把「有 SDK 但没填广告位 id」
 * 这种**上线前一定会踩**的分支钉住。
 *
 * ⚠️ 往 `globalThis` 上塞假 `wx` 的用例**必须自己清理**（`delete`），
 *    否则会污染同一进程里后面跑的用例（`--test` 默认同进程并发跑文件）。
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';

import { createAds, type AdDenyReason } from '../assets/scripts/平台/ads';
import { createShare } from '../assets/scripts/平台/share';
import { EVENT } from '../assets/scripts/平台/track';
import {
  adDenyText, playAd, reportLevelEnd, reportLevelFail, reportLevelStart,
  resetPlatformBridge, setMenuShare, setPlatformToast, shareCard, sharer, startTracking, tracker,
} from '../assets/scripts/玩法/platformBridge';
import { ADS } from '../assets/scripts/玩法/text';

const here = dirname(fileURLToPath(import.meta.url));

/** 临时把假宿主挂上去；返回清理函数 */
function withFakeWx(api: Record<string, unknown>): () => void {
  const bag = globalThis as unknown as Record<string, unknown>;
  bag['wx'] = api;
  return () => {
    delete bag['wx'];
  };
}

/* ------------------------------------------------------------------ 广告 */

test('没有宿主广告能力时，续命广告走降级分支：照常给结果、不抛异常', async () => {
  resetPlatformBridge();
  const out = await playAd('revive');
  // 无 SDK → 落在 Web 模拟分支（`平台/ads.ts` 的三分支之二）
  assert.equal(out.port, 'web');
  assert.equal(out.result, 'watched');
});

test('明确不允许模拟时：available() 为假，play() 一律 failed + unavailable', async () => {
  const a = createAds({ allowSimulate: false });
  assert.equal(a.kind(), 'none');
  assert.equal(a.available('revive'), false);
  const out = await a.play('stamina');
  assert.equal(out.result, 'failed');
  assert.equal(out.reason, 'unavailable');
});

test('有激励视频 SDK 但没填广告位 id：按钮必须不亮（noUnit），不能亮了点不动', async () => {
  const clean = withFakeWx({
    createRewardedVideoAd: () => ({ onClose: () => {}, show: () => {} }),
  });
  try {
    const a = createAds();
    assert.equal(a.kind(), 'wx');
    assert.equal(a.available('revive'), false, '没填 adUnitId 就不该亮按钮');
    const out = await a.play('revive');
    assert.equal(out.result, 'failed');
    assert.equal(out.reason, 'noUnit');
  } finally {
    clean();
  }
});

test('真激励视频三种结果：看完 / 没看完 / 加载失败', async () => {
  const mk = (kind: 'watched' | 'skipped' | 'failed'): Record<string, unknown> => ({
    createRewardedVideoAd: () => ({
      onClose: (cb: (r: { isEnded?: boolean }) => void) => {
        if (kind === 'failed') return;
        cb({ isEnded: kind === 'watched' });
      },
      onError: (cb: (e: unknown) => void) => {
        if (kind === 'failed') cb(new Error('load fail'));
      },
      offClose: () => {},
      offError: () => {},
      show: () => {},
    }),
  });
  for (const kind of ['watched', 'skipped', 'failed'] as const) {
    const clean = withFakeWx(mk(kind));
    try {
      const a = createAds({ unitIds: { revive: 'adunit-test' } });
      const out = await a.play('revive');
      assert.equal(out.result, kind, `${kind} 分支结果不符`);
    } finally {
      clean();
    }
  }
});

test('广告被拦的每个原因都有能用的文案（界面不出现 undefined）', () => {
  const reasons: AdDenyReason[] = [
    'unavailable', 'disabled', 'noUnit', 'dailyLimit', 'cooldown', 'busy', 'failedTooMuch',
  ];
  for (const r of reasons) {
    const text = adDenyText(r);
    assert.equal(typeof text, 'string');
    assert.ok(text.length > 0, `${r} 没有文案`);
  }
  assert.equal(adDenyText(undefined), ADS.notReady);
});

/* ------------------------------------------------------------------ 分享 */

test('没有分享能力时：available() 为假，分享返回 unavailable 而不是抛异常', async () => {
  resetPlatformBridge();
  assert.equal(sharer().available(), false, '无宿主分享能力就该把入口藏起来');
  const out = await shareCard({ title: '我在第 1 关拿了 3 星' });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'unavailable');
});

test('分享降级：有剪贴板就复制链接算成功，没有就 unavailable', async () => {
  const ok = await createShare({ port: 'web', hooks: { copy: () => true } }).shareCard({ title: '成绩卡' });
  assert.equal(ok.ok, true);
  assert.equal(ok.port, 'web');

  const bad = await createShare({ port: 'web', hooks: { copy: () => false } }).shareCard({ title: '成绩卡' });
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, 'unavailable');
});

test('小游戏转发：success = 已拉起，fail = 玩家取消（不是 error）', async () => {
  const clean = withFakeWx({
    shareAppMessage: (m: { success?: () => void; fail?: () => void }) => {
      if (m.title.indexOf('取消') >= 0) m.fail?.();
      else m.success?.();
    },
  });
  try {
    const s = createShare();
    assert.equal(s.kind(), 'wx');
    assert.equal(s.available(), true);
    const ok = await s.shareCard({ title: '来玩同款', query: 'level=1' });
    assert.equal(ok.ok, true);

    const cancel = await s.shareCard({ title: '取消掉' });
    assert.equal(cancel.ok, false);
    assert.equal(cancel.reason, 'cancel');
  } finally {
    clean();
  }
});

test('提示钩子能收到降级文案（界面据此弹提示）', async () => {
  resetPlatformBridge();
  const got: string[] = [];
  setPlatformToast((m) => got.push(m));
  const s = createShare({ port: 'none', hooks: { toast: (m) => got.push(m) } });
  await s.shareCard({ title: 'x' });
  assert.ok(got.length > 0, '降级时至少要说一句为什么不行');
});

test('没有宿主入口时 setMenuShare 返回 false 而不是抛', () => {
  resetPlatformBridge();
  assert.equal(setMenuShare(() => ({ title: '萌宠拼拼乐' })), false);
});

/* ------------------------------------------------------------------ 埋点 */

test('没有上报端点时：事件只进本地缓冲，start 与关卡漏斗都不抛', () => {
  resetPlatformBridge();
  startTracking();
  reportLevelStart({ level: 3, mode: 'normal', attempt: 1 });
  reportLevelEnd({ level: 3, mode: 'normal', score: 12, stars: 2, revived: false, durationSec: 90 });
  reportLevelFail({ level: 4, mode: 'nightmare', score: 5 });

  const all = tracker().exportAll();
  const names = all.map((e) => e.e);
  assert.ok(names.includes(EVENT.sessionStart), '启动要发 session_start');
  assert.ok(names.includes(EVENT.levelStart));
  assert.ok(names.includes(EVENT.levelEnd));
  assert.ok(names.includes(EVENT.levelFail));

  const end = all.find((e) => e.e === EVENT.levelEnd)!;
  assert.equal(end.p.stars, 2);
  assert.equal(end.p.score, 12);
  assert.equal(end.p.revived, false);

  // 端点为空 → 纯本地（这条断言同时钉住「默认不发网络」）
  assert.ok(String(tracker().stats().endpoint).indexOf('off') >= 0);
});

test('播广告同时记 ad_show 与 ad_finish（名字以原版为准，不另造）', async () => {
  resetPlatformBridge();
  await playAd('stamina');
  const names = tracker().exportAll().map((e) => e.e);
  assert.ok(names.includes(EVENT.adShow));
  assert.ok(names.includes(EVENT.adFinish));
});

/* ------------------------------------------------------------------ 接线（静态核对） */

test('两个启动器确实接了平台层（防止后面被改回本地模拟）', () => {
  const gb = readFileSync(resolve(here, '../assets/scripts/玩法/GameBootstrap.ts'), 'utf8');
  const mb = readFileSync(resolve(here, '../assets/scripts/场景/MapBootstrap.ts'), 'utf8');
  assert.ok(gb.indexOf("playAd('revive')") >= 0, '续命广告必须走平台层');
  assert.ok(mb.indexOf("playAd('stamina')") >= 0, '加体力广告必须走平台层');
  assert.ok(gb.indexOf('reportLevelStart(') >= 0, '开局要记埋点');
  assert.ok(gb.indexOf('reportLevelEnd(') >= 0, '通关要记埋点');
  assert.ok(gb.indexOf('reportLevelFail(') >= 0, '确认失败要记埋点');
  assert.ok(!gb.includes('本地模拟'), 'GameBootstrap 不该再有本地模拟广告的注释');
});
