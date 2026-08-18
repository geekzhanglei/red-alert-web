import type { GameState } from './GameState';
import type { EntityState } from './entities';
import { findPath } from '../pathfinding/AStar';
import { tileAt } from './map';

/**
 * 玩家的操作统一编码成命令（docs/01-architecture.md 决策四）。
 * 带 playerId：谁发起的命令，回放/联网按「玩家 → tick → 命令」对齐（docs/09-save-replay.md）。
 * 后续阶段追加 'attack'（阶段四）、'build'/'train'（阶段五）。
 */
export type GameCommand =
  | { type: 'move'; playerId: number; entityId: number; targetX: number; targetY: number }
  | { type: 'stop'; playerId: number; entityId: number };

/**
 * 挂在实体上的「当前命令」：不含 entityId/playerId（所属实体隐含）。
 * 由命令系统在应用 GameCommand 时写入 e.command。
 */
export type UnitCommand =
  | { type: 'move'; targetX: number; targetY: number }
  | { type: 'stop' };

/**
 * 寻路通行规则：不可走格被挡；被「静止单位」占用的格也被挡。
 * 移动中的单位不阻塞——否则多个单位相向而行会互相堵死（第一版允许短暂重叠）。
 */
function canMoveTo(state: GameState, e: EntityState, x: number, y: number): boolean {
  const tile = tileAt(state.map, x, y);
  if (!tile || !tile.walkable) return false;
  if (tile.occupiedBy == null) return true;
  if (tile.occupiedBy === e.id) return true;
  const occupier = state.entities[tile.occupiedBy];
  if (occupier && occupier.type === 'unit' && occupier.activity === 'moving') return true;
  return false;
}

/**
 * 把本 tick 入队的命令应用到实体（命令处理是每 tick 的第一个系统，顺序见架构文档 §7）。
 * 入队时不改状态，统一在这里应用，保证命令有确定的应用时机。
 * move 命令在这里计算 A* 路径存入 e.path——寻路是逻辑层的确定演算，回放重演命令即得一致路径。
 */
export function processCommands(state: GameState): void {
  for (const cmd of state.pendingCommands) {
    const e = state.entities[cmd.entityId];
    if (!e || e.type !== 'unit') continue;
    switch (cmd.type) {
      case 'move': {
        const path = findPath(
          state.map,
          { x: e.tileX, y: e.tileY },
          { x: cmd.targetX, y: cmd.targetY },
          (x, y) => canMoveTo(state, e, x, y),
        );
        if (path.length === 0) {
          // 已在目标格或不可达：保持静止（文档：不可达停在原地/返回 idle，不死循环）
          e.command = null;
          e.path = [];
          e.activity = 'idle';
        } else {
          e.command = { type: 'move', targetX: cmd.targetX, targetY: cmd.targetY };
          e.path = path;
          e.activity = 'moving';
        }
        break;
      }
      case 'stop':
        e.command = { type: 'stop' };
        e.path = [];
        e.activity = 'idle';
        break;
    }
    state.commandLog.push({ tick: state.tick, command: cmd });
  }
  state.pendingCommands = [];
}
