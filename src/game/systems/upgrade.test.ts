import { describe, expect, it } from 'vitest';
import { TICK_MS } from '../core/GameLoop';
import { Game } from '../core/Game';
import { createInitialGameState } from '../state/GameState';
import { spawnUnit, spawnBuilding } from '../state/entities';

function makeGame() {
  const game = new Game(createInitialGameState({ testUnits: false }));
  // 玩家起步 5000
  return game;
}

describe('升级命令（docs/10-selection-panel.md）', () => {
  it('单位升级：钱够 + 己方 + 未升级 → 扣钱 + 应用效果 + 标记', () => {
    const game = makeGame();
    const u = spawnUnit(game.state, 'infantry', 0, 10, 10);
    const before = game.state.players[0].money;
    // 升级费 = max(100, cost*50%) = max(100, 50) = 100
    const cost = Math.max(100, Math.floor(game.state.defs['infantry'].cost * 0.5));
    game.state.pendingCommands.push({ type: 'upgrade', playerId: 0, entityId: u.id });
    game.update(TICK_MS);
    expect(game.state.players[0].money).toBe(before - cost);
    expect(u.upgraded).toBe(true);
    expect(u.damageMultiplier).toBe(1.5);
    expect(u.hpMultiplier).toBe(1.5);
    // 当前 hp 等比例增加：原 50 + 25 = 75（满血）
    expect(u.hp).toBe(50 + 25);
  });

  it('升级后受到伤害按合成 effectiveMaxHp 比例扣血', () => {
    const game = makeGame();
    const a = spawnUnit(game.state, 'tank', 0, 10, 10);
    const d = spawnUnit(game.state, 'infantry', 1, 12, 10); // 在坦克射程内
    a.upgraded = true;
    a.damageMultiplier = 1.5;
    a.hpMultiplier = 1.5;
    d.upgraded = true;
    d.damageMultiplier = 1.5;
    d.hpMultiplier = 1.5;
    const before = d.hp;
    a.command = { type: 'attack', targetEntityId: d.id };
    a.attackTargetId = d.id;
    a.activity = 'attacking';
    a.reloadLeft = 0;
    game.update(TICK_MS);
    // 升级坦克对升级轻甲的伤害 = 15 * 0.75(轻甲) * 1.5 = 16.875
    // 等比例：newHp = before - 16.875 * (def50/75) = before - 11.25 = 50-11.25=38.75 → 39
    expect(d.hp).toBeLessThan(before);
    expect(d.hp).toBeGreaterThanOrEqual(38);
    expect(d.hp).toBeLessThanOrEqual(40);
  });

  it('钱不够：命令被忽略，不扣钱、不升级', () => {
    const game = makeGame();
    const u = spawnUnit(game.state, 'tank', 0, 10, 10);
    game.state.players[0].money = 0;
    game.state.pendingCommands.push({ type: 'upgrade', playerId: 0, entityId: u.id });
    game.update(TICK_MS);
    expect(u.upgraded).toBe(false);
    expect(game.state.players[0].money).toBe(0);
  });

  it('已升级：再次升级无效', () => {
    const game = makeGame();
    const u = spawnUnit(game.state, 'infantry', 0, 10, 10);
    u.upgraded = true;
    const money = game.state.players[0].money;
    game.state.pendingCommands.push({ type: 'upgrade', playerId: 0, entityId: u.id });
    game.update(TICK_MS);
    expect(game.state.players[0].money).toBe(money); // 没扣钱
  });

  it('跨阵营：敌方单位升级无效', () => {
    const game = makeGame();
    const u = spawnUnit(game.state, 'infantry', 1, 10, 10);
    const before = game.state.players[0].money;
    game.state.pendingCommands.push({ type: 'upgrade', playerId: 0, entityId: u.id });
    game.update(TICK_MS);
    expect(u.upgraded).toBe(false);
    expect(game.state.players[0].money).toBe(before);
  });

  it('升级 base：电力 +25 + 解锁 tank 生产', () => {
    const game = makeGame();
    const b = spawnBuilding(game.state, 'base', 0, 5, 5);
    const def = game.state.buildingDefs['base'];
    game.state.pendingCommands.push({ type: 'upgrade', playerId: 0, entityId: b.id });
    game.update(TICK_MS);
    expect(b.upgraded).toBe(true);
    expect(b.powerBonus).toBe(25);
    expect(b.producesExtra).toContain('tank');
    // 重新结算电力：原 50 → 75
    const player = game.state.players[0];
    expect(player.powerProduced).toBe(def.powerProvided + 25);
  });

  it('升级兵营：解锁一个新单位生产', () => {
    const game = makeGame();
    const b = spawnBuilding(game.state, 'barracks', 0, 5, 5);
    expect(game.state.buildingDefs['barracks'].produces).toEqual(['infantry', 'rocketTrooper']);
    game.state.pendingCommands.push({ type: 'upgrade', playerId: 0, entityId: b.id });
    game.update(TICK_MS);
    expect(b.producesExtra.length).toBe(1);
    expect(b.producesExtra[0]).not.toBe('infantry'); // 不重复
  });
});
