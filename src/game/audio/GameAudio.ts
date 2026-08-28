import type { GameEvent, GameState } from '../state/GameState';

type Waveform = OscillatorType;

/**
 * 轻量的战场音频层：使用 Web Audio 合成短促的原创音效，不引入大体积音频文件。
 * 浏览器必须在用户手势后解锁 AudioContext；即使音频被浏览器拦截，也不能影响游戏逻辑。
 */
export class GameAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private effectsBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private ambientBus: GainNode | null = null;
  private ambientSource: AudioBufferSourceNode | null = null;
  private ambientHum: OscillatorNode | null = null;
  private musicTimer: number | null = null;
  private loopsStarted = false;
  private musicStep = 0;
  private volume = 0.42;
  private musicVolume = 0.24;
  private ambientVolume = 0.18;
  private lastCommandIndex = 0;
  private lastSelection = '';
  private initialized = false;
  private lastPowerShort = false;
  private lastEntityModes = new Map<number, { ownerId: number; harvestPhase: string; queueLength: number; progress: number }>();

  constructor() {
    this.volume = readVolume();
    this.musicVolume = readStoredVolume('red-alert.musicVolume', 0.24);
    this.ambientVolume = readStoredVolume('red-alert.ambientVolume', 0.18);
    const unlock = () => this.unlock();
    window.addEventListener('pointerdown', unlock, { capture: true, passive: true });
    window.addEventListener('keydown', unlock, { capture: true, passive: true });
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

  getMusicVolume(): number {
    return this.musicVolume;
  }

  setMusicVolume(value: number): void {
    if (!Number.isFinite(value)) return;
    this.musicVolume = clampVolume(value);
    persistStoredVolume('red-alert.musicVolume', this.musicVolume);
    if (this.musicBus && this.context) this.musicBus.gain.setTargetAtTime(this.musicVolume, this.context.currentTime, 0.04);
  }

  getAmbientVolume(): number {
    return this.ambientVolume;
  }

  setAmbientVolume(value: number): void {
    if (!Number.isFinite(value)) return;
    this.ambientVolume = clampVolume(value);
    persistStoredVolume('red-alert.ambientVolume', this.ambientVolume);
    if (this.ambientBus && this.context) this.ambientBus.gain.setTargetAtTime(this.ambientVolume, this.context.currentTime, 0.08);
  }

  /** 在明确的用户手势中调用，确保浏览器允许恢复音频上下文。 */
  ensureUnlocked(): boolean {
    this.unlock();
    return Boolean(this.context);
  }

  /** 每帧调用一次，读取逻辑事件并播放战斗反馈。 */
  consumeEvents(events: readonly GameEvent[]): void {
    for (const event of events) {
      if (event.type === 'shot') this.playShot(event.sourceTypeId);
      else if (event.type === 'hit') this.playHit(event.targetTypeId);
      else if (event.type === 'destroy') this.playDestroy(event.targetTypeId);
    }
  }

  /** 观察已应用命令：只为人类玩家播放交互音，AI 操作不抢占玩家反馈。 */
  observeState(state: GameState): void {
    // 读档时命令日志可能很长，首次观察只建立游标，不能把历史命令当成新操作重播。
    if (!this.initialized) {
      this.lastCommandIndex = state.commandLog.length;
      this.lastSelection = state.selectedEntityIds.join(',');
      this.lastPowerShort = isPowerShort(state);
      this.captureEntityModes(state);
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
      } else if (command.type === 'deploy') {
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

    this.observeProductionAndEconomy(state);
  }

  playUi(kind: 'click' | 'stop' = 'click'): void {
    this.ensureUnlocked();
    if (kind === 'stop') this.tone(170, 110, 0.07, 0.035, 'square');
    else this.tone(520, 660, 0.045, 0.035, 'sine');
  }

  private unlock(): void {
    if (!this.context) {
      const AudioContextCtor = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) return;
      this.context = new AudioContextCtor();
      this.master = this.context.createGain();
      this.effectsBus = this.context.createGain();
      this.musicBus = this.context.createGain();
      this.ambientBus = this.context.createGain();
      this.master.gain.value = this.volume;
      this.effectsBus.gain.value = 1;
      this.musicBus.gain.value = this.musicVolume;
      this.ambientBus.gain.value = this.ambientVolume;
      this.effectsBus.connect(this.master);
      this.musicBus.connect(this.master);
      this.ambientBus.connect(this.master);
      this.master.connect(this.context.destination);
    }
    if (this.context.state === 'suspended') {
      void this.context.resume().then(() => this.startAudioLoops()).catch(() => undefined);
    } else if (this.context.state === 'running') {
      this.startAudioLoops();
    }
  }

  private startAudioLoops(): void {
    if (this.loopsStarted || !this.context || this.context.state !== 'running') return;
    this.loopsStarted = true;
    this.startAmbient();
    this.startMusic();
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

  private playProductionComplete(): void {
    this.tone(520, 760, 0.1, 0.045, 'sine');
    this.tone(760, 980, 0.13, 0.032, 'sine', 0.1);
  }

  private playMine(): void {
    this.tone(120, 92, 0.09, 0.025, 'square');
    this.noise(0.045, 0.018, 0.02);
  }

  private playUnload(): void {
    this.tone(180, 260, 0.2, 0.032, 'triangle');
    this.tone(360, 520, 0.16, 0.025, 'sine', 0.12);
  }

  private playWarning(): void {
    this.tone(250, 190, 0.14, 0.06, 'square');
    this.tone(250, 190, 0.14, 0.04, 'square', 0.2);
  }

  private playShot(sourceTypeId?: string): void {
    if (sourceTypeId === 'artillery' || sourceTypeId === 'heavyTank') {
      this.tone(96, 42, 0.18, 0.095, 'sawtooth');
      this.noise(0.13, 0.06, 0.012);
    } else if (sourceTypeId === 'tank' || sourceTypeId === 'guardTower') {
      this.tone(128, 58, 0.12, 0.08, 'square');
      this.noise(0.075, 0.045, 0.01);
    } else if (sourceTypeId === 'rocketTrooper') {
      this.tone(220, 88, 0.16, 0.065, 'sawtooth');
      this.noise(0.1, 0.035, 0.02);
    } else {
      this.tone(180, 82, 0.075, 0.05, 'sawtooth');
      this.noise(0.045, 0.024, 0.01);
    }
  }

  private playHit(targetTypeId?: string): void {
    const structure = targetTypeId === 'base' || targetTypeId === 'factory' || targetTypeId === 'refinery';
    this.tone(structure ? 72 : 96, structure ? 28 : 42, structure ? 0.16 : 0.11, structure ? 0.085 : 0.07, 'square');
    this.noise(structure ? 0.12 : 0.08, structure ? 0.05 : 0.04, 0.01);
  }

  private playDestroy(targetTypeId?: string): void {
    const structure = targetTypeId === 'base' || targetTypeId === 'factory' || targetTypeId === 'refinery';
    this.tone(structure ? 82 : 110, 30, structure ? 0.34 : 0.24, structure ? 0.13 : 0.1, 'sawtooth');
    this.noise(structure ? 0.34 : 0.22, structure ? 0.09 : 0.07, 0.015);
  }

  /** 开始一条很轻的原创环境底噪：低通风声 + 电力低频嗡鸣。 */
  private startAmbient(): void {
    if (!this.context || !this.ambientBus || this.ambientSource) return;
    const sampleRate = this.context.sampleRate;
    const buffer = this.context.createBuffer(1, sampleRate * 2, sampleRate);
    const data = buffer.getChannelData(0);
    let filtered = 0;
    for (let i = 0; i < data.length; i++) {
      // 平滑随机噪声比白噪声更像远处风声，不会抢过战斗反馈。
      filtered = filtered * 0.985 + (Math.random() * 2 - 1) * 0.015;
      data[i] = filtered;
    }
    const wind = this.context.createBufferSource();
    wind.buffer = buffer;
    wind.loop = true;
    const filter = this.context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 520;
    const windGain = this.context.createGain();
    windGain.gain.value = 0.19;
    wind.connect(filter).connect(windGain).connect(this.ambientBus);
    wind.start();
    this.ambientSource = wind;

    const hum = this.context.createOscillator();
    const humGain = this.context.createGain();
    hum.type = 'sine';
    hum.frequency.value = 54;
    humGain.gain.value = 0.035;
    hum.connect(humGain).connect(this.ambientBus);
    hum.start();
    this.ambientHum = hum;
  }

  /** 原创战术合成循环：短音符和低音脉冲组成背景层，避免引入大体积音乐文件。 */
  private startMusic(): void {
    if (this.musicTimer !== null) return;
    this.musicStep = 0;
    this.scheduleMusicStep();
    this.musicTimer = window.setInterval(() => this.scheduleMusicStep(), 560);
  }

  private scheduleMusicStep(): void {
    if (!this.context || !this.musicBus) return;
    const melody = [146.83, 174.61, 196, 220, 174.61, 146.83, 130.81, 164.81];
    const bass = [73.42, 73.42, 65.41, 65.41, 82.41, 82.41, 65.41, 65.41];
    const step = this.musicStep++ % melody.length;
    const when = this.context.currentTime + 0.035;
    this.toneOnBus(melody[step], melody[step] * 1.003, 0.34, 0.035, 'triangle', this.musicBus, when);
    if (step % 2 === 0) this.toneOnBus(bass[step], bass[step] * 0.998, 0.52, 0.045, 'sine', this.musicBus, when);
  }

  private observeProductionAndEconomy(state: GameState): void {
    const next = new Map<number, { ownerId: number; harvestPhase: string; queueLength: number; progress: number }>();
    for (const id of state.entitiesOrder) {
      const entity = state.entities[id];
      if (!entity || entity.ownerId !== 0) continue;
      const mode = {
        ownerId: entity.ownerId,
        harvestPhase: entity.harvestPhase,
        queueLength: entity.productionQueue.length,
        progress: entity.productionProgress,
      };
      const previous = this.lastEntityModes.get(id);
      if (previous) {
        if (entity.type === 'unit' && entity.typeId === 'harvester' && previous.harvestPhase !== mode.harvestPhase) {
          if (mode.harvestPhase === 'mining') this.playMine();
          else if (mode.harvestPhase === 'unloading') this.playUnload();
        }
        if (entity.type === 'building' && mode.queueLength < previous.queueLength) this.playProductionComplete();
      }
      next.set(id, mode);
    }
    this.lastEntityModes = next;

    const powerShort = isPowerShort(state);
    if (powerShort && !this.lastPowerShort) this.playWarning();
    this.lastPowerShort = powerShort;
  }

  private captureEntityModes(state: GameState): void {
    this.lastEntityModes.clear();
    for (const id of state.entitiesOrder) {
      const entity = state.entities[id];
      if (!entity || entity.ownerId !== 0) continue;
      this.lastEntityModes.set(id, {
        ownerId: entity.ownerId,
        harvestPhase: entity.harvestPhase,
        queueLength: entity.productionQueue.length,
        progress: entity.productionProgress,
      });
    }
  }

  private tone(
    from: number,
    to: number,
    duration: number,
    level: number,
    waveform: Waveform,
    delay = 0,
  ): void {
    if (!this.context || !this.effectsBus || this.volume <= 0) return;
    this.toneOnBus(from, to, duration, level, waveform, this.effectsBus, this.context.currentTime + delay);
  }

  private toneOnBus(
    from: number,
    to: number,
    duration: number,
    level: number,
    waveform: Waveform,
    bus: GainNode,
    startAt: number,
  ): void {
    if (!this.context || this.volume <= 0) return;
    const now = startAt;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = waveform;
    oscillator.frequency.setValueAtTime(from, now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, to), now + duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(level, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain).connect(bus);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  }

  private noise(duration: number, level: number, delay = 0): void {
    if (!this.context || !this.effectsBus || this.volume <= 0) return;
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
    source.connect(gain).connect(this.effectsBus);
    source.start(now);
  }
}

function readVolume(): number {
  return readStoredVolume('red-alert.volume', 0.42);
}

function persistVolume(value: number): void {
  try {
    window.localStorage.setItem('red-alert.volume', String(value));
  } catch {
    // 无法持久化不影响本局音量。
  }
}

function clampVolume(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function readStoredVolume(key: string, fallback: number): number {
  try {
    const stored = window.localStorage.getItem(key);
    // Number(null) 和 Number('') 都是 0，不能把“没有设置过”误判成静音。
    if (stored === null || stored.trim() === '') return fallback;
    const value = Number(stored);
    return Number.isFinite(value) ? clampVolume(value) : fallback;
  } catch {
    return fallback;
  }
}

function persistStoredVolume(key: string, value: number): void {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // 无法持久化不影响当前局音频。
  }
}

function isPowerShort(state: GameState): boolean {
  const player = state.players.find((candidate) => candidate.id === 0);
  return Boolean(player && player.powerConsumed > player.powerProduced);
}
