import Phaser from 'phaser';
import './styles.css';

class PrototypeScene extends Phaser.Scene {
  constructor() {
    super('prototype');
  }

  create() {
    this.add.text(24, 24, 'Red Alert Web · 原型准备中', {
      color: '#e8edf2',
      fontFamily: 'system-ui, sans-serif',
      fontSize: '20px',
    });
  }
}

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game-root',
  backgroundColor: '#18241d',
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [PrototypeScene],
};

new Phaser.Game(config);

