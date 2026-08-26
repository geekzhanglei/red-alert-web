import { describe, expect, it } from 'vitest';
import { createInitialGameState } from './GameState';
import { spawnUnit } from './entities';
import { processCommands } from './commands';

function flatMap(width: number, height: number) {
  return {
    width,
    height,
    seed: 0,
    tiles: Array.from({ length: width * height }, () => ({
      terrain: 'grass' as const,
      walkable: true,
      buildable: true,
      oreAmount: 0,
      occupiedBy: null,
    })),
  };
}

describe('命令系统', () => {
  it('入队命令在下一个 tick 应用，实体命令不含 playerId，日志含 playerId', () => {
    const s = createInitialGameState({ testUnits: false });
    s.map = flatMap(12, 12);
    const e = spawnUnit(s, 'infantry', 0, 5, 5);
    s.pendingCommands.push({ type: 'move', playerId: 3, entityId: e.id, targetX: 8, targetY: 5 });
    processCommands(s);
    expect(e.activity).toBe('moving');
    expect(e.command).toEqual({ type: 'move', targetX: 8, targetY: 5 });
    expect(s.commandLog).toHaveLength(1);
    expect(s.commandLog[0].tick).toBe(0);
    expect(s.commandLog[0].command.playerId).toBe(3);
  });

  it('stop 命令让单位回到 idle', () => {
    const s = createInitialGameState({ testUnits: false });
    const e = spawnUnit(s, 'infantry', 0, 5, 5);
    e.activity = 'moving';
    e.command = { type: 'move', targetX: 9, targetY: 9 };
    s.pendingCommands.push({ type: 'stop', playerId: 0, entityId: e.id });
    processCommands(s);
    expect(e.activity).toBe('idle');
    expect(e.command).toEqual({ type: 'stop' });
  });

  it('对已不存在的实体发命令被安全忽略（命令仍入日志，保证回放忠实）', () => {
    const s = createInitialGameState({ testUnits: false });
    s.pendingCommands.push({ type: 'move', playerId: 0, entityId: 999, targetX: 8, targetY: 5 });
    expect(() => processCommands(s)).not.toThrow();
    // 所有命令都会记录（包括 no-op），回放时按日志原样重演
    expect(s.commandLog).toHaveLength(1);
  });
});
