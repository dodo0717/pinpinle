/**
 * 关卡图池生成器（§5.4 / §8.3 + 60 关设计表）
 *
 * ── 设计口径（2026-09-11 修订）────────────────────────────────────────────
 * 素材是**通用池**（附录A：6 动物 × 6 情绪 = 36 张），**不按动物绑定到关卡**。
 * 每关的图池构成由设计表**逐关给定**，只有两个参数：
 *   - `moodCounts` —— 本关每只动物各出几个情绪图
 *     （设计表的「同动物不同情绪」列，如 `2情绪×1只+1情绪×4只` = `[2,1,1,1,1]`）
 *   - 图数 = ΣmoodCounts，由格数决定（§5.4：图数 = (格数-8)÷2+4）
 * 实际用哪几张动物、哪几个情绪，由本模块从「可用素材池」里**确定性随机**抽出：
 * 同一 (种子, 关卡) 永远产出同一套图池；换掉种子即整批重抽一套。
 *
 * ── 为什么不能无脑随机 ───────────────────────────────────────────────────
 * 「一只动物出几个情绪图」就是难度本身（派生指标 `ma` = 最大的那个数）：
 *   全部 1 情绪 → 6 只动物各一张脸，一眼可分（最简单）
 *   6 情绪 + 4 情绪 → 整关只有 2 只动物，同一张脸反复出现（最难）
 * 若纯随机抽 N 张，第 1 关有概率抽到 6 张同一只动物（比第 60 关还难），曲线直接失真。
 * 因此策略是「**按设计表选动物、再按设计表分配情绪数**」：
 *   ① 选参与本关的动物（只数 = Σanimals）—— 需要最多情绪的那只优先落在可用情绪最多的动物上；
 *   ② 把设计表要求的情绪数从大到小分配给这些动物；
 *   ③ 某只动物情绪不够时，把缺口挪给还有额度的动物（`ma` 被抬高）；
 *      动物用量不够时补动物（只数变多 → 更容易分辨）。
 * 任何偏离都会体现在 `maActual` / `animalsActual` 与 `notes` 里，绝不静默糊过去。
 *
 * ── 跨关唯一性（§5.4）────────────────────────────────────────────────────
 * 同一网格下各关的图池必须两两不同，否则玩家会看到「同一关重复出现」。
 * 撞车时换派生种子重试；重试仍撞车则记 note（素材太少、可组合已用尽）。
 *
 * ── 与素材到货的关系 ─────────────────────────────────────────────────────
 * 可用池越小、分布越偏，能还原的设计难度就越有限：
 *   素材齐全（每只动物 6 张）→ 任何一关都能精确还原；
 *   只有「猫 6 张 + 其余各 1 张」→ 需要 2 只动物各出 3 情绪的关卡就还原不了，
 *   `ma` 会被抬到 5，并按「偏难」记 note 点名。
 */

import { Rng } from './rng';
import { animalOf, MAX_ART_ID } from './ledger';

/** 默认图池种子：换掉它即可整批重抽 60 关的图池（同一关仍是固定的一套） */
export const DEFAULT_POOL_SEED = 20260910;

/** 每关错开图池的最大重试次数（撞车时换派生种子再抽一次） */
const RETRY_PER_LEVEL = 40;

/** 同关内出现次数最多的那只动物占几张 —— 与 `tools/calibrate.mjs` 同一口径 */
export function confusionOf(imageIds: readonly number[]): number {
  if (imageIds.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const id of imageIds) {
    const animal = animalOf(id) ?? `#${id}`;
    counts.set(animal, (counts.get(animal) ?? 0) + 1);
  }
  return Math.max(...counts.values());
}

/** 生成一关图池所需的输入 */
export interface PoolRequest {
  /** 关卡序号，1~60 */
  level: number;
  /**
   * 设计表给定的情绪分布：第 i 只动物出 `moodCounts[i]` 个情绪图。
   * 长度 = 动物只数，总和 = 本关图数。
   */
  moodCounts: readonly number[];
  /** 网格标识（如 `'3x4'`），用于「同网格下各关图池两两不同」的去重 */
  gridKey: string;
}

/** 一关生成好的图池 */
export interface GeneratedPool {
  level: number;
  imageIds: number[];
  /** 设计混淆度 ma = 设计表里最大的一只动物出几个情绪图 */
  maDesigned: number;
  /** 实际混淆度 */
  maActual: number;
  /** 设计动物只数 */
  animalsDesigned: number;
  /** 实际动物只数 */
  animalsActual: number;
  /** 因素材不足而偏离设计表（只数或 ma 任一不符）时为 true */
  deviatesFromDesign: boolean;
}

export interface PoolNote {
  level: number;
  message: string;
}

export interface GenerateResult {
  /** 关卡号 →（图池 + 与设计的差异） */
  byLevel: Map<number, GeneratedPool>;
  /** 素材张数不足、组不出图池的关卡（如 5×4 需 10 张、只到货 9 张） */
  skipped: number[];
  /** 需要人工关注的问题（跨关撞车无法错开、图池偏离设计、关卡被迫关闭） */
  notes: PoolNote[];
}

/** 一关需要几张图（= 设计表情绪分布之和） */
export function imageCountOfRequest(request: PoolRequest): number {
  return request.moodCounts.reduce((sum, n) => sum + n, 0);
}

/**
 * 按设计表生成单关图池。
 *
 * 返回 null 表示**素材总量不足**（连凑满张数都做不到），调用方应跳过该关。
 * 能凑满但构成偏离设计表时，仍然照常产出，只是把偏离标出来。
 */
function generateOne(
  request: PoolRequest,
  byAnimal: ReadonlyMap<string, readonly number[]>,
  seed: number,
): GeneratedPool | null {
  const want = [...request.moodCounts].sort((a, b) => b - a);
  if (want.length === 0) return null;
  const need = want.reduce((sum, n) => sum + n, 0);
  const rng = new Rng(seed);

  /**
   * 选参战动物：先按「可用情绪数」从多到少排，再取前 N 只。
   *
   * 之所以排序而不是纯随机：需要 6 情绪的那只动物必须有 6 张可用素材，
   * 否则关卡会莫名变难。同能力的动物之间保持 rng 打乱后的顺序（排序稳定），
   * 所以「换种子 → 换一套动物」。素材充足时所有动物能力相同 → 等价于纯随机。
   */
  const shuffled = rng.shuffle([...byAnimal.keys()]);
  const ability = (animal: string): number => byAnimal.get(animal)!.length;
  const ordered = [...shuffled].sort((a, b) => ability(b) - ability(a));

  const chosen = ordered.slice(0, Math.min(want.length, ordered.length));
  const avail = chosen.map(ability);
  const alloc = new Array<number>(chosen.length).fill(0);

  // 情绪数从大到小分配，能力强的动物承担多的那几份
  const slotOrder = chosen.map((_, i) => i).sort((a, b) => avail[b]! - avail[a]!);
  want.forEach((moods, i) => {
    alloc[slotOrder[i]!] = moods;
  });

  // 素材不够：先把每只动物压到它的上限，再把缺口挪给还有额度的动物
  let deficit = need;
  for (let i = 0; i < alloc.length; i++) {
    alloc[i] = Math.min(alloc[i]!, avail[i]!);
    deficit -= alloc[i]!;
  }
  for (const i of slotOrder) {
    if (deficit <= 0) break;
    const room = avail[i]! - alloc[i]!;
    if (room <= 0) continue;
    const add = Math.min(room, deficit);
    alloc[i] += add;
    deficit -= add;
  }

  // 还是不够 → 纳入更多动物（只数超过设计 → 更容易分辨，把难度往「偏易」推）
  if (deficit > 0) {
    for (const animal of ordered) {
      if (deficit <= 0) break;
      if (chosen.includes(animal)) continue;
      const room = ability(animal);
      if (room <= 0) continue;
      const add = Math.min(room, deficit);
      chosen.push(animal);
      avail.push(room);
      alloc.push(add);
      deficit -= add;
    }
  }

  // 全体素材加起来都凑不满张数 → 本关开不了
  if (deficit > 0) return null;

  const imageIds: number[] = [];
  for (let i = 0; i < chosen.length; i++) {
    const take = alloc[i]!;
    if (take <= 0) continue;
    const list = rng.shuffle(byAnimal.get(chosen[i]!)!);
    for (let k = 0; k < take; k++) imageIds.push(list[k]!);
  }

  const maDesigned = Math.max(...want);
  const animalsDesigned = want.length;
  const maActual = confusionOf(imageIds);
  const animalsActual = new Set(imageIds.map((id) => animalOf(id) ?? `#${id}`)).size;

  return {
    level: request.level,
    imageIds,
    maDesigned,
    maActual,
    animalsDesigned,
    animalsActual,
    deviatesFromDesign: maActual !== maDesigned || animalsActual !== animalsDesigned,
  };
}

/** 由「全局种子 + 关卡 + 尝试序号」派生互不相同的子种子 */
function deriveSeed(seed: number, level: number, attempt: number): number {
  return (seed * 31 + level * 7919 + attempt * 104729) >>> 0;
}

/** 图池偏离设计表时的诊断文案（用户能在启动提示里直接看到「哪几关、偏难还是偏易」） */
function deviationMessage(pool: GeneratedPool): string {
  const parts: string[] = [];
  if (pool.maActual !== pool.maDesigned) {
    parts.push(`混淆度 ma ${pool.maDesigned} → ${pool.maActual}`);
  }
  if (pool.animalsActual !== pool.animalsDesigned) {
    parts.push(`动物只数 ${pool.animalsDesigned} → ${pool.animalsActual}`);
  }
  const harder = pool.maActual > pool.maDesigned || pool.animalsActual < pool.animalsDesigned;
  return (
    `第${pool.level}关因素材分布不足，图池偏离设计表（${parts.join('、')}，` +
    `${harder ? '偏难' : '偏易'}）`
  );
}

/**
 * 为一整批关卡生成图池。
 *
 * 关卡按序号升序处理（确定性）：先到先占，后面的关卡撞车时换种子重试。
 *
 * `availableIds` 为空（一张素材都没有）时，全部关卡进 `skipped`，不产出任何图池 ——
 * 原型据此退回「纯色块灰盒」。
 */
export function generateLevelPools(
  requests: readonly PoolRequest[],
  availableIds: readonly number[],
  seed: number = DEFAULT_POOL_SEED,
): GenerateResult {
  const byLevel = new Map<number, GeneratedPool>();
  const skipped: number[] = [];
  const notes: PoolNote[] = [];

  const available = [...new Set(availableIds)]
    .filter((id) => Number.isInteger(id) && id >= 0 && id <= MAX_ART_ID)
    .sort((a, b) => a - b);

  const byAnimal = new Map<string, number[]>();
  for (const id of available) {
    const animal = animalOf(id) ?? `#${id}`;
    const list = byAnimal.get(animal) ?? [];
    list.push(id);
    byAnimal.set(animal, list);
  }

  const signatures = new Set<string>();
  const signatureOf = (gridKey: string, ids: readonly number[]): string =>
    `${gridKey}|${[...ids].sort((a, b) => a - b).join(',')}`;

  for (const request of [...requests].sort((a, b) => a.level - b.level)) {
    let chosen: GeneratedPool | null = null;
    let fallback: GeneratedPool | null = null;

    for (let attempt = 0; attempt < RETRY_PER_LEVEL; attempt++) {
      const candidate = generateOne(request, byAnimal, deriveSeed(seed, request.level, attempt));
      // 素材总量不足时，换种子也凑不出来，直接收手
      if (!candidate) break;
      fallback ??= candidate;
      if (!signatures.has(signatureOf(request.gridKey, candidate.imageIds))) {
        chosen = candidate;
        break;
      }
    }

    if (!chosen && fallback) {
      chosen = fallback;
      notes.push({
        level: request.level,
        message: `第${request.level}关无法与同尺寸关卡错开图池（素材太少，可组合的图池已用尽）`,
      });
    }

    if (!chosen) {
      skipped.push(request.level);
      notes.push({
        level: request.level,
        message:
          `第${request.level}关需要 ${imageCountOfRequest(request)} 张图（${request.moodCounts.length} 只动物），` +
          `当前可用素材只有 ${available.length} 张，已暂不开放`,
      });
      continue;
    }

    signatures.add(signatureOf(request.gridKey, chosen.imageIds));
    if (chosen.deviatesFromDesign) {
      notes.push({ level: request.level, message: deviationMessage(chosen) });
    }
    byLevel.set(request.level, chosen);
  }

  return { byLevel, skipped, notes };
}
