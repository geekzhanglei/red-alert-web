import Phaser from 'phaser';
import { MapState, Terrain, tileAt } from '../state/map';
import { TILE_H, TILE_W, gridToScreen } from './isometric';

const TERRAIN_COLORS: Record<Terrain, number> = {
  grass: 0x3a7d44,
  water: 0x2f6f9f,
  rock: 0x7a7a7a,
  ore: 0x9a8b3f,
};

/**
 * 把整张地图画进一个 Graphics。地图是静态的，画一次即可；
 * 摄像机平移/缩放由 Phaser 摄像机完成，无需逐帧重绘。
 */
export function drawMapLayer(scene: Phaser.Scene, map: MapState): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics();
  // 等距遮挡顺序：按 d = x + y 从小到大（远→近）绘制，后画的盖住先画的。
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
  return g;
}

/** 地图的世界空间包围盒，用于限制摄像机活动范围。 */
export function mapWorldBounds(map: MapState): Phaser.Geom.Rectangle {
  const left = gridToScreen(0, map.height - 1).x - TILE_W / 2;
  const right = gridToScreen(map.width - 1, 0).x + TILE_W / 2;
  const top = gridToScreen(0, 0).y - TILE_H / 2;
  const bottom = gridToScreen(map.width - 1, map.height - 1).y + TILE_H / 2;
  return new Phaser.Geom.Rectangle(left, top, right - left, bottom - top);
}

/** 以 (cx, cy) 为中心的 2:1 等距菱形四顶点（顺时针从顶点开始）。 */
function diamond(cx: number, cy: number): Phaser.Geom.Point[] {
  return [
    new Phaser.Geom.Point(cx, cy - TILE_H / 2),
    new Phaser.Geom.Point(cx + TILE_W / 2, cy),
    new Phaser.Geom.Point(cx, cy + TILE_H / 2),
    new Phaser.Geom.Point(cx - TILE_W / 2, cy),
  ];
}
