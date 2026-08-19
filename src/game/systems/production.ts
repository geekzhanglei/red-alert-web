import { GameState } from '../state/GameState';
import { EntityState, spawnUnit } from '../state/entities';
import { tileAt } from '../state/map';
import { GridPoint } from '../pathfinding/AStar';
import { changeMoney } from '../state/players';

/**
 * 阶段五·B：生产队列 + 电力结算（docs/06-economy.md §B）。
 * 每 tick 推进生产队列的 progressTicks，达到 buildTicks 后在建筑旁找可走格出单位；缺电时 buildTicks×2。
 * 电力结算：把每个玩家的全部建筑 powerProvided/Consumed 累加，存入 players[id].powerProduced/Consumed。
 * 训练/出兵属于经济操作，用 changeMoney 唯一写入口（与采矿卸货保持一致）。
 */
export function updateProduction(state: GameState): void {
  // 电力先结算一次（电力状态是本 tick 的输入，缺电影响生产推进）
  recomputePower(state);
  for (const id of [...state.entitiesOrder]) {
    const e = state.entities[id];
    if (!e || e.type !== 'building') continue;
    if (e.productionQueue.length === 0) {
      e.productionProgress = 0;
      continue;
    }
    const producingId = e.productionQueue[0];
    const def = state.defs[producingId];
    if (!def) {
      e.productionQueue.shift();
      continue;
    }
    const player = state.players[e.ownerId];
    const powerShort = player.powerConsumed > player.powerProduced;
    const ticks = def.buildTicks * (powerShort ? 2 : 1);
    e.productionProgress = Math.min(ticks, e.productionProgress + 1);
    if (e.productionProgress >= ticks) {
      // 出生点被堵住时保持队列和完成进度，等下一个 tick 重试，不能静默丢兵。
      if (trySpawn(state, e, producingId)) {
        e.productionQueue.shift();
        e.productionProgress = 0;
      }
    }
  }
}

/** 累加玩家所有建筑电力，写入 players[i].powerProduced/Consumed。 */
export function recomputePower(state: GameState): void {
  for (const p of state.players) {
    p.powerProduced = 0;
    p.powerConsumed = 0;
  }
  for (const id of state.entitiesOrder) {
    const e = state.entities[id];
    if (!e || e.type !== 'building') continue;
    const def = state.buildingDefs[e.typeId];
    const p = state.players[e.ownerId];
    if (!p || !def) continue;
    p.powerProduced += def.powerProvided;
    p.powerConsumed += def.powerConsumed;
  }
}

/** 在建筑 footprint 外沿找最近的可走空闲格生产单位。 */
function trySpawn(state: GameState, e: EntityState, unitTypeId: string): boolean {
  const def = state.buildingDefs[e.typeId];
  const spot = findSpawnSpot(state, e, def.footprint.w, def.footprint.h);
  if (!spot) return false;
  spawnUnit(state, unitTypeId, e.ownerId, spot.x + 0.5, spot.y + 0.5);
  return true;
}

function findSpawnSpot(state: GameState, e: EntityState, w: number, h: number): GridPoint | null {
  // 按出生成核：相对建筑中心向「下」方向偏一格的 footprint 外侧可走格
  // 简单做法：从 footprint 外圈往内、每格只取一次
  let best: GridPoint | null = null;
  let bestD = Infinity;
  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      const inside = dx >= 0 && dy >= 0 && dx < w && dy < h;
      if (inside) continue;
      const x = e.tileX + dx;
      const y = e.tileY + dy;
      const tile = tileAt(state.map, x, y);
      if (!tile || !tile.walkable) continue;
      if (tile.occupiedBy != null) continue;
      // 出生点偏好「下方」格，让单位看着像走出建筑
      const d = Math.abs(x - e.x) + Math.abs(y - (e.y + h / 2 + 1)) * 2;
      if (d < bestD) {
        bestD = d;
        best = { x, y };
      }
    }
  }
  return best;
}

/** 玩家手点「训练步兵」：入队即扣钱。建筑必须能产该单位。 */
export function enqueueTrain(state: GameState, buildingId: number, playerId: number, unitTypeId: string): boolean {
  const b = state.entities[buildingId];
  if (!b || b.type !== 'building' || b.ownerId !== playerId) return false;
  const def = state.buildingDefs[b.typeId];
  if (!def.produces.includes(unitTypeId)) return false;
  const unitDef = state.defs[unitTypeId];
  if (!unitDef) return false;
  const player = state.players[playerId];
  if (player.money < unitDef.cost) return false;
  changeMoney(state, playerId, -unitDef.cost);
  b.productionQueue.push(unitTypeId);
  return true;
}
