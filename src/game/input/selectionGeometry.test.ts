import { describe, expect, it } from 'vitest';
import { gridToScreen } from '../render/isometric';
import { entityWorldAnchor, isEntityAnchorInRect, isPointInTileDiamond, isPointInUnitHitBox } from './selectionGeometry';

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

  it('按单位贴图范围命中，而不是只命中地面锚点', () => {
    const tank = { typeId: 'tank', x: 10, y: 7, prevX: 10, prevY: 7 };
    const anchor = entityWorldAnchor(tank);
    expect(isPointInUnitHitBox(anchor.x + 25, anchor.y - 30, tank)).toBe(true);
    expect(isPointInUnitHitBox(anchor.x + 50, anchor.y - 30, tank)).toBe(false);
  });

  it('移动中的单位同时命中渲染插值两端', () => {
    const infantry = { typeId: 'infantry', x: 12, y: 7, prevX: 11.2, prevY: 7 };
    const previous = entityWorldAnchor({ x: infantry.prevX, y: infantry.prevY });
    expect(isPointInUnitHitBox(previous.x, previous.y - 18, infantry)).toBe(true);
  });
});
