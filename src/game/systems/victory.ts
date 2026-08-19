import { GameState } from '../state/GameState';
import { EntityState } from '../state/entities';

/**
 * 胜负判定（Step 1）：一方的 base 建筑被摧毁 或 同时失去所有单位+建筑=败。
 * 双方同 tick 触发记平局。
 * 结果写入 state.gameOver / state.winner（playerId 0/1，或 'draw'），后续 tick 直接跳过。
 */
export type GameResult = 'ongoing' | 'draw' | number;

export function checkVictory(state: GameState): GameResult {
  if (state.gameOver) return state.winner ?? 'ongoing'; // 已结束，幂等
  if (!state.victoryArmed) return 'ongoing';
  const alive = state.players.map((p) => hasBaseOrUnit(state, p.id));
  const p0 = alive[0];
  const p1 = alive[1];
  if (!p0 && !p1) return finish(state, 'draw');
  if (!p0) return finish(state, 1);
  if (!p1) return finish(state, 0);
  return 'ongoing';
}

function hasBaseOrUnit(state: GameState, pid: number): boolean {
  for (const id of state.entitiesOrder) {
    const e = state.entities[id];
    if (!e || e.ownerId !== pid) continue;
    if (e.type === 'unit') return true;
    if (e.type === 'building' && e.typeId === 'base') return true;
  }
  return false;
}

function finish(state: GameState, result: 'draw' | number): GameResult {
  state.gameOver = true;
  state.winner = result;
  return result;
}

/** Game 编排入口（Step 1 之后可以挪到 systems/ 调度里）。 */
export function updateVictory(state: GameState): void {
  checkVictory(state);
}

// 占位：避免 ts 报未使用
export type _EntityStateAlias = EntityState;
