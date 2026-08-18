import { mulberry32 } from '../core/random';

export type Terrain = 'grass' | 'water' | 'rock' | 'ore';

export interface Tile {
  terrain: Terrain;
  walkable: boolean;    // 地面单位能否通过
  buildable: boolean;   // 能否放建筑
  oreAmount: number;    // 矿石储量（阶段五经济系统使用，现阶段恒为 0）
  occupiedBy: number | null; // 占用该格的实体 id（阶段三寻路/阶段五建造使用）
}

export interface MapState {
  width: number;
  height: number;
  seed: number;
  /** 一维数组，index = y * width + x。缓存友好、序列化简单。 */
  tiles: Tile[];
}

export const DEFAULT_MAP_WIDTH = 64;
export const DEFAULT_MAP_HEIGHT = 64;

export function tileAt(map: MapState, x: number, y: number): Tile | undefined {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return undefined;
  return map.tiles[y * map.width + x];
}

/** 用种子随机生成地形。同一种子必然得到同一张图，是回放的起点（决策四）。 */
export function generateMap(width: number, height: number, seed: number): MapState {
  const random = mulberry32(seed);
  const tiles: Tile[] = new Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const r = random();
      let terrain: Terrain = 'grass';
      if (r < 0.08) terrain = 'water';
      else if (r < 0.12) terrain = 'rock';
      else if (r < 0.18) terrain = 'ore';
      tiles[y * width + x] = {
        terrain,
        walkable: terrain !== 'water' && terrain !== 'rock',
        buildable: terrain === 'grass',
        oreAmount: terrain === 'ore' ? 1000 : 0,
        occupiedBy: null,
      };
    }
  }
  return { width, height, seed, tiles };
}
