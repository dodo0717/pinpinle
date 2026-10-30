/**
 * 语音说明层（2026-10-26 新增，序章 v4）
 *
 * 用户要求："所有的教学要写个简短文本，加入语音说明"。
 * 这里用浏览器自带的 **Web Speech API（`speechSynthesis`）** 做中文朗读 ——
 *
 * ⚠️ 为什么不用音频文件：`art/` 里没有任何音频素材，录配音要等美术/音频资源；
 *    TTS **零素材、零包体**（微信小游戏包体限制是硬约束），且文案改了不用重录。
 *    将来接真配音时只换本文件内部实现（把 `speak()` 换成 `<audio>` 播放），调用方一行不用动
 *    —— 与 `audio.ts`（占位合成音）同一套思路。
 *
 * ⚠️ 两条硬约束（与音效同理）：
 *   1. **浏览器不允许无手势出声**：iOS/Safari 上 `speechSynthesis.speak()` 必须在真实手势里首次调用，
 *      否则静默失败（不报错、也不排队）。所以 `warmup()` 挂在 main.ts 的首次 pointerdown 上；
 *   2. **不支持就彻底静默**：没有 `speechSynthesis`（老浏览器 / 部分 WebView）或没有中文语音时，
 *      `speak()` 是空操作 —— 教学**不能因为语音不可用而卡住**，文本照常显示。
 *
 * 本文件不碰 DOM，Node 里也能 import（`speechSynthesis` 只在函数体里取用），
 * 这样 `test/ui-modules.test.ts` 的「相对导入都能解析」检查才不会挂。
 */

export interface GameSpeech {
  /** 朗读一句（会打断上一句）；未启用 / 不支持 / 无中文语音时空操作 */
  speak(text: string): void;
  /** 立即停止并清空队列（跳过教学 / 退出序章 / 关掉开关时调用） */
  stop(): void;
  /**
   * 首次用户手势里调一次（配合 `audio.unlock()`）。
   * 目的不是出声，是**拿到朗读许可**：iOS/Safari 不在手势里首次 speak，之后就永远不出声。
   */
  warmup(): void;
  /** 设置里的「语音说明」开关 */
  setEnabled(on: boolean): void;
  isEnabled(): boolean;
  /** 当前环境能否朗读（用于自检与排查；不支持时 UI 不必隐藏开关，只是没声音） */
  supported(): boolean;
}

/** 朗读语速：教学语速稍慢一点点，比正常对话清楚；太快新手跟不上 */
const RATE = 1.0;
const PITCH = 1.05;

export function createSpeech(): GameSpeech {
  let enabled = true;
  /** 中文语音缓存；`voiceschanged` 后置空重取（Chrome 首次是异步给列表） */
  let cached: SpeechSynthesisVoice | null = null;
  let cachedFor = -1;

  function synth(): SpeechSynthesis | null {
    const w = window as unknown as { speechSynthesis?: SpeechSynthesis };
    return w.speechSynthesis ?? null;
  }

  /** 挑一个中文语音：优先 zh-CN，其次任意 zh，最后交给浏览器默认（按 lang 自己匹配） */
  function pickVoice(): SpeechSynthesisVoice | null {
    const s = synth();
    if (!s) return null;
    const list = s.getVoices();
    if (list.length !== cachedFor) {
      cached = null;
      cachedFor = list.length;
    }
    if (cached) return cached;
    // ⚠️ 一次都没给过列表时（Chrome 首帧），不要缓存 null 的结论 —— 下一帧可能就有了
    if (list.length === 0) return null;
    const zh = list.filter((v) => v.lang.toLowerCase().startsWith('zh'));
    cached =
      zh.find((v) => v.lang.toLowerCase() === 'zh-cn') ??
      zh.find((v) => v.lang.toLowerCase().startsWith('zh-hans')) ??
      zh[0] ??
      null;
    return cached;
  }

  function utter(text: string): SpeechSynthesisUtterance | null {
    const Ctor =
      (window as unknown as { SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance })
        .SpeechSynthesisUtterance ?? null;
    if (!Ctor) return null;
    const u = new Ctor(text);
    u.lang = 'zh-CN';
    u.rate = RATE;
    u.pitch = PITCH;
    const v = pickVoice();
    if (v) u.voice = v;
    return u;
  }

  return {
    speak(text: string): void {
      const s = synth();
      if (!s || !enabled || !text) return;
      const u = utter(text);
      if (!u) return;
      // 打断上一句：教学是"一步一步"的，两句叠着念反而听不清
      s.cancel();
      s.speak(u);
    },

    stop(): void {
      synth()?.cancel();
    },

    warmup(): void {
      const s = synth();
      if (!s || !enabled) return;
      const u = utter('');
      if (u) {
        u.volume = 0; // 预热只要"许可"，不要真的出声
        s.speak(u);
      }
    },

    setEnabled(on: boolean): void {
      enabled = on;
      if (!on) synth()?.cancel();
    },

    isEnabled(): boolean {
      return enabled;
    },

    supported(): boolean {
      return synth() !== null;
    },
  };
}
