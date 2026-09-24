/**
 * 素材台账（附录A + §3.1.2 归档记录）
 *
 * 只描述「图 ID ↔ 动物 / 情绪」的映射，不含任何关卡配置。
 *
 * ⚠️ 为什么独立成模块，而不是留在 config.ts：
 * 关卡图池现在是**从素材池随机抽取**的（见 poolGen.ts），生成器需要 `animalOf`
 * 来判断混淆度。若台账留在 config.ts，就会形成 config ↔ poolGen 的循环依赖。
 * 抽成独立的叶子模块后，两边都是单向依赖。
 */

/** 素材总量上限：附录A 的「6 动物 × 6 情绪 = 36 张」，编号 0~35 */
export const MAX_ART_ID = 35;

/**
 * 六种情绪，顺序固定（取自 §3.1.2 里猫的实测顺序）。
 * 每只动物的 6 张图都按这个顺序编号。
 *
 * ⚠️ 2026-09-11：第 2 个情绪按《关卡配置表》的口径改名为「难过」
 * （设计表列的是「开心、难过、生气、害羞、惊讶、得意」），
 * **只改名字，不动编号** —— 图 ID 与情绪的对应关系保持不变，
 * 已归档锁定的 0~10 不受影响。
 */
const MOODS = ['开心', '难过', '生气', '害羞', '惊讶', '得意'] as const;

/**
 * **素材台账（原始数据）**：每只动物占哪几个图 ID，按上面的情绪顺序一一对应。
 *
 * ⚠️ 为什么必须是显式表、不能用 ⌊ID/6⌋ 之类的公式反推：
 * 附录A 描述的是「6 动物 × 6 情绪 = 36 张」，但**实际交付编号并不是「动物×6+情绪」**。
 * §3.1.2 归档记录写明：`sticker_0~5` 是猫的 6 种情绪，而 `sticker_6~10` 是
 * 虎 / 兔 / 仓鼠 / 狗 / 熊各自的「开心」各一张。
 * 若按 ⌊ID/6⌋ 反推，6~10 会被误判成「同一只动物」，整个难度设计会算错。
 *
 * ⚠️ **0~10 已归档并锁定，不要重排**；11~35 是据此**续编**的编号。
 *
 * ✅ 2026-09-10：36 张素材**已全部导入** `art/stickers/`（`sticker_0~35.png/.jpg`，
 * 512×512，来自原始素材库 2048×2048 降采样），对应关系见 README §3.2 编号表。
 * 当时的反向校验结果：已归档的 0~10 与原始素材重算**逐字节一致**，对应关系确认无误。
 *
 * 若美术后续调整编号，只改本表并重跑 `npm run calibrate`。
 */
export const ANIMAL_IMAGE_IDS: ReadonlyArray<readonly [string, readonly number[]]> = [
  ['猫', [0, 1, 2, 3, 4, 5]], // 6 张齐全（已到货）
  ['虎', [6, 11, 12, 13, 14, 15]],
  ['兔', [7, 16, 17, 18, 19, 20]],
  ['仓鼠', [8, 21, 22, 23, 24, 25]],
  ['狗', [9, 26, 27, 28, 29, 30]],
  ['熊', [10, 31, 32, 33, 34, 35]],
];

const LEDGER = ANIMAL_IMAGE_IDS.flatMap(([animal, ids]) =>
  ids.map((id, i) => [id, animal, MOODS[i]!] as const),
);

/** 图 ID → 动物（由台账展开，供难度分组、渲染、图鉴使用） */
export const IMAGE_ANIMAL: Record<number, string> = Object.fromEntries(
  LEDGER.map(([id, animal]) => [id, animal]),
);

/** 图 ID → 情绪（由台账展开，供图鉴文案使用） */
export const IMAGE_MOOD: Record<number, string> = Object.fromEntries(
  LEDGER.map(([id, , mood]) => [id, mood]),
);

/** 查询某张图属于哪只动物；越界返回 undefined */
export function animalOf(imageId: number): string | undefined {
  return IMAGE_ANIMAL[imageId];
}

/** 素材全量 ID 列表（0~MAX_ART_ID），即「素材齐全」时的可用池 */
export function allArtIds(): number[] {
  return Array.from({ length: MAX_ART_ID + 1 }, (_, id) => id);
}
