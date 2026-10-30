/**
 * 180 关「模拟真人」通关性测试（normal + nightmare × 三档操作速度）。
 *
 * 干什么用：回答「这一关真人到底打不打得过 / 拿不拿得到 3★」。
 * 数值一改就能重跑，用来复核星线是不是定得离谱。
 *
 * 跑法（项目根目录下）：
 *   node --experimental-strip-types tools/simulate-levels.mjs
 *
 * 关键设计（别乱改，改了结论就不可信了）：
 *  - 用**真实的 engine.move()** 走棋，不是 forceCompleteTargetImage 那种瞬移钩子。
 *    所以「步数」和真人一样：AI 拼一组要几步，真人也要几步。
 *  - 噩梦模式（swapRule='adjacent'）按规则**逐格挪**，步数会真实地暴涨。
 *  - 时间模型：每步固定耗时，从 180 秒里扣（与 config.ts「一次交换 1.5 秒」同源）。
 *  - **跑满 180 秒**（不在 3★ 处提前停），看真实得分上限。
 *  - 通关判定用 progress.ts 的 starsFor()：score >= star1 才算通关（0 星 = 没过）。
 *
 * ⚠️ 已知局限：AI 是「完美信息 + 贪心」，比真人准 —— 所以本工具的结论是**乐观下界**，
 *    真人只会更难。若这里就打不过，真人一定打不过。
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'assets/scripts', '核心') + '/';
/* Cocos 风格 import 不带扩展名，Node ESM 不认 → 复制一份补上 .ts（放系统临时目录，不污染项目） */
const DIR = join(tmpdir(), 'pinpinle-sim-core') + '/';
mkdirSync(DIR, { recursive: true });
for (const f of readdirSync(SRC).filter((x) => x.endsWith('.ts'))) {
  const s = readFileSync(SRC + f, 'utf8').replace(/from '\.\/(\w+)'/g, "from './$1.ts'");
  writeFileSync(DIR + f, s);
}
const p = (s) => pathToFileURL(DIR + s).href;
const { PuzzleEngine } = await import(p('engine.ts'));
const { Rng } = await import(p('rng.ts'));
const { pieceOf } = await import(p('pieces.ts'));
const cfgMod = await import(p('config.ts'));
const { starsFor } = await import(p('progress.ts'));

/** 噩梦模式：从 from 朝 to 逐格挪（每步 1 格） */
function stepToward(eng, from, to) {
  const g = eng.board;
  let cur = from, steps = 0, guard = 0;
  while (cur !== to && guard++ < 60) {
    const dr = g.rowOf(to) - g.rowOf(cur);
    const dc = g.colOf(to) - g.colOf(cur);
    const tries = [];
    if (dr !== 0) tries.push(g.index(g.rowOf(cur) + Math.sign(dr), g.colOf(cur)));
    if (dc !== 0) tries.push(g.index(g.rowOf(cur), g.colOf(cur) + Math.sign(dc)));
    let moved = false;
    for (const nx of tries) {
      const out = eng.move(cur, nx);
      if (out.accepted) { cur = nx; steps++; moved = true; break; }
    }
    if (!moved) break;
  }
  return { cur, steps };
}

/** 把某张图的 4 块拼成 2×2（拼成后引擎自动消除并 +1 分） */
function assemble(eng, imageId, adjacent) {
  const g = eng.board;
  const need = [0, 1, 2, 3].map((k) => pieceOf(imageId, k));
  let steps = 0;
  const before = eng.eliminations;

  for (let iter = 0; iter < 30; iter++) {
    // 选「已就位块最多」的 2×2 区域当目标
    let best = null;
    for (let r = 0; r + 1 < g.rows; r++) {
      for (let c = 0; c + 1 < g.cols; c++) {
        const cells = [g.index(r, c), g.index(r, c + 1), g.index(r + 1, c), g.index(r + 1, c + 1)];
        let fit = 0;
        for (let k = 0; k < 4; k++) if (g.cellAt(cells[k]) === need[k]) fit++;
        if (!best || fit > best.fit) best = { cells, fit };
      }
    }
    let allOK = true;
    for (let k = 0; k < 4; k++) {
      const t = best.cells[k];
      if (g.cellAt(t) === need[k]) continue;
      allOK = false;
      const cur = g.findCellOfPiece(need[k]);
      if (cur < 0 || cur === t) continue;
      if (adjacent) steps += stepToward(eng, cur, t).steps;
      else if (eng.move(cur, t).accepted) steps++;
      if (eng.eliminations > before) return { ok: true, steps };
    }
    if (allOK) break;
  }
  return { ok: eng.eliminations > before, steps };
}

/** 打满一关（跑满 timeLimit 秒） */
function play(cfg, seed, secPerMove) {
  const eng = new PuzzleEngine(cfg, new Rng(seed));
  const adjacent = cfg.swapRule === 'adjacent';
  let timeLeft = cfg.timeLimit, moves = 0, forced = 0;

  while (timeLeft > secPerMove) {
    const snap = eng.poolSnapshot();
    let img = snap.complete.length ? snap.complete[0] : null;
    if (img === null) {
      let best = -1, bc = 0;
      for (const [id, c] of eng.board.countByImage()) if (c > bc) { bc = c; best = id; }
      img = best;
      if (img < 0) break;
    }
    const r = assemble(eng, img, adjacent);
    moves += r.steps || 1;
    timeLeft -= (r.steps || 1) * secPerMove;
    if (!r.ok) {
      // AI 没拼出来 → 用引擎的 AI 钩子兜底（代表"玩家总有办法拼出来"），但记数
      if (!eng.forceCompleteTargetImage()) break;
      forced++; moves += 1; timeLeft -= secPerMove;
    }
  }
  return { score: eng.score, stars: starsFor(eng.score, cfg.star1, cfg.star2, cfg.star3), moves, forced };
}

const SPEEDS = [['熟练', 1.5], ['普通', 2.5], ['生手', 4.0]];
const seeds = [1001, 2002, 3003];

for (const mode of ['normal', 'nightmare']) {
  const configs = cfgMod.buildLevelConfigs(mode);
  for (const [label, sec] of SPEEDS) {
    const rows = [];
    for (const cfg of configs) {
      const runs = seeds.map((s) => play(cfg, s, sec));
      rows.push({
        level: cfg.level, line: `${cfg.star1}/${cfg.star2}/${cfg.star3}`,
        minScore: Math.min(...runs.map((r) => r.score)),
        minStars: Math.min(...runs.map((r) => r.stars)),
        moves: Math.round(runs.reduce((a, r) => a + r.moves, 0) / runs.length),
        forced: runs.reduce((a, r) => a + r.forced, 0),
      });
    }
    const failed = rows.filter((r) => r.minStars === 0);
    const no3 = rows.filter((r) => r.minStars < 3);
    const avg = (rows.reduce((a, r) => a + r.minScore, 0) / rows.length).toFixed(1);
    console.log(`【${mode === 'normal' ? '简单' : '噩梦'} / ${label} ${sec}s每步】180 秒跑满 → 平均最差分 ${avg}`);
    console.log(`   通关 ${rows.length - failed.length}/${rows.length}   不足3★ ${no3.length} 关   打不过 ${failed.length} 关   平均 ${Math.round(rows.reduce((a, r) => a + r.moves, 0) / rows.length)} 步   兜底 ${rows.reduce((a, r) => a + r.forced, 0)} 次`);
    if (failed.length) console.log('   ❌ 打不过: ' + failed.slice(0, 30).map((r) => `第${r.level}关(线${r.line},得${r.minScore})`).join(' ') + (failed.length > 30 ? ` ... 共 ${failed.length} 关` : ''));
    const only3 = no3.filter((r) => r.minStars > 0);
    if (only3.length) console.log('   ⚠️ 能过但拿不到3★: ' + only3.slice(0, 20).map((r) => `第${r.level}关(线${r.line},得${r.minScore})`).join(' ') + (only3.length > 20 ? ` ... 共 ${only3.length} 关` : ''));
    console.log('');
  }
}
