import Phaser from 'phaser';
import { GameState } from '../state/GameState';
import { EntityState } from '../state/entities';
import { gridToScreen, TILE_H, TILE_W } from './isometric';
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
      const img = this.scene.add.image(0, 0, '__DEFAULT').setDepth(20);
      this.pool.push(img);
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
          const originalSize = ORIGINAL_BUILDING_SIZE[e.typeId];
          if (originalSize) img.setDisplaySize(originalSize.w, originalSize.h);
          else img.setScale(Math.max(def.footprint.w, def.footprint.h) / 3);
          if (e.ownerId === 1) img.setTint(ENEMY_TINT);
          else img.clearTint();
          img.setPosition(s.x, s.y);
        } else {
          img.setVisible(false);
        }
      } else {
        img.setVisible(false);
      }
    }

    // 原版选中建筑不弹出侧栏详情卡，直接在地图实体上显示生命条。
    for (const e of drawable) {
      const selected = state.selectedEntityIds.includes(e.id);
      if (selected) this.drawSelectionContour(state, e);
      this.drawBuildingHp(state, e, selected);
    }
  }

  /**
   * 建筑选中反馈必须覆盖完整 footprint，而不是给每个地格画一个小矩形。
   * 用 footprint 外轮廓做一条轻量的等距菱形描边，既能看出占地范围，也不会盖住建筑贴图。
   */
  private drawSelectionContour(state: GameState, e: EntityState): void {
    const def = state.buildingDefs[e.typeId];
    const top = gridToScreen(e.tileX, e.tileY);
    const right = gridToScreen(e.tileX + def.footprint.w - 1, e.tileY);
    const bottom = gridToScreen(e.tileX + def.footprint.w - 1, e.tileY + def.footprint.h - 1);
    const left = gridToScreen(e.tileX, e.tileY + def.footprint.h - 1);
    const points = [
      { x: top.x, y: top.y - TILE_H / 2 },
      { x: right.x + TILE_W / 2, y: right.y },
      { x: bottom.x, y: bottom.y + TILE_H / 2 },
      { x: left.x - TILE_W / 2, y: left.y },
    ];
    const pulse = 0.78 + Math.sin(this.scene.time.now / 260) * 0.14;

    this.fillStyle(0x36c8ff, 0.055);
    this.fillPoints(points, true);
    this.lineStyle(6, 0x35cfff, 0.12 * pulse);
    this.strokePoints(points, true);
    this.lineStyle(2, 0x9aeaff, 0.92 * pulse);
    this.strokePoints(points, true);
  }

  private drawBuildingHp(state: GameState, e: EntityState, selected: boolean): void {
    const def = state.buildingDefs[e.typeId];
    const maxHp = def.maxHp * e.hpMultiplier;
    if (e.hp >= maxHp && !selected) return;
    const s = gridToScreen(e.x, e.y);
    const spriteSize = ORIGINAL_BUILDING_SIZE[e.typeId] ?? { w: def.footprint.w * 64, h: def.footprint.h * 48 };
    const ratio = Math.max(0, e.hp / maxHp);
    const w = Math.max(28, Math.min(96, spriteSize.w * 0.5));
    const y = s.y - spriteSize.h * 0.5 - 7;
    this.fillStyle(0x111, 0.7);
    this.fillRect(s.x - w / 2, y, w, 4);
    this.fillStyle(ratio > 0.5 ? 0x4caf50 : ratio > 0.25 ? 0xffa726 : 0xe04848, 1);
    this.fillRect(s.x - w / 2, y, w * ratio, 4);
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
