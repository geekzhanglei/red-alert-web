import { TILE_H, TILE_W } from './isometric';

/**
 * 四方向帧的固定顺序。等距 RTS 使用离散方向帧，避免把带透视的整张单位图旋转到侧躺。
 * 0=东南（右下），1=西南（左下），2=西北（左上），3=东北（右上）。
 */
export type UnitFacingFrame = 0 | 1 | 2 | 3;

/** 将逻辑层网格角度投影到屏幕，再选取所在象限的方向帧。 */
export function getUnitFacingFrame(worldAngle: number): UnitFacingFrame {
  const worldDx = Math.cos(worldAngle);
  const worldDy = Math.sin(worldAngle);
  const screenDx = (worldDx - worldDy) * (TILE_W / 2);
  const screenDy = (worldDx + worldDy) * (TILE_H / 2);
  if (screenDx >= 0) return screenDy >= 0 ? 0 : 3;
  return screenDy >= 0 ? 1 : 2;
}
