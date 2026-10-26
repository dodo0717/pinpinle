"""
对局界面自带字体的子集化（2026-10-25）。

    python tools/subset-fonts.py <ZCOOLKuaiLe-Regular.ttf> <LXGWWenKai-Regular.ttf>

两款字体都是 SIL OFL 1.1（可商用、可随包分发、子集化后不得用原名再分发——这里改名 pp-*.ttf）：
  - 站酷快乐体 ZCOOL KuaiLe  → minigame/fonts/pp-candy.ttf （糖果嘉年华 主字体）
  - 霞鹜文楷 LXGW WenKai      → minigame/fonts/pp-hand.ttf  （贴纸手账 手写字体）

字符表 = assets/scripts/玩法/ 与 界面/ 下所有 .ts 的**字符串字面量**里出现过的字 + 可打印 ASCII + 常用标点。
注释里的字不收（否则子集会大好几倍）。改了界面文案要重跑一次，否则新字会落到系统字体。
需要：pip install fonttools
"""

import pathlib
import re
import sys

from fontTools import subset

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRCS = [ROOT / "assets" / "scripts" / d for d in ("玩法", "界面")]
OUT = ROOT / "minigame" / "fonts"

STR_RE = re.compile(r"'(?:[^'\\\n]|\\.)*'|\"(?:[^\"\\\n]|\\.)*\"|`(?:[^`\\]|\\.)*`")


def strip_comments(code: str) -> str:
    code = re.sub(r"/\*[\s\S]*?\*/", "", code)
    return re.sub(r"(^|[^:'\"`])//[^\n]*", r"\1", code)


def collect() -> str:
    chars = set(chr(c) for c in range(0x20, 0x7F))
    chars.update("，。！？、：；（）《》「」…—·★☆▶✓×÷％～　")
    for p in (f for d in SRCS for f in d.glob("*.ts")):
        for m in STR_RE.finditer(strip_comments(p.read_text(encoding="utf-8"))):
            chars.update(m.group(0))
    # 关卡号 / 分数会动态拼出来，数字已在 ASCII 里
    return "".join(sorted(ch for ch in chars if ch.isprintable()))


def run(src: str, dst: pathlib.Path, text: str) -> None:
    opts = subset.Options()
    opts.layout_features = ["*"]
    opts.name_IDs = ["*"]
    opts.notdef_outline = True
    opts.hinting = False
    font = subset.load_font(src, opts)
    sub = subset.Subsetter(opts)
    sub.populate(text=text)
    sub.subset(font)
    dst.parent.mkdir(parents=True, exist_ok=True)
    subset.save_font(font, str(dst), opts)
    print(f"{dst.relative_to(ROOT)}: {dst.stat().st_size // 1024} KB")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(1)
    text = collect()
    print(f"字符表 {len(text)} 字")
    run(sys.argv[1], OUT / "pp-candy.ttf", text)
    run(sys.argv[2], OUT / "pp-hand.ttf", text)
