import { describe, expect, it } from 'vitest';
import { getUnitScreenRotation } from './unitFacing';

describe('getUnitScreenRotation', () => {
  it('projects a grid direction into the isometric screen direction', () => {
    // 网格 +x 在屏幕上是右下方，步兵素材的默认枪口方向也接近右下方。
    expect(getUnitScreenRotation('infantry', 0)).toBeCloseTo(0.014, 2);
  });

  it('keeps opposite movement directions opposite on screen', () => {
    const forward = getUnitScreenRotation('tank', 0);
    const backward = getUnitScreenRotation('tank', Math.PI);
    expect(Math.abs(Math.abs(backward - forward) - Math.PI)).toBeLessThan(0.01);
  });

  it('uses different source orientations for tank and harvester art', () => {
    expect(getUnitScreenRotation('tank', 0)).not.toBeCloseTo(getUnitScreenRotation('harvester', 0), 1);
  });
});

