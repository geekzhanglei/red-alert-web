import { describe, expect, it } from 'vitest';
import { TICK_MS } from '../core/GameLoop';
import { Game } from '../core/Game';
import { createInitialGameState } from '../state/GameState';
import { spawnBuilding, spawnUnit } from '../state/entities';
import { canAfford, changeMoney } from '../state/players';
import { canPlace, processCommands } from '../state/commands';
import { updateCombat } from './combat';
import { ORE_UNIT_VALUE, updateEconomy } from './economy';
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
  it('默认战局在玩家矿场附近生成可采集的黄金矿脉', () => {
    const state = createInitialGameState();
    const refinery = state.entitiesOrder
      .map((id) => state.entities[id])
      .find((entity) => entity.type === 'building' && entity.typeId === 'refinery' && entity.ownerId === 0);
    expect(refinery).toBeDefined();
    const nearbyOre = state.map.tiles.filter((tile, index) => {
      if (tile.terrain !== 'ore' || tile.oreAmount <= 0 || !refinery) return false;
      const x = index % state.map.width;
      const y = Math.floor(index / state.map.width);
      return Math.max(Math.abs(x - refinery.tileX), Math.abs(y - refinery.tileY)) <= 8;
    });
    expect(nearbyOre.length).toBeGreaterThanOrEqual(7);
  });

  it('寻矿→挖矿→回矿场卸货→资金增长', () => {
    const game = new Game(createInitialGameState({ testUnits: false }));
    // 该用例只验证采矿循环，隔离 AI 玩家避免其战略单位干扰矿场血量。
    game.state.players = [{ id: 0, money: 5000, powerProduced: 0, powerConsumed: 0 }];
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

  it('矿脉耗尽后恢复为普通草地并允许重新建造', () => {
    const game = new Game(createInitialGameState({ testUnits: false }));
    game.state.map = makeMap(10, 10);
    const h = spawnUnit(game.state, 'harvester', 0, 5, 5);
    const tile = game.state.map.tiles[5 * 10 + 5];
    setOre(game.state.map, 5, 5);
    tile.oreAmount = 1;
    h.harvestPhase = 'mining';

    updateEconomy(game.state, 1);

    expect(tile.oreAmount).toBe(0);
    expect(tile.terrain).toBe('grass');
    expect(tile.buildable).toBe(true);
  });
});

describe('建筑放置（build 命令）', () => {
  it('合法放置：扣钱、占满 footprint、生成建筑', () => {
    const game = new Game(createInitialGameState({ testUnits: false }));
    game.state.map = makeMap(10, 10);
    // 矿场会消耗电力，先放置基地提供基础电力。
    spawnBuilding(game.state, 'base', 0, 6, 6);
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

  it('电力不足时不放置耗电建筑，但允许建造发电厂恢复供电', () => {
    const game = new Game(createInitialGameState({ testUnits: false }));
    game.state.map = makeMap(14, 14);
    spawnBuilding(game.state, 'base', 0, 10, 10); // +50
    spawnBuilding(game.state, 'factory', 0, 5, 5); // -50，当前刚好平衡

    const moneyBeforeBarracks = game.state.players[0].money;
    game.state.pendingCommands.push({ type: 'build', playerId: 0, buildingTypeId: 'barracks', x: 1, y: 1 });
    game.update(TICK_MS);

    expect(game.state.players[0].money).toBe(moneyBeforeBarracks);
    expect(game.state.entitiesOrder.some((id) => game.state.entities[id]?.typeId === 'barracks')).toBe(false);

    game.state.pendingCommands.push({ type: 'build', playerId: 0, buildingTypeId: 'powerPlant', x: 1, y: 4 });
    game.update(TICK_MS);
    expect(game.state.players[0].money).toBe(moneyBeforeBarracks - game.state.buildingDefs.powerPlant.cost);
    expect(game.state.entitiesOrder.some((id) => game.state.entities[id]?.typeId === 'powerPlant')).toBe(true);
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
