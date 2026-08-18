import { describe, expect, it } from 'vitest';
import { GameLoop } from './GameLoop';

describe('固定 tick 累加器', () => {
  it('每凑够一个 tick 推进一次，累计不足则不推进', () => {
    let ticks = 0;
    const loop = new GameLoop(50, () => ticks++);
    loop.frame(25);
    expect(ticks).toBe(0);
    expect(loop.alpha).toBeCloseTo(0.5);
    loop.frame(25);
    expect(ticks).toBe(1);
    expect(loop.alpha).toBeCloseTo(0);
  });

  it('多帧累计正确：50ms tick 下每 50ms 推进 1 次', () => {
    let ticks = 0;
    const loop = new GameLoop(50, () => ticks++);
    loop.frame(50);
    loop.frame(50);
    loop.frame(100);
    expect(ticks).toBe(4);
  });

  it('单帧超大 delta 被钳制，防死亡螺旋追帧', () => {
    let ticks = 0;
    const loop = new GameLoop(50, () => ticks++);
    loop.frame(10_000); // 理论 200 个 tick，只允许补 5 个
    expect(ticks).toBe(5);
  });

  it('剩余时间映射为插值因子 alpha', () => {
    const loop = new GameLoop(100, () => {});
    loop.frame(30);
    expect(loop.alpha).toBeCloseTo(0.3);
  });
});
