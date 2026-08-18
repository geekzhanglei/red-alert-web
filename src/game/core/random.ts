/**
 * 可复现的伪随机数生成器（mulberry32）。
 *
 * 同一 seed 产生同一序列。逻辑层的随机一律使用它，禁止直接调用 Math.random()，
 * 这是回放/存档确定性的基石（见 docs/01-architecture.md 决策四）。
 * 初始化时（建新局）可以任选 seed，因为 seed 会随存档/回放一起记录。
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
