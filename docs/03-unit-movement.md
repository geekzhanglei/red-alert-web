# 03 · 阶段二：单个单位的移动

## 目标

点击选中一个单位，右键点击地图，单位平滑移动到目标格。这一步确立「命令驱动移动」的模式，后续所有单位行为都建立在它之上。

## 验收标准

- [ ] 点击一个单位，它高亮显示（HUD 出现选中框/描边）。
- [ ] 右键地图空地，单位沿直线平滑移动到目标格。
- [ ] 移动中单位朝向目标方向（朝向插值平滑转向）。
- [ ] 到达目标格后单位停下，状态回到 idle。
- [ ] 右键点击不可走格（水/岩石），单位不移动（或移动到最近的合法格，本阶段先「不移动」）。

## 设计意图

**为什么移动是「命令」，而不是「直接把坐标往目标挪」？**

玩家的操作（右键）只是一条**意图**：`{ type: 'move', entityId, targetX, targetY }`。单位收到命令后，交给移动系统在每个 tick 里推进坐标。这样：

1. 单位可以有一个「当前命令」，随时被新命令打断（右键别处 = 换目标），打断逻辑集中在一处。
2. 命令是可序列化的数据 → 直接成为回放、存档的原料（[01 决策四](./01-architecture.md)）。
3. 移动的速度、转向、到达判定都是逻辑系统的事，与「谁来触发」解耦。

**为什么用世界坐标 + 单位状态机，而不是直接操作格？**

单位要平滑移动，就得有连续坐标和朝向。给单位一个显式的 `activity` 状态机（idle → moving → …），是因为后面还会加 attacking、harvesting、retreating 等状态，而「状态 + 当前命令」的组合是 RTS 单位 AI 的最小通用模型。现在把它定下来，阶段四加攻击时就是「加一个状态」而不是「重写移动」。

## 实现思路

### 1. 命令与状态

```ts
// 命令带 playerId（谁发起），回放/联网按「玩家 → tick → 命令」对齐（见 09-save-replay.md）。
export type GameCommand =
  | { type: 'move'; playerId: number; entityId: number; targetX: number; targetY: number }
  | { type: 'stop'; playerId: number; entityId: number };
  // 阶段四追加 'attack'，阶段五追加 'build'/'train'
```

命令入队时**不直接改状态**，等 tick 开始由「命令处理」统一应用。这样命令有统一的时间戳和顺序，也方便回放。

### 2. 移动系统

```ts
export function updateMovement(state: GameState, dt: number): void {
  for (const id of state.entitiesOrder) {
    const e = state.entities[id];
    if (e.type !== 'unit' || e.activity !== 'moving') continue;

    const def = state.defs[e.typeId];
    const dx = e.command.targetX - e.x;
    const dy = e.command.targetY - e.y;
    const dist = Math.hypot(dx, dy);

    if (dist < 0.05) {          // 到达
      e.x = e.command.targetX;
      e.y = e.command.targetY;
      e.activity = 'idle';
      e.command = null;
      continue;
    }

    const step = def.speed * dt; // speed 单位是「格/秒」，dt 是秒
    e.x += (dx / dist) * Math.min(step, dist);
    e.y += (dy / dist) * Math.min(step, dist);
    e.facing = Math.atan2(dy, dx); // 朝向目标
  }
}
```

要点：

- 用 `Math.min(step, dist)` 防止「冲过头来回震荡」，这是移动代码最常见的 bug。
- `dt` 由 tick 循环传入（`TICK_MS / 1000` 秒），单位统一用「格/秒」，避免 tick 率变化导致速度变化。
- 本阶段没有寻路，单位走直线；阶段三把「目标」换成寻路结果 `path`，这段推进逻辑复用，只是每 tick 从 path 里取下一个航点当目标。

### 3. 朝向插值（可选，提升手感）

上面 `facing` 直接 `atan2` 是「瞬间转向」。坦克瞬间掉头很出戏。做一步插值：

```ts
function turnToward(current: number, target: number, maxDelta: number): number {
  let diff = target - current;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return current + Math.max(-maxDelta, Math.min(maxDelta, diff));
}
// 每 tick： e.facing = turnToward(e.facing, targetAngle, turnRate * dt);
```

这是纯视觉打磨，不影响逻辑正确性，先留接口、最后再调。

### 4. 渲染层的选中与精灵

- 选中：把选中 id 存进 `state.selectedEntityIds`，渲染层给对应精灵加个描边/选中圈。
- 精灵：本阶段用简单几何体（矩形/圆形）代替正式贴图，后续再换素材。**不要在素材上花时间，先验证手感。**

## 与其他系统的关系

- 依赖 [02 地图](./02-map-coordinates.md) 的坐标定义，和 `Tile.walkable`（本阶段用「目标格是否可走」判断右键是否有效）。
- 被 [04 寻路](./04-selection-pathfinding.md) 复用：寻路只替换「如何得到目标点」，不替换移动推进逻辑。
- `activity` 状态机被 [05 战斗](./05-combat.md) 扩展（加 attacking）。

## 风险与注意事项

- 到达阈值（上面 `0.05`）别设成 0，浮点误差会永远到不了。
- 命令里存的是「目标坐标」，不是「单位引用」；实体 id 可能因死亡被回收，命令要用 id + 应用时查存在性。
- 移动系统遍历顺序必须走 `entitiesOrder`（决策四），不要用 `Object.values`。
- 现在先让「右键点水」不移动即可，不要提前做「自动找最近合法格」，那是阶段三寻路的副产品。
