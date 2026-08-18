import { describe, expect, it } from 'vitest';
import { generateMap, tileAt } from './map';

describe('种子地图', () => {
  it('同一种子生成完全一致的地图（回放一致性的地基）', () => {
    const a = generateMap(64, 64, 12345);
    const b = generateMap(64, 64, 12345);
    expect(a.tiles).toEqual(b.tiles);
  });

  it('不同种子生成不同地图', () => {
    const a = generateMap(64, 64, 1);
    const b = generateMap(64, 64, 2);
    expect(a.tiles).not.toEqual(b.tiles);
  });

  it('tileAt 越界返回 undefined', () => {
    const m = generateMap(8, 8, 1);
    expect(tileAt(m, -1, 0)).toBeUndefined();
    expect(tileAt(m, 0, 8)).toBeUndefined();
    expect(tileAt(m, 8, 0)).toBeUndefined();
    expect(tileAt(m, 3, 3)).toBeDefined();
  });

  it('水/岩石不可走，草地可走', () => {
    const m = generateMap(64, 64, 20260818);
    for (const t of m.tiles) {
      if (t.terrain === 'water' || t.terrain === 'rock') expect(t.walkable).toBe(false);
      if (t.terrain === 'grass') expect(t.walkable).toBe(true);
    }
  });
});
