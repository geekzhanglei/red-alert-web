import { GameState } from '../state/GameState';
import { EntityState, removeEntity } from '../state/entities';
import { ArmorType } from '../data/units';

/** 取实体护甲类型：建筑查 buildingDefs，单位查 defs。 */
function armorOf(state: GameState, e: EntityState): ArmorType {
  if (e.type === 'building') return state.buildingDefs[e.typeId].armor;
  return state.defs[e.typeId].armor;
}

/**
 * 战斗系统（docs/05-combat.md）：
 * 有攻击目标的单位 → 追入射程 → 冷却开火（伤害结算即时，弹道只是渲染层动画）→ 目标死亡走 removeEntity。
 * 目标死亡/消失/不再是敌人时停下（本阶段先「停下」，不自动切换目标）。
 * 遍历用快照副本，避免 removeEntity 改写 entitiesOrder 时跳过元素。
 */
export function updateCombat(state: GameState, dt: number): void {
  for (const id of [...state.entitiesOrder]) {
    const e = state.entities[id];
    if (!e || e.type !== 'unit') continue;
    const weapon = state.defs[e.typeId].weapon;
    if (!weapon) continue; // 无武器单位（如采矿车）不参与战斗

    if (e.attackTargetId == null) {
      if (e.activity === 'attacking') {
        e.activity = 'idle';
        e.command = null;
      }
      continue;
    }

    const target = state.entities[e.attackTargetId];
    if (!target || target.ownerId === e.ownerId) {
      // 目标已死/消失或不再是敌人：停下
      e.attackTargetId = null;
      e.activity = 'idle';
      e.command = null;
      continue;
    }

    const dx = target.x - e.x;
    const dy = target.y - e.y;
    const dist = Math.hypot(dx, dy);

    if (dist > weapon.range + 0.1) {
      chase(state, e, target, weapon.range, dt);
      continue;
    }

    if (e.reloadLeft > 0) {
      e.reloadLeft--;
      continue;
    }
    fire(state, e, target);
    e.reloadLeft = weapon.reloadTicks;
    e.activity = 'attacking';
  }
}

/** 直线追入射程边缘（不寻路：战斗追击保持简单，寻路留给 move 命令）。 */
function chase(state: GameState, e: EntityState, target: EntityState, range: number, dt: number): void {
  const def = state.defs[e.typeId];
  const dx = target.x - e.x;
  const dy = target.y - e.y;
  const dist = Math.hypot(dx, dy);
  if (dist <= range) return;
  const step = Math.min(def.speed * dt, dist - range);
  e.x += (dx / dist) * step;
  e.y += (dy / dist) * step;
  e.facing = Math.atan2(dy, dx);
}

/** 命中即结算：伤害按装甲修正 × 攻击方升级倍率；hp ≤ 0 走统一死亡清理；同时产生瞬态弹道事件供渲染。 */
function fire(state: GameState, e: EntityState, target: EntityState): void {
  const weapon = state.defs[e.typeId].weapon!;
  const mod = weapon.modifiers[armorOf(state, target)] ?? 1;
  // 目标血量上限也吃升级倍率（用合成的有效 maxHp 推算）
  const tgtDef = target.type === 'building' ? state.buildingDefs[target.typeId] : state.defs[target.typeId];
  const effTargetMaxHp = tgtDef.maxHp * target.hpMultiplier;
  const damage = weapon.damage * mod * e.damageMultiplier;
  // 等比例缩放：hp / effMaxHp = hp - damage / defMaxHp
  const newHp = target.hp - damage * (tgtDef.maxHp / effTargetMaxHp);
  target.hp = Math.round(newHp);
  state.events.push({ type: 'shot', fromX: e.x, fromY: e.y, toX: target.x, toY: target.y });
  if (target.hp <= 0) removeEntity(state, target.id);
}
