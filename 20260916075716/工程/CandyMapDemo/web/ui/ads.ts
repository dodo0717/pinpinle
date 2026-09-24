/**
 * 广告播放（开发期模拟器）。
 *
 * 真实广告 SDK 要等正式工程（Cocos + 微信小游戏，M8）才接；原型里必须能**走完全部分支**，
 * 否则「广告没看完」「连续 3 次加载失败」这些规则没法验收。
 * 所以这里不掷骰子随机成功/失败 —— 三种结果由测试者显式点选（§13.3 / §13.4）。
 *
 * 广告播放期间的暂停由调用方负责：加体力广告在结算/失败弹窗（本来就暂停），
 * 续命广告在时间归零之后（`finished` 已置位）—— 见 §13.5。
 */

import { openDialog } from './dialog.ts';
import { ADS } from './text.ts';

export type AdKind = 'stamina' | 'revive';
/** 看完 / 没看完 / 加载失败（§13.3 / §13.4 的三种分支） */
export type AdResult = 'watched' | 'skipped' | 'failed';

/** 弹一次广告，返回玩家模拟的结果 */
export function runAd(kind: AdKind): Promise<AdResult> {
  return new Promise<AdResult>((resolve) => {
    let answered = false;
    const answer = (result: AdResult): void => {
      if (answered) return;
      answered = true;
      resolve(result);
    };

    openDialog({
      title: kind === 'stamina' ? ADS.staminaTitle : ADS.reviveTitle,
      lines: [ADS.mockBody, ADS.playing],
      rows: [
        [{ label: ADS.watched, primary: true, onClick: () => answer('watched') }],
        [
          { label: ADS.skipped, onClick: () => answer('skipped') },
          { label: ADS.failed, onClick: () => answer('failed') },
        ],
      ],
      // 弹窗不能被「暗中关掉」：调用方在 then 里恢复界面，所以这里不提供关闭路径
      onClose: () => answer('skipped'),
    });
  });
}
