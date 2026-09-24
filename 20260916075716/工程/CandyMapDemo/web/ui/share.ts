/**
 * 分享与下载（§12.1「分享」按钮 + §11.3 图鉴「下载/分享」）。
 *
 * 两条实现口径：
 *   - 成绩分享 = **现场用 canvas 画一张成绩卡**（不预置图片，改版式只改这段代码）；
 *   - 图鉴分享/下载 = 直接用 512 的 PNG 原图。
 *
 * 浏览器能力差异很大，所以统一降级链：
 *   `navigator.share({files})` → 不支持就**下载图片**并提示「已保存，可自行发送」。
 * 微信小游戏里会换成 `wx.shareAppMessage`（M8），所以这里把能力判断收在 `shareFiles()` 一处。
 */

import { GAME_LINK, TITLE, tierOfLevel } from './text.ts';
import { el, stickerURL, toast } from './dom.ts';

function canShareFiles(file: File): boolean {
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  return typeof navigator.share === 'function' && typeof nav.canShare === 'function' && nav.canShare({ files: [file] });
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = el('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 交给浏览器读完再回收，避免 Safari 上偶发下载中断
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

async function fetchImageBlob(imageId: number): Promise<Blob | null> {
  try {
    const res = await fetch(stickerURL(imageId));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.blob();
  } catch {
    toast('图片加载失败，请稍后重试', 2400);
    return null;
  }
}

/** 下载图鉴原图（512×512 PNG） */
export async function downloadSticker(imageId: number): Promise<void> {
  const blob = await fetchImageBlob(imageId);
  if (!blob) return;
  triggerDownload(blob, `mengchong_tu${imageId}.png`);
  toast('已开始下载', 1800);
}

/** 分享图鉴原图 */
export async function shareSticker(imageId: number, caption: string): Promise<void> {
  const blob = await fetchImageBlob(imageId);
  if (!blob) return;
  const file = new File([blob], `mengchong_tu${imageId}.png`, { type: 'image/png' });
  const text = `${caption}\n${TITLE} ${GAME_LINK}`;

  if (canShareFiles(file)) {
    try {
      await navigator.share({ files: [file], text });
      return;
    } catch {
      // 用户取消分享也算失败，落到下载分支即可，不再打扰
    }
  }
  triggerDownload(blob, file.name);
  toast('当前环境不支持直接分享，已改为下载图片', 2600);
}

export interface ScoreCardInput {
  level: number;
  stars: number;
  score: number;
  /** 续命通关（统一 1 星、不上排行榜） */
  revived: boolean;
  phrase: string;
}

/** 画成绩卡（720×1000） */
function drawScoreCard(input: ScoreCardInput): HTMLCanvasElement {
  const W = 720;
  const H = 1000;
  const canvas = el('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#fff3d6');
  bg.addColorStop(0.55, '#ffe8c2');
  bg.addColorStop(1, '#ffd9b0');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // 卡片
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  roundRect(ctx, 48, 120, W - 96, H - 240, 32);
  ctx.fill();

  ctx.textAlign = 'center';
  ctx.fillStyle = '#7a5230';
  ctx.font = 'bold 46px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText(TITLE, W / 2, 220);

  ctx.font = '30px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillStyle = '#a9835c';
  ctx.fillText(`第 ${input.level} 关 · ${tierOfLevel(input.level)}`, W / 2, 280);

  // 星级
  ctx.font = '72px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillStyle = '#f5a623';
  ctx.fillText('★'.repeat(Math.max(1, input.stars)) + '☆'.repeat(Math.max(0, 3 - input.stars)), W / 2, 420);

  ctx.font = 'bold 96px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillStyle = '#5a3c1e';
  ctx.fillText(String(input.score), W / 2, 550);
  ctx.font = '30px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillStyle = '#a9835c';
  ctx.fillText('分', W / 2, 596);

  ctx.font = '36px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillStyle = '#7a5230';
  ctx.fillText(input.phrase, W / 2, 690);

  if (input.revived) {
    ctx.font = '26px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillStyle = '#c08a52';
    ctx.fillText('（续命通关，不计入排行榜）', W / 2, 742);
  }

  ctx.font = '26px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillStyle = '#b39a7c';
  ctx.fillText(GAME_LINK, W / 2, H - 150);

  return canvas;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** 分享通关成绩（§12.1「分享」） */
export async function shareScore(input: ScoreCardInput): Promise<void> {
  const canvas = drawScoreCard(input);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) {
    toast('成绩卡生成失败', 2200);
    return;
  }
  const file = new File([blob], `mengchong_level${input.level}.png`, { type: 'image/png' });
  const text = `我在《${TITLE}》第 ${input.level} 关拿到 ${input.score} 分！${GAME_LINK}`;

  if (canShareFiles(file)) {
    try {
      await navigator.share({ files: [file], text });
      return;
    } catch {
      // 取消分享 → 静默降级到下载
    }
  }
  triggerDownload(blob, file.name);
  toast('当前环境不支持直接分享，已改为下载成绩卡', 2600);
}
