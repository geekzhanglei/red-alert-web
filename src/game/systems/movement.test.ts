import { describe, expect, it } from 'vitest';
import { TICK_MS } from '../core/GameLoop';
import { Game } from '../core/Game';
import { createInitialGameState } from '../state/GameState';
import { spawnUnit } from '../state/entities';
import { updateMovement } from './movement';
import { MapState } from '../state/map';

/** 手搓全草地图，可指定不可走格。 */
function makeMap(width: number, height: number, blockers: { x: number; y: number }[] = []): MapState {
  const blocked = new Set(blockers.map((b) => `${b.x},${b.y}`));
  const tiles = new Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const isBlock = blocked.has(`${x},${y}`);
      tiles[y * width + x] = {
        terrain: isBlock ? 'rock' : 'grass',
        walkable: !isBlock,
        buildable: !isBlock,
        oreAmount: 0,
        occupiedBy: null,
      };
    }
  }
  return { width, height, seed: 0, tiles };
}

describe('移动系统', () => {
  it('经完整管线：命令 → 移动 → 到达后回 idle 并清空命令', () => {
    const game = new Game(createInitialGameState({ testUnits: false }));
    const e = spawnUnit(game.state, 'infantry', 0, 10, 10);
    game.state.pendingCommands.push({ type: 'move', playerId: 0, entityId: e.id, targetX: 16, targetY: 10 });
    // 6 格，步兵 2.2 格/秒 → 约 55 tick；跑 200 tick 必到
    for (let i = 0; i < 200; i++) game.update(TICK_MS);
    expect(e.activity).toBe('idle');
    expect(e.command).toBeNull();
    expect(e.x).toBeCloseTo(16, 5);
    expect(e.y).toBeCloseTo(10, 5);
  });

  it('移动中朝向目标', () => {
    const game = new Game(createInitialGameState({ testUnits: false }));
    const e = spawnUnit(game.state, 'infantry', 0, 0, 0);
    e.path = [{ x: 0, y: 5 }];
    e.activity = 'moving';
    updateMovement(game.state, 0.05);
    expect(e.facing).toBeCloseTo(Math.PI / 2, 5); // atan2(5, 0)
  });

  it('idle 单位每 tick 也快照 prev，防止渲染回弹', () => {
    const s = createInitialGameState({ testUnits: false });
    const e = spawnUnit(s, 'infantry', 0, 3, 4);
    e.prevX = 99;
    e.prevY = 99; // 伪造脏旧值，快照应覆盖
    updateMovement(s, 0.05);
    expect(e.prevX).toBe(3);
    expect(e.prevY).toBe(4);
  });

  it('到达后 prev 与当前位置一致，插值结果恒等无抖动', () => {
    const game = new Game(createInitialGameState({ testUnits: false }));
    const e = spawnUnit(game.state, 'infantry', 0, 10, 10);
    game.state.pendingCommands.push({ type: 'move', playerId: 0, entityId: e.id, targetX: 16, targetY: 10 });
    for (let i = 0; i < 200; i++) game.update(TICK_MS);
    expect(e.prevX).toBe(e.x);
    expect(e.prevY).toBe(e.y);
    // 任意 alpha 下插值都回到同一点
    for (const alpha of [0, 0.3, 0.7, 1]) {
      const ix = e.prevX + (e.x - e.prevX) * alpha;
      const iy = e.prevY + (e.y - e.prevY) * alpha;
      expect(ix).toBeCloseTo(16, 5);
      expect(iy).toBeCloseTo(10, 5);
    }
  });
});

describe('寻路集成（命令 → A* → 沿路径移动）', () => {
  it('命令应用时算出绕墙路径，单位沿路径到达目标', () => {
    const game = new Game(createInitialGameState({ testUnits: false }));
    game.state.map = makeMap(8, 8, [{ x: 3, y: 1 }, { x: 3, y: 2 }, { x: 3, y: 3 }, { x: 3, y: 4 }]);
    const e = spawnUnit(game.state, 'infantry', 0, 1, 2);
    game.state.pendingCommands.push({ type: 'move', playerId: 0, entityId: e.id, targetX: 6, targetY: 2 });
    game.update(TICK_MS); // 应用命令 → 计算路径
    expect(e.activity).toBe('moving');
    expect(e.path.length).toBeGreaterThan(0);
    for (const wp of e.path) {
      expect(wp.x !== 3 || wp.y < 1 || wp.y > 4).toBe(true); // 不穿墙
    }
    for (let i = 0; i < 400; i++) game.update(TICK_MS);
    expect(e.activity).toBe('idle');
    expect(Math.round(e.x)).toBe(6);
    expect(Math.round(e.y)).toBe(2);
  });

  it('静止单位占用的格会阻塞寻路', () => {
    const game = new Game(createInitialGameState({ testUnits: false }));
    game.state.map = makeMap(8, 8);
    const blocker = spawnUnit(game.state, 'tank', 0, 4, 2); // 静止挡路
    const mover = spawnUnit(game.state, 'infantry', 0, 1, 2);
    game.state.pendingCommands.push({ type: 'move', playerId: 0, entityId: mover.id, targetX: 6, targetY: 2 });
    game.update(TICK_MS);
    for (const wp of mover.path) {
      expect(wp.x !== blocker.tileX || wp.y !== blocker.tileY).toBe(true);
    }
    expect(mover.path.length).toBeGreaterThan(0);
  });

  it('移动中单位不阻塞寻路（避免相向移动死锁）', () => {
    const game = new Game(createInitialGameState({ testUnits: false }));
    game.state.map = makeMap(8, 8);
    const a = spawnUnit(game.state, 'infantry', 0, 4, 2);
    a.activity = 'moving'; // 已在移动的单位占着 (4,2)，不应当作障碍
    const b = spawnUnit(game.state, 'infantry', 0, 1, 2);
    game.state.pendingCommands.push({ type: 'move', playerId: 0, entityId: b.id, targetX: 6, targetY: 2 });
    game.update(TICK_MS);
    expect(b.path.length).toBeGreaterThan(0);
    // b 的路径可以穿过 a 所在格
    expect(b.path.some((wp) => wp.x === 4 && wp.y === 2)).toBe(true);
  });

  it('单位移动时释放旧格、占用新格', () => {
    const game = new Game(createInitialGameState({ testUnits: false }));
    game.state.map = makeMap(5, 5);
    const e = spawnUnit(game.state, 'infantry', 0, 1, 1);
    e.path = [{ x: 3, y: 1 }];
    e.activity = 'moving';
    for (let i = 0; i < 200; i++) updateMovement(game.state, 0.05);
    expect(game.state.map.tiles[1 * 5 + 1].occupiedBy).toBeNull();
    expect(game.state.map.tiles[1 * 5 + 3].occupiedBy).toBe(e.id);
    expect(e.tileX).toBe(3);
    expect(e.tileY).toBe(1);
  });
});
