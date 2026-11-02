/**
 * 语音说明层（逐字移植 `web/ui/speech.ts`）。
 *
 * Web 版用浏览器自带的 **Web Speech API（`speechSynthesis`）** 做中文朗读：
 *   - 零素材、零包体（教学文案改了不用重录，也不用给小游戏主包加压）；
 *   - 将来接真配音时只换本文件内部实现（`speak()` 换成 AudioSource 按句查表），
 *     调用方一行不用动 —— 与 `sfx.ts`（合成音效）同一套思路。
 *
 * ⚠️ 之前这里是**静默占位**（`speak()` 空操作、`supported()` 恒 false），理由是
 *    「微信小游戏没有 speechSynthesis」。但同一个包在 **web / WebView** 里是有这个 API 的，
 *    静默等于教学少了一半信息（Web 端是会说出来的）。现在照 Web 实现：
 *    有 API 就念，没有（小游戏 / 老 WebView / 无中文语音）就**彻底静默** ——
 *    教学**不能因为语音不可用而卡住**，文本横幅照常显示。
 *
 * ⚠️ 两条硬约束（与音效同理）：
 *   1. **浏览器不允许无手势出声**：iOS/Safari 上首次 `speak()` 必须在真实手势里，
 *      否则静默失败。所以 `warmup()` 挂在首次真实手势上（GameBootstrap 的触摸起手）；
 *   2. **不支持就彻底静默**，不报错、不排队。
 *
 * 本文件不 import 'cc'、不碰平台 API（`speechSynthesis` 只在函数体里取用），
 * Node 里也能 import，`tools/check-portability.mjs` 才放得过。
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
  /** 当前环境能否朗读（不支持时 UI 不必隐藏开关，只是没声音） */
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
    const g = globalThis as unknown as { speechSynthesis?: SpeechSynthesis };
    return g.speechSynthesis ?? null;
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
      (globalThis as unknown as { SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance })
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
      // 打断上一句：教学是「一步一步」的，两句叠着念反而听不清
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
        u.volume = 0;   // 预热只要「许可」，不要真的出声
        s.speak(u);
      }
    },

    setEnabled(on: boolean): void {
      enabled = on;
      if (!on) synth()?.cancel();   // 关掉就立刻闭嘴（正念到一半也要停）
    },

    isEnabled(): boolean {
      return enabled;
    },

    supported(): boolean {
      return synth() !== null;
    },
  };
}

/**
 * 全局单例：设置页（首页）与关卡层共用一份 —— Web 版 `const speech = createSpeech()`
 * 本来也是全局一份；两个实例会让首页改的「语音开关」作用不到教学里的那一股声音。
 */
export const speech = createSpeech();
