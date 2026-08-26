import { mulberry32 } from '../core/random';

export type Terrain = 'grass' | 'water' | 'rock' | 'ore';

export interface Tile {
  terrain: Terrain;
  walkable: boolean;    // 地面单位能否通过
  buildable: boolean;   // 能否放建筑
  oreAmount: number;    // 矿石储量；采空后恢复为普通草地
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
  const tiles: Tile[] = Array.from({ length: width * height }, () => ({
    terrain: 'grass',
    walkable: true,
    buildable: true,
    oreAmount: 0,
    occupiedBy: null,
  }));

  // 起始基地周围保留建设空间，并在两侧基地之间留一条主通道。
  // 这样随机地图仍有变化，但不会生成“出生点被湖包围”或完全没有交战路线的死局。
  const protectedZones = [
    { x: Math.round(width * 0.44), y: Math.round(height * 0.28), radius: Math.max(3, Math.min(width, height) * 0.12) },
    { x: Math.round(width * 0.56), y: Math.round(height * 0.47), radius: Math.max(3, Math.min(width, height) * 0.12) },
  ];

  // 通过成片的湖泊、岩脊和矿脉生成“区域”，替代逐格独立随机造成的棋盘噪声。
  paintBlobs(tiles, width, height, seed ^ 0x51f15e, 'water', 6, 4, 9, protectedZones);
  paintBlobs(tiles, width, height, seed ^ 0xa3c59ac3, 'rock', 16, 1.2, 3.4, protectedZones);
  paintBlobs(tiles, width, height, seed ^ 0x9e3779b9, 'ore', 16, 1.4, 3.8, protectedZones);

  carveStrategicCorridor(tiles, width, height, protectedZones[0], protectedZones[1]);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const tile = tiles[y * width + x];
      if (tile.terrain === 'ore') {
        // 矿脉储量有轻微差异，让“抢哪一片矿”成为地图决策，而不是纯装饰。
        tile.oreAmount = 760 + Math.floor(random() * 760);
      }
    }
  }
  return { width, height, seed, tiles };
}

function paintBlobs(
  tiles: Tile[],
  width: number,
  height: number,
  seed: number,
  terrain: Exclude<Terrain, 'grass'>,
  count: number,
  minRadius: number,
  maxRadius: number,
  protectedZones: { x: number; y: number; radius: number }[],
): void {
  const random = mulberry32(seed);
  for (let blob = 0; blob < count; blob++) {
    const cx = 2 + random() * Math.max(1, width - 4);
    const cy = 2 + random() * Math.max(1, height - 4);
    const rx = minRadius + random() * (maxRadius - minRadius);
    const ry = minRadius * 0.75 + random() * (maxRadius - minRadius) * 0.9;
    const minX = Math.max(0, Math.floor(cx - rx - 1));
    const maxX = Math.min(width - 1, Math.ceil(cx + rx + 1));
    const minY = Math.max(0, Math.floor(cy - ry - 1));
    const maxY = Math.min(height - 1, Math.ceil(cy + ry + 1));

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        if (protectedZones.some((zone) => Math.hypot(x - zone.x, y - zone.y) <= zone.radius)) continue;
        const dx = (x - cx) / rx;
        const dy = (y - cy) / ry;
        const local = mulberry32((seed ^ Math.imul(x + 11, 73856093) ^ Math.imul(y + 17, 19349663)) >>> 0)();
        if (dx * dx + dy * dy > 1.08 + (local - 0.5) * 0.24) continue;
        const tile = tiles[y * width + x];
        // 水/岩石优先形成阻挡地形；矿石只铺在可行走草地上，避免资源生成在湖心。
        if (terrain === 'ore' && tile.terrain !== 'grass') continue;
        if (terrain !== 'ore' && tile.terrain !== 'grass') continue;
        tile.terrain = terrain;
        tile.walkable = terrain === 'ore';
        tile.buildable = false;
      }
    }
  }
}

function carveStrategicCorridor(
  tiles: Tile[],
  width: number,
  height: number,
  start: { x: number; y: number },
  goal: { x: number; y: number },
): void {
  let x = Math.max(0, Math.min(width - 1, start.x));
  let y = Math.max(0, Math.min(height - 1, start.y));
  const endX = Math.max(0, Math.min(width - 1, goal.x));
  const endY = Math.max(0, Math.min(height - 1, goal.y));
  while (x !== endX || y !== endY) {
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const tx = x + ox;
        const ty = y + oy;
        if (tx < 0 || ty < 0 || tx >= width || ty >= height) continue;
        const tile = tiles[ty * width + tx];
        if (tile.terrain === 'water' || tile.terrain === 'rock') {
          tile.terrain = 'grass';
          tile.walkable = true;
          tile.buildable = true;
          tile.oreAmount = 0;
        }
      }
    }
    if (x !== endX) x += Math.sign(endX - x);
    else y += Math.sign(endY - y);
  }
}
