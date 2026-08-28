import { AiBrainState, GameState } from '../state/GameState';
import { EntityState } from '../state/entities';
import { canAfford, canSustainBuilding } from '../state/players';
import { BUILDING_REQUIREMENTS } from '../data/buildings';
import { GridPoint } from '../pathfinding/AStar';
import { tileAt } from '../state/map';

/**
 * 敌方 AI（docs/07-ai.md）：战略/战术两层 FSM。
 * 战略层每 N tick 醒一次：基于 buildOrder 造建筑、攒兵；兵力到阈值转 attack。
 * 战术层：attack 组集结→向最近敌方建筑/基地进发，defense 组回防受袭点。
 * AI 只发命令入队，不直接改状态（与人类玩家走同一条路径，回放天然一致）。
 */

const AI_PLAYER_ID = 1;
const STRATEGIC_PERIOD = 30; // 战略层每 30 tick 醒一次（约 1.5 秒）
/**
 * 经典遭遇战科技顺序：先把 MCV 变成主基地，再接通电网、矿场和兵营，
 * 最后才进入防御/战车/雷达阶段。第二座电厂提前补上，避免工厂和防御设施因缺电卡死。
 */
const DEFAULT_BUILD_ORDER = [
  { typeId: 'powerPlant', minCount: 1 },
  { typeId: 'refinery', minCount: 1 },
  { typeId: 'barracks', minCount: 1 },
  { typeId: 'powerPlant', minCount: 2 },
  { typeId: 'guardTower', minCount: 1 },
  { typeId: 'factory', minCount: 1 },
  { typeId: 'radar', minCount: 1 },
] as const;

/** 难度对 AI 节奏的微调：简单让 AI 慢、迟钝；困难让 AI 更快、阈值更低。 */
const DIFFICULTY_AI: Record<string, { nextThinkTick: number; attackThreshold: number; threatThreshold: number }> = {
  easy: { nextThinkTick: 120, attackThreshold: 8, threatThreshold: 6 },
  normal: { nextThinkTick: 60, attackThreshold: 4, threatThreshold: 3 },
  hard: { nextThinkTick: 30, attackThreshold: 2, threatThreshold: 2 },
};

function getBrain(state: GameState, playerId: number): AiBrainState {
  let b = state.aiBrains[playerId];
  if (!b) {
    const profile = DIFFICULTY_AI[state.difficulty] ?? DIFFICULTY_AI.normal;
    b = {
      state: 'develop',
      nextThinkTick: profile.nextThinkTick,
      attackThreshold: profile.attackThreshold,
      buildIndex: 0,
      threatThreshold: profile.threatThreshold,
      lastRepairTick: 0,
    };
    state.aiBrains[playerId] = b;
  }
  return b;
}

/** 全部 AI 玩家（除玩家 0 以外）走战略/战术。 */
export function updateAi(state: GameState): void {
  for (let pid = 1; pid < state.players.length; pid++) {
    const brain = getBrain(state, pid);
    if (state.tick < brain.nextThinkTick) continue;
    brain.nextThinkTick = state.tick + STRATEGIC_PERIOD;
    strategicThink(state, brain, pid);
  }
  // 战术层：每 tick 推进 attack/defend 组的攻击/移动
  tacticalAct(state);
}

function strategicThink(state: GameState, brain: AiBrainState, pid: number): void {
  // 没有主基地时，AI 只能先寻找并部署 MCV，不能跳过开局直接造建筑/出兵。
  if (!ensureBaseDeployment(state, pid)) return;
  // 1) 受袭检测：己方建筑在挨打 → 转 defend
  if (anyBuildingUnderAttack(state, pid)) {
    brain.state = 'defend';
  }
  // 2) 兵力评估
  const myAttackUnits = countAttackUnits(state, pid);
  // 3) 受袭恢复 develop（敌人被赶走或建筑血量恢复）
  if (brain.state === 'defend' && !anyBuildingUnderAttack(state, pid)) {
    brain.state = myAttackUnits >= brain.attackThreshold ? 'buildUp' : 'develop';
  }
  // 4) 建筑建造（按 buildOrder）
  ensureBuildingConstruction(state, brain, pid);
  // 5) 有生产建筑就持续补充单位；训练也走 pendingCommands，保证回放一致。
  ensureUnitProduction(state, pid);
  // 6) 兵力攒到阈值转 buildUp，再集结一些
  if (brain.state === 'develop' && myAttackUnits >= brain.attackThreshold) {
    brain.state = 'buildUp';
  }
  if (brain.state === 'buildUp' && myAttackUnits >= brain.attackThreshold + 2) {
    brain.state = 'attack';
  }
  // 7) 进攻：给 attack 单位指派目标
  if (brain.state === 'attack') {
    const target = findAttackTarget(state, pid);
    if (target) {
      for (const e of state.entitiesOrder.map((id) => state.entities[id])) {
        if (e && e.type === 'unit' && e.ownerId === pid && state.defs[e.typeId].weapon) {
          state.pendingCommands.push({ type: 'attack', playerId: pid, entityId: e.id, targetEntityId: target.id });
        }
      }
      // 一波打出去后回到 develop
      brain.state = 'develop';
      brain.attackThreshold += 2; // 下一波更大
      brain.buildIndex = 0;
    }
  }
}

function ensureUnitProduction(state: GameState, pid: number): void {
  for (const id of state.entitiesOrder) {
    const b = state.entities[id];
    if (!b || b.type !== 'building' || b.ownerId !== pid) continue;
    const produces = state.buildingDefs[b.typeId]?.produces ?? [];
    if (produces.length === 0 || b.productionQueue.length >= 2) continue;
    const alreadyQueued = state.pendingCommands.some(
      (cmd) => cmd.type === 'train' && cmd.buildingId === b.id,
    );
    if (alreadyQueued) continue;
    // 战车工厂首辆矿车可作为经济补充；有矿车后优先排队战斗单位，避免 AI 永远只造矿车。
    const harvesterCount = state.entitiesOrder.filter((eid) => {
      const entity = state.entities[eid];
      return entity?.type === 'unit' && entity.ownerId === pid && entity.typeId === 'harvester';
    }).length;
    const refineryCount = state.entitiesOrder.filter((eid) => {
      const entity = state.entities[eid];
      return entity?.type === 'building' && entity.ownerId === pid && entity.typeId === 'refinery';
    }).length;
    const unitTypeId = harvesterCount < refineryCount
      ? (produces.includes('harvester') ? 'harvester' : produces[0])
      : (produces.find((unitId) => unitId !== 'harvester') ?? produces[0]);
    if (canAfford(state, pid, state.defs[unitTypeId]?.cost ?? Infinity)) {
      state.pendingCommands.push({ type: 'train', playerId: pid, buildingId: b.id, unitTypeId });
    }
  }
}

function tacticalAct(state: GameState): void {
  for (let pid = 1; pid < state.players.length; pid++) {
    const brain = getBrain(state, pid);
    // Step 1 反制：AI 视野内玩家单位 ≥ 阈值 → 立即派所有 idle 战斗单位迎击
    const enemiesInView = countEnemyUnitsInView(state, pid);
    if (enemiesInView >= brain.threatThreshold) {
      // 找视野内最近的玩家单位作为攻击目标
      const target = findNearestEnemyInView(state, pid);
      if (target) {
        for (const e of state.entitiesOrder.map((id) => state.entities[id])) {
          if (
            e &&
            e.type === 'unit' &&
            e.ownerId === pid &&
            state.defs[e.typeId].weapon &&
            e.activity === 'idle'
          ) {
            state.pendingCommands.push({ type: 'attack', playerId: pid, entityId: e.id, targetEntityId: target.id });
          }
        }
      }
      // 持续受威胁：让 brain 走出 develop → attack 状态
      if (brain.state === 'develop' || brain.state === 'buildUp') brain.state = 'attack';
    }

    // 原来的「己方建筑受袭 → 回防」逻辑保留
    if (anyBuildingUnderAttack(state, pid)) {
      const attacker = findNearestEnemyToOwnBuildings(state, pid);
      if (attacker) {
        for (const e of state.entitiesOrder.map((id) => state.entities[id])) {
          if (
            e &&
            e.type === 'unit' &&
            e.ownerId === pid &&
            state.defs[e.typeId].weapon &&
            e.attackTargetId == null &&
            e.activity === 'idle'
          ) {
            state.pendingCommands.push({ type: 'attack', playerId: pid, entityId: e.id, targetEntityId: attacker.id });
          }
        }
      }
    }
  }
}

function ensureBuildingConstruction(state: GameState, brain: AiBrainState, pid: number): void {
  while (brain.buildIndex < DEFAULT_BUILD_ORDER.length) {
    const item = DEFAULT_BUILD_ORDER[brain.buildIndex];
    const def = state.buildingDefs[item.typeId];
    if (!def) {
      brain.buildIndex++;
      continue;
    }
    if (countBuildings(state, pid, item.typeId) >= item.minCount) {
      brain.buildIndex++;
      continue;
    }
    // AI 也走和玩家相同的科技树与电网校验；命令尚未消费时不要重复排队。
    if (!(BUILDING_REQUIREMENTS[item.typeId] ?? []).every((required) => hasBuilding(state, pid, required))) return;
    if (state.pendingCommands.some(
      (cmd) => cmd.type === 'build' && cmd.playerId === pid && cmd.buildingTypeId === item.typeId,
    )) return;
    if (!canAfford(state, pid, def.cost)) return; // 钱不够，下次再试
    if (!canSustainBuilding(state, pid, def)) return; // 电网不足，下次先补发电厂
    const spot = findBuildSpot(state, def.footprint.w, def.footprint.h, findPlayerCenter(state, pid));
    if (!spot) {
      // 找不到位置（围死/地形塞满），跳过这一项
      brain.buildIndex++;
      continue;
    }
    state.pendingCommands.push({ type: 'build', playerId: pid, buildingTypeId: item.typeId, x: spot.x, y: spot.y });
    brain.buildIndex++;
    return; // 一个 tick 放一个，避免一次花光钱
  }
}

function ensureBaseDeployment(state: GameState, pid: number): boolean {
  if (hasBuilding(state, pid, 'base')) return true;
  const mcv = state.entitiesOrder
    .map((id) => state.entities[id])
    .find((entity) => entity?.type === 'unit' && entity.ownerId === pid && entity.typeId === 'mcv');
  if (!mcv) return false;
  const alreadyQueued = state.pendingCommands.some(
    (cmd) => cmd.type === 'deploy' && cmd.playerId === pid && cmd.entityId === mcv.id,
  );
  if (!alreadyQueued) state.pendingCommands.push({ type: 'deploy', playerId: pid, entityId: mcv.id });
  return false;
}

function countAttackUnits(state: GameState, pid: number): number {
  let n = 0;
  for (const id of state.entitiesOrder) {
    const e = state.entities[id];
    if (e && e.type === 'unit' && e.ownerId === pid && state.defs[e.typeId].weapon) n++;
  }
  return n;
}

function hasBuilding(state: GameState, pid: number, typeId: string): boolean {
  for (const id of state.entitiesOrder) {
    const e = state.entities[id];
    if (e && e.type === 'building' && e.typeId === typeId && e.ownerId === pid) return true;
  }
  return false;
}

function countBuildings(state: GameState, pid: number, typeId: string): number {
  let count = 0;
  for (const id of state.entitiesOrder) {
    const e = state.entities[id];
    if (e && e.type === 'building' && e.typeId === typeId && e.ownerId === pid) count++;
  }
  return count;
}

function anyBuildingUnderAttack(state: GameState, pid: number): boolean {
  for (const id of state.entitiesOrder) {
    const e = state.entities[id];
    if (!e || e.type !== 'building' || e.ownerId !== pid) continue;
    const def = state.buildingDefs[e.typeId];
    if (e.hp < def.maxHp) return true;
  }
  return false;
}

function findAttackTarget(state: GameState, pid: number): EntityState | null {
  let best: EntityState | null = null;
  let bestD = Infinity;
  const myCenter = findPlayerCenter(state, pid);
  for (const id of state.entitiesOrder) {
    const e = state.entities[id];
    if (!e || e.ownerId === pid) continue;
    if (e.type !== 'building' && e.type !== 'unit') continue;
    const d = Math.max(Math.abs(e.tileX - myCenter.x), Math.abs(e.tileY - myCenter.y));
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

function findNearestEnemyToOwnBuildings(state: GameState, pid: number): EntityState | null {
  let best: EntityState | null = null;
  let bestD = Infinity;
  for (const id of state.entitiesOrder) {
    const e = state.entities[id];
    if (!e || e.ownerId === pid) continue;
    if (e.type !== 'unit') continue;
    for (const bid of state.entitiesOrder) {
      const b = state.entities[bid];
      if (!b || b.type !== 'building' || b.ownerId !== pid) continue;
      const d = Math.max(Math.abs(e.tileX - b.tileX), Math.abs(e.tileY - b.tileY));
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
  }
  return best;
}

function findPlayerCenter(state: GameState, pid: number): GridPoint {
  let sx = 0, sy = 0, n = 0;
  for (const id of state.entitiesOrder) {
    const e = state.entities[id];
    if (e && e.ownerId === pid) {
      sx += e.tileX;
      sy += e.tileY;
      n++;
    }
  }
  if (n === 0) return { x: 0, y: 0 };
  return { x: Math.round(sx / n), y: Math.round(sy / n) };
}

/** 在玩家中心附近找可建 spot（4 方向外扩）。 */
export function findBuildSpot(
  state: GameState,
  w: number,
  h: number,
  near: GridPoint,
): GridPoint | null {
  for (let ring = 0; ring < 40; ring++) {
    for (let dy = -ring; dy <= ring; dy++) {
      for (let dx = -ring; dx <= ring; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        const x = near.x + dx;
        const y = near.y + dy;
        if (isBuildableBlock(state, x, y, w, h)) return { x, y };
      }
    }
  }
  return null;
}

function isBuildableBlock(state: GameState, x: number, y: number, w: number, h: number): boolean {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const tile = tileAt(state.map, x + dx, y + dy);
      if (!tile || !tile.buildable || tile.occupiedBy != null) return false;
    }
  }
  return true;
}

/** 视野内敌人单位数（每帧都查；O(n) 足够了，规模大了再上空间索引）。 */
function countEnemyUnitsInView(state: GameState, pid: number): number {
  const myIdx = state.visibility.playerIdToIndex.get(pid);
  if (myIdx === undefined) return 0;
  const fog = state.visibility.perPlayer[myIdx];
  const w = state.map.width;
  let n = 0;
  for (const eid of state.entitiesOrder) {
    const e = state.entities[eid];
    if (!e || e.type !== 'unit' || e.ownerId === pid) continue;
    const idx = e.tileY * w + e.tileX;
    // 仅 FOG_VISIBLE(2) 才算「看见」
    if ((fog[idx] ?? 0) >= 2) n++;
  }
  return n;
}

function findNearestEnemyInView(state: GameState, pid: number): EntityState | null {
  const myIdx = state.visibility.playerIdToIndex.get(pid);
  if (myIdx === undefined) return null;
  const fog = state.visibility.perPlayer[myIdx];
  const w = state.map.width;
  const myCenter = findPlayerCenter(state, pid);
  let best: EntityState | null = null;
  let bestD = Infinity;
  for (const eid of state.entitiesOrder) {
    const e = state.entities[eid];
    if (!e || e.ownerId === pid) continue;
    if ((fog[e.tileY * w + e.tileX] ?? 0) < 2) continue;
    const d = Math.max(Math.abs(e.tileX - myCenter.x), Math.abs(e.tileY - myCenter.y));
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

/**
 * 修理系统（Step 1 简化版）：受削血建筑每 60 tick 自愈 5% maxHp，不依赖维修单位。
 * 经济允许时 AI 还会指挥「维修单位」回防，但本阶段先做最便宜的版本。
 */
const REPAIR_PERIOD_TICKS = 60;
const REPAIR_RATIO = 0.05;

export function updateRepair(state: GameState): void {
  for (let pid = 1; pid < state.players.length; pid++) {
    const brain = getBrain(state, pid);
    if (state.tick - brain.lastRepairTick < REPAIR_PERIOD_TICKS) continue;
    brain.lastRepairTick = state.tick;
    for (const eid of state.entitiesOrder) {
      const e = state.entities[eid];
      if (!e || e.type !== 'building' || e.ownerId !== pid) continue;
      const def = state.buildingDefs[e.typeId];
      if (e.hp >= def.maxHp) continue;
      e.hp = Math.min(def.maxHp, e.hp + Math.ceil(def.maxHp * REPAIR_RATIO));
    }
  }
}
