# 选中后属性/升级面板

## 背景

现在选中己方单位/建筑后，HUD 仅在 `prod-panel` 给建筑显示生产队列，单位选中后**没任何视觉反馈**——`selection-info` 只是简单一行「选择：步兵 · 生命 x/y」，玩家不知道：

- 单位/建筑有哪些属性
- 能做什么（升级、变形、编队）
- 选中多个时整体状态

设计目标是：选中后右下角弹出**统一属性面板**，按选中类型提供属性 + 可操作项。

## 目标

- 选中 0 个：面板隐藏
- 选中 1 个单位：属性面板（hp/速度/武器/护甲/状态）+ 升级/操作按钮
- 选中多个同类单位：聚合视图（数量 + 平均属性）+ 通用升级
- 选中 1 个己方建筑：建筑属性 + 升级按钮（如基地→高级基地）
- 选中敌方单位/建筑：只读属性（用于侦察）

## 验收标准

- [ ] 选中单个己方步兵：面板显示 hp/速度/武器/护甲，状态行（idle/moving/attacking），可点「升级」按钮（花 200 钱提升伤害 50%）。
- [ ] 选中多个同类型单位：面板显示「步兵 ×3」、综合属性（如总血量）、可对全部应用升级。
- [ ] 选中己方基地：建筑属性（hp/护甲/占地/电力产耗）+「升级到高级基地」按钮（花钱增加电力产出 + 解锁坦克生产）。
- [ ] 选中敌方单位：面板只读显示敌方属性（红字），不可升级。
- [ ] 升级消耗钱：原子操作扣钱 + 修改实体；钱不够时按钮 disabled，提示"资金不足"。
- [ ] 升级走 `pendingCommands`（`upgrade` 命令），保持命令流一致、回放可重演。

## 设计意图

**为什么升级也要走命令流？**

升级本质是「修改实体状态」，跟 `train`/`build`/`attack` 一样。如果在 UI 按钮里直接 `e.hp += x`、扣 `player.money`，会破坏决策一/四（命令是历史的唯一来源）。让升级也走 `pendingCommands`，与训练/建造/攻击走同一条路径，回放天然一致。

**为什么只支持「单级升级」（步兵 → 步兵+），不做多级科技树？**

第一版试玩只需要"我花了钱能变强"这个反馈环。多级树要管前置条件、解锁分支、科技资源，时间成本高。Step 1 范围：每个单位/建筑**最多 1 次升级**（消耗 = 单位/建筑 cost × 50%，效果 = 伤害 +50% / 血量 +50% / 建筑：电力 +50% 或解锁 1 种新单位生产）。

**为什么选中多个异类要"按类型分组"而不是聚合？**

玩家多选的目的 90% 是「同时下达同一命令」（全选 → 全体攻击）。选 1 坦克 + 1 步兵时，升级按钮要分别给。统一给个"对全选升级"会让"只想升兵不动坦克"做不到。简单做法：**多选时按 typeId 分组，每组各出一行 + 各自升级按钮**。

## 实现思路

### 1. 命令：加 `upgrade`

```ts
type GameCommand =
  | { type: 'move'; ... }
  | { type: 'attack'; ... }
  | { type: 'build'; ... }
  | { type: 'train'; ... }
  | { type: 'upgrade'; playerId: number; entityId: number }; // 实体（单位或建筑）只能升 1 次
```

### 2. 实体状态：加 `upgraded: boolean`

```ts
interface EntityState {
  // ...
  upgraded: boolean;
}
```

`processCommands` 校验：未升级、钱够 → `canAfford` + `changeMoney` + 标记 `upgraded`。

### 3. 升级效果

**单位**：应用 `Multiplier = 1.5` 到 `damage`、`maxHp`；当前 `hp` 同步加 50% 增量。装甲修正系数和速度不变。

**建筑**（base 例）：`powerProvided: 50 → 75`、`produces` 增加 `'tank'`。其他建筑：`hp * 1.5`、生产速度 ×1.3（暂不实现生产提速，先给 +hp / 解锁）。

### 4. UI：选中面板（`#selection-panel`）

加在 `index.html`：`<aside id="selection-panel" aria-label="选中属性"></aside>`，与 `#prod-panel` 合并为同一个面板，根据选中类型显示对应内容。

位置：右下角（屏幕 80% 高度处），与右上 HUD 错开。

```html
<aside id="selection-panel"></aside>
```

### 5. UI 数据流

`GameScene.update` 已在每帧刷 `prodPanel`。扩展成：

```ts
private updateSelectionPanel(): void {
  const sel = state.selectedEntityIds;
  if (sel.length === 0) hide();
  else if (sel.length === 1) showSingle(e);
  else showGroup(sel);  // 按 typeId 分组，每组一卡片
}
```

按钮点击直接调用 `enqueueUpgrade(state, id, PLAYER_ID)`（同步入命令），不需等下一 tick——但等 tick 跑命令系统才扣钱，UI 上 `money` 已经在下一帧 update 自动反映。

### 6. CSS

`#selection-panel` 沿用 `prod-panel` 配色（深色 + 黄边），加 `.upgrade-btn`、`.upgrade-btn:disabled`、`.row`、`.stat`。

## 与其他系统的关系

- 复用 `changeMoney`/`canAfford` 资金接口（[06-economy §A1](./06-economy.md)）
- 复用 `processCommands` 命令应用（[01-architecture §7](./01-architecture.md)）
- 与 [09-save-replay](./09-save-replay.md)：`upgraded` 字段进存档，命令日志记录 upgrade 命令，回放重演得一致终局

## 风险与注意事项

- **升级原子性**：必须在命令系统里完成"扣钱 + 改实体"，不能拆成两步（重放可能漏半步）。`processCommands` 里：先 `canAfford` 校验 → `changeMoney` → 改 `upgraded = true` → 应用效果。
- **不跨阵营升级**：敌方实体的升级按钮要禁用或根本不显示（也通过 `canAfford` + `ownerId === PLAYER_ID` 双重过滤）。
- **升过级的不能升级**：按钮 disabled + 文案"已升级"。要状态字段防重，**不能仅靠 UI 隐藏**（命令日志重放要靠状态判定）。
- **hp 变化让 `currentHp` 同比例变**——不能用 `hp = maxHp` 充能，那跟「不受伤能无限血」无差。当前 hp 增量 = 升级增量的 maxHp 比例。

## 最小第一版（1 天工作量）

- 命令 `upgrade` + `processCommands` 应用
- 实体 `upgraded` 字段
- UI：单选 1 实体时显示属性 + 升级按钮（多选/敌方可后做）
- CSS：样式融入现有配色

`base → 高级 base` 在第一版**只解锁 `tank` 生产**（不引入新单位，符合「最多 1 次升级」「不给全新兵种」约束）。单位升级：伤害 +50%、血量 +50%，单选时按钮可用。
