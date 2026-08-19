import Phaser from 'phaser';
import { GameState } from '../state/GameState';
import { EntityState } from '../state/entities';
import { gridToScreen } from './isometric';
import { textureKeyFor } from '../../assets/loadSprites';
import { FOG_VISIBLE, getFog } from '../state/visibility';

/**
 * 建筑渲染层（贴图版）：对象池管理 Image，按 footprint 缩放。血条走 Graphics。
 * 敌方建筑在迷雾中不画。
 */
export class BuildingRenderer extends Phaser.GameObjects.Graphics {
  private pool: Phaser.GameObjects.Image[] = [];

  constructor(scene: Phaser.Scene) {
    super(scene);
    this.setDepth(21);
    scene.add.existing(this);
  }

  update(state: GameState, viewerPlayerId = 0): void {
    this.clear();
    const drawable: EntityState[] = [];
    for (const id of state.entitiesOrder) {
      const e = state.entities[id];
      if (!e || e.type !== 'building') continue;
      if (!isBuildingVisibleTo(state, e, viewerPlayerId)) continue;
      drawable.push(e);
    }
    drawable.sort((a, b) => a.y - b.y);

    while (this.pool.length < drawable.length) {
      this.pool.push(this.scene.add.image(0, 0, '__DEFAULT').setDepth(20));
    }
    for (let i = 0; i < this.pool.length; i++) {
      const img = this.pool[i];
      if (i < drawable.length) {
        const e = drawable[i];
        const def = state.buildingDefs[e.typeId];
        const s = gridToScreen(e.x, e.y);
        const key = textureKeyFor(e.typeId, e.ownerId, 'building');
        if (this.scene.textures.exists(key)) {
          img.setTexture(key);
          img.setVisible(true);
          // 原创位图按 footprint 给出稳定的屏幕尺寸；旧 SVG 仍按原始 96×96 规则缩放。
          const originalSize = e.ownerId === 0 ? ORIGINAL_BUILDING_SIZE[e.typeId] : undefined;
          if (originalSize) img.setDisplaySize(originalSize.w, originalSize.h);
          else img.setScale(Math.max(def.footprint.w, def.footprint.h) / 3);
          img.setPosition(s.x, s.y);
        } else {
          img.setVisible(false);
        }
      } else {
        img.setVisible(false);
      }
    }

    // 血条
    for (const e of drawable) this.drawBuildingHp(state, e);
  }

  private drawBuildingHp(state: GameState, e: EntityState): void {
    const def = state.buildingDefs[e.typeId];
    if (e.hp >= def.maxHp) return;
    const s = gridToScreen(e.x, e.y);
    const ratio = Math.max(0, e.hp / def.maxHp);
    const w = def.footprint.w * 24;
    this.fillStyle(0x111, 0.7);
    this.fillRect(s.x - w / 2, s.y - 16, w, 3);
    this.fillStyle(ratio > 0.5 ? 0x4caf50 : ratio > 0.25 ? 0xffa726 : 0xe04848, 1);
    this.fillRect(s.x - w / 2, s.y - 16, w * ratio, 3);
  }
}

const ORIGINAL_BUILDING_SIZE: Record<string, { w: number; h: number }> = {
  base: { w: 192, h: 128 },
  factory: { w: 192, h: 144 },
  barracks: { w: 144, h: 108 },
  refinery: { w: 144, h: 120 },
};

function isBuildingVisibleTo(state: GameState, e: EntityState, viewerPlayerId: number): boolean {
  if (e.ownerId === viewerPlayerId) return true;
  // 建筑多格：取中心格 + 任意一格可见就算可见
  for (const t of e.occupiedTiles) {
    if (getFog(state.visibility, viewerPlayerId, t.x, t.y, state.map.width) === FOG_VISIBLE) return true;
  }
  return false;
}
