/**
 * 音效 —— 对应 web/ui/audio.ts。
 *
 * 原版用 WebAudio 现场合成 11 个音槽（swap / eliminate / drop / tick / rush / win /
 * fail / honor ×3），好处是零素材。Cocos 里走 `AudioSource` + `resources/audio/*`，
 * 素材缺失时降级但**不静默**（控制台打 `[audio]` 日志，游戏照常起）。
 *
 * 两个开关（§11.4 音效 / 背景音乐）在这里收口：界面只管 `setSound` / `setBgm`，
 * 不用在每个播放点判开关 —— 否则漏判一处就是「关了音效还有声音」。
 */

import { _decorator, Component, Node, AudioSource, AudioClip, resources, game, Game } from '../../runtime/cc.js';
const { ccclass } = _decorator;

/** 11 个音槽，与原版一一对应 */
                       
          
               
          
          
          
         
          
              
               
               
             

const CLIP_PATH                            = {
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

export class GameAudio extends Component {
          src              = null ;
          bgmSrc              = null ;
          clips = new Map                      ();
          soundOn = true;
          bgmOn = true;
  /** 倒计时是否在走 —— 决定 BGM 该不该响（原版 syncAudio） */
          running = false;
  /** BGM 首次起播打日志用（排查真机无声时确认播放路径走到没有） */
          bgmLogged = false;

  onLoad()       {
    this.src = this.node.addComponent(AudioSource);
    this.bgmSrc = this.node.addComponent(AudioSource);
    this.bgmSrc.loop = true;
    this.loadAll();
    // 切后台时停 BGM，回前台按 running 恢复（否则后台还在响）
    game.on(Game.EVENT_HIDE, this.onHide, this);
    game.on(Game.EVENT_SHOW, this.onShow, this);
  }

  onDestroy()       {
    game.off(Game.EVENT_HIDE, this.onHide, this);
    game.off(Game.EVENT_SHOW, this.onShow, this);
  }

          loadAll()       {
    // 缺素材不阻断（游戏照常起），但要打出来 —— 2026-10-24 排查「小程序没声音」时，
    // 纯静默降级让人无从下手；真机 / 开发者工具控制台看 [audio] 行即可定位
    const total = Object.keys(CLIP_PATH).length;
    let done = 0;
    for (const key of Object.keys(CLIP_PATH)               ) {
      resources.load(CLIP_PATH[key], AudioClip, (err, clip) => {
        if (err || !clip) {
          console.warn(`[audio] 音效缺失 ${CLIP_PATH[key]}：${(err                     )?.message ?? '无数据'}`);
          return;
        }
        this.clips.set(key, clip);
        done += 1;
        if (done === total) console.log(`[audio] 音效 ${done}/${total} 就绪`);
      });
    }
    resources.load(BGM_PATH, AudioClip, (err, clip) => {
      if (err || !clip) {
        console.warn(`[audio] BGM 缺失 ${BGM_PATH}：${(err                     )?.message ?? '无数据'}`);
        return;
      }
      this.bgmSrc.clip = clip;
      this.syncBgm();
      console.log('[audio] BGM 就绪');
    });
  }

  /* ------------------------------------------------------------ 开关 */

  setSound(on         )       { this.soundOn = on; }

  setBgm(on         )       {
    this.bgmOn = on;
    this.syncBgm();
  }

  /**
   * 与主循环的判据逐字对齐：`started && !paused && !finished && 在局内`。
   * 只要有一处不一致，就会出现「倒计时停了 BGM 还在放」这类声音对不上的问题。
   */
  setRunning(on         )       {
    this.running = on;
    this.syncBgm();
  }

          syncBgm()       {
    if (!this.bgmSrc) return;
    if (this.bgmOn && this.running && this.bgmSrc.clip) {
      if (!this.bgmSrc.playing) {
        this.bgmSrc.play();
        // 只在首次起播打一行：确认「对局内 → BGM 播放」这条路真的走到了
        if (!this.bgmLogged) { this.bgmLogged = true; console.log('[audio] BGM 开始播放'); }
      }
    } else if (this.bgmSrc.playing) {
      this.bgmSrc.stop();
    }
  }

          onHide()       { if (this.bgmSrc?.playing) this.bgmSrc.pause(); }
          onShow()       {
    if (!this.bgmSrc) return;
    // Cocos 3.8 的 AudioSource 没有 resume()：暂停后再 play() 就是从暂停处继续。
    // 调 resume() 在真机上会抛 TypeError，切回前台那一下整个回调就断了
    if (this.bgmOn && this.running && !this.bgmSrc.playing) this.bgmSrc.play();
  }

  /* ------------------------------------------------------------ 播放 */

  play(name           )       {
    if (!this.soundOn || !this.src) return;
    const clip = this.clips.get(name);
    if (!clip) return;
    this.src.playOneShot(clip, 1);
  }

  /**
   * 首次用户手势解锁（Cocos 需要，否则自动播放被拦）。
   * 素材还没加载完时什么都不做 —— 拿 null 去 playOneShot 在真机上是会崩的。
   */
  unlock()       {
    if (!this.src) return;
    const clip = this.clips.get('swap');
    if (clip) this.src.playOneShot(clip, 0);
  }

  /** 排查用：音效开关 / BGM 是否在响 / 已加载几个音槽 */
  state()                                                                    {
    return {
      sound: this.soundOn,
      bgm: this.bgmOn && this.running,
      running: this.running,
      clips: this.clips.size,
    };
  }
}
