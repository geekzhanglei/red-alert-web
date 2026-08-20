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

    // 选中边框与血条。建筑满血时仅在选中状态展示血条，避免地图信息过载。
    for (const e of drawable) {
      const selected = state.selectedEntityIds.includes(e.id);
      if (selected) this.drawBuildingSelection(e);
      this.drawBuildingHp(state, e, selected);
    }
  }

  private drawBuildingSelection(e: EntityState): void {
    // 不画逐格网线：选中反馈应是建筑整体的能量底光，而不是占地调试图。
    // 建筑的 occupiedTiles 始终由 spawnBuilding 按 footprint 填充。
    const width = Math.max(...e.occupiedTiles.map((t) => t.x)) - Math.min(...e.occupiedTiles.map((t) => t.x)) + 1;
    const height = Math.max(...e.occupiedTiles.map((t) => t.y)) - Math.min(...e.occupiedTiles.map((t) => t.y)) + 1;
    const left = Math.min(...e.occupiedTiles.map((t) => t.x));
    const top = Math.min(...e.occupiedTiles.map((t) => t.y));
    const topPoint = gridToScreen(left, top);
    const rightPoint = gridToScreen(left + width - 1, top);
    const bottomPoint = gridToScreen(left + width - 1, top + height - 1);
    const leftPoint = gridToScreen(left, top + height - 1);
    const points = [
      { x: topPoint.x, y: topPoint.y - 16 },
      { x: rightPoint.x + 32, y: rightPoint.y },
      { x: bottomPoint.x, y: bottomPoint.y + 16 },
      { x: leftPoint.x - 32, y: leftPoint.y },
    ];

    // 贴图下的柔和蓝光，外侧留出少量发光边缘。
    this.selectionGlow.fillStyle(0x168dff, 0.23);
    this.selectionGlow.fillTriangle(points[0].x, points[0].y, points[1].x, points[1].y, points[2].x, points[2].y);
    this.selectionGlow.fillTriangle(points[0].x, points[0].y, points[2].x, points[2].y, points[3].x, points[3].y);
    this.selectionGlow.lineStyle(7, 0x168dff, 0.14);
    this.drawOutline(this.selectionGlow, points);

    // 贴图表面只叠一层很淡的冷色，高亮本体而不盖住建筑细节。
    this.fillStyle(0x6ed4ff, 0.08);
    this.fillTriangle(points[0].x, points[0].y, points[1].x, points[1].y, points[2].x, points[2].y);
    this.fillTriangle(points[0].x, points[0].y, points[2].x, points[2].y, points[3].x, points[3].y);
    this.lineStyle(1.5, 0x7bd8ff, 0.95);
    this.drawOutline(this, points);
  }

  private drawOutline(graphics: Phaser.GameObjects.Graphics, points: { x: number; y: number }[]): void {
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      graphics.lineBetween(a.x, a.y, b.x, b.y);
    }
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
