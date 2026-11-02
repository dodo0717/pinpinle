/**
 * 音效层 —— 逐字移植 `web/ui/audio.ts`。
 *
 * ## 为什么是「合成音」而不是素材
 *
 * Web 端 `art/` 里本来就没有音频文件，M7 验收的是**接线**：11 个音槽 + 设置里的
 * 音效/BGM 开关 +「倒计时暂停 → 声音一起停」。原版用 WebAudio 现场合成一组占位音
 * 把链路跑通，所以 Cocos 端同样**零素材**移植：合成参数（频率 / 时长 / 包络 / 音量）
 * 与 Web 源文件逐个对齐，两边听感一致，且不给小游戏包体加压。
 *
 * 将来接真素材时只换本文件内部实现（把 `synth*` 换成 `AudioClip` + `AudioSource`），
 * 调用方（GameBootstrap / MapBootstrap / 设置页）一行都不用动。
 *
 * ## 两条硬约束（照搬原版注释）
 *
 * 1. **浏览器不允许无手势出声**：`unlock()` 必须在真实用户手势里调。在此之前所有
 *    `play()` 都是空操作 —— 不能报错、不能排队。
 * 2. **随倒计时暂停**：`setRunning(false)` 要立刻停掉 BGM 与滴答，否则暂停弹窗后面
 *    还在「哒、哒、哒」，玩家会以为时间还在跑。
 *
 * 本文件不 import `cc`，Node 里也能跑（单测可直接 new）。
 */

/** 事件音槽位（另有一条 BGM，由 setBgm 控制）；命名沿用 Cocos 侧（honorGod 等） */
export type SfxName =
  | 'swap'
  | 'eliminate'
  | 'drop'
  | 'tick'
  | 'rush'
  | 'win'
  | 'fail'
  | 'honorGod'
  | 'honorKing'
  | 'honorPass'
  /** 交换无效（Cocos 侧历史槽位）；Web 版没有这个音 —— 保持「不新增 Web 没有的行为」，不发声 */
  | 'reject';

export interface SfxState {
  /** 已被用户手势解锁（未解锁时一切 play 都是空操作） */
  unlocked: boolean;
  sound: boolean;
  bgm: boolean;
  running: boolean;
}

/** 占位音基准音量：正式素材接入后由素材自身响度决定，这里只需要「能听见」 */
const SFX_GAIN = 0.11;
const BGM_GAIN = 0.05;

/** BGM 占位旋律：C 大调五声音阶来回，8 拍一循环 */
const BGM_NOTES: readonly number[] = [523.25, 659.25, 783.99, 659.25, 587.33, 698.46, 880.0, 783.99];
const BGM_STEP_S = 0.9;

type AudioCtxCtor = new () => AudioContext;

function audioCtor(): AudioCtxCtor | null {
  const g = globalThis as unknown as {
    AudioContext?: AudioCtxCtor;
    webkitAudioContext?: AudioCtxCtor;
  };
  return g.AudioContext ?? g.webkitAudioContext ?? null;
}

export class Sfx {
  private ctx: AudioContext | null = null;
  private sfxBus: GainNode | null = null;
  private bgmBus: GainNode | null = null;

  private soundOn = true;
  private bgmOn = true;
  /** 倒计时是否在走。原版初值就是 true（首页也允许 BGM 响） */
  private running = true;

  private bgmTimer: number = 0;
  private bgmStep = 0;
  /** ctx 时间轴上「下一个音该响」的时刻：累加而不是 setTimeout 递归，避免逐拍漂移 */
  private bgmNextAt = 0;

  /** 建总线：音效与 BGM 各一条，方便分别调音量/淡出 */
  private ensureContext(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const Ctor = audioCtor();
    if (!Ctor) return null;   // 无 WebAudio（原生 / 小游戏）→ 全程静默，不报错
    this.ctx = new Ctor();
    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = SFX_GAIN;
    this.sfxBus.connect(this.ctx.destination);
    this.bgmBus = this.ctx.createGain();
    this.bgmBus.gain.value = BGM_GAIN;
    this.bgmBus.connect(this.ctx.destination);
    return this.ctx;
  }

  private now(): number {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  /** 一个带指数衰减包络的音（占位音的基本积木） */
  private beep(opts: {
    freq: number;
    dur: number;
    type: OscillatorType;
    gain?: number;
    /** 频率滑到的目标值（做「叮——」或「唰」的听感） */
    slideTo?: number;
    at?: number;
  }): void {
    if (!this.ctx || !this.sfxBus) return;
    const t0 = opts.at ?? this.now();
    const osc = this.ctx.createOscillator();
    osc.type = opts.type;
    osc.frequency.setValueAtTime(Math.max(1, opts.freq), t0);
    if (opts.slideTo !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.slideTo), t0 + opts.dur);
    }
    const g = this.ctx.createGain();
    const peak = opts.gain ?? 1;
    // 1.5ms 淡入：直接给满会「咔」一声（方波尤其明显）
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + 0.0015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);
    osc.connect(g).connect(this.sfxBus);
    osc.start(t0);
    osc.stop(t0 + opts.dur + 0.02);
  }

  /** 噪声（掉落/补位的「唰」）：低通从高到低扫一遍，得到气流下落感 */
  private swish(dur: number, from: number, to: number, gain = 0.7): void {
    if (!this.ctx || !this.sfxBus) return;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / len);   // 自带线性衰减：起手最响，尾巴收干净
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    const t0 = this.now();
    filter.frequency.setValueAtTime(from, t0);
    filter.frequency.exponentialRampToValueAtTime(Math.max(80, to), t0 + dur);
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(filter).connect(g).connect(this.sfxBus);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  private playSfx(name: SfxName): void {
    switch (name) {
      case 'swap': // 交换：短促一声「嗒」，像贴纸被拎起来
        this.beep({ freq: 620, dur: 0.07, type: 'triangle', gain: 0.9 });
        break;
      case 'eliminate': // 消除：上行双音「叮-铃」，本作的正反馈主角
        this.beep({ freq: 784, dur: 0.1, type: 'triangle' });
        this.beep({ freq: 1175, dur: 0.16, type: 'triangle', at: this.now() + 0.06 });
        break;
      case 'drop': // 掉落/补位：气流声，落地那下再补一个木鱼似的低音
        this.swish(0.13, 2600, 420);
        this.beep({ freq: 180, dur: 0.06, type: 'sine', gain: 0.8, at: this.now() + 0.1 });
        break;
      case 'tick': // 秒针（≤30s）：极短、极轻
        this.beep({ freq: 1320, dur: 0.025, type: 'square', gain: 0.45 });
        break;
      case 'rush': // 加速滴答（≤10s）：比秒针高、连击两下，制造紧迫
        this.beep({ freq: 1760, dur: 0.03, type: 'square', gain: 0.6 });
        this.beep({ freq: 1980, dur: 0.03, type: 'square', gain: 0.5, at: this.now() + 0.09 });
        break;
      case 'win': // 通关：三音上行，最后一下拖长
        this.beep({ freq: 523.25, dur: 0.14, type: 'triangle' });
        this.beep({ freq: 659.25, dur: 0.14, type: 'triangle', at: this.now() + 0.13 });
        this.beep({ freq: 880, dur: 0.4, type: 'triangle', at: this.now() + 0.26 });
        break;
      case 'fail': // 失败：两音下行，闷一点，不刺耳
        this.beep({ freq: 392, dur: 0.18, type: 'sine' });
        this.beep({ freq: 261.63, dur: 0.42, type: 'sine', at: this.now() + 0.16 });
        break;

      /* 荣誉三档（《通关及排名》§五「音效要点」） */
      case 'honorGod': {
        // 超神：强但轻快 —— 五音上行琶音跨两个八度，尾巴补一声高音闪烁
        const t = this.now();
        [523.25, 659.25, 783.99, 1046.5, 1318.51].forEach((freq, i) => {
          this.beep({ freq, dur: 0.12, type: 'triangle', at: t + i * 0.075 });
        });
        this.beep({ freq: 1567.98, dur: 0.5, type: 'triangle', at: t + 0.4 });
        this.beep({ freq: 2093.0, dur: 0.22, type: 'sine', gain: 0.6, at: t + 0.46 });
        break;
      }
      case 'honorKing': {
        // 王者：清脆 —— 三音上行 + 一声铃，干净收尾
        const t = this.now();
        this.beep({ freq: 587.33, dur: 0.1, type: 'triangle', at: t });
        this.beep({ freq: 880, dur: 0.1, type: 'triangle', at: t + 0.09 });
        this.beep({ freq: 1174.66, dur: 0.34, type: 'triangle', at: t + 0.18 });
        break;
      }
      case 'honorPass':
        // 优秀：轻量 —— 两音上挑，音量压低，不抢结算界面的注意力
        this.beep({ freq: 523.25, dur: 0.1, type: 'sine', gain: 0.8 });
        this.beep({ freq: 784, dur: 0.24, type: 'sine', gain: 0.75, at: this.now() + 0.1 });
        break;
      case 'reject':
        // Web 版没有这个音槽（按下的无效反馈是按 Web 的 shake 动画走的），不发声
        break;
    }
  }

  /** 排一个 BGM 音（占位旋律：三角波 + 慢包络，轻轻铺在底下） */
  private bgmNote(freq: number, at: number): void {
    if (!this.ctx || !this.bgmBus) return;
    const dur = 0.8;
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.9, at + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(g).connect(this.bgmBus);
    osc.start(at);
    osc.stop(at + dur + 0.02);
  }

  private pumpBgm = (): void => {
    if (!this.ctx || !this.bgmOn || !this.running) {
      this.bgmTimer = 0;
      return;
    }
    // 提前 0.7s 排音：给定时器留出被主线程卡住（消除动画、渲染）的余量
    const horizon = this.ctx.currentTime + 0.7;
    if (this.bgmNextAt < this.ctx.currentTime) this.bgmNextAt = this.ctx.currentTime + 0.06;
    while (this.bgmNextAt < horizon) {
      this.bgmNote(BGM_NOTES[this.bgmStep % BGM_NOTES.length]!, this.bgmNextAt);
      this.bgmStep += 1;
      this.bgmNextAt += BGM_STEP_S;
    }
    this.bgmTimer = setTimeout(this.pumpBgm, 300) as unknown as number;
  };

  private startBgm(): void {
    if (!this.ctx || this.bgmTimer !== 0 || !this.bgmOn || !this.running) return;
    this.bgmNextAt = 0;
    this.pumpBgm();
  }

  private stopBgm(): void {
    if (this.bgmTimer !== 0) {
      clearTimeout(this.bgmTimer);
      this.bgmTimer = 0;
    }
    this.bgmNextAt = 0;
  }

  /* ------------------------------------------------------------ 对外接口 */

  /** 第一次用户手势时调用（浏览器要求手势后才能出声） */
  unlock(): void {
    const c = this.ensureContext();
    if (!c) return;
    // iOS/Safari 首次手势里必须 resume，否则一直 suspended（表现为「完全没声音」）
    if (c.state === 'suspended') void c.resume();
    this.startBgm();
  }

  play(name: SfxName): void {
    if (!this.ctx || !this.soundOn) return;
    // 滴答类只在倒计时真的在走时才响（暂停中不该有节拍）
    if (!this.running && (name === 'tick' || name === 'rush')) return;
    this.playSfx(name);
  }

  setSound(on: boolean): void {
    this.soundOn = on;
  }

  setBgm(on: boolean): void {
    this.bgmOn = on;
    if (on) this.startBgm();
    else this.stopBgm();
  }

  /** 倒计时是否在走 —— 决定滴答与 BGM 该不该响（原版 syncAudio） */
  setRunning(next: boolean): void {
    if (this.running === next) return;
    this.running = next;
    if (this.running) this.startBgm();
    else this.stopBgm();
  }

  state(): SfxState {
    return {
      unlocked: this.ctx !== null,
      sound: this.soundOn,
      bgm: this.bgmOn,
      running: this.running,
    };
  }
}

/** 全局单例：首页与关卡共用一份（Web 版 `const audio = createAudio()` 也是全局一份） */
export const sfx = new Sfx();
