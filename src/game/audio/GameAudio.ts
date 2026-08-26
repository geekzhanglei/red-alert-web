import type { GameEvent, GameState } from '../state/GameState';

type Waveform = OscillatorType;

/**
 * 轻量的战场音频层：使用 Web Audio 合成短促的原创音效，不引入大体积音频文件。
 * 浏览器必须在用户手势后解锁 AudioContext；即使音频被浏览器拦截，也不能影响游戏逻辑。
 */
export class GameAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private volume = 0.42;
  private lastCommandIndex = 0;
  private lastSelection = '';
  private initialized = false;

  constructor() {
    this.volume = readVolume();
    const unlock = () => this.unlock();
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock, { passive: true });
  }

  getVolume(): number {
    return this.volume;
  }

  setVolume(value: number): void {
    if (!Number.isFinite(value)) return;
    this.volume = Math.max(0, Math.min(1, value));
    persistVolume(this.volume);
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(this.volume, this.context.currentTime, 0.02);
    }
  }

  /** 每帧调用一次，读取逻辑事件并播放战斗反馈。 */
  consumeEvents(events: readonly GameEvent[]): void {
    for (const event of events) {
      if (event.type === 'shot') this.playShot();
      else if (event.type === 'hit') this.playHit();
      else if (event.type === 'destroy') this.playDestroy();
    }
  }

  /** 观察已应用命令：只为人类玩家播放交互音，AI 操作不抢占玩家反馈。 */
  observeState(state: GameState): void {
    // 读档时命令日志可能很长，首次观察只建立游标，不能把历史命令当成新操作重播。
    if (!this.initialized) {
      this.lastCommandIndex = state.commandLog.length;
      this.lastSelection = state.selectedEntityIds.join(',');
      this.initialized = true;
      return;
    }
    if (state.commandLog.length < this.lastCommandIndex) this.lastCommandIndex = 0;
    let playedMove = false;
    for (; this.lastCommandIndex < state.commandLog.length; this.lastCommandIndex++) {
      const command = state.commandLog[this.lastCommandIndex].command;
      if (command.playerId !== 0) continue;
      if (command.type === 'move' && !playedMove) {
        this.playMove();
        playedMove = true;
      } else if (command.type === 'build') {
        this.playBuild();
      } else if (command.type === 'train') {
        this.playQueue();
      } else if (command.type === 'stop') {
        this.playUi('stop');
      }
    }

    const selection = state.selectedEntityIds.join(',');
    if (selection !== this.lastSelection) {
      if (selection) this.playSelect();
      this.lastSelection = selection;
    }
  }

  playUi(kind: 'click' | 'stop' = 'click'): void {
    if (kind === 'stop') this.tone(170, 110, 0.07, 0.035, 'square');
    else this.tone(520, 660, 0.045, 0.035, 'sine');
  }

  private unlock(): void {
    if (!this.context) {
      const AudioContextCtor = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) return;
      this.context = new AudioContextCtor();
      this.master = this.context.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.context.destination);
    }
    if (this.context.state === 'suspended') void this.context.resume();
  }

  private playSelect(): void {
    this.tone(620, 860, 0.06, 0.045, 'sine');
  }

  private playMove(): void {
    this.tone(300, 220, 0.08, 0.035, 'triangle');
  }

  private playBuild(): void {
    this.tone(180, 280, 0.1, 0.055, 'square');
    this.tone(360, 520, 0.12, 0.04, 'sine', 0.09);
  }

  private playQueue(): void {
    this.tone(410, 640, 0.08, 0.04, 'triangle');
  }

  private playShot(): void {
    this.tone(145, 72, 0.075, 0.055, 'sawtooth');
    this.noise(0.045, 0.028, 0.01);
  }

  private playHit(): void {
    this.tone(90, 42, 0.11, 0.075, 'square');
    this.noise(0.08, 0.04, 0.01);
  }

  private playDestroy(): void {
    this.tone(110, 38, 0.24, 0.1, 'sawtooth');
    this.noise(0.22, 0.07, 0.015);
  }

  private tone(
    from: number,
    to: number,
    duration: number,
    level: number,
    waveform: Waveform,
    delay = 0,
  ): void {
    if (!this.context || !this.master || this.volume <= 0) return;
    const now = this.context.currentTime + delay;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = waveform;
    oscillator.frequency.setValueAtTime(from, now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, to), now + duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(level, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain).connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  }

  private noise(duration: number, level: number, delay = 0): void {
    if (!this.context || !this.master || this.volume <= 0) return;
    const sampleRate = this.context.sampleRate;
    const buffer = this.context.createBuffer(1, Math.ceil(sampleRate * duration), sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    const now = this.context.currentTime + delay;
    gain.gain.setValueAtTime(level, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.buffer = buffer;
    source.connect(gain).connect(this.master);
    source.start(now);
  }
}

function readVolume(): number {
  try {
    const value = Number(window.localStorage.getItem('red-alert.volume'));
    if (Number.isFinite(value)) return Math.max(0, Math.min(1, value));
  } catch {
    // 存储不可用时使用默认音量。
  }
  return 0.42;
}

function persistVolume(value: number): void {
  try {
    window.localStorage.setItem('red-alert.volume', String(value));
  } catch {
    // 无法持久化不影响本局音量。
  }
}
