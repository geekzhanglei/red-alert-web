import { MapState } from '../state/map';

export interface GridPoint {
  x: number;
  y: number;
}

/** 四方向移动（上下左右）。等距画面里每一步会投影成一条斜边，连续步骤自然形成折线路径。 */
const DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** 四方向网格的曼哈顿启发式，保证 A* 不会生成对角航段。 */
function manhattan(a: GridPoint, b: GridPoint): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

interface SearchNode extends GridPoint {
  g: number;
  f: number;
  parent: SearchNode | null;
  closed: boolean;
}

/** 最小二叉堆：A* 的 open 列表。用「惰性删除」处理节点代价更新（推入重复节点，pop 时跳过已 closed）。 */
export class MinHeap<T> {
  private items: T[] = [];

  constructor(private less: (a: T, b: T) => boolean) {}

  get size(): number {
    return this.items.length;
  }

  push(item: T): void {
    this.items.push(item);
    this.bubbleUp(this.items.length - 1);
  }

  pop(): T | undefined {
    if (this.items.length === 0) return undefined;
    const top = this.items[0];
    const last = this.items.pop()!;
    if (this.items.length > 0) {
      this.items[0] = last;
      this.sinkDown(0);
    }
    return top;
  }

  private bubbleUp(i: number): void {
    const item = this.items[i];
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.less(item, this.items[parent])) {
        this.items[i] = this.items[parent];
        i = parent;
      } else break;
    }
    this.items[i] = item;
  }

  private sinkDown(i: number): void {
    const len = this.items.length;
    const item = this.items[i];
    for (;;) {
      const l = i * 2 + 1;
      const r = l + 1;
      let smallest = i;
      if (l < len && this.less(this.items[l], this.items[smallest])) smallest = l;
      if (r < len && this.less(this.items[r], this.items[smallest])) smallest = r;
      if (smallest !== i) {
        this.items[i] = this.items[smallest];
        i = smallest;
      } else break;
    }
    this.items[i] = item;
  }
}

const MAX_EXPAND = 5000;

/**
 * A* 寻路：在网格上找从 start 到 goal 的最短路径（四邻）。
 * 返回不含 start、含 goal 的航点序列；不可达/越界/超上限返回空数组。
 * canTraverse 由调用方提供（障碍物、建筑占用、兵种通行规则都由此表达）。
 * 单位每次只跨越一个横向或纵向相邻格，移动轨迹始终是可读的折线。
 */
export function findPath(
  map: MapState,
  start: GridPoint,
  goal: GridPoint,
  canTraverse: (x: number, y: number) => boolean,
): GridPoint[] {
  if (start.x === goal.x && start.y === goal.y) return [];
  if (!isInside(map, goal.x, goal.y) || !canTraverse(goal.x, goal.y)) return [];

  const key = (x: number, y: number) => y * map.width + x;
  const nodes = new Map<number, SearchNode>();
  const heap = new MinHeap<SearchNode>((a, b) => a.f < b.f);

  const startNode: SearchNode = { x: start.x, y: start.y, g: 0, f: manhattan(start, goal), parent: null, closed: false };
  nodes.set(key(start.x, start.y), startNode);
  heap.push(startNode);

  let expanded = 0;

  while (heap.size > 0) {
    const current = heap.pop()!;
    if (current.closed) continue; // 惰性删除的旧条目
    if (current.x === goal.x && current.y === goal.y) {
      const path: GridPoint[] = [];
      let n: SearchNode | null = current;
      while (n && n.parent) {
        path.push({ x: n.x, y: n.y });
        n = n.parent;
      }
      path.reverse();
      return path;
    }
    current.closed = true;
    if (++expanded > MAX_EXPAND) return [];

    for (const [dx, dy] of DIRS) {
      const nx = current.x + dx;
      const ny = current.y + dy;
      if (!isInside(map, nx, ny)) continue;
      if (!canTraverse(nx, ny)) continue;

      const g = current.g + 1;
      const k = key(nx, ny);
      const existing = nodes.get(k);
      if (existing) {
        if (!existing.closed && g < existing.g) {
          existing.g = g;
          existing.f = g + manhattan(existing, goal);
          existing.parent = current;
          heap.push(existing); // 惰性：旧条目 pop 时会被 closed 跳过
        }
        continue;
      }
      const node: SearchNode = { x: nx, y: ny, g, f: g + manhattan({ x: nx, y: ny }, goal), parent: current, closed: false };
      nodes.set(k, node);
      heap.push(node);
    }
  }
  return [];
}

function isInside(map: MapState, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < map.width && y < map.height;
}
