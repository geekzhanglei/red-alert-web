import { describe, expect, it } from 'vitest';
import { TICK_MS } from '../core/GameLoop';
import { Game } from '../core/Game';
import { createInitialGameState } from '../state/GameState';
import { spawnBuilding, spawnUnit } from '../state/entities';
import { canAfford, changeMoney } from '../state/players';
import { canPlace, processCommands } from '../state/commands';
import { updateCombat } from './combat';
import { ORE_UNIT_VALUE } from './economy';
import { MapState } from '../state/map';

function makeMap(width: number, height: number): MapState {
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

function setOre(map: MapState, x: number, y: number): void {
  const t = map.tiles[y * map.width + x];
  t.terrain = 'ore';
  t.walkable = true;
  t.buildable = false;
  t.oreAmount = 1000;
}

describe('资金接口', () => {
  it('changeMoney/canAfford 是唯一资金写入口', () => {
    const state = createInitialGameState({ testUnits: false });
    expect(state.players[0].money).toBe(5000);
    expect(canAfford(state, 0, 5000)).toBe(true);
    expect(canAfford(state, 0, 5001)).toBe(false);
    changeMoney(state, 0, -300);
    expect(state.players[0].money).toBe(4700);
  });
});

describe('采矿车循环', () => {
  it('寻矿→挖矿→回矿场卸货→资金增长', () => {
    const game = new Game(createInitialGameState({ testUnits: false }));
    game.state.map = makeMap(14, 10);
    const refinery = spawnBuilding(game.state, 'refinery', 0, 5, 5); // footprint (5,5)-(6,6)
    setOre(game.state.map, 10, 5);
    setOre(game.state.map, 11, 5);
    const h = spawnUnit(game.state, 'harvester', 0, 4, 5); // 矿场旁
    const moneyBefore = game.state.players[0].money;

    // 跑足够久：过去挖矿 + 回程卸货
    for (let i = 0; i < 700; i++) game.update(TICK_MS);

    const moneyAfter = game.state.players[0].money;
    expect(moneyAfter).toBeGreaterThan(moneyBefore); // 卸过一次货
    expect(h.cargo).toBeLessThan(100); // 卸货后 cargo 清空/低于满值
    expect(refinery.hp).toBe(game.state.buildingDefs.refinery.maxHp);
  });

  it('采矿车满仓后必须到矿场旁才卸货', () => {
    const game = new Game(createInitialGameState({ testUnits: false }));
    game.state.map = makeMap(14, 10);
    const refinery = spawnBuilding(game.state, 'refinery', 0, 5, 5);
    setOre(game.state.map, 10, 5);
    const h = spawnUnit(game.state, 'harvester', 0, 4, 5);
    // 直接塞满 cargo，下一次应直奔矿场卸货
    h.cargo = 100;
    h.harvestPhase = 'mining';
    for (let i = 0; i < 200; i++) game.update(TICK_MS);
    expect(h.cargo).toBe(0); // 已卸货
    expect(game.state.players[0].money).toBe(5000 + 100 * ORE_UNIT_VALUE);
  });
});

describe('建筑放置（build 命令）', () => {
  it('合法放置：扣钱、占满 footprint、生成建筑', () => {
    const game = new Game(createInitialGameState({ testUnits: false }));
    game.state.map = makeMap(10, 10);
    const def = game.state.buildingDefs.refinery;
    game.state.pendingCommands.push({ type: 'build', playerId: 0, buildingTypeId: 'refinery', x: 2, y: 2 });
    game.update(TICK_MS);
    expect(game.state.players[0].money).toBe(5000 - def.cost);
    const building = game.state.entitiesOrder
      .map((id) => game.state.entities[id])
      .find((e) => e.type === 'building' && e.typeId === 'refinery');
    expect(building).toBeDefined();
    // footprint 全部占用
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 2; dx++) {
        expect(game.state.map.tiles[(2 + dy) * 10 + (2 + dx)].occupiedBy).toBe(building!.id);
      }
    }
  });

  it('canPlace：叠放/水上/越界都不可建', () => {
    const game = new Game(createInitialGameState({ testUnits: false }));
    game.state.map = makeMap(5, 5);
    const def = game.state.buildingDefs.refinery;
    expect(canPlace(game.state, 0, 0, def)).toBe(true);
    // 越界
    expect(canPlace(game.state, 4, 4, def)).toBe(false);
    // 水上：把一个 footprint 格改成水
    game.state.map.tiles[1 * 5 + 1].terrain = 'water';
    game.state.map.tiles[1 * 5 + 1].walkable = false;
    game.state.map.tiles[1 * 5 + 1].buildable = false;
    expect(canPlace(game.state, 1, 1, def)).toBe(false);
  });

  it('钱不够时不放置也不扣钱', () => {
    const game = new Game(createInitialGameState({ testUnits: false }));
    game.state.map = makeMap(5, 5);
    game.state.players[0].money = 100;
    game.state.pendingCommands.push({ type: 'build', playerId: 0, buildingTypeId: 'refinery', x: 1, y: 1 });
    game.update(TICK_MS);
    expect(game.state.players[0].money).toBe(100);
    const buildings = game.state.entitiesOrder.filter((id) => game.state.entities[id].type === 'building');
    expect(buildings).toHaveLength(0);
  });

  it('建筑可被攻击摧毁并释放全部占格', () => {
    // 不走 Game.update（AI 修理会防止死亡），手动调战斗系统
    const game = new Game(createInitialGameState({ testUnits: false }));
    game.state.map = makeMap(10, 10);
    // 隔离 AI：去掉玩家 1，避免 AI 修理
    game.state.players = [{ id: 0, money: 5000, powerProduced: 0, powerConsumed: 0 }];
    const b = spawnBuilding(game.state, 'refinery', 1, 2, 2);
    const a = spawnUnit(game.state, 'tank', 0, 2, 1);
    game.state.pendingCommands.push({ type: 'attack', playerId: 0, entityId: a.id, targetEntityId: b.id });
    // 坦克打建筑 15×1.25=18.75/发，600hp → 32 发 × 45 tick = ~1440 tick
    // 手动跑 processCommands + updateCombat（不调 updateAi / updateRepair）
    for (let i = 0; i < 2000; i++) {
      processCommands(game.state);
      updateCombat(game.state, 0.05);
      game.state.tick++;
    }
    expect(game.state.entities[b.id]).toBeUndefined();
    // footprint 全部释放
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 2; dx++) {
        expect(game.state.map.tiles[(2 + dy) * 10 + (2 + dx)].occupiedBy).toBeNull();
      }
    }
  });
});
