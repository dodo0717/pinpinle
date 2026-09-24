# 萌宠拼拼乐 · 美术资源 AI 生成提示词（最终生产版）

> 用途：本文件可直接作为 AI 出图输入。产出的素材**即为可入包成品**，不需要二次重绘。
> 配套文档：《开发计划与美术资源清单.md》§0.1 / §3.2 / §3.3 / §3.4 / §5。冲突时**以本文件为准**。
>
> 交付总量：**6 件 UI 底板 + 19 枚图标 + 2 张背景 = 27 个独立文件**（另 1 枚可选）。

---

## 0. 三条铁律（违反任一条即整批返工）

### 铁律 1 · 画面内零文字
素材画面里**不许出现任何文字、字母、数字、编号、标签、Logo、水印、署名**。

- ❌ 反面案例：上一版 `UI.png` 把 `UI-BTN-PRIMARY`、`UI-FRAME-GRID` 等**名称直接压在图里** → 一个字都不能用。
- ❌ 奖牌上的 `1` / `2` / `3` / `NO.1` → 一律不烘。名次靠**金 / 银 / 铜配色**区分，数字由程序 Label 叠加。

### 铁律 2 · 一物一文件
每个素材**单独一个文件**，独立透明 PNG。

- ❌ 禁止拼版图 / contact sheet / 总览图 / 带标注的对比图（即上一版 `UI.png` 的形态）。
- ❌ 禁止"一张图里放 4 个图标"——程序无法拆分。

### 铁律 3 · 九个切片必须给边距
6 件底板全部按 **9-slice** 交付，**像素边距见 §3 表**。

- 边距**不是装饰的近似值，是硬约束**：以边距为界切开后，四角小图必须**已经包含该角全部装饰**，不允许任何装饰跨过边界。
- **中间带必须"素"到可拉伸**（规则见 §3.1），否则一拉就露馅。

---

## 1. 全局风格锚点

### 1.1 风格定位（不可偏离）

| 维度 | 规定 |
|---|---|
| 定位 | **Premium Cozy × 电影感软卡通 × 高级休闲 UI** |
| 受众 | 18–45 岁成年人；**不许低幼** |
| 主色 | 暖奶油 `#F7EFE2` |
| 辅色 | 淡蜂蜜金 `#E8C46A`、腮红粉 `#F2A9A0`、薄荷青 `#A9CFCB`、暖褐 `#A9835C` |
| 装饰母题 | 细碎白色五瓣小花 + 柔绿藤蔓叶片 + 一枚小爪印 |
| 材质 | 缎面哑光、微微内高光 + 柔和内阴影 |
| 描边 | **必须是柔和彩色描边**（金/褐）；**禁纯黑描边、禁纯白描边** |
| 光照 | 柔和漫射棚拍光、无硬阴影 |

### 1.2 通用 Style Block（每条 prompt 都拼接这段）

```
premium casual puzzle-game UI asset, cozy cinematic soft-cartoon style,
warm cream base (#F7EFE2) with honey-gold (#E8C46A), blush-pink (#F2A9A0),
mint-blue (#A9CFCB) and warm brown (#A9835C) accents,
soft thick rounded corners, gentle diffused studio lighting,
subtle top highlight and soft bottom inner shadow, matte satin finish,
delicate botanical accents: tiny white five-petal blossoms, soft sage-green vine leaves,
one small paw-print emblem, clean minimal airy elegant design,
adult-friendly premium mobile game, not childish,
single isolated object, perfectly centered, plain flat background,
high detail, crisp clean edges, product shot
```

### 1.3 通用 Negative Prompt（每条 prompt 都拼这段）

```
text, letters, numbers, digits, typography, words, label, caption, logo,
watermark, signature, number 1, number 2, number 3, "NO.1",
contact sheet, multiple objects, collage, icon set grid, mockup,
annotated UI screenshot, design spec sheet,
black outline, white outline, neon, fluorescent, glowing edges,
glassmorphism, frosted glass, translucent plastic, glossy toy sheen,
cheap 3D render, sticker style, emoji style, kawaii overload,
busy patterned center, repeating pattern, hard black shadow, harsh contrast,
pure black #000000, pure white #FFFFFF, clutter, messy,
low resolution, blurry, jpeg artifacts, cropped, cut off, off-center
```

---

## 2. 交付规格

| 项 | 规定 |
|---|---|
| 格式 | **PNG-32（带 Alpha 通道）**；背景另附同名 **JPEG q85** 交付版 |
| 尺寸 | 按 §3 / §4 表逐项给定（表中为 **@1x 设计尺寸**，交付统一 **×2 输出 @2x**） |
| 命名 | 严格用表中英文名，**含大小写**，如 `UI-BTN-PRIMARY.png` |
| 目录 | `art/ui/`（底板与图标）、`art/bg/`（背景）；表情图仍留 `art/stickers/` |
| 图标留白 | 图形占画布约 **84%**，四周留 8% 透明边，**光学大小统一**（心形与齿轮看起来一样大） |
| 背景安全区 | 上 15% / 下 8% 保持低对比、无细节（刘海与手势条遮挡区） |

---

## 3. 九宫格（9-slice）像素边距总表 ★

尺寸为 **@1x**；交付时整体 ×2，边距同比例 ×2。

| # | 资产 | @1x 尺寸 | 左 | 右 | 上 | 下 | 中间带要求 |
|---|---|---|---|---|---|---|---|
| 1 | `UI-BTN-PRIMARY` | 768 × 160 | **88** | **88** | **80** | **80** | 单一纯粉 `#F2A9A0` |
| 2 | `UI-BTN-SECONDARY` | 768 × 160 | **88** | **88** | **80** | **80** | 单一纯青 `#A9CFCB` |
| 3 | `UI-BG-CARD` | 640 × 860 | **80** | **80** | **80** | **80** | 单一纯奶油 `#F7EFE2` |
| 4 | `UI-FRAME-GRID` | 990 × 1216 | **48** | **48** | **48** | **48** | **完全透明**（格子由程序画） |
| 5 | `UI-ROW` | 880 × 120 | **64** | **64** | **40** | **40** | 单一纯奶油 `#F7EFE2` |
| 6 | `UI-CARD-COLLECTION` | 300 × 400 | **52** | **52** | **52** | **52** | 单一纯奶油 `#F7EFE2` |

### 3.1 中间带规则（决定"能不能拉伸"）

1. **单色**：必须是**一个纯色**，不是渐变、不是贴图、不是花纹。
2. **上下中段、左右中段只允许"均匀直线/均匀色带"**：禁止出现图案、小花、重复纹样、高光点、沿拉伸方向的渐变。否则横向或竖向一拉，纹样会被拉长/压扁，立刻露馅。
3. **全部装饰只准待在四角**（即边距划定的四个角区）。

> 补充：`UI-FRAME-GRID` 的中间带是**全透明**，所以程序压缩时视觉零损失 —— PNG 里大片透明压缩后体积极小（预计 < 20KB），放心交付大尺寸母版。

### 3.2 按钮为何"上/下边距 = 高度一半"

按钮是**胶囊形**，圆角半径 = 高度 160 ÷ 2 = **80**，所以上/下边距各取 80（二者之和 = 整高）。

含义：**按钮竖向不拉伸**，程序固定高度、只横向拉伸。这是胶囊按钮的标准做法，不算缺陷。

### 3.3 网格外框尺寸为何是 990 × 1216（自洽性验算）

棋盘上限：**列固定 4、行 3~5**，格间距 2~4px。

- 外框内区宽 = 990 − 48 × 2 = **894** → 格子边长 = (894 − 3×4) ÷ 4 = **220.5 ≈ 220**
- 外框内区高 = 1216 − 48 × 2 = **1120** → 5 行时格子边长 = (1120 − 4×4) ÷ 5 = **220.8 ≈ 220**

两者相等 → **格子恒为正方形** ✅。3×4 / 4×4 / 5×4 三种棋盘**共用这一张 9-slice 外框**，只改竖向拉伸长度，无需出三张图。

> ⚠️ 上一版交付了 3 张不同尺寸的网格外框（分别标 3×4 / 4×4 / 5×4）。**不必要且会造成三套边距**。本版只出 **1 张**，靠 9-slice 适配三种棋盘。

---

## 4. 逐资产提示词

> 每条 = **【本段】+ §1.2 Style Block + §1.3 Negative Prompt**。
> 出图比例若与目标尺寸不符，按 §5 流程裁切补边；**透明底一律走 §5 抠图步骤**。

### 4.1 六件 UI 底板

#### ① `UI-BTN-PRIMARY` — 主按钮（"开始游戏"）
> 生成比例 4:1｜@1x 768×160｜边距 88 / 88 / 80 / 80

```
a single empty rounded capsule button plate, blush-pink satin surface,
soft honey-gold rim, delicate tiny white blossoms and sage-green vine leaves
clustered only at the far LEFT and far RIGHT ends,
one small paw-print emblem near the left end,
the ENTIRE central area is one single flat untextured pink fill (#F2A9A0),
completely empty inside with no text and no pattern,
the top and bottom straight edges are perfectly plain and uniform
```

#### ② `UI-BTN-SECONDARY` — 次按钮（结算弹窗次级按钮）
> 生成比例 4:1｜@1x 768×160｜边距 88 / 88 / 80 / 80

```
a single empty rounded capsule button plate, mint-blue satin surface (#A9CFCB),
soft honey-gold rim, delicate tiny white blossoms and sage-green vine leaves
clustered only at the far LEFT and far RIGHT ends,
NO paw print,
the ENTIRE central area is one single flat untextured mint-blue fill,
completely empty inside with no text and no pattern,
the top and bottom straight edges are perfectly plain and uniform
```

> ①② 必须**几何完全一致**（同圆角、同边距、同装饰位置），**只换配色** —— 程序只配一套边距。

#### ③ `UI-BG-CARD` — 弹窗底板 Soft Card
> 生成比例 3:4｜@1x 640×860｜边距 80 / 80 / 80 / 80

```
a single large empty rounded-rectangle dialog card plate,
warm cream satin surface (#F7EFE2), soft honey-gold rim, slight inner paper depth,
tiny white blossoms and a thin sage-green vine placed ONLY at the four corners,
the ENTIRE central area is one single flat untextured cream fill,
completely empty inside with no text, no pattern, no ornament,
all four straight edges are perfectly plain and uniform
```

#### ④ `UI-FRAME-GRID` — 网格外框（3×4 / 4×4 / 5×4 通用）
> 生成比例 4:5｜@1x 990×1216｜边距 48 / 48 / 48 / 48

```
a single empty rounded-rectangle decorative FRAME, border only,
warm cream border with a soft honey-gold rim,
tiny white blossoms and small sage-green leaves clustered ONLY at the four corners,
all four straight border segments are perfectly uniform and completely plain,
the ENTIRE interior of the frame is fully EMPTY and TRANSPARENT,
absolutely nothing inside the frame — no grid lines, no cells, no pattern, no fill,
no text
```

> 🔴 **本项最关键**：中间必须是**全透明**。格子与格线由程序绘制（§3.2 要求"中间留空由程序填充"）。
> 若把格子线烘进图，9-slice 一拉伸格间距就会失真，整条规范作废。

#### ⑤ `UI-ROW` — 排行榜列表行
> 生成比例 8:1 附近｜@1x 880×120｜边距 64 / 64 / 40 / 40

```
a single empty horizontal rounded-rectangle list row plate,
warm cream surface (#F7EFE2) with a very slim honey-gold rim,
one tiny white blossom at the far LEFT end,
one small paw-print emblem at the far RIGHT end,
the ENTIRE central area is one single flat untextured cream fill,
completely empty inside with no text and no pattern,
the top and bottom straight edges are perfectly plain and uniform
```

#### ⑥ `UI-CARD-COLLECTION` — 图鉴卡（3 列）
> 生成比例 3:4｜@1x 300×400｜边距 52 / 52 / 52 / 52

```
a single empty vertical rounded-rectangle collection card plate,
warm cream surface with a soft warm-brown paper rim,
a thin sage-green vine with tiny white blossoms along the TOP edge only,
a small metal clip / tab shape at the top-left corner,
one small paw-print emblem at the bottom-RIGHT corner,
the ENTIRE central area is one single flat untextured cream fill
with a faint blank square placeholder outline (empty, no image, no text),
all straight edges otherwise perfectly plain and uniform
```

> 图鉴卡中央的"空图位"若不便留白，**改为纯素奶油即可**，图位由程序画。

---

### 4.2 十九枚图标

统一要求（每条都适用）：
- **512 × 512 透明 PNG**（@1x 256×256 的 ×2），**单个居中物体**，占画布约 **84%**；
- **无任何文字/数字**；三枚奖牌**不带名次数字**；
- 光学大小统一：所有图标放在一起看"分量"应一致；
- 描边柔和彩色，禁黑描边、白描边。

| # | 文件名 | 用途 | 提示词主体（接 Style + Negative） |
|---|---|---|---|
| 1 | `ICON-HEART-FULL.png` | 体力已拥有 | `a single plump glossy coral-pink heart with a soft honey-gold rim and a subtle top highlight` |
| 2 | `ICON-HEART-EMPTY.png` | 体力空位 | `a single hollow OUTLINE-ONLY heart, thick soft cream-white stroke with a honey-gold rim, completely empty inside with no fill` |
| 3 | `ICON-PLUS.png` | 加体力 | `a single thick rounded plus / cross symbol, sage-green with a soft honey-gold rim` |
| 4 | `ICON-SETTINGS.png` | 设置 | `a single rounded gear cogwheel, warm cream-grey with a honey-gold rim` |
| 5 | `ICON-PLAY-START.png` | 开始游戏 | `a single large rounded play triangle, honey-gold with a soft rim and gentle highlight` |
| 6 | `ICON-BOOK.png` | 图鉴 | `a single open book, cream pages with a mint-blue cover, a small blossom on the corner` |
| 7 | `ICON-RANKING.png` | 排行榜 | `a single bar-chart icon of three ascending rounded bars, sage-green with a soft rim` |
| 8 | `ICON-TIMER.png` | 倒计时（<60s 变色用程序调色） | `a single round pocket stopwatch, cream face with a honey-gold rim and a small green crown button on top, the dial is COMPLETELY BLANK with no numbers, no ticks, no text` |
| 9 | `ICON-SCORE.png` | 计分 | `a single rounded jigsaw puzzle piece, blush-pink with a soft rim` |
| 10 | `ICON-BACK.png` | 返回 | `a single thick rounded U-turn return arrow pointing LEFT, warm brown with a soft rim` |
| 11 | `ICON-AD.png` | 看广告（激励视频） | `a single circular button with a rounded play triangle inside, sage-green with a honey-gold rim` |
| 12 | `ICON-SHARE.png` | 分享 | `a single share icon of three rounded nodes connected by two short lines, soft blue with a soft rim` |
| 13 | `ICON-DOWNLOAD.png` | 下载 | `a single download icon: a thick rounded downward arrow above a short rounded horizontal base line, warm brown` |
| 14 | `ICON-LOCK.png` | 未解锁 | `a single closed padlock, soft blue body with a honey-gold rim and shackle` |
| 15 | `ICON-STAR-FULL.png` | 星级·亮 | `a single plump five-point star, honey-gold with a soft rim and a top highlight` |
| 16 | `ICON-STAR-EMPTY.png` | 星级·暗 | `a single hollow OUTLINE-ONLY five-point star, thick cream-white stroke with a honey-gold rim, completely empty inside with no fill` |
| 17 | `MEDAL-GOLD.png` | 排行榜第 1 | `a single round GOLD medal hanging on a short two-tone ribbon, glossy honey-gold face, the face is COMPLETELY BLANK with no number, no text, no engraving` |
| 18 | `MEDAL-SILVER.png` | 排行榜第 2 | `a single round SILVER medal hanging on a short two-tone ribbon, soft matte silver face, the face is COMPLETELY BLANK with no number, no text` |
| 19 | `MEDAL-BRONZE.png` | 排行榜第 3 | `a single round BRONZE medal hanging on a short two-tone ribbon, soft bronze face, the face is COMPLETELY BLANK with no number, no text` |

| # | 文件名 | 用途 | 提示词主体（**可选**，二期） |
|---|---|---|---|
| 20 | `ICON-AVATAR-FRAME.png` | 头像框 | `a single circular avatar frame ring, cream with a honey-gold rim and one tiny blossom at the bottom, empty transparent center` |

> **奖牌去数字的替代方案**：名次由程序 Label 叠加。若美术坚持要"金+数字"的观感，数字也**必须在游戏里用 Label 画**，不能烘图 —— 因为烘图的数字无法换字体、无法多语言、放大就糊。

---

### 4.3 两张背景

统一要求：
- **1080 × 1920 竖版**（9:16）；上 15% / 下 8% 保持**低对比、无细节**（刘海与手势条安全区）；
- 画面内**零文字、零 Logo、零水印**；
- 交付 PNG 母版 + 同名 JPEG q85（背景不需要 Alpha，走 §2 双格式惯例）；
- **不打进主包**，走远程加载（§M1 第 7 条）。

#### `BG-HOME` — 首页背景（G01）
> 1080 × 1920

```
vertical 9:16 mobile game home-screen background,
cozy sunlit living room: a big soft cream sofa, a round fluffy rug,
potted plants, a wooden bookshelf, a floor lamp, framed pictures,
warm morning light streaming through a large window,
a cute fluffy white bunny resting on the rug, placed in the LEFT third of the frame,
the RIGHT-CENTER area kept calm, low-detail and low-contrast,
gentle honey-gold and blush-pink palette, cinematic soft-cartoon illustration,
the top 15% and bottom 8% are simple low-contrast gradients with no detail,
no text, no logo, no watermark
```

#### `BG-PUZZLE` — 游戏页背景（G02）
> 1080 × 1920

```
vertical 9:16 mobile game gameplay background,
dreamy seaside hill town: white houses, a distant lighthouse,
calm turquoise sea, blue sky with soft clouds and a few flying gulls,
a wooden fence and wildflowers in the foreground,
soft pastel honey-gold and mint palette, cinematic soft-cartoon illustration,
the CENTER of the frame must be LOW-CONTRAST, LOW-SATURATION and
free of fine detail so an overlaid puzzle board stays readable,
the top 15% and bottom 8% are simple low-contrast gradients with no detail,
no text, no logo, no watermark
```

> 🔴 游戏页背景的中央"让位给棋盘"是硬要求：碎片是满幅彩色插画，底图若同样花哨，玩家看不清棋子。

---

## 5. 出图 → 成品 的落地流程

AI 直出**不会**给你精确像素和真透明底，所以固化成 5 步：

| 步 | 动作 | 关键点 |
|---|---|---|
| 1 | **出图** | 用 §4 提示词 + Style + Negative。形状主体尽量**占满画布、居中**，方便后处理 |
| 2 | **抠底** | 去背景得真 Alpha。**不要**让 AI 画"假透明"（灰白格子底），要真抠 |
| 3 | **裁切** | 裁到物体外接框（保留 1~2px 透明余量） |
| 4 | **补边到目标尺寸** | 用**透明边**把画布补到 §3 / §4 表内尺寸。**补出来的透明边 = 9-slice 的边距来源** |
| 5 | **校验边距** | 按 §3 表以边距为界切四角，确认**装饰全部落在角区内**、**中间带为纯色/纯透明**；不合格回第 1 步重出 |

> 若形状本身宽高比与目标尺寸差太多（例如要 8:1 的列表行，AI 只会给 4:1），
> **不要硬拉**：改为横向延长出图（提示词加 `extremely wide horizontal plate, very long flat middle section`），或出 4:1 后**只在中间带纵向做无缝延伸**（因中间带是单色，可无限平铺）。

---

## 6. 验收自检清单

交付前逐条打勾，**任一条不过即返工**：

**格式**
- [ ] 27 个文件独立存在，**没有一张拼版图**
- [ ] 全部 PNG 带 Alpha；背景另有 JPEG q85
- [ ] 文件名与表内英文名**逐字符一致**

**内容**
- [ ] 画面内**零文字、零数字、零 Logo、零水印**（含奖牌不带 `1/2/3`）
- [ ] 图标图形占画布约 84%、居中、彼此**光学大小一致**
- [ ] 没有纯黑描边 / 纯白描边 / 荧光色 / 玻璃拟态 / 廉价 3D 塑料感

**九宫格**
- [ ] 6 件底板边距与 §3 表**完全一致**
- [ ] 以边距切四角，**装饰无一处跨过边界**
- [ ] 中间带为**单一纯色**（外框为**全透明**），无花纹、无沿拉伸方向的渐变
- [ ] 网格外框**只出 1 张**，中间无格子线

**尺寸与安全区**
- [ ] 背景 1080×1920，上 15% / 下 8% 无细节
- [ ] 游戏页背景**中央低对比、低饱和、无细碎花纹**

**观感（文档三 §6 / 文档二 §11）**
- [ ] 18–45 岁成年人不会觉得低幼
- [ ] 截图一眼能认出是"萌宠拼图游戏"
