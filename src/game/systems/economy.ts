import { GameState } from '../state/GameState';
import { EntityState } from '../state/entities';
import { applyMove } from '../state/commands';
import { changeMoney } from '../state/players';
import { tileAt } from '../state/map';
import { GridPoint } from '../pathfinding/AStar';
import { UnitDefinition } from '../data/units';

/** 每单位矿石的价值（金钱）。 */
export const ORE_UNIT_VALUE = 20;

/**
 * 经济系统（docs/06-economy.md §A）：资金唯一写入口 changeMoney/canAfford，
 * 以及采矿车「寻矿 → 挖矿 → 回矿场 → 卸货」的循环状态机。
 * 阶段五·B 在此追加生产队列与电力结算。
 */
export function updateEconomy(state: GameState, dt: number): void {
  for (const id of [...state.entitiesOrder]) {
    const e = state.entities[id];
    if (!e || e.type !== 'unit' || e.typeId !== 'harvester') continue;
    updateHarvester(state, e, dt);
  }
}

function updateHarvester(state: GameState, h: EntityState, dt: number): void {
  switch (h.harvestPhase) {
    case 'idle':
      seekOre(state, h);
      break;
    case 'seekingOre':
      seekOre(state, h);
      break;
    case 'mining':
      mine(state, h, dt);
      break;
    case 'seekingRefinery':
      seekRefinery(state, h);
      break;
    case 'unloading':
      unload(state, h);
      break;
  }
}

function seekOre(state: GameState, h: EntityState): void {
  const ore = findNearestOre(state, h);
  if (!ore) {
    h.harvestPhase = 'idle'; // 地图没矿了，待命
    return;
  }
  if (h.tileX === ore.x && h.tileY === ore.y) {
    h.harvestPhase = 'mining';
    return;
  }
  if (h.activity === 'moving') return; // 还在路上
  h.harvestPhase = 'seekingOre';
  applyMove(state, h, ore.x, ore.y);
}

function mine(state: GameState, h: EntityState, dt: number): void {
  const tile = tileAt(state.map, h.tileX, h.tileY);
  if (!tile || tile.terrain !== 'ore' || tile.oreAmount <= 0) {
    h.harvestPhase = 'seekingOre'; // 矿被挖完或被挤开，换矿
    return;
  }
  const def = state.defs[h.typeId] as UnitDefinition;
  const take = Math.min(def.harvestRate * dt, tile.oreAmount, def.cargoCapacity - h.cargo);
  tile.oreAmount -= take;
  h.cargo += take;
  if (h.cargo >= def.cargoCapacity) {
    h.harvestPhase = 'seekingRefinery';
    const refinery = findNearestRefinery(state, h);
    if (!refinery) {
      h.harvestPhase = 'idle'; // 没有矿场卸货
      return;
    }
    const spot = findUnloadSpot(state, h, refinery);
    if (spot) applyMove(state, h, spot.x, spot.y);
  }
}

function seekRefinery(state: GameState, h: EntityState): void {
  if (h.activity === 'moving') return;
  const refinery = findNearestRefinery(state, h);
  if (!refinery) {
    h.harvestPhase = 'idle';
    return;
  }
  if (isAdjacentToBuilding(state, h, refinery)) {
    h.harvestPhase = 'unloading';
    return;
  }
  const spot = findUnloadSpot(state, h, refinery);
  if (spot) applyMove(state, h, spot.x, spot.y);
}

function unload(state: GameState, h: EntityState): void {
  changeMoney(state, h.ownerId, h.cargo * ORE_UNIT_VALUE);
  h.cargo = 0;
  h.harvestPhase = 'seekingOre';
}

/** 找离采矿车最近的仍有矿的格子。 */
function findNearestOre(state: GameState, h: EntityState): GridPoint | null {
  let best: GridPoint | null = null;
  let bestD = Infinity;
  for (let y = 0; y < state.map.height; y++) {
    for (let x = 0; x < state.map.width; x++) {
      const tile = tileAt(state.map, x, y);
      if (!tile || tile.terrain !== 'ore' || tile.oreAmount <= 0) continue;
      const d = Math.max(Math.abs(x - h.tileX), Math.abs(y - h.tileY));
      if (d < bestD) {
        bestD = d;
        best = { x, y };
      }
    }
  }
  return best;
}

/** 找离采矿车最近的同阵营矿场。 */
function findNearestRefinery(state: GameState, h: EntityState): EntityState | null {
  let best: EntityState | null = null;
  let bestD = Infinity;
  for (const id of state.entitiesOrder) {
    const e = state.entities[id];
    if (!e || e.type !== 'building' || e.typeId !== 'refinery' || e.ownerId !== h.ownerId) continue;
    const d = Math.max(Math.abs(e.tileX - h.tileX), Math.abs(e.tileY - h.tileY));
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

/** 找矿场 footprint 外沿最近于采矿车的可走空闲格（卸货位）。 */
function findUnloadSpot(state: GameState, h: EntityState, refinery: EntityState): GridPoint | null {
  const def = state.buildingDefs[refinery.typeId];
  let best: GridPoint | null = null;
  let bestD = Infinity;
  for (let dy = -1; dy <= def.footprint.h; dy++) {
    for (let dx = -1; dx <= def.footprint.w; dx++) {
      const inside = dx >= 0 && dy >= 0 && dx < def.footprint.w && dy < def.footprint.h;
      if (inside) continue;
      const x = refinery.tileX + dx;
      const y = refinery.tileY + dy;
      const tile = tileAt(state.map, x, y);
      if (!tile || !tile.walkable) continue;
      if (tile.occupiedBy != null && tile.occupiedBy !== h.id) continue;
      const d = Math.max(Math.abs(x - h.tileX), Math.abs(y - h.tileY));
      if (d < bestD) {
        bestD = d;
        best = { x, y };
      }
    }
  }
  return best;
}

/** 采矿车是否紧挨着建筑的 footprint（切比雪夫距离 ≤ 1）。 */
function isAdjacentToBuilding(state: GameState, h: EntityState, e: EntityState): boolean {
  const def = state.buildingDefs[e.typeId];
  for (let dy = 0; dy < def.footprint.h; dy++) {
    for (let dx = 0; dx < def.footprint.w; dx++) {
      if (Math.max(Math.abs(h.tileX - (e.tileX + dx)), Math.abs(h.tileY - (e.tileY + dy))) <= 1) return true;
    }
  }
  return false;
}
