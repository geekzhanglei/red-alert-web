import { GameState, PlayerState } from './GameState';
import { FOG_EXPLORED, FOG_UNEXPLORED, FOG_VISIBLE } from './visibility';

/**
 * 存档/序列化（docs/09-save-replay.md）。
 * GameState 必须是纯数据（架构决策一），所以可以直接 JSON.stringify。
 * Uint8Array 走 Array.from，避免跨平台序列化差异；commands 走 commandLog 即可。
 */

export const SAVE_VERSION = 1;

export interface SerializedState {
  v: typeof SAVE_VERSION;
  state: ReturnType<typeof toPlain>;
}

export function serialize(state: GameState): string {
  return JSON.stringify({ v: SAVE_VERSION, state: toPlain(state) } satisfies SerializedState);
}

export function deserialize(json: string): GameState {
  const obj = JSON.parse(json) as SerializedState;
  if (obj.v !== SAVE_VERSION) {
    throw new Error(`存档版本 ${obj.v} 过旧，当前版本 ${SAVE_VERSION}`);
  }
  return fromPlain(obj.state);
}

/** 复刻：GameState 当前所有字段（纯数据），按可 JSON 化形式输出。 */
function toPlain(state: GameState) {
  return {
    tick: state.tick,
    seed: state.seed,
    map: {
      width: state.map.width,
      height: state.map.height,
      seed: state.map.seed,
      tiles: state.map.tiles.map((t) => ({
        terrain: t.terrain,
        walkable: t.walkable,
        buildable: t.buildable,
        oreAmount: t.oreAmount,
        occupiedBy: t.occupiedBy,
      })),
    },
    players: state.players.map((p) => ({ ...p })),
    aiBrains: Object.fromEntries(
      Object.entries(state.aiBrains).map(([id, brain]) => [id, { ...brain }]),
    ),
    nextEntityId: state.nextEntityId,
    entities: Object.fromEntries(
      state.entitiesOrder.map((id) => [
        String(id),
        serializeEntity(state.entities[id]),
      ]),
    ),
    entitiesOrder: [...state.entitiesOrder],
    selectedEntityIds: [...state.selectedEntityIds],
    squads: Object.fromEntries(Object.entries(state.squads).map(([k, v]) => [k, [...v]])),
    pendingCommands: [],
    commandLog: state.commandLog.map((l) => ({ tick: l.tick, command: l.command })),
    events: [],
    visibility: {
      perPlayer: state.visibility.perPlayer.map((arr) => Array.from(arr)),
      // playerIdToIndex 重新从 players 推：0,1,2… 顺序固定
    },
    victoryArmed: state.victoryArmed,
    gameOver: state.gameOver,
    winner: state.winner,
    difficulty: state.difficulty,
  };
}

function serializeEntity(e: GameState['entities'][number] | undefined) {
  if (!e) return null;
  return {
    id: e.id,
    type: e.type,
    typeId: e.typeId,
    ownerId: e.ownerId,
    x: e.x,
    y: e.y,
    prevX: e.prevX,
    prevY: e.prevY,
    tileX: e.tileX,
    tileY: e.tileY,
    occupiedTiles: e.occupiedTiles.map((t) => ({ x: t.x, y: t.y })),
    hp: e.hp,
    facing: e.facing,
    activity: e.activity,
    attackTargetId: e.attackTargetId,
    command: e.command,
    path: e.path,
    reloadLeft: e.reloadLeft,
    cargo: e.cargo,
    harvestPhase: e.harvestPhase,
    productionQueue: [...e.productionQueue],
    productionProgress: e.productionProgress,
    upgraded: e.upgraded,
    producesExtra: [...e.producesExtra],
    powerBonus: e.powerBonus,
    damageMultiplier: e.damageMultiplier,
    hpMultiplier: e.hpMultiplier,
  };
}

function fromPlain(p: ReturnType<typeof toPlain>): GameState {
  const players: PlayerState[] = p.players.map((pl) => ({ ...pl }));
  const map = {
    width: p.map.width,
    height: p.map.height,
    seed: p.map.seed,
    tiles: p.map.tiles.map((t) => ({ ...t, occupiedBy: t.occupiedBy })),
  };
  const entities: GameState['entities'] = {};
  for (const [k, v] of Object.entries(p.entities)) {
    if (!v) continue;
    const id = Number(k);
    entities[id] = {
      ...v,
      command: v.command,
      path: v.path,
      occupiedTiles: v.occupiedTiles,
      productionQueue: v.productionQueue,
    };
  }
  return {
    tick: p.tick,
    seed: p.seed,
    map,
    defs: UNIT_DEFS_SNAPSHOT, // 单位定义从代码注入，不在存档里
    buildingDefs: BUILDING_DEFS_SNAPSHOT,
    players,
    aiBrains: Object.fromEntries(
      Object.entries(p.aiBrains ?? {}).map(([id, brain]) => [Number(id), { ...brain }]),
    ),
    nextEntityId: p.nextEntityId,
    entities,
    entitiesOrder: [...p.entitiesOrder],
    selectedEntityIds: [...p.selectedEntityIds],
    squads: Object.fromEntries(Object.entries(p.squads ?? {}).map(([k, v]: [string, number[]]) => [Number(k), [...v]])),
    pendingCommands: [],
    commandLog: p.commandLog.map((l) => ({ tick: l.tick, command: l.command })),
    events: [],
    visibility: {
      perPlayer: p.visibility.perPlayer.map((arr) => Uint8Array.from(arr)),
      playerIdToIndex: new Map(players.map((pl, i) => [pl.id, i])),
    },
    victoryArmed: p.victoryArmed ?? false,
    gameOver: p.gameOver,
    winner: p.winner,
    difficulty: p.difficulty,
  };
}

// 重新引入定义（与 data/* 同源；通过快照避免循环 import）
import { UNIT_DEFINITIONS, UnitDefinitionMap } from '../data/units';
import { BUILDING_DEFINITIONS, BuildingDefinitionMap } from '../data/buildings';
const UNIT_DEFS_SNAPSHOT: UnitDefinitionMap = UNIT_DEFINITIONS;
const BUILDING_DEFS_SNAPSHOT: BuildingDefinitionMap = BUILDING_DEFINITIONS;

export { FOG_UNEXPLORED, FOG_EXPLORED, FOG_VISIBLE };
