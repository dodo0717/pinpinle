/**
 * 音效层（M7 §15）。
 *
 * ## 为什么是「合成占位音」
 *
 * `art/` 里目前没有任何音频文件，而 M7 要验收的是**接线**：8 个音效槽位、设置里的
 * 音效/BGM 开关、以及「倒计时暂停 → 声音一起停」。所以这里用 WebAudio 现场合成
 * 一组占位音把整条链路跑通：
 *
 *   - 调用方只认槽位名（`play('eliminate')`），**将来接真素材时只换本文件内部实现**
 *     （把 `synth()` 换成 `decodeAudioData` + `BufferSource`），调用方一行不用动；
 *   - 音量刻意压低（占位音是方波/噪声，响度天生比正式素材高）。
 *
 * ## 两条硬约束
 *
 * 1. **浏览器不允许无手势出声**：`unlock()` 必须在真实用户手势里调（main.ts 挂在
 *    第一次 pointerdown 上）。在此之前所有 `play()` 都是空操作，不能报错、不能排队。
 * 2. **随倒计时暂停**（§M7 第 4 条）：`setRunning(false)` 时要立刻停掉 BGM 与滴答，
 *    否则暂停弹窗后面还在「哒、哒、哒」地走，玩家会以为时间还在跑。
 *
 * 本文件不碰 DOM 结构，Node 里也能 import（`AudioContext` 只在函数体里取用），
 * 这样 `test/ui-modules.test.ts` 的「main.ts 的相对导入都能解析」检查才能通过。
 */

/**
 * 事件音槽位（另有一条 BGM，由 `setBgm` 控制）。
 *
 * M7 定了 7 个；M9 因为《通关及排名》要求「三档荣誉各有一套音效」，
 * 追加了 `honor-god / honor-king / honor-pass` 三个 —— **槽位从 8 个变成 11 个**，
 * 接真素材时按这三个名字各准备一条即可。
 */
export type SfxName =
  | 'swap'
  | 'eliminate'
  | 'drop'
  | 'tick'
  | 'rush'
  | 'win'
  | 'fail'
  | 'honor-god'
  | 'honor-king'
  | 'honor-pass';

export interface GameAudio {
  /** 第一次用户手势时调用（浏览器要求手势后才能出声） */
  unlock(): void;
  /** 播放一次性音效；未解锁 / 音效关闭 / 倒计时暂停（滴答类）时是空操作 */
  play(name: SfxName): void;
  /** 设置里的「音效」开关 */
  setSound(on: boolean): void;
  /** 设置里的「背景音乐」开关 */
  setBgm(on: boolean): void;
  /** 倒计时是否在走（§M7 第 4 条：暂停 → BGM 与滴答一起停） */
  setRunning(running: boolean): void;
  /** 当前真实状态，用于自检与排查 */
  state(): { unlocked: boolean; sound: boolean; bgm: boolean; running: boolean };
}

/** 占位音的基准音量：正式素材接入后由素材自身响度决定，这里只需要「能听见」 */
const SFX_GAIN = 0.11;
const BGM_GAIN = 0.05;

/** BGM 占位旋律：C 大调五声音阶来回，8 拍一循环，听起来不至于吵 */
const BGM_NOTES: readonly number[] = [523.25, 659.25, 783.99, 659.25, 587.33, 698.46, 880.0, 783.99];
const BGM_STEP_S = 0.9;

export function createAudio(): GameAudio {
  let ctx: AudioContext | null = null;
  let sfxBus: GainNode | null = null;
  let bgmBus: GainNode | null = null;

  let soundOn = true;
  let bgmOn = true;
  let running = true;

  let bgmTimer = 0;
  let bgmStep = 0;
  /** ctx 时间轴上「下一个音该响」的时刻，用累加而不是 setTimeout 递归，避免逐拍漂移 */
  let bgmNextAt = 0;

  function audioCtor(): typeof AudioContext | null {
    const w = window as unknown as {
      AudioContext?: typeof AudioContext;
      webkitAudioContext?: typeof AudioContext;
    };
    return w.AudioContext ?? w.webkitAudioContext ?? null;
  }

  /** 建总线：音效与 BGM 各一条，方便分别调音量/淡出 */
  function ensureContext(): AudioContext | null {
    if (ctx) return ctx;
    const Ctor = audioCtor();
    if (!Ctor) return null;
    ctx = new Ctor();
    sfxBus = ctx.createGain();
    sfxBus.gain.value = SFX_GAIN;
    sfxBus.connect(ctx.destination);
    bgmBus = ctx.createGain();
    bgmBus.gain.value = BGM_GAIN;
    bgmBus.connect(ctx.destination);
    return ctx;
  }

  function now(): number {
    return ctx ? ctx.currentTime : 0;
  }

  /** 一个带指数衰减包络的音（占位音的基本积木） */
  function beep(opts: {
    freq: number;
    dur: number;
    type: OscillatorType;
    gain?: number;
    /** 频率滑到的目标值（做「叮——」或「唰」的听感） */
    slideTo?: number;
    at?: number;
  }): void {
    if (!ctx || !sfxBus) return;
    const t0 = opts.at ?? now();
    const osc = ctx.createOscillator();
    osc.type = opts.type;
    osc.frequency.setValueAtTime(Math.max(1, opts.freq), t0);
    if (opts.slideTo !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.slideTo), t0 + opts.dur);
    }
    const g = ctx.createGain();
    const peak = opts.gain ?? 1;
    // 1.5ms 淡入：直接给满会「咔」一声（占位音的方波尤其明显）
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + 0.0015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);
    osc.connect(g).connect(sfxBus);
    osc.start(t0);
    osc.stop(t0 + opts.dur + 0.02);
  }

  /** 噪声（掉落/补位的「唰」）：低通从高到低扫一遍，得到气流下落感 */
  function swish(dur: number, from: number, to: number, gain = 0.7): void {
    if (!ctx || !sfxBus) return;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) {
      // 自带线性衰减：起手最响，尾巴收干净
      data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    const t0 = now();
    filter.frequency.setValueAtTime(from, t0);
    filter.frequency.exponentialRampToValueAtTime(Math.max(80, to), t0 + dur);
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(filter).connect(g).connect(sfxBus);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  function playSfx(name: SfxName): void {
    switch (name) {
      case 'swap': // 交换：短促一声「嗒」，像贴纸被拎起来
        beep({ freq: 620, dur: 0.07, type: 'triangle', gain: 0.9 });
        break;
      case 'eliminate': // 消除：上行双音「叮-铃」，是本作的正反馈主角
        beep({ freq: 784, dur: 0.1, type: 'triangle' });
        beep({ freq: 1175, dur: 0.16, type: 'triangle', at: now() + 0.06 });
        break;
      case 'drop': // 掉落/补位：气流声，落地那下再补一个木鱼似的低音
        swish(0.13, 2600, 420);
        beep({ freq: 180, dur: 0.06, type: 'sine', gain: 0.8, at: now() + 0.1 });
        break;
      case 'tick': // 秒针（≤30s）：极短、极轻，只在余量不多时出现
        beep({ freq: 1320, dur: 0.025, type: 'square', gain: 0.45 });
        break;
      case 'rush': // 加速滴答（≤10s）：比秒针高、连击两下，制造紧迫
        beep({ freq: 1760, dur: 0.03, type: 'square', gain: 0.6 });
        beep({ freq: 1980, dur: 0.03, type: 'square', gain: 0.5, at: now() + 0.09 });
        break;
      case 'win': // 通关：三音上行，最后一下拖长
        beep({ freq: 523.25, dur: 0.14, type: 'triangle' });
        beep({ freq: 659.25, dur: 0.14, type: 'triangle', at: now() + 0.13 });
        beep({ freq: 880, dur: 0.4, type: 'triangle', at: now() + 0.26 });
        break;
      case 'fail': // 失败：两音下行，闷一点，不刺耳
        beep({ freq: 392, dur: 0.18, type: 'sine' });
        beep({ freq: 261.63, dur: 0.42, type: 'sine', at: now() + 0.16 });
        break;

      /* M9 荣誉弹窗三档（《通关及排名》§五「音效要点」） */
      case 'honor-god': {
        // 超神：强但轻快 —— 五音上行琶音，音域拉到两个八度，尾巴再补一声高音闪烁
        const t = now();
        const arp = [523.25, 659.25, 783.99, 1046.5, 1318.51];
        arp.forEach((freq, i) => {
          beep({ freq, dur: 0.12, type: 'triangle', at: t + i * 0.075 });
        });
        beep({ freq: 1567.98, dur: 0.5, type: 'triangle', at: t + 0.4 });
        beep({ freq: 2093.0, dur: 0.22, type: 'sine', gain: 0.6, at: t + 0.46 });
        break;
      }
      case 'honor-king': {
        // 王者：清脆 —— 三音上行 + 一声铃，干净收尾
        const t = now();
        beep({ freq: 587.33, dur: 0.1, type: 'triangle', at: t });
        beep({ freq: 880, dur: 0.1, type: 'triangle', at: t + 0.09 });
        beep({ freq: 1174.66, dur: 0.34, type: 'triangle', at: t + 0.18 });
        break;
      }
      case 'honor-pass':
        // 优秀：轻量 —— 两音上挑，音量压低，不抢结算界面的注意力
        beep({ freq: 523.25, dur: 0.1, type: 'sine', gain: 0.8 });
        beep({ freq: 784, dur: 0.24, type: 'sine', gain: 0.75, at: now() + 0.1 });
        break;
    }
  }

  /** 排一个 BGM 音（占位旋律：三角波 + 慢包络，轻轻铺在底下） */
  function bgmNote(freq: number, at: number): void {
    if (!ctx || !bgmBus) return;
    const dur = 0.8;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.9, at + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(g).connect(bgmBus);
    osc.start(at);
    osc.stop(at + dur + 0.02);
  }

  function pumpBgm(): void {
    if (!ctx || !bgmOn || !running) {
      bgmTimer = 0;
      return;
    }
    // 提前 0.7s 排音：给定时器留出被主线程卡住（消除动画、渲染）的余量
    const horizon = ctx.currentTime + 0.7;
    if (bgmNextAt < ctx.currentTime) bgmNextAt = ctx.currentTime + 0.06;
    while (bgmNextAt < horizon) {
      bgmNote(BGM_NOTES[bgmStep % BGM_NOTES.length]!, bgmNextAt);
      bgmStep += 1;
      bgmNextAt += BGM_STEP_S;
    }
    bgmTimer = window.setTimeout(pumpBgm, 300);
  }

  function startBgm(): void {
    if (!ctx || bgmTimer !== 0 || !bgmOn || !running) return;
    bgmNextAt = 0;
    pumpBgm();
  }

  function stopBgm(): void {
    if (bgmTimer !== 0) {
      window.clearTimeout(bgmTimer);
      bgmTimer = 0;
    }
    bgmNextAt = 0;
  }

  return {
    unlock(): void {
      const c = ensureContext();
      if (!c) return;
      // iOS/Safari 首次手势里必须 resume，否则一直 suspended（表现为「完全没声音」）
      if (c.state === 'suspended') void c.resume();
      startBgm();
    },

    play(name: SfxName): void {
      if (!ctx || !soundOn) return;
      // 滴答类只在倒计时真的在走时才响（暂停中不该有节拍）
      if (!running && (name === 'tick' || name === 'rush')) return;
      playSfx(name);
    },

    setSound(on: boolean): void {
      soundOn = on;
    },

    setBgm(on: boolean): void {
      bgmOn = on;
      if (on) startBgm();
      else stopBgm();
    },

    setRunning(next: boolean): void {
      if (running === next) return;
      running = next;
      if (running) startBgm();
      else stopBgm();
    },

    state(): { unlocked: boolean; sound: boolean; bgm: boolean; running: boolean } {
      return { unlocked: ctx !== null, sound: soundOn, bgm: bgmOn, running };
    },
  };
}
