export const TICK_RATE = 20;
export const TICK_MS = 1000 / TICK_RATE;

/**
 * 固定时间步长累加器（docs/01-architecture.md 决策二）：
 * 逻辑以固定 TICK_RATE 推进，渲染跟随浏览器刷新率，两者解耦。
 * 由 Phaser 的渲染帧驱动（scene.update），每个渲染帧调用一次 frame(deltaMs)。
 */
export class GameLoop {
  private accumulator = 0;
  /** 两帧之间的插值因子 [0,1)，供渲染层在两个逻辑状态之间平滑。 */
  alpha = 0;

  constructor(private tickMs: number, private onTick: () => void) {}

  frame(deltaMs: number): void {
    this.accumulator += deltaMs;
    // 卡顿/后台恢复后丢弃多余累计，防止「死亡螺旋」追帧。
    if (this.accumulator > this.tickMs * 5) this.accumulator = this.tickMs * 5;
    while (this.accumulator >= this.tickMs) {
      this.onTick();
      this.accumulator -= this.tickMs;
    }
    this.alpha = this.accumulator / this.tickMs;
  }
}
