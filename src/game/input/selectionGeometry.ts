import type { EntityState } from '../state/entities';
import { gridToScreen, TILE_H, TILE_W } from '../render/isometric';

/** 实体逻辑锚点投影到地图世界坐标；框选矩形也在这一坐标系中比较。 */
export function entityWorldAnchor(e: Pick<EntityState, 'x' | 'y'>): { x: number; y: number } {
  return gridToScreen(e.x, e.y);
}

/** RTS 框选的常用语义：实体的地面锚点落在拖拽矩形中，即视为选中。 */
export function isEntityAnchorInRect(
  e: Pick<EntityState, 'x' | 'y'>,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): boolean {
  const p = entityWorldAnchor(e);
  return p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY;
}

/** 判断地图世界点是否落在指定地格的菱形内，用于建筑 footprint 的精确点击命中。 */
export function isPointInTileDiamond(worldX: number, worldY: number, tileX: number, tileY: number): boolean {
  const center = gridToScreen(tileX, tileY);
  return Math.abs(worldX - center.x) / (TILE_W / 2) + Math.abs(worldY - center.y) / (TILE_H / 2) <= 1;
}
