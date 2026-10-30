/**
 * 语音说明层（从 web/ui/speech.ts 移植，2026-10-30）
 *
 * Web 版用浏览器自带的 `speechSynthesis` 做中文朗读；**微信小游戏没有这个 API**，
 * 也没有系统级 TTS —— 所以 Cocos 端先做**静默实现**：教学短句照常显示在横幅/聚光灯上，
 * `speak()` 是空操作，教学**不能因为语音不可用而卡住**。
 *
 * 将来接真配音（音频文件）时只换本文件内部实现：把 `speak()` 换成
 * `AudioSource.play()` 按句子查表播放，调用方一行不用动 —— 与 `audio.ts` 同一套思路。
 *
 * ⚠️ 不 import 'cc'、不碰任何平台 API —— 这是纯逻辑模块，Node 里也能 import，
 *    `tools/check-portability.mjs` 才能放过。
 */

export interface GameSpeech {
  /** 朗读一句（会打断上一句）；未启用 / 不支持时静默降级为空操作 */
  speak(text: string): void;
  /** 立即停止并清空队列（跳过教学 / 退出序章 / 关掉开关时调用） */
  stop(): void;
  /** 首次用户手势里调一次（配合 audio.unlock()；Web 版用来拿朗读许可，小游戏版占位） */
  warmup(): void;
  /** 设置里的「语音说明」开关 */
  setEnabled(on: boolean): void;
  isEnabled(): boolean;
  /** 当前环境能否朗读（小游戏端现阶段恒 false，UI 不必隐藏开关，只是没声音） */
  supported(): boolean;
}

export function createSpeech(): GameSpeech {
  let enabled = true;
  return {
    speak(_text: string): void {
      // TODO(小游戏)：接真配音时，在此按句查表用 AudioSource 播放对应音频文件
    },
    stop(): void {},
    warmup(): void {},
    setEnabled(on: boolean): void {
      enabled = on;
    },
    isEnabled(): boolean {
      return enabled;
    },
    supported(): boolean {
      return false;
    },
  };
}
