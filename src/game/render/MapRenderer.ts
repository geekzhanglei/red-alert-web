import Phaser from 'phaser';
import { MapState, Terrain, tileAt } from '../state/map';
import { TILE_H, TILE_W, gridToScreen } from './isometric';
import { GameState } from '../state/GameState';
import { FOG_EXPLORED, FOG_UNEXPLORED, FOG_VISIBLE, getFog } from '../state/visibility';

const TERRAIN_COLORS: Record<Terrain, number> = {
  grass: 0x3a7d44,
  water: 0x2f6f9f,
  rock: 0x7a7a7a,
  ore: 0x9a8b3f,
};

/**
 * 地图渲染层：地形只画一次（静态，不变），动态雾遮罩每玩家一张 Graphics。
 * UnitRenderer 跳迷雾里的敌方（小地图也读 visibility）。
 */
export class MapRenderer {
  private terrain: Phaser.GameObjects.Graphics;
  private fog: Phaser.GameObjects.Graphics; // 当前查看者（玩家 0）的雾遮罩

  constructor(scene: Phaser.Scene) {
    this.terrain = scene.add.graphics();
    this.fog = scene.add.graphics().setDepth(50);
  }

  init(scene: Phaser.Scene, map: MapState): void {
    drawMapLayer(this.terrain, map);
  }

  /** 每帧更新雾遮罩：可见格透明，已探索格半透明黑，未探索格全黑。 */
  updateFog(state: GameState, viewerPlayerId: number): void {
    const g = this.fog;
    g.clear();
    const map = state.map;
    const width = map.width;
    // 地形用大菱形+画家算法画遮罩成本高，改用小矩形按格子涂，性能足够
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const fog = getFog(state.visibility, viewerPlayerId, x, y, width);
        if (fog === FOG_VISIBLE) continue;
        const c = gridToScreen(x, y);
        if (fog === FOG_UNEXPLORED) {
          g.fillStyle(0x000000, 1);
        } else {
          g.fillStyle(0x000000, 0.55);
        }
        // 菱形（4 顶点）
        g.fillPoints(
          [
            new Phaser.Geom.Point(c.x, c.y - TILE_H / 2),
            new Phaser.Geom.Point(c.x + TILE_W / 2, c.y),
            new Phaser.Geom.Point(c.x, c.y + TILE_H / 2),
            new Phaser.Geom.Point(c.x - TILE_W / 2, c.y),
          ],
          true,
        );
      }
    }
  }

  get terrainLayer(): Phaser.GameObjects.Graphics {
    return this.terrain;
  }

  get fogLayer(): Phaser.GameObjects.Graphics {
    return this.fog;
  }
}

/** 把整张地图画进一个 Graphics。地图是静态的，画一次即可。 */
function drawMapLayer(g: Phaser.GameObjects.Graphics, map: MapState): void {
  for (let d = 0; d < map.width + map.height - 1; d++) {
    for (let x = Math.max(0, d - map.height + 1); x <= Math.min(map.width - 1, d); x++) {
      const y = d - x;
      const tile = tileAt(map, x, y);
      if (!tile) continue;
      const c = gridToScreen(x, y);
      const pts = diamond(c.x, c.y);
      g.fillStyle(TERRAIN_COLORS[tile.terrain], 1);
      g.fillPoints(pts, true);
      g.lineStyle(1, 0x0f1512, 0.35);
      g.strokePoints(pts, true, true);
    }
  }
}

/** 地图的世界空间包围盒，用于限制摄像机活动范围。 */
export function mapWorldBounds(map: MapState): Phaser.Geom.Rectangle {
  const left = gridToScreen(0, map.height - 1).x - TILE_W / 2;
  const right = gridToScreen(map.width - 1, 0).x + TILE_W / 2;
  const top = gridToScreen(0, 0).y - TILE_H / 2;
  const bottom = gridToScreen(map.width - 1, map.height - 1).y + TILE_H / 2;
  return new Phaser.Geom.Rectangle(left, top, right - left, bottom - top);
}

/** 以 (cx, cy) 为中心的 2:1 等距菱形四顶点。 */
function diamond(cx: number, cy: number): Phaser.Geom.Point[] {
  return [
    new Phaser.Geom.Point(cx, cy - TILE_H / 2),
    new Phaser.Geom.Point(cx + TILE_W / 2, cy),
    new Phaser.Geom.Point(cx, cy + TILE_H / 2),
    new Phaser.Geom.Point(cx - TILE_W / 2, cy),
  ];
}
