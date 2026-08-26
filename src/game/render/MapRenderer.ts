import Phaser from 'phaser';
import { MapState } from '../state/map';
import { TILE_H, TILE_W, gridToScreen } from './isometric';
import { GameState } from '../state/GameState';
import { FOG_EXPLORED, FOG_UNEXPLORED, FOG_VISIBLE, getFog } from '../state/visibility';
import { TERRAIN_TEXTURE_KEY } from '../../assets/loadSprites';
import { mulberry32 } from '../core/random';

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
  private terrainDetails: Phaser.GameObjects.Graphics;
  private animatedDetails: Phaser.GameObjects.Graphics;
  private worldBackdrop: Phaser.GameObjects.Graphics;
  private ready = false;

  constructor(scene: Phaser.Scene) {
    this.fog = scene.add.graphics().setDepth(50);
    this.terrainDetails = scene.add.graphics().setDepth(0.5);
    this.animatedDetails = scene.add.graphics().setDepth(2);
    this.worldBackdrop = scene.add.graphics().setDepth(-10);
  }

  init(scene: Phaser.Scene, map: MapState): void {
    // 检查地形贴图是否已加载
    if (!scene.textures.exists('tile_grass')) {
      // 兜底：等一帧再画（实际由 GameScene 加载完后再调 init）
      this.ready = false;
      return;
    }
    this.drawWorldBackdrop(map);
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
    this.drawTerrainDetails(map);
    this.ready = true;
  }

  /**
   * 等距地图的实际可玩区域是菱形，直接露出 Phaser 默认黑色背景会像地图缺了一角。
   * 用一层深橄榄色“不可行走区域”填充包围盒，效果接近红警的地图边缘/不可达区，
   * 同时保留边缘对比，让玩家知道那里不是可操作地块。
   */
  private drawWorldBackdrop(map: MapState): void {
    const bounds = mapWorldBounds(map);
    const pad = 240;
    this.worldBackdrop.clear();
    this.worldBackdrop.fillStyle(0x2b412e, 1);
    this.worldBackdrop.fillRect(bounds.x - pad, bounds.y - pad, bounds.width + pad * 2, bounds.height + pad * 2);
    this.worldBackdrop.lineStyle(26, 0x1f3025, 0.28);
    this.worldBackdrop.strokeRect(bounds.x - 4, bounds.y - 4, bounds.width + 8, bounds.height + 8);
  }

  isReady(): boolean {
    return this.ready;
  }

  /**
   * 地形贴图是低频静态层，额外画一层确定性的草叶、岸线和岩屑，
   * 让重复的菱形贴图拥有远近节奏，又不会把细节放进每帧渲染循环。
   */
  private drawTerrainDetails(map: MapState): void {
    const g = this.terrainDetails;
    g.clear();
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const tile = map.tiles[y * map.width + x];
        const center = gridToScreen(x, y);
        const random = mulberry32((map.seed ^ Math.imul(x + 101, 83492791) ^ Math.imul(y + 313, 19349663)) >>> 0);
        const jitter = () => random() - 0.5;
        if (tile.terrain === 'grass') {
          // 很低对比度的色块变化打破“同一张贴图平铺”的棋盘感，同时保留可读的格线。
          const wash = random() > 0.5 ? 0x7da55e : 0x345e3f;
          g.fillStyle(wash, 0.075);
          g.fillPoints([
            new Phaser.Geom.Point(center.x, center.y - TILE_H / 2),
            new Phaser.Geom.Point(center.x + TILE_W / 2, center.y),
            new Phaser.Geom.Point(center.x, center.y + TILE_H / 2),
            new Phaser.Geom.Point(center.x - TILE_W / 2, center.y),
          ], true);
          for (let i = 0; i < 2; i++) {
            const px = center.x + jitter() * 38;
            const py = center.y + jitter() * 14;
            g.lineStyle(0.8, i === 0 ? 0x9fbd62 : 0x315f3e, 0.22);
            g.lineBetween(px, py + 2, px + jitter() * 2, py - 2 - random() * 2);
          }
          if (random() > 0.76) {
            g.fillStyle(0xc7b66a, 0.18);
            g.fillCircle(center.x + jitter() * 42, center.y + jitter() * 13, 0.8 + random() * 0.8);
          }
        } else if (tile.terrain === 'water') {
          const shift = jitter() * 5;
          g.lineStyle(0.8, 0x9bd5e4, 0.2);
          g.beginPath();
          g.moveTo(center.x - 21, center.y + shift);
          g.lineTo(center.x - 7, center.y - 3 + shift);
          g.lineTo(center.x + 7, center.y + shift);
          g.lineTo(center.x + 21, center.y - 3 + shift);
          g.strokePath();
        } else if (tile.terrain === 'rock') {
          g.fillStyle(0xadb0a1, 0.28);
          g.fillPoints([
            new Phaser.Geom.Point(center.x - 9 + jitter() * 5, center.y + 2 + jitter() * 4),
            new Phaser.Geom.Point(center.x - 3 + jitter() * 4, center.y - 3 + jitter() * 3),
            new Phaser.Geom.Point(center.x + 3 + jitter() * 4, center.y + jitter() * 3),
            new Phaser.Geom.Point(center.x + jitter() * 6, center.y + 5 + jitter() * 3),
          ], true);
        }
      }
    }
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

  /**
   * 低成本的环境动画：水面反光与矿脉闪烁每帧更新，保持逻辑地图和渲染动画完全分离。
   * 这层位于资源贴图上方、建筑/单位下方，能让静态地块有持续的呼吸感。
   */
  updateAnimations(state: GameState, now: number): void {
    if (!this.ready) return;
    const g = this.animatedDetails;
    g.clear();
    const map = state.map;
    const time = now / 1000;
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const idx = y * map.width + x;
        const tile = map.tiles[idx];
        const center = gridToScreen(x, y);
        const phase = time * 1.35 + ((map.seed ^ Math.imul(x + 17, 92821) ^ Math.imul(y + 31, 68917)) >>> 0) % 97 / 19;
        if (tile.terrain === 'water') {
          // 水波不使用贴图位移，只移动高光线，避免地图边缘出现撕裂。
          const shift = Math.sin(phase) * 3.5;
          const alpha = 0.12 + (Math.sin(phase * 0.7) + 1) * 0.045;
          g.lineStyle(1.15, 0xa6e8f4, alpha);
          g.beginPath();
          g.moveTo(center.x - 20, center.y - 2 + shift);
          g.lineTo(center.x - 7, center.y - 5 + shift);
          g.lineTo(center.x + 7, center.y - 2 + shift);
          g.lineTo(center.x + 20, center.y - 5 + shift);
          g.strokePath();
          g.lineStyle(0.8, 0x56b5d5, alpha * 0.65);
          g.lineBetween(center.x - 13, center.y + 4 - shift * 0.45, center.x + 13, center.y + 1 - shift * 0.45);
        } else if (tile.terrain === 'ore' && tile.oreAmount > 0) {
          // 矿石闪光点帮助玩家快速辨认资源区，同时随储量减少而变弱。
          const ratio = Phaser.Math.Clamp(tile.oreAmount / 1000, 0.18, 1);
          const pulse = (Math.sin(phase * 1.8) + 1) / 2;
          const sparkleAlpha = (0.08 + pulse * 0.2) * ratio;
          g.fillStyle(0xffed8a, sparkleAlpha);
          g.fillCircle(center.x - 12 + Math.sin(phase) * 3, center.y - 3, 1.2 + pulse * 1.2);
          g.fillCircle(center.x + 10 + Math.cos(phase * 0.8) * 2, center.y + 2, 0.8 + pulse);
        }
      }
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
