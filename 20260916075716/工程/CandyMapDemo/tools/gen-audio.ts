/**
 * 生成 Cocos 端音频素材 —— 把 web/ui/audio.ts 的合成占位音渲染成 WAV。
 *
 * ## 为什么需要这个脚本
 * web 版的音效/BGM 是 WebAudio 现场合成的（零素材）；Cocos 端 `玩法/audio.ts`
 * 走 `AudioSource` + `resources/audio/*`，素材缺失时静默降级 —— 所以小程序里
 * 没声音。本脚本按 web 版**完全相同的参数**（频率/时长/包络/波形）离线渲染同样
 * 的声音，写到 `assets/resources/audio/`。
 *
 * ## 音量（2026-10-24 二次调整）
 * 第一版把 web 的总线增益（SFX 0.11 / BGM 0.05）原样烘进文件，在手机外放上
 * 几乎听不见。改为渲染后**峰值归一化**：音效抬到 0.5、BGM 抬到 0.25（保留
 * BGM 弱于音效的层次），音色与 web 完全一致，只是响度正常。
 *
 * ## 用法
 *   node tools/gen-audio.ts
 *
 * 只依赖 Node 内置模块。采样率 22050 Hz / 单声道 / 16-bit PCM：
 * 合成音的最高频率 2093 Hz（honor-god 尾音），22050 远超奈奎斯特，音色无损；
 * BGM 28.8 s ≈ 1.2 MB，走 resources 远程包不占主包体积。
 *
 * ## 改动须知
 * web 版调音参数（`web/ui/audio.ts` 的 `playSfx` / `BGM_NOTES`）改了以后，
 * 要重跑本脚本才能让小程序同步听感。
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'assets', 'resources', 'audio');

const SR = 22050;               // 采样率
const SFX_GAIN = 0.11;          // 与 web/ui/audio.ts 的 SFX_GAIN 一致
const BGM_GAIN = 0.05;          // 与 web/ui/audio.ts 的 BGM_GAIN 一致
/** 归一化目标峰值：音效 0.5、BGM 0.25（BGM 保持弱于音效的层次） */
const NORM_SFX = 0.5;
const NORM_BGM = 0.25;

/* ------------------------------------------------------------ 合成积木 */

/** 在对数域线性插值 —— 对应 WebAudio 的 exponentialRampToValueAtTime */
function expRamp(from, to, t): number {
  return from * Math.pow(to / from, t);
}

/**
 * 一个带指数包络的音（对应 web 版 beep）。
 * 波形：sine / triangle / square；attack 1.5ms 到峰值，随后指数衰减。
 */
function beep(opts: {
  freq: number;
  dur: number;
  type: 'sine' | 'triangle' | 'square';
  gain?: number;
  slideTo?: number;
  at?: number;
  buf: Float32Array;
}): void {
  const t0 = opts.at ?? 0;
  const peak = (opts.gain ?? 1) * SFX_GAIN;
  const start = Math.floor(t0 * SR);
  const len = Math.floor((t0 + opts.dur + 0.02) * SR);   // +0.02 收尾余量，同 web
  let phase = 0;
  for (let i = start; i < len && i < opts.buf.length; i++) {
    const t = i / SR - t0;
    if (t < 0) continue;
    // 包络：0.0001 → peak（1.5ms）→ 0.0001（dur）
    let env: number;
    if (t < 0.0015) env = expRamp(0.0001, peak, t / 0.0015);
    else env = expRamp(peak, 0.0001, (t - 0.0015) / opts.dur);
    // 频率滑动（exponentialRamp 同款：对数域线性）
    const f = opts.slideTo !== undefined
      ? expRamp(opts.freq, opts.slideTo, Math.min(1, t / opts.dur))
      : opts.freq;
    phase += (2 * Math.PI * f) / SR;
    const s = Math.sin(phase);
    let amp: number;
    if (opts.type === 'sine') amp = s;
    else if (opts.type === 'square') amp = Math.sign(s);
    else amp = (2 / Math.PI) * Math.asin(s);   // triangle
    opts.buf[i] += amp * env;
  }
}

/**
 * 噪声 + 低通扫频（对应 web 版 swish）：白噪 * 线性衰减，过 biquad 低通，
 * 截止频率从 from 指数滑到 to。RBJ 双二阶，Q=1（WebAudio lowpass 默认值）。
 */
function swish(dur: number, from: number, to: number, gain = 0.7, at = 0, buf?: Float32Array): void {
  if (!buf) return;
  const start = Math.floor(at * SR);
  const len = Math.floor((at + dur + 0.02) * SR);
  const n = len - start;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;   // biquad 状态
  for (let j = 0; j < n && start + j < buf.length; j++) {
    const t = j / SR;
    // 源信号：白噪 * 线性衰减（起手最响，尾巴收干净）
    const x = (Math.random() * 2 - 1) * (1 - j / n);
    // 截止频率对数域线性下滑
    const fc = expRamp(from, Math.max(80, to), Math.min(1, t / dur));
    const w = (2 * Math.PI * fc) / SR;
    const alpha = Math.sin(w) / (2 * 1);
    const b0 = (1 - Math.cos(w)) / 2, b1 = 1 - Math.cos(w), b2 = b0;
    const a0 = 1 + alpha, a1 = -2 * Math.cos(w), a2 = 1 - alpha;
    const y = (b0 / a0) * x + (b1 / a0) * x1 + (b2 / a0) * x2 - (a1 / a0) * y1 - (a2 / a0) * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    buf[start + j] += y * gain * SFX_GAIN;
  }
}

/** BGM 单音（对应 web 版 bgmNote）：三角波 + 慢包络，0.8s */
function bgmNote(freq: number, at: number, buf: Float32Array): void {
  const dur = 0.8;
  const start = Math.floor(at * SR);
  const len = Math.floor((at + dur + 0.02) * SR);
  let phase = 0;
  for (let i = start; i < len && i < buf.length; i++) {
    const t = i / SR - at;
    if (t < 0) continue;
    // 包络：0.0001 → 0.9（80ms）→ 0.0001（dur）
    let env: number;
    if (t < 0.08) env = expRamp(0.0001, 0.9, t / 0.08);
    else env = expRamp(0.9, 0.0001, (t - 0.08) / dur);
    phase += (2 * Math.PI * freq) / SR;
    const amp = (2 / Math.PI) * Math.asin(Math.sin(phase));   // triangle
    buf[i] += amp * env * BGM_GAIN;
  }
}

/* ------------------------------------------------------------ WAV 写出 */

function writeWav(name: string, buf: Float32Array, targetPeak: number): void {
  // 峰值归一化到 targetPeak（音色不变，只改响度）；再留削波保护
  let max = 0;
  for (let i = 0; i < buf.length; i++) max = Math.max(max, Math.abs(buf[i]));
  const scale = max > 0 ? targetPeak / max : 1;
  const clipped = Float32Array.from(buf, (v) => Math.max(-1, Math.min(1, v * scale)));
  const data = Buffer.alloc(clipped.length * 2);
  for (let i = 0; i < clipped.length; i++) {
    data.writeInt16LE(Math.round(clipped[i] * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);          // PCM 块大小
  header.writeUInt16LE(1, 20);           // PCM
  header.writeUInt16LE(1, 22);           // 单声道
  header.writeUInt32LE(SR, 24);
  header.writeUInt32LE(SR * 2, 28);      // 字节率
  header.writeUInt16LE(2, 32);           // 块对齐
  header.writeUInt16LE(16, 34);          // 位深
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  const file = join(OUT_DIR, name);
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(file, Buffer.concat([header, data]));
  const dur = (clipped.length / SR).toFixed(2);
  const kb = ((44 + data.length) / 1024).toFixed(0);
  console.log(`  ${name}  ${dur}s  ${kb}KB`);
}

/** 开一个时长 t 秒的静音画布 */
function canvas(t: number): Float32Array {
  return new Float32Array(Math.ceil(t * SR));
}

/* ------------------------------------------------------------ 各音槽（参数与 web/ui/audio.ts 逐字对应） */

const TRACKS: Array<[string, () => Float32Array]> = [
  ['swap', () => {   // 交换：短促一声「嗒」
    const b = canvas(0.1);
    beep({ freq: 620, dur: 0.07, type: 'triangle', gain: 0.9, buf: b });
    return b;
  }],
  ['eliminate', () => {   // 消除：上行双音「叮-铃」
    const b = canvas(0.25);
    beep({ freq: 784, dur: 0.1, type: 'triangle', buf: b });
    beep({ freq: 1175, dur: 0.16, type: 'triangle', at: 0.06, buf: b });
    return b;
  }],
  ['drop', () => {   // 掉落/补位：气流声 + 木鱼低音
    const b = canvas(0.3);
    swish(0.13, 2600, 420, 0.7, 0, b);
    beep({ freq: 180, dur: 0.06, type: 'sine', gain: 0.8, at: 0.1, buf: b });
    return b;
  }],
  ['tick', () => {   // 秒针（≤30s）：极短极轻
    const b = canvas(0.06);
    beep({ freq: 1320, dur: 0.025, type: 'square', gain: 0.45, buf: b });
    return b;
  }],
  ['rush', () => {   // 加速滴答（≤10s）：连击两下
    const b = canvas(0.15);
    beep({ freq: 1760, dur: 0.03, type: 'square', gain: 0.6, buf: b });
    beep({ freq: 1980, dur: 0.03, type: 'square', gain: 0.5, at: 0.09, buf: b });
    return b;
  }],
  ['win', () => {   // 通关：三音上行
    const b = canvas(0.7);
    beep({ freq: 523.25, dur: 0.14, type: 'triangle', buf: b });
    beep({ freq: 659.25, dur: 0.14, type: 'triangle', at: 0.13, buf: b });
    beep({ freq: 880, dur: 0.4, type: 'triangle', at: 0.26, buf: b });
    return b;
  }],
  ['fail', () => {   // 失败：两音下行
    const b = canvas(0.6);
    beep({ freq: 392, dur: 0.18, type: 'sine', buf: b });
    beep({ freq: 261.63, dur: 0.42, type: 'sine', at: 0.16, buf: b });
    return b;
  }],
  ['honor_god', () => {   // 超神：五音琶音 + 高音闪烁
    const b = canvas(0.75);
    const arp = [523.25, 659.25, 783.99, 1046.5, 1318.51];
    arp.forEach((freq, i) => {
      beep({ freq, dur: 0.12, type: 'triangle', at: i * 0.075, buf: b });
    });
    beep({ freq: 1567.98, dur: 0.5, type: 'triangle', at: 0.4, buf: b });
    beep({ freq: 2093.0, dur: 0.22, type: 'sine', gain: 0.6, at: 0.46, buf: b });
    return b;
  }],
  ['honor_king', () => {   // 王者：三音上行 + 干净收尾
    const b = canvas(0.55);
    beep({ freq: 587.33, dur: 0.1, type: 'triangle', buf: b });
    beep({ freq: 880, dur: 0.1, type: 'triangle', at: 0.09, buf: b });
    beep({ freq: 1174.66, dur: 0.34, type: 'triangle', at: 0.18, buf: b });
    return b;
  }],
  ['honor_pass', () => {   // 优秀：两音上挑，不抢注意力
    const b = canvas(0.4);
    beep({ freq: 523.25, dur: 0.1, type: 'sine', gain: 0.8, buf: b });
    beep({ freq: 784, dur: 0.24, type: 'sine', gain: 0.75, at: 0.1, buf: b });
    return b;
  }],
  // reject：web 版没有这个槽（Cocos 版预留），配一声短促低调的「哔-噗」
  ['reject', () => {
    const b = canvas(0.25);
    beep({ freq: 440, dur: 0.08, type: 'square', gain: 0.5, buf: b });
    beep({ freq: 330, dur: 0.12, type: 'square', gain: 0.5, at: 0.1, buf: b });
    return b;
  }],
];

/** BGM：C 大调五声音阶来回，8 拍一循环（与 web 版 BGM_NOTES / BGM_STEP_S 一致） */
const BGM_NOTES = [523.25, 659.25, 783.99, 659.25, 587.33, 698.46, 880.0, 783.99];
const BGM_STEP_S = 0.9;
const BGM_LOOPS = 4;   // 28.8s：纯周期旋律，圈数只影响文件大小与重播间隙

function renderBgm(): Float32Array {
  const total = BGM_NOTES.length * BGM_STEP_S * BGM_LOOPS + 1;
  const b = canvas(total);
  for (let loop = 0; loop < BGM_LOOPS; loop++) {
    BGM_NOTES.forEach((freq, i) => {
      bgmNote(freq, (loop * BGM_NOTES.length + i) * BGM_STEP_S, b);
    });
  }
  return b;
}

/* ------------------------------------------------------------ 主流程 */

console.log(`渲染到 ${OUT_DIR}（${SR}Hz 单声道 16-bit，音效峰值 ${NORM_SFX} / BGM 峰值 ${NORM_BGM}）`);
mkdirSync(OUT_DIR, { recursive: true });
for (const [name, render] of TRACKS) writeWav(`${name}.wav`, render(), NORM_SFX);
writeWav('bgm.wav', renderBgm(), NORM_BGM);
console.log('完成。打开 Cocos Creator 让其导入 audio/ 后重新构建；resources 为远程包，需同步上传。');
