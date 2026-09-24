import { collapseColumns } from './collapse';
import type { LevelConfig } from './config';
import { Grid, swapCells, type Cell } from './grid';
import { buildInitialGrid } from './init';
import { findAllPositionCorrectMatches, validateBoard, type MatchRegion } from './matcher';
import { computeMergeGroups, isMergeGroupComplete, mergeGroupOfCell, type MergeGroup } from './merge';
import { applyGroupMove, planGroupMove, ruleAllowsShift, type MoveReject } from './move';
import { imageOf, pieceOf } from './pieces';
import { poolSnapshot, type PoolSnapshot } from './pools';
import { refillGrid } from './refill';
import { Rng } from './rng';

/**
 * 一次结算的中间态快照。
 *
 * 算法层本身是「一步到位」的（消除 → 下压 → 补位在 move() 内一次算完），
 * 但玩家需要看到过程，所以这里把关键的两帧棋盘也一并交出去，让渲染层
 * 能按「移动 → 消除 → 掉落 → 补位」的顺序回放动画。
 *
 * 之所以给「快照」而不是给「掉落路径」，是因为 §4.8.4 的兜底路径会搬运
 * 场上已有碎片，路径本身不一定是「垂直下落」；渲染层按「碎片ID 从哪格到了
 * 哪格」自行推导位移，比在算法层描述路径更稳，也不会把渲染概念渗进算法层。
 */
export interface ResolveStages {
  /** 移动完成、消除执行前的棋盘（含刚平移的整片与被压回的碎片） */
  afterMove: Cell[];
  /** 消除执行后、下压前的棋盘（被消除的 4 格为 null，其余仍在原位） */
  afterEliminate: Cell[];
  /** 本次被消除的格子下标（= 2×2 的 4 格） */
  eliminatedCells: number[];
}

/**
 * 把 `needed` 这 4 块碎片搬进 `cells` 这 4 个目标格，所需的最少交换次数。
 *
 * 用标准置换分解：从左到右，若当前目标格不是该放的碎片，就把那块碎片从它所在的格
 * 交换过来 —— 每轮至少让一个碎片归位，因此这就是最少交换数（= 4 − 置换的循环数）。
 *
 * 只做位置置换，不改变场上碎片集合，故不破坏池子结构。
 * 返回 -1 表示某块碎片不在场上（理论上不会发生）。
 * ⚠️ 就地修改传入的 `grid`，调用方需自行 clone。
 */
function placePieces(grid: Grid, cells: readonly number[], needed: readonly number[]): number {
  let swaps = 0;
  for (let i = 0; i < 4; i++) {
    if (grid.cellAt(cells[i]!) === needed[i]) continue;
    const src = grid.findCellOfPiece(needed[i]!);
    if (src < 0) return -1;
    swapCells(grid, cells[i]!, src);
    swaps += 1;
  }
  return swaps;
}

/** 一次移动事务的结果（§6.3） */
export interface MoveOutcome {
  /** 是否接受了这次操作（位移不合规则 / 越界 / 空格子 → false） */
  accepted: boolean;
  /** 被拒绝的原因；`accepted` 为 true 时不存在 */
  rejectReason?: MoveReject;
  /** 本次消除的 2×2 区域（按 HC-02 正常最多 1 组） */
  eliminatedGroups: MatchRegion[];
  eliminatedImage: number | null;
  /** 消除后的累计得分（§7.1：每消除一组得 1 分） */
  score: number;
  /** 是否触发了 §4.8.4 位置交换兜底 */
  usedSwapFallback: boolean;
  /** 是否触发了 §4.13.2 强制构造 */
  usedForceConstruct: boolean;
  /** 结算中间态快照；未发生消除时为 undefined */
  stages?: ResolveStages;
}

/**
 * 引擎的**可落盘快照**（M6）。
 *
 * 存档单位是「一次移动事务」（§16），事务结束时棋盘必定满格、且处于
 * 「池子 5 恒为 1 张、位置拼合恒为 0 组」的合法态 —— 所以快照只需要这三样：
 * 棋盘内容、累计得分、累计消除组数。随机源单独存在 `Rng.snapshot` 里（见 rng.ts）。
 */
export interface EngineSnapshot {
  /** 满格棋盘，长度必须等于 rows × cols */
  cells: readonly Cell[];
  score: number;
  eliminations: number;
}

/** 校验一份快照是否与关卡配置自洽；返回问题列表（空 = 合法） */
export function validateSnapshot(config: LevelConfig, snapshot: EngineSnapshot): string[] {
  const issues: string[] = [];
  const expected = config.rows * config.cols;

  if (snapshot.cells.length !== expected) {
    issues.push(`棋盘格数 ${snapshot.cells.length} ≠ ${expected}`);
  }
  if (!Number.isInteger(snapshot.score) || snapshot.score < 0) {
    issues.push(`得分非法（${snapshot.score}）`);
  }
  if (!Number.isInteger(snapshot.eliminations) || snapshot.eliminations < 0) {
    issues.push(`消除组数非法（${snapshot.eliminations}）`);
  }

  const allowed = new Set(config.imageIds);
  const seen = new Set<number>();
  for (const cell of snapshot.cells) {
    if (cell === null) {
      issues.push('棋盘存在空位（事务中间态不能作为存档点）');
      break;
    }
    if (seen.has(cell)) {
      issues.push(`碎片 ${cell} 重复出现（违反 HC-03）`);
      break;
    }
    seen.add(cell);
    if (!allowed.has(imageOf(cell))) {
      issues.push(`碎片 ${cell} 属于图 ${imageOf(cell)}，不在本关图池内`);
      break;
    }
  }
  return issues;
}

/**
 * 玩法引擎（M2）
 *
 * 覆盖：首局生成 → 按规则移动整片（任意距离 / 只能 1 格）→ 消除判决 → 下压 → 补位 → 校验 → 融合分组。
 * 本类不含任何渲染、计时、体力、广告逻辑，确保可脱离 Cocos 单元测试。
 */
export class PuzzleEngine {
  readonly config: LevelConfig;
  private grid: Grid;
  private rng: Rng;

  private _score = 0;
  private _eliminations = 0;
  private _multiMatchViolations = 0;

  /**
   * @param snapshot M6 断点恢复：给了就按它还原棋盘与计分，不再跑首局生成。
   *   校验不通过直接抛错（见 `validateSnapshot`）—— 存档坏掉这件事必须在
   *   恢复的那一刻暴露，否则玩家会拿着一个非法棋盘继续玩，越玩越远。
   */
  constructor(config: LevelConfig, rng: Rng, snapshot?: EngineSnapshot) {
    // 显式校验「关卡配置本身存在」。
    // 否则调用方传入 undefined 时，下面读 config.rows 会抛出
    // `TypeError: Cannot read properties of undefined (reading 'rows')` ——
    // 报错点落在引擎内部，现场信息全丢了；这里改成能一眼看出「谁没传」的错误。
    if (!config) {
      throw new Error(
        'PuzzleEngine: 缺少关卡配置（config 为 undefined）—— 调用方需先确认关卡数据已就绪',
      );
    }
    if (!Number.isInteger(config.rows) || !Number.isInteger(config.cols)) {
      throw new Error('PuzzleEngine: 行列必须为整数');
    }
    this.config = { ...config, imageIds: config.imageIds.slice() };
    this.rng = rng;

    if (!snapshot) {
      this.grid = buildInitialGrid(config.rows, config.cols, config.imageIds, rng);
      return;
    }
    const issues = validateSnapshot(this.config, snapshot);
    if (issues.length > 0) {
      throw new Error(`PuzzleEngine: 存档快照与关卡配置不符 —— ${issues.join('；')}`);
    }
    this.grid = new Grid(config.rows, config.cols, snapshot.cells);
    this._score = snapshot.score;
    this._eliminations = snapshot.eliminations;
  }

  /** 当前状态的可落盘快照（M6）；与 `Rng.snapshot` 一起构成一条完整的存档点 */
  toSnapshot(): EngineSnapshot {
    return { cells: this.grid.toArray(), score: this._score, eliminations: this._eliminations };
  }

  get board(): Grid {
    return this.grid;
  }

  get score(): number {
    return this._score;
  }

  get eliminations(): number {
    return this._eliminations;
  }

  /** 违反 HC-02（同时出现 ≥2 组可消除区域）的次数，正常恒为 0 */
  get multiMatchViolations(): number {
    return this._multiMatchViolations;
  }

  get imageIds(): readonly number[] {
    return this.config.imageIds;
  }

  /**
   * 一次**移动事务**（§6.1 / §1.6）：把「锚点所在的整片」平移，并结算消除 / 下压 / 补位。
   *
   * `anchor` = 玩家按住的那一块（锚点），`target` = 松手时锚点所在的格；
   * 位移 v = target − anchor，整片的其他块刚性跟随（相对位置不变），
   * 被压到的碎片与整片让出的格子对位互换 —— 完整规则见 `move.ts` 顶部注释。
   *
   * 位移规则由 `config.swapRule` 决定：
   *   `'any'`      —— 任意距离都能挪（普通模式）
   *   `'adjacent'` —— 整片每次只能挪 1 格（噩梦模式）
   * 不合规则 / 越界 / 空位时不改动棋盘，返回 `accepted = false` + `rejectReason`。
   *
   * ⚠️ 单块（组大小 = 1）时它就是原本的「两块交换」：a → b、b → a。
   */
  move(anchor: number, target: number): MoveOutcome {
    const check = planGroupMove(this.grid, anchor, target, this.config.swapRule);
    if (!check.ok) return this.rejected(check.reason);
    applyGroupMove(this.grid, check.plan);
    return this.resolveBoard();
  }

  /**
   * 从 a 移到 b 这个位移是否符合当前关卡的移动规则。
   *
   * `'adjacent'`（噩梦）= 曼哈顿距离恰好为 1 格（上下左右），对角线不算、原地不算；
   * 这里只看**位移向量**，不看整片是否会越界（那是 `planGroupMove` 的事）。
   * `'any'` 规则下恒为 true。
   */
  ruleAllows(a: number, b: number): boolean {
    // 复用 core 的位移判定，避免「相邻」有两套实现（改一处漏一处）
    return ruleAllowsShift(
      this.config.swapRule,
      this.grid.rowOf(b) - this.grid.rowOf(a),
      this.grid.colOf(b) - this.grid.colOf(a),
    );
  }

  /** 当前所有融合组（§1.5） */
  mergeGroups(): MergeGroup[] {
    return computeMergeGroups(this.grid);
  }

  /** 某个格子所属的整片（融合组；单块也算一个 1 块的组）；空位返回 null */
  groupOfCell(cell: number): MergeGroup | null {
    return mergeGroupOfCell(this.grid, cell);
  }

  /** 已连成 2×2 的融合组（即下一帧会被消除的组） */
  completeMergeGroups(): MergeGroup[] {
    return this.mergeGroups().filter(isMergeGroupComplete);
  }

  poolSnapshot(): PoolSnapshot {
    return poolSnapshot(this.grid, this.config.imageIds);
  }

  /** 不变量自检（§4.9 / §4.7 / HC-01~HC-06），返回问题列表 */
  invariantIssues(): string[] {
    const issues: string[] = [];
    const cells = this.grid.toArray();

    if (cells.some((v) => v === null)) issues.push('棋盘存在空位（非补位中间态）');

    const seen = new Set<number>();
    for (const v of cells) {
      if (v === null) continue;
      if (seen.has(v)) issues.push(`碎片 ${v} 重复出现在场上（违反 HC-03）`);
      seen.add(v);
    }

    const v = validateBoard(this.grid);
    if (v.content.length !== 1) issues.push(`内容完整性应为恰好 1 组，实际 ${v.content.length} 组（违反 HC-01）`);
    if (v.positionCorrect.length !== 0) issues.push(`位置拼合应为 0 组，实际 ${v.positionCorrect.length} 组（违反 HC-01）`);

    const snap = this.poolSnapshot();
    const expectedPool2 = (this.grid.size - 8) / 2;
    if (snap.complete.length !== 1) issues.push(`池子5 应为 1 张，实际 ${snap.complete.length} 张`);
    if (snap.pool1.length !== 1) issues.push(`池子1 应为 1 张，实际 ${snap.pool1.length} 张`);
    if (snap.pool2.length !== expectedPool2) issues.push(`池子2 应为 ${expectedPool2} 张，实际 ${snap.pool2.length} 张`);
    if (snap.pool3.length !== 1) issues.push(`池子3 应为 1 张，实际 ${snap.pool3.length} 张`);
    if (snap.pool4.length !== 1) issues.push(`池子4 应为 1 张，实际 ${snap.pool4.length} 张`);

    return issues;
  }

  /**
   * 重开本关（M4「重开」按钮的入口）：只换种子重排棋盘，关卡配置与图池不变。
   *
   * ⚠️ 必须把传入的 `rng` 一并接管为引擎自己的随机源 —— 否则「棋盘按新种子排，
   * 但之后的补位仍在用构造时那条旧随机序列」，「同一 seed 可复现」会静默失效。
   */
  restart(rng: Rng = this.rng): void {
    this.rng = rng;
    this.grid = buildInitialGrid(this.config.rows, this.config.cols, this.config.imageIds, this.rng);
    this._score = 0;
    this._eliminations = 0;
  }

  /**
   * 测试 / AI 模拟器（M8）专用钩子。
   *
   * 把当前「已集齐 4 块」的那张图，直接搬成一个正确的 2×2，然后走完整的
   * 消除 → 下压 → 补位 → 校验流程。
   * 全过程只做「位置置换」，不改变场上碎片集合，因此不破坏池子结构。
   *
   * ⚠️ 这不是玩家操作，仅用于压力测试与数值模拟，不得暴露给 UI。
   */
  forceCompleteTargetImage(): MoveOutcome | null {
    const snap = this.poolSnapshot();
    if (snap.complete.length !== 1) return null;
    const imageId = snap.complete[0]!;
    const needed = [
      pieceOf(imageId, 0),
      pieceOf(imageId, 1),
      pieceOf(imageId, 2),
      pieceOf(imageId, 3),
    ];

    const regions: Array<[number, number]> = [];
    for (let r = 0; r + 1 < this.grid.rows; r++) {
      for (let c = 0; c + 1 < this.grid.cols; c++) regions.push([r, c]);
    }

    for (const [r, c] of this.rng.shuffle(regions)) {
      const targetCells = [
        this.grid.index(r, c),
        this.grid.index(r, c + 1),
        this.grid.index(r + 1, c),
        this.grid.index(r + 1, c + 1),
      ];
      const trial = this.grid.clone();
      const placed = placePieces(trial, targetCells, needed);
      if (placed >= 0 && findAllPositionCorrectMatches(trial).length === 1) {
        this.grid = trial;
        return this.resolveBoard();
      }
    }
    return null;
  }

  private squareAt(r: number, c: number): number[] {
    return [
      this.grid.index(r, c),
      this.grid.index(r, c + 1),
      this.grid.index(r + 1, c),
      this.grid.index(r + 1, c + 1),
    ];
  }

  /**
   * AI 模拟器专用（M8 方案A）：把「已集齐 4 块」的那张图搬成任意 2×2 所需的**最少交换次数**。
   *
   * 这是星级线标定的核心统计量：池子模型保证场上恒有恰好 1 张 4 块齐全的图，
   * 也就是「随时都能得分」；因此 180 秒内的得分 ≈ 交换次数预算 ÷ 每分所需交换数。
   * 该值与棋盘大小正相关（越大越分散），正是难度曲线的量化来源。
   *
   * 纯计算，不修改棋盘。
   */
  minSwapsToCompleteTarget(): number | null {
    const snap = this.poolSnapshot();
    if (snap.complete.length !== 1) return null;
    const imageId = snap.complete[0]!;
    const needed = [
      pieceOf(imageId, 0),
      pieceOf(imageId, 1),
      pieceOf(imageId, 2),
      pieceOf(imageId, 3),
    ];

    let best = -1;
    for (let r = 0; r + 1 < this.grid.rows; r++) {
      for (let c = 0; c + 1 < this.grid.cols; c++) {
        const swaps = placePieces(this.grid.clone(), this.squareAt(r, c), needed);
        if (swaps >= 0 && (best < 0 || swaps < best)) best = swaps;
      }
    }
    return best < 0 ? null : best;
  }

  /**
   * 噩梦模式标定专用：相邻交换规则下，把「已集齐 4 块」的那张图拼成某个 2×2 所需的
   * **最少交换次数下界**。
   *
   * 相邻交换没有 `placePieces` 那样的置换分解闭式解，这里用一个可靠的下界：
   * 每块碎片至少要「走」它到目标格的曼哈顿距离那么多步，4 块的距离之和即本次最低成本。
   * 真实玩家还得绕开挡路的碎片，实际步数只会更多 —— 所以这是**下界**，
   * 换算出的每分成本偏乐观；但它足以刻画「噩梦比普通难多少」的相对关系。
   *
   * 纯计算，不修改棋盘。
   */
  minAdjacentSwapsToCompleteTarget(): number | null {
    const snap = this.poolSnapshot();
    if (snap.complete.length !== 1) return null;
    const imageId = snap.complete[0]!;
    const needed = [
      pieceOf(imageId, 0),
      pieceOf(imageId, 1),
      pieceOf(imageId, 2),
      pieceOf(imageId, 3),
    ];

    let best = -1;
    for (let r = 0; r + 1 < this.grid.rows; r++) {
      for (let c = 0; c + 1 < this.grid.cols; c++) {
        const targets = this.squareAt(r, c);
        let cost = 0;
        let reachable = true;
        for (let k = 0; k < 4; k++) {
          const from = this.grid.findCellOfPiece(needed[k]!);
          if (from < 0) {
            reachable = false;
            break;
          }
          cost +=
            Math.abs(this.grid.rowOf(from) - this.grid.rowOf(targets[k]!)) +
            Math.abs(this.grid.colOf(from) - this.grid.colOf(targets[k]!));
        }
        if (reachable && (best < 0 || cost < best)) best = cost;
      }
    }
    return best < 0 ? null : best;
  }

  private rejected(reason: MoveReject): MoveOutcome {
    return {
      accepted: false,
      rejectReason: reason,
      eliminatedGroups: [],
      eliminatedImage: null,
      score: this._score,
      usedSwapFallback: false,
      usedForceConstruct: false,
    };
  }

  /** 消除 → 下压 → 补位（§6.3 的 9 步流程中对算法层有意义的部分） */
  private resolveBoard(): MoveOutcome {
    const matches = findAllPositionCorrectMatches(this.grid);
    // 消除执行前的棋盘快照（用于渲染层回放「移动完成」那一帧）
    const afterMove = this.grid.toArray();

    if (matches.length === 0) {
      return {
        accepted: true,
        eliminatedGroups: [],
        eliminatedImage: null,
        score: this._score,
        usedSwapFallback: false,
        usedForceConstruct: false,
      };
    }
    if (matches.length > 1) this._multiMatchViolations += 1;

    const group = matches[0]!;
    for (const cell of group.cells) this.grid.setAt(cell, null);
    this._score += 1; // §7.1 每消除一组得 1 分
    this._eliminations += 1;

    // 消除后、下压前的棋盘快照（用于渲染层回放「碎片掉落」）
    const afterEliminate = this.grid.toArray();

    collapseColumns(this.grid);

    let usedSwapFallback = false;
    let usedForceConstruct = false;
    if (this.grid.emptyIndices().length > 0) {
      const result = refillGrid(this.grid, this.config.imageIds, this.rng);
      this.grid = result.grid;
      usedSwapFallback = result.usedSwapFallback;
      usedForceConstruct = result.usedForceConstruct;
    }

    return {
      accepted: true,
      eliminatedGroups: matches,
      eliminatedImage: group.imageId,
      score: this._score,
      usedSwapFallback,
      usedForceConstruct,
      stages: { afterMove, afterEliminate, eliminatedCells: group.cells.slice() },
    };
  }
}
