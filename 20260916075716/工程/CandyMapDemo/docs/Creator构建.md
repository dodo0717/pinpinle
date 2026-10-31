# Creator 构建（本机已装 3.8.8）

编辑器：`C:\ProgramData\cocos\editors\Creator\3.8.8\CocosCreator.exe`
工程：`d:\拼拼乐项目\20260916075716\工程\CandyMapDemo`

## 1. 差什么、补了什么

| # | 问题 | 处理 |
|---|---|---|
| 1 | 工程根**没有 Creator 3.x 的 `package.json`**（只有老格式 `project.json`）。CLI 直接报 `Project definition file not found … package.json: ENOENT` 并退出码 1 | 按官方 `templates/empty-2d` 补一个**最小** `package.json`：`{ "name": "CandyMapDemo" }` |
| 2 | 没有 `.gitignore`，`library/ temp/ build/ profiles/` 会污染 git | 按官方模板补 `.gitignore` |
| 3 | `assets/scripts` 里有 **11 处按 2.x / 旧口径写的 API**，`tsc` 报一堆错 | 逐个改成 3.8 的真实 API（详见 §3），现在 `tsc -p tsconfig.json` 在 `assets/scripts` 上**零错误** |

⚠️ **坑：别往 `package.json` 里塞 `uuid / version / creator / type` 等字段。**
第一版照「完整工程描述文件」补了这些，Creator 启动**直接卡死**（停在
`init **** success` 之后不再往下，`temp/logs/project.log` 里只有一条 dashboard
`Scanner` 的 `Reflect.get called on non-object`）。官方 `templates/empty-2d/package.json`
里就只有 `{ "name": "empty" }` 一个字段 —— 照抄这个才起得来。

## 2. 常用命令

构建（web-mobile）：

```bat
"C:\ProgramData\cocos\editors\Creator\3.8.8\CocosCreator.exe" ^
  --project "d:\拼拼乐项目\20260916075716\工程\CandyMapDemo" ^
  --build "platform=web-mobile;buildPath=project://build/web;startScene=d3e4f5a6-b7c8-9012-def0-123456789012"
```

- `buildPath` **必须是 `project://…` 形式**（写 `./build/web` 会被判非法、回落到 `project://build`）；
- `startScene` 要给**主场景的 uuid**（`assets/scenes/Map.scene.meta` 里那个）；
- 全量约 5 min（首次要导入 500+ 张图），增量约 30 s，产物约 90 MB（`build/web/web-mobile`）。

全量类型检查（不用开编辑器，最快的「能不能编译过」验证）：

```bat
node "C:\ProgramData\cocos\editors\Creator\3.8.8\resources\app.asar.unpacked\node_modules\typescript\lib\tsc.js" ^
  -p tsconfig.json --noEmit
```

⚠️ `temp/tsconfig.cocos.json` 是 Creator 生成的，工程第一次被打开后才有（已被 `.gitignore` 忽略）。

## 3. 修掉的 11 处 API（都是 `tsc` 报出来的真错）

| 文件 | 原来写的（旧口径） | 改成（3.8 真实 API） |
|---|---|---|
| `玩法/audio.ts` | `AudioSource.resume()` | 没有 `resume`，改 `play()` |
| `玩法/GameBootstrap.ts` | `GS.addStamina(now, 5)` | `GS.gainStamina(5)`（`addStamina` 是 meta 层纯函数，签名 `(state, now, count)`） |
| `玩法/GameBootstrap.ts` | `LabelShadow` 的 `shadowColor / shadowOffset` | 3.8.2 起搬到 **Label** 上：`l.enableShadow / l.shadowColor / l.shadowOffset` |
| `界面/HomeHUD.ts` | 同上 | 同上 |
| `界面/LevelPreview.ts` | 同上 | 同上 |
| `界面/LeaderboardScreen.ts` | 同上 | 同上 |
| `场景/LevelNode.ts` | 同上 | 同上 |
| `场景/LevelNode.ts` | ——（缺方法） | 补 `setFont(f)`：MapBootstrap 加载完字体后要下发给关卡珠的所有 Label |
| `场景/MapBootstrap.ts` | `Mask.Type.RECT` | 3.8 的枚举是 `Mask.Type.GRAPHICS_RECT`（没有 `RECT`） |
| `界面/uiPaint.ts` | `mask.graphics`（2.x 属性） | 新增 `maskStencil(mask, node)`：3.8 的模板 Graphics 挂在 Mask 的**同一节点**上（`_createGraphics()` 就是 `getComponent ?? addComponent`），同时兜住预览 shim 的 `mask.graphics` |
| `界面/leaderboardModel.ts` | 造行时没给 `score` | 补 `score`（总分榜里就是累计总分） |

另外两处是**类型收窄**问题（本工程 `strict:false`，联合类型不做判别式收窄）：
`核心/engine.ts`、`玩法/GameBootstrap.ts` 里取 `reason` 改成显式取一次，运行期行为不变。
`tsconfig.json` 加了 `"lib": ["ES2019", "DOM"]`（`Object.fromEntries` / `flatMap` 需要）。

## 4. 已知限制：CLI 无头构建解析不到场景上挂的脚本类

CLI 构建**能跑完**，但日志里有：

```
warn:  Missing class: a1b2c3d4-e5f6-7890-abcd-ef1234567890
error: Script "a1b2c3d4-e5f6-7890-abcd-ef1234567890" attached to "Bootstrap" in scene "Map" is missing or invalid.
```

产物里 `Bootstrap` 节点的 `_components` 会变成 `[null]` —— 也就是**场景上的 MapBootstrap 组件被丢掉**，
跑起来是空场景。

**已经排除的原因**（都验过，不是这些）：
- 不是 TS 编译错（`assets/scripts` 现在 `tsc` 零错误，脚本也确实打进了 `assets/main/index.js`）；
- 不是脚本没被 asset-db 看到（`temp/asset-db/log/*.log` 里有 `asset:import … MapBootstrap.ts`，
  编译产物 `temp/programming/.../chunks/**` 里也有这个类）；
- 不是中文路径 / 工程太大（ASCII 路径的副本同样复现）；
- 不是 `__type__` 写 uuid 还是写类名的问题（两种都试过，都报）。

**对照实验（决定性）**：新建 `templates/empty-2d` 空工程 + 一个只有 `@ccclass('TestComp')` 的
`assets/scripts/Test.ts` + 手写场景挂这个脚本 → CLI 构建**同样**报
`Missing class: <Test.ts 的 uuid>`。

结论：**这是 Creator 3.8.8 CLI/无头模式的行为** —— asset-db 在 CLI 下对脚本的导入结果是空的
（`library/.assets-data.json` 里脚本条目 `"value": {}`，没有类名信息），构建器拿不到 uuid→类的映射；
而编辑器里脚本编译器是活的（`[[Executor]] Register MapBootstrap`），所以**编辑器构建没有这个告警**。

→ **正式出包在编辑器里做**：Creator 打开工程 → 菜单「项目 → 构建发布」→ 选平台 → 构建。
CLI 构建只用来做「能不能编译过 / 资源齐不齐」的回归验证。
