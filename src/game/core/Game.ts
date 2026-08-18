import { GameState } from '../state/GameState';
import { processCommands } from '../state/commands';
import { updateMovement } from '../systems/movement';

/**
 * 确定性逻辑核心：只消费 GameState，按固定顺序推进各系统（docs/01-architecture.md §7）。
 * dtMs 恒为 TICK_MS（由 GameLoop 保证），逻辑内绝不依赖 Date.now()/Math.random()。
 */
export class Game {
  constructor(public readonly state: GameState) {}

  update(dtMs: number): void {
    const dt = dtMs / 1000;
    processCommands(this.state);
    updateMovement(this.state, dt);
    this.state.tick++;
  }
}
