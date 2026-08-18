import { MapState, DEFAULT_MAP_WIDTH, DEFAULT_MAP_HEIGHT, generateMap } from './map';
import { UNIT_DEFINITIONS, UnitDefinitionMap } from '../data/units';
import { EntityState, spawnUnit } from './entities';
import { GameCommand } from './commands';

/**
 * 全项目唯一的状态容器：核心系统只读写它，渲染层只读它。
 * 必须保持「纯数据」——不含任何 Phaser/DOM 引用，否则存档序列化会被卡住（见 docs/01-architecture.md）。
 */
export interface GameState {
  tick: number;
  seed: number;
  map: MapState;
  /** 单位定义表（数据驱动），运行期只读。 */
  defs: UnitDefinitionMap;
  nextEntityId: number;
  /** 实体表；迭代一律走 entitiesOrder，保证顺序稳定（决策四）。 */
  entities: Record<number, EntityState>;
  entitiesOrder: number[];
  /** 当前选中的实体 id（输入层维护，不参与逻辑演算）。 */
  selectedEntityIds: number[];
  /** 待应用命令队列：输入层入队，每个 tick 由命令系统统一消费。 */
  pendingCommands: GameCommand[];
  /** 命令日志（tick + 命令），存档/回放的地基（docs/09-save-replay.md）。 */
  commandLog: { tick: number; command: GameCommand }[];
}

export interface GameOptions {
  width?: number;
  height?: number;
  seed?: number;
  /** 是否生成开发期测试部队，默认 true。 */
  testUnits?: boolean;
}

/** 固定默认种子便于开发期复现；建新局时可以传任意 seed（会随存档记录）。 */
export const DEFAULT_SEED = 20260818;

/** 人类玩家 id；AI 阶段会给电脑分配不同的 playerId。 */
export const PLAYER_ID = 0;

export function createInitialGameState(options?: GameOptions): GameState {
  const width = options?.width ?? DEFAULT_MAP_WIDTH;
  const height = options?.height ?? DEFAULT_MAP_HEIGHT;
  const seed = options?.seed ?? DEFAULT_SEED;
  const state: GameState = {
    tick: 0,
    seed,
    map: generateMap(width, height, seed),
    defs: UNIT_DEFINITIONS,
    nextEntityId: 1,
    entities: {},
    entitiesOrder: [],
    selectedEntityIds: [],
    pendingCommands: [],
    commandLog: [],
  };
  if (options?.testUnits !== false) spawnTestUnits(state);
  return state;
}

/** 开发期测试部队：固定坐标（确定性），让地图上有可操作的单位。坐标已对照 DEFAULT_SEED 确认全部可走。 */
function spawnTestUnits(state: GameState): void {
  spawnUnit(state, 'tank', 0, 30, 30);
  spawnUnit(state, 'tank', 0, 32, 30);
  spawnUnit(state, 'infantry', 0, 30, 33);
  spawnUnit(state, 'infantry', 0, 32, 33);
  spawnUnit(state, 'infantry', 0, 34, 32);
}
