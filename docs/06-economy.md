# 06 · 阶段五：基地经济

> 本阶段体量较大，拆分为两个可独立验收的子阶段（[README.md](./README.md) 有导航），避免一次做完拖太久：
> - **阶段五·A 资源与建筑放置**（§A）：资金、矿石采集、建筑放置
> - **阶段五·B 生产队列与电力**（§B）：生产队列、电力供需
> 「设计意图」「与其他系统的关系」「风险与注意事项」覆盖整个阶段，不重复拆分。

## §A 阶段五·A：资源与建筑放置

### 目标

加入资金、矿石采集与建筑放置，形成「采矿 → 攒钱 → 花钱放建筑」的循环前半段。

### 验收标准（A）

- [ ] 采矿车往返矿石田与矿场，资金随时间增长（HUD 实时更新）。
- [ ] 玩家可以花钱放建筑：选建筑 → 放置预览（ghost）→ 合法格绿色/非法格红色 → 点击放置。
- [ ] 建筑放置占用 `footprint` 格，不可叠放、不可放水上。

### 实现思路（A）

#### A1. 资源与资金接口

```ts
export interface PlayerState {
  id: number;
  money: number;
  powerProduced: number;   // 由各电力建筑贡献
  powerConsumed: number;   // 由各建筑消耗
  // 生产队列挂在各生产建筑上，不挂在玩家上
}
```

经济系统对外的全部接口就两个，其余系统**禁止**直接读写 `money`：

```ts
export function changeMoney(state: GameState, playerId: number, delta: number): void;
export function canAfford(state: GameState, playerId: number, cost: number): boolean;
```

#### A2. 采矿循环

采矿车是一个带 `cargo` 的实体，活动状态机加一个 `harvesting` 态：

```text
idle ──收到 harvest 命令──▶ 驶向最近矿石格（寻路）
        ├─ 矿石格被挖空 ──▶ 换最近的下一格 / 附近没矿则 idle
        ├─ cargo 满 ─────▶ 驶向最近矿场，卸货：changeMoney(+capacity)，cargo=0
        └─ cargo 未满 ───▶ 每 tick 挖一次：tile.oreAmount -= rate，cargo += rate
```

要点：挖矿速率、容量、卸货额都在 `UnitDefinition` 里，做成数据。采矿车的「找最近矿」逻辑放经济系统，不放寻路——寻路只管「从 A 到 B 怎么走」。

#### A3. 建筑放置

放置是一次「预览 → 确认」的交互，预览（ghost）是**渲染层概念**，确认后才产生 `build` 命令：

```ts
// 命令
{ type: 'build', buildingTypeId: string, x: number, y: number }

// 校验（命令应用时再做一次，不能只信 UI）
function canPlace(map: MapState, def: BuildingDefinition, x: number, y: number): boolean {
  for (let dy = 0; dy < def.footprint.h; dy++) {
    for (let dx = 0; dx < def.footprint.w; dx++) {
      const tile = tileAt(map, x + dx, y + dy);
      if (!tile || !tile.buildable || tile.occupiedBy != null) return false;
    }
  }
  return true;
}
```

命令应用时：扣钱 → 写入占用 → 生成建筑实体（hp 从 0 或 1 开始，建造进度条走 `buildTicks`，期间可被打坏）。第一版可以「秒建」（hp 直接满），建造动画是打磨项。

## §B 阶段五·B：生产队列与电力

### 目标

加入生产队列与电力供需，完成「造兵 → 打仗」的经济循环后半段。

### 验收标准（B）

- [ ] 兵营/战车工厂可以排生产队列，按时间出单位，单位在建筑旁出现。
- [ ] 电力有供需：总消耗 > 总产出时，生产速度减半（HUD 显示）。

### 实现思路（B）

#### B1. 生产队列

```ts
export interface ProductionBuilding extends BuildingState {
  queue: string[];          // 排队中的 unitTypeId
  progressTicks: number;    // 当前单位已生产 tick
}
```

每 tick：队列非空时 `progressTicks++`；达到 `def.buildTicks`（被电力惩罚放大后），在建筑旁找一个空闲可走格生成单位，`progressTicks` 归零，队列出队。排队的判定在命令应用时：`canAfford` 才入队（或者入队时扣钱，出队退款——第一版选「排队时就扣钱」，简单且无欠账）。

#### B2. 电力惩罚

```ts
const buildTicks = def.buildTicks * (powerConsumed > powerProduced ? 2 : 1);
```

## 设计意图

**为什么资金只允许一个写入口？**（A、B 共用）

资金会被多个地方改动：采矿车卸货加钱、建筑扣钱、造兵扣钱。如果各系统各自 `player.money += x`，改一个经济公式就要在全项目里找所有加钱点。约定：**只有经济系统提供 `changeMoney(state, playerId, delta)` 和 `canAfford(state, playerId, cost)`**。其他系统只调用接口。这是「单一写入口」原则，[design-guide](./design-guide.md) 里明确列为禁区。

**为什么矿石用「田」而不是每个矿工挖一块独立矿？**（A）

地图上的矿石按「格」存储（`tile.oreAmount`），采矿车开过去，每次挖走一部分。这样矿石会真实地被挖空，玩家会为「抢矿」产生对抗——这是 RTS 经济驱动的核心冲突，值得为它保留格级储量。若图省事做「无限矿」，经济循环就只剩时间，没有空间博弈了。

**为什么电力用「全局供需差」而不是逐建筑断电？**（B）

逐建筑模拟断电（哪个建筑停摆）是仿真级复杂度，收益很小。全局规则「总产出 < 总消耗 → 全局生产速度减半」已经能形成「玩家要平衡电力」的决策压力，且实现只有两行。等科技树复杂了再考虑「优先断电」。

## 与其他系统的关系

- 依赖 [04](./04-selection-pathfinding.md) 的占用格做建造校验，[03](./03-unit-movement.md) 的移动做采矿车往返，[05](./05-combat.md) 的 `removeEntity` 做「建筑被摧毁」。
- 给 [07 AI](./07-ai.md) 提供「我能造什么、我缺什么」的判断依据。
- 胜利条件（摧毁敌方基地）也在本阶段挂上：基地类建筑死亡 → 检查胜负。

## 风险与注意事项

- 资金读写必须走 `changeMoney`/`canAfford`，在代码评审里把「直接改 money」当红线。
- 建造校验要在地图越界时返回 false，`tileAt` 越界返回 undefined 而不是崩。
- 采矿车「附近没矿就 idle」容易变成「傻站着」：给个兜底，没矿就返回基地待命。
- 排队扣钱方案下，取消队列必须退款，测试要覆盖「排队 → 取消 → 钱回来」。
