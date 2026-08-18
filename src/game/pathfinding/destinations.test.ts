import { describe, expect, it } from 'vitest';
import { MapState } from '../state/map';
import { assignDestinations } from './destinations';

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

describe('落点分配', () => {
  it('返回 count 个互不重复的可走格', () => {
    const map = makeMap(10, 10);
    const dests = assignDestinations(map, { x: 5, y: 5 }, 6, (x, y) => map.tiles[y * map.width + x].walkable);
    expect(dests).toHaveLength(6);
    const keys = new Set(dests.map((d) => `${d.x},${d.y}`));
    expect(keys.size).toBe(6);
  });

  it('中心优先：第一个落点是目标格本身', () => {
    const map = makeMap(10, 10);
    const dests = assignDestinations(map, { x: 5, y: 5 }, 1, (x, y) => map.tiles[y * map.width + x].walkable);
    expect(dests[0]).toEqual({ x: 5, y: 5 });
  });

  it('围绕不可走中心展开到最近的可用格', () => {
    // 目标格是岩石，则从目标周围取
    const map = makeMap(5, 5, [{ x: 2, y: 2 }]);
    const dests = assignDestinations(map, { x: 2, y: 2 }, 4, (x, y) => map.tiles[y * map.width + x].walkable);
    expect(dests).toHaveLength(4);
    for (const d of dests) {
      expect(d).not.toEqual({ x: 2, y: 2 });
      expect(Math.max(Math.abs(d.x - 2), Math.abs(d.y - 2))).toBe(1);
    }
  });

  it('可用格不足时返回尽可能多', () => {
    const map = makeMap(3, 3, [{ x: 1, y: 1 }, { x: 0, y: 0 }, { x: 2, y: 2 }, { x: 2, y: 0 }, { x: 0, y: 2 }]);
    const dests = assignDestinations(map, { x: 1, y: 1 }, 50, (x, y) => map.tiles[y * map.width + x].walkable);
    // 3x3 中可走格：4 个
    expect(dests).toHaveLength(4);
  });
});
