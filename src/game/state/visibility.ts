export const FOG_UNEXPLORED = 0;
export const FOG_EXPLORED = 1;
export const FOG_VISIBLE = 2;

export type Fog = typeof FOG_UNEXPLORED | typeof FOG_EXPLORED | typeof FOG_VISIBLE;

export interface VisibilityState {
  /** 每个玩家一张 width*height 的 Uint8Array，节省内存且比较快。 */
  perPlayer: Uint8Array[];
  /** 玩家 id → 0/1/2 的索引，避免 perPlayer 内重复 id 字段。 */
  playerIdToIndex: Map<number, number>;
}

export function createVisibility(width: number, height: number, playerIds: number[]): VisibilityState {
  const perPlayer = playerIds.map(() => new Uint8Array(width * height));
  const playerIdToIndex = new Map<number, number>();
  playerIds.forEach((id, i) => playerIdToIndex.set(id, i));
  return { perPlayer, playerIdToIndex };
}

export function getFog(state: VisibilityState, playerId: number, x: number, y: number, width: number): Fog {
  const idx = state.playerIdToIndex.get(playerId);
  if (idx === undefined) return FOG_UNEXPLORED;
  if (x < 0 || y < 0) return FOG_UNEXPLORED;
  return state.perPlayer[idx][y * width + x] as Fog;
}
