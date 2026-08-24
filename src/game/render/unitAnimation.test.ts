import { describe, expect, it } from 'vitest';
import { getUnitMotionVisual } from './unitAnimation';

describe('单位移动动效', () => {
  it('静止单位不产生形变', () => {
    expect(getUnitMotionVisual({ id: 1, typeId: 'tank', activity: 'idle' }, 10, 0.5)).toEqual({
      phase: 0,
      stride: 0,
      scaleX: 1,
    });
  });

  it('移动单位按 tick 推进循环相位，并为不同单位错开步伐', () => {
    const a = getUnitMotionVisual({ id: 1, typeId: 'infantry', activity: 'moving' }, 10, 0);
    const b = getUnitMotionVisual({ id: 2, typeId: 'infantry', activity: 'moving' }, 10, 0);
    const next = getUnitMotionVisual({ id: 1, typeId: 'infantry', activity: 'moving' }, 11, 0);
    expect(a.phase).not.toBe(b.phase);
    expect(next.phase).not.toBe(a.phase);
    expect(a.scaleX).not.toBe(1);
  });
});
