import type { GameState } from './GameState';
import type { EntityState } from './entities';
import { removeEntity, spawnBuilding } from './entities';
import { findPath } from '../pathfinding/AStar';
import { tileAt } from './map';
import { canAfford, canSustainBuilding, changeMoney } from './players';
import { BUILDING_REQUIREMENTS } from '../data/buildings';
import type { BuildingDefinition } from '../data/buildings';
import { enqueueTrain } from '../systems/production';
import { applyUpgrade } from '../systems/upgrade';

/** 升级费用：原造价 ×50%，最低 100（base 造价 0 时也需实付）。 */
export function upgradeCost(state: GameState, e: EntityState): number {
  if (e.type === 'building') return Math.max(100, Math.floor(state.buildingDefs[e.typeId].cost * 0.5));
  return Math.max(100, Math.floor(state.defs[e.typeId].cost * 0.5));
}

/**
 * 玩家的操作统一编码成命令（docs/01-architecture.md 决策四）。
 * 带 playerId：谁发起的命令，回放/联网按「玩家 → tick → 命令」对齐（docs/09-save-replay.md）。
 */
export type GameCommand =
  | { type: 'move'; playerId: number; entityId: number; targetX: number; targetY: number }
  | { type: 'attack'; playerId: number; entityId: number; targetEntityId: number }
  | { type: 'deploy'; playerId: number; entityId: number }
  | { type: 'build'; playerId: number; buildingTypeId: string; x: number; y: number }
  | { type: 'train'; playerId: number; buildingId: number; unitTypeId: string }
  | { type: 'upgrade'; playerId: number; entityId: number }
  | { type: 'stop'; playerId: number; entityId: number };

/**
 * 挂在实体上的「当前命令」：不含 entityId/playerId（所属实体隐含）。
 * 由命令系统在应用 GameCommand 时写入 e.command。
 */
export type UnitCommand =
  | { type: 'move'; targetX: number; targetY: number }
  | { type: 'attack'; targetEntityId: number }
  | { type: 'stop' };

/**
 * 寻路通行规则：不可走格被挡；被「静止单位/建筑」占用的格也被挡。
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

/** 建筑放置校验：footprint 全部可建且未被占用（越界返回 false）。 */
export function canPlace(state: GameState, x: number, y: number, def: BuildingDefinition): boolean {
  for (let dy = 0; dy < def.footprint.h; dy++) {
    for (let dx = 0; dx < def.footprint.w; dx++) {
      const tile = tileAt(state.map, x + dx, y + dy);
      if (!tile || !tile.buildable || tile.occupiedBy != null) return false;
    }
  }
  return true;
}

/**
 * 把本 tick 入队的命令应用到实体（命令处理是每 tick 的第一个系统，顺序见架构文档 §7）。
 * 入队时不改状态，统一在这里应用，保证命令有确定的应用时机。
 * move 命令在这里计算 A* 路径存入 e.path——寻路是逻辑层的确定演算，回放重演命令即得一致路径。
 */
export function processCommands(state: GameState): void {
  for (const cmd of state.pendingCommands) {
    switch (cmd.type) {
      case 'move': {
        const e = state.entities[cmd.entityId];
        if (!e || e.type !== 'unit') break;
        e.attackTargetId = null; // 移动打断攻击
        applyMove(state, e, cmd.targetX, cmd.targetY);
        break;
      }
      case 'attack': {
        const e = state.entities[cmd.entityId];
        if (!e || (e.type !== 'unit' && e.type !== 'building')) break;
        const target = state.entities[cmd.targetEntityId];
        const valid =
          target && (target.type === 'unit' || target.type === 'building') && target.ownerId !== e.ownerId;
        if (valid) {
          e.command = { type: 'attack', targetEntityId: cmd.targetEntityId };
          e.attackTargetId = cmd.targetEntityId; // 攻击打断移动
          e.path = [];
          e.activity = 'attacking';
        } else {
          e.command = null;
          e.attackTargetId = null;
          e.path = [];
          e.activity = 'idle';
        }
        break;
      }
      case 'deploy': {
        const e = state.entities[cmd.entityId];
        if (!e || e.type !== 'unit' || e.typeId !== 'mcv' || e.ownerId !== cmd.playerId) break;
        const baseDef = state.buildingDefs.base;
        const x = e.tileX - Math.floor(baseDef.footprint.w / 2);
        const y = e.tileY - Math.floor(baseDef.footprint.h / 2);
        if (!canDeployBase(state, e, x, y)) break;
        const base = spawnBuilding(state, 'base', cmd.playerId, x, y);
        removeEntity(state, e.id);
        if (cmd.playerId === 0) state.selectedEntityIds = [base.id];
        break;
      }
      case 'build': {
        const def = state.buildingDefs[cmd.buildingTypeId];
        const ownerId = cmd.playerId;
        if (!def) break;
        if (cmd.buildingTypeId === 'base') break; // 主基地只能由 MCV 部署
        const requirements = BUILDING_REQUIREMENTS[cmd.buildingTypeId] ?? [];
        if (!requirements.every((required) => hasOwnedBuilding(state, ownerId, required))) break;
        if (!canAfford(state, ownerId, def.cost)) break; // 钱不够
        if (!canSustainBuilding(state, ownerId, def)) break; // 电力不足
        if (!canPlace(state, cmd.x, cmd.y, def)) break; // 放不下（重叠/水上/越界）
        changeMoney(state, ownerId, -def.cost);
        spawnBuilding(state, cmd.buildingTypeId, ownerId, cmd.x, cmd.y, { grantHarvester: cmd.buildingTypeId === 'refinery' });
        break;
      }
      case 'train':
        enqueueTrain(state, cmd.buildingId, cmd.playerId, cmd.unitTypeId);
        break;
      case 'upgrade': {
        // 升级原子：canAfford → changeMoney → 标记 → 应用效果
        const e = state.entities[cmd.entityId];
        if (!e) break;
        if (e.ownerId !== cmd.playerId) break; // 跨阵营
        if (e.upgraded) break; // 已升过
        const cost = upgradeCost(state, e);
        if (!canAfford(state, cmd.playerId, cost)) break;
        changeMoney(state, cmd.playerId, -cost);
        e.upgraded = true;
        applyUpgrade(state, e);
        break;
      }
      case 'stop': {
        const e = state.entities[cmd.entityId];
        if (!e || e.type !== 'unit') break;
        e.command = { type: 'stop' };
        e.attackTargetId = null;
        e.path = [];
        e.activity = 'idle';
        break;
      }
    }
    state.commandLog.push({ tick: state.tick, command: cmd });
  }
  state.pendingCommands = [];
}

function hasOwnedBuilding(state: GameState, ownerId: number, typeId: string): boolean {
  return state.entitiesOrder.some((id) => {
    const entity = state.entities[id];
    return entity?.type === 'building' && entity.ownerId === ownerId && entity.typeId === typeId;
  });
}

/** MCV 部署允许覆盖它自身占用的那一格，其余基地 footprint 必须为空且可建。 */
function canDeployBase(state: GameState, mcv: EntityState, x: number, y: number): boolean {
  const def = state.buildingDefs.base;
  for (let dy = 0; dy < def.footprint.h; dy++) {
    for (let dx = 0; dx < def.footprint.w; dx++) {
      const tile = tileAt(state.map, x + dx, y + dy);
      if (!tile || !tile.buildable) return false;
      if (tile.occupiedBy != null && tile.occupiedBy !== mcv.id) return false;
    }
  }
  return true;
}

/** 应用 move：算 A* 路径存入 e.path。不可达/已在目标则静止。经济系统的采矿车寻路也复用本函数。 */
export function applyMove(state: GameState, e: EntityState, targetX: number, targetY: number): void {
  const path = findPath(
    state.map,
    { x: e.tileX, y: e.tileY },
    { x: targetX, y: targetY },
    (x, y) => canMoveTo(state, e, x, y),
  );
  if (path.length === 0) {
    e.command = null;
    e.path = [];
    e.activity = 'idle';
  } else {
    e.command = { type: 'move', targetX, targetY };
    e.path = path;
    e.activity = 'moving';
  }
}
