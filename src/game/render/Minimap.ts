import type Phaser from 'phaser';
import type { GameState } from '../state/GameState';
import { FOG_EXPLORED, FOG_UNEXPLORED, FOG_VISIBLE, getFog } from '../state/visibility';
import type { Terrain } from '../state/map';

const TERRAIN_COLOR: Record<Terrain, string> = {
  grass: '#3a7d44',
  water: '#2f6f9f',
  rock: '#7a7a7a',
  ore: '#a38c32',
};

const UNIT_COLOR: Record<number, string> = {
  0: '#52a0ff',
  1: '#ee5757',
};

const MINIMAP_PIXELS_PER_TILE = 4;

export interface MinimapOptions {
  /** 点击小地图时通知主摄像机跳转（格子坐标）。 */
  onJump?: (gx: number, gy: number) => void;
}

/**
 * 嵌入左侧控制栏的 DOM Canvas 小地图。
 * 它与主游戏 Canvas 分离，所以不会占据地图画面，也不会把雷达点击误判为地图选择。
 */
export class Minimap {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private tickCounter = 0;

  constructor(_scene: Phaser.Scene, state: GameState, private opts: MinimapOptions = {}) {
    const canvas = document.getElementById('minimap-canvas');
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Missing #minimap-canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Unable to create minimap canvas context');
    this.canvas = canvas;
    this.ctx = ctx;
    canvas.width = Math.ceil(state.map.width * MINIMAP_PIXELS_PER_TILE);
    canvas.height = Math.ceil(state.map.height * MINIMAP_PIXELS_PER_TILE);
    canvas.addEventListener('pointerdown', (event) => {
      const rect = canvas.getBoundingClientRect();
      const localX = ((event.clientX - rect.left) / rect.width) * canvas.width;
      const localY = ((event.clientY - rect.top) / rect.height) * canvas.height;
      const gx = Math.floor(localX / MINIMAP_PIXELS_PER_TILE);
      const gy = Math.floor(localY / MINIMAP_PIXELS_PER_TILE);
      if (gx < 0 || gx >= state.map.width || gy < 0 || gy >= state.map.height) return;
      this.opts.onJump?.(gx, gy);
      event.preventDefault();
    });
    this.draw(state);
  }

  update(state: GameState): void {
    if (++this.tickCounter % 4 !== 0) return;
    this.draw(state);
  }

  private draw(state: GameState): void {
    const g = this.ctx;
    g.globalAlpha = 1;
    g.fillStyle = '#050806';
    g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    for (let y = 0; y < state.map.height; y++) {
      for (let x = 0; x < state.map.width; x++) {
        const fog = getFog(state.visibility, 0, x, y, state.map.width);
        if (fog === FOG_UNEXPLORED) continue;
        const tile = state.map.tiles[y * state.map.width + x];
        g.globalAlpha = fog === FOG_EXPLORED ? 0.34 : 0.9;
        g.fillStyle = TERRAIN_COLOR[tile.terrain];
        g.fillRect(x * MINIMAP_PIXELS_PER_TILE, y * MINIMAP_PIXELS_PER_TILE, MINIMAP_PIXELS_PER_TILE, MINIMAP_PIXELS_PER_TILE);
      }
    }
    g.globalAlpha = 1;
    for (const id of state.entitiesOrder) {
      const entity = state.entities[id];
      if (!entity) continue;
      const own = entity.ownerId === 0;
      if (!own) {
        const fog = getFog(state.visibility, 0, Math.floor(entity.x), Math.floor(entity.y), state.map.width);
        if (fog !== FOG_VISIBLE) continue;
      }
      g.fillStyle = UNIT_COLOR[entity.ownerId] ?? '#ffffff';
      const size = entity.type === 'building' ? 5 : own ? 4 : 3;
      g.fillRect(entity.x * MINIMAP_PIXELS_PER_TILE - size / 2, entity.y * MINIMAP_PIXELS_PER_TILE - size / 2, size, size);
    }
  }
}
