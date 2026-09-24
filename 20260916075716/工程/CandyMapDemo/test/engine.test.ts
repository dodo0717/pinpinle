import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildLevelConfigs } from '../assets/scripts/core/config';
import { PuzzleEngine } from '../assets/scripts/core/engine';
import { isAdjacent } from '../assets/scripts/core/grid';
import { Rng } from '../assets/scripts/core/rng';
import { randomAdjacentPair } from './helpers';

const CONFIGS = buildLevelConfigs();
/** 全表实际使用的三种段位（每行 ≤4、每列 ≤5，24 格段位已取消） */
const GRIDS: Array<[number, number]> = [
  [3, 4],
  [4, 4],
  [5, 4],
];

function configOf(rows: number, cols: number) {
  const cfg = CONFIGS.find((c) => c.rows === rows && c.cols === cols);
  if (!cfg) throw new Error(`缺少 ${rows}×${cols} 的关卡配置`);
  return cfg;
}

/** 取噩梦模式（整片每次只能挪 1 格）里同网格的关卡配置 */
function nightmareConfigOf(rows: number, cols: number) {
  const cfg = buildLevelConfigs('nightmare').find((c) => c.rows === rows && c.cols === cols);
  if (!cfg) throw new Error(`噩梦模式缺少 ${rows}×${cols} 的关卡配置`);
  return cfg;
}

describe('engine —— 移动规则（普通模式任意距离 / 噩梦模式只能 1 格）', () => {
  it('普通模式 ruleAllows 恒为 true：跨全盘、对角线都允许', () => {
    const engine = new PuzzleEngine(configOf(4, 4), new Rng(3));
    assert.ok(engine.ruleAllows(0, 15), '左上↔右下应允许');
    assert.ok(engine.ruleAllows(5, 6), '跨行不相邻应允许');
    assert.ok(engine.ruleAllows(0, 1), '相邻当然也允许');
  });

  it('噩梦模式只接受 1 格位移（上下左右），对角线与隔一格都不算', () => {
    const engine = new PuzzleEngine(nightmareConfigOf(4, 4), new Rng(3));
    assert.ok(engine.ruleAllows(0, 1), '左右相邻应允许');
    assert.ok(engine.ruleAllows(0, 4), '上下相邻应允许');
    assert.ok(!engine.ruleAllows(0, 5), '对角线不算相邻');
    assert.ok(!engine.ruleAllows(0, 2), '隔一格不算相邻');
    assert.ok(!engine.ruleAllows(0, 0), '同一格不算相邻');
  });

  it('噩梦模式下位移超过 1 格被拒绝，且棋盘、得分完全不变', () => {
    const engine = new PuzzleEngine(nightmareConfigOf(4, 4), new Rng(5));
    const before = engine.board.toArray();
    const outcome = engine.move(0, 5);
    assert.strictEqual(outcome.accepted, false, '对角线不是 1 格位移，应被拒绝');
    assert.strictEqual(outcome.rejectReason, 'rule');
    assert.deepStrictEqual(engine.board.toArray(), before);
    assert.strictEqual(engine.score, 0);
  });

  it('噩梦模式下 1 格位移被接受', () => {
    const engine = new PuzzleEngine(nightmareConfigOf(4, 4), new Rng(5));
    assert.strictEqual(engine.move(0, 1).accepted, true);
  });

  it('相邻规则的最少交换数是不低于普通模式的非负整数（下界性质）', () => {
    for (const [rows, cols] of GRIDS) {
      const normal = new PuzzleEngine(configOf(rows, cols), new Rng(9));
      const nightmare = new PuzzleEngine(nightmareConfigOf(rows, cols), new Rng(9));
      const exact = normal.minSwapsToCompleteTarget();
      const lower = nightmare.minAdjacentSwapsToCompleteTarget();
      assert.ok(exact !== null && lower !== null, `${rows}×${cols} 应都能算出结果`);
      assert.ok(Number.isInteger(lower) && lower >= 0, `相邻下界应为非负整数：${lower}`);
      assert.ok(lower >= exact, `${rows}×${cols} 相邻下界 ${lower} 不应低于任意交换的 ${exact}`);
    }
  });
});

describe('engine —— 标定接口 minSwapsToCompleteTarget（M8 方案A）', () => {
  it('四种网格都恒定返回 0~4 的整数（HC-01 保证场上恒有 1 张齐 4 块的图）', () => {
    for (const [rows, cols] of GRIDS) {
      for (let seed = 1; seed <= 30; seed++) {
        const engine = new PuzzleEngine(configOf(rows, cols), new Rng(seed));
        const swaps = engine.minSwapsToCompleteTarget();
        assert.ok(swaps !== null, `${rows}×${cols} seed=${seed} 应能算出最少交换数`);
        assert.ok(Number.isInteger(swaps) && swaps >= 0 && swaps <= 4, `交换数越界：${swaps}`);
      }
    }
  });

  it('是纯计算：调用后棋盘、得分、消除数完全不变', () => {
    const engine = new PuzzleEngine(configOf(5, 4), new Rng(7));
    const before = engine.board.toArray();
    engine.minSwapsToCompleteTarget();
    assert.deepStrictEqual(engine.board.toArray(), before);
    assert.strictEqual(engine.score, 0);
    assert.strictEqual(engine.eliminations, 0);
  });

  it('配合「任意交换」规则：交换后仍能算出下一步最少交换数', () => {
    const engine = new PuzzleEngine(configOf(5, 4), new Rng(11));
    engine.move(0, 19);
    const swaps = engine.minSwapsToCompleteTarget();
    assert.ok(swaps !== null && swaps >= 0 && swaps <= 4);
  });
});

describe('engine —— 移动事务（§6.1 / §6.3）', () => {
  it('任意两个格子（含非相邻）移动都被接受', () => {
    const engine = new PuzzleEngine(configOf(3, 4), new Rng(1));
    const out = engine.move(0, 5); // (0,0) ↔ (1,1) 斜对角
    assert.strictEqual(out.accepted, true);
  });

  it('原地不动（anchor === target）被拒绝', () => {
    const engine = new PuzzleEngine(configOf(3, 4), new Rng(2));
    const out = engine.move(3, 3);
    assert.strictEqual(out.accepted, false);
    assert.strictEqual(out.rejectReason, 'same');
  });

  it('1 格位移被接受，且移动后棋盘仍然满格', () => {
    const engine = new PuzzleEngine(configOf(3, 4), new Rng(3));
    const out = engine.move(0, 1);
    assert.strictEqual(out.accepted, true);
    assert.strictEqual(engine.board.emptyIndices().length, 0);
  });

  it('随机 1 格移动 15000 次，全程不变量成立', () => {
    const rng = new Rng(20260910);
    let moves = 0;
    let blocked = 0;
    for (const [rows, cols] of GRIDS) {
      const engine = new PuzzleEngine(configOf(rows, cols), new Rng(rng.int(0x7fffffff)));
      for (let i = 0; i < 5000; i++) {
        const [a, b] = randomAdjacentPair(engine.board, () => rng.next());
        const before = engine.board.toArray();
        assert.strictEqual(isAdjacent(engine.board, a, b), true);
        const out = engine.move(a, b);
        moves++;
        const issues = engine.invariantIssues();
        if (issues.length > 0) throw new Error(`第 ${i} 次移动后不变量被破坏：${issues.join('；')}`);
        if (out.accepted) {
          assert.notDeepStrictEqual(engine.board.toArray(), before);
        } else {
          // 整片贴边时，即使只挪 1 格也会被拒绝（单块时代不可能出现，现在是常态）
          assert.strictEqual(out.rejectReason, 'bounds');
          assert.deepStrictEqual(engine.board.toArray(), before);
          blocked++;
        }
      }
    }
    assert.strictEqual(moves, GRIDS.length * 5000);
    assert.ok(blocked < moves, `被盘边挡住的比例不该高到离谱：${blocked}/${moves}`);
  });

  it('压测 75000 次「消除 → 下压 → 补位」，永不触发兜底与强制构造', { timeout: 300000 }, () => {
    const ROUNDS_PER_SEED = 5000;
    const SEEDS = 5;

    let eliminations = 0;
    let fallbackUsed = 0;
    let forceConstructUsed = 0;
    let multiMatchViolations = 0;

    for (const [rows, cols] of GRIDS) {
      for (let s = 0; s < SEEDS; s++) {
        const engine = new PuzzleEngine(
          configOf(rows, cols),
          new Rng(s * 1000003 + rows * 97 + cols * 13 + 1),
        );

        for (let i = 0; i < ROUNDS_PER_SEED; i++) {
          const out = engine.forceCompleteTargetImage();
          if (!out) throw new Error(`第 ${i} 轮失败：找不到可完成的图（池子5）`);
          assert.strictEqual(out.accepted, true);
          assert.strictEqual(out.eliminatedGroups.length, 1);
          assert.strictEqual(out.eliminatedGroups[0]!.pieces.length, 4);

          if (out.usedSwapFallback) fallbackUsed++;
          if (out.usedForceConstruct) forceConstructUsed++;

          // 每次都全量自检（含 HC-01 ~ HC-06 与池子结构）
          const issues = engine.invariantIssues();
          if (issues.length > 0) {
            throw new Error(`${rows}×${cols} 第 ${i} 轮后不变量被破坏：${issues.join('；')}`);
          }
          // 融合组满 4 块必然已被消除 → 场上不应残留完整的融合组
          if (engine.completeMergeGroups().length !== 0) {
            throw new Error(`${rows}×${cols} 第 ${i} 轮后仍残留已拼好的融合组`);
          }
          eliminations++;
        }

        assert.strictEqual(engine.score, ROUNDS_PER_SEED);
        assert.strictEqual(engine.eliminations, ROUNDS_PER_SEED);
        multiMatchViolations += engine.multiMatchViolations;
      }
    }

    assert.strictEqual(eliminations, GRIDS.length * SEEDS * ROUNDS_PER_SEED);
    assert.strictEqual(eliminations, 75000);
    // §4.8.3：24 种排列中至少有 18 种必然通过 → 兜底与强制构造永远不该被触发
    assert.strictEqual(fallbackUsed, 0);
    assert.strictEqual(forceConstructUsed, 0);
    // HC-02：任何时刻都不可能同时出现 ≥2 组可消除区域
    assert.strictEqual(multiMatchViolations, 0);
  });

  it('融合组与消除判定一致：满 4 块的融合组必然是唯一可消除区域', () => {
    for (const [rows, cols] of GRIDS) {
      const engine = new PuzzleEngine(configOf(rows, cols), new Rng(rows * 1000 + cols));
      for (let i = 0; i < 200; i++) {
        const outcome = engine.forceCompleteTargetImage();
        assert.notStrictEqual(outcome, null);
        assert.strictEqual(engine.completeMergeGroups().length, 0);
        assert.strictEqual(engine.board.emptyIndices().length, 0);
      }
    }
  });
});

describe('engine —— 结算动画快照（stages）', () => {
  it('发生消除时给出「移动后 / 消除后」两帧，且空位与 eliminatedCells 严格对应', () => {
    for (const [rows, cols] of GRIDS) {
      const size = rows * cols;
      const engine = new PuzzleEngine(configOf(rows, cols), new Rng(rows * 31 + cols));

      for (let i = 0; i < 60; i++) {
        const outcome = engine.forceCompleteTargetImage();
        assert.notStrictEqual(outcome, null);

        const stages = outcome!.stages;
        assert.notStrictEqual(stages, undefined, '发生消除时必须交出中间态快照');

        assert.strictEqual(stages!.afterMove.length, size);
        assert.strictEqual(stages!.afterEliminate.length, size);
        assert.strictEqual(stages!.eliminatedCells.length, 4);

        // 「移动后」那一帧应当是满格：消除尚未执行
        assert.strictEqual(stages!.afterMove.filter((v) => v === null).length, 0);

        // 「消除后」那一帧的空位必须恰好是 eliminatedCells 那 4 格（下压前，其它碎片不动）
        const blanked = new Set(stages!.eliminatedCells);
        for (let c = 0; c < size; c++) {
          assert.strictEqual(
            stages!.afterEliminate[c] === null,
            blanked.has(c),
            `第 ${c} 格的空位状态与 eliminatedCells 不一致`,
          );
        }

        // 渲染层是按「碎片ID 在前后两帧分别落在哪一格」推掉落位移的，
        // 因此要求它在消除后那一帧里至多出现一次，否则来源不可判定
        for (const piece of engine.board.toArray()) {
          if (piece === null) continue;
          const hits = stages!.afterEliminate.filter((v) => v === piece).length;
          assert.ok(hits <= 1, `碎片 ${piece} 在消除后那一帧出现了 ${hits} 次`);
        }
      }
    }
  });
});

describe('engine —— 整片拖动（§1.6：粘合成整体后，拖其中任何一块都移动整片）', () => {
  it('整片移动后，原来那一组碎片必须整体落到新位置（不被拖散、不丢块）', () => {
    const rng = new Rng(20260912);
    let groupMoves = 0;
    let rejected = 0;
    let eliminated = 0;
    let checks = 0;

    for (const [rows, cols] of GRIDS) {
      const engine = new PuzzleEngine(configOf(rows, cols), new Rng(rng.int(0x7fffffff)));

      for (let i = 0; i < 3000; i++) {
        // ⚠️ 必须在每轮重新取：消除补位后引擎会整体换掉 Grid 实例
        const board = engine.board;
        // 优先挑一个真正的「整片」（≥2 块）来拖；盘上暂时没有成片时就拖单块。
        // 这样压测同时覆盖「单块 = 两块交换」与「多块刚性平移」两条路径。
        const merged = engine.mergeGroups().filter((g) => g.cells.length >= 2);
        const anchor =
          merged.length > 0 ? rng.pick(rng.pick(merged).cells) : rng.int(board.size);
        const target = rng.int(board.size);

        const before = board.toArray();
        const groupCells = engine.groupOfCell(anchor)?.cells ?? [anchor];
        const piecesBefore = groupCells.map((c) => before[c]);

        const out = engine.move(anchor, target);
        if (!out.accepted) {
          rejected++;
          assert.ok(
            out.rejectReason === 'same' || out.rejectReason === 'bounds' || out.rejectReason === 'rule',
            `拒绝原因应可解释：${out.rejectReason}`,
          );
          assert.deepStrictEqual(board.toArray(), before, '被拒绝的移动不得改动棋盘');
          continue;
        }
        if (groupCells.length >= 2) groupMoves++;
        checks++;

        if (out.eliminatedGroups.length > 0) {
          // 整片挪过去正好把缺口补齐 → 融合组满 4 块，同一帧被消除（§1.5.4）
          eliminated++;
          assert.strictEqual(out.eliminatedGroups[0]!.pieces.length, 4);
        } else {
          const after = board.toArray();
          // 刚性平移：整片里每一块都落到「自己 + 位移」那一格，一块不少（组可能被旁边的正确碎片粘大）
          const dr = board.rowOf(target) - board.rowOf(anchor);
          const dc = board.colOf(target) - board.colOf(anchor);
          for (let k = 0; k < groupCells.length; k++) {
            const from = groupCells[k]!;
            const to = board.index(board.rowOf(from) + dr, board.colOf(from) + dc);
            assert.strictEqual(after[to], piecesBefore[k], `第 ${i} 次移动：第 ${k} 块没有刚性跟随`);
          }
          assert.strictEqual(after[target], before[anchor], '锚点那块必须落在目标格');
          const movedGroup = engine.groupOfCell(target);
          assert.ok(movedGroup !== null, '锚点落点应仍在某一组里');
          assert.ok(
            movedGroup!.cells.length >= groupCells.length,
            `第 ${i} 次移动后整片被拖散了：${groupCells.length} → ${movedGroup!.cells.length}`,
          );
        }

        const issues = engine.invariantIssues();
        if (issues.length > 0) {
          throw new Error(`${rows}×${cols} 第 ${i} 次整片拖动后不变量被破坏：${issues.join('；')}`);
        }
      }
    }

    assert.ok(groupMoves >= 100, `应覆盖到足够多的多块整片拖动，实际 ${groupMoves}`);
    assert.ok(checks > 0 && rejected > 0, `接受 ${checks} 次 / 拒绝 ${rejected} 次都要覆盖到`);
    assert.ok(eliminated > 0, '整片拖动应当能触发「补齐缺口 → 消除」');
  });
});
