import { describe, expect, it } from 'vitest';
import { TILE_H, TILE_W, gridToScreen, screenToGrid } from './isometric';

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
});
