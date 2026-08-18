import { describe, expect, it } from 'vitest';
import { MapState } from '../state/map';
import { findPath, GridPoint } from './AStar';

/** 手搓一张小地图：blockers 为不可走格（rock），其余 grass。 */
function makeMap(width: number, height: number, blockers: GridPoint[] = []): MapState {
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

/** 可走判定：查询地图格是否 walkable。 */
function isWalkable(map: MapState) {
  return (x: number, y: number) => map.tiles[y * map.width + x].walkable;
}

describe('A* 寻路', () => {
  it('无障碍时走最短路径，返回不含起点含终点', () => {
    const map = makeMap(5, 5);
    const path = findPath(map, { x: 0, y: 0 }, { x: 2, y: 0 }, isWalkable(map));
    expect(path).toEqual([
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ]);
  });

  it('绕过障碍物，路径不经过障碍格', () => {
    const map = makeMap(5, 5, [{ x: 1, y: 1 }, { x: 1, y: 2 }, { x: 1, y: 3 }]);
    const path = findPath(map, { x: 0, y: 2 }, { x: 3, y: 2 }, isWalkable(map));
    expect(path.length).toBeGreaterThan(0);
    expect(path[path.length - 1]).toEqual({ x: 3, y: 2 });
    for (const p of path) {
      expect(p.x !== 1 || p.y < 1 || p.y > 3).toBe(true);
    }
  });

  it('斜角不能穿墙角（一侧被挡时不允许斜穿）', () => {
    // (0,1) 被挡：从 (0,0) 斜走到 (1,1) 需要两侧 (1,0)/(0,1) 都可走，此处不允许 → 第一步必须是 (1,0)
    const map = makeMap(3, 3, [{ x: 0, y: 1 }]);
    const path = findPath(map, { x: 0, y: 0 }, { x: 2, y: 2 }, isWalkable(map));
    expect(path.length).toBeGreaterThan(0);
    expect(path[0]).toEqual({ x: 1, y: 0 });
  });

  it('被围死时返回空（不可达）', () => {
    // (2,2) 四邻全挡
    const enclosed = makeMap(5, 5, [{ x: 2, y: 1 }, { x: 2, y: 3 }, { x: 1, y: 2 }, { x: 3, y: 2 }]);
    const path = findPath(enclosed, { x: 2, y: 2 }, { x: 0, y: 0 }, isWalkable(enclosed));
    expect(path).toEqual([]);
  });

  it('起点即终点返回空', () => {
    const map = makeMap(5, 5);
    expect(findPath(map, { x: 1, y: 1 }, { x: 1, y: 1 }, isWalkable(map))).toEqual([]);
  });

  it('目标越界返回空', () => {
    const map = makeMap(5, 5);
    expect(findPath(map, { x: 0, y: 0 }, { x: 9, y: 9 }, isWalkable(map))).toEqual([]);
  });

  it('路径中的格都合法且可达（连通性校验）', () => {
    const map = makeMap(10, 10, [{ x: 4, y: 2 }, { x: 4, y: 3 }, { x: 4, y: 4 }, { x: 4, y: 5 }]);
    const path = findPath(map, { x: 0, y: 0 }, { x: 8, y: 8 }, isWalkable(map));
    expect(path.length).toBeGreaterThan(0);
    // 每步相邻
    let prev = { x: 0, y: 0 };
    for (const p of path) {
      expect(Math.max(Math.abs(p.x - prev.x), Math.abs(p.y - prev.y))).toBe(1);
      prev = p;
    }
    expect(prev).toEqual({ x: 8, y: 8 });
  });
});
