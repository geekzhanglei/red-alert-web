# 01 · 总体架构与核心决策

这一篇是整个项目的地基。后续所有阶段的设计都在遵守这里定下的四条决策。如果某一处的实现让你犹豫「这样写对不对」，回到这一篇对照原则判断。

## 1. 目标

搭建一个可以持续扩大的架构骨架：游戏逻辑是独立于渲染的纯数据演算，渲染、输入、HUD 都只是逻辑之外的「外围」。第一版单机，但架构上为存档、回放、联网留下明确位置。

## 2. 分层与数据流

```mermaid
flowchart LR
    subgraph 外围
        A[输入：鼠标/键盘] --> C[命令队列]
        D[Phaser 渲染层] 
        E[HTML HUD]
    end
    subgraph 核心：固定 tick
        C --> G[命令处理]
        G --> H[移动/寻路]
        G --> I[战斗]
        G --> J[经济/生产]
        G --> K[AI]
        H --> S[GameState]
        I --> S
        J --> S
        K --> S
    end
    S --> D
    S --> E
```

- 箭头只有一种方向：**外围产生命令 → 核心消费命令、演化状态 → 外围读取状态来画**。
- 核心里的各系统（移动、战斗、经济、AI）只读写 `GameState`，彼此不直接调用对方的内部实现，通过状态字段和命令间接协作。
- 渲染层**只读** `GameState`，绝不写回。发现渲染层想改数值，就是架构被破坏的信号。

## 3. 核心决策一：逻辑与渲染分离

**设计意图**

游戏规则的复杂度和 bug 都集中在逻辑层，渲染只是「把当前状态画出来」。如果两者纠缠（例如把攻击冷却计时挂在 Phaser 精灵的 `setTimeout` 上），就会出现三类问题：

1. 逻辑依赖帧率——帧率不稳，游戏速度就漂移。
2. 无法脱离渲染验证逻辑——没法单测寻路或伤害。
3. 存档、回放、联网同步全都无从谈起——它们需要的是纯状态，不是一堆 DOM/精灵对象。

**实现思路**

- `GameState` 是纯数据结构：普通对象、数组、数字、字符串，**不含任何 Phaser 类型、不含任何 DOM**。
- 系统（`MovementSystem`、`CombatSystem`……）是普通函数/类，输入 `GameState` + `dt`，原地修改 `GameState`，返回 void。
- Phaser 场景只做三件事：初始化时把 `GameState` 交给渲染器；每帧根据状态刷新精灵位置/贴图/可见性；把用户输入转成命令入队。

```ts
// 逻辑系统：纯数据进出
export function updateMovement(state: GameState, dt: number): void {
  for (const id of state.entitiesOrder) {
    const e = state.entities[id];
    // ……推进 e.x/e.y、写入 e.command 结果
  }
}

// 渲染层：只读
export function render(state: GameState): void {
  for (const id of state.entitiesOrder) {
    const e = state.entities[id];
    spriteOf(id).setPosition(toScreenX(e.x, e.y), toScreenY(e.x, e.y));
  }
}
```

## 4. 核心决策二：固定 tick 与渲染插值

**设计意图**

游戏速度不能随帧率变化。用固定时间步长（fixed timestep）推进逻辑，用「累加器」把渲染对齐到显示器刷新率。固定 tick 是确定性（决策四）的前提，也是实现暂停、加速、回放的机械基础——暂停就是不推进 tick，加速就是每次推进两个 tick。

**实现思路**

```ts
const TICK_RATE = 20;          // 每秒 20 个逻辑步
const TICK_MS = 1000 / TICK_RATE;
let accumulator = 0;
let last = performance.now();

function frame(now: number): void {
  accumulator += now - last;
  last = now;
  // 防止卡顿后「死亡螺旋」：单帧最多补 5 个 tick，其余丢弃
  if (accumulator > TICK_MS * 5) accumulator = TICK_MS * 5;
  while (accumulator >= TICK_MS) {
    game.update(TICK_MS);      // 一次逻辑步，确定性推进
    accumulator -= TICK_MS;
  }
  const alpha = accumulator / TICK_MS; // 0~1，渲染插值用
  renderer.render(game.state, alpha);
}
```

- `alpha` 用于在两个逻辑状态之间插值，让移动看起来平滑。早期可以忽略插值，直接画最新状态；等移动手感重要了再加。
- 所有「随时间变化」的逻辑量都用 tick 或毫秒整数表达，不在浮点时间上做相等比较。攻击冷却用「剩余 tick 数」递减，不用 `Date.now()`。

## 5. 核心决策三：数据驱动

**设计意图**

单位/建筑的数值（价格、血量、速度、射程、伤害、冷却、视野）属于**配置**，不属于**代码**。把数值写进系统代码，每调一个平衡就要改逻辑、重新走一遍逻辑评审；把数值放进配置文件，加单位、调平衡都不碰系统。这也是后续做「自定义地图/模组」的前提。

**实现思路**

```ts
// 静态定义：来自 JSON/TS 配置，运行期只读
export interface UnitDefinition {
  id: string;             // 'infantry' | 'tank' | 'harvester' | ...
  name: string;
  cost: number;
  buildTicks: number;     // 生产耗时（tick）
  maxHp: number;
  speed: number;          // 格/秒
  attackDamage: number;
  attackRange: number;    // 格
  reloadTicks: number;    // 两次攻击间隔（tick）
  visionRange: number;    // 视野（格）
  footprint: { w: number; h: number }; // 占地
  sprite: string;         // 素材 key
}

// 运行状态：随 tick 变化，只有数据
export interface UnitState {
  id: number;             // 实体唯一 id（单调递增，确定性）
  typeId: string;         // 指向 UnitDefinition.id
  ownerId: number;
  x: number; y: number;   // 世界坐标（可为小数的「格」）
  hp: number;
  facing: number;         // 朝向（弧度）
  activity: 'idle' | 'moving' | 'attacking' | 'harvesting';
  command: GameCommand | null;
  path: GridPoint[];
  reloadLeft: number;     // 攻击冷却剩余 tick
}
```

- 定义和状态**分开**：`typeId` 是桥。系统需要数值时用 `def = defs[e.typeId]` 查定义，绝不把数值复制进状态。
- 实体 id 用全局单调计数器分配，顺序确定（见决策四）。

## 6. 核心决策四：确定性，为存档/回放/联网打底

**设计意图**

这是四条决策里回报最隐蔽、代价最小的一条：让「同样的初始状态 + 同样的命令序列」永远得到「同样的结果」。一旦做到，三个本来要单独造轮子的功能全部免费：

- **回放** = 存地图种子 + 命令序列，重放时重演。
- **存档** = 存某个 tick 的完整快照 + 之后的命令。
- **联网** = 两台机器跑同一份确定性逻辑，只互传命令，不传状态。

如果现在不守这条，后面做存档/回放时就得推倒重来。守它的成本很低，收益极高。

**实现思路（四条纪律）**

1. **随机数用可复现的种子生成器**（如 mulberry32 / xorshift），初始种子写进存档。逻辑里**禁用 `Math.random()`**。
2. **逻辑里禁用 `Date.now()`、`performance.now()`**。时间一律来自 tick 计数或外部传入的 `dt`。
3. **实体遍历顺序稳定**。用 `state.entitiesOrder: number[]` 这样的有序数组驱动迭代；如果非用 `Record<number, T>` 存实体，迭代时必须按 `entitiesOrder` 走，**不要 `for (const id in obj)` 或 `Object.keys` 直接迭代**（它们的顺序虽然通常稳定，但作为约定更明确、更安全）。
4. **浮点只在「同一 JS 引擎」内视为确定**。单机存档/回放没问题；将来跨端（浏览器 vs Node 服务器）同步时，再把关键计算（寻路代价、伤害）改成整数定点。现在先记下这条边界，不必提前实现。

```ts
// 可复现随机：存入 GameState.seed，逻辑里只调用 state.random()
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
```

## 7. 每 tick 的系统执行顺序

顺序本身也要确定，避免「先动还是先打」的不稳定。约定如下：

```
1. 命令处理   —— 把本 tick 入队的命令应用到 GameState（设置目标、路径、生产队列）
2. AI        —— 电脑玩家生成新命令（AI 本质也是命令生产者）
3. 经济/生产 —— 采矿、资金结算、生产队列推进、建造进度
4. 移动/寻路 —— 按路径推进坐标
5. 战斗      —— 索敌、冷却、伤害、死亡清理
6. 可见性    —— 更新战争迷雾（阶段七加入）
7. tick++
```

顺序的影响要敏感：比如「单位本 tick 被生产出来」应在「移动」之前还是之后参与行动——由这套顺序决定，写进文档后就不要随意改，改了可能破坏既有回放。

## 8. 目录结构（与 design-guide 对齐后的落地版）

```text
src/
  game/
    core/           固定 tick 循环、时间、可复现随机
    state/          GameState、实体状态、地图状态、类型定义
    systems/        movement / combat / economy / ai / visibility
    pathfinding/    A*、地图占用
    render/         Phaser 场景、精灵管理、等距投影
    input/          框选、右键命令、摄像机控制
    data/           单位/建筑/武器/地图配置（JSON 或 TS）
  ui/               HTML HUD（资金、电力、建造栏、选中信息）
  assets/           贴图、音效（原创）
```

- `core/` 是唯一知道「时间怎么流动」的地方。
- `systems/` 是唯一「改状态」的地方。
- `render/` 和 `ui/` 是唯一「读状态、画出来」的地方。
- `data/` 是唯一「定义数值」的地方。

## 9. 风险与注意事项

- 别把 Phaser 的 `Scene.update`（渲染帧）当逻辑步用，那会引入帧率依赖。
- 别在渲染层或输入回调里直接改 `GameState`，一切变更都走命令。
- 别让多个系统各管各的资金数值，资金只有一个写入口（经济系统）。
- 确定性纪律现在就开始守，越晚守迁移成本越高。
