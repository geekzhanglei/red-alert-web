import { GameState } from '../state/GameState';
import { processCommands } from '../state/commands';
import { updateEconomy } from '../systems/economy';
import { updateProduction } from '../systems/production';
import { updateAi, updateRepair } from '../systems/ai';
import { updateMovement } from '../systems/movement';
import { updateCombat } from '../systems/combat';
import { updateVisibility } from '../systems/visibility';
import { updateVictory } from '../systems/victory';

/**
 * 确定性逻辑核心：只消费 GameState，按固定顺序推进各系统（docs/01-architecture.md §7）。
 * dtMs 恒为 TICK_MS（由 GameLoop 保证），逻辑内绝不依赖 Date.now()/Math.random()。
 * 顺序：命令 → 经济 → 生产 → AI → 修理 → 移动 → 战斗 → 可见性 → 胜负。
 * 修理紧跟 AI：每 60 tick 自愈受削血建筑，跨 tick 周期用 brain.lastRepairTick 防重复。
 */
export class Game {
  constructor(public readonly state: GameState) {}

  update(dtMs: number): void {
    if (this.state.gameOver) return;
    const dt = dtMs / 1000;
    processCommands(this.state);
    updateEconomy(this.state, dt);
    updateProduction(this.state);
    updateAi(this.state);
    updateRepair(this.state);
    updateMovement(this.state, dt);
    updateCombat(this.state, dt);
    updateVisibility(this.state);
    updateVictory(this.state);
    this.state.tick++;
  }
}
