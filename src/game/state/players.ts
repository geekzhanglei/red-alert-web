import type { GameState } from './GameState';

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
