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
  /** 直接作用在建筑贴图 alpha 上的光效，避免把逻辑 footprint 误画成四块方格。 */
  private glowPool: (Phaser.FX.Glow | null)[] = [];
  /** 置于贴图下方的选中底光，负责让高亮从建筑边缘透出。 */
  private selectionGlow: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene) {
    super(scene);
    this.setDepth(21);
    scene.add.existing(this);
    this.selectionGlow = scene.add.graphics().setDepth(19);
  }

  update(state: GameState, viewerPlayerId = 0): void {
    this.clear();
    this.selectionGlow.clear();
    const drawable: EntityState[] = [];
    for (const id of state.entitiesOrder) {
      const e = state.entities[id];
      if (!e || e.type !== 'building') continue;
      if (!isBuildingVisibleTo(state, e, viewerPlayerId)) continue;
      drawable.push(e);
    }
    drawable.sort((a, b) => a.y - b.y);

    while (this.pool.length < drawable.length) {
      const img = this.scene.add.image(0, 0, '__DEFAULT').setDepth(20);
      const glow = img.preFX?.addGlow(0x55caff, 3.5, 0.38, false) ?? null;
      glow?.setActive(false);
      this.pool.push(img);
      this.glowPool.push(glow);
    }
    for (let i = 0; i < this.pool.length; i++) {
      const img = this.pool[i];
      const glow = this.glowPool[i];
      if (i < drawable.length) {
        const e = drawable[i];
        const def = state.buildingDefs[e.typeId];
        const selected = state.selectedEntityIds.includes(e.id);
        const s = gridToScreen(e.x, e.y);
        const key = textureKeyFor(e.typeId, e.ownerId, 'building');
        if (this.scene.textures.exists(key)) {
          img.setTexture(key);
          img.setVisible(true);
          // 原创位图按 footprint 给出稳定的屏幕尺寸；旧 SVG 仍按原始 96×96 规则缩放。
          const originalSize = ORIGINAL_BUILDING_SIZE[e.typeId];
          if (originalSize) img.setDisplaySize(originalSize.w, originalSize.h);
          else img.setScale(Math.max(def.footprint.w, def.footprint.h) / 3);
          if (e.ownerId === 1) img.setTint(ENEMY_TINT);
          else img.clearTint();
          img.setPosition(s.x, s.y);
          glow?.setActive(selected);
        } else {
          img.setVisible(false);
          glow?.setActive(false);
        }
      } else {
        img.setVisible(false);
        glow?.setActive(false);
      }
    }

    // 选中边框与血条。建筑满血时仅在选中状态展示血条，避免地图信息过载。
    for (const e of drawable) {
      const selected = state.selectedEntityIds.includes(e.id);
      if (selected) this.drawBuildingSelection(e, state.buildingDefs[e.typeId]);
      this.drawBuildingHp(state, e, selected);
    }
  }

  private drawBuildingSelection(e: EntityState, def: GameState['buildingDefs'][string]): void {
    // 选中反馈跟随实际贴图底座，而不是按逻辑格子画菱形；这样不会再出现四块矩形。
    const s = gridToScreen(e.x, e.y);
    const size = ORIGINAL_BUILDING_SIZE[e.typeId] ?? {
      w: Math.max(def.footprint.w, 1) * 64,
      h: Math.max(def.footprint.h, 1) * 48,
    };
    const pulse = 0.16 + Math.sin(this.scene.time.now / 220) * 0.035;
    const width = size.w * 0.86;
    const height = Math.max(16, size.h * 0.2);
    const y = s.y + size.h * 0.34;
    this.selectionGlow.fillStyle(0x168dff, pulse);
    this.selectionGlow.fillEllipse(s.x, y, width, height);
    this.selectionGlow.lineStyle(7, 0x168dff, 0.16);
    this.selectionGlow.strokeEllipse(s.x, y, width + 8, height + 5);
    this.selectionGlow.lineStyle(1.5, 0x82ddff, 0.9);
    this.selectionGlow.strokeEllipse(s.x, y, width, height);
  }

  private drawBuildingHp(state: GameState, e: EntityState, selected: boolean): void {
    const def = state.buildingDefs[e.typeId];
    const maxHp = def.maxHp * e.hpMultiplier;
    if (e.hp >= maxHp && !selected) return;
    const s = gridToScreen(e.x, e.y);
    const ratio = Math.max(0, e.hp / maxHp);
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
  powerPlant: { w: 144, h: 112 },
  guardTower: { w: 144, h: 112 },
  radar: { w: 144, h: 118 },
};

const ENEMY_TINT = 0xc94a55;

function isBuildingVisibleTo(state: GameState, e: EntityState, viewerPlayerId: number): boolean {
  if (e.ownerId === viewerPlayerId) return true;
  // 建筑多格：取中心格 + 任意一格可见就算可见
  for (const t of e.occupiedTiles) {
    if (getFog(state.visibility, viewerPlayerId, t.x, t.y, state.map.width) === FOG_VISIBLE) return true;
  }
  return false;
}
