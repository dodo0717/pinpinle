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

## 扩展方向

- 节点点击事件 → 弹出关卡信息 / 进入关卡
- 已通关节点显示星星
- 未解锁节点显示锁图标
- 三个世界切换（W1/W2/W3 不同主题配色）
- 节点素材替换为美术 PNG（Sprite 替代 Graphics 绘制）
