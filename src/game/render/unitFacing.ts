import { TILE_H, TILE_W } from './isometric';

/**
 * 生成的单位图不是以同一个画面方向为正前方：步兵枪口朝右下，坦克炮管朝左，矿车钻头朝左下。
 * 这里记录每张图在未旋转状态下的「正前方」，渲染时再把网格方向投影到等距屏幕。
 */
const SPRITE_FORWARD_ANGLE: Record<string, number> = {
  infantry: 0.45,
  tank: Math.PI,
  harvester: 2.75,
};

/** 将逻辑层网格角度转换成当前单位贴图应使用的屏幕旋转角。 */
export function getUnitScreenRotation(typeId: string, worldAngle: number): number {
  const worldDx = Math.cos(worldAngle);
  const worldDy = Math.sin(worldAngle);
  const screenDx = (worldDx - worldDy) * (TILE_W / 2);
  const screenDy = (worldDx + worldDy) * (TILE_H / 2);
  const screenAngle = Math.atan2(screenDy, screenDx);
  return screenAngle - (SPRITE_FORWARD_ANGLE[typeId] ?? 0);
}

