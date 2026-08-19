import Phaser from 'phaser';
import { GameState } from '../state/GameState';
import { FOG_EXPLORED, FOG_UNEXPLORED, FOG_VISIBLE, getFog } from '../state/visibility';
import { Terrain } from '../state/map';

const TERRAIN_COLOR: Record<Terrain, number> = {
  grass: 0x3a7d44,
  water: 0x2f6f9f,
  rock: 0x7a7a7a,
  ore: 0x9a8b3f,
};

const UNIT_COLOR: Record<number, number> = {
  0: 0x3f7dff,
  1: 0xe04848,
};

const MINIMAP_PIXELS_PER_TILE = 2.2;
const MINIMAP_PADDING = 6;
const MINIMAP_BG = 0x101511;

/**
 * 小地图（docs/08-fog-minimap.md）：屏幕空间固定位置的缩略图。
 * 己方永远显示；敌方仅在当前可见格才亮（不可见时按探索历史/未探索涂底色）。
 * 每 4 tick 重绘一次（成本约 width*height 个矩形，对 64×64 是 4096，便宜）。
 */
export class Minimap {
  private bg: Phaser.GameObjects.Rectangle;
  private map: Phaser.GameObjects.Graphics;
  private tickCounter = 0;

  constructor(scene: Phaser.Scene, state: GameState) {
    const mw = Math.ceil(state.map.width * MINIMAP_PIXELS_PER_TILE);
    const mh = Math.ceil(state.map.height * MINIMAP_PIXELS_PER_TILE);
    const cam = scene.cameras.main;
    const px = cam.width - mw - MINIMAP_PADDING - 16;
    const py = 60;
    this.bg = scene.add.rectangle(px, py, mw, mh, MINIMAP_BG, 0.9).setOrigin(0).setScrollFactor(0).setDepth(200);
    this.map = scene.add.graphics().setPosition(px, py).setScrollFactor(0).setDepth(201);
    this.bg.setStrokeStyle(1, 0x506253, 0.9);
  }

  update(state: GameState): void {
    if (++this.tickCounter % 4 !== 0) return;
    const g = this.map;
    g.clear();
    for (let y = 0; y < state.map.height; y++) {
      for (let x = 0; x < state.map.width; x++) {
        const fog = getFog(state.visibility, 0, x, y, state.map.width);
        if (fog === FOG_UNEXPLORED) continue;
        const tile = state.map.tiles[y * state.map.width + x];
        g.fillStyle(TERRAIN_COLOR[tile.terrain], fog === FOG_EXPLORED ? 0.4 : 0.9);
        g.fillRect(x * MINIMAP_PIXELS_PER_TILE, y * MINIMAP_PIXELS_PER_TILE, MINIMAP_PIXELS_PER_TILE, MINIMAP_PIXELS_PER_TILE);
      }
    }
    for (const id of state.entitiesOrder) {
      const e = state.entities[id];
      if (!e) continue;
      const isOwn = e.ownerId === 0;
      if (!isOwn) {
        const fog = getFog(state.visibility, 0, Math.floor(e.x), Math.floor(e.y), state.map.width);
        if (fog !== FOG_VISIBLE) continue;
      }
      g.fillStyle(UNIT_COLOR[e.ownerId] ?? 0xffffff, 1);
      g.fillRect(
        e.x * MINIMAP_PIXELS_PER_TILE - 0.5,
        e.y * MINIMAP_PIXELS_PER_TILE - 0.5,
        isOwn ? 3 : 2.5,
        isOwn ? 3 : 2.5,
      );
    }
  }
}
