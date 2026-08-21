import Phaser from 'phaser';
import { GameScene } from './game/render/GameScene';
import { createInitialGameState, PLAYER_ID, Difficulty } from './game/state/GameState';
import { spawnUnit, spawnBuilding } from './game/state/entities';
import { mountStartMenu } from './ui/StartMenu';
import './styles.css';

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game-root',
  width: window.innerWidth,
  height: window.innerHeight,
  backgroundColor: '#101511',
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [GameScene],
};

/** 当前对局难度。由启动遮罩设置，作为全局供 GameScene 与 __sim 工具使用。 */
let currentDifficulty: Difficulty = 'normal';

function boot(): void {
  const game = new Phaser.Game(config);
  // 某些环境（iframe 预览、样式较晚就绪）下 ScaleManager 首次测量父容器可能为 0，
  // 等布局稳定后再刷新一次保证画布尺寸正确；RESIZE 模式此后仍随窗口自动伸缩。
  requestAnimationFrame(() => requestAnimationFrame(() => game.scale.refresh()));
  if (import.meta.env.DEV) {
    (window as unknown as { __game: Phaser.Game }).__game = game;
    (window as unknown as { __sim: unknown; __diff: Difficulty }).__sim = {
      createInitialGameState,
      spawnUnit,
      spawnBuilding,
      PLAYER_ID,
    };
    (window as unknown as { __diff: Difficulty }).__diff = currentDifficulty;
  }
}

// WebGL 无法在 0 尺寸画布上创建纹理。后台恢复的标签页初始布局可能为 0，
// 等容器有尺寸再启动游戏，避免「启动即报 Incomplete Attachment」。
const root = document.getElementById('game-root');
function bootWhenReady(): void {
  if (root && root.clientWidth > 0 && root.clientHeight > 0) {
    mountStartMenu((d) => {
      currentDifficulty = d;
      if (import.meta.env.DEV) (window as unknown as { __diff: Difficulty }).__diff = d;
      boot();
    });
  } else {
    requestAnimationFrame(bootWhenReady);
  }
}
bootWhenReady();
