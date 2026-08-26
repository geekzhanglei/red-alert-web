import type { GameState } from './GameState';
import type { BuildingDefinition } from '../data/buildings';

/**
 * 资金唯一写入口（docs/06-economy.md §A1）：除本模块外禁止直接读写 player.money。
 * 经济系统（systems/economy.ts）与命令系统（build 扣款）都通过这里操作资金。
 */
export function changeMoney(state: GameState, playerId: number, delta: number): void {
  const p = state.players[playerId];
  if (p) p.money += delta;
}

export function canAfford(state: GameState, playerId: number, cost: number): boolean {
  return (state.players[playerId]?.money ?? 0) >= cost;
}

/**
 * 从当前实体重新计算玩家的电力总账。
 *
 * 生产系统每 tick 都会把同样的结果写回 player，但放置预览和 build 命令
 * 可能发生在两次 tick 之间，因此这里不能只读缓存的 powerProduced/Consumed。
 */
export function getPowerTotals(state: GameState, playerId: number): { produced: number; consumed: number } {
  let produced = 0;
  let consumed = 0;
  for (const id of state.entitiesOrder) {
    const entity = state.entities[id];
    if (!entity || entity.type !== 'building' || entity.ownerId !== playerId) continue;
    const def = state.buildingDefs[entity.typeId];
    if (!def) continue;
    produced += def.powerProvided + entity.powerBonus;
    consumed += def.powerConsumed;
  }
  return { produced, consumed };
}

/**
 * 判断建造后电力是否仍可维持。
 * 发电厂等供电建筑允许在缺电时建造，用于恢复电网；耗电建筑则必须满足
 *「现有供电 + 新建筑供电 ≥ 现有消耗 + 新建筑消耗」。
 */
export function canSustainBuilding(
  state: GameState,
  playerId: number,
  def: Pick<BuildingDefinition, 'powerProvided' | 'powerConsumed'>,
): boolean {
  const totals = getPowerTotals(state, playerId);
  return totals.consumed + def.powerConsumed <= totals.produced + def.powerProvided;
}
