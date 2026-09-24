/**
 * 可复现随机数发生器（xorshift32）。
 *
 * 为什么不用 Math.random：
 * 1. 算法层需要「同一颗种子 → 同一局棋盘」，否则压测失败无法复现，也无法排查线上问题。
 * 2. M8 的 AI 模拟器需要批量重放同一关卡。
 */
export class Rng {
  private state: number;

  constructor(seed: number = Date.now()) {
    // 0 会让 xorshift 死锁，强制非 0
    this.state = (seed >>> 0) || 0x9e3779b9;
  }

  /**
   * 当前内部状态（M6 落盘用）。
   *
   * 落盘时**必须存状态而不是种子**：补位会按需消耗随机数，同一个种子在
   * 「第 3 次交换之后」和「刚开局」拿到的序列完全不同 —— 只存种子的话，
   * 恢复出来的补位结果会和退出前分叉（棋盘对不上，但界面上看不出来）。
   */
  get snapshot(): number {
    return this.state;
  }

  /**
   * 从落盘的状态恢复（M6）。
   *
   * 非法状态**直接抛错**而不是退回默认种子：静默兜底会让「恢复后棋盘和退出前不一样」
   * 变成一条查不出来的路径（配合 §16「退出后与预期一致」的验收，这里必须吵出来）。
   */
  static restore(state: number): Rng {
    if (!Number.isInteger(state) || state <= 0 || state > 0xffffffff) {
      throw new Error(`Rng.restore: 非法状态 ${state}（应为 1~0xffffffff 的整数）`);
    }
    return new Rng(state);
  }

  /** [0, 1) */
  next(): number {
    let x = this.state;
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    this.state = x;
    return x / 0x100000000;
  }

  /** [0, n) 整数 */
  int(n: number): number {
    if (n <= 0) throw new Error(`Rng.int: n 必须为正数，收到 ${n}`);
    return Math.floor(this.next() * n);
  }

  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new Error('Rng.pick: 数组为空');
    return arr[this.int(arr.length)]!;
  }

  /** 返回打乱后的新数组，不修改入参 */
  shuffle<T>(arr: readonly T[]): T[] {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const tmp = a[i]!;
      a[i] = a[j]!;
      a[j] = tmp;
    }
    return a;
  }
}

/** 从 count 个元素中随机取 k 个（保序随机，不重复） */
export function pickSome<T>(rng: Rng, arr: readonly T[], k: number): T[] {
  if (k < 0 || k > arr.length) throw new Error(`pickSome: k=${k} 越界（长度 ${arr.length}）`);
  return rng.shuffle(arr).slice(0, k);
}
