import type { EntityState } from '../state/entities';

/**
 * 单位移动的纯渲染状态。逻辑坐标仍由固定 tick 驱动，这里只根据 tick+alpha 计算视觉步伐，
 * 因此暂停、回放和倍速都不会引入另一套不可复现的时间源。
 */
export interface UnitMotionVisual {
  /** 0~1 的循环相位，用于尘迹/履带印的节奏。 */
  phase: number;
  /** 正弦步伐值，供贴图做极小的横向形变。 */
  stride: number;
  /** 横向缩放系数；不改变纵向位置，避免再次产生漂浮感。 */
  scaleX: number;
}

const TAU = Math.PI * 2;

export function getUnitMotionVisual(e: Pick<EntityState, 'id' | 'typeId' | 'activity'>, tick: number, alpha: number): UnitMotionVisual {
  if (e.activity !== 'moving') return { phase: 0, stride: 0, scaleX: 1 };

  // 步兵步频略快，车辆步频略慢；每个实体错开相位，避免整队像同步复制。
  const frequency = e.typeId === 'infantry' || e.typeId === 'rocketTrooper' ? 0.42 : 0.28;
  const phase = ((tick + alpha) * frequency + e.id * 0.173) % 1;
  const stride = Math.sin(phase * TAU);
  const amount = e.typeId === 'infantry' || e.typeId === 'rocketTrooper' ? 0.026 : 0.014;
  return { phase, stride, scaleX: 1 + stride * amount };
}
