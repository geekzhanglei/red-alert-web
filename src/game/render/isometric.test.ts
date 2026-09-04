import { describe, expect, it } from 'vitest';
import { TILE_H, TILE_W, entitySpriteDepth, gridToScreen, screenToGrid } from './isometric';

describe('等距坐标互转', () => {
  it('投影再反投影回到原点', () => {
    const cases: [number, number][] = [
      [0, 0],
      [1, 0],
      [0, 1],
      [10, 20],
      [-3, 7],
      [31.5, 31.5],
    ];
    for (const [gx, gy] of cases) {
      const s = gridToScreen(gx, gy);
      const g = screenToGrid(s.x, s.y);
      expect(g.x).toBeCloseTo(gx, 8);
      expect(g.y).toBeCloseTo(gy, 8);
    }
  });

  it('相邻格菱形中心间距符合 2:1 等距', () => {
    const a = gridToScreen(0, 0);
    const b = gridToScreen(1, 0);
    const c = gridToScreen(0, 1);
    expect(b.x - a.x).toBe(TILE_W / 2);
    expect(b.y - a.y).toBe(TILE_H / 2);
    expect(c.x - a.x).toBe(-TILE_W / 2);
    expect(c.y - a.y).toBe(TILE_H / 2);
  });

  it('实体深度遵循等距前后关系并保持单位略在同层建筑前', () => {
    const behind = entitySpriteDepth(8, 8, 32, 32);
    const ahead = entitySpriteDepth(9, 8, 32, 32);
    const unit = entitySpriteDepth(8, 8, 32, 32, 0.1);
    expect(ahead).toBeGreaterThan(behind);
    expect(unit).toBeGreaterThan(behind);
    expect(behind).toBeLessThan(28.1);
  });
});
