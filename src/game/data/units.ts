/** 单位静态定义（数据驱动）：数值在配置里，不在系统代码里（docs/01-architecture.md 决策三）。 */
export interface UnitDefinition {
  id: string;
  name: string;
  cost: number;
  buildTicks: number;
  maxHp: number;
  /** 移动速度，单位：格/秒。 */
  speed: number;
  attackDamage: number;
  attackRange: number;
  reloadTicks: number;
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
    attackDamage: 5,
    attackRange: 2,
    reloadTicks: 30,
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
    attackDamage: 12,
    attackRange: 3,
    reloadTicks: 45,
    visionRange: 7,
    footprint: { w: 1, h: 1 },
    sprite: 'tank',
  },
};
