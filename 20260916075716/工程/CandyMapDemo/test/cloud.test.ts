import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CloudSync, cloudSync, resetCloudForTest, mergeCloudProgress, cloudDiff, REPORT_MODES,
  type CloudHost, type CloudLevelResult,
} from '../assets/scripts/玩法/cloud';
import type { ProgressData } from '../assets/scripts/核心/index';
import { recordOf } from '../assets/scripts/核心/index';

/**
 * 云同步接线检查：纯合并函数 + CloudSync 全流程（假宿主注入）。
 * 后端形状见 cloud.ts 头注释：{unlocked, stars:{关:星}, best:{关:分}}。
 */

function progress(levels: Record<number, { stars: number; personalBest?: number }>, unlocked: number): ProgressData {
  const out: ProgressData = { mode: 'normal', unlocked, levels: {} };
  for (const key of Object.keys(levels)) {
    const level = Number(key);
    const r = levels[level];
    out.levels[level] = { stars: r.stars, personalBest: r.personalBest ?? 0, boardBest: r.personalBest ?? 0 };
  }
  return out;
}

test('mergeCloudProgress：星级/最高分逐关取大，boardBest 保持本地', () => {
  const local = progress({ 1: { stars: 2, personalBest: 800 }, 2: { stars: 1, personalBest: 300 } }, 3);
  const merged = mergeCloudProgress(local, { stars: { 1: 3, 2: 1 }, best: { 1: 500, 2: 900 } });
  assert.equal(recordOf(merged, 1).stars, 3);            // 云 3 > 本地 2
  assert.equal(recordOf(merged, 1).personalBest, 800);   // 本地 800 > 云 500
  assert.equal(recordOf(merged, 2).personalBest, 900);   // 云 900 > 本地 300
  assert.equal(recordOf(merged, 2).boardBest, 300);      // 云端没有 boardBest，保持本地
  // 云端解锁推导：最高 ≥1★ 的关是 2 → unlocked 至少 3（本地已是 3，取大）
  assert.equal(merged.unlocked, 3);
  assert.notEqual(merged, local);                        // 有变化 → 新对象
});

test('mergeCloudProgress：无变化时返回原引用（调用方按引用跳过重画）', () => {
  const local = progress({ 1: { stars: 3, personalBest: 900 } }, 2);
  assert.equal(mergeCloudProgress(local, { stars: { 1: 2 }, best: { 1: 500 } }), local);
  assert.equal(mergeCloudProgress(local, null), local);
  assert.equal(mergeCloudProgress(local, 'junk'), local);
});

test('mergeCloudProgress：坏数据不炸——越界关号忽略、星级夹到 0~3、unlocked 夹到 totalLevels', () => {
  const local = progress({}, 1);
  const merged = mergeCloudProgress(local, { stars: { 0: 3, 61: 3, abc: 2, 5: 99 }, best: { 5: -10 } });
  assert.equal(recordOf(merged, 5).stars, 3);            // 99 → 夹 3
  assert.equal(recordOf(merged, 5).personalBest, 0);     // 负分 → 0
  assert.equal(recordOf(merged, 0).stars, 0);            // 关号 0 忽略
  assert.equal(recordOf(merged, 61).stars, 0);           // 越界忽略
  assert.equal(merged.unlocked, 6);                      // 通关 5 → 6
});

test('cloudDiff：只挑本地更优的关，按关号升序（升序补推才不撞后端跳关守卫）', () => {
  const local = progress({ 1: { stars: 3, personalBest: 900 }, 2: { stars: 1 }, 3: { stars: 2 } }, 4);
  const cloud = { stars: { 1: 3, 3: 2 }, best: { 1: 1000, 3: 50 } };
  const diff = cloudDiff(local, cloud);
  // 关 1：星持平但本地分 900 < 云 1000 → 不推；关 2：云端没有 → 推；关 3：星持平、分 50<云 → 不推
  assert.deepEqual(diff.map((d) => d.level), [2]);
  assert.equal(diff[0]!.win, true);
  assert.equal(diff[0]!.score, 0);                        // personalBest 默认 0（云端也没有，无增益）
  // 云端完全没有时：全部可推，升序
  const all = cloudDiff(local, null).map((d) => d.level);
  assert.deepEqual(all, [1, 2, 3]);
});

test('REPORT_MODES：v1 只含简单模式（困难模式被后端关卡守卫挡住）', () => {
  assert.deepEqual([...REPORT_MODES], ['normal']);
});

/* ---------------------------------------------------------------- 假宿主全流程 */

interface Captured { method: string; url: string; data?: unknown; header?: Record<string, string> }

function fakeHost(opts: {
  loginCode?: string;
  responses?: Array<{ match: (c: Captured) => boolean; status: number; body?: unknown }>;
  storage?: Map<string, string>;
} = {}) {
  const calls: Captured[] = [];
  const store = opts.storage ?? new Map<string, string>();
  const responses = opts.responses ?? [];
  const host: CloudHost = {
    login: async () => ({ code: opts.loginCode ?? 'wx-code' }),
    request: async (o) => {
      calls.push({ method: o.method, url: o.url, data: o.data, header: o.header });
      const hit = responses.find((r) => r.match({ method: o.method, url: o.url, data: o.data, header: o.header }));
      if (hit) return { statusCode: hit.status, data: hit.body };
      return { statusCode: 200, data: {} };
    },
    getStorage: (k) => store.get(k) ?? null,
    setStorage: (k, v) => { store.set(k, v); },
  };
  return { host, calls, store };
}

test('CloudSync：登录换 token → 拉档合并 → 本地更优的关补推上云', async () => {
  const local = progress({ 1: { stars: 3, personalBest: 900 }, 2: { stars: 2, personalBest: 400 } }, 3);
  const cloudJson = { unlocked: 2, stars: { 1: 2 }, best: { 1: 500 } };
  const { host, calls, store } = fakeHost({
    responses: [
      { match: (c) => c.url.endsWith('/auth/login'), status: 200, body: { token: 'T1', playerId: 42 } },
      { match: (c) => c.url.endsWith('/progress') && c.method === 'GET', status: 200, body: { progress: JSON.stringify(cloudJson) } },
      { match: (c) => c.url.endsWith('/level/result'), status: 200, body: { progress: JSON.stringify(cloudJson) } },
    ],
  });
  const cs = new CloudSync(host, 'https://x.example/');
  assert.equal(await cs.login(), true);
  assert.equal(cs.playerId, 42);
  assert.equal(store.get('pinpin.cloud.token'), 'T1');

  const merged = await cs.pull(local);
  assert.equal(recordOf(merged, 1).stars, 3);
  // 补推：关 1（星 3>2）和关 2（云端没有）各一条 POST
  const posts = calls.filter((c) => c.url.endsWith('/level/result'));
  assert.deepEqual(posts.map((p) => (p.data as { level: number }).level), [1, 2]);
  // 带 token 头
  assert.equal(posts[0]!.header!['Wx-Authorization'], 'Bearer T1');
});

test('CloudSync：上报失败进离线队列，flush 在下次登录后补传', async () => {
  const { host, calls, store } = fakeHost({
    responses: [
      { match: (c) => c.url.endsWith('/auth/login'), status: 200, body: { token: 'T1' } },
      // level/result 永远 500 → 上报失败
      { match: (c) => c.url.endsWith('/level/result'), status: 500 },
    ],
  });
  const cs = new CloudSync(host, 'https://x.example/');
  await cs.login();
  await cs.report({ level: 5, win: true, stars: 3, score: 700 } as CloudLevelResult);
  const queued = JSON.parse(store.get('pinpin.cloud.queue')!);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].level, 5);
  // flush：仍是 500 → 队列保留
  await cs.flush();
  assert.equal(JSON.parse(store.get('pinpin.cloud.queue')!).length, 1);
  assert.ok(calls.filter((c) => c.url.endsWith('/level/result')).length >= 2);
});

test('CloudSync：401 清 token 转纯本地（后续 pull 原样返回）', async () => {
  const local = progress({ 1: { stars: 1 } }, 2);
  const { host } = fakeHost({
    responses: [
      { match: (c) => c.url.endsWith('/auth/login'), status: 200, body: { token: 'T1' } },
      { match: (c) => c.url.endsWith('/progress') && c.method === 'GET', status: 401 },
    ],
  });
  const cs = new CloudSync(host, 'https://x.example/');
  await cs.login();
  assert.equal(await cs.pull(local), local);   // 401 → 原样返回
  assert.equal(cs.loggedIn, false);            // token 已清
  assert.equal(await cs.pull(local), local);   // 未登录 → 直接原样返回
});

test('cloudSync()：无 wx 的环境返回 null（浏览器/测试降级为纯本地）', () => {
  resetCloudForTest();
  assert.equal(cloudSync(), null);
  resetCloudForTest();
});

test('CloudSync.api()：登录态调任意接口，401 清 token，404 归入 null（二期接口静默）', async () => {
  const { host } = fakeHost({
    responses: [
      { match: (c) => c.url.endsWith('/auth/login'), status: 200, body: { token: 'T1' } },
      { match: (c) => c.url.endsWith('/game/api/invite'), status: 404 },
      { match: (c) => c.url.endsWith('/game/api/stamina'), status: 200, body: { code: 200, data: { value: 7, max: 10 } } },
      { match: (c) => c.url.endsWith('/expired'), status: 401 },
    ],
  });
  const cs = new CloudSync(host, 'https://x.example/');
  // 未登录 → null
  assert.equal(await cs.api('GET', '/game/api/stamina'), null);
  await cs.login();
  // 404（二期未上线）→ null 而不是抛
  assert.equal(await cs.api('POST', '/game/api/invite', { inviter: '42' }), null);
  // 200 → 返回若依响应体
  const ok = await cs.api('GET', '/game/api/stamina');
  assert.equal((ok as { data?: { value?: number } }).data!.value, 7);
  // 401 → 清 token 转 null
  assert.equal(await cs.api('GET', '/expired'), null);
  assert.equal(cs.loggedIn, false);
});

test('分享三件套：无 wx 全部安全降级', async () => {
  const { getInviter, enableShare, reportInviter } = await import('../assets/scripts/玩法/wxFriend');
  assert.equal(getInviter(), null);
  assert.doesNotThrow(() => enableShare(42));
  await assert.doesNotReject(() => reportInviter('x'));
});
