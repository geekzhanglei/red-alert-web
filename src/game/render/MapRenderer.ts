import Phaser from 'phaser';
import { MapState } from '../state/map';
import { TILE_H, TILE_W, gridToScreen } from './isometric';
import { GameState } from '../state/GameState';
import { FOG_EXPLORED, FOG_UNEXPLORED, FOG_VISIBLE, getFog } from '../state/visibility';
import { TERRAIN_TEXTURE_KEY } from '../../assets/loadSprites';

/**
 * 地图渲染层（贴图版）：每格一张贴图，雾遮罩仍用 Graphics（覆盖层）。
 * 初始化后贴图不变；updateFog 每帧重画遮罩。
 * 贴图创建走 scene.add.image，纹理必须已加载（GameScene 在 create 内 loadAllSprites 后等待 ready）。
 */
export class MapRenderer {
  private terrainImages: Phaser.GameObjects.Image[] = [];
  private oreOverlays = new Map<number, Phaser.GameObjects.Image>();
  private oreDisplayAmounts = new Map<number, number>();
  private fog: Phaser.GameObjects.Graphics;
  private ready = false;

  constructor(scene: Phaser.Scene) {
    this.fog = scene.add.graphics().setDepth(50);
  }

  init(scene: Phaser.Scene, map: MapState): void {
    // 检查地形贴图是否已加载
    if (!scene.textures.exists('tile_grass')) {
      // 兜底：等一帧再画（实际由 GameScene 加载完后再调 init）
      this.ready = false;
      return;
    }
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const idx = y * map.width + x;
        const tile = map.tiles[idx];
        // 矿石作为草地之上的独立资源层渲染，才能随采集量逐渐缩小并最终消失。
        const key = tile.terrain === 'ore' ? TERRAIN_TEXTURE_KEY.grass : TERRAIN_TEXTURE_KEY[tile.terrain];
        const c = gridToScreen(x, y);
        const img = scene.add.image(c.x, c.y, key).setDepth(0);
        img.setOrigin(0.5, 0.5);
        // 所有地形资源统一压到逻辑格尺寸；高分辨率原创位图因此可以直接替换 SVG。
        img.setDisplaySize(TILE_W, TILE_H);
        this.terrainImages.push(img);
        if (tile.terrain === 'ore' && tile.oreAmount > 0) {
          const ore = scene.add.image(c.x, c.y - 3, TERRAIN_TEXTURE_KEY.ore).setDepth(1);
          ore.setOrigin(0.5, 0.56);
          ore.setDisplaySize(TILE_W * 1.24, TILE_H * 1.38);
          this.oreOverlays.set(idx, ore);
          this.oreDisplayAmounts.set(idx, tile.oreAmount);
        }
      }
    }
    this.ready = true;
  }

  isReady(): boolean {
    return this.ready;
  }

  /** 矿车采集会真实改变贴图：储量越少，矿石簇越小、越暗，耗尽后只留下草地。 */
  updateResources(state: GameState): void {
    for (const [idx, ore] of this.oreOverlays) {
      const amount = state.map.tiles[idx]?.oreAmount ?? 0;
      if (this.oreDisplayAmounts.get(idx) === amount) continue;
      this.oreDisplayAmounts.set(idx, amount);
      if (amount <= 0) {
        ore.setVisible(false);
        continue;
      }
      const ratio = Phaser.Math.Clamp(amount / 1000, 0.18, 1);
      ore.setVisible(true);
      ore.setAlpha(0.58 + ratio * 0.42);
      ore.setDisplaySize(TILE_W * (0.9 + ratio * 0.34), TILE_H * (0.96 + ratio * 0.42));
    }
  }

  /** 每帧更新雾遮罩：可见格透明，已探索半透明黑，未探索全黑。 */
  updateFog(state: GameState, viewerPlayerId: number): void {
    if (!this.ready) return;
    const g = this.fog;
    g.clear();
    const map = state.map;
    const width = map.width;
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const fog = getFog(state.visibility, viewerPlayerId, x, y, width);
        if (fog === FOG_VISIBLE) continue;
        const c = gridToScreen(x, y);
        if (fog === FOG_UNEXPLORED) {
          g.fillStyle(0x000000, 1);
        } else {
          g.fillStyle(0x000000, 0.55);
        }
        g.fillPoints(
          [
            new Phaser.Geom.Point(c.x, c.y - TILE_H / 2),
            new Phaser.Geom.Point(c.x + TILE_W / 2, c.y),
            new Phaser.Geom.Point(c.x, c.y + TILE_H / 2),
            new Phaser.Geom.Point(c.x - TILE_W / 2, c.y),
          ],
          true,
        );
      }
    }
  }
}

/** 地图的世界空间包围盒，用于限制摄像机活动范围。 */
export function mapWorldBounds(map: MapState): Phaser.Geom.Rectangle {
  const left = gridToScreen(0, map.height - 1).x - TILE_W / 2;
  const right = gridToScreen(map.width - 1, 0).x + TILE_W / 2;
  const top = gridToScreen(0, 0).y - TILE_H / 2;
  const bottom = gridToScreen(map.width - 1, map.height - 1).y + TILE_H / 2;
  return new Phaser.Geom.Rectangle(left, top, right - left, bottom - top);
}
