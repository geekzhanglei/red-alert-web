import type Phaser from 'phaser';
import type { Difficulty } from './game/state/GameState';
import { mountStartMenu } from './ui/StartMenu';
import './styles.css';

type PhaserRuntimeModule = typeof import('phaser') & { default?: typeof Phaser };
type GameRuntime = [PhaserRuntimeModule, typeof import('./game/render/GameScene')];

let currentDifficulty: Difficulty = 'normal';
let runtimePromise: Promise<GameRuntime> | null = null;

/** Phaser 和完整游戏代码不阻塞首屏；菜单出现后浏览器空闲时开始预取。 */
function loadGameRuntime(): Promise<GameRuntime> {
  runtimePromise ??= Promise.all([
    import('phaser') as Promise<PhaserRuntimeModule>,
    import('./game/render/GameScene'),
    import('./assets/loadSprites').then((assets) => assets.warmSpriteCache()),
  ]).then(([phaser, scene]) => [phaser, scene]);
  return runtimePromise;
}

async function installDevHelpers(game: Phaser.Game): Promise<void> {
  if (!import.meta.env.DEV) return;
  const [{ createInitialGameState, PLAYER_ID }, { spawnUnit, spawnBuilding }] = await Promise.all([
    import('./game/state/GameState'),
    import('./game/state/entities'),
  ]);
  (window as unknown as { __game: Phaser.Game }).__game = game;
  (window as unknown as { __sim: unknown; __diff: Difficulty }).__sim = {
    createInitialGameState,
    spawnUnit,
    spawnBuilding,
    PLAYER_ID,
  };
  (window as unknown as { __diff: Difficulty }).__diff = currentDifficulty;
}

async function boot(resumeBattlefield = false): Promise<void> {
  const [phaserModule, { GameScene }] = await loadGameRuntime();
  const PhaserRuntime = phaserModule.default ?? phaserModule;
  const runtimeWindow = window as unknown as { __diff?: Difficulty; __resumeBattlefield?: boolean };
  runtimeWindow.__diff = currentDifficulty;
  runtimeWindow.__resumeBattlefield = resumeBattlefield;
  const config: Phaser.Types.Core.GameConfig = {
    type: PhaserRuntime.AUTO,
    parent: 'game-root',
    width: window.innerWidth,
    height: window.innerHeight,
    backgroundColor: '#101511',
    scale: {
      mode: PhaserRuntime.Scale.RESIZE,
      autoCenter: PhaserRuntime.Scale.CENTER_BOTH,
    },
    scene: [GameScene],
  };

  const sceneReady = new Promise<void>((resolve) => {
    window.addEventListener('raw:scene-ready', () => resolve(), { once: true });
  });
  const game = new PhaserRuntime.Game(config);
  requestAnimationFrame(() => requestAnimationFrame(() => game.scale.refresh()));
  await Promise.all([installDevHelpers(game), sceneReady]);
}

function preloadWhenIdle(): void {
  const preload = () => void loadGameRuntime();
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(preload, { timeout: 2200 });
  } else {
    globalThis.setTimeout(preload, 800);
  }
}

// WebGL 无法在 0 尺寸画布上创建纹理。后台恢复的标签页初始布局可能为 0，
// 等容器有尺寸再挂菜单，避免启动即报 Incomplete Attachment。
const root = document.getElementById('game-root');
function bootWhenReady(): void {
  if (root && root.clientWidth > 0 && root.clientHeight > 0) {
    document.getElementById('boot-screen')?.remove();
    mountStartMenu(async (difficulty, resumeBattlefield = false) => {
      currentDifficulty = difficulty;
      if (import.meta.env.DEV) (window as unknown as { __diff: Difficulty }).__diff = difficulty;
      const app = document.getElementById('app');
      app?.classList.add('app-ready');
      try {
        await boot(resumeBattlefield);
      } catch (error) {
        app?.classList.remove('app-ready');
        throw error;
      }
    });
    preloadWhenIdle();
  } else {
    requestAnimationFrame(bootWhenReady);
  }
}

bootWhenReady();
