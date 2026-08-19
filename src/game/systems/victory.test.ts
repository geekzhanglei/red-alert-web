import { describe, expect, it } from 'vitest';
import { TICK_MS } from '../core/GameLoop';
import { Game } from '../core/Game';
import { createInitialGameState } from '../state/GameState';
import { spawnBuilding, spawnUnit, removeEntity } from '../state/entities';
import { updateRepair, updateAi } from '../systems/ai';
import { checkVictory } from '../systems/victory';
import { processCommands } from '../state/commands';
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

describe('胜负条件', () => {
  it('未结束时 result 为 ongoing', () => {
    const game = new Game(createInitialGameState({ testUnits: false }));
    game.state.map = makeFlatMap(10, 10);
    // 双方都有基地 → 真正「未结束」
    spawnBuilding(game.state, 'base', 0, 2, 2);
    spawnBuilding(game.state, 'base', 1, 7, 7);
    expect(checkVictory(game.state)).toBe('ongoing');
    expect(game.state.gameOver).toBe(false);
  });

  it('玩家 0 基地被毁+无单位 → 玩家 1 胜', () => {
    const game = new Game(createInitialGameState({ testUnits: false }));
    game.state.map = makeFlatMap(10, 10);
    const p0Base = spawnBuilding(game.state, 'base', 0, 2, 2);
    const p1Base = spawnBuilding(game.state, 'base', 1, 7, 7);
    // 玩家 0 全部死光
    removeEntity(game.state, p0Base.id);
    const result = checkVictory(game.state);
    expect(result).toBe(1);
    expect(game.state.gameOver).toBe(true);
    expect(game.state.winner).toBe(1);
  });

  it('双方同 tick 触发 → draw（罕见但需要兜底）', () => {
    const game = new Game(createInitialGameState({ testUnits: false }));
    game.state.map = makeFlatMap(10, 10);
    const p0Base = spawnBuilding(game.state, 'base', 0, 2, 2);
    const p1Base = spawnBuilding(game.state, 'base', 1, 7, 7);
    // 让双方都至少有一个单位再同时全死
    const p0Unit = spawnUnit(game.state, 'infantry', 0, 3, 3);
    const p1Unit = spawnUnit(game.state, 'infantry', 1, 6, 6);
    removeEntity(game.state, p0Base.id);
    removeEntity(game.state, p1Base.id);
    removeEntity(game.state, p0Unit.id);
    removeEntity(game.state, p1Unit.id);
    expect(checkVictory(game.state)).toBe('draw');
  });

  it('基地没了但还有单位 → 仍 ongoing（与「部队被全歼」区别对待）', () => {
    const game = new Game(createInitialGameState({ testUnits: false }));
    game.state.map = makeFlatMap(10, 10);
    spawnBuilding(game.state, 'base', 1, 7, 7);
    const p0Base = spawnBuilding(game.state, 'base', 0, 2, 2);
    spawnUnit(game.state, 'infantry', 0, 3, 3);
    removeEntity(game.state, p0Base.id);
    // 玩家 0 没了基地但有步兵
    expect(checkVictory(game.state)).toBe('ongoing');
  });

  it('checkVictory 幂等：连续调用结果一致', () => {
    const game = new Game(createInitialGameState({ testUnits: false }));
    game.state.map = makeFlatMap(10, 10);
    const p0Base = spawnBuilding(game.state, 'base', 0, 2, 2);
    const p1Base = spawnBuilding(game.state, 'base', 1, 7, 7);
    removeEntity(game.state, p0Base.id);
    const r1 = checkVictory(game.state);
    const r2 = checkVictory(game.state);
    expect(r1).toBe(1);
    expect(r2).toBe(1);
  });
});

describe('AI 反制 + 修理', () => {
  it('玩家 3+ 单位进入 AI 视野 → 派兵迎击', () => {
    const game = new Game(createInitialGameState({ testUnits: false }));
    game.state.map = makeFlatMap(40, 40);
    spawnBuilding(game.state, 'base', 1, 30, 30);
    spawnUnit(game.state, 'infantry', 1, 28, 28); // AI 已有 1 个步兵
    // 玩家 3 个步兵放在 AI 基地附近（5 格内）
    spawnUnit(game.state, 'infantry', 0, 28, 32);
    spawnUnit(game.state, 'infantry', 0, 28, 33);
    spawnUnit(game.state, 'infantry', 0, 29, 32);
    const logBefore = game.state.commandLog.length;
    // 跑 1 tick（AI 视野被己方步兵更新到 fog，updateAi 战略 + 战术层会触发）
    // 视野需要先更新 → 顺序：先 updateAi 一次让视野不过（视野是 updateVisibility 写的）
    // 手动把 3 个玩家步兵写到 AI fog 里
    const aiIdx = game.state.visibility.playerIdToIndex.get(1)!;
    const aiFog = game.state.visibility.perPlayer[aiIdx];
    aiFog[32 * 40 + 28] = 2; // FOG_VISIBLE
    aiFog[33 * 40 + 28] = 2;
    aiFog[32 * 40 + 29] = 2;
    // 跑一帧：AI 战术层（每 tick）应给步兵发 attack
    updateAi(game.state);
    // tacticalAct 把命令入 pendingCommands，需要 processCommands 才会进 commandLog
    processCommands(game.state);
    const attackCmds = game.state.commandLog.slice(logBefore).filter((l) => l.command.type === 'attack');
    expect(attackCmds.length).toBeGreaterThan(0);
  });

  it('建筑被削血后每 60 tick 自愈 5%', () => {
    const game = new Game(createInitialGameState({ testUnits: false }));
    game.state.map = makeFlatMap(10, 10);
    const b = spawnBuilding(game.state, 'base', 1, 2, 2);
    const def = game.state.buildingDefs.base;
    b.hp = Math.floor(def.maxHp * 0.5); // 削一半
    // 跑 < 60 tick：不修
    game.state.tick = 0;
    for (let i = 0; i < 30; i++) updateRepair(game.state);
    expect(b.hp).toBe(Math.floor(def.maxHp * 0.5));
    // 第 60 tick 修一次
    game.state.tick = 60;
    updateRepair(game.state);
    expect(b.hp).toBeGreaterThan(Math.floor(def.maxHp * 0.5));
    // 跑完一段应回满
    for (let t = 0; t < 60 * 30; t += 60) {
      game.state.tick = t;
      updateRepair(game.state);
    }
    expect(b.hp).toBe(def.maxHp);
  });
});
