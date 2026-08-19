import { describe, expect, it } from 'vitest';
import { TICK_MS } from '../core/GameLoop';
import { Game } from '../core/Game';
import { createInitialGameState } from '../state/GameState';
import { serialize, deserialize, SAVE_VERSION } from '../state/serialize';
import { spawnUnit } from '../state/entities';

function fingerprint(s: ReturnType<typeof createInitialGameState>): string {
  return JSON.stringify({
    tick: s.tick,
    seed: s.seed,
    mapSeed: s.map.seed,
    tileOre: s.map.tiles.map((t) => t.oreAmount).join(','),
    tileWalk: s.map.tiles.map((t) => t.walkable ? 1 : 0).join(','),
    entities: s.entitiesOrder.map((id) => {
      const e = s.entities[id];
      return [e.id, e.type, e.typeId, e.ownerId, e.x, e.y, e.hp, e.activity, e.cargo, e.productionQueue.join('|')].join(':');
    }).join(';'),
    money: s.players.map((p) => p.money).join(','),
    fogSum: s.visibility.perPlayer.map((a) => Array.from(a).reduce((s, b) => s + b, 0)).join(','),
    aiBrains: JSON.stringify(s.aiBrains),
    cmdLog: s.commandLog.length,
  });
}

describe('存档 / 读档', () => {
  it('serialize → deserialize 指纹一致（纯数据往返无损）', () => {
    const game = new Game(createInitialGameState());
    // 跑一段让状态丰富
    for (let i = 0; i < 50; i++) game.update(TICK_MS);
    const a = fingerprint(game.state);
    const json = serialize(game.state);
    const restored = deserialize(json);
    const b = fingerprint(restored);
    expect(a).toBe(b);
  });

  it('版本号格式：当前 SAVE_VERSION=1，旧版本拒绝', () => {
    const bad = JSON.stringify({ v: 999, state: { tick: 0 } });
    expect(() => deserialize(bad)).toThrow(/版本/);
    expect(SAVE_VERSION).toBe(1);
  });
});

describe('回放：命令日志重演', () => {
  it('存档 + 用命令日志重演 → 终局与原局一致', () => {
    // A 局：跑 200 tick 并随时入命令。为隔离 AI 干扰：testUnits:false 且去掉 playerId 1。
    const gameA = new Game(createInitialGameState({ testUnits: false }));
    gameA.state.players = [{ id: 0, money: 5000, powerProduced: 0, powerConsumed: 0 }];
    const a = spawnUnit(gameA.state, 'infantry', 0, 5, 5);
    gameA.state.pendingCommands.push({ type: 'move', playerId: 0, entityId: a.id, targetX: 20, targetY: 20 });
    for (let i = 0; i < 200; i++) {
      if (i === 80) gameA.state.pendingCommands.push({ type: 'stop', playerId: 0, entityId: a.id });
      if (i === 150) gameA.state.pendingCommands.push({ type: 'move', playerId: 0, entityId: a.id, targetX: 5, targetY: 5 });
      gameA.update(TICK_MS);
    }
    expect(gameA.state.commandLog.length).toBe(3); // 无 AI 干扰
    const aFingerprint = fingerprint(gameA.state);
    const log = [...gameA.state.commandLog];

    // 存档：保留当前状态 + 命令日志（确定性回放 = 重放命令序列）
    const json = serialize(gameA.state);
    const restored = deserialize(json);
    // B 局：从 tick 0 起，按 byTick 重新跑 200 tick（不再从 tick 200 续跑）。
    // restored 的 commandLog 用来确认存档完整携带。
    expect(restored.commandLog.length).toBe(log.length);
    const replayed = new Game(createInitialGameState({ testUnits: false }));
    replayed.state.players = [{ id: 0, money: 5000, powerProduced: 0, powerConsumed: 0 }];
    const r = spawnUnit(replayed.state, 'infantry', 0, 5, 5);
    expect(r.id).toBe(a.id); // 同 seed 同 setup → id 一致
    const byTick = new Map<number, typeof log>();
    for (const l of log) {
      const arr = byTick.get(l.tick) ?? [];
      arr.push(l);
      byTick.set(l.tick, arr);
    }
    for (let i = 0; i < 200; i++) {
      const arr = byTick.get(i);
      if (arr) for (const l of arr) replayed.state.pendingCommands.push(l.command);
      replayed.update(TICK_MS);
    }

    const b = fingerprint(replayed.state);
    if (b !== aFingerprint) {
      // 调试：逐字段对比
      const A = JSON.parse(aFingerprint);
      const B = JSON.parse(b);
      const diff: string[] = [];
      for (const k of Object.keys(A)) {
        if (A[k] !== B[k]) diff.push(`${k}: expected ${JSON.stringify(A[k]).slice(0, 80)} got ${JSON.stringify(B[k]).slice(0, 80)}`);
      }
      throw new Error('Replay mismatch:\n' + diff.join('\n'));
    }
  });
});
