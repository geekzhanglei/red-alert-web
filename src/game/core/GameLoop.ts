export const TICK_RATE = 20;
export const TICK_MS = 1000 / TICK_RATE;

/**
 * 固定时间步长累加器（docs/01-architecture.md 决策二）：
 * 逻辑以固定 TICK_RATE 推进，渲染跟随浏览器刷新率，两者解耦。
 * 由 Phaser 的渲染帧驱动（scene.update），每个渲染帧调用一次 frame(deltaMs)。
 *
 * 支持暂停（paused=true 时只更新 alpha，不推进 tick）
 * 与时间速率（timeScale: 0.5/1/2/4 之类；被吞掉的时间也只增不重置）。
 */
export class GameLoop {
  private accumulator = 0;
  /** 两帧之间的插值因子 [0,1)，供渲染层在两个逻辑状态之间平滑。 */
  alpha = 0;
  /** true 时 frame() 不推进 tick，只更新 alpha。 */
  paused = false;
  /** 时间速率：1 = 实时，2 = 2 倍速。负数被截为 0。 */
  timeScale = 1;

  constructor(private tickMs: number, private onTick: () => void) {}

  frame(deltaMs: number): void {
    if (this.paused || this.timeScale <= 0) {
      this.alpha = 0;
      return;
    }
    // timeScale 倍乘 deltaMs：渲染帧时间按速率折算
    this.accumulator += deltaMs * this.timeScale;
    if (this.accumulator > this.tickMs * 5) this.accumulator = this.tickMs * 5;
    while (this.accumulator >= this.tickMs) {
      this.onTick();
      this.accumulator -= this.tickMs;
    }
    this.alpha = this.accumulator / this.tickMs;
  }

  togglePause(): boolean {
    this.paused = !this.paused;
    return this.paused;
  }

  setTimeScale(scale: number): void {
    this.timeScale = Math.max(0, scale);
  }
}
