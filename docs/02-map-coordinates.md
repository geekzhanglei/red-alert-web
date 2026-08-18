# 02 · 阶段一：地图、等距坐标与摄像机

## 目标

能显示一张等距网格地图，支持摄像机拖动、滚轮缩放、边缘滚屏。这是整个项目能「看见」的第一块砖。

## 验收标准

- [ ] 一张 64×64 的网格地图渲染为等距视角，不同地形颜色不同。
- [ ] 鼠标拖拽地图，摄像机随之平移。
- [ ] 滚轮以鼠标位置为中心缩放。
- [ ] 鼠标移到屏幕边缘时地图自动滚动。
- [ ] 鼠标位置能正确反解出对应的网格格（打印在 HUD 上验证）。

## 设计意图

**为什么逻辑坐标用网格，等距只是渲染投影？**

寻路、碰撞、建筑占地这些规则在「二维网格」上表达最自然、最简单：一格一格，是否可走、是否被占，清清楚楚。等距视角（isometric）只是把网格「斜着画」给人看。如果直接拿屏幕像素当逻辑坐标，一旦摄像机缩放/平移，所有规则都得跟着重算，而且寻路会变得非常别扭。

所以立一条铁律：**网格坐标是唯一逻辑坐标，屏幕坐标只存在于渲染层。** 这条在前面 [01-architecture](./01-architecture.md) 里也是核心原则之一。

**为什么世界坐标要支持小数（子格移动）？**

寻路和碰撞用整数格，但单位移动要平滑，不能一格一格跳。所以单位有一个「世界坐标」`(x, y)`，单位是格、允许小数；碰撞和占用用它的取整格。这样移动系统在连续空间推进，寻路在离散空间规划，各取所需。

## 实现思路

### 1. 地图数据

```ts
export type Terrain = 'grass' | 'water' | 'rock' | 'ore';

export interface Tile {
  terrain: Terrain;
  walkable: boolean;   // 地面单位能否通过
  buildable: boolean;  // 能否放建筑
  oreAmount: number;   // 矿石储量（阶段五才用，先填 0）
  occupiedBy: number | null; // 占用该格的实体 id，先填 null
}

export interface MapState {
  width: number;
  height: number;
  seed: number;               // 地形生成种子，存进存档（决策四）
  tiles: Tile[];              // 一维数组，index = y * width + x
}
```

用一维数组存网格（`tiles[y * width + x]`）而不是二维数组：缓存友好、序列化简单、拷贝快。

### 2. 地形生成

用种子化噪声（不是 `Math.random()`）生成一张「有陆地、有水、有矿石」的地图，保证同一种子生成同一张图——这是回放的起点。

```ts
export function generateMap(width: number, height: number, seed: number): MapState {
  const random = mulberry32(seed);
  const tiles: Tile[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const r = random();
      let terrain: Terrain = 'grass';
      if (r < 0.08) terrain = 'water';
      else if (r < 0.12) terrain = 'rock';
      else if (r < 0.18) terrain = 'ore';
      tiles.push({ terrain, walkable: terrain !== 'water' && terrain !== 'rock', buildable: terrain === 'grass', oreAmount: terrain === 'ore' ? 1000 : 0, occupiedBy: null });
    }
  }
  return { width, height, seed, tiles };
}
```

第一版用「随机撒点」就够，不需要真正的噪声函数；等想要自然的地形过渡（陆地连成片、河流像河）再引入 Perlin/Simplex 噪声或「随机游走挖河」算法。**先在文档里记下这个 TODO，别一开始就上复杂噪声。**

### 3. 等距投影与反投影

网格 → 屏幕：

```ts
const TILE_W = 64;   // 菱形宽（屏幕像素）
const TILE_H = 32;   // 菱形高（屏幕像素），2:1 等距

export function gridToScreen(wx: number, wy: number): { x: number; y: number } {
  return {
    x: (wx - wy) * (TILE_W / 2),
    y: (wx + wy) * (TILE_H / 2),
  };
}
```

屏幕 → 网格（用于鼠标拾取，注意这里是世界坐标，还要减掉摄像机偏移再算）：

```ts
export function screenToGrid(sx: number, sy: number): { x: number; y: number } {
  // 传入的 sx/sy 已经是「世界空间」屏幕坐标（已减去摄像机位置）
  const x = sx / (TILE_W / 2);
  const y = sy / (TILE_H / 2);
  return { x: (x + y) / 2, y: (y - x) / 2 };
}
```

数学上这一对是可逆的，单测时用「投影再反投影 ≈ 原点」来验证，能很快抓住符号/倍率的笔误。

### 4. 渲染地块

用 Phaser 的图形批量画菱形（第一版可以直接用 `add.graphics()` 填色，或为每种地形生成一张 64×32 的贴图再贴图）。关键点是**渲染顺序**：等距下要「后画的盖住先画的」，才能做出正确的遮挡。对一块平坦地图，按 `x + y` 从小到大（从后到前）逐行绘制即可：

```ts
// 从「最远的一角」画到「最近的一角」，保证正确遮挡
for (let d = 0; d < width + height - 1; d++) {
  for (let x = Math.max(0, d - height + 1); x <= Math.min(width - 1, d); x++) {
    const y = d - x;
    drawTile(x, y);
  }
}
```

这个 `d = x + y` 的顺序，在阶段三、阶段四里给「单位/建筑」排序时还会复用（同一批对象按 `x + y` 排序，就是等距下的正确前后关系）。

### 5. 摄像机

Phaser 的 `Camera` 自带 `scrollX/scrollY/zoom`。把等距地图的中心对准世界原点，用 Phaser 摄像机做平移和缩放：

- **拖动**：监听 `pointerdown` + `pointermove`，记录差值，改 `camera.scrollX/scrollY`。
- **缩放**：监听 `wheel`，改 `camera.zoom`，同时以鼠标位置为锚点调整 scroll，使鼠标下的地图点不漂移。
- **边缘滚屏**：每帧判断鼠标是否靠近视口边缘，在边缘时给 scroll 一个匀速增量。

摄像机平移/缩放属于「渲染层的纯视觉操作」，不产生游戏命令、不写 `GameState`，所以它天然可以脱离确定性逻辑随意做。

## 与其他系统的关系

- 被 [03 移动](./03-unit-movement.md)、[04 寻路](./04-selection-pathfinding.md) 依赖：它们都在本阶段定义的网格/世界坐标上工作。
- 地图的 `occupiedBy`、`buildable`、`oreAmount` 分别在寻路（阶段三）、建造（阶段五）、经济（阶段五）里被读。

## 风险与注意事项

- 屏幕 → 网格的反投影最容易写错正负号，务必用单测锁住「投影↔反投影」。
- 别在 `gridToScreen` 里顺手减去摄像机偏移，那会污染语义——摄像机是渲染层的事，投影函数保持纯。
- 地形生成要过 `seed`，不要直接 `Math.random()`，否则阶段八的回放从第一行就废了。
- 边缘滚屏要小心「幽灵指针」：鼠标从未进入画布时，Phaser 的指针坐标是 (0,0) 残值，若直接用会启动瞬间把相机顶到地图角落。应跟踪鼠标是否真的在画布上（`pointerenter/leave`），不在画布上就禁用边缘滚屏。
- WebGL 无法在 0 尺寸画布上创建纹理；若游戏可能被后台标签页恢复（布局为 0）启动，入口要先等容器有尺寸再建 Phaser.Game。
- 现在只画「贴地」的菱形，不要急着画山/树等会引入「遮挡高度」的复杂地形；等实体渲染顺序稳定后再加。
