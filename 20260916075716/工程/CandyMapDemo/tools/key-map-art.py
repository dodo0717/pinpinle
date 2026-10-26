"""
首页关卡节点 / 关卡连线切图（2026-10-25）：把美术给的「深灰底」图抠成透明 PNG。

    python tools/key-map-art.py

输入（美术原图，底色为纯色 #2C2C2C）：
  UI及角色/首页/关卡节点/_20261023201337_412_1340.png  → 关卡节点（粉色糖果珠）
  UI及角色/首页/关卡节点/_20261023201337_413_1340.png  → 关卡之间的糖果条连线
输出：
  assets/resources/map/node/node-candy.png
  assets/resources/map/node/link-candy.png

抠图方法：按「与底色的最大通道差」算 alpha，再把边缘像素从底色里反混合出来
（c = (p - bg·(1-a)) / a），抗锯齿边缘不会留一圈灰边。最后按非透明像素包围盒裁切。
需要：pip install pillow
"""

import pathlib

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
ART = ROOT.parent.parent / "UI及角色" / "首页" / "关卡节点"
OUT = ROOT / "assets" / "resources" / "map" / "node"
BG = (44, 44, 44)
# 差值 ≤ LO 视为纯底色（全透明），≥ HI 视为不透明；中间按比例做半透明边缘
LO, HI = 6, 60


def key(src: pathlib.Path, dst: pathlib.Path, pad: int) -> None:
    im = Image.open(src).convert("RGB")
    w, h = im.size
    out = Image.new("RGBA", (w, h))
    px = im.load()
    po = out.load()
    for y in range(h):
        for x in range(w):
            p = px[x, y]
            d = max(abs(p[i] - BG[i]) for i in range(3))
            if d <= LO:
                po[x, y] = (0, 0, 0, 0)
                continue
            a = min(1.0, (d - LO) / (HI - LO))
            if a >= 1.0:
                po[x, y] = (p[0], p[1], p[2], 255)
                continue
            c = tuple(max(0, min(255, round((p[i] - BG[i] * (1 - a)) / a))) for i in range(3))
            po[x, y] = (c[0], c[1], c[2], round(a * 255))
    box = out.getbbox()
    if box:
        l, t, r, b = box
        out = out.crop((max(0, l - pad), max(0, t - pad), min(w, r + pad), min(h, b + pad)))
    dst.parent.mkdir(parents=True, exist_ok=True)
    out.save(dst)
    print(f"{dst.relative_to(ROOT)}: {out.size[0]}x{out.size[1]}")


if __name__ == "__main__":
    key(ART / "_20261023201337_412_1340.png", OUT / "node-candy.png", pad=4)
    # 连线左右两端本来就是直切口（横向平铺用），只上下留白
    key(ART / "_20261023201337_413_1340.png", OUT / "link-candy.png", pad=0)
