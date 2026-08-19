import { GameState } from '../state/GameState';
import { FOG_EXPLORED, FOG_VISIBLE, VisibilityState } from '../state/visibility';

/**
 * 战争迷雾（docs/08-fog-minimap.md）：每 tick 累加每玩家可见性。
 * 顺序：先全部 VISIBLE 降级为 EXPLORED；再把己方有 visionRange 的实体周围画圆为 VISIBLE。
 * 不在可见性规则里加「不可见的敌人不参与战斗」——逻辑层永远按真实模拟跑，迷雾只挡眼睛。
 */
export function updateVisibility(state: GameState): void {
  const v = state.visibility;
  for (const arr of v.perPlayer) {
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] === FOG_VISIBLE) arr[i] = FOG_EXPLORED;
    }
  }
  for (let pid = 0; pid < state.players.length; pid++) {
    const arr = v.perPlayer[pid];
    for (const id of state.entitiesOrder) {
      const e = state.entities[id];
      if (!e || e.ownerId !== pid) continue;
      const range = visionRangeOf(state, e);
      paintDisc(arr, state.map.width, state.map.height, Math.floor(e.x), Math.floor(e.y), range, FOG_VISIBLE);
    }
  }
}

function visionRangeOf(state: GameState, e: import('../state/entities').EntityState): number {
  if (e.type === 'building') {
    // 建筑视野（基地/矿场/兵营/工厂）= 单位最高 vision × 1.5
    return 8;
  }
  return state.defs[e.typeId].visionRange;
}

function paintDisc(arr: Uint8Array, width: number, height: number, cx: number, cy: number, range: number, value: number): void {
  const r2 = range * range;
  const r = Math.ceil(range);
  const x0 = Math.max(0, cx - r);
  const x1 = Math.min(width - 1, cx + r);
  const y0 = Math.max(0, cy - r);
  const y1 = Math.min(height - 1, cy + r);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r2) arr[y * width + x] = value;
    }
  }
}
