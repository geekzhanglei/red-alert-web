import { ArmorType, WeaponDefinition } from './units';

/** 建筑静态定义（数据驱动）。 */
export interface BuildingDefinition {
  id: string;
  name: string;
  cost: number;
  buildTicks: number;
  maxHp: number;
  armor: ArmorType;
  footprint: { w: number; h: number };
  /** 阶段五·B：电力产出/消耗。缺电时生产速度减半（docs/06-economy.md §B2）。 */
  powerProvided: number;
  powerConsumed: number;
  /** 自动防御建筑的武器；普通建筑不设置。 */
  weapon?: WeaponDefinition;
  /** 覆盖默认建筑视野（如雷达站）。 */
  visionRange?: number;
  /** 该建筑可生产的单位类型 id 列表。空数组 = 不生产（如基地只提供电力）。 */
  produces: string[];
  sprite: string;
}

export type BuildingDefinitionMap = Record<string, BuildingDefinition>;

export const BUILDING_DEFINITIONS: BuildingDefinitionMap = {
  base: {
    id: 'base',
    name: '基地',
    cost: 0,
    buildTicks: 0,
    maxHp: 1000,
    armor: 'structure',
    footprint: { w: 3, h: 3 },
    powerProvided: 50,
    powerConsumed: 0,
    produces: ['harvester'],
    sprite: 'base',
  },
  refinery: {
    id: 'refinery',
    name: '矿场',
    cost: 2000,
    buildTicks: 120,
    maxHp: 600,
    armor: 'structure',
    footprint: { w: 2, h: 2 },
    powerProvided: 0,
    powerConsumed: 15,
    produces: [],
    sprite: 'refinery',
  },
  barracks: {
    id: 'barracks',
    name: '兵营',
    cost: 500,
    buildTicks: 100,
    maxHp: 400,
    armor: 'structure',
    footprint: { w: 2, h: 2 },
    powerProvided: 0,
    powerConsumed: 20,
    produces: ['infantry', 'rocketTrooper'],
    sprite: 'barracks',
  },
  factory: {
    id: 'factory',
    name: '战车工厂',
    cost: 2000,
    buildTicks: 200,
    maxHp: 700,
    armor: 'structure',
    footprint: { w: 3, h: 3 },
    powerProvided: 0,
    powerConsumed: 50,
    produces: ['tank', 'scout', 'artillery', 'heavyTank'],
    sprite: 'factory',
  },
  powerPlant: {
    id: 'powerPlant',
    name: '发电厂',
    cost: 800,
    buildTicks: 100,
    maxHp: 450,
    armor: 'structure',
    footprint: { w: 2, h: 2 },
    powerProvided: 100,
    powerConsumed: 0,
    produces: [],
    sprite: 'powerPlant',
  },
  guardTower: {
    id: 'guardTower',
    name: '警戒塔',
    cost: 700,
    buildTicks: 110,
    maxHp: 500,
    armor: 'heavy',
    footprint: { w: 2, h: 2 },
    powerProvided: 0,
    powerConsumed: 30,
    weapon: { damage: 14, range: 6, reloadTicks: 40, modifiers: { light: 1.25, heavy: 0.6, structure: 0.5 } },
    produces: [],
    sprite: 'guardTower',
  },
  radar: {
    id: 'radar',
    name: '雷达站',
    cost: 1200,
    buildTicks: 150,
    maxHp: 500,
    armor: 'structure',
    footprint: { w: 2, h: 2 },
    powerProvided: 0,
    powerConsumed: 45,
    visionRange: 14,
    produces: [],
    sprite: 'radar',
  },
};
