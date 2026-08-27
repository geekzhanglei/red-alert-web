import { GameState } from '../state/GameState';
import { EntityState, occupy, removeEntity } from '../state/entities';
import { ArmorType } from '../data/units';
import { WeaponDefinition } from '../data/units';
import { tileAt } from '../state/map';

/** 单位进入武器射程后自动接敌；主动攻击命令仍可追击射程外目标。 */
const AUTO_ACQUIRE_BUFFER = 0.1;

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
    if (!e) continue;
    const weapon = weaponOf(state, e);
    if (!weapon) continue; // 无武器单位（如采矿车）不参与战斗

    // 防御建筑没有移动指令：在射程内自动选择最近敌人，目标离开射程后重新搜索。
    if (e.type === 'building') {
      const current = e.attackTargetId == null ? null : state.entities[e.attackTargetId];
      if (!current || current.ownerId === e.ownerId || Math.hypot(current.x - e.x, current.y - e.y) > weapon.range + 0.1) {
        const target = findNearestEnemyInRange(state, e, weapon.range);
        e.attackTargetId = target?.id ?? null;
        e.activity = target ? 'attacking' : 'idle';
        e.command = target ? { type: 'attack', targetEntityId: target.id } : null;
      }
      if (e.attackTargetId == null) continue;
    }

    // 单位也会像红警中的警戒状态一样自动接敌：敌人进入武器射程就停下移动并锁定最近目标。
    // 这样坦克/步兵靠近后会自然互射，无需玩家逐个右键点名。
    if (e.type === 'unit' && e.attackTargetId == null && e.activity === 'idle') {
      const target = findNearestEnemyInRange(state, e, weapon.range + AUTO_ACQUIRE_BUFFER);
      if (target) {
        e.attackTargetId = target.id;
        e.command = { type: 'attack', targetEntityId: target.id };
        e.path = [];
        e.activity = 'attacking';
      }
    }

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
      if (e.type === 'building') {
        e.attackTargetId = null;
        e.activity = 'idle';
        e.command = null;
        continue;
      }
      chase(state, e, target, weapon.range, dt);
      continue;
    }

    if (e.reloadLeft > 0) {
      e.reloadLeft--;
      continue;
    }
    fire(state, e, target, weapon);
    e.reloadLeft = weapon.reloadTicks;
    e.activity = 'attacking';
  }
}

function weaponOf(state: GameState, e: EntityState): WeaponDefinition | undefined {
  return e.type === 'unit' ? state.defs[e.typeId].weapon : state.buildingDefs[e.typeId].weapon;
}

function findNearestEnemyInRange(state: GameState, source: EntityState, range: number): EntityState | null {
  const priority = source.type === 'unit' ? state.defs[source.typeId].targetPriority ?? [] : [];
  let best: EntityState | null = null;
  let bestPriority = Infinity;
  let bestDistance = Infinity;
  for (const id of state.entitiesOrder) {
    const target = state.entities[id];
    if (!target || target.ownerId === source.ownerId) continue;
    const distance = Math.hypot(target.x - source.x, target.y - source.y);
    if (distance > range + 0.1) continue;
    const armor = armorOf(state, target);
    const listedIndex = priority.indexOf(armor);
    const priorityIndex = priority.length === 0 ? 0 : listedIndex >= 0 ? listedIndex : priority.length;
    if (priorityIndex < bestPriority || (priorityIndex === bestPriority && distance < bestDistance)) {
      best = target;
      bestPriority = priorityIndex;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * 追入射程边缘时只沿一个逻辑轴移动。
 * 普通移动由四方向 A* 保证不斜走；战斗追击也必须遵守同一规则，不能因为直接追击又出现对角漂移。
 */
function chase(state: GameState, e: EntityState, target: EntityState, range: number, dt: number): void {
  const def = state.defs[e.typeId];
  const dx = target.x - e.x;
  const dy = target.y - e.y;
  const dist = Math.hypot(dx, dy);
  if (dist <= range) return;
  const moveX = Math.abs(dx) >= Math.abs(dy);
  const otherDelta = moveX ? Math.abs(dy) : Math.abs(dx);
  // 固定另一轴后，当前轴最多靠近到圆形射程边缘；这样最后不会冲进目标格。
  const maxAxisDelta = otherDelta >= range ? 0 : Math.sqrt(Math.max(0, range * range - otherDelta * otherDelta));
  const axisDelta = moveX ? Math.abs(dx) : Math.abs(dy);
  const reduction = Math.max(0, axisDelta - maxAxisDelta);
  const step = Math.min(def.speed * dt, reduction);
  if (step <= 0) return;

  const nextX = moveX ? e.x + Math.sign(dx) * step : e.x;
  const nextY = moveX ? e.y : e.y + Math.sign(dy) * step;
  const nextTile = tileAt(state.map, Math.floor(nextX), Math.floor(nextY));
  if (!nextTile || (nextTile.occupiedBy != null && nextTile.occupiedBy !== e.id)) return;
  e.x = nextX;
  e.y = nextY;
  e.facing = moveX ? (dx >= 0 ? 0 : Math.PI) : dy >= 0 ? Math.PI / 2 : -Math.PI / 2;
  updateChaseOccupancy(state, e);
}

function updateChaseOccupancy(state: GameState, e: EntityState): void {
  const tx = Math.floor(e.x);
  const ty = Math.floor(e.y);
  if (tx === e.tileX && ty === e.tileY) return;
  const old = tileAt(state.map, e.tileX, e.tileY);
  if (old && old.occupiedBy === e.id) old.occupiedBy = null;
  e.tileX = tx;
  e.tileY = ty;
  occupy(state, e, [{ x: tx, y: ty }]);
}

/** 命中即结算：伤害按装甲修正 × 攻击方升级倍率；hp ≤ 0 走统一死亡清理；同时产生瞬态弹道事件供渲染。 */
function fire(state: GameState, e: EntityState, target: EntityState, weapon: WeaponDefinition): void {
  const mod = weapon.modifiers[armorOf(state, target)] ?? 1;
  // 目标血量上限也吃升级倍率（用合成的有效 maxHp 推算）
  const tgtDef = target.type === 'building' ? state.buildingDefs[target.typeId] : state.defs[target.typeId];
  const effTargetMaxHp = tgtDef.maxHp * target.hpMultiplier;
  const damage = weapon.damage * mod * e.damageMultiplier;
  // 等比例缩放：hp / effMaxHp = hp - damage / defMaxHp
  const newHp = target.hp - damage * (tgtDef.maxHp / effTargetMaxHp);
  target.hp = Math.round(newHp);
  state.events.push({ type: 'shot', fromX: e.x, fromY: e.y, toX: target.x, toY: target.y, sourceTypeId: e.typeId });
  state.events.push({
    type: 'hit',
    targetId: target.id,
    targetOwnerId: target.ownerId,
    x: target.x,
    y: target.y,
    hpRatio: Math.max(0, Math.min(1, newHp / effTargetMaxHp)),
    targetTypeId: target.typeId,
  });
  if (target.hp <= 0) {
    state.events.push({
      type: 'destroy',
      targetId: target.id,
      targetOwnerId: target.ownerId,
      targetTypeId: target.typeId,
      x: target.x,
      y: target.y,
    });
    removeEntity(state, target.id);
  }
}
