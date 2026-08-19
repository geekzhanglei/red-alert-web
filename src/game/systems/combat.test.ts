import { describe, expect, it } from 'vitest';
import { TICK_MS } from '../core/GameLoop';
import { Game } from '../core/Game';
import { createInitialGameState } from '../state/GameState';
import { spawnUnit } from '../state/entities';

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

  it('攻击有冷却：按 reloadTicks 节奏开火', () => {
    const { game, a, d } = makePair('infantry', 'infantry', 1, 0); // 射程内
    game.state.pendingCommands.push({ type: 'attack', playerId: 0, entityId: a.id, targetEntityId: d.id });
    for (let i = 0; i < 100; i++) game.update(TICK_MS);
    const shots = countShots(game.state);
    expect(shots).toBeGreaterThanOrEqual(3); // 30 tick 一发的节奏
    expect(shots).toBeLessThanOrEqual(5);
    expect(d.hp).toBeLessThan(50);
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
    const { game, a, d } = makePair('infantry', 'infantry', 1, 0);
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
    game.state.pendingCommands.push({ type: 'attack', playerId: 0, entityId: a.id, targetEntityId: 999 });
    game.update(TICK_MS);
    expect(a.activity).toBe('idle');
    expect(a.attackTargetId).toBeNull();
    // 攻击友方
    game.state.pendingCommands.push({ type: 'attack', playerId: 0, entityId: a.id, targetEntityId: d.id });
    game.state.entities[d.id].ownerId = 0; // 变成友方
    game.update(TICK_MS);
    expect(a.attackTargetId).toBeNull();
    expect(a.activity).toBe('idle');
  });
});
