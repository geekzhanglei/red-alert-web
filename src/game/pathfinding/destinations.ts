import { MapState } from '../state/map';
import { GridPoint } from './AStar';

/**
 * 多单位去同一目标时的落点分配：以 target 为中心按切比雪夫距离（ring）从小到大螺旋展开，
 * 收集 isFree 的格，凑够 count 个。中心优先，同一批内互不重复。
 * 落点分配在输入层（命令生成时）完成，具体落点已编码进 move 命令，回放无需重算。
 */
export function assignDestinations(
  map: MapState,
  target: GridPoint,
  count: number,
  isFree: (x: number, y: number) => boolean,
): GridPoint[] {
  const results: GridPoint[] = [];
  outer: for (let ring = 0; ring < 32; ring++) {
    for (let dx = -ring; dx <= ring; dx++) {
      for (let dy = -ring; dy <= ring; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        const x = target.x + dx;
        const y = target.y + dy;
        if (x < 0 || y < 0 || x >= map.width || y >= map.height) continue;
        if (isFree(x, y)) results.push({ x, y });
        if (results.length >= count) break outer;
      }
    }
  }
  return results;
}
