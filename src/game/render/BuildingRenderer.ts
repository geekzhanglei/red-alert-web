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
        this.drawBuildingActivity(state, e);
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

  /** 建筑常驻动效：设备灯、炉火、雷达扫描和生产指示，让基地不再像静态贴图堆。 */
  private drawBuildingActivity(state: GameState, e: EntityState): void {
    const s = gridToScreen(e.x, e.y);
    const time = this.scene.time.now / 1000;
    const phase = time * 1.7 + e.id * 0.41;
    const flicker = 0.58 + (Math.sin(phase * 2.4) + 1) * 0.14;

    if (e.typeId === 'refinery') {
      const fx = s.x;
      const fy = s.y - 41;
      this.fillStyle(0xffb52e, 0.08 * flicker);
      this.fillCircle(fx, fy, 14 + Math.sin(phase) * 2);
      this.fillStyle(0xffdf6d, 0.75 * flicker);
      this.fillCircle(fx - 3, fy + 2, 2.5 + Math.sin(phase * 1.8) * 0.8);
      this.drawBuildingSmoke(fx + 14, fy - 15, phase, 0.72);
    } else if (e.typeId === 'powerPlant') {
      const py = s.y - 39;
      this.fillStyle(0x60e8ff, 0.16 + flicker * 0.1);
      this.fillCircle(s.x - 20, py + 12, 2.1 + flicker * 1.2);
      this.fillCircle(s.x + 20, py + 8, 1.8 + flicker);
      this.lineStyle(1.2, 0x72dfff, 0.38 + flicker * 0.18);
      this.lineBetween(s.x - 18, py + 12, s.x - 10, py + 8);
      this.lineBetween(s.x + 10, py + 8, s.x + 20, py + 8);
    } else if (e.typeId === 'factory') {
      const doorY = s.y + 12;
      const doorPulse = (Math.sin(phase * 1.3) + 1) / 2;
      this.fillStyle(0xffa33b, 0.12 + doorPulse * 0.18);
      this.fillRect(s.x - 19, doorY, 38, 4);
      this.lineStyle(1.2, 0xffcc67, 0.35 + doorPulse * 0.35);
      this.lineBetween(s.x - 15, doorY - 1, s.x - 15, doorY + 4);
      this.lineBetween(s.x + 15, doorY - 1, s.x + 15, doorY + 4);
      if (e.productionQueue.length > 0) this.drawProductionSpinner(s.x, s.y - 61, phase);
    } else if (e.typeId === 'barracks') {
      const windowPulse = 0.36 + (Math.sin(phase * 1.2) + 1) * 0.16;
      this.fillStyle(0x72c8ff, windowPulse);
      this.fillRect(s.x - 20, s.y - 15, 5, 3);
      this.fillRect(s.x + 15, s.y - 15, 5, 3);
      if (e.productionQueue.length > 0) this.drawProductionSpinner(s.x, s.y - 48, phase);
    } else if (e.typeId === 'radar') {
      const radius = 22;
      const angle = phase * 0.65;
      this.lineStyle(1.35, 0x6de8ff, 0.56);
      this.lineBetween(s.x, s.y - 30, s.x + Math.cos(angle) * radius, s.y - 30 + Math.sin(angle) * radius * 0.45);
      this.lineStyle(1, 0x5fdcf2, 0.12);
      this.strokeCircle(s.x, s.y - 30, radius);
    } else if (e.typeId === 'guardTower') {
      const pulse = (Math.sin(phase * 1.15) + 1) / 2;
      this.lineStyle(1.4, 0xffc44b, 0.16 + pulse * 0.24);
      this.strokeCircle(s.x, s.y - 16, 22 + pulse * 5);
      this.fillStyle(0xffe29a, 0.35 + pulse * 0.3);
      this.fillCircle(s.x, s.y - 35, 2 + pulse * 1.2);
    } else if (e.typeId === 'base') {
      const pulse = (Math.sin(phase * 0.8) + 1) / 2;
      this.lineStyle(1.4, 0x52d5ff, 0.12 + pulse * 0.22);
      this.strokeCircle(s.x, s.y + 15, 47 + pulse * 3);
      this.fillStyle(0x6ce6ff, 0.16 + pulse * 0.18);
      this.fillCircle(s.x, s.y - 55, 2 + pulse * 1.5);
    }
  }

  private drawBuildingSmoke(x: number, y: number, phase: number, strength: number): void {
    for (let i = 0; i < 2; i++) {
      const drift = Math.sin(phase * 0.8 + i * 1.8) * (3 + i * 2);
      const rise = ((phase * 0.35 + i * 0.43) % 1) * 14;
      this.fillStyle(i === 0 ? 0x53635b : 0x8d9789, (0.11 - i * 0.025) * strength);
      this.fillEllipse(x + drift, y - rise - i * 3, 5 + i * 2, 3 + i);
    }
  }

  private drawProductionSpinner(x: number, y: number, phase: number): void {
    const radius = 6;
    const angle = phase * 1.7;
    this.lineStyle(1.6, 0xffd36a, 0.75);
    for (let i = 0; i < 3; i++) {
      const a = angle + i * (Math.PI * 2 / 3);
      this.lineBetween(x + Math.cos(a) * 2, y + Math.sin(a) * 2, x + Math.cos(a) * radius, y + Math.sin(a) * radius);
    }
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
