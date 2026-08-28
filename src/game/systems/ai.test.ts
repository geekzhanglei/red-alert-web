import { describe, expect, it } from 'vitest';
import { TICK_MS } from '../core/GameLoop';
import { Game } from '../core/Game';
import { createInitialGameState } from '../state/GameState';
import { spawnUnit, spawnBuilding } from '../state/entities';
import { MapState } from '../state/map';

function makeFlatMap(width: number, height: number): MapState {
  const tiles = new Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      tiles[y * width + x] = {
        terrain: 'grass',
        walkable: true,
        buildable: true,
        oreAmount: 0,
        occupiedBy: null,
      };
    }
  }
  return { width, height, seed: 0, tiles };
}

describe('AI 战略层', () => {
  it('AI 先部署 MCV，再按电厂→矿场顺序发展', () => {
    const game = new Game(createInitialGameState({ testUnits: false }));
    game.state.map = makeFlatMap(40, 40);
    spawnUnit(game.state, 'mcv', 1, 20, 20);
    game.state.players[1].money = 12_000;

    for (let i = 0; i < 150; i++) game.update(TICK_MS);

    const types = game.state.entitiesOrder
      .map((id) => game.state.entities[id])
      .filter((e) => e.type === 'building' && e.ownerId === 1)
      .map((e) => e.typeId);
    expect(types[0]).toBe('base');
    expect(types[1]).toBe('powerPlant');
    expect(types[2]).toBe('refinery');
  });

  it('AI 按 buildOrder 在基地旁建矿场/兵营（钱够时）', () => {
    const game = new Game(createInitialGameState({ testUnits: false }));
    game.state.map = makeFlatMap(40, 40);
    // AI 已有基地（spawnTestSetup 在 default 会建，但要 testUnits:false）→ 这里手动建一个
    const aiBase = spawnBuilding(game.state, 'base', 1, 20, 20);
    // 给 AI 充足资金
    game.state.players[1].money = 5000;
    // 跑 200 tick：AI 战略层应至少发几条 build 命令
    for (let i = 0; i < 200; i++) game.update(TICK_MS);
    const buildings = game.state.entitiesOrder
      .map((id) => game.state.entities[id])
      .filter((e) => e.type === 'building' && e.ownerId === 1);
    const types = buildings.map((b) => b.typeId);
    expect(types).toContain('refinery');
  });

  it('AI 兵力到阈值后给 attack 单位发 attack 命令', () => {
    const game = new Game(createInitialGameState({ testUnits: false }));
    game.state.map = makeFlatMap(40, 40);
    spawnBuilding(game.state, 'base', 1, 20, 20);
    spawnBuilding(game.state, 'base', 0, 5, 5);
    // 6 个步兵 = attackThreshold(4) + 2 触发 attack
    spawnUnit(game.state, 'infantry', 1, 18, 20);
    spawnUnit(game.state, 'infantry', 1, 19, 20);
    spawnUnit(game.state, 'infantry', 1, 20, 18);
    spawnUnit(game.state, 'infantry', 1, 20, 19);
    spawnUnit(game.state, 'infantry', 1, 21, 18);
    spawnUnit(game.state, 'infantry', 1, 21, 19);
    const logLenBefore = game.state.commandLog.length;
    // 跑 50 tick：战略层 nextThinkTick=60，第一次醒后 4 个步兵应触发 attack
    for (let i = 0; i < 100; i++) game.update(TICK_MS);
    // 应有 attack 命令进入日志
    const attackCmds = game.state.commandLog.slice(logLenBefore).filter((l) => l.command.type === 'attack');
    expect(attackCmds.length).toBeGreaterThan(0);
  });

  it('受袭时进入 defend：把 idle 攻击单位调去打来袭的敌人', () => {
    const game = new Game(createInitialGameState({ testUnits: false }));
    game.state.map = makeFlatMap(40, 40);
    const aiBase = spawnBuilding(game.state, 'base', 1, 20, 20);
    const aiBunk = spawnUnit(game.state, 'infantry', 1, 21, 20); // 防御方
    const playerT = spawnUnit(game.state, 'tank', 0, 20, 22); // 来袭
    // 让 AI 兵营在受袭：直接扣血模拟挨打
    aiBase.hp -= 1;
    // 跑一个 tick，AI 战略层应进入 defend
    for (let i = 0; i < 5; i++) game.update(TICK_MS);
    // AI 步兵应被指派去打 playerT
    const defCmd = game.state.commandLog.find(
      (l) => l.command.type === 'attack' && (l.command as any).targetEntityId === playerT.id,
    );
    expect(defCmd).toBeDefined();
  });

  it('AI 有兵营且资金足够时会把训练加入统一命令流', () => {
    const game = new Game(createInitialGameState({ testUnits: false }));
    game.state.map = makeFlatMap(30, 30);
    spawnBuilding(game.state, 'base', 1, 20, 20);
    spawnBuilding(game.state, 'barracks', 1, 10, 10);
    game.state.players[1].money = 1000;

    for (let i = 0; i < 70; i++) game.update(TICK_MS);

    expect(game.state.commandLog.some((entry) => entry.command.type === 'train')).toBe(true);
  });
});
