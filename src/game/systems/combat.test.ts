import { describe, expect, it } from 'vitest';
import { TICK_MS } from '../core/GameLoop';
import { Game } from '../core/Game';
import { createInitialGameState } from '../state/GameState';
import { spawnBuilding, spawnUnit } from '../state/entities';
import { updateCombat } from './combat';

function countShots(state: import('../state/GameState').GameState): number {
  return state.events.filter((ev) => ev.type === 'shot').length;
}

function makePair(attackerType: string, defenderType: string, dx = 1, dy = 0) {
  const game = new Game(createInitialGameState({ testUnits: false }));
  const a = spawnUnit(game.state, attackerType, 0, 10, 10);
  const d = spawnUnit(game.state, defenderType, 1, 10 + dx, 10 + dy);
  return { game, a, d };
}

describe('战斗系统', () => {
  it('目标在射程外时先追入射程再开火', () => {
    const { game, a, d } = makePair('infantry', 'infantry', 4, 0); // 距离 4，步兵射程 2
    game.state.pendingCommands.push({ type: 'attack', playerId: 0, entityId: a.id, targetEntityId: d.id });
    for (let i = 0; i < 60; i++) game.update(TICK_MS);
    expect(countShots(game.state)).toBeGreaterThan(0);
    expect(Math.hypot(d.x - a.x, d.y - a.y)).toBeLessThanOrEqual(2.2); // 停在射程边缘
  });

  it('战斗追击也只沿单一坐标轴移动，不产生斜向位移', () => {
    const { game, a, d } = makePair('tank', 'infantry', 4, 3);
    a.attackTargetId = d.id;
    a.activity = 'attacking';
    const before = { x: a.x, y: a.y };

    updateCombat(game.state, TICK_MS / 1000);

    expect(a.x === before.x || a.y === before.y).toBe(true);
  });

  it('不同作战单位使用各自的攻击力', () => {
    const damage = (attackerType: string): number => {
      const { game, a, d } = makePair(attackerType, 'infantry');
      a.attackTargetId = d.id;
      a.activity = 'attacking';
      updateCombat(game.state, TICK_MS / 1000);
      return 50 - d.hp;
    };

    const values = ['infantry', 'tank', 'rocketTrooper', 'scout', 'artillery', 'heavyTank'].map(damage);
    expect(new Set(values).size).toBe(values.length);
    expect(damage('artillery')).toBeGreaterThan(damage('infantry'));
    expect(damage('rocketTrooper')).toBeGreaterThan(damage('scout'));
  });

  it('攻击有冷却：按 reloadTicks 节奏开火', () => {
    const { game, a, d } = makePair('infantry', 'infantry', 1, 0); // 射程内
    // 只让 a 负责本用例的射击节奏；d 保持可被攻击但暂不装填开火。
    d.reloadLeft = 999;
    game.state.pendingCommands.push({ type: 'attack', playerId: 0, entityId: a.id, targetEntityId: d.id });
    for (let i = 0; i < 100; i++) game.update(TICK_MS);
    const shots = countShots(game.state);
    expect(shots).toBeGreaterThanOrEqual(3); // 30 tick 一发的节奏
    expect(shots).toBeLessThanOrEqual(5);
    expect(d.hp).toBeLessThan(50);
  });

  it('敌我单位进入射程后会自动互相锁定并开火', () => {
    const { game, a, d } = makePair('tank', 'infantry', 2, 0);

    game.update(TICK_MS);

    expect(a.attackTargetId).toBe(d.id);
    expect(d.attackTargetId).toBe(a.id);
    expect(a.activity).toBe('attacking');
    expect(d.activity).toBe('attacking');
    expect(d.hp).toBeLessThan(game.state.defs.infantry.maxHp);
    expect(a.hp).toBeLessThan(game.state.defs.tank.maxHp);
    expect(countShots(game.state)).toBe(2);
  });

  it('移动中的单位进入射程后会停下自动接敌', () => {
    const { game, a, d } = makePair('tank', 'infantry', 2, 0);
    a.activity = 'moving';
    a.path = [{ x: d.x, y: d.y }];

    updateCombat(game.state, TICK_MS / 1000);

    expect(a.attackTargetId).toBe(d.id);
    expect(a.activity).toBe('attacking');
    expect(a.path).toEqual([]);
  });

  it('战斗追击不会穿过不可走地形', () => {
    const { game, a, d } = makePair('tank', 'infantry', 4, 0);
    const water = game.state.map.tiles[10 * game.state.map.width + 11];
    water.terrain = 'water';
    water.walkable = false;
    water.buildable = false;
    a.attackTargetId = d.id;
    a.activity = 'attacking';

    for (let i = 0; i < 80; i++) updateCombat(game.state, TICK_MS / 1000);

    expect(a.x).toBeLessThan(11);
    expect(water.occupiedBy).not.toBe(a.id);
  });

  it('自动接敌按单位目标偏好选择装甲类型', () => {
    const game = new Game(createInitialGameState({ testUnits: false }));
    const tank = spawnUnit(game.state, 'tank', 0, 5, 5);
    const infantry = spawnUnit(game.state, 'infantry', 1, 7, 5);
    const refinery = spawnBuilding(game.state, 'refinery', 1, 6, 6);

    updateCombat(game.state, TICK_MS / 1000);

    expect(Math.hypot(infantry.x - tank.x, infantry.y - tank.y)).toBeLessThanOrEqual(3.1);
    expect(Math.hypot(refinery.x - tank.x, refinery.y - tank.y)).toBeLessThanOrEqual(3.1);
    expect(tank.attackTargetId).toBe(refinery.id);
  });

  it('坦克可以直接攻击敌方步兵并生成命中损坏事件', () => {
    const { game, a, d } = makePair('tank', 'infantry', 1, 0);
    game.state.pendingCommands.push({ type: 'attack', playerId: 0, entityId: a.id, targetEntityId: d.id });

    game.update(TICK_MS);

    expect(d.hp).toBeLessThan(game.state.defs.infantry.maxHp);
    expect(game.state.events.some((event) => event.type === 'hit' && event.targetId === d.id)).toBe(true);
  });

  it('伤害按装甲修正：步兵打重甲坦克减半', () => {
    const { game, a, d } = makePair('infantry', 'tank', 1, 0);
    game.state.pendingCommands.push({ type: 'attack', playerId: 0, entityId: a.id, targetEntityId: d.id });
    game.update(TICK_MS);
    expect(d.hp).toBe(120 - 8 * 0.5); // 步兵 8 伤害 × 0.5（对 heavy）
  });

  it('同甲类型伤害无修正', () => {
    const { game, a, d } = makePair('infantry', 'infantry', 1, 0);
    game.state.pendingCommands.push({ type: 'attack', playerId: 0, entityId: a.id, targetEntityId: d.id });
    game.update(TICK_MS);
    expect(d.hp).toBe(50 - 8);
  });

  it('目标血量归零时死亡：移除实体并释放占格', () => {
    const { game, a, d } = makePair('tank', 'infantry', 1, 0);
    d.hp = 5;
    game.state.pendingCommands.push({ type: 'attack', playerId: 0, entityId: a.id, targetEntityId: d.id });
    game.update(TICK_MS); // 坦克打步兵 15×0.75=11.25 > 5 → 击杀
    expect(game.state.entities[d.id]).toBeUndefined();
    expect(game.state.entitiesOrder).not.toContain(d.id);
    expect(game.state.map.tiles[d.tileY * game.state.map.width + d.tileX].occupiedBy).toBeNull();
  });

  it('目标死亡后攻击者停下（清目标回 idle）', () => {
    const { game, a, d } = makePair('tank', 'infantry', 1, 0);
    d.hp = 5;
    game.state.pendingCommands.push({ type: 'attack', playerId: 0, entityId: a.id, targetEntityId: d.id });
    for (let i = 0; i < 5; i++) game.update(TICK_MS);
    expect(a.attackTargetId).toBeNull();
    expect(a.activity).toBe('idle');
    expect(a.command).toBeNull();
  });

  it('移动命令打断攻击，攻击命令打断移动', () => {
    // 目标放在射程外，验证移动命令本身能清除攻击；若敌人仍在射程内，移动中的单位会按警戒规则自动接敌。
    const { game, a, d } = makePair('infantry', 'infantry', 4, 0);
    // 先攻击
    game.state.pendingCommands.push({ type: 'attack', playerId: 0, entityId: a.id, targetEntityId: d.id });
    game.update(TICK_MS);
    expect(a.activity).toBe('attacking');
    // 再移动 → 清攻击目标
    game.state.pendingCommands.push({ type: 'move', playerId: 0, entityId: a.id, targetX: 15, targetY: 15 });
    game.update(TICK_MS);
    expect(a.attackTargetId).toBeNull();
    expect(a.activity).toBe('moving');
    // 再攻击 → 清路径
    game.state.pendingCommands.push({ type: 'attack', playerId: 0, entityId: a.id, targetEntityId: d.id });
    game.update(TICK_MS);
    expect(a.path).toEqual([]);
    expect(a.activity).toBe('attacking');
  });

  it('攻击不存在的/友方目标视为无效命令', () => {
    const { game, a, d } = makePair('infantry', 'infantry', 1, 0);
    d.ownerId = 0; // 场上没有敌人，避免自动接敌干扰无效命令断言。
    game.state.pendingCommands.push({ type: 'attack', playerId: 0, entityId: a.id, targetEntityId: 999 });
    game.update(TICK_MS);
    expect(a.activity).toBe('idle');
    expect(a.attackTargetId).toBeNull();
    // 攻击友方
    game.state.pendingCommands.push({ type: 'attack', playerId: 0, entityId: a.id, targetEntityId: d.id });
    game.update(TICK_MS);
    expect(a.attackTargetId).toBeNull();
    expect(a.activity).toBe('idle');
  });

  it('警戒塔会自动锁定射程内敌人并造成伤害', () => {
    const game = new Game(createInitialGameState({ testUnits: false }));
    const tower = spawnBuilding(game.state, 'guardTower', 0, 10, 10);
    const target = spawnUnit(game.state, 'infantry', 1, 13, 10);
    game.update(TICK_MS);
    expect(tower.attackTargetId).toBe(target.id);
    expect(target.hp).toBeLessThan(game.state.defs.infantry.maxHp);
    expect(countShots(game.state)).toBe(1);
  });
});
