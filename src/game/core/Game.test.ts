import { describe, expect, it } from 'vitest';
import { Game } from './Game';
import { TICK_MS } from './GameLoop';
import { createInitialGameState } from '../state/GameState';
import { spawnUnit } from '../state/entities';
import { GameCommand } from '../state/commands';

const TOTAL_TICKS = 300;

function move(playerId: number, entityId: number, targetX: number, targetY: number): GameCommand {
  return { type: 'move', playerId, entityId, targetX, targetY };
}

/** 采集终局：实体 id → 位置（按 id 稳定排序），以及 tick。 */
function snapshot(game: Game): { tick: number; positions: Record<string, [number, number]> } {
  const positions: Record<string, [number, number]> = {};
  for (const id of game.state.entitiesOrder) {
    const e = game.state.entities[id];
    positions[String(e.id)] = [e.x, e.y];
  }
  return { tick: game.state.tick, positions };
}

describe('确定性：命令回放', () => {
  it('按命令日志重放得到相同终局', () => {
    const makeGame = () => {
      const game = new Game(createInitialGameState({ testUnits: false }));
      const a = spawnUnit(game.state, 'infantry', 0, 5, 5);
      const b = spawnUnit(game.state, 'infantry', 0, 7, 5);
      const c = spawnUnit(game.state, 'infantry', 0, 5, 8);
      return { game, a, b, c };
    };

    // A 局：正常跑，收集命令日志
    const A = makeGame();
    A.game.state.pendingCommands.push(move(0, A.a.id, 20, 15), move(0, A.b.id, 18, 18), move(0, A.c.id, 22, 12));
    for (let i = 0; i < TOTAL_TICKS; i++) {
      if (i === 150) A.game.state.pendingCommands.push(move(0, A.a.id, 24, 24));
      A.game.update(TICK_MS);
    }
    const log = A.game.state.commandLog.map((l) => ({ tick: l.tick, command: l.command }));
    const finalA = snapshot(A.game);

    // B 局：同 seed 重建，按日志在对应 tick 注入命令重放
    const B = makeGame();
    let idx = 0;
    for (let i = 0; i < TOTAL_TICKS; i++) {
      while (idx < log.length && log[idx].tick === i) {
        B.game.state.pendingCommands.push(log[idx].command);
        idx++;
      }
      B.game.update(TICK_MS);
    }
    const finalB = snapshot(B.game);

    expect(finalA.tick).toBe(finalB.tick);
    expect(finalA.positions).toEqual(finalB.positions);
  });

  it('命令日志记录了 tick 与 playerId', () => {
    const game = new Game(createInitialGameState({ testUnits: false }));
    const e = spawnUnit(game.state, 'infantry', 0, 5, 5);
    game.state.pendingCommands.push(move(7, e.id, 12, 12));
    game.update(TICK_MS);
    expect(game.state.commandLog).toHaveLength(1);
    expect(game.state.commandLog[0].tick).toBe(0);
    expect(game.state.commandLog[0].command.playerId).toBe(7);
  });
});
