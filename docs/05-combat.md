# 05 · 阶段四：战斗闭环

## 目标

加入攻击命令、射程检测、射速冷却、伤害与死亡。右键点敌人 = 攻击，单位自动追入射程开火，打死目标后切换或停下。

## 验收标准

- [ ] 右键敌方单位，我方单位移动进射程并开始攻击。
- [x] 敌我单位进入各自武器射程后自动锁定最近敌人并互相攻击。
- [x] 坦克等载具可以把敌方步兵、载具和建筑作为攻击目标，伤害仍由装甲修正表决定。
- [ ] 攻击有冷却（射速），HUD 能看出两次攻击的间隔。
- [ ] 敌方单位血量为 0 时死亡并从地图移除、释放占格。
- [ ] 目标死亡或逃出射程后，单位切换攻击其他敌人或停下（不做无限追猎，本阶段先「停下」）。
- [ ] 攻击/移动可以互相打断：右键空地 = 移动，右键敌人 = 攻击。

## 设计意图

**为什么伤害判定用「命中即结算（hitscan）+ 冷却 tick」，弹道只是视觉效果？**

RTS 的战斗核心是「数值在确定的 tick 上结算」，而不是「一个飞行中的实体什么时候撞到人」。如果把伤害挂在实际飞行的弹道上，伤害时间就依赖帧率、依赖渲染，破坏确定性（[01 决策四](./01-architecture.md)），联机/回放都会出问题。正确做法：

- **逻辑**：攻击冷却一到，立即对目标结算伤害；期间可以画一个纯视觉的炮弹飞过去。
- **视觉**：炮弹只是动画，哪怕炮弹还没飞到，伤害已经扣了——玩家看不出这个 100ms 的差异。

**为什么单位用「索敌 → 追入射程 → 开火」的循环，而不是攻击命令自带寻路？**

右键点敌人产生 `attack` 命令，战斗系统接管后：若目标在射程内就原地开火；不在射程内就「以目标为中心取一个射程内的点」发内部移动指令，到位后开火。这样「追击进入射程」复用 [03 的移动系统](./03-unit-movement.md)，战斗系统只负责「打不打、打谁」，职责清晰。

**为什么伤害和护甲做成数据表？**

红警类 RTS 的精髓之一是「克制关系」：某种武器打重甲有加成、打轻甲减半。这类规则放代码里就是散落的 if，放数据表里就是可读、可调、可扩展的一行配置。本阶段先做最简单的「伤害 × 修正系数」表，为后续武器类型/装甲类型留好结构。

## 实现思路

### 1. 数据：武器与装甲

```ts
// 定义侧（data/units.ts）
export interface UnitDefinition {
  // ……沿用阶段三字段
  weapon?: {
    damage: number;
    range: number;      // 格
    reloadTicks: number;
    modifiers: Partial<Record<ArmorType, number>>; // 对各类装甲的伤害系数
  };
  armor: ArmorType;     // 'light' | 'heavy' | 'structure'
}
```

### 2. 战斗系统每 tick 流程

```ts
export function updateCombat(state: GameState): void {
  for (const id of state.entitiesOrder) {
    const e = state.entities[id];
    if (e.type !== 'unit' || !e.weapon) continue;

    // 1. 索敌：当前攻击目标死了/逃出「追踪半径」，就在射程内找新目标
    if (e.attackTargetId != null) {
      const t = state.entities[e.attackTargetId];
      if (!t || !isEnemy(e, t)) e.attackTargetId = null;
    }
    if (e.attackTargetId == null) {
      e.attackTargetId = findTarget(state, e); // 射程内最近的敌人，找不到为 null
    }

    if (e.attackTargetId == null) {
      if (e.activity === 'attacking') { e.activity = 'idle'; e.command = null; }
      continue;
    }

    // 2. 距离判断：不在射程 → 朝目标方向推进（借用移动系统）
    const dist = distBetween(e, state.entities[e.attackTargetId]);
    if (dist > e.weapon.range) {
      moveToward(state, e, state.entities[e.attackTargetId], e.weapon.range);
      continue;
    }

    // 3. 冷却开火：冷却中 → 递减；到点 → 结算伤害
    if (e.reloadLeft > 0) { e.reloadLeft--; continue; }
    dealDamage(state, state.entities[e.attackTargetId], e.weapon.damage * e.weapon.modifiers[state.entities[e.attackTargetId].armor] ?? 1);
    e.reloadLeft = e.weapon.reloadTicks;
    e.activity = 'attacking';
  }
}
```

要点：

- `reloadLeft` 用「剩余 tick 数」递减，天然符合确定性（不用时间戳）。
- 目标死后 `dealDamage` 内部负责清理：释放占格、从 `entitiesOrder` 移除、清掉所有引用它的 `attackTargetId`。
- **目标逃出射程**：本阶段先「追」（`moveToward` 会持续向目标移动）；无限追猎是否合理，等 AI 和地图玩起来再调（可加「仇恨范围」字段，超了放弃）。

### 3. 索敌与死亡

```ts
export function dealDamage(state: GameState, target: EntityState, amount: number): void {
  target.hp -= amount;
  if (target.hp <= 0) {
    const idx = state.entitiesOrder.indexOf(target.id);
    if (idx >= 0) state.entitiesOrder.splice(idx, 1);
    freeOccupancy(state, target);          // 释放占格
    for (const other of state.entitiesOrder) {
      const o = state.entities[other];
      if (o.attackTargetId === target.id) o.attackTargetId = null;
    }
    delete state.entities[target.id];
  }
}
```

死亡清理是战斗系统最容易漏的地方：**任何实体 id 的引用（攻击目标、选中列表、AI 编队）都要在死亡时清除**，否则会出现「打尸体」或「选幽灵」。建议做一个 `removeEntity(state, id)` 统一入口，所有系统复用。

### 4. 视觉：炮口火焰、弹道与受击损坏

渲染层监听「本 tick 发生了一次攻击」的信号（`shot`）并画一条短暂的火线/弹道；命中时再监听 `hit`，在目标位置叠加闪光、扩散环和灰烟。血量低于阈值后持续冒烟，重伤时增加火星。**这些只是视觉事件**，不进逻辑判断；伤害仍在命中 tick 立即结算。

## 与其他系统的关系

- 复用 [03](./03-unit-movement.md) 的移动推进做「追入射程」，扩展其 `activity` 状态机。
- 使用 [04](./04-selection-pathfinding.md) 的 `occupiedBy` 做死亡释放占格。
- 为 [06 经济](./06-economy.md) 的「摧毁建筑返还/胜利条件」和 [07 AI](./07-ai.md) 的「兵力评估」提供基础。

## 风险与注意事项

- 别把伤害挂在弹道飞行上，先结算再播动画。
- 死亡清理务必走统一入口，逐处手写清理必漏。
- 「射程」和「追踪半径」是两个概念，先做「追踪半径 = 射程 × 1.5」之类的简单版，别一开始就做复杂的仇恨模型。
- 伤害系数表用 `Partial<Record<ArmorType, number>>`，缺省乘 1，加新装甲类型不需要改战斗逻辑。
