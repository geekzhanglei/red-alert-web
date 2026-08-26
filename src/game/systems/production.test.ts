import { describe, expect, it } from 'vitest';
import { TICK_MS } from '../core/GameLoop';
import { Game } from '../core/Game';
import { createInitialGameState } from '../state/GameState';
import { spawnBuilding } from '../state/entities';
import { enqueueTrain, recomputePower, updateProduction } from '../systems/production';
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

describe('生产与电力', () => {
  it('enqueueTrain 扣钱入队，错误的目标/单位被拒', () => {
    const game = new Game(createInitialGameState({ testUnits: false }));
    game.state.map = makeFlatMap(10, 10);
    const base = spawnBuilding(game.state, 'base', 0, 4, 4); // 3x3 at (4,4)-(6,6)
    const refinery = spawnBuilding(game.state, 'refinery', 0, 0, 0); // 不能产 infantry

    const okTrain = enqueueTrain(game.state, base.id, 0, 'harvester');
    expect(okTrain).toBe(true);
    expect(base.productionQueue).toEqual(['harvester']);
    expect(game.state.players[0].money).toBe(5000 - 1400);

    expect(enqueueTrain(game.state, refinery.id, 0, 'infantry')).toBe(false);
    expect(refinery.productionQueue).toEqual([]);

    expect(enqueueTrain(game.state, base.id, 1, 'tank')).toBe(false); // 异 owner
  });

  it('允许连续排入多个单位，步兵与车辆队列可并行推进', () => {
    const game = new Game(createInitialGameState({ testUnits: false }));
    game.state.map = makeFlatMap(24, 24);
    game.state.players[0].money = 20_000;
    const barracks = spawnBuilding(game.state, 'barracks', 0, 3, 3);
    const factory = spawnBuilding(game.state, 'factory', 0, 14, 14);

    expect(enqueueTrain(game.state, barracks.id, 0, 'infantry')).toBe(true);
    expect(enqueueTrain(game.state, barracks.id, 0, 'infantry')).toBe(true);
    expect(enqueueTrain(game.state, barracks.id, 0, 'rocketTrooper')).toBe(true);
    expect(enqueueTrain(game.state, factory.id, 0, 'tank')).toBe(true);
    expect(enqueueTrain(game.state, factory.id, 0, 'scout')).toBe(true);
    expect(barracks.productionQueue).toEqual(['infantry', 'infantry', 'rocketTrooper']);
    expect(factory.productionQueue).toEqual(['tank', 'scout']);

    updateProduction(game.state);
    expect(barracks.productionProgress).toBe(1);
    expect(factory.productionProgress).toBe(1);
  });

  it('生产进度到 buildTicks 后在建筑旁 spawn 单位（电力充足时）', () => {
    const game = new Game(createInitialGameState({ testUnits: false }));
    game.state.map = makeFlatMap(20, 20);
    // 兵营出 infantry；基地出 50W 电力，兵营 20W 消耗 → 有 30W 富余（电力充足）
    const base = spawnBuilding(game.state, 'base', 0, 1, 1);
    const barracks = spawnBuilding(game.state, 'barracks', 0, 10, 10);
    enqueueTrain(game.state, barracks.id, 0, 'infantry');
    // 步兵 buildTicks=60
    for (let i = 0; i < 200; i++) game.update(TICK_MS);
    const newInfantry = game.state.entitiesOrder
      .map((id) => game.state.entities[id])
      .filter((e) => e.type === 'unit' && e.typeId === 'infantry' && e.ownerId === 0);
    expect(newInfantry.length).toBeGreaterThanOrEqual(1);
    expect(barracks.productionQueue).toEqual([]);
    // 出生的单位紧邻兵营
    const infant = newInfantry[newInfantry.length - 1];
    const dx = Math.abs(infant.tileX - barracks.x);
    const dy = Math.abs(infant.tileY - barracks.y);
    expect(Math.max(dx, dy)).toBeLessThanOrEqual(3);
    // 渲染层以整数地格中心插值；半格出生会让单位看起来一直偏离地面菱形。
    expect(Number.isInteger(infant.x)).toBe(true);
    expect(Number.isInteger(infant.y)).toBe(true);
  });

  it('缺电时生产速度减半（buildTicks×2）', () => {
    const game = new Game(createInitialGameState({ testUnits: false }));
    game.state.map = makeFlatMap(20, 20);
    // 仅兵营、无基地 → 0 产 20 耗，缺电
    const barracks = spawnBuilding(game.state, 'barracks', 0, 4, 4);
    enqueueTrain(game.state, barracks.id, 0, 'infantry');
    for (let i = 0; i < 60; i++) game.update(TICK_MS);
    // 缺电时 buildTicks=120 → 60 tick 后进度 ≈ 60，未完成
    expect(barracks.productionProgress).toBeLessThanOrEqual(60);
    const unitsAfter60 = game.state.entitiesOrder.filter((id) => game.state.entities[id].type === 'unit');
    // 60 tick 内应还没出
    // 再跑 60 tick，总计 120 → 缺电时刚好出
    for (let i = 0; i < 60; i++) game.update(TICK_MS);
    const final = game.state.entitiesOrder
      .map((id) => game.state.entities[id])
      .filter((e) => e.type === 'unit' && e.typeId === 'infantry');
    expect(final.length).toBe(1);
  });

  it('电力结算：玩家电力随建筑变化', () => {
    const game = new Game(createInitialGameState({ testUnits: false }));
    game.state.map = makeFlatMap(20, 20);
    expect(game.state.players[0].powerProduced).toBe(0);
    spawnBuilding(game.state, 'base', 0, 1, 1);
    recomputePower(game.state);
    expect(game.state.players[0].powerProduced).toBe(50);
    spawnBuilding(game.state, 'barracks', 0, 5, 5);
    recomputePower(game.state);
    expect(game.state.players[0].powerConsumed).toBe(20);
  });

  it('车辆入队不增加电力消耗，只有建筑参与电力结算', () => {
    const game = new Game(createInitialGameState({ testUnits: false }));
    game.state.map = makeFlatMap(20, 20);
    const base = spawnBuilding(game.state, 'base', 0, 1, 1);
    const factory = spawnBuilding(game.state, 'factory', 0, 8, 8);
    recomputePower(game.state);
    const powerBeforeQueue = game.state.players[0].powerConsumed;
    expect(enqueueTrain(game.state, factory.id, 0, 'tank')).toBe(true);
    recomputePower(game.state);
    expect(game.state.players[0].powerProduced).toBe(50);
    expect(game.state.players[0].powerConsumed).toBe(powerBeforeQueue);
    expect(base.productionQueue).toEqual([]);
  });

  it('出生点被堵住时保留已完成队列，空位出现后再出兵', () => {
    const game = new Game(createInitialGameState({ testUnits: false }));
    game.state.map = makeFlatMap(3, 3);
    const base = spawnBuilding(game.state, 'base', 0, 0, 0);
    expect(enqueueTrain(game.state, base.id, 0, 'harvester')).toBe(true);

    // 3×3 基地占满整张地图，周围没有任何出生点。
    for (let i = 0; i < 180; i++) updateProduction(game.state);
    expect(base.productionQueue).toEqual(['harvester']);
    expect(base.productionProgress).toBe(180);

    // 扩出一列空地后，下一次生产更新应成功重试。
    const expanded = makeFlatMap(4, 3);
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 3; x++) expanded.tiles[y * 4 + x].occupiedBy = base.id;
    }
    game.state.map = expanded;
    updateProduction(game.state);
    expect(base.productionQueue).toEqual([]);
    expect(game.state.entitiesOrder.some((id) => game.state.entities[id]?.typeId === 'harvester')).toBe(true);
  });
});
