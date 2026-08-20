import { GameState } from '../state/GameState';
import { EntityState } from '../state/entities';

/**
 * 应用升级效果（docs/10-selection-panel.md）。
 * 升级只动实体（不污染数据驱动配置 def），其他系统按「def + 实体偏移」合成实际值。
 * 单位：伤害 ×1.5、hp ×1.5（当前 hp 等比例增加）、hp 渲染倍率。
 * 建筑 base：解锁 tank + 电力 +25。
 * 建筑其他：hp ×1.5 + 解锁一个现有未生产的单位。
 */
export function applyUpgrade(state: GameState, e: EntityState): void {
  if (e.type === 'unit') {
    e.damageMultiplier = 1.5;
    const def = state.defs[e.typeId];
    const oldMax = def.maxHp;
    e.hpMultiplier = 1.5;
    // 当前 hp 按 (oldMax → newMax) 比例增加，避免"升级瞬间血满"不平衡
    e.hp = Math.round(e.hp + (oldMax * 0.5));
    return;
  }
  // 建筑
  const def = state.buildingDefs[e.typeId];
  e.hpMultiplier = 1.5;
  const oldMax = def.maxHp;
  e.hp = Math.round(e.hp + (oldMax * 0.5));
  if (e.typeId === 'base') {
    if (!e.producesExtra.includes('tank')) e.producesExtra.push('tank');
    e.powerBonus = 25;
    return;
  }
  // 其他建筑：解锁一个 existing but not-yet-produced unit
  const candidates = ['infantry', 'tank', 'harvester'].filter(
    (u) => !def.produces.includes(u) && !e.producesExtra.includes(u) && state.defs[u],
  );
  if (candidates.length > 0) e.producesExtra.push(candidates[0]);
}
