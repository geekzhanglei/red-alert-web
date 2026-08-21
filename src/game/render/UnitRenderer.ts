import Phaser from 'phaser';
import { GameState } from '../state/GameState';
import { EntityState } from '../state/entities';
import { gridToScreen } from './isometric';
import { FOG_VISIBLE, getFog } from '../state/visibility';
import { textureKeyFor } from '../../assets/loadSprites';
import { getUnitFacingFrame } from './unitFacing';

/**
 * 单位渲染层（贴图版）：用对象池管理单位 Image，每帧 setPosition/setRotation/setTexture。
 * 选区环 / 移动路径 / 目标标记 / 血条 / 弹道仍是 Graphics。
 * 实体对 viewer 视角的可见性：己方永远画；敌方必须可见。
 */
export class UnitRenderer extends Phaser.GameObjects.Graphics {
  private shots: { x1: number; y1: number; x2: number; y2: number; bornAt: number }[] = [];
  private pool: Phaser.GameObjects.Image[] = [];
  private glowPool: (Phaser.FX.Glow | null)[] = [];
  /** 地面选中标记放在单位贴图下方，避免光圈压住车体/人物。 */
  private selectionGround: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene) {
    super(scene);
    this.setDepth(31);
    scene.add.existing(this);
    this.selectionGround = scene.add.graphics().setDepth(29);
  }

  update(state: GameState, alpha: number, viewerPlayerId = 0): void {
    this.clear();
    this.selectionGround.clear();
    this.consumeShotEvents(state);
    this.drawTargetMarkers(state);
    this.drawMovePaths(state);

    // 收集可见单位 + 插值位置
    const drawable: { e: EntityState; px: number; py: number }[] = [];
    for (const id of state.entitiesOrder) {
      const e = state.entities[id];
      if (!e || e.type !== 'unit') continue;
      if (!isVisibleTo(state, e, viewerPlayerId)) continue;
      drawable.push({ e, px: this.lerp(e.prevX, e.x, alpha), py: this.lerp(e.prevY, e.y, alpha) });
    }
    drawable.sort((a, b) => a.px + a.py - (b.px + b.py));

    // 复用/创建 Image
    while (this.pool.length < drawable.length) {
      const img = this.scene.add.image(0, 0, '__DEFAULT').setDepth(30);
      const glow = img.preFX?.addGlow(0x55caff, 2.5, 0.35, false) ?? null;
      glow?.setActive(false);
      this.pool.push(img);
      this.glowPool.push(glow);
    }
    for (let i = 0; i < this.pool.length; i++) {
      const img = this.pool[i];
      const glow = this.glowPool[i];
      if (i < drawable.length) {
        const { e, px, py } = drawable[i];
        const selected = state.selectedEntityIds.includes(e.id);
        const s = gridToScreen(px, py);
        const key = textureKeyFor(e.typeId, e.ownerId, 'unit');
        if (this.scene.textures.exists(key)) {
          img.setTexture(key);
          img.setFrame(getUnitFacingFrame(e.facing));
          img.setVisible(true);
          img.setPosition(s.x, s.y);
          const visual = UNIT_VISUALS[e.typeId] ?? DEFAULT_UNIT_VISUAL;
          img.setDisplaySize(visual.width, visual.height);
          img.setOrigin(0.5, visual.originY);
          if (e.ownerId === 1) img.setTint(ENEMY_TINT);
          else img.clearTint();
          glow?.setActive(selected);
          // 方向由帧表达；整张等距透视图保持直立，不再旋转画布。
          img.setRotation(0);
        } else {
          img.setVisible(false);
          glow?.setActive(false);
        }
      } else {
        img.setVisible(false);
        glow?.setActive(false);
      }
    }

    // 地面光圈 + 血条。实际贴图轮廓由 PreFX Glow 高亮。
    for (const { e, px, py } of drawable) {
      const selected = state.selectedEntityIds.includes(e.id);
      if (selected) this.drawSelectionMarker(e.typeId, px, py);
      this.drawHpBar(e, state, px, py, selected);
    }
  }

  private consumeShotEvents(state: GameState): void {
    const now = this.scene.time.now;
    for (const ev of state.events) {
      if (ev.type === 'shot') {
        this.shots.push({ x1: ev.fromX, y1: ev.fromY, x2: ev.toX, y2: ev.toY, bornAt: now });
      }
    }
    state.events.length = 0;
    this.shots = this.shots.filter((s) => now - s.bornAt < 150);
    for (const s of this.shots) {
      const fade = 1 - (now - s.bornAt) / 150;
      const from = gridToScreen(s.x1, s.y1);
      const to = gridToScreen(s.x2, s.y2);
      this.lineStyle(1.5, 0xffd24a, fade);
      this.lineBetween(from.x, from.y, to.x, to.y);
    }
  }

  private drawSelectionMarker(typeId: string, px: number, py: number): void {
    const s = gridToScreen(px, py);
    const marker = UNIT_SELECTION_MARKERS[typeId] ?? DEFAULT_SELECTION_MARKER;
    const pulse = 0.17 + Math.sin(this.scene.time.now / 220) * 0.035;
    this.selectionGround.fillStyle(0x168dff, pulse);
    this.selectionGround.fillEllipse(s.x, s.y, marker.width, marker.height);
    this.selectionGround.lineStyle(6, 0x168dff, 0.13);
    this.selectionGround.strokeEllipse(s.x, s.y, marker.width + 4, marker.height + 3);
    this.selectionGround.lineStyle(1.5, 0x82ddff, 0.95);
    this.selectionGround.strokeEllipse(s.x, s.y, marker.width, marker.height);
  }

  private drawHpBar(e: EntityState, state: GameState, px: number, py: number, selected: boolean): void {
    const def = e.type === 'unit' ? state.defs[e.typeId] : state.buildingDefs[e.typeId];
    const maxHp = def.maxHp * e.hpMultiplier;
    if (e.hp >= maxHp && !selected) return;
    const s = gridToScreen(px, py);
    const w = 18;
    const h = 3;
    const ratio = Math.max(0, e.hp / maxHp);
    this.fillStyle(0x111, 0.7);
    this.fillRect(s.x - w / 2, s.y - 13, w, h);
    this.fillStyle(ratio > 0.5 ? 0x4caf50 : ratio > 0.25 ? 0xffa726 : 0xe04848, 1);
    this.fillRect(s.x - w / 2, s.y - 13, w * ratio, h);
  }

  private drawMovePaths(state: GameState): void {
    for (const id of state.selectedEntityIds) {
      const e = state.entities[id];
      if (!e || e.type !== 'unit' || e.activity !== 'moving' || e.path.length === 0) continue;
      this.lineStyle(1.5, 0xf2d93b, 0.45);
      let prev = gridToScreen(e.x, e.y);
      for (const wp of e.path) {
        const p = gridToScreen(wp.x, wp.y);
        this.lineBetween(prev.x, prev.y, p.x, p.y);
        prev = p;
      }
    }
  }

  private drawTargetMarkers(state: GameState): void {
    for (const id of state.selectedEntityIds) {
      const e = state.entities[id];
      if (!e || e.command?.type !== 'move') continue;
      const t = gridToScreen(e.command.targetX, e.command.targetY);
      this.lineStyle(2, 0xf2d93b, 0.7);
      const r = 6;
      this.lineBetween(t.x - r, t.y - r / 2, t.x + r, t.y + r / 2);
      this.lineBetween(t.x - r, t.y + r / 2, t.x + r, t.y - r / 2);
    }
  }

  private lerp(a: number, b: number, alpha: number): number {
    return a + (b - a) * alpha;
  }
}

const ENEMY_TINT = 0xc94a55;

const DEFAULT_UNIT_VISUAL = { width: 32, height: 32, originY: 0.7 };
const UNIT_VISUALS: Record<string, { width: number; height: number; originY: number }> = {
  infantry: { width: 38, height: 38, originY: 0.78 },
  tank: { width: 50, height: 40, originY: 0.7 },
  harvester: { width: 60, height: 44, originY: 0.68 },
};

const DEFAULT_SELECTION_MARKER = { width: 28, height: 13 };
const UNIT_SELECTION_MARKERS: Record<string, { width: number; height: number }> = {
  infantry: { width: 28, height: 13 },
  tank: { width: 44, height: 20 },
  harvester: { width: 52, height: 23 },
};

function isVisibleTo(state: GameState, e: EntityState, viewerPlayerId: number): boolean {
  if (e.ownerId === viewerPlayerId) return true;
  const fog = getFog(state.visibility, viewerPlayerId, Math.floor(e.x), Math.floor(e.y), state.map.width);
  return fog === FOG_VISIBLE;
}
