import type { GameState } from './GameState';
import type { UnitCommand } from './commands';
import type { GridPoint } from '../pathfinding/AStar';
import { tileAt } from './map';

/**
 * 运行中的实体状态：随 tick 变化，只有数据。
 * 定义侧数值（速度/血量等）一律通过 state.defs[typeId] 查询，不复制进状态。
 */
export interface EntityState {
  id: number;
  type: 'unit';
  typeId: string;
  ownerId: number;
  x: number;
  y: number;
  /** 本 tick 移动起点，供渲染层插值（docs/01-architecture.md 决策二）。 */
  prevX: number;
  prevY: number;
  /** 当前占用的格子（tileAt 的索引用），移动系统随位置更新。 */
  tileX: number;
  tileY: number;
  hp: number;
  /** 朝向，弧度（世界网格系，渲染时再映射到等距屏幕角）。 */
  facing: number;
  activity: 'idle' | 'moving';
  command: UnitCommand | null;
  /** 寻路航点（不含起点，含终点）；移动系统沿它推进。 */
  path: GridPoint[];
  reloadLeft: number;
}

export function spawnUnit(state: GameState, typeId: string, ownerId: number, x: number, y: number): EntityState {
  const def = state.defs[typeId];
  const id = state.nextEntityId++;
  const e: EntityState = {
    id,
    type: 'unit',
    typeId,
    ownerId,
    x,
    y,
    prevX: x,
    prevY: y,
    tileX: Math.floor(x),
    tileY: Math.floor(y),
    hp: def.maxHp,
    facing: -Math.PI / 2,
    activity: 'idle',
    command: null,
    path: [],
    reloadLeft: 0,
  };
  state.entities[id] = e;
  state.entitiesOrder.push(id);
  occupy(state, e, e.tileX, e.tileY);
  return e;
}

/** 让单位占用指定格；被占用的格会阻塞寻路（除非占用者是移动中的单位，见 commands.ts 的 canMoveTo）。 */
export function occupy(state: GameState, e: EntityState, x: number, y: number): void {
  const tile = tileAt(state.map, x, y);
  if (tile) tile.occupiedBy = e.id;
}
