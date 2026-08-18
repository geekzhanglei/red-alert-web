import { MapState } from '../state/map';

export interface GridPoint {
  x: number;
  y: number;
}

/** 八方向移动（上下左右 + 四斜角）。 */
const DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/** 八方向（octile）启发式；×1.001 轻微高估，换取更少的探索格子，路径仍接近最优。 */
function octile(a: GridPoint, b: GridPoint): number {
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);
  return (Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy)) * 1.001;
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
 * A* 寻路：在网格上找从 start 到 goal 的最短路径（八邻）。
 * 返回不含 start、含 goal 的航点序列；不可达/越界/超上限返回空数组。
 * canTraverse 由调用方提供（障碍物、建筑占用、兵种通行规则都由此表达）。
 * 斜角移动要求两侧格可走，避免「穿墙角」。
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

  const startNode: SearchNode = { x: start.x, y: start.y, g: 0, f: octile(start, goal), parent: null, closed: false };
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
      // 斜角穿越：两侧格也必须可走，否则单位会擦着墙角斜穿过去
      if (dx !== 0 && dy !== 0) {
        if (!canTraverse(current.x + dx, current.y) || !canTraverse(current.x, current.y + dy)) continue;
      }
      if (!canTraverse(nx, ny)) continue;

      const step = dx !== 0 && dy !== 0 ? Math.SQRT2 : 1;
      const g = current.g + step;
      const k = key(nx, ny);
      const existing = nodes.get(k);
      if (existing) {
        if (!existing.closed && g < existing.g) {
          existing.g = g;
          existing.f = g + octile(existing, goal);
          existing.parent = current;
          heap.push(existing); // 惰性：旧条目 pop 时会被 closed 跳过
        }
        continue;
      }
      const node: SearchNode = { x: nx, y: ny, g, f: g + octile({ x: nx, y: ny }, goal), parent: current, closed: false };
      nodes.set(k, node);
      heap.push(node);
    }
  }
  return [];
}

function isInside(map: MapState, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < map.width && y < map.height;
}
