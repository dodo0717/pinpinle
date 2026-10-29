"""
首页底图「动物动起来」：从即梦生成的循环视频里抠出会动的小块，烘焙成序列帧图集。

用法（在 CandyMapDemo 目录下）：
    python tools/make-map-anim.py <art> <原图.jpg> <上半屏.mp4> <下半屏.mp4> [--box 屏:x0,y0,x1,y1 ...]
    例：python tools/make-map-anim.py xiaozhen "../../UI及角色/首页/xxx.jpg" "../../UI及角色/首页/视频+1.mp4" "../../UI及角色/首页/视频+2.mp4" --box 1:210,1090,350,1310

    --box：自动检测漏掉的小动区（动得轻、面积小，比如钓鱼的鱼漂），手动补上。
           屏 = 0 上半屏 / 1 下半屏；坐标是该段视频里的像素（1080×1920，左上右下）。

依赖：Pillow、numpy、imageio-ffmpeg（自带 ffmpeg，可执行文件路径由它给出）。

思路（2026-10-29）：
  - 视频是把原图上下两半（各 1080×1920）分别喂给即梦生成的，AI 会把画面重画一遍：
    整体放大约 1.5~2%、平移十几像素、颜色略暗。直接拿视频当底图，两段在 y=1920 接不上。
  - 所以底图仍用**原图**；先拟合「视频帧 → 原图」的缩放 + 平移（灰度相关系数最大），
    再只取「真的在动」的区域（逐像素时间标准差），反向变换回原图坐标、按块拟合颜色，
    边缘羽化后**烘焙进原图**——每帧是一张不透明 jpg，接缝处和原图逐像素一致。
  - 来回播放（正放再倒放）解决首尾跳帧，运行时处理，图集里只存正放的帧。
产物：
  assets/resources/map-v2/<art>.jpg            底图（= 原图）
  assets/resources/map-anim/<art>-<i>.jpg       每块一张图集（网格排列，≤2040 边长）
  assets/scripts/场景/mapAnim.ts                坐标表（轨道坐标），MapBootstrap 读取
"""
import glob
import math
import os
import shutil
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
RES = os.path.join(ROOT, 'assets', 'resources')
TABLE = os.path.join(ROOT, 'assets', 'scripts', '场景', 'mapAnim.ts')

HALF_H = 1920
TRACK_W, TRACK_H = 1536, 5462          # 与 MapBootstrap 一致
ATLAS_MAX = 2040                        # 图集边长上限（低端机纹理 2048）
MOTION_SD = 5.0                         # 时间标准差阈值（灰度，半分辨率 + 轻模糊后）
MIN_CELLS = 20                          # 动区连通块至少多少个 30px 格子才算一只动物
PAD = 24                                # 动区外扩（视频坐标 px）
FEATHER = 14                            # 块边缘羽化宽度（px）
JPG_Q = 74


def ffmpeg_exe():
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


def extract(video, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    subprocess.run([ffmpeg_exe(), '-hide_banner', '-loglevel', 'error', '-i', video, '-an',
                    '-fps_mode', 'passthrough', os.path.join(out_dir, '%03d.png')], check=True)
    fs = sorted(glob.glob(os.path.join(out_dir, '*.png')))
    probe = subprocess.run([ffmpeg_exe(), '-hide_banner', '-i', video], capture_output=True, text=True,
                           encoding='utf-8', errors='replace').stderr or ''
    fps = 24.0
    for tok in probe.split(','):
        tok = tok.strip()
        if tok.endswith(' fps'):
            fps = float(tok[:-4])
    return fs, fps


def fit_affine(orig_l, frame_l, oy):
    """视频帧像素 (u,v) → 原图 (a·u+bx, a·v+by+oy)；返回 (a, bx, by, corr)"""
    def score(a, bx, by, s):
        w, h = 1080 // s, HALF_H // s
        im = orig_l.transform((w, h), Image.AFFINE, (a * s, 0, bx, 0, a * s, by + oy), resample=Image.BILINEAR)
        A = np.asarray(im, np.float32)[6:-6, 6:-6]
        B = np.asarray(frame_l.resize((w, h), Image.BILINEAR), np.float32)[6:-6, 6:-6]
        A = A - A.mean(); B = B - B.mean()
        return float((A * B).sum() / math.sqrt((A * A).sum() * (B * B).sum()))
    best = (-1.0, 1.0, 0.0, 0.0)
    for a in np.arange(0.980, 1.0601, 0.005):
        for bx in range(-20, 41, 4):
            for by in range(-20, 61, 4):
                c = score(a, bx, by, 6)
                if c > best[0]:
                    best = (c, a, bx, by)
    _, a0, bx0, by0 = best
    for a in np.arange(a0 - 0.004, a0 + 0.0041, 0.001):
        for bx in np.arange(bx0 - 4, bx0 + 4.1, 1):
            for by in np.arange(by0 - 4, by0 + 4.1, 1):
                c = score(a, bx, by, 3)
                if c > best[0]:
                    best = (c, a, bx, by)
    c, a, bx, by = best
    return float(a), float(bx), float(by), c


def motion_boxes(frames):
    """返回会动的区域（视频坐标，左上右下）"""
    st = np.stack([np.asarray(Image.open(p).convert('L').resize((540, 960)).filter(ImageFilter.GaussianBlur(1.5)),
                              np.float32) for p in frames[::2]])
    sd = st.std(0)
    c = 15
    g = (sd > MOTION_SD).reshape(960 // c, c, 540 // c, c).mean((1, 3)) > 0.04
    H, W = g.shape
    lab = np.zeros((H, W), int)
    boxes = []
    n = 0
    for y in range(H):
        for x in range(W):
            if g[y, x] and not lab[y, x]:
                n += 1
                stack = [(y, x)]
                lab[y, x] = n
                cells = []
                while stack:
                    cy, cx = stack.pop()
                    cells.append((cy, cx))
                    for dy in (-1, 0, 1):
                        for dx in (-1, 0, 1):
                            yy, xx = cy + dy, cx + dx
                            if 0 <= yy < H and 0 <= xx < W and g[yy, xx] and not lab[yy, xx]:
                                lab[yy, xx] = n
                                stack.append((yy, xx))
                if len(cells) >= MIN_CELLS:
                    ys = [q[0] for q in cells]; xs = [q[1] for q in cells]
                    boxes.append((min(xs) * 30, min(ys) * 30, (max(xs) + 1) * 30, (max(ys) + 1) * 30))
    return boxes


def bake_patch(orig_rgb, frames, step, a, bx, by, oy, box):
    u0, v0, u1, v1 = box
    u0, v0 = max(0, u0 - PAD), max(0, v0 - PAD)
    u1, v1 = min(1080, u1 + PAD), min(HALF_H, v1 + PAD)
    X0 = max(0, int(math.floor(a * u0 + bx)))
    Y0 = max(oy, int(math.floor(a * v0 + by)) + oy)
    X1 = min(1080, int(math.ceil(a * u1 + bx)))
    Y1 = min(oy + HALF_H, int(math.ceil(a * v1 + by)) + oy)
    W, H = X1 - X0, Y1 - Y0
    coeff = (1 / a, 0, (X0 - bx) / a, 0, 1 / a, (Y0 - oy - by) / a)
    base = np.asarray(orig_rgb.crop((X0, Y0, X1, Y1)), np.float32)

    picked = frames[::step]
    warped = [np.asarray(Image.open(p).convert('RGB').transform((W, H), Image.AFFINE, coeff, resample=Image.BILINEAR),
                         np.float32) for p in picked]
    stack = np.stack(warped)

    # 动区蒙版：时间标准差 → 外扩 → 模糊；再乘一圈边缘羽化，保证块边缘 100% 是原图
    sd = stack.mean(-1).std(0)
    m = Image.fromarray(((sd > MOTION_SD) * 255).astype(np.uint8))
    m = m.filter(ImageFilter.MaxFilter(25)).filter(ImageFilter.GaussianBlur(8))
    alpha = np.asarray(m, np.float32) / 255.0
    yy, xx = np.mgrid[0:H, 0:W]
    edge = np.minimum.reduce([xx, yy, W - 1 - xx, H - 1 - yy]).astype(np.float32)
    alpha *= np.clip(edge / FEATHER, 0, 1)
    alpha = alpha[..., None]

    # 颜色：在静止像素上逐通道线性拟合「视频 → 原图」
    still = (sd < 2.0).ravel()
    f0 = stack[0].reshape(-1, 3)
    b0 = base.reshape(-1, 3)
    gain, off = np.ones(3), np.zeros(3)
    if still.sum() > 200:
        for ch in range(3):
            x = f0[still, ch]; y = b0[still, ch]
            A = np.vstack([x, np.ones_like(x)]).T
            gain[ch], off[ch] = np.linalg.lstsq(A, y, rcond=None)[0]
    out = [np.clip(base * (1 - alpha) + np.clip(f * gain + off, 0, 255) * alpha, 0, 255).astype(np.uint8) for f in stack]
    return (X0, Y0, W, H), out, float(alpha.max())


def main():
    args = sys.argv[1:]
    extra = {0: [], 1: []}
    while '--box' in args:
        i = args.index('--box')
        half, coords = args[i + 1].split(':')
        extra[int(half)].append(tuple(int(v) for v in coords.split(',')))
        del args[i:i + 2]
    if len(args) != 4:
        print(__doc__)
        sys.exit(1)
    art, orig_path, top_mp4, bottom_mp4 = args
    orig = Image.open(orig_path).convert('RGB')
    assert orig.size == (1080, 3840), '原图应为 1080×3840，实际 %s' % (orig.size,)
    orig_l = orig.convert('L')

    out_dir = os.path.join(RES, 'map-anim')
    os.makedirs(out_dir, exist_ok=True)
    for old in glob.glob(os.path.join(out_dir, art + '-*.jpg')):
        os.remove(old)
    shutil.copyfile(orig_path, os.path.join(RES, 'map-v2', art + '.jpg'))

    entries = []
    total = 0
    tmp = tempfile.mkdtemp(prefix='pp_mapanim_')
    try:
        for half, mp4 in ((0, top_mp4), (1, bottom_mp4)):
            frames, fps = extract(mp4, os.path.join(tmp, str(half)))
            oy = half * HALF_H
            a, bx, by, corr = fit_affine(orig_l, Image.open(frames[0]).convert('L'), oy)
            boxes = motion_boxes(frames) + extra[half]
            print('[%s] %d 帧 %.2ffps  对齐 a=%.3f bx=%.0f by=%.0f 相关=%.3f  动区 %d 块（含手动 %d）'
                  % (os.path.basename(mp4), len(frames), fps, a, bx, by, corr, len(boxes), len(extra[half])))
            for box in boxes:
                # 帧步长：先试每 2 帧取 1，图集放不下再加大
                for step in (3, 4):
                    n = len(frames[::step])
                    w_est = box[2] - box[0] + 2 * PAD + 20
                    h_est = box[3] - box[1] + 2 * PAD + 20
                    cols = max(1, ATLAS_MAX // w_est)
                    if math.ceil(n / cols) * h_est <= ATLAS_MAX:
                        break
                (X0, Y0, W, H), out, amax = bake_patch(orig, frames, step, a, bx, by, oy, box)
                n = len(out)
                cols = max(1, ATLAS_MAX // W)
                rows = math.ceil(n / cols)
                sheet = Image.new('RGB', (cols * W, rows * H))
                for i, fr in enumerate(out):
                    sheet.paste(Image.fromarray(fr), ((i % cols) * W, (i // cols) * H))
                idx = len(entries)
                name = '%s-%d' % (art, idx)
                p = os.path.join(out_dir, name + '.jpg')
                sheet.save(p, quality=JPG_Q, optimize=True)
                size = os.path.getsize(p)
                total += size
                kx, ky = TRACK_W / 1080, TRACK_H / 3840
                entries.append(dict(path='map-anim/' + name, fps=round(fps / step, 2), frames=n, cols=cols,
                                    fw=W, fh=H, x=round((X0 + W / 2) * kx), y=round((Y0 + H / 2) * ky),
                                    w=round(W * kx), h=round(H * ky)))
                print('  %s  原图区域 (%d,%d) %d×%d  %d 帧 @%.1ffps  图集 %d×%d  %d KB'
                      % (name, X0, Y0, W, H, n, fps / step, sheet.width, sheet.height, size // 1024))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    rows = '\n'.join(
        "    {{ path: '{path}', fps: {fps}, frames: {frames}, cols: {cols}, fw: {fw}, fh: {fh}, "
        "x: {x}, y: {y}, w: {w}, h: {h} }},".format(**e) for e in entries)
    with open(TABLE, 'w', encoding='utf-8', newline='\r\n') as f:
        f.write("""/** 首页底图动画块 —— 由 tools/make-map-anim.py 生成，请勿手改。
 *
 * 每块 = 一张网格图集（从左到右、从上到下排帧），运行时来回播放（正放再倒放）。
 * x / y = 块中心、w / h = 显示尺寸，都是轨道坐标（1536 × 5462，y 从上往下），与 levelTable 同口径。
 * 图集已把动区边缘羽化烘焙进底图，所以是不透明 jpg，叠在底图上看不出接缝。
 */
export interface MapAnimDef {
    path: string; fps: number; frames: number; cols: number; fw: number; fh: number;
    x: number; y: number; w: number; h: number;
}

/** key = WORLDS[].art */
export const MAP_ANIM: Record<string, MapAnimDef[]> = {
  '%s': [
%s
  ],
};
""" % (art, rows))
    print('完成：%d 块，图集合计 %d KB → %s' % (len(entries), total // 1024, TABLE))


if __name__ == '__main__':
    main()
