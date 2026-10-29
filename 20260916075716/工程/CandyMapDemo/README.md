# CandyMapDemo — 糖果传奇风格选关地图

Cocos Creator 3.8.8 竖版选关地图 Demo，对标 Candy Crush 关卡地图。

## 功能

- 竖版 1080×1920，地图高度 3 屏（5760px），上下滑动
- 渐变背景（深紫→暖橙）+ 柔光斑点
- 蜿蜒糖果路径（外发光+主线+内亮线），路径上点缀彩色糖豆
- 20 个圆形糖果关卡节点，当前关卡（第 6 关）呼吸发光
- 装饰：星星、漂浮圆糖
- 启动自动滚动到当前关卡附近

## 打开方式

1. 用 Cocos Creator 3.8.8 打开本项目文件夹
2. 等待资源编译完成
3. 打开 `assets/scenes/Map.scene`
4. 点击预览运行

## 项目结构

```
CandyMapDemo/
├── assets/
│   ├── scenes/
│   │   └── Map.scene          # 地图场景（Canvas + Bootstrap）
│   └── scripts/
│       ├── MapBootstrap.ts    # 启动器：动态生成背景/路径/节点/滚动
│       └── LevelNode.ts       # 关卡节点：糖果绘制 + 呼吸发光动画
├── settings/v2/packages/project.json  # 设计分辨率 1080×1920
├── project.json
└── tsconfig.json
```

## 可调参数

在 `MapBootstrap.ts` 顶部：

| 参数              | 值    | 说明         |
| --------------- | ---- | ---------- |
| `DESIGN_W`      | 1080 | 设计宽度       |
| `MAP_H`         | 5760 | 地图总高度（3 屏） |
| `CURRENT_LEVEL` | 6    | 当前高亮关卡     |

节点坐标由 `generateLevelPositions()` 生成，正弦摆动，可替换为外部坐标表。

## 近期更新（2026-10-21 ~ 29）

- **2026-10-29（首页动物动起来 · 样例，仅本地）**：小镇底图换成 `UI及角色/首页/微信图片_20261029204357_54_1341.jpg`，并用即梦生成的两段视频（`视频+1.mp4` 上半屏、`视频+2.mp4` 下半屏，各 1080×1920 / 4 秒）让动物动起来。新增 `tools/make-map-anim.py`：拟合「视频帧 → 原图」的缩放平移（两段分别放大 2.0% / 1.5%，相关系数 0.90 / 0.92），按时间标准差找出会动的区域（共 7 块），反向变换回原图坐标、在静止像素上拟合颜色、边缘羽化后烘焙进原图，每块输出一张不透明 jpg 网格图集（33 帧 @8fps，合计约 2.7MB）到 `assets/resources/map-anim/`，并生成坐标表 `assets/scripts/场景/mapAnim.ts`。底图仍是原图，所以上下两屏接缝和原图一致；块边缘与底图差异约 4~5（jpg 噪声级）。`MapBootstrap` 新增 `Anims` 层（底图之上、珠子之下），`update` 里来回播放（正放再倒放，首尾不跳），图集没加载到时就是静态底图。关卡节点按新图石板路重新摆（相邻间距约 300 原图 px，第 5→6 关因路形稍长），写回 `C:\idea-xiao\tupian2\xiaozhen.map.json`（含新底图，旧版备份为 `xiaozhen.map.旧底图备份-20261029.json`）并重新生成 `levelTable.ts`。无头 Chrome 验证：7 块全部加载，手动推进 update 帧号 1→31 后回到 23（来回播放正确），无报错。**未上传服务器、未提交**；web 版仍是旧底图 + `ROAD_X`。
  - 同日修：左右两边动物被裁掉一截。原缩放 `k = 可视高 / 2731` 让一页铺满一屏，长屏（可视高 > 1920，如 19.5:9）上轨道被放宽到超过屏宽、左右各裁掉一段。改为 `k = min(可视高 / 2731, 1080 / 1536)`：长屏按宽铺满不裁，两页上下重叠，翻页改为第 0 页顶对齐、最后一页底对齐（`minOffset / maxOffset / pageOffset / nearestPage` 按轨道实际高度算）。无头 Chrome 实测：1080×1920 屏 k、翻页位置与改前完全一致（±960）；1080×2340 长屏轨道宽 1080（改前约 1316，两边各裁 118），翻页 ±750，最近页判定正确。
  - 同日补：下半屏左下角钓鱼的鱼漂。它动得轻、面积小，自动检测漏掉了；`make-map-anim.py` 新增 `--box 屏:x0,y0,x1,y1` 手动补动区，本次用 `--box 1:210,1090,350,1310` 生成第 8 块 `xiaozhen-7`（原图区域 (196,3001) 192×274，197KB，边缘差 4.3）。8 块图集合计约 2.9MB。

- **2026-10-28（首页底图）**：第一个世界「小镇」底图换成新美术 `UI及角色/首页/20261028173211_482_1340.jpg`（同为 1080×3840）：替换 `assets/resources/map-v2/xiaozhen.jpg`（小游戏，远程素材需重新上传）与 `web/art/map-v2/xiaozhen.png`（web）。节点按新图石板路重新对齐：`ROAD_X.xiaozhen` 改为 `[0.43, 0.54, 0.43, 0.39, 0.4, 0.51, 0.56, 0.47, 0.47, 0.5, 0.46, 0.44]`（自上而下 = 第 12→1 关；按路面颜色逐行追踪路中线得出），`assets/scripts/场景/MapBootstrap.ts` 与 `web/ui/map.ts` 同步改，minigame 重建。随后改由**地图编辑器**摆点：用户导出 `C:\idea-xiao\tupian2\xiaozhen.map.json`，原间距 60~84 不均，按用户摆的路线做样条、沿弧长等距重排（相邻间距统一约 72 编辑器 px，第 1、12 关不动，最大位移 25px，重排后点位仍落在路面色上；原文件备份为 `xiaozhen.map.原始备份.json`），`convert-map-json.ts` 生成 `levelTable.ts`——小镇从此读坐标表（横纵都由编辑器决定），不再用 `ROAD_X`；web 版仍用 `ROAD_X`。`test/maptable.test.ts` 的「默认空表」断言改为校验已导出世界的关号连续与坐标范围。关卡之间的糖果连线由游戏按坐标自动画（`link-candy`），编辑器里不用摆。远程素材已更新：新图传到 `/home/game/mini-assets/pp/map-v2/xiaozhen.jpg`（旧图备份为同目录 `xiaozhen.jpg.bak-20261028`），公网地址返回 200、md5 与本地一致（`9ca18fb2…`），响应头 `cache-control: no-cache`；只动了这一个文件，未碰 nginx / 容器。坐标表是代码，真机需在微信开发者工具里重新导入 `minigame/` 预览 / 上传才生效。

- **2026-10-26（排行榜）**：领奖台三个奖杯里的人脸换成当前前 3 名的头像（服务端 `avatar` 预设序号；示例对手按名字稳定取；「我」跟随本机资料含微信头像；脸的位置按切图像素测出，见 `MapPanels.ts` `CUP_FACE`）；银 / 铜底座补上「2」「3」；打开排行榜、换 Tab、换关卡、实时数据到达时自动翻到「我」所在那一页（手动翻页后不再拉回）。

- **2026-10-26（修三）**：真机只显示第 1、2 关可玩：手机上是改出厂解锁数之前建的老存档（unlocked=2），读档只按「最高通关 + 1」修正，不按出厂值兜底。客户端新增 `INITIAL_UNLOCKED = 4`（`核心/progress.ts`），读档时作为下限；服务端上报守卫按 `max(云档 unlocked, game.level.initialUnlocked)` 判（`V7__initial_unlocked.sql`，已部署测试服），否则第 3、4 关成绩会被当跳关拒收。正式上线前两边一起改回 1。

- **2026-10-26（修二）**：真机上音效全部「图片加载失败 audio/xxx.webp」：上传时代码被压缩，`resources.load` 靠 `type.name` 判断资源类型，类名被改掉后音频被当图片加载、`Texture2D` 也拿成了 SpriteFrame（贴纸 / 糖果连线受影响）。改为每个资源类手工挂 `__ccKind` 字符串标记；地图点击判成空白时打印触点与最近关卡的距离，便于真机排查。

- **2026-10-26（修）**：真机扫码进入黑屏（开发者工具正常）：真机没有浏览器全局 `performance`，`MapBootstrap.onLoad` 里 `performance.now()` 抛错，渲染循环没启动。新增 `minigame/polyfill.js`（game.js 第一个 import）补 `performance` / `requestAnimationFrame` / `globalThis`，cc-shim 里同样兜底；渲染循环改用自己的时钟（dt 夹在 0~50ms）；首次启动的 onLoad 出错也照样启动循环并把错误画在屏幕顶部红条；`ellipse` 缺失时用缩放圆代替。

- **2026-10-26（续）**：测试服排行榜加 100 个虚拟玩家（服务端 `V6__rank_bots.sql`，由 `docker/tools/gen_rank_bots.py` 按真实星线生成，总积分 3~744、中位 103；关卡榜第 1 关 73 人、第 3 关 52 人上榜）。真实玩家每多一个上总榜，就隐藏一个虚拟玩家（`game_player.bot_order` 退场顺序与分数无关，状态 '2'），后台参数 `game.rank.botTarget`（默认 100，改 0 = 全部退场）；后台玩家数 / 新增趋势 / 通关人数统计不含虚拟玩家。

- **2026-10-26**：排行榜新规服务端已部署到测试服（candy.aidertech.cn）：先备份库与源码（`/root/backup/*-20261026-090844.*`），执行 `V4__codex.sql`（之前未部署的图鉴表）+ `V5__rank_rules.sql`，串行只构建 app 镜像（Dockerfile 的 apk 源换腾讯云内网镜像，官方源在服务器上卡死）。客户端排行榜已登录时读 `/rank/global`、`/rank/level`、`/rank/me`（榜底显示「全服实时排名 / 本关 N 人上榜」，百名外用服务端给的距上一名），离线 / 失败退回示例数据；`REPORT_MODES` 放开困难模式上报。

- **2026-10-25（续九）**：排行榜新规落地（原型 `design/leaderboard-rules.html`）。客户端：新增 `核心/rank.ts`（总积分 = 简单 + ⌊困难×1.5⌋、只认有效成绩、总星数上限 360、竞赛排名、距上一名、按真实星线生成的示例对手）；`LevelRecord` 加 `validBest`（老存档按 personalBest 迁移）；荣誉档改为 名次≤10 或前 1% 超神 / 前 10% 王者，没上榜恒为优秀；排行榜加「💡 距上一名 / 怎么上榜」提示条与「示例数据」标注；好友榜 KV、结算弹窗「累计」统一读 rank.ts；上报带 `mode` / `revived`。服务端（`candy-game-server`，**仅本地，未部署**）：`ProgressMerge` 分模式 + 有效分 + 加权、`V5__rank_rules.sql` 迁移、`/rank/global` 竞赛排名、新增 `/rank/level`、`/rank/me` 补距上一名；83 个服务端单测通过。`REPORT_MODES` 仍只报简单模式，等服务端部署后再放开困难。

- **2026-10-25（续八）**：排行榜规则评估 + 产品原型 `design/leaderboard-rules.html`（只是方案，游戏代码未改）：现状问题（总榜收续命局、模拟对手分数量级不对、总榜不并列、王者档人少时不可达、客户端/服务端/好友榜三套口径）；建议规则：只认「有效成绩」（未续命且 ≥1★）、总积分 = 简单 + 困难×1.5、总星数含续命局（上限 360）、关卡榜沿用 ≥3★、竞赛排名同分并列、荣誉档按前 1% / 前 10%、「距上一名 / 距上榜」提示、离线标明示例数据；附服务端接口改动清单与可交互沙盘。

- **2026-10-25（续七）**：修关卡详情窗口文案重叠：第 2 关牌子高 980→1090、第 4 关手账纸高 1020→1130，模式按钮与底部开始按钮之间留出约 85px；第 3 关「稍后再说」下移 10px，不再压到「开始」的点击区。

- **2026-10-25（续六）**：排查「点关卡没反应」：浏览器、模拟微信环境、以及微信开发者工具实际编译出的 SWC/ES5 代码（含开发者工具里的真实存档）三种方式下点第 1~4 关都能弹窗，未能复现。加固：运行时一个触摸监听抛错不再拖垮整条冒泡链；主题详情窗口出错自动退回原吊牌；运行时错误画在屏幕顶部红条上（点一下关闭），开发者工具 / 真机不看控制台也能截图定位（`cc-shim reportError`、`玩法/runtimeError.ts`）。

- **2026-10-25（续五）**：点关卡弹出的关卡详情窗口，第 2/3/4 关各一款（`界面/ThemedPreview.ts`，与对局皮肤对应；第 1 关与第 5 关起仍是原吊牌）：第 2 关糖果嘉年华 = 糖果彩带吊奶油金边牌 + 粉色糖果横幅 + 三星插座 + 星线表 + 糖果胶囊选模式 +「开始挑战 ▶」；第 3 关果冻乐园 = 白色底部 sheet 升起 + 薄荷标签 + 弧线三星 + 分段控件 + 目标卡 + 金色「开始」/「稍后再说」；第 4 关贴纸手账 = 歪贴手账纸飘下 + 和纸胶带 + 手写关卡号 + 红色星章 + 虚线星线清单 + 牛皮纸标签 +「开贴 ▶」。三款都显示本模式最好星数与三条星线，模式切换 / 困难门槛 / 进关与原吊牌同一套规则。字体子集脚本改为同时扫描 `界面/`。

- **2026-10-25（续四）**：排行榜字体保留原来的系统字体，整页加粗（纯代码运行时只认 `enableBold`，只作用于排行榜，图鉴 / 设置不变）、字号加大（`界面/MapPanels.ts` 顶部 `LB` 表）：标题 100 > Tab 62（未选中 56、选中加棕描边）> 我的成绩数值 80（「未上榜」62）> 行总分 54 > 简单/困难 48 > 昵称 46 > 表头 38 > 说明 34；分数加白色细描边、表头加浅色描边；运行时补上 `Label.Overflow.SHRINK` 真缩字（超宽昵称不再冲出格子）。

- **2026-10-25（续三）**：首页地图换新关卡节点与连线（美术图 `UI及角色/首页/关卡节点/_20261023201337_412/413_1340.png`，深灰底由 `tools/key-map-art.py` 抠成透明 → `assets/resources/map/node/node-candy.png`、`link-candy.png`）：相邻关卡之间画粉白糖果条（按长度截取不拉伸、按方向旋转，通向未解锁关卡的一段调暗）；节点统一用糖果珠，已通关在珠下方显示 3 颗星、点亮实得星数，未解锁盖灰 + 🔒。旧三态珠图（node-todo/star1/star3）不再使用。**新图需上传到 `https://candy.aidertech.cn/mini-assets/pp/map/node/` 微信里才看得到。**

- **2026-10-25（续二）**：首页左上角木牌的头像 / 昵称改为可替换（`玩法/profile.ts` + `界面/ProfilePanel.ts`，做法参考糖果小镇 `minigame/settings.ts`）：能拿到微信头像昵称就用（以前授权过的启动时静默取；资料面板「使用微信头像和昵称」= `wx.createUserInfoButton`），微信只回「微信用户」匿名值时视为没拿到；否则自选 8 个预设萌宠头像、点「修改昵称」弹系统键盘（最多 12 字）。本机存 `pinpin.profile`，登录后 `PUT /game/api/player/profile`（后端只收预设序号 + 昵称，昵称过词表与 msgSecCheck，被拒回滚并提示）；排行榜「我」显示自己的昵称。预设头像现为 emoji 占位，出图后在 `PRESET_AVATARS[i].src` 填资源路径即可换图。

- **2026-10-25（续）**：第 1 关对局界面改为照搬 web 原型（`web/index.html #screen-game` + `web/ui/result.ts`）：奶油底 + 深蓝金边卡片 + 天空蓝计分条（← 返回 / 🚩 目标分 / 翻牌两位数得分 / 🕒 倒计时），碎片 2px 白边、融合组外沿蜜金，飘字飞向分数；结算 / 续命 / 失败改为麻绳吊牌，文案同 web（「恭喜，得分优秀」「时间到·要再试一次吗？」「差一点就成功了」等）；引导改为 web 五步（swap / hint4 / eliminate / refill / clear），去掉提示键（拖错两次自动圈出）。新增 `玩法/webHud.ts`、`webResult.ts`，文案在 `text.ts` 的 `WEB_*`。第 2/3/4 关三原型不变。

- **2026-10-25（分支 `pure-code/minigame`）**：对局界面三主题重做，**第 1 关保持原样式**（橙色顶栏 + 通用弹窗，`theme.ts` 的 `classic`），第 2/3/4 关分别为糖果嘉年华 / 果冻乐园 / 贴纸手账（第 5 关起回到原样式），各自照搬 `design/` 原型的 HUD、棋盘、结算与失败页（`玩法/themeHud.ts`、`themeResult.ts`、`themeExtras.ts`、`paint.ts`）；自带子集字体 `minigame/fonts/`（`tools/subset-fonts.py`）；cc-shim 修路径复用导致双层绘制失效、补渐变/投影/虚线/圆角裁切/文字描边；修续命页「就差 0 分」、果冻主题连击词数字错位、提示键压住操作提示。详见 `docs/原型到真机改造.md` §十三。

网页预览版（`web/`，`node preview/serve.mjs` → `http://localhost:5181/web/index.html`）的改动，逐条记录见 **`web/UI_README.md` §8 更新日志**。要点：

- **2026-10-21**：首页改正式皮肤（`web/art/home/`）；地图改 **5 世界 × 12 关**（每世界一张 1080×3840 底图 `web/art/map-v2/`，节点按 `ROAD_X` 路中线落位）；结算弹窗改吊牌骨架（新增 `web/ui/result.ts`）；顶部浮层 `✕` 关闭键统一；底部页签栏改常驻浮层。
- **2026-10-22**：模式命名统一「简单 / 困难」（不再有「普通」）；结算分数改为**本关历史最高分**（分模式，标签「简单分数 / 困难分数」）；排行榜删掉 60/40 假拆分、改真实分模式分数；困难模式需**同关简单三星**才开启；「下一关」改为回主页 + 弹 PLAY 页；主页删模式按钮与世界名横条，换世界/翻页箭头放大加特效。
- **2026-10-22（下午）**：地图三态果冻珠立体化（自绘浓郁渐变珠体 + 同色外发光，素材 `mix-blend-mode: multiply` 当纹理）；排行榜新增**「我的成绩」成绩条**（我的排名 / 累计总分 / 累计星数，88px 金描边大字，无标题行）；图鉴解锁规则改为**每 10 颗星一张**（简单+困难星数合并，满星收满 36 张）；界面说明小字全清；加载页真实进度条；美术素材 `UI及角色/` 入库。
- 以上均随 `9dea498` 提交并推送到 `main`（https://github.com/dodo0717/pinpinle）。
- **2026-10-22（晚，分支 `fix/core-web-bugs`）**：Bug 修复，未改 UI 与规则。
  - 测试环境：测试导入路径 `core/`→`核心/`、`game/`→`玩法/`（原路径不存在，测试从未跑通）；测试与 `preview/serve.mjs` 需 **Node ≥ 22.18**（用到 `registerHooks` / `stripTypeScriptTypes`）。跑法：`node --import ./test/ts-resolve.mjs --test test/*.test.ts`（221 通过），冒烟：`node --import ./test/cc-resolve.mjs test/smoke-game.mjs`。
  - 核心层（web 与 Cocos 共用）：
    - 存档修复把 `unlocked` 抬到「最高已通关关卡 + 1」（原来只抬到该关，下一关会永久锁死），且只认 ≥1★ 的记录（坏记录不再能解锁全部关卡）。见 `核心/save.ts`。
    - 荣誉判档按**本局**是否上榜（≥3★ 且未续命）判断，续命局或 1★ 通关不再沿用历史榜分判成超神。见 `核心/honor.ts`。
    - 恢复断点时校验池子结构与已拼好的 2×2，坏档在恢复时就被拦下，而不是玩到第一次消除才崩。见 `核心/engine.ts` 的 `validateSnapshot`。
  - web 层：
    - 动画中切后台回来不再重复扣时间：`syncSession` 同步更新 `savedAt`。
    - 多指触控只认第一根手指（按 `pointerId` 过滤）。
    - 结算页点「看广告加体力」，体力满或次数用完时把原弹窗还回去，不再卡死。
    - 从页签或「挑战本关」离开时清空「返回结算」回调，不再弹出已结束那局的荣誉弹窗。
    - 新增局次令牌 `roundId`：退出或换关后，旧的消除动画与排队中的引导气泡自动作废。
    - 不在对局中时，切后台或关页面也会落盘（防抖中的设置改动不再丢）。
    - 总分榜里 0 分显示「未上榜」，不再是「排名 101」。
    - 读取 `localStorage` 抛错（禁用站点数据 / 沙箱 iframe）时退回内存存储，不再白屏；`玩法/storage.ts` 同步修改。
    - 移动端音频解锁改为多种手势重试，直到上下文真正运行（`ui/audio.ts` 的 `unlock()` 改为返回 boolean）。
  - 预览服务 `preview/serve.mjs`：挡住路径穿越（403）；非法 URL 编码返回 400，不再让进程崩溃；默认只监听 `127.0.0.1`（局域网真机预览用 `HOST=0.0.0.0`）。
  - 加载页首帧：`web/index.html` 在 module 脚本前加一段同步缩放脚本（算式与 `main.ts` 的 `fitStage()` 相同），修复首次进入时先闪出「未缩放的加载页左上角」、再变成正常加载页的问题。
  - 触屏点关卡没反应：地图在 `pointerup` 里打开 PLAY 吊牌后，浏览器补发的 `click` 落在刚盖上来的浮层空白处，把吊牌立刻关掉。`web/ui/levelPreview.ts` 改为「按下和点击都在空白处」才关闭；鼠标点击、点空白关闭、点 Play 进关均已用无头 Chrome 触屏模拟验证。
  - 微信小游戏黑屏：`assets/scenes/Map.scene` 里 Bootstrap 组件的 `__type__` 写的是完整 UUID，Cocos 场景要求用压缩 UUID，构建日志报 `Missing class: a1b2c3d4-…`，启动脚本 `MapBootstrap` 没挂上，屏幕上只剩相机底色。已改成压缩 UUID `a1b2cPU5fZ4kKvN7xI0VniQ`（与构建产物里 `MapBootstrap` 的注册 ID 一致），需在 Cocos Creator 里重新构建。
  - 编辑器报错 `Cannot read properties of null (reading 'anchorX')`：手写场景里 Canvas 和 Bootstrap 节点都缺 `UITransform`（Canvas 组件依赖它），相机也直接挂在 Canvas 上，字段名用的是非序列化名。`Map.scene` 按 Cocos 3.8 标准结构重写：Canvas（UITransform + Canvas）→ 子节点 Camera（正交，只看 UI 层）+ 子节点 Bootstrap（UITransform + MapBootstrap）。
  - 地图关卡气球等贴图缺失（控制台 `[map] 贴图缺失`）：`assets/resources/map/`、`ui/` 下 31 张 PNG 的导入类型是 `texture`，没有 `spriteFrame` 子资源，而 `MapBootstrap` / `UIBuilder` 按 `路径/spriteFrame` 加载。已把这些 `.png.meta` 的 `userData.type` 改为 `sprite-frame`，需在 Cocos Creator 里重新导入后生效。
  - 贴纸去重：`assets/resources/stickers/` 删除 36 张 `sticker_*.jpg` 及其 `.meta`，只保留 PNG（产品确认用 PNG）。消除构建时「动态加载 URL 相同」的警告；web 版和 Cocos 端代码本来就只加载 PNG。PNG 本身仍有 26.8 MB，压缩留到包体优化阶段。
  - 微信小游戏报 `generateLevelPools` 读取 `length` 为 undefined：Cocos 构建用 Babel loose 模式，把 `[...iter]` 编译成 `[].concat(iter)`、`Math.max(...iter)` 编译成 `Math.max.apply(Math, iter)`，对 Set / Map / `.keys()` 迭代器结果错误（浏览器和 Node 下正常，只在构建产物里出错）。`核心/merge.ts`、`poolGen.ts`、`structure.ts` 共 6 处改为先 `Array.from()` 再展开。新增 `test/cocos-compat.test.ts` 静态扫描 `assets/scripts`，以后再写这种展开会直接报错。测试 222 个全部通过。
- **2026-10-23（移植第 1 步：加载页 + 首页地图 + PLAY 吊牌）**
  - `assets/scripts/场景/MapBootstrap.ts` 按 web 版重写：5 世界 × 12 关（`map-v2` 底图 + `ROAD_X` 路中线落位），整屏两页翻页（拖动 / 甩动吸附 / 右侧 ▲●▼），左右大箭头换世界（淡出淡入），果冻珠三态（待完成 / 1~2 星 / 3 星）+ 可玩关呼吸光圈 + 当前关宠物 + 世界末关奖杯；顶栏木牌 + 体力胶囊（点它加体力，恢复倒计时）；底部四个页签；点关卡弹 PLAY 吊牌（简单 / 困难，困难需同关简单三星，显示 1 星 / 3 星分数线，Play 进关）；加载页真实进度条。顶栏让出刘海与微信右上角胶囊按钮。
  - 排行榜 / 图鉴 / 设置三个面板暂时沿用灰盒弹窗，下一步按 web 版重做。图鉴改为简单 + 困难星数合并（`MapBootstrap`、`GameBootstrap` 同步修正）。
  - 素材：`web/art/` 的 `map-v2/`、`map/node/`、`home/`、`loading/` 复制到 `assets/resources/`（+12.2 MB）。
  - 顺带修复：`玩法/audio.ts` 调了 Cocos 3.8 不存在的 `AudioSource.resume()`（切回前台会抛错），改为 `play()`；`storage.ts` 两份的严格模式类型错误。
  - 校验：用 Cocos 自带 tsc 对照真实 `cc.d.ts` 严格模式检查 `assets/scripts` 全部通过；新增 `preview/map.html`（浏览器里跑 `MapBootstrap.ts` 真源码），无头 Chrome 模拟点击验证：加载页消失、底图与 12 颗珠加载、点第 1 关弹吊牌、点困难提示门槛、点 Play 进入对局，无报错。`cc-shim.js` 补了 `sys`、`contentSize`、组件 `isValid`。
  - 旧地图不再使用的文件暂未删除：`场景/LevelNode.ts`、`界面/HomeHUD.ts`、`界面/UIBuilder.ts`、`resources/layout/home_hud.json`、`resources/map/`（气球、w1 底图、藤蔓）、`resources/ui/`。
  - 微信里顶栏、页签、关卡珠、加载页全部「贴图缺失」：新拷进 `resources/` 的 21 张图被 Cocos 默认按 `texture` 导入（只有小镇底图被手动改过），没有 `spriteFrame` 子资源。已把 `home/`、`loading/`、`map/node/`、`map-v2/` 下的 `.meta` 改为 `sprite-frame`；`MapBootstrap.loadFrame` 增加兜底：找不到 spriteFrame 时改读 texture 现场包一个，以后新加图忘改类型也不会整块空白。
  - 微信里点第 1 关没反应：改为每颗关卡珠自己挂触摸监听，由引擎按节点包围盒判定命中（原来是地图层拿触点坐标自己换算找最近的珠）；拖动 / 翻页仍走地图层。点击与触摸被忽略时会在控制台打 `[map] tap …` / `[map] 触摸被忽略…`，方便真机排查。
  - 排行榜 / 图鉴 / 设置面板排版错乱：`玩法/GameDialog.ts` 重写排版，面板高度按内容计算（原固定 560，排行榜 10 行字溢出），按钮每行最多两个自动换行（原设置页 4 个按钮排一行、总宽超出卡片），长行自动缩字；遮罩吞掉触摸，弹窗开着时不再能拖动底下的地图。
  - 微信发布：主包超 4MB（12035KB）上传失败。`resources` bundle 在微信小游戏下设为远程包，构建后主包约 2.2MB；`remote/` 上传到 `https://candy.aidertech.cn/mini-assets/remote/`，上传前要把本地 `remote/` 移出构建目录。后台已配置 request / downloadFile 合法域名。
  - 微信里进关后拖不动、点什么都没反应（编辑器预览正常，原因还在排查）：`MapBootstrap.enterLevel` 改为用 `setTimeout` 推到下一帧再切换节点，避免在 PLAY 按钮的触摸分发途中激活对局节点、注册触摸监听；`GameBootstrap` 加排查日志 `[board] 输入已绑定` / `原始触摸` / `触摸被忽略` / `开始拖动`，真机控制台能看出触摸卡在哪一步。
  - 上一条的日志定位到真正原因：触摸已经到了棋盘，但每次都判成「触点不在格子上」。`GameBootstrap.localOf` 把 `getUILocation()`（设计分辨率、左下角原点）直接当世界坐标换算，只有 Canvas 恰好在屏幕中心时才对；微信里对不上。改为和引擎命中判定同一条路：`getLocation()` 屏幕坐标 → UI 相机 `screenToWorld` → 棋盘本地坐标。找不到相机时退回原算法。日志里额外打印本地坐标、格距、行列数，方便再出问题时核对。
  - 预览 shim（`preview/cc-shim.js`）修正：触摸事件改为沿父链冒泡；命中判定和坐标换算计入父节点缩放；补 `Label.Overflow`。修正前地图整体缩放后预览里点第 1 关会命中第 3 关，之前用它做的点击验证并不可靠。
  - 微信里顶栏（木牌 / 体力胶囊）不显示：构建产物里这些图都已是 sprite-frame、控制台也没有贴图缺失，判断为顶栏坐标被算成 NaN（安全区 / 胶囊按钮任一平台值为 undefined 时，`Math.max/min` 会把 NaN 传染给整块顶栏，且不报错）。`MapBootstrap.measureInsets` 对所有平台值做数值校验并夹到合理区间，优先用 `wx.getWindowInfo`，启动时打印一行 `[map] 屏幕高 … 顶栏让位 …` 便于真机排查。已在微信开发者工具确认：修复后顶栏正常显示（日志：屏幕高 2337，安全区上下各 130，胶囊底取到 0）。
  - Cocos 构建 84 条黄色警告 `Conflicting namespaces … re-exports 'IMAGE_ANIMAL' … (will be ignored)`：`核心/index.ts` 和 `核心/config.ts` 都写了 `export * from './ledger'`，同一批名字被导出两次。删掉 `index.ts` 里那一行，ledger 的导出统一经由 config 带出；已确认 `IMAGE_ANIMAL`、`MAX_ART_ID`、`animalOf` 等仍能从 `核心/index` 正常取到，类型检查与 222 个测试通过。
- **2026-10-23（移植第 2 步：排行榜 / 图鉴 / 设置整屏面板）**
  - 新增 `assets/scripts/界面/MapPanels.ts`，替换原来的灰盒弹窗，视觉按 web 版：蓝天渐变 + 棕色返回圆钮 + 白字描边标题 + 金框大卡。素材 `web/art/{leaderboard,collection,settings}` 复制到 `assets/resources/panel/`（35 张，3.3 MB，`.meta` 已设为 sprite-frame）。
  - 排行榜：总分榜 / 关卡榜双 Tab、我的成绩条（我的排名 / 累计总分或本关最高分 / 累计星数）、金银铜领奖台（屏幕矮时自动收起）、表头 + 榜单行（1~4 名徽章、头像、简单 / 困难 / 总分三栏）、关卡步进器、「挑战本关」（回主页弹该关 PLAY 吊牌）。Cocos 没有滚动条，改为按屏幕高度分页。
  - 图鉴：3 列贴纸卡（三色卡底轮换 / 灰锁卡），贴纸按 cover 裁切，分页；点已解锁卡看大图，点未解锁卡提示「每获得 10 颗星解锁一张」。下载 / 分享待接微信接口。
  - 设置：音乐 / 音效两行切图开关（即时生效并落盘）、版本号，保留「重置存档」。
  - 面板打开时页签栏仍在最上层可切换，点返回或「首页」页签关闭面板。
  - 校验：类型检查、222 个测试、冒烟测试通过；预览里三个面板所有节点都在屏幕内，开关切换、返回、关卡榜切换正常，无报错。尚未在微信开发者工具里确认画面。
  - 之前列为「Cocos 端落后于 web」的几条已全部补齐：困难三星门槛、图鉴两模式星数合并、关卡数（60 关）、排行榜「我的成绩」。
  - 尚未处理：对局界面按 web 版重做；图鉴下载 / 分享接微信接口；`openDialog` 顶替旧弹窗时不回调旧的 `onClose`。
- **2026-10-23（包体瘦身：微信上传报 `source size 74307KB exceed max limit 4MB`）**
  - 删除不再使用的素材与脚本：`resources/font/`（两个 HarmonyOS 字体，15.6 MB，新代码未加载）、`resources/ui/`、`resources/layout/`、`resources/map/` 下的旧气球 / w1 底图 / 藤蔓（保留 `map/node/` 关卡珠），以及只给旧地图用的 `场景/LevelNode.ts`、`界面/HomeHUD.ts`、`界面/UIBuilder.ts`。均可从 git 恢复。
  - 压缩图片（Pillow 13，脚本未入库）：PNG 量化为 256 色并保留透明；`map-v2/` 5 张世界底图（不透明）转 JPG（质量 85），`.meta` 改名并保留 uuid，代码按路径加载不受影响。按透明度预乘后与原图比较，平均通道差贴纸约 4/255、其余 ≤3.7/255。
  - 结果：`assets/resources` 由约 42 MB 降到 9.9 MB（贴纸 26.8→4.4 MB，底图 9.7→4.2 MB，面板 3.3→0.5 MB）。
  - 仍超 4 MB 主包上限（引擎约 3.5 MB + 资源 9.9 MB），还需在 Cocos 编辑器里：把 `resources` 设为小游戏分包、构建勾选「分离引擎」、项目设置里裁掉不用的引擎模块；有备案域名后可改为远程包。
  - `preview/index.html`、`preview/play.html` 是旧地图的原型页，引用了已删除的字体和旧 UI 图，已失效；现行预览页是 `preview/map.html`（地图）和 `preview/game.html`（对局）。
  - 校验：类型检查、222 个测试、冒烟测试通过。
- **2026-10-23（服务器：远程素材目录）**
  - 域名 `https://candy.aidertech.cn` 的 TLS 由服务器上的**系统 nginx** 终止（`/etc/nginx/conf.d/candy-game.conf`，不在 candy-game-server 仓库里），再反代到 `candy-game-nginx` 容器（8092）。
  - 在该文件 443 server 里、`location /` 之前新增 `location ^~ /mini-assets/`：直接读 `/home/game/mini-assets/` 下的静态文件，找不到返回 404（不会落到后台首页）。改前备份 `/root/candy-game.conf.bak-20261023-miniassets`，`nginx -t` 通过后 `systemctl reload nginx`（平滑重载，不断连接）。
  - 未改动：任何容器（未重启、未重建）、candy-game-server 仓库、其他站点配置（smart-lock、aidertech、map-editor）。改后复测：后台首页、`/game/api/auth/login`、`/prod-api/captchaImage` 返回与改前一致；8000 / 8089 / 8092 均 200；7 个容器状态不变。
  - 新路由测试：放测试文件能取到（200 JSON），不存在的文件 404，目录不列出；`/mini-assets/../` 被 nginx 规范化后落到后台首页，不会读到 `.env`。测试文件已删除，目录当前为空。
  - 回滚：`cp -a /root/candy-game.conf.bak-20261023-miniassets /etc/nginx/conf.d/candy-game.conf && nginx -t && systemctl reload nginx`。
- **2026-10-24（提交）**：上面 10-22 晚 ~ 10-23 的全部改动随 `c50f61f` 提交并推送到 `fix/core-web-bugs`（360 个文件：核心/玩法/场景/界面脚本、web 层、测试、新素材与瘦身后的旧素材删除）。仓库整理：`.gitignore` 新增 `remote-backup-*/`（远程包快照，每个约 11 MB）与 `debug-touch.js`（临时调试脚本），不入库。
- **2026-10-24（本机环境：切到 Node 22）**：web 预览与测试要求的 Node ≥ 22.18 本机原本没激活（默认 20.19.5，`serve.mjs` 启动即报 `stripTypeScriptTypes` 不存在）。本机版本管理是 **nvm-windows（`D:\anZhuang\nvm`）**，`D:\anZhuang\nodejs` 是符号链接；已 `nvm use 22.18.0`（镜像里早已下载好），并把全局包 `@anthropic-ai/claude-code@2.1.197`、`@openai/codex@0.158.0` 重装到 22.18.0 下（走 npmmirror，15 秒）。验证：`node -v` = v22.18.0，`claude` / `codex` 命令正常，`node preview/serve.mjs` 实测 web 预览 200，222 个测试全部通过。要回退就 `nvm use 20.19.5`（注意 claude / codex 全局包在哪个版本下就只在哪个版本可用）。
- **2026-10-24（音频：小程序没声音的根因与修复）**：全仓库**没有任何音频素材**——web 版的声音是 WebAudio 现场合成的占位音（`web/ui/audio.ts`，注释写明 `art/` 无音频文件），Cocos 版 `玩法/audio.ts` 走 `AudioSource` + `resources/audio/*`，缺素材时静默降级，所以微信里完全无声。新增 `tools/gen-audio.ts`（`node tools/gen-audio.ts` 即可重跑，需 Node 22.18 的原生类型擦除）：按 web 版**逐字相同的合成参数**（频率/时长/包络/波形/总线增益 SFX 0.11、BGM 0.05）离线渲染 12 个 WAV 到 `assets/resources/audio/`——11 个音槽（swap/eliminate/drop/tick/rush/win/fail/honor_god/honor_king/honor_pass/reject）+ BGM（C 大调五声音阶 8 拍循环 × 4 圈，28.8s）。22050Hz 单声道 16-bit，共约 1.45 MB（BGM 1.28 MB，音效合计 178KB）；`reject` 槽 web 版没有（Cocos 预留、暂无人调用），配了两声短促低音。已核验头格式与峰值/RMS（与 web 总线增益吻合）。**生效步骤**：Cocos Creator 打开项目让其导入 `audio/` 生成 `.meta` → 重新构建微信小游戏 → `resources` 是远程包，构建后 `remote/` 重新上传到 `https://candy.aidertech.cn/mini-assets/remote/`。两端行为对齐：BGM 都只在**对局内**播放（web `currentScreen === 'game'`，Cocos `setRunning`），主页无音乐。web 版调音参数改动后需重跑脚本同步听感。
- **2026-10-24（界面三修，以 web 为准）**：小程序截图反馈的三个问题，全部定位到根因后修复。
  - **第一关贴底**：像素级实测用户截图——第 1 关珠子底边与页签栏顶边**零间距贴死**。根因：`measureInsets` 把设备上报的底部安全区**全额**叠进页签栏底距（该设备约 146 设计 px），整条栏被抬高 146；而 web 的 `.tabbar` 就是 `bottom:20`、全代码不处理安全区。已改为 `bottomInset` 固定 20（顶栏的刘海/胶囊让位保留，那是 web 没有的微信真实约束）。
  - **换世界箭头边界置灰**：`setDisabled` 原来只降透明度（80/255），用户截图里左箭头仍是满饱和金色 `#F7B13F`（预览里同代码置灰正常，疑似小程序包早于最终代码）。改为禁用时把金钮**重绘成灰色**（`paintGoldCircle` 加 gray 变体）+ 半透明 150，右侧 ▲▼ 翻页箭头同步处理——任何环境下一眼可见。
  - **图鉴翻页被遮一半**：金框是整卡 sprite **最后盖上去**的，`frame.png`（923×1273）底部有 ~45px 不透明金边带；图鉴 pill 底边原只离卡底 24，下半截正好被金边盖住。新增 `frameBand(ch)` 按卡高等比换算金边带，图鉴与排行榜的底栈（翻页 / 挑战本关）统一从金边带之上 12px 排起。
  - 顺带修复：预览 `cc-shim.js` 缺 `Camera/Canvas/input/Input` 导出与 `director.getScene()`（GameBootstrap 修坐标换算时引入的名字），`preview/map.html` 整页起不来；已补齐并用无头 Chrome 实测地图正常渲染。临时测量页验证：`bottomInset=20`、`navPrev` opacity 150 + disabled、图鉴 pill 底边距卡底 63（金边带 51 + 12）。222 个测试通过。
  - **生效步骤同音频条目**：Cocos Creator 重新构建微信小游戏 + 上传 `remote/`（音频与界面一起验证）。
- **2026-10-24（构建 + 远程包上传）**：Cocos Creator 重构后（先解决 360 清理 Temp 导致的 `ENOENT *.tmp.js` 编译报错——重启编辑器全量重编）构建 `build/wechatgame/`。已核验产物含三项界面修复与音频（`assets/main/index.js` 里有 `bottomInset=20`、灰色 `172,172,172`、`frameBand`；`remote/resources/native/` 下 12 个 WAV）。主包（不含 remote）**2.2 MB** ✓；`remote/resources`（12 MB）经 tar-over-ssh 上传到 `root@118.89.83.44:/home/game/mini-assets/remote/`，公网验证 `config.json` 与音频均 200。本地 `remote/` 已移出构建目录存为仓库根 `remote-backup-015/`（沿用 012~014 惯例，已 gitignore）——不移出的话微信上传会把 12 MB 算进包体直接超 4MB。**剩最后一步（需人工）**：微信开发者工具上传小程序 + 真机验证。
- **2026-10-24（音频二次调整：响度 + 诊断日志）**：首次构建后小程序听不到音乐。两个改动：① `tools/gen-audio.ts` 改为渲染后**峰值归一化**——第一版把 web 总线增益（0.11/0.05）原样烘进文件，手机外放几乎听不见；现在音效峰值 0.5、BGM 0.25（保留 BGM 弱于音效的层次），音色不变只提响度，已重跑生成并核验 12 个 WAV 的峰值。② `玩法/audio.ts` 的加载从「纯静默降级」改为**打日志**：每个槽位缺失 warn 一行、全部就绪 log 一行、BGM 首次起播 log 一行——真机/开发者工具控制台看 `[audio]` 行即可定位无声原因。注意：**BGM 与音效只在对局内响（与 web 一致），主页静音是设计行为**；微信开发者工具本身有不出声的已知怪癖，以真机为准。需重新构建 + 重传 remote 后生效。
- **2026-10-24（安全区避让二修）**：11:51 截图反馈两个问题。① 页签栏（含投影）距底部手势条黑线仅 11px——上次「与 web 对齐固定 20」矫枉过正；② 顶栏整条压在系统 UI 上：左上木牌头像顶到状态栏、右上体力胶囊与微信胶囊**完全重叠**（x 区间 204~504 与 396~500 设计 px 相交、纵向 78~102px 重叠）。根因：胶囊底边在开发者工具里常取 0（10-23 已有记录），顶栏只按安全区顶让位（≈134）而胶囊底实际 ≈211 设计 px。修复：① `bottomInset = clamp(20+safeBottom, 20, 64)`——清出手势条（实测黑线区约 31 设计 px）但封顶 64，防设备上报 ~146 时又把栏顶抬进第 1 关珠子；② 胶囊底边三级兜底（胶囊 API → 状态栏高度+40 → safeTop+40，仅微信环境启用），顶栏整条让到胶囊下方（`capBottom + 116 + 16`，116 = 体力胶囊顶边在 topInset-116）；浏览器预览不受影响（无胶囊分支保持 28+safeTop，实测 28/20 无回归）。222 测试通过。
- **2026-10-24（安全区避让三修：顶栏回收）**：12:11 截图反馈二修后顶栏又**下放过头**（topInset≈270，整排沉到胶囊下方 37 设计px）。两个错误叠加：① +132 的偏移把「顶栏顶边 ≈ 元素最上沿（体力胶囊顶边 = topInset+8）」的方向算反了，正确只需 +8；② 胶囊 API 在工具里报 ≈138 设计px，实画却在 safeTop+125（≈241）——API 与绘制对不上，且不同预设间胶囊底在 safeTop+99~125 浮动。修正：`capBottom = max(API/兜底, safeTop+118)`，`topInset = capBottom + 8`——在 12:11 这台预设上正好贴着实画胶囊底 +9，比二修上移约 28 设计px；小胶囊预设（safeTop+99）会留 ~27 的余量（安全方向）。已知边界：胶囊挂得低的预设上，木牌上方仍会有一条天空带（胶囊底在那，整排不可能再高）——若仍嫌低，下一步只能把木牌（左）与体力胶囊（右）拆开高度：木牌贴刘海、胶囊避让。222 测试通过。
- **2026-10-24（构建 002 + 二次上传，含一个上传路径事故）**：三修后构建到 **`build/wechatgame-002/`**（注意：构建目录从默认 `wechatgame` 变成了带编号的 `wechatgame-002`，微信开发者工具要选这个）。核验：`118` 兜底在包里、音频日志字符串在、12 个 WAV 全部为新响度（peak 0.5/0.25）、主包 2.2 MB。上传时第一次踩坑：在 `remote/` 目录里打包 `resources` 导致解到了 `/home/game/mini-assets/resources`（少一层，线上 `remote/` 还是旧音频，公网抽查 peak=0.05 发现）——已重新按 `tar remote/resources` 正确上传、删除误建目录、公网复验 peak=0.50 ✓。本地 `remote/` 移出存为 `remote-backup-016/`。
- **2026-10-24（新分支 `pure-code/minigame`：纯代码微信小游戏原型）**：应决策「只做纯代码、只做微信小游戏」开的新路线（基于 `fix/core-web-bugs` 拉分支，**不是 main**——main 上没有当天的核心层修复与 UI 移植成果）。无引擎、无编辑器、零 npm 依赖：
  - **运行时**：`preview/cc-shim.js` 升级为**双环境**（检测 `wx`）——浏览器预览与小游戏共用同一份：`wx.createCanvas/createImage/onTouchStart/createInnerAudioContext/onShow` 走微信分支，其余（Node/Graphics/Label/tween/命中冒泡）原样。`AudioSource` 在微信里用 `InnerAudioContext` 实装（BGM 长连接 loop、playOneShot 播完自毁）；`view.getVisibleSize` 按 FIXED_WIDTH 从画布宽高比算可视高度（长屏 >1920，与 web/真机口径一致）；`sys.getSafeAreaRect` 从 `wx.getWindowInfo` 换算；触摸逻辑 px→设计 px。
  - **构建**：`tools/build-minigame.ts`（`node tools/build-minigame.ts`）——Node 22 原生 `stripTypeScriptTypes` 剥 34 个 .ts（装饰器手动剥，与 serve.mjs 同一套正则），import 重写（`'cc'`→运行时相对路径、补 `.js`、中文目录→ASCII：场景/scenes、玩法/game、核心/core、界面/ui），素材（除 .meta）拷到 `minigame/assets/`。产物入库可 review。
  - **入口**：`minigame/game.js`（wx 主画布 / 浏览器 `#cv` 双源）+ `game.json` + `project.config.json`（同 appid，es6:true 关键）+ `browser.html`（浏览器验证页，微信侧打包忽略）。
  - **顺带两个真修复**：① 加载页最短停留/淡出从「累计帧 dt」改为**墙钟**——dt 每帧钳 0.05s，帧率低时 1.2s 最短停留会被无限拉长；② `serve.mjs` 静态响应加 `Cache-Control: no-store`——无头验证曾因 HTTP 缓存一直跑旧模块白折腾半天。
  - **验证（画布像素直读，绕开截图/虚拟时间坑）**：长屏 600×1290 → 可视高 2322 ✓；页签栏 `#5a3920`、顶栏木牌 `#cfb395`、第一关珠 `#d3dae5`、**左箭头灰 `#bcb8af` / 右箭头金 `#fdd987`（置灰生效）**、加载页正常销毁。222 个测试通过。**注意**：素材 9.9MB 全在本地包，开发者工具模拟器可跑；真机预览/上传有 4MB 主包上限，下一步素材走分包或远程。
  - **微信开发者工具导入 `minigame/` 目录即可试**（模拟器里地图/进关/音效应全通——音频这次是 `InnerAudioContext` 直连，预期真有声）。
- **2026-10-24（复用糖果小镇资产 ①：贴图就绪修复 + 地图编辑器链路试点）**：评估文档（`文档/评估-可从糖果小镇抄用的资产.md`）核实后按用户确认的顺序开工。
  - **贴图就绪隐患**（坑清单交叉核对发现）：`drawSprite` 依赖 `img.complete`，微信 `wx.createImage()` 不保证有该属性 → 纯代码版在微信里贴图可能全不渲染。改为 `loadImage` onload 自打 `_ccReady` 标记 + 双保险判断；`naturalWidth || width` 本就有兜底。
  - **地图编辑器链路**（终结手写坐标表）：新增 `tools/convert-map-json.ts`——读糖果小镇通用地图编辑器的 `.map.json`（关卡节点 = `props.level` 组件，中心取 `x+w/2, y+h/2`），按 `TRACK_W/widthPx` 系数换算到轨道坐标（编辑器→底图→轨道两步等比，系数与底图宽度无关），生成 `assets/scripts/场景/levelTable.ts`；`MapBootstrap.worldNodes` 改为**坐标表优先、ROAD_X 公式回退**（表空 = 行为与旧版完全一致，渐进替换）。文件名约定 = 世界美术名（`xiaozhen.map.json`→'xiaozhen'）。已用糖果小镇示例地图实测转换（12 关、无警告）；新增 `test/maptable.test.ts` 5 项（期间修了两个自坑：CLI 入口在被 import 时执行 `process.exit` 截断测试 → 加 `isMain()` 守卫；`[]` 为 truthy 导致空表渲染出 `\n\n`）。**227 测试全过**；minigame 重建（35 个脚本）。
  - **美术工作流**（待美术执行）：双击 `C:\idea-xiao\CandyCrushSaga\universal-map-editor\release\地图编辑器.html` → 新建（9:16）→「导入原图底图」选世界底图 →「⭐ 放置关卡节点」沿路摆 12 个 →「🔢 按位置重新编号」→ Ctrl+S 导出 `xiaozhen.map.json` → 跑 `node tools/convert-map-json.ts xiaozhen.map.json` → 提交。操作细节见糖果小镇 `docs/地图编辑器-操作手册.md`。
- **2026-10-24（复用糖果小镇资产 ②：好友排行 · 开放数据域）**：排行榜新增**好友榜** Tab（总分/关卡/好友三栏）。微信规矩：主域读不到好友数据，只能 `wx.setUserCloudStorage` 写本人 KV；好友数据在开放数据域里读并画到 sharedCanvas，主域整张贴上屏。
  - **子域**：`minigame/open-data/index.js`（纯 ES5 独立脚本，不走 TS 构建，`game.json` 的 `openDataContext` 指向它）——读 `pinpin_rank` KV、排序、按排行榜面板配色（深蓝底/白字/前三金）画到 sharedCanvas，最多 20 行暂不分页。
  - **主域**：`玩法/wxFriend.ts`——`syncFriendRank()` 把两模式总分（与 MapPanels.totalScoreOf 同口径）+ 总星 + 进度按 wxgame 协议写入 KV，**启动与结算落盘各调一次**，失败静默；`friendRankCanvas(w,h,scale)` 取 `odc.canvas` 贴入卡内（尺寸变化时重设 + postMessage 让子域重画；`_ccReady` 标记满足 shim 贴图就绪判断）。非微信全降级：好友 Tab 显示「好友榜仅在微信内可用」。
  - **MapPanels**：Tab 从两栏 340 宽改三栏 250 宽；好友分支跳过我的成绩/表头/分页，卡内整块贴 sharedCanvas。
  - 验证：227 测试全过；浏览器实测三 Tab 渲染 + 降级提示 + 无异常（画布像素直读法）。微信侧（mock 好友数据）待开发者工具实测。minigame 重建（36 个脚本）。
- **2026-10-24（后端决策：云同步直接用现有 candy.aidertech.cn）**：原计划在用户腾讯云新服务器（124.221.226.15）单独部署第二套 candy-game-server，当天完成上传/compose 自带 PG 改造/.env 密钥/数据库恢复清数/nginx 镜像后**用户叫停**，全部清理（容器/镜像/卷/文件/2.8G 构建缓存，smart-lock 与 Superset 未受影响）。原因核实：现有实例 `.env` 的 `WX_MINIAPP_APPID=wxd84cc8ded4b62579` 与本游戏一致，评估文档担心的「单游戏配置冲突」不存在——域名白名单、HTTPS、code2session 密钥全现成，**云同步客户端（下一步）直接指向 `https://candy.aidertech.cn/game/api/`** 即可，无需任何后端部署。注意点：该库还有糖果小镇测试期的玩家数据（同一 AppID），同一微信号两边都玩过时进度会按「取大合并」混到一起。
- **2026-10-24（复用糖果小镇资产 ③：云同步客户端移植，v1 仅简单模式）**：新增 `玩法/cloud.ts`（移植自 `universal-map-editor/src/minigame/cloud.ts`，按本作双模式进度形状改造）：
  - **协议**：`POST /game/api/auth/login`（wx.login code 换 JWT+playerId）→ `GET /game/api/progress`（后端自维护 `{unlocked, stars:{}, best:{}}` JSON）→ 与本地**逐关取大合并**（星/personalBest 取大；boardBest 是排行榜口径云端没有，保持本地）→ 本地更优的关**按升序补推**（与后端 `level ≤ unlocked` 跳关守卫天然吻合：通关集是连续前缀）；`POST /game/api/level/result` 结算上报，**失败进离线队列（≤200 条）下次启动补传**；401 清 token 转纯本地。
  - **v1 只同步简单模式**：后端单模式模型 + 关卡守卫会把困难模式的偏移关号判成跳关拒收（LevelRule/ReportGuard 核实过），硬上会丢数据；`REPORT_MODES` 留了缝，后端加模式维度后一行放开。困难模式进度仍由微信 KV 好友榜（总分+总星）覆盖展示。
  - **接入点**：`MapBootstrap.onLoad` 异步 `bootCloud`（登录→flush 队列→pull 合并→有变化才重画；直接写 `GS.data.progress.normal`+markDirty+flush，绕开 setProgress 只写当前模式的问题）；`GameBootstrap` 结算落盘后按 `REPORT_MODES` 上报。`cloudSync()` 懒单例共享登录态；非微信返回 null 全 no-op。
  - 期间踩坑：`constructor(private host)` 参数属性不被 Node 剥离模式支持（MapPanels 头注释早有此规约）→ 改显式字段。新增 `test/cloud.test.ts` 9 项（合并/补推/队列/401/降级，假宿主注入）；**236 测试全过**；minigame 重建（37 个脚本）+ 浏览器验证游戏照常起。微信侧待开发者工具/真机实测（登录换 token、进度同步）。
- **2026-10-24（微信工具 `worker path empty` 修复 + 素材远程化）**：
  - **工具报错 `Error: worker path empty`**：挖了工具自身源码（app.asar）——带 `openDataContext` 的项目会触发一个 worker 基础库编译插件，它读 game.json 的 `workers` 字段（无则空串）直接抛错；糖果小镇没炸是因为他们 `es6: false` 走了老式子域路径。**解法：`project.config.json` 里 `enhance: false`（保留 `es6: true`，import 编译不受影响）**——用户实测生效，开放数据域（好友榜）随之恢复。
  - **素材远程化（真机 4MB 上限的前置）**：`minigame/assets/`（105 文件 / 12MB）上传到 `https://candy.aidertech.cn/mini-assets/pp/`（downloadFile 合法域名已配置，公网抽查四类素材全 200）；shim 的 `RES_BASE` 微信分支改走该远程基址（浏览器验证仍走本地 `/assets/resources/`），`tools/build-minigame.ts` 不再拷素材并清理旧拷贝。**主包从 12MB 降到 0.51MB**（44 个文件，纯代码），远低于 4MB 上限——**真机预览/上传解锁**。代价：微信侧首帧素材走网络（加载页进度条覆盖这个等待）；服务器宕机时贴图/音频缺失但 Graphics 绘制的 UI 照常。236 测试全过 + 浏览器渲染回归通过（画布像素直读）。
  - **素材更新流程（今后换图）**：改 `assets/resources/` 源文件 → 跑上传（tar 到服务器 `/home/game/mini-assets/pp/`，同 Cocos remote 包套路）→ 重跑 `tools/build-minigame.ts`（生成扩展名清单）→ 重新编译。改后缀或新增文件必须重跑构建，否则运行时找不到（见下条）。
  - **远程 404 探测修复**：远程化后首测控制台出现 `xiaozhen.png 404`/`bg.png 404`——`loadImageAny` 逐后缀探测（png→jpg→…），jpg 素材每次先吃一个真实 404 请求。改为构建时扫 `assets/resources` 生成 **扩展名清单**（`minigame/src/runtime/asset-ext.js`，105 条，`globalThis.__PP_ASSET_EXT`），`game.js` 首先引入；运行时先试清单命中项、未命中才退回探测（浏览器直跑源码无清单也能跑）。
- **2026-10-24（体力双轨 v1：本地为主 + 服务器规则配置）**：读了后端 `GameStaminaService`/`StaminaCalc`——只有查/扣/退三个口，规则走后台参数（sys_config），**没有「加体力」通道**，且返还有 `pending>0` 配对约束 → 咱们的「看广告 +1」进不了服务端账本，完整双轨会在下次同步时把广告体力冲掉（玩家白看广告）。按用户决策走 **A+C**：
  - **A（已做）**：体力维持现有本地逻辑不动（广告/恢复/存档零变化）；线上参数改为本作规则 `game.stamina.max 5→10`、`recoverMinutes 30→20`（SQL UPDATE + 清 Redis 的 `sys_config:game.stamina.*` 三键，免重启；DB 复核 10/20/1 ✓）——将来上双轨的地基现成，后台「玩家管理」的体力显示也不再错口径。
  - **C（下次后端维护窗口第一项）**：`GameStaminaService` 加「体力调整」小接口（~20 行，广告上报用），按部署说明的**串行构建规程**构建 + 分钟级重启；之后客户端完整双轨（进关 consume / 退出 refund / 启动对齐 + 广告直接上报）预计半天。**备选 B（广告做本地信用层、不过服务器）已评估并否决**：服务器/本地恢复/广告信用三份真值对账，状态机复杂、bug 面大。
- **2026-10-24（复用糖果小镇资产 ④：分享卡片带邀请人）**：`wxFriend.ts` 扩为微信专属能力模块（好友排行 + 分享），新增三件套：`enableShare(playerId)`（`wx.onShareAppMessage`，卡片 query 带 `inviter=<playerId>`）、`getInviter()`（读启动参数）、`reportInviter(inviter)`（POST `/game/api/invite`——后端二期未上线，404 静默尽力而为，接口上线即自动生效）。`CloudSync` 补上通用 `api()` 方法（他们原版有、首版移植时省了；体力等后续能力都走它），401 清 token、404 归 null。接入点：`bootCloud` 登录成功后开分享 + 上报邀请人（每次登录一次）。**图鉴后台录入顺延**：需要先给 118 库补 V4 迁移（game_codex 表）再录 36 张卡数据，且卡名/简介要定文案——与用户新提的对局界面原型设计任务并行排队。238 测试全过（新增 api()/分享降级 3 项）；minigame 重建。
- **2026-10-24（对局界面原型设计：三方案，`design/` 目录）**：用户提出对局内排版/界面/字体/图标/玩法与通关反馈需要优化，按业界做法出**三个可交互的高保真原型**（单文件 HTML、零依赖、双击即看；`design/index.html` 是入口）：
  - **A 糖果嘉年华**（糖果传奇流派）：饱和糖果色 + 木牌棋盘 + 多汁按钮；通关三星逐颗**砸落** →「超神！」金光爆发 → 彩带雨；失败 = 续命大圆钮 + 10s 自动放弃环。
  - **B 果冻乐园**（Royal Match 流派）：大留白 + 悬浮胶囊 HUD + 圆环计时 + 单一金 accent；通关**底部面板升起**、三星沿虚线弧依次点亮、荣誉徽章轻弹；续命行内卡 + 广告角标。
  - **C 贴纸手账**（**本作专属**）：贴纸收集是玩法本体 → 界面即手账——纸张纹理 + 和纸胶带贴 HUD 卡 + 贴纸白边虚线（每格微微歪）+ 楷体手写注释；通关 = 战绩**拍立得收入手账** + 超神**红章「哐」地盖下**（回弹缩放 + 旋转章形）。
  - 三者均覆盖完整对局流：HUD / 星线进度 / 棋盘（可点消涨分、连击词）/ 紧迫态（≤10s 换色 + 脉冲）/ 通关（3星=超神、2星=王者、1星=优秀 + 分数结算）/ 失败续命（广告 + 30s）；底部「演示控制」直跳任意状态。`prefers-reduced-motion` 已尊重。已用无头浏览器验证渲染无 JS 错误。**待用户选型后按选中方向重做对局 UI（GameBootstrap/BoardView）**。
  - **同日按用户要求把三原型的演示玩法换成真拼图消除**（此前是「点一下消除」的占位玩法）：碎片模型同 `核心/pieces.ts`（每格 = 某图的四分之一，左上/右上/左下/右下）、融合判定同 `核心/merge.ts`（同图 + 网格相邻 + 相对位置正确，连通分量满 4 ⟺ 正确 2×2 ⟺ 消除）。实现：拖影拖动换位（另有「点一块再点一块」的换位方式）、2-3 块融合组高亮提示（A 金光 / B 金环 / C 红虚线框）、消除 = 完整贴纸在 2×2 中心弹出、上方碎片下落补位（45% 概率与下方块成对刷新）、连锁加词（连锁 x2 起跳分递增）、开局固定三组「差一块就完整」的半成品（随机满组拆掉防自动消灭）。引擎 JS 三份同构，仅视觉不同。无头验证：30 格碎片全渲染、半成品组提示正确出现、零 JS 错误。
- **2026-10-24（三主题进真小游戏：对局内可切换，2/3/4 关默认开）**：把 design/ 三原型的视觉**做进微信小游戏本体**（不再只是 HTML 原型）：
  - 新增 `玩法/theme.ts`：三主题纯数据（candy 糖果嘉年华 / clean 果冻乐园 / journal 贴纸手账）——背景渐变、HUD 形态（整条横牌 vs 三只悬浮胶囊）、字体（journal 用楷体）、按钮配色、棋盘底板（木桌 / 白卡 / 纸面+内虚线框）、融合环（金粗 / 金细 / 印章红细线）。持久化 wx/localStorage/内存三级降级；`cycleTheme()` 即时生效（监听者重建全部视觉层，**只换皮不动引擎**）。
  - `GameBootstrap`：`applyThemeVisuals()` 落地（全屏背景渐变 Graphics + HUD 重建 + `rebuildBoard()` 按 boardSpec 重放 `build/setCells/applyMerge`）；HUD 右上角新增「样式·XX」按钮循环切换三主题；HUD 主题化（横牌双层木色 / pills 白胶囊+墨字+金数值）。
  - `BoardView`：`buildPanel()` 主题底板（投影 + 双层填充 + 描边；journal 加内虚线框）；融合环颜色/线宽随主题。
  - **`核心/progress.ts` 出厂 `unlocked: 1→4`**（用户要求 2/3/4 关默认可玩，供三主题在不同图池上对比；上线前视产品口径改回），progress/save 测试同步改。238 测试全过；minigame 重建（38 个脚本）+ 浏览器回归通过。
- **2026-10-24（关卡绑定主题 + 全套文案 + 主题化结算弹窗）**：按用户最终需求「每关一个风格、各自文案、照抄原型」：
  - `theme.ts` 扩充 **ThemeCopy 全套文案表**——三个原型各自的模式标签、棋盘提示、连击词（漂亮/连上了/贴得真顺）、荣誉头衔（超神！/超神通关/超神）、结算表标签（本局得分/拼好贴纸/累计总分/新纪录）、按钮文案（下一关/下一页/回地图）、失败标题（时间到！/就差一点点/这一页还差一点…）、续命文案（看广告免费续命/看广告继续拼/看免费广告）——**逐字照抄原型**。结算弹窗配色也进表（卡片底色/边框/荣誉色/表底色/按钮色）。
  - **`themeForLevel(level)`**：第 1/2/3/4 关 → candy/clean/journal/candy（循环）。`beginLevel` 里调 `setThemeForLevel(level)`，进关即换皮（**不再有手动切换按钮**）。
  - 新增 **`玩法/themeResult.ts`**：主题化通关/失败弹窗——通关 = 三星逐颗砸落（tween 位置+缩放）+ 荣誉头衔弹入 + 结算表（三行数据）+ 主/副按钮；失败/续命 = 标题 + 差分副标题 + 续命大按钮 + 广告标签 + 放弃按钮。卡片底板按主题画（糖果奶油卡+金边 / 白卡+细边 / 拍立得+内虚线框）。`showHonorDialog`/`showFailDialog`/`showReviveDialog` 全部替换为主题版。
  - HUD 的模式标签也读主题文案（`简单模式`/`简单`/`简单`）。238 测试全过；minigame 重建（39 个脚本）。
- **2026-10-25（补齐原型视觉元素 + 玩法指引）**：新增 `玩法/themeExtras.ts`：
  - **连击词**：`showComboWord(parent, chain)`——连锁 ≥2 时弹主题化连击词（糖果「漂亮！/厉害！/太赞了/无敌了」、果冻「连上了/再连锁/三连锁/停不下来」、手账「贴得真顺！/手感来了/太会贴了/手账大师」），大字弹入→淡出动画。`GameBootstrap` 加 `chainCount` 字段，在消除动画处递增、`afterResolve` 重置。
  - **棋盘操作提示**：`ensureBoardHint(parent)`——棋盘下方（-700）常驻一行主题文案（「拖碎片换位，四块拼成完整贴纸即消除」/「...就贴好啦」），主题字体/颜色。
  - **首次玩法指引**：`showThemeGuideOnce(parent)`——首次进关弹半透明遮罩 + 主题化卡片：标题「怎么玩」+ 三步说明（🧩 碎片是四分之一 / 👆 拖动换位融合 / ✨ 拼满 2×2 消除）+ 星线说明 + 「知道了，开玩！」按钮。第二次进关不再弹（模块级 `guideShown` 标记）。238 测试全过；minigame 重建（40 个脚本）。
- **2026-10-25（HUD 照抄原型 A 完整排版）**：`buildHud()` 完全重写为糖果嘉年华布局——不再是一条整牌，而是原型 A 的分区结构：
  - **左：木牌分数卡**（深木底 + 浅木面 + 下沿暗色，圆角 16；「分数」标签 + 大号分数数值）
  - **中：三星插座**（三个 130px 圆形，未得 = 紫底暗星 / 已得 = 金底亮星 + 发光，随分数实时更新）
  - **右：金色计时圆环**（190px 圆环，底 = 半透明黑 / 前景 = 金色弧，剩 10s 变红；中心大号时间数字）
  - **下方：星线进度**（「★线」标签 + 三段 210px 圆角条，背景半透明黑 / 填充金→橙渐变；`updateStarVisuals()` 每次得分后重画插座颜色与进度宽度）
  - **底栏：模式标签**（左，白色文字）+ **体力胶囊**（右，半透明黑底 + 「💛 9/10」）+ 返回按钮（左上角）+ 提示按钮（棋盘下方）
  - `updateHud()` 同步更新：分数文本 / 时间文本（颜色随剩余时间变色）/ `updateStarVisuals()`（三星插座 + 星线进度）/ `updateTimerRing()`（计时弧按剩余百分比画弧）
  - 新增字段：`starSockets: Graphics[]`、`starLineFills: Graphics[]`、`timerRingFg: Graphics`。238 测试全过；minigame 重建（40 个脚本）。

## 扩展方向

- 节点点击事件 → 弹出关卡信息 / 进入关卡
- 已通关节点显示星星
- 未解锁节点显示锁图标
- 三个世界切换（W1/W2/W3 不同主题配色）
- 节点素材替换为美术 PNG（Sprite 替代 Graphics 绘制）
