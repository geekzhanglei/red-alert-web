import { describe, expect, it } from 'vitest';
import { TICK_MS } from '../core/GameLoop';
import { Game } from '../core/Game';
import { createInitialGameState } from '../state/GameState';
import { spawnUnit } from '../state/entities';
import { updateVisibility } from '../systems/visibility';
import { FOG_EXPLORED, FOG_VISIBLE, getFog } from '../state/visibility';

function flatMap(width: number, height: number) {
  return {
    width,
    height,
    seed: 0,
    tiles: Array.from({ length: width * height }, () => ({
      terrain: 'grass' as const,
      walkable: true,
      buildable: true,
      oreAmount: 0,
      occupiedBy: null,
    })),
  };
}

describe('战争迷雾', () => {
  it('初始所有格对所有玩家都是 UNEXPLORED', () => {
    const s = createInitialGameState({ testUnits: false });
    for (const id of [0, 1]) {
      for (let i = 0; i < 16; i++) {
        expect(getFog(s.visibility, id, i % 4, Math.floor(i / 4), s.map.width)).toBe(0);
      }
    }
  });

  it('己方单位视野内的格立即变可见', () => {
    const s = createInitialGameState({ testUnits: false });
    spawnUnit(s, 'infantry', 0, 10, 10); // 视野 6
    updateVisibility(s);
    expect(getFog(s.visibility, 0, 10, 10, s.map.width)).toBe(FOG_VISIBLE);
    expect(getFog(s.visibility, 0, 14, 10, s.map.width)).toBe(FOG_VISIBLE);
    // 视野外
    expect(getFog(s.visibility, 0, 20, 20, s.map.width)).toBe(0);
  });

  it('单位离开后，格降为 EXPLORED（不再可见）', () => {
    const s = createInitialGameState({ testUnits: false });
    const u = spawnUnit(s, 'infantry', 0, 10, 10);
    updateVisibility(s);
    expect(getFog(s.visibility, 0, 10, 10, s.map.width)).toBe(FOG_VISIBLE);
    // 移除单位，格应降为 explored
    delete s.entities[u.id];
    s.entitiesOrder.splice(s.entitiesOrder.indexOf(u.id), 1);
    updateVisibility(s);
    expect(getFog(s.visibility, 0, 10, 10, s.map.width)).toBe(FOG_EXPLORED);
  });

  it('双方视野独立：敌方单位不点亮玩家迷雾', () => {
    const s = createInitialGameState({ testUnits: false });
    spawnUnit(s, 'infantry', 1, 10, 10);
    updateVisibility(s);
    // 敌方看见
    expect(getFog(s.visibility, 1, 10, 10, s.map.width)).toBe(FOG_VISIBLE);
    // 玩家看不到
    expect(getFog(s.visibility, 0, 10, 10, s.map.width)).toBe(0);
  });

  it('可见性不参与逻辑：雾里的敌人照常移动、战斗', () => {
    const game = new Game(createInitialGameState({ testUnits: false }));
    game.state.map = flatMap(64, 64);
    const own = spawnUnit(game.state, 'infantry', 0, 5, 5);
    const enemy = spawnUnit(game.state, 'infantry', 1, 50, 50); // 玩家视野外
    game.state.pendingCommands.push({ type: 'move', playerId: 0, entityId: enemy.id, targetX: 60, targetY: 50 });
    // 跑一些 tick
    for (let i = 0; i < 600; i++) game.update(TICK_MS);
    // 敌方应已到达目标附近（即使玩家一直看不见）
    expect(enemy.x).toBeGreaterThan(50);
    // 玩家自己也在走（发了 move 才会动；这里只断言敌方在雾里照常推进）
    expect(own.x).toBe(5);
    expect(own.y).toBe(5);
  });
});
