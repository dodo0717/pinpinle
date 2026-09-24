/**
 * 音效 —— 对应 web/ui/audio.ts。
 *
 * 原版用 WebAudio 现场合成 11 个音槽（swap / eliminate / drop / tick / rush / win /
 * fail / honor ×3），好处是零素材。Cocos 里走 `AudioSource` + `resources/audio/*`，
 * 素材缺失时**静默降级**（不能因为少了音频文件就让游戏起不来）。
 *
 * 两个开关（§11.4 音效 / 背景音乐）在这里收口：界面只管 `setSound` / `setBgm`，
 * 不用在每个播放点判开关 —— 否则漏判一处就是「关了音效还有声音」。
 */

import { _decorator, Component, Node, AudioSource, AudioClip, resources, game, Game } from 'cc';
const { ccclass } = _decorator;

/** 11 个音槽，与原版一一对应 */
export type SoundName =
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
  | 'reject';

const CLIP_PATH: Record<SoundName, string> = {
  swap: 'audio/swap',
  eliminate: 'audio/eliminate',
  drop: 'audio/drop',
  tick: 'audio/tick',
  rush: 'audio/rush',
  win: 'audio/win',
  fail: 'audio/fail',
  honorGod: 'audio/honor_god',
  honorKing: 'audio/honor_king',
  honorPass: 'audio/honor_pass',
  reject: 'audio/reject',
};

const BGM_PATH = 'audio/bgm';

@ccclass('GameAudio')
export class GameAudio extends Component {
  private src: AudioSource = null!;
  private bgmSrc: AudioSource = null!;
  private clips = new Map<SoundName, AudioClip>();
  private soundOn = true;
  private bgmOn = true;
  /** 倒计时是否在走 —— 决定 BGM 该不该响（原版 syncAudio） */
  private running = false;

  onLoad(): void {
    this.src = this.node.addComponent(AudioSource);
    this.bgmSrc = this.node.addComponent(AudioSource);
    this.bgmSrc.loop = true;
    this.loadAll();
    // 切后台时停 BGM，回前台按 running 恢复（否则后台还在响）
    game.on(Game.EVENT_HIDE, this.onHide, this);
    game.on(Game.EVENT_SHOW, this.onShow, this);
  }

  onDestroy(): void {
    game.off(Game.EVENT_HIDE, this.onHide, this);
    game.off(Game.EVENT_SHOW, this.onShow, this);
  }

  private loadAll(): void {
    for (const key of Object.keys(CLIP_PATH) as SoundName[]) {
      resources.load(CLIP_PATH[key], AudioClip, (err, clip) => {
        if (err || !clip) return;   // 缺素材静默：不打印、不阻断
        this.clips.set(key, clip);
      });
    }
    resources.load(BGM_PATH, AudioClip, (err, clip) => {
      if (err || !clip) return;
      this.bgmSrc.clip = clip;
      this.syncBgm();
    });
  }

  /* ------------------------------------------------------------ 开关 */

  setSound(on: boolean): void { this.soundOn = on; }

  setBgm(on: boolean): void {
    this.bgmOn = on;
    this.syncBgm();
  }

  /**
   * 与主循环的判据逐字对齐：`started && !paused && !finished && 在局内`。
   * 只要有一处不一致，就会出现「倒计时停了 BGM 还在放」这类声音对不上的问题。
   */
  setRunning(on: boolean): void {
    this.running = on;
    this.syncBgm();
  }

  private syncBgm(): void {
    if (!this.bgmSrc) return;
    if (this.bgmOn && this.running && this.bgmSrc.clip) {
      if (!this.bgmSrc.playing) this.bgmSrc.play();
    } else if (this.bgmSrc.playing) {
      this.bgmSrc.stop();
    }
  }

  private onHide(): void { if (this.bgmSrc?.playing) this.bgmSrc.pause(); }
  private onShow(): void {
    if (!this.bgmSrc) return;
    if (this.bgmOn && this.running) this.bgmSrc.resume();
  }

  /* ------------------------------------------------------------ 播放 */

  play(name: SoundName): void {
    if (!this.soundOn || !this.src) return;
    const clip = this.clips.get(name);
    if (!clip) return;
    this.src.playOneShot(clip, 1);
  }

  /**
   * 首次用户手势解锁（Cocos 需要，否则自动播放被拦）。
   * 素材还没加载完时什么都不做 —— 拿 null 去 playOneShot 在真机上是会崩的。
   */
  unlock(): void {
    if (!this.src) return;
    const clip = this.clips.get('swap');
    if (clip) this.src.playOneShot(clip, 0);
  }

  /** 排查用：音效开关 / BGM 是否在响 / 已加载几个音槽 */
  state(): { sound: boolean; bgm: boolean; running: boolean; clips: number } {
    return {
      sound: this.soundOn,
      bgm: this.bgmOn && this.running,
      running: this.running,
      clips: this.clips.size,
    };
  }
}
