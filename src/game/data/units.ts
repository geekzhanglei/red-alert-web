/** 装甲类型：伤害修正表的键。 */
export type ArmorType = 'light' | 'heavy' | 'structure';

export interface WeaponDefinition {
  damage: number;
  range: number;
  reloadTicks: number;
  /** 对不同装甲类型的伤害系数；缺省乘 1，加新装甲类型不用改战斗逻辑。 */
  modifiers: Partial<Record<ArmorType, number>>;
}

/** 单位静态定义（数据驱动）：数值在配置里，不在系统代码里（docs/01-architecture.md 决策三）。 */
export interface UnitDefinition {
  id: string;
  name: string;
  cost: number;
  buildTicks: number;
  maxHp: number;
  /** 移动速度，单位：格/秒。 */
  speed: number;
  armor: ArmorType;
  /** 无 weapon 的单位（如采矿车）不参与战斗。 */
  weapon?: WeaponDefinition;
  /** 采矿车载货上限（矿）。非采矿车为 0。 */
  cargoCapacity: number;
  /** 采矿速率：每秒采多少矿。非采矿车为 0。 */
  harvestRate: number;
  visionRange: number;
  footprint: { w: number; h: number };
  sprite: string;
}

export type UnitDefinitionMap = Record<string, UnitDefinition>;

export const UNIT_DEFINITIONS: UnitDefinitionMap = {
  infantry: {
    id: 'infantry',
    name: '步兵',
    cost: 100,
    buildTicks: 60,
    maxHp: 50,
    speed: 2.2,
    armor: 'light',
    weapon: { damage: 8, range: 2, reloadTicks: 30, modifiers: { light: 1, heavy: 0.5, structure: 0.25 } },
    cargoCapacity: 0,
    harvestRate: 0,
    visionRange: 6,
    footprint: { w: 1, h: 1 },
    sprite: 'infantry',
  },
  tank: {
    id: 'tank',
    name: '坦克',
    cost: 500,
    buildTicks: 120,
    maxHp: 120,
    speed: 1.6,
    armor: 'heavy',
    weapon: { damage: 15, range: 3, reloadTicks: 45, modifiers: { light: 0.75, heavy: 1, structure: 1.25 } },
    cargoCapacity: 0,
    harvestRate: 0,
    visionRange: 7,
    footprint: { w: 1, h: 1 },
    sprite: 'tank',
  },
  rocketTrooper: {
    id: 'rocketTrooper',
    name: '火箭兵',
    cost: 180,
    buildTicks: 90,
    maxHp: 55,
    speed: 1.9,
    armor: 'light',
    // 反装甲单位：对重甲有效，对步兵和建筑效率较低。
    weapon: { damage: 22, range: 3, reloadTicks: 50, modifiers: { light: 0.55, heavy: 1.5, structure: 0.45 } },
    cargoCapacity: 0,
    harvestRate: 0,
    visionRange: 6,
    footprint: { w: 1, h: 1 },
    sprite: 'rocketTrooper',
  },
  scout: {
    id: 'scout',
    name: '侦察车',
    cost: 300,
    buildTicks: 80,
    maxHp: 75,
    speed: 2.8,
    armor: 'light',
    // 速度和视野换取较低的火力，适合探路和追击步兵。
    weapon: { damage: 7, range: 3, reloadTicks: 20, modifiers: { light: 1.25, heavy: 0.35, structure: 0.1 } },
    cargoCapacity: 0,
    harvestRate: 0,
    visionRange: 10,
    footprint: { w: 1, h: 1 },
    sprite: 'scout',
  },
  artillery: {
    id: 'artillery',
    name: '自行火炮',
    cost: 800,
    buildTicks: 160,
    maxHp: 95,
    speed: 0.9,
    armor: 'heavy',
    // 远程攻城单位：射程长、装填慢，容易被近身单位克制。
    weapon: { damage: 40, range: 6, reloadTicks: 90, modifiers: { light: 1, heavy: 0.8, structure: 1.4 } },
    cargoCapacity: 0,
    harvestRate: 0,
    visionRange: 8,
    footprint: { w: 1, h: 1 },
    sprite: 'artillery',
  },
  heavyTank: {
    id: 'heavyTank',
    name: '重型坦克',
    cost: 1000,
    buildTicks: 190,
    maxHp: 220,
    speed: 1.05,
    armor: 'heavy',
    weapon: { damage: 25, range: 4, reloadTicks: 55, modifiers: { light: 0.9, heavy: 1, structure: 1.2 } },
    cargoCapacity: 0,
    harvestRate: 0,
    visionRange: 7,
    footprint: { w: 1, h: 1 },
    sprite: 'heavyTank',
  },
  harvester: {
    id: 'harvester',
    name: '采矿车',
    cost: 1400,
    buildTicks: 180,
    maxHp: 80,
    speed: 1.2,
    armor: 'light',
    cargoCapacity: 100,
    harvestRate: 12,
    visionRange: 5,
    footprint: { w: 1, h: 1 },
    sprite: 'harvester',
  },
};
