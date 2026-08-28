import type { EntityState } from '../state/entities';
import { gridToScreen, TILE_H, TILE_W } from '../render/isometric';

/**
 * 单位贴图的屏幕占用范围。这里与 UnitRenderer 的显示尺寸保持一致，
 * 让“看起来点中了”与“逻辑上命中”使用同一套几何，而不是只点地面锚点。
 */
const UNIT_HITBOXES: Record<string, { width: number; height: number; originY: number }> = {
  mcv: { width: 84, height: 66, originY: 0.95 },
  infantry: { width: 46, height: 48, originY: 0.92 },
  tank: { width: 58, height: 48, originY: 0.92 },
  harvester: { width: 60, height: 44, originY: 0.92 },
  rocketTrooper: { width: 48, height: 50, originY: 0.95 },
  scout: { width: 64, height: 48, originY: 0.94 },
  artillery: { width: 70, height: 54, originY: 0.94 },
  heavyTank: { width: 72, height: 56, originY: 0.94 },
};

const DEFAULT_UNIT_HITBOX = { width: 38, height: 38, originY: 0.92 };
const UNIT_HITBOX_PADDING = 7;

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

/**
 * 判断世界点是否落在单位可见贴图附近。
 *
 * 渲染层会在 e.prevX/e.prevY 与 e.x/e.y 之间插值，所以移动中的单位在一帧
 * 内可能不在逻辑终点。对两个锚点都做命中测试，避免单位移动时点击经常失效。
 */
export function isPointInUnitHitBox(
  worldX: number,
  worldY: number,
  e: Pick<EntityState, 'typeId' | 'x' | 'y' | 'prevX' | 'prevY'>,
): boolean {
  const visual = UNIT_HITBOXES[e.typeId] ?? DEFAULT_UNIT_HITBOX;
  const anchors = [gridToScreen(e.x, e.y), gridToScreen(e.prevX, e.prevY)];
  const halfWidth = visual.width / 2 + UNIT_HITBOX_PADDING;
  const top = -visual.height * visual.originY - UNIT_HITBOX_PADDING;
  const bottom = visual.height * (1 - visual.originY) + UNIT_HITBOX_PADDING;

  return anchors.some((anchor) => {
    const dx = worldX - anchor.x;
    const dy = worldY - anchor.y;
    return dx >= -halfWidth && dx <= halfWidth && dy >= top && dy <= bottom;
  });
}
