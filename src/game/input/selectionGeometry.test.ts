import { describe, expect, it } from 'vitest';
import { gridToScreen } from '../render/isometric';
import { entityWorldAnchor, isEntityAnchorInRect, isPointInTileDiamond } from './selectionGeometry';

describe('选择几何', () => {
  it('用同一地图世界坐标系比较框选与实体锚点', () => {
    const building = { x: 12.5, y: 8.5 };
    const anchor = entityWorldAnchor(building);
    expect(isEntityAnchorInRect(building, anchor.x - 1, anchor.y - 1, anchor.x + 1, anchor.y + 1)).toBe(true);
    expect(isEntityAnchorInRect(building, anchor.x + 1, anchor.y + 1, anchor.x + 20, anchor.y + 20)).toBe(false);
  });

  it('建筑 footprint 中任一地格都可点击', () => {
    const center = gridToScreen(10, 7);
    expect(isPointInTileDiamond(center.x, center.y, 10, 7)).toBe(true);
    expect(isPointInTileDiamond(center.x, center.y, 11, 7)).toBe(false);
  });
});
