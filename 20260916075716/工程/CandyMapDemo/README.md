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

## 近期更新（2026-10-21 ~ 24）

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

## 扩展方向

- 节点点击事件 → 弹出关卡信息 / 进入关卡
- 已通关节点显示星星
- 未解锁节点显示锁图标
- 三个世界切换（W1/W2/W3 不同主题配色）
- 节点素材替换为美术 PNG（Sprite 替代 Graphics 绘制）
