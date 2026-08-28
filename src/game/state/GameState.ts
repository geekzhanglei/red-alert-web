import { MapState, DEFAULT_MAP_WIDTH, DEFAULT_MAP_HEIGHT, generateMap, tileAt } from './map';
import { UNIT_DEFINITIONS, UnitDefinitionMap } from '../data/units';
import { BUILDING_DEFINITIONS, BuildingDefinitionMap } from '../data/buildings';
import { EntityState, spawnUnit, spawnBuilding } from './entities';
import { GameCommand } from './commands';
import { createVisibility, VisibilityState } from './visibility';

/** 瞬态渲染事件：系统在 tick 内产生，渲染层读取后清空；不参与回放/存档。 */
export type GameEvent =
  | { type: 'shot'; fromX: number; fromY: number; toX: number; toY: number; sourceTypeId?: string }
  | {
      type: 'hit';
      targetId: number;
      targetOwnerId: number;
      x: number;
      y: number;
      hpRatio: number;
      targetTypeId?: string;
    }
  | { type: 'destroy'; targetId: number; targetOwnerId: number; x: number; y: number; targetTypeId?: string };

/** 玩家资源状态：资金由经济系统唯一写入口修改（docs/06-economy.md §A1）。 */
export interface PlayerState {
  id: number;
  money: number;
  powerProduced: number; // 阶段五·B：由各电力建筑贡献
  powerConsumed: number; // 阶段五·B：由各建筑消耗
}

/** AI 战略状态属于可回放/可存档的逻辑状态，不能放在模块级缓存中。 */
export interface AiBrainState {
  state: 'develop' | 'buildUp' | 'attack' | 'defend';
  nextThinkTick: number;
  attackThreshold: number;
  buildIndex: number;
  threatThreshold: number;
  lastRepairTick: number;
}

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
  /** 建筑定义表（数据驱动），运行期只读。 */
  buildingDefs: BuildingDefinitionMap;
  players: PlayerState[];
  aiBrains: Record<number, AiBrainState>;
  nextEntityId: number;
  /** 实体表；迭代一律走 entitiesOrder，保证顺序稳定（决策四）。 */
  entities: Record<number, EntityState>;
  entitiesOrder: number[];
  /** 当前选中的实体 id（输入层维护，不参与逻辑演算）。 */
  selectedEntityIds: number[];
  /** 1~9 号玩家编队（每个 id 是一组实体 id；空槽未定义）。Ctrl+数字保存，数字复读。 */
  squads: Record<number, number[]>;
  /** 待应用命令队列：输入层入队，每个 tick 由命令系统统一消费。 */
  pendingCommands: GameCommand[];
  /** 命令日志（tick + 命令），存档/回放的地基（docs/09-save-replay.md）。 */
  commandLog: { tick: number; command: GameCommand }[];
  /** 瞬态渲染事件（如开火弹道），渲染层读取后清空。 */
  events: GameEvent[];
  /** 战争迷雾：每玩家一张 Uint8Array。 */
  visibility: VisibilityState;
  /** 难度（影响双方起始资金 + AI 节奏）。 */
  difficulty: Difficulty;
  /** 胜负状态：false=进行中；true=已结束，winner 是胜者 playerId 或 'draw'。 */
  /** 双方基地都曾建立后才进入可判定状态，避免单元测试/沙盒局被误判结束。 */
  victoryArmed: boolean;
  gameOver: boolean;
  winner: number | 'draw' | null;
}

export interface GameOptions {
  width?: number;
  height?: number;
  seed?: number;
  /** 是否生成开发期测试布局；未传时使用红警式 MCV 开局，false 表示空状态。 */
  testUnits?: boolean;
  /** 难度：影响双方起始资金 + AI 出兵节奏。 */
  difficulty?: Difficulty;
}

export type Difficulty = 'easy' | 'normal' | 'hard';

/**
 * 难度调参：平衡点来自普通（默认）；简单给玩家更多资金和缓冲，困难把 AI 缩到更短出招。
 * 注意：AIStrategicPeriod 等内部常量当前仍按默认实现，本表作为预留；将来给 AI 传 difficulty 即可微调。
 */
const DIFFICULTY_PROFILE: Record<Difficulty, { playerMoney: number; enemyMoney: number }> = {
  easy: { playerMoney: 8000, enemyMoney: 2000 },
  normal: { playerMoney: 5000, enemyMoney: 3000 },
  hard: { playerMoney: 4000, enemyMoney: 5000 },
};

/** 固定默认种子便于开发期复现；建新局时可以传任意 seed（会随存档记录）。 */
export const DEFAULT_SEED = 20260818;

/** 人类玩家 id；AI 阶段会给电脑分配不同的 playerId。 */
export const PLAYER_ID = 0;

export const ENEMY_ID = 1;

export function createInitialGameState(options?: GameOptions): GameState {
  const width = options?.width ?? DEFAULT_MAP_WIDTH;
  const height = options?.height ?? DEFAULT_MAP_HEIGHT;
  const seed = options?.seed ?? DEFAULT_SEED;
  const playerIds = [0, 1];
  const profile = DIFFICULTY_PROFILE[options?.difficulty ?? 'normal'];
  const state: GameState = {
    tick: 0,
    seed,
    map: generateMap(width, height, seed),
    defs: UNIT_DEFINITIONS,
    buildingDefs: BUILDING_DEFINITIONS,
    players: [
      { id: 0, money: profile.playerMoney, powerProduced: 0, powerConsumed: 0 },
      { id: 1, money: profile.enemyMoney, powerProduced: 0, powerConsumed: 0 },
    ],
    difficulty: options?.difficulty ?? 'normal',
    aiBrains: {},
    nextEntityId: 1,
    entities: {},
    entitiesOrder: [],
    selectedEntityIds: [],
    squads: {},
    pendingCommands: [],
    commandLog: [],
    events: [],
    visibility: createVisibility(width, height, playerIds),
    victoryArmed: false,
    gameOver: false,
    winner: null, // null = 进行中；游戏未结束前不会读这个值
  };
  if (options?.testUnits === true) spawnDebugSetup(state);
  else if (options?.testUnits !== false) spawnClassicSetup(state);
  return state;
}

/**
 * 红警式遭遇战开局：双方各自拥有一辆可部署的 MCV 和一组护卫部队。
 * 基地、矿场和采矿车不预先放置，玩家需要先部署 MCV，再按科技/电力顺序发展。
 */
function spawnClassicSetup(state: GameState): void {
  const baseSpot = findBuildableSpot(state.map, 3, 3, 28, 18)!;
  spawnUnit(state, 'mcv', 0, baseSpot.x + 1, baseSpot.y + 1);
  spawnStarterGroup(state, 0, baseSpot, ['tank', 'tank', 'infantry', 'infantry', 'infantry']);
  // 矿脉落在未来矿场候选点附近，部署后建矿场即可立即开始经济循环。
  const refSpot = findBuildableSpot(state.map, 2, 2, 27, 22);
  if (refSpot) seedStarterOreField(state.map, refSpot.x - 4, refSpot.y + 2);

  const enemyBase = findBuildableSpot(state.map, 3, 3, 36, 30)!;
  spawnUnit(state, 'mcv', 1, enemyBase.x + 1, enemyBase.y + 1);
  spawnStarterGroup(state, 1, enemyBase, ['tank', 'infantry', 'infantry']);
}

/** 开发期沙盒布局：保留建筑和矿车，方便系统/美术调试，不作为正式开局。 */
function spawnDebugSetup(state: GameState): void {
  const baseSpot = findBuildableSpot(state.map, 3, 3, 28, 18)!;
  spawnBuilding(state, 'base', 0, baseSpot.x, baseSpot.y);
  const refSpot = findBuildableSpot(state.map, 2, 2, 27, 22)!;
  spawnBuilding(state, 'refinery', 0, refSpot.x, refSpot.y);
  const harvSpot = findAdjacentFreeSpot(state.map, refSpot.x, refSpot.y, 2, 2, 26, 23)!;
  spawnUnit(state, 'harvester', 0, harvSpot.x, harvSpot.y);
  seedStarterOreField(state.map, refSpot.x - 4, refSpot.y + 2);

  spawnUnit(state, 'tank', 0, 30, 30);
  spawnUnit(state, 'tank', 0, 32, 30);
  spawnUnit(state, 'infantry', 0, 30, 33);
  spawnUnit(state, 'infantry', 0, 32, 33);
  spawnUnit(state, 'infantry', 0, 34, 32);

  const enemyBase = findBuildableSpot(state.map, 3, 3, 36, 30)!;
  spawnBuilding(state, 'base', 1, enemyBase.x, enemyBase.y);
  spawnUnit(state, 'infantry', 1, 38, 32);
  spawnUnit(state, 'tank', 1, 41, 34);
  spawnUnit(state, 'infantry', 1, 39, 37);
}

function spawnStarterGroup(
  state: GameState,
  ownerId: number,
  baseSpot: { x: number; y: number },
  types: string[],
): void {
  const offsets = [
    { x: 3, y: 0 }, { x: 0, y: 3 }, { x: 3, y: 3 },
    { x: 4, y: 1 }, { x: 1, y: 4 }, { x: 5, y: 2 },
  ];
  for (let i = 0; i < types.length; i++) {
    const offset = offsets[i] ?? { x: 3 + i, y: 3 };
    const spot = findAdjacentFreeSpot(
      state.map,
      baseSpot.x,
      baseSpot.y,
      3,
      3,
      baseSpot.x + offset.x,
      baseSpot.y + offset.y,
    );
    if (spot) spawnUnit(state, types[i], ownerId, spot.x, spot.y);
  }
}

/** 在玩家矿场附近放置一片稳定可见的黄金矿脉，避免随机地图开局只有零散或不可见矿点。 */
function seedStarterOreField(map: MapState, nearX: number, nearY: number): void {
  const spot = findBuildableSpot(map, 3, 3, nearX, nearY);
  if (!spot) return;
  const offsets = [
    { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 },
    { x: 1, y: 2 }, { x: 0, y: 2 }, { x: 2, y: 0 },
  ];
  for (const offset of offsets) {
    const tile = tileAt(map, spot.x + offset.x, spot.y + offset.y);
    if (!tile || tile.occupiedBy != null) continue;
    tile.terrain = 'ore';
    tile.walkable = true;
    tile.buildable = false;
    tile.oreAmount = 1000;
  }
}

/** 从 near 点向外螺旋找一块 w×h 全 buildable 的区域。 */
export function findBuildableSpot(map: MapState, w: number, h: number, nearX: number, nearY: number): { x: number; y: number } | null {
  for (let ring = 0; ring < 40; ring++) {
    for (let dy = -ring; dy <= ring; dy++) {
      for (let dx = -ring; dx <= ring; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        const x = nearX + dx;
        const y = nearY + dy;
        if (isBuildableBlock(map, x, y, w, h)) return { x, y };
      }
    }
  }
  return null;
}

function isBuildableBlock(map: MapState, x: number, y: number, w: number, h: number): boolean {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const tile = tileAt(map, x + dx, y + dy);
      if (!tile || !tile.buildable || tile.occupiedBy != null) return false;
    }
  }
  return true;
}

/** 找 footprint 外沿最近于 (nearX, nearY) 的可走空闲格（用于采矿车出生点等）。 */
function findAdjacentFreeSpot(
  map: MapState,
  bx: number,
  by: number,
  w: number,
  h: number,
  nearX: number,
  nearY: number,
): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  let bestD = Infinity;
  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      const inside = dx >= 0 && dy >= 0 && dx < w && dy < h;
      if (inside) continue;
      const x = bx + dx;
      const y = by + dy;
      const tile = tileAt(map, x, y);
      if (!tile || !tile.walkable || tile.occupiedBy != null) continue;
      const d = Math.max(Math.abs(x - nearX), Math.abs(y - nearY));
      if (d < bestD) {
        bestD = d;
        best = { x, y };
      }
    }
  }
  return best;
}
