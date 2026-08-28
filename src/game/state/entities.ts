import type { GameState } from './GameState';
import type { UnitCommand } from './commands';
import type { GridPoint } from '../pathfinding/AStar';
import { tileAt } from './map';

/** 实体的两个大类：单位（可移动/战斗/采矿）与建筑（占用 footprint 多格）。 */
export type EntityKind = 'unit' | 'building';

/**
 * 运行中的实体状态：随 tick 变化，只有数据。
 * 定义侧数值（速度/血量等）一律通过 state.defs / state.buildingDefs 查询，不复制进状态。
 */
export interface EntityState {
  id: number;
  type: EntityKind;
  typeId: string;
  ownerId: number;
  /** 实体中心世界坐标（建筑取 footprint 中心）。 */
  x: number;
  y: number;
  /** 本 tick 移动起点，供渲染层插值（docs/01-architecture.md 决策二）。 */
  prevX: number;
  prevY: number;
  /** 建筑：footprint 左上角；单位：当前所在格。 */
  tileX: number;
  tileY: number;
  /** 实体占用的所有格子（单位 1 格，建筑 footprint 多格）；removeEntity 依此释放。 */
  occupiedTiles: GridPoint[];
  hp: number;
  /** 朝向，弧度（世界网格系，渲染时再映射到等距屏幕角）。 */
  facing: number;
  activity: 'idle' | 'moving' | 'attacking';
  /** 当前攻击目标实体 id（战斗系统维护）；null 表示无目标。 */
  attackTargetId: number | null;
  command: UnitCommand | null;
  /** 寻路航点（不含起点，含终点）；移动系统沿它推进。 */
  path: GridPoint[];
  /** 攻击冷却剩余 tick（战斗系统）。 */
  reloadLeft: number;
  /** 采矿车载货量（矿）。 */
  cargo: number;
  /** 采矿车状态机阶段。 */
  harvestPhase: 'idle' | 'seekingOre' | 'mining' | 'seekingRefinery' | 'unloading';
  /** 生产建筑：排队中的单位 typeId。 */
  productionQueue: string[];
  /** 生产建筑：当前单位的累计 tick。 */
  productionProgress: number;
  /** 是否已升级（最多 1 次，状态字段防重，UI 隐藏不够）。 */
  upgraded: boolean;
  /** 升级后：额外可生产的单位（合并到 def.produces）。 */
  producesExtra: string[];
  /** 升级后：电力产出加成（叠加到 def.powerProvided）。 */
  powerBonus: number;
  /** 升级后：伤害倍率（仅单位；建筑无此概念）。 */
  damageMultiplier: number;
  /** 升级后：血量倍率（用于渲染血条比例 = e.hp / (def.maxHp * hpMultiplier)）。 */
  hpMultiplier: number;
}

export function spawnUnit(state: GameState, typeId: string, ownerId: number, x: number, y: number): EntityState {
  const def = state.defs[typeId];
  const id = state.nextEntityId++;
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  const e: EntityState = {
    id,
    type: 'unit',
    typeId,
    ownerId,
    x,
    y,
    prevX: x,
    prevY: y,
    tileX: tx,
    tileY: ty,
    occupiedTiles: [{ x: tx, y: ty }],
    hp: def.maxHp,
    facing: -Math.PI / 2,
    activity: 'idle',
    attackTargetId: null,
    command: null,
    path: [],
    reloadLeft: 0,
    cargo: 0,
    harvestPhase: 'idle',
    productionQueue: [],
    productionProgress: 0,
    upgraded: false,
    producesExtra: [],
    powerBonus: 0,
    damageMultiplier: 1,
    hpMultiplier: 1,
  };
  state.entities[id] = e;
  state.entitiesOrder.push(id);
  occupy(state, e, e.occupiedTiles);
  return e;
}

/** 生成建筑：占据 footprint 全部格。x/y 取 footprint 中心，tileX/tileY 为左上角。 */
export function spawnBuilding(
  state: GameState,
  typeId: string,
  ownerId: number,
  tx: number,
  ty: number,
  options: { grantHarvester?: boolean } = {},
): EntityState {
  const def = state.buildingDefs[typeId];
  const id = state.nextEntityId++;
  const tiles: GridPoint[] = [];
  for (let dy = 0; dy < def.footprint.h; dy++) {
    for (let dx = 0; dx < def.footprint.w; dx++) {
      tiles.push({ x: tx + dx, y: ty + dy });
    }
  }
  const cx = tx + (def.footprint.w - 1) / 2;
  const cy = ty + (def.footprint.h - 1) / 2;
  const e: EntityState = {
    id,
    type: 'building',
    typeId,
    ownerId,
    x: cx,
    y: cy,
    prevX: cx,
    prevY: cy,
    tileX: tx,
    tileY: ty,
    occupiedTiles: tiles,
    hp: def.maxHp,
    facing: 0,
    activity: 'idle',
    attackTargetId: null,
    command: null,
    path: [],
    reloadLeft: 0,
    cargo: 0,
    harvestPhase: 'idle',
    productionQueue: [],
    productionProgress: 0,
    upgraded: false,
    producesExtra: [],
    powerBonus: 0,
    damageMultiplier: 1,
    hpMultiplier: 1,
  };
  state.entities[id] = e;
  state.entitiesOrder.push(id);
  occupy(state, e, tiles);
  // 原版矿场落成时会随附一辆矿车。仅由建造命令显式开启，避免测试布局/读档重复赠送。
  if (typeId === 'refinery' && options.grantHarvester) {
    const spawn = findFreeAdjacentTile(state, e);
    if (spawn) spawnUnit(state, 'harvester', ownerId, spawn.x, spawn.y);
  }
  if (typeId === 'base' && state.players.every((p) => hasBase(state, p.id))) {
    state.victoryArmed = true;
  }
  return e;
}

/** 找到建筑出口附近的首个可走空格，用于矿场附赠矿车。 */
function findFreeAdjacentTile(state: GameState, building: EntityState): GridPoint | null {
  const def = state.buildingDefs[building.typeId];
  if (!def) return null;
  const candidates: GridPoint[] = [];
  for (let dy = -1; dy <= def.footprint.h; dy++) {
    for (let dx = -1; dx <= def.footprint.w; dx++) {
      const inside = dx >= 0 && dx < def.footprint.w && dy >= 0 && dy < def.footprint.h;
      if (inside) continue;
      const x = building.tileX + dx;
      const y = building.tileY + dy;
      const tile = tileAt(state.map, x, y);
      if (tile?.walkable && tile.occupiedBy == null) candidates.push({ x, y });
    }
  }
  candidates.sort((a, b) => (a.y - b.y) || (a.x - b.x));
  return candidates[0] ?? null;
}

function hasBase(state: GameState, playerId: number): boolean {
  return state.entitiesOrder.some((id) => {
    const entity = state.entities[id];
    return entity?.type === 'building' && entity.typeId === 'base' && entity.ownerId === playerId;
  });
}

/** 让实体占用指定格子（写 occupiedBy 并记录 occupiedTiles）。被占用的格会阻塞寻路。 */
export function occupy(state: GameState, e: EntityState, tiles: GridPoint[]): void {
  for (const t of tiles) {
    const tile = tileAt(state.map, t.x, t.y);
    if (tile) tile.occupiedBy = e.id;
  }
  e.occupiedTiles = tiles;
}

/**
 * 统一的死亡清理入口（docs/05-combat.md）：释放全部占格、移出迭代顺序、
 * 清除所有指向它的攻击目标引用、移出选中列表、删除实体。
 * 任何删除实体的路径都必须走这里，否则会出现「打尸体」或「选幽灵」。
 */
export function removeEntity(state: GameState, id: number): void {
  const e = state.entities[id];
  if (!e) return;
  for (const t of e.occupiedTiles) {
    const tile = tileAt(state.map, t.x, t.y);
    if (tile && tile.occupiedBy === id) tile.occupiedBy = null;
  }
  const orderIdx = state.entitiesOrder.indexOf(id);
  if (orderIdx >= 0) state.entitiesOrder.splice(orderIdx, 1);
  for (const otherId of state.entitiesOrder) {
    const o = state.entities[otherId];
    if (o && o.attackTargetId === id) o.attackTargetId = null;
  }
  const selIdx = state.selectedEntityIds.indexOf(id);
  if (selIdx >= 0) state.selectedEntityIds.splice(selIdx, 1);
  delete state.entities[id];
}
