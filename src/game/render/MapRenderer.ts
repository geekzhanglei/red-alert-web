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
        const key = TERRAIN_TEXTURE_KEY[tile.terrain];
        const c = gridToScreen(x, y);
        const img = scene.add.image(c.x, c.y, key);
        img.setOrigin(0.5, 0.5);
        // 菱形自然被贴图底图的菱形切边覆盖；轻微缩放让贴图菱形顶点对齐
        this.terrainImages.push(img);
      }
    }
    this.ready = true;
  }

  isReady(): boolean {
    return this.ready;
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
