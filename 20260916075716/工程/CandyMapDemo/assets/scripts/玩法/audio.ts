/**
 * 音效组件 —— `GameBootstrap` 用 `mount('Audio', GameAudio)` 挂在关卡节点上。
 *
 * 真正的发声在 `sfx.ts`（WebAudio 现场合成，逐字移植 `web/ui/audio.ts`，零素材）：
 * 本文件只是**一层委托**，保留节点挂载的用法，同时让没有 Game 节点的首页
 * （地图 / 设置页）也能直接用同一个 `sfx` 单例 —— Web 版 `const audio = createAudio()`
 * 本来也是全局一份，不存在「进关才创建播放器」这回事。
 *
 * 两个开关（§11.4 音效 / 背景音乐）仍然在这里收口：界面只管 `setSound` / `setBgm`，
 * 不用在每个播放点判开关 —— 否则漏判一处就是「关了音效还有声音」。
 *
 * ⚠️ 3.8 的 `AudioSource` 那条老路已废弃：`assets/resources/audio/` 里从来没有任何素材，
 *    所有 `play()` 都在「缺素材 → 静默」分支里空转，等于**全程无声**。现在改走合成，
 *    听感与 Web 端一致，也不给小游戏包体加压。将来有真素材了只换 `sfx.ts` 内部实现。
 */

import { _decorator, Component } from 'cc';
import { sfx, type SfxName, type SfxState } from './sfx';
const { ccclass } = _decorator;

/** 11 个音槽，与 Web 端一一对应（命名沿用 Cocos 侧） */
export type SoundName = SfxName;

@ccclass('GameAudio')
export class GameAudio extends Component {
  setSound(on: boolean): void { sfx.setSound(on); }

  setBgm(on: boolean): void { sfx.setBgm(on); }

  /** 倒计时是否在走 —— 决定滴答与 BGM 该不该响（原版 `syncAudio`） */
  setRunning(on: boolean): void { sfx.setRunning(on); }

  play(name: SoundName): void { sfx.play(name); }

  /** 首次用户手势解锁（浏览器要求手势后才允许出声） */
  unlock(): void { sfx.unlock(); }

  /** 排查用：是否已解锁 / 音效开关 / BGM 开关 / 倒计时状态 */
  state(): SfxState { return sfx.state(); }
}
