import { describe, expect, it } from 'vitest';
import { getUnitFacingFrame } from './unitFacing';

describe('getUnitFacingFrame', () => {
  it('maps the four grid axes to the four isometric facing frames', () => {
    expect(getUnitFacingFrame(0)).toBe(0); // 网格 +x → 屏幕右下
    expect(getUnitFacingFrame(Math.PI / 2)).toBe(1); // 网格 +y → 屏幕左下
    expect(getUnitFacingFrame(Math.PI)).toBe(2); // 网格 -x → 屏幕左上
    expect(getUnitFacingFrame(-Math.PI / 2)).toBe(3); // 网格 -y → 屏幕右上
  });

  it('keeps opposite directions on opposite frames', () => {
    for (const angle of [0, 0.4, 1.2, 2.4]) {
      const frame = getUnitFacingFrame(angle);
      const opposite = getUnitFacingFrame(angle + Math.PI);
      expect((opposite - frame + 4) % 4).toBe(2);
    }
  });
});
