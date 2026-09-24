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

| 参数 | 值 | 说明 |
|---|---|---|
| `DESIGN_W` | 1080 | 设计宽度 |
| `MAP_H` | 5760 | 地图总高度（3 屏） |
| `CURRENT_LEVEL` | 6 | 当前高亮关卡 |

节点坐标由 `generateLevelPositions()` 生成，正弦摆动，可替换为外部坐标表。

## 扩展方向

- 节点点击事件 → 弹出关卡信息 / 进入关卡
- 已通关节点显示星星
- 未解锁节点显示锁图标
- 三个世界切换（W1/W2/W3 不同主题配色）
- 节点素材替换为美术 PNG（Sprite 替代 Graphics 绘制）
