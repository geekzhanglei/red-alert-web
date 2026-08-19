import Phaser from 'phaser';
import { GameState } from '../state/GameState';
import { EntityState } from '../state/entities';
import { gridToScreen } from './isometric';
import { FOG_VISIBLE, getFog } from '../state/visibility';
import { textureKeyFor } from '../../assets/loadSprites';

/**
 * 单位渲染层（贴图版）：用对象池管理单位 Image，每帧 setPosition/setRotation/setTexture。
 * 选区环 / 移动路径 / 目标标记 / 血条 / 弹道仍是 Graphics。
 * 实体对 viewer 视角的可见性：己方永远画；敌方必须可见。
 */
export class UnitRenderer extends Phaser.GameObjects.Graphics {
  private shots: { x1: number; y1: number; x2: number; y2: number; bornAt: number }[] = [];
  private pool: Phaser.GameObjects.Image[] = [];

  constructor(scene: Phaser.Scene) {
    super(scene);
    this.setDepth(31);
    scene.add.existing(this);
  }

  update(state: GameState, alpha: number, viewerPlayerId = 0): void {
    this.clear();
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
      this.pool.push(this.scene.add.image(0, 0, '__DEFAULT').setDepth(30));
    }
    for (let i = 0; i < this.pool.length; i++) {
      const img = this.pool[i];
      if (i < drawable.length) {
        const { e, px, py } = drawable[i];
        const s = gridToScreen(px, py);
        const key = textureKeyFor(e.typeId, e.ownerId, 'unit');
        if (this.scene.textures.exists(key)) {
          img.setTexture(key);
          img.setVisible(true);
          img.setPosition(s.x, s.y);
          if (e.typeId === 'tank' && e.ownerId === 0) img.setDisplaySize(42, 30);
          else img.setDisplaySize(32, 32);
          // 等距下 y 轴压缩：世界朝向角 → 屏幕显示角
          // 单位贴图本身是 32×32（横向），方向角直接 rotation
          img.setRotation(e.facing);
        } else {
          img.setVisible(false);
        }
      } else {
        img.setVisible(false);
      }
    }

    // 选中环 + 血条（仍 Graphics）
    for (const { e, px, py } of drawable) {
      if (state.selectedEntityIds.includes(e.id)) this.drawSelectionRing(px, py);
      this.drawHpBar(e, state, px, py);
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

  private drawSelectionRing(px: number, py: number): void {
    const s = gridToScreen(px, py);
    this.lineStyle(2, 0xf2d93b, 0.95);
    this.strokeEllipse(s.x, s.y, 20, 10);
  }

  private drawHpBar(e: EntityState, state: GameState, px: number, py: number): void {
    const def = e.type === 'unit' ? state.defs[e.typeId] : state.buildingDefs[e.typeId];
    if (e.hp >= def.maxHp) return;
    const s = gridToScreen(px, py);
    const w = 18;
    const h = 3;
    const ratio = Math.max(0, e.hp / def.maxHp);
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

function isVisibleTo(state: GameState, e: EntityState, viewerPlayerId: number): boolean {
  if (e.ownerId === viewerPlayerId) return true;
  const fog = getFog(state.visibility, viewerPlayerId, Math.floor(e.x), Math.floor(e.y), state.map.width);
  return fog === FOG_VISIBLE;
}
