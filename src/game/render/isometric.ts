export const TILE_W = 64;
export const TILE_H = 32;

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface GridPoint {
  x: number;
  y: number;
}

/**
 * 网格坐标 → 世界空间坐标。纯函数，返回的是「菱形中心」位置。
 * 注意：不含摄像机偏移/缩放——摄像机是渲染层的视觉操作，不能污染投影语义。
 */
export function gridToScreen(gx: number, gy: number): ScreenPoint {
  return {
    x: (gx - gy) * (TILE_W / 2),
    y: (gx + gy) * (TILE_H / 2),
  };
}

/**
 * 世界空间坐标 → 网格坐标（浮点，可能为负/越界）。
 * 拾取时先由摄像机把屏幕点转成世界点，再调用本函数取整。
 */
export function screenToGrid(sx: number, sy: number): GridPoint {
  const a = sx / (TILE_W / 2);
  const b = sy / (TILE_H / 2);
  return { x: (a + b) / 2, y: (b - a) / 2 };
}
