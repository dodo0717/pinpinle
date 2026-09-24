import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  STAMINA_MAX,
  applySettlement,
  commitSettlement,
  confirmStamina,
  createProgress,
  levelStatus,
  preDeductStamina,
  recordOf,
  refundStamina,
  settleLevel,
  starsFor,
  type LevelOutcome,
  type ProgressData,
} from '../assets/scripts/core/index';

/** 一关的星线（第 15 关的真实数值：5 / 7 / 9） */
const LINES = { star1: 5, star2: 7, star3: 9 };

function outcome(partial: Partial<LevelOutcome> = {}): LevelOutcome {
  return { level: 15, score: 6, ...LINES, revived: false, ...partial };
}

describe('M4 · 星级折算（§7.2）', () => {
  it('三星线都够到', () => {
    assert.strictEqual(starsFor(9, 5, 7, 9), 3);
    assert.strictEqual(starsFor(12, 5, 7, 9), 3);
  });

  it('星线边界是「达到即算」', () => {
    assert.strictEqual(starsFor(5, 5, 7, 9), 1);
    assert.strictEqual(starsFor(7, 5, 7, 9), 2);
    assert.strictEqual(starsFor(4, 5, 7, 9), 0);
    assert.strictEqual(starsFor(0, 5, 7, 9), 0);
  });

  it('严格递增的三条线：2★ 线本身不会被误判成 3★', () => {
    assert.strictEqual(starsFor(8, 5, 7, 9), 2);
  });
});

describe('M4 · 结算判定（§7.2 / §7.4 / §12.1）', () => {
  it('没够到 1★ 线 → 未通关，返回 null 交给失败结算', () => {
    assert.strictEqual(settleLevel(outcome({ score: 4 })), null);
  });

  it('玩满 180 秒（倒计时归零）且够到 1★ → 正常通关', () => {
    const s = settleLevel(outcome({ score: 6 }));
    assert.ok(s);
    assert.strictEqual(s.stars, 1);
    assert.strictEqual(s.kind, 'first');
  });

  it('分数可以超过本关图数，照样按星线判星（没有「达标立即通关」，也没有隐藏分数上限）', () => {
    // 第 60 关：图数 10 张，星线 7 / 9 / 11 —— 3★ 线本身就高于图数。
    // 曾经 `main.ts` 按「分数达到图数」提前结算，等于给每关加了 6/8/10 分的隐藏上限，
    // 第 3 关起 3★ 就再也拿不到（§15.6 第 11 条）。
    const s = settleLevel({ level: 60, score: 11, star1: 7, star2: 9, star3: 11, revived: false });
    assert.ok(s);
    assert.strictEqual(s.stars, 3, '3★ 线 11 分必须可达，不能被图数 10 张卡住');
    assert.strictEqual(starsFor(12, 7, 9, 11), 3, '超过 3★ 线继续拿 3★（分数没有上限）');
  });

  it('续命局统一判 1 星，哪怕分数够到 3★（§7.4）', () => {
    const s = settleLevel(outcome({ score: 12, revived: true }));
    assert.ok(s);
    assert.strictEqual(s.stars, 1, '续命局不能被判成 3 星');
  });

  it('续命也没救回来（分数没够 1★）仍然是失败', () => {
    assert.strictEqual(settleLevel(outcome({ score: 4, revived: true })), null);
  });

  it('首次通关 → 解锁下一关；重复通关 → 不解锁（但荣誉弹窗照样给「下一关」按钮）', () => {
    const first = settleLevel(outcome());
    assert.deepStrictEqual(
      { kind: first!.kind, unlockNext: first!.unlockNext },
      { kind: 'first', unlockNext: true },
    );

    const repeat = settleLevel(outcome({ score: 8 }), { stars: 1, personalBest: 6, boardBest: 6 });
    assert.deepStrictEqual(
      { kind: repeat!.kind, unlockNext: repeat!.unlockNext },
      { kind: 'repeat', unlockNext: false },
    );
  });

  it('四种结算形态都能被区分出来', () => {
    const cleared = { stars: 2, personalBest: 8, boardBest: 8 };
    const kinds = [
      [settleLevel(outcome(), undefined)!.kind, 'first'],
      [settleLevel(outcome(), cleared)!.kind, 'repeat'],
      [settleLevel(outcome({ revived: true }), undefined)!.kind, 'first-revived'],
      [settleLevel(outcome({ revived: true }), cleared)!.kind, 'repeat-revived'],
    ] as const;
    for (const [actual, expected] of kinds) assert.strictEqual(actual, expected);
  });
});

describe('M4 · 记录口径（§7.4 + 《通关及排名》：个人最高分 vs 上榜最高分）', () => {
  it('拿到 3★ 的普通局同时更新两个最高分', () => {
    const s = settleLevel(outcome({ score: 9 }))!;
    const rec = applySettlement(undefined, outcome({ score: 9 }), s);
    assert.deepStrictEqual(rec, { stars: 3, personalBest: 9, boardBest: 9 });
  });

  it('1★ / 2★ 成绩不上榜（《通关及排名》2026-09-12：上榜门槛 = 3★）', () => {
    const one = settleLevel(outcome({ score: 5 }))!;
    assert.strictEqual(applySettlement(undefined, outcome({ score: 5 }), one).boardBest, 0);
    assert.strictEqual(one.stars, 1);

    const two = settleLevel(outcome({ score: 8 }))!;
    const rec = applySettlement(undefined, outcome({ score: 8 }), two);
    assert.strictEqual(two.stars, 2);
    assert.strictEqual(rec.boardBest, 0, '2★ 也不上榜');
    assert.strictEqual(rec.personalBest, 8, '但个人最高分照常刷新');
  });

  it('低星成绩不会把已经上榜的 boardBest 冲掉', () => {
    const before = { stars: 3, personalBest: 12, boardBest: 12 };
    const o = outcome({ score: 6 });
    const rec = applySettlement(before, o, settleLevel(o, before)!);
    assert.strictEqual(rec.boardBest, 12);
    assert.strictEqual(rec.stars, 3);
  });

  it('续命局只更新个人最高分，不进上榜分（挡住「靠续命刷榜」）', () => {
    const before = { stars: 2, personalBest: 8, boardBest: 8 };
    const s = settleLevel(outcome({ score: 11, revived: true }), before)!;
    const rec = applySettlement(before, outcome({ score: 11, revived: true }), s);
    assert.strictEqual(rec.personalBest, 11, '个人最高分应该被刷新');
    assert.strictEqual(rec.boardBest, 8, '续命局不得抬高中上榜分');
    assert.strictEqual(rec.stars, 2, '历史星级只增不减');
  });

  it('分数变低不会把记录改小', () => {
    const before = { stars: 3, personalBest: 12, boardBest: 12 };
    const s = settleLevel(outcome({ score: 5 }), before)!;
    const rec = applySettlement(before, outcome({ score: 5 }), s);
    assert.deepStrictEqual(rec, before);
  });
});

describe('M4 · 关卡解锁（§7.3.3）', () => {
  const fresh = (): ProgressData => createProgress('normal');

  it('初始只开第 1 关', () => {
    const data = fresh();
    assert.strictEqual(levelStatus(data, 1), 'unlocked');
    assert.strictEqual(levelStatus(data, 2), 'locked');
  });

  it('首次达 1★ 解锁下一关，并把本关标成已通关', () => {
    const data = fresh();
    const o = outcome({ level: 1, score: 5 });
    const next = commitSettlement(data, o, settleLevel(o, undefined)!, 60);
    assert.strictEqual(next.unlocked, 2);
    assert.strictEqual(levelStatus(next, 1), 'cleared');
    assert.strictEqual(levelStatus(next, 2), 'unlocked');
    assert.strictEqual(levelStatus(next, 3), 'locked');
    assert.strictEqual(data.unlocked, 1, '不得就地修改入参');
  });

  it('重复通关不推进进度', () => {
    const first = (() => {
      const o = outcome({ level: 1, score: 5 });
      return commitSettlement(fresh(), o, settleLevel(o, undefined)!, 60);
    })();
    const o2 = outcome({ level: 1, score: 6 });
    const again = commitSettlement(first, o2, settleLevel(o2, recordOf(first, 1))!, 60);
    assert.strictEqual(again.unlocked, 2, '重复挑战不得把 unlocked 推到 3');
  });

  it('在已解锁的高关卡重复挑战低关卡，不会把 unlocked 收回去', () => {
    const o1 = outcome({ level: 1, score: 5 });
    let data = commitSettlement(fresh(), o1, settleLevel(o1, undefined)!, 60);
    const o5 = outcome({ level: 5, score: 5 });
    data = commitSettlement(data, o5, settleLevel(o5, undefined)!, 60);
    assert.strictEqual(data.unlocked, 6);

    const redo = outcome({ level: 1, score: 5 });
    data = commitSettlement(data, redo, settleLevel(redo, recordOf(data, 1))!, 60);
    assert.strictEqual(data.unlocked, 6, 'unlocked 只增不减');
    assert.strictEqual(recordOf(data, 1).stars, 1, '该关最高星仍是 1（重打没变高）');
  });

  it('最后一关通关不会把 unlocked 溢出到总关数之外', () => {
    const o = outcome({ level: 60, score: 5 });
    const data = commitSettlement(fresh(), o, settleLevel(o, undefined)!, 60);
    assert.strictEqual(data.unlocked, 60);
  });

  it('recordOf 对没打过的关卡返回全 0，不返回 undefined', () => {
    assert.deepStrictEqual(recordOf(fresh(), 42), { stars: 0, personalBest: 0, boardBest: 0 });
  });
});

describe('M4 · 入场计费（§12.4：预扣 → 转正 → 退还）', () => {
  it('预扣成功会真的减 1 颗', () => {
    const r = preDeductStamina({ available: 3, pending: 0 });
    assert.ok(r.ok);
    assert.deepStrictEqual(r.state, { available: 2, pending: 1 });
  });

  it('没体力时拒绝进入，并说明原因', () => {
    const r = preDeductStamina({ available: 0, pending: 0 });
    assert.deepStrictEqual(r, { ok: false, reason: 'exhausted' });
  });

  it('同一局不能预扣两次', () => {
    const r = preDeductStamina({ available: 3, pending: 1 });
    assert.deepStrictEqual(r, { ok: false, reason: 'already-pending' });
  });

  it('渲染完成转正式扣除后，这颗不再退还', () => {
    const entered = preDeductStamina({ available: 3, pending: 0 });
    assert.ok(entered.ok);
    const confirmed = confirmStamina(entered.state);
    assert.deepStrictEqual(confirmed, { available: 2, pending: 0 });
    assert.deepStrictEqual(refundStamina(confirmed), confirmed, '转正之后退还是空操作');
  });

  it('加载超时/中途退出 → 退还 1 颗', () => {
    const entered = preDeductStamina({ available: 3, pending: 0 });
    assert.ok(entered.ok);
    assert.deepStrictEqual(refundStamina(entered.state), { available: 3, pending: 0 });
  });

  it('退还不会把体力刷过上限', () => {
    assert.deepStrictEqual(refundStamina({ available: STAMINA_MAX, pending: 1 }), {
      available: STAMINA_MAX,
      pending: 0,
    });
  });

  it('「预扣 → 退还」循环不产生净收益', () => {
    let state = { available: 2, pending: 0 };
    for (let i = 0; i < 5; i++) {
      const entered = preDeductStamina(state);
      assert.ok(entered.ok);
      state = refundStamina(entered.state);
    }
    assert.deepStrictEqual(state, { available: 2, pending: 0 });
  });
});
