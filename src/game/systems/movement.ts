import { GameState } from '../state/GameState';
import { EntityState, occupy } from '../state/entities';
import { tileAt } from '../state/map';
import { findPath } from '../pathfinding/AStar';

/** 单位位置变化后同步占格：离开旧格释放，进入新格占用。 */
function updateOccupancy(state: GameState, e: EntityState): void {
  const tx = Math.floor(e.x);
  const ty = Math.floor(e.y);
  if (tx === e.tileX && ty === e.tileY) return;
  const old = tileAt(state.map, e.tileX, e.tileY);
  if (old && old.occupiedBy === e.id) old.occupiedBy = null;
  e.tileX = tx;
  e.tileY = ty;
  occupy(state, e, [{ x: tx, y: ty }]);
}

/**
 * 移动系统：沿寻路航点（e.path）推进坐标。单位依次到达每个航点，走完最后一个后回 idle。
 * 遍历顺序固定走 entitiesOrder（决策四），到达阈值取 0.05 而非 0，避免浮点误差永远到不了。
 * 阶段二之前的直线移动已由「path 单航点=目标」覆盖，本系统只认路径。
 */
export function updateMovement(state: GameState, dt: number): void {
  // 本 tick 起点快照：所有单位（含 idle）统一保存，渲染插值才能平滑。
  for (const id of state.entitiesOrder) {
    const e = state.entities[id];
    if (e && e.type === 'unit') {
      e.prevX = e.x;
      e.prevY = e.y;
    }
  }

  for (const id of state.entitiesOrder) {
    const e = state.entities[id];
    if (!e || e.type !== 'unit' || e.activity !== 'moving') continue;
    const step = state.defs[e.typeId].speed * dt; // 速度单位：格/秒

    while (e.path.length > 0) {
      const wp = e.path[0];
      const dx = wp.x - e.x;
      const dy = wp.y - e.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 0.05) {
        if (!canEnterTile(state, e, wp.x, wp.y)) {
          if (replanMove(state, e)) continue;
          stopAtSafePosition(e);
          break;
        }
        // 到达当前航点
        e.x = wp.x;
        e.y = wp.y;
        e.path.shift();
        updateOccupancy(state, e);
        continue;
      }
      const moveDistance = Math.min(step, dist); // 防冲过头
      const nextX = e.x + (dx / dist) * moveDistance;
      const nextY = e.y + (dy / dist) * moveDistance;
      const nextTileX = Math.floor(nextX);
      const nextTileY = Math.floor(nextY);
      if (!canEnterTile(state, e, nextTileX, nextTileY)) {
        if (replanMove(state, e)) continue;
        stopAtSafePosition(e);
        break;
      }
      e.x = nextX;
      e.y = nextY;
      e.facing = Math.atan2(dy, dx);
      updateOccupancy(state, e);
      break;
    }

    if (e.path.length === 0) {
      e.activity = 'idle';
      e.command = null;
    }
  }
}

/** 移动推进时再次校验，防止路径生成后建筑落成/单位停下造成穿模。 */
function canEnterTile(state: GameState, e: EntityState, x: number, y: number): boolean {
  const tile = tileAt(state.map, x, y);
  if (!tile || !tile.walkable) return false;
  if (tile.occupiedBy == null || tile.occupiedBy === e.id) return true;
  const occupier = state.entities[tile.occupiedBy];
  // 移动中的单位允许短暂穿插；建筑和静止单位必须保持实体边界。
  return occupier?.type === 'unit' && occupier.activity === 'moving';
}

/** 路径中途失效时按原移动命令重新寻路，避免单位停在障碍边缘。 */
function replanMove(state: GameState, e: EntityState): boolean {
  const command = e.command;
  if (!command || command.type !== 'move') return false;
  const path = findPath(
    state.map,
    { x: e.tileX, y: e.tileY },
    { x: command.targetX, y: command.targetY },
    (x, y) => canEnterTile(state, e, x, y),
  );
  if (path.length === 0) return false;
  e.path = path;
  return true;
}

function stopAtSafePosition(e: EntityState): void {
  e.path = [];
  e.activity = 'idle';
  e.command = null;
}
