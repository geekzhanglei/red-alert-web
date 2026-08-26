import type { Difficulty, GameState } from './GameState';
import { deserialize, serialize } from './serialize';

const STORAGE_KEY = 'red-alert-web.battlefield.v1';
const RESUME_REQUEST_KEY = 'red-alert-web.battlefield.resume-requested';
const ENVELOPE_VERSION = 1;

interface SaveEnvelope {
  version: typeof ENVELOPE_VERSION;
  savedAt: number;
  state: string;
}

export interface BattlefieldSaveInfo {
  savedAt: number;
  tick: number;
  difficulty: Difficulty;
}

/** 保存当前完整 GameState；失败时返回 null（例如浏览器禁用了 localStorage）。 */
export function saveBattlefield(state: GameState): BattlefieldSaveInfo | null {
  const savedAt = Date.now();
  const envelope: SaveEnvelope = {
    version: ENVELOPE_VERSION,
    savedAt,
    state: serialize(state),
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope));
    return { savedAt, tick: state.tick, difficulty: state.difficulty };
  } catch {
    return null;
  }
}

/** 读取并校验存档；损坏或版本不兼容时按无存档处理。 */
export function loadBattlefield(): GameState | null {
  const envelope = readEnvelope();
  if (!envelope) return null;
  try {
    return deserialize(envelope.state);
  } catch {
    return null;
  }
}

export function getBattlefieldInfo(): BattlefieldSaveInfo | null {
  const envelope = readEnvelope();
  if (!envelope) return null;
  try {
    const state = deserialize(envelope.state);
    return { savedAt: envelope.savedAt, tick: state.tick, difficulty: state.difficulty };
  } catch {
    return null;
  }
}

export function clearBattlefieldSave(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 存储不可用时无需额外处理。
  }
}

/** 请求下次启动时自动进入最近一次存档，用于局内“读取存档”按钮。 */
export function requestBattlefieldResume(): boolean {
  try {
    localStorage.setItem(RESUME_REQUEST_KEY, '1');
    return true;
  } catch {
    return false;
  }
}

export function consumeBattlefieldResumeRequest(): boolean {
  try {
    const requested = localStorage.getItem(RESUME_REQUEST_KEY) === '1';
    if (requested) localStorage.removeItem(RESUME_REQUEST_KEY);
    return requested;
  } catch {
    return false;
  }
}

function readEnvelope(): SaveEnvelope | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SaveEnvelope>;
    if (parsed.version !== ENVELOPE_VERSION || typeof parsed.state !== 'string' || !Number.isFinite(parsed.savedAt)) {
      return null;
    }
    return parsed as SaveEnvelope;
  } catch {
    return null;
  }
}
