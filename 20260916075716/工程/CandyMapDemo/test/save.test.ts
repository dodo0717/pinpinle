/**
 * M6 存档层的单测（§16）。
 *
 * 存档是**外部输入**：可能被改、被截断、来自旧版本、还可能在动画播到一半时被强杀。
 * 所以这里的三组断言不是「顺手补的覆盖率」，而是三条必须成立的口径：
 *
 *   1. **坏档不许让游戏起不来** —— 任何字段坏掉都要按字段降级 + 逐条说明，
 *      整档不可用时才作废；`parseSave` 永远不抛错；
 *   2. **断点必须真的能接上** —— 「恢复出来的棋盘 + 随机源」与「没退出过的同一局」
 *      必须逐格一致，尤其**补位序列不能分叉**（只存种子会分叉，所以存的是 Rng 状态）；
 *   3. **防滥用是算术，不是感觉** —— 1 分钟内退出 ≥3 次才不再暂停倒计时，边界要能算清。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  GRID_BY_LEVEL,
  PuzzleEngine,
  Rng,
  SAVE_VERSION,
  STAMINA_MAX,
  TIME_LIMIT,
  TOTAL_LEVELS,
  buildLevelConfigs,
  createSaveData,
  parseSave,
  resumeTimeLeft,
  serializeSave,
  validateSnapshot,
  type LevelSession,
  type SaveData,
  type SaveLimits,
} from '../assets/scripts/core/index.ts';

/** 与 `web/main.ts` 组装的 SAVE_LIMITS 同口径（广告上限取 §13.3 的 5） */
const LIMITS: SaveLimits = {
  totalLevels: TOTAL_LEVELS,
  staminaMax: STAMINA_MAX,
  timeLimit: TIME_LIMIT,
  adStaminaDailyMax: 5,
};

const T0 = 1_700_000_000_000; // 固定基准时刻，避免用例之间互相干扰

function fresh(): SaveData {
  return createSaveData('normal', T0);
}

/** 造一条结构合法的局内断点（棋盘直接借真引擎，避免手写 20 个碎片 ID） */
function realSession(level = 1, overrides: Partial<LevelSession> = {}): LevelSession {
  const cfg = buildLevelConfigs('normal').find((c) => c.level === level);
  if (!cfg) throw new Error(`测试数据缺少第 ${level} 关`);
  const rng = new Rng(1234);
  const engine = new PuzzleEngine(cfg, rng);
  return {
    mode: 'normal',
    level,
    seed: 1234,
    rngState: rng.snapshot,
    cells: engine.board.toArray(),
    score: 0,
    eliminations: 0,
    timeLeft: cfg.timeLimit,
    started: false,
    revived: false,
    revivedUsed: false,
    swapMisses: 0,
    eliminatedOnce: false,
    savedAt: T0,
    ...overrides,
  };
}

describe('save —— 往返一致与出厂值', () => {
  it('serialize → parse 之后数据完全一致', () => {
    const data = fresh();
    data.mode = 'nightmare';
    data.meta.stamina = { available: 3, pending: 0 };
    data.meta.adStaminaUsed = 2;
    data.meta.settings.bgm = false;
    data.progress.normal.unlocked = 4;
    data.progress.normal.levels[3] = { stars: 2, personalBest: 210, boardBest: 180 };
    data.session = realSession(1, { score: 1, timeLeft: 77, started: true });

    const result = parseSave(serializeSave(data), fresh(), LIMITS, T0);

    assert.equal(result.discarded, false);
    assert.equal(result.recovered, false, `不该有修复项：${result.issues.join('；')}`);
    assert.deepEqual(result.data, data);
  });

  it('出厂值：满体力 / 第 1 关解锁 / 无断点 / 两种模式都有进度', () => {
    const data = fresh();
    assert.equal(data.version, SAVE_VERSION);
    assert.equal(data.meta.stamina.available, STAMINA_MAX);
    assert.equal(data.meta.stamina.pending, 0);
    assert.equal(data.meta.guideDone, false);
    assert.equal(data.session, null);
    assert.equal(data.progress.normal.unlocked, 1);
    assert.equal(data.progress.nightmare.unlocked, 1);
  });
});

describe('save —— 坏档降级（parseSave 永不抛错）', () => {
  it('★ 没有存档（首次启动）不是错误：安静按新档开始，不许弹「读取失败」', () => {
    for (const raw of [null, undefined, '', '   ']) {
      const result = parseSave(raw, fresh(), LIMITS, T0);
      assert.equal(result.discarded, false, `${JSON.stringify(raw)} 不该被当成坏档`);
      assert.equal(result.recovered, false, `${JSON.stringify(raw)} 不该被当成「修复过」`);
      assert.deepEqual(result.issues, []);
      assert.equal(result.data.meta.stamina.available, STAMINA_MAX, '应按新档满体力开始');
    }
  });

  it('截断的 JSON / 非对象 → 整档作废并给出原因', () => {
    for (const raw of ['{"version":1,"mode":', 'null', '123', '[]', '"字符串"']) {
      const result = parseSave(raw, fresh(), LIMITS, T0);
      assert.equal(result.discarded, true, `${JSON.stringify(raw)} 应被判定为整档作废`);
      assert.ok(result.issues.length > 0, '作废必须带原因，不能静默');
    }
  });

  it('版本不符 → 整档作废（返回兜底对象本体）', () => {
    const fb = fresh();
    const result = parseSave(JSON.stringify({ version: SAVE_VERSION + 1 }), fb, LIMITS, T0);
    assert.equal(result.discarded, true);
    assert.equal(result.data, fb, '整档作废应原样返回兜底对象');
    assert.match(result.issues[0] ?? '', /版本/);
  });

  it('进度越界：unlocked / 星级 / 越界关卡记录都被拦下', () => {
    const raw = {
      version: SAVE_VERSION,
      mode: 'normal',
      savedAt: T0,
      progress: {
        normal: {
          mode: 'normal',
          unlocked: 999,
          levels: { 1: { stars: 9, personalBest: -3, boardBest: 8 }, 999: { stars: 3, personalBest: 5, boardBest: 5 } },
        },
        nightmare: { mode: 'nightmare', unlocked: 1, levels: {} },
      },
      meta: {},
      session: null,
    };
    const result = parseSave(JSON.stringify(raw), fresh(), LIMITS, T0);

    assert.equal(result.discarded, false, '字段级问题不该作废整档');
    assert.equal(result.recovered, true);
    const normal = result.data.progress.normal;
    assert.equal(normal.unlocked, 1, 'unlocked=999 越界，应退回第 1 关');
    assert.deepEqual(normal.levels[999], undefined, '越界关卡记录应被丢弃');
    assert.equal(normal.levels[1]?.stars, 0, '星级 9 应被夹到 0');
    assert.equal(normal.levels[1]?.personalBest, 0, '负分应被夹到 0');
    assert.ok(result.issues.some((s) => s.includes('999')), `应指出越界关卡号：${result.issues.join('；')}`);
  });

  it('有通关记录但 unlocked 落后 → 自动抬到最高已通关关卡（不许自相矛盾）', () => {
    const raw = {
      version: SAVE_VERSION,
      mode: 'normal',
      progress: {
        normal: { mode: 'normal', unlocked: 1, levels: { 5: { stars: 1, personalBest: 40, boardBest: 40 } } },
      },
      meta: {},
      session: null,
    };
    const result = parseSave(JSON.stringify(raw), fresh(), LIMITS, T0);
    assert.equal(result.data.progress.normal.unlocked, 5);
  });

  it('元系统越界：体力 / 广告次数 / 恢复时间戳 / 开关类型都被降级', () => {
    const raw = {
      version: SAVE_VERSION,
      mode: 'normal',
      progress: {},
      meta: {
        stamina: { available: 99, pending: 2 },
        nextRecoverAt: 'soon',
        adDay: 42,
        adStaminaUsed: 99,
        settings: { sound: 'yes', bgm: false },
        guideDone: 'true',
      },
      session: null,
    };
    const result = parseSave(JSON.stringify(raw), fresh(), LIMITS, T0);
    const meta = result.data.meta;

    assert.equal(meta.stamina.available, STAMINA_MAX, '体力 99 越界 → 按满体力兜底');
    assert.equal(meta.stamina.pending, 0, 'pending 只允许 0/1');
    assert.equal(meta.nextRecoverAt, null, '时间戳不是数字 → 不显示倒计时');
    assert.equal(meta.adStaminaUsed, 0);
    assert.equal(meta.settings.sound, true, '非布尔 → 用默认值');
    assert.equal(meta.settings.bgm, false, '合法值必须保留');
    assert.equal(meta.guideDone, false, '非布尔 → 默认未走过引导');
    assert.ok(typeof meta.adDay === 'string' && meta.adDay.length > 0, 'adDay 必须落回当天的字符串');
    assert.ok(result.issues.length >= 4, `应逐条说明：${result.issues.join('；')}`);
  });

  it('局内断点不自洽 → 整段丢弃（宁丢一局，不带着违法棋盘继续玩）', () => {
    const cases: Array<[string, Partial<LevelSession>]> = [
      ['棋盘格数不符', { cells: [0, 1, 2] }],
      ['棋盘有空位', { cells: realSession().cells.map((c, i) => (i === 0 ? null : c)) as unknown as number[] }],
      ['碎片重复', { cells: realSession().cells.map(() => 4) }],
      ['时间越界', { timeLeft: TIME_LIMIT + 10 }],
      ['随机源状态非法', { rngState: 0 }],
      ['关卡号越界', { level: TOTAL_LEVELS + 1 }],
      ['模式非法', { mode: 'hard' as never }],
    ];

    for (const [why, patch] of cases) {
      const session = realSession(1, patch);
      const raw = { ...fresh(), session };
      const result = parseSave(JSON.stringify(raw), fresh(), LIMITS, T0);
      assert.equal(result.data.session, null, `${why}：断点应被丢弃`);
      assert.ok(
        result.issues.some((s) => s.includes('局内断点')),
        `${why}：必须说明是断点问题 —— ${result.issues.join('；')}`,
      );
    }
  });

  it('缺字段但结构合法的断点 → 保留（不该因为少个布尔就丢一局）', () => {
    const session = realSession(1);
    const raw = { ...fresh(), session: { ...session, started: undefined, swapMisses: undefined } };
    const result = parseSave(JSON.stringify(raw), fresh(), LIMITS, T0);
    assert.ok(result.data.session, '断点应保留');
    assert.equal(result.data.session?.started, false);
    assert.equal(result.data.session?.swapMisses, 0);
  });
});

describe('save —— 断点能真的接上（恢复后棋盘与随机序列都不许分叉）', () => {
  it('Rng.restore：非法状态必须抛错，而不是静默换种子', () => {
    for (const bad of [0, -1, 1.5, Number.NaN, 0x1_0000_0000]) {
      assert.throws(() => Rng.restore(bad), `状态 ${bad} 应抛错`);
    }
  });

  it('Rng.restore(state) 与原本的随机序列完全一致', () => {
    const a = new Rng(20260911);
    for (let i = 0; i < 37; i++) a.next();
    const b = Rng.restore(a.snapshot);
    for (let i = 0; i < 50; i++) {
      assert.equal(b.next(), a.next(), `第 ${i} 个随机数分叉了`);
    }
  });

  it('引擎快照往返：棋盘 / 得分 / 消除组数逐项一致', () => {
    const cfg = buildLevelConfigs('normal').find((c) => c.rows === 4 && c.cols === 4);
    assert.ok(cfg);
    const rng = new Rng(777);
    const a = new PuzzleEngine(cfg, rng);
    for (const [x, y] of [[0, 1], [5, 6], [10, 11]] as const) a.move(x, y);

    const snap = a.toSnapshot();
    const b = new PuzzleEngine(cfg, Rng.restore(rng.snapshot), snap);

    assert.deepEqual(b.board.toArray(), a.board.toArray());
    assert.equal(b.score, a.score);
    assert.equal(b.eliminations, a.eliminations);
    assert.deepEqual(b.invariantIssues(), [], '恢复出来的局面必须仍然合法');
  });

  it('★ 恢复后继续交换，补位结果与「从没退出过」的那一局完全一致', () => {
    const cfg = buildLevelConfigs('normal').find((c) => c.rows === 4 && c.cols === 4);
    assert.ok(cfg);
    const rng = new Rng(424242);
    const a = new PuzzleEngine(cfg, rng);
    for (const [x, y] of [[0, 1], [5, 6], [10, 11]] as const) a.move(x, y);

    // b = 在「a 交换三次之后」被强杀、再从存档恢复出来的那一局
    const b = new PuzzleEngine(cfg, Rng.restore(rng.snapshot), a.toSnapshot());

    // 之后对两局做完全相同的操作：只要随机源状态存对了，补位不可能分叉
    const rest: Array<[number, number]> = [[2, 3], [8, 9], [6, 7], [13, 14], [4, 8]];
    for (const [x, y] of rest) {
      a.move(x, y);
      b.move(x, y);
    }

    assert.deepEqual(b.board.toArray(), a.board.toArray(), '恢复后棋盘与退出前分叉了');
    assert.equal(b.score, a.score, '恢复后得分分叉了');
    assert.deepEqual(b.invariantIssues(), [], '恢复出来的局面必须是合法局面');
  });

  it('validateSnapshot 能指认每一种不自洽', () => {
    const cfg = buildLevelConfigs('normal').find((c) => c.rows === 4 && c.cols === 4);
    assert.ok(cfg);
    const engine = new PuzzleEngine(cfg, new Rng(9));
    const ok = engine.toSnapshot();
    assert.deepEqual(validateSnapshot(cfg, ok), []);

    assert.ok(validateSnapshot(cfg, { ...ok, cells: ok.cells.slice(1) }).length > 0, '缺格应报出');
    assert.ok(validateSnapshot(cfg, { ...ok, score: -1 }).length > 0, '负分应报出');
    assert.ok(
      validateSnapshot(cfg, { ...ok, cells: ok.cells.map(() => 0) }).length > 0,
      '重复碎片应报出（违反 HC-03）',
    );
    const outOfPool = [...ok.cells];
    outOfPool[0] = 0; // 第 1 关不含图 0 时才算越界；含则本条退化为重复碎片，仍应报出
    assert.ok(validateSnapshot(cfg, { ...ok, cells: outOfPool }).length > 0);
  });

  it('引擎用坏快照构造时必须当场抛错（不能带病开局）', () => {
    const cfg = buildLevelConfigs('normal').find((c) => c.rows === 4 && c.cols === 4);
    assert.ok(cfg);
    assert.throws(
      () => new PuzzleEngine(cfg, new Rng(1), { cells: [1, 2, 3], score: 0, eliminations: 0 }),
      /存档快照/,
    );
  });
});

describe('save —— 离线计时：退出后倒计时照走（§16 新口径）', () => {
  it('离开多久就扣多久，按秒向下取整', () => {
    const session = realSession(1, { timeLeft: 88, started: true, savedAt: T0 });
    assert.equal(resumeTimeLeft(session, T0), 88, '没离开就该原样');
    assert.equal(resumeTimeLeft(session, T0 + 10_500), 77, '离开 10.5 秒：剩 77.5 秒，向下取整 77');
    assert.equal(resumeTimeLeft(session, T0 + 600_000), 0, '离开十分钟直接扣光');
  });

  it('扣到 0 就停，绝不返回负数（界面正是靠 0 判定「本局已结束」）', () => {
    const session = realSession(1, { timeLeft: 30, started: true, savedAt: T0 });
    assert.equal(resumeTimeLeft(session, T0 + 999_000), 0);
  });

  it('进关后还没点棋盘（`started=false`）的一局不扣：计时本来就还没启动', () => {
    const session = realSession(1, { timeLeft: 90, started: false, savedAt: T0 });
    assert.equal(resumeTimeLeft(session, T0 + 600_000), 90, '没开始走表，离线期间也不该走');
  });

  it('`savedAt` 损坏成 0 时按「已过去很久」处理 → 判负，而不是白送一次暂停', () => {
    const session = realSession(1, { timeLeft: 90, started: true, savedAt: 0 });
    assert.equal(resumeTimeLeft(session, T0), 0);
  });

  it('时间基准跟着断点落盘、读回，恢复时能接着算（不是读回 0）', () => {
    const data = fresh();
    data.session = realSession(1, { timeLeft: 77, started: true, savedAt: T0 - 5_000 });
    const result = parseSave(serializeSave(data), fresh(), LIMITS, T0);
    assert.equal(result.discarded, false);
    assert.equal(result.data.session?.savedAt, T0 - 5_000);
    assert.equal(resumeTimeLeft(result.data.session!, T0), 72);
  });

  it('旧档里遗留的 `quits` 字段被忽略（旧档不必因为多了个字段就整档作废）', () => {
    const data = fresh();
    // 去重/防滥用逻辑下线前写下的档里带着这个字段，读档时直接忽略即可
    const legacy: Record<string, unknown> = { ...realSession(1, { timeLeft: 60, savedAt: T0 }), quits: [T0, T0] };
    data.session = legacy as unknown as LevelSession;
    const result = parseSave(serializeSave(data), fresh(), LIMITS, T0);
    assert.equal(result.discarded, false);
    assert.equal(result.data.session?.timeLeft, 60);
  });
});

describe('save —— 存储适配器与落盘调度（web 层，可在 Node 里跑）', () => {
  it('既没有 wx 也没有 localStorage 时降级为内存，读写往返仍然成立', async () => {
    const storage = await import('../web/ui/storage.ts');
    storage.resetStorageProbe();

    assert.equal(storage.storageKind(), 'memory', 'Node 环境必须降级为内存而不是抛错');
    assert.equal(storage.readSave(), null);
    assert.equal(storage.writeSave('{"version":1}'), true);
    assert.equal(storage.readSave(), '{"version":1}');
    storage.removeSave();
    assert.equal(storage.readSave(), null, '清档之后必须读不回来');
  });

  it('flush 立即落盘；连续 markDirty 合并成一次写入（§16「<1 秒连续交换合并」）', async () => {
    const { SaveManager } = await import('../web/ui/saveManager.ts');
    const storage = await import('../web/ui/storage.ts');
    storage.resetStorageProbe();
    storage.removeSave();

    let snapshots = 0;
    const manager = new SaveManager({
      snapshot: () => {
        snapshots += 1;
        return createSaveData('normal', T0);
      },
      canWrite: () => true,
      debounceMs: 5,
    });

    assert.equal(manager.flush(), true);
    assert.notEqual(storage.readSave(), null, 'flush 之后盘上必须有东西');
    assert.equal(snapshots, 1);

    manager.markDirty();
    manager.markDirty();
    manager.markDirty();
    assert.equal(snapshots, 1, '防抖窗口内不该落盘');

    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(snapshots, 2, '三次 markDirty 应合并成一次落盘');
    assert.equal(manager.stats.writes, 2);
  });

  it('动画播放中（canWrite=false）写入被推迟，动画结束后补上而不是丢掉（§16）', async () => {
    const { SaveManager } = await import('../web/ui/saveManager.ts');
    const storage = await import('../web/ui/storage.ts');
    storage.resetStorageProbe();
    storage.removeSave();

    let playing = true;
    const manager = new SaveManager({
      snapshot: () => createSaveData('normal', T0),
      canWrite: () => !playing,
      debounceMs: 5,
    });

    manager.markDirty();
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(manager.stats.writes, 0, '动画期间不许落盘');
    assert.ok(manager.stats.deferred >= 1, '应当是被推迟，而不是静默丢掉');
    assert.equal(storage.readSave(), null, '盘上不该出现事务中间态');

    playing = false;
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(manager.stats.writes, 1, '动画结束后必须补上这次写入');
    assert.notEqual(storage.readSave(), null);
  });

  it('写入失败只报一次，不刷屏（隐私模式 / 配额满）', async () => {
    const { SaveManager } = await import('../web/ui/saveManager.ts');

    const errors: string[] = [];
    const manager = new SaveManager({
      snapshot: () => createSaveData('normal', T0),
      canWrite: () => true,
      // 注入一个恒定失败的落盘实现：失败这条路必须真的走一遍
      write: () => false,
      onWriteError: (message) => errors.push(message),
    });

    assert.equal(manager.flush(), false);
    assert.equal(manager.flush(), false);
    assert.equal(errors.length, 1, '同一次故障只提示一次，不能每次落盘都弹一遍');
    assert.equal(manager.stats.writes, 0, '写失败不计入成功次数');
  });
});

describe('save —— 棋盘格数与关卡表一致（GRID_BY_LEVEL 口径）', () => {
  it('每一关的断点格数都等于该关的 rows×cols', () => {
    for (const [levelText, [rows, cols]] of Object.entries(GRID_BY_LEVEL)) {
      const level = Number(levelText);
      const session = realSession(level);
      assert.equal(
        session.cells.length,
        rows * cols,
        `第 ${level} 关应为 ${rows}×${cols}=${rows * cols} 格`,
      );
    }
  });
});
