import Phaser from 'phaser';
import { GameState } from '../state/GameState';
import { EntityState } from '../state/entities';
import { gridToScreen } from './isometric';
import { FOG_VISIBLE, getFog } from '../state/visibility';
import { textureKeyFor } from '../../assets/loadSprites';
import { getUnitFacingFrame } from './unitFacing';
import { getUnitMotionVisual } from './unitAnimation';
import type { UnitMotionVisual } from './unitAnimation';

/**
 * 单位渲染层（贴图版）：用对象池管理单位 Image，每帧 setPosition/setRotation/setTexture。
 * 选区环 / 移动路径 / 目标标记 / 血条 / 弹道仍是 Graphics。
 * 实体对 viewer 视角的可见性：己方永远画；敌方必须可见。
 */
export class UnitRenderer extends Phaser.GameObjects.Graphics {
  private shots: { x1: number; y1: number; x2: number; y2: number; bornAt: number }[] = [];
  private hitEffects: {
    targetId: number;
    targetOwnerId: number;
    x: number;
    y: number;
    hpRatio: number;
    bornAt: number;
  }[] = [];
  private pool: Phaser.GameObjects.Image[] = [];
  private glowPool: (Phaser.FX.Glow | null)[] = [];
  private groundLayer: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene) {
    super(scene);
    this.setDepth(31);
    scene.add.existing(this);
    this.groundLayer = scene.add.graphics().setDepth(29);
  }

  update(state: GameState, alpha: number, viewerPlayerId = 0): void {
    this.clear();
    this.groundLayer.clear();
    this.consumeCombatEvents(state);
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

    // 先画接地阴影，再画单位本体。阴影固定在地格中心，能稳定住等距视角下的视觉锚点，
    // 移动时只沿真实位移方向留下很短的尘迹，不做上下 bob，避免单位像漂浮在地图上。
    this.drawGrounding(drawable, state, alpha);

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
          const motion = getUnitMotionVisual(e, state.tick, alpha);
          // 轻微横向步伐形变让静态方向图集有行进节奏；纵向比例保持不变，接地点不会上下跳。
          img.setScale(img.scaleX * motion.scaleX, img.scaleY);
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

    // 贴图轮廓由 PreFX Glow 高亮，选中单位不再画底部圆圈。
    for (const { e, px, py } of drawable) {
      const selected = state.selectedEntityIds.includes(e.id);
      this.drawHpBar(e, state, px, py, selected);
    }
    this.drawDamageEffects(state, viewerPlayerId);
  }

  private consumeCombatEvents(state: GameState): void {
    const now = this.scene.time.now;
    for (const ev of state.events) {
      if (ev.type === 'shot') {
        this.shots.push({ x1: ev.fromX, y1: ev.fromY, x2: ev.toX, y2: ev.toY, bornAt: now });
      } else if (ev.type === 'hit') {
        this.hitEffects.push({ ...ev, bornAt: now });
      }
    }
    state.events.length = 0;
    this.shots = this.shots.filter((s) => now - s.bornAt < 150);
    this.hitEffects = this.hitEffects.filter((hit) => now - hit.bornAt < 520);
    for (const s of this.shots) {
      const fade = 1 - (now - s.bornAt) / 150;
      const from = gridToScreen(s.x1, s.y1);
      const to = gridToScreen(s.x2, s.y2);
      this.lineStyle(1.5, 0xffd24a, fade);
      this.lineBetween(from.x, from.y, to.x, to.y);
    }
  }

  /**
   * 受击反馈：血量下降后持续冒灰烟，命中瞬间再叠加闪光和扩散环。
   * 这些效果只存在渲染层，不把时间戳写入 GameState，因此不会影响回放确定性。
   */
  private drawDamageEffects(state: GameState, viewerPlayerId: number): void {
    const now = this.scene.time.now;
    for (const id of state.entitiesOrder) {
      const e = state.entities[id];
      if (!e || !isVisibleTo(state, e, viewerPlayerId)) continue;
      const def = e.type === 'unit' ? state.defs[e.typeId] : state.buildingDefs[e.typeId];
      const maxHp = def.maxHp * e.hpMultiplier;
      const ratio = Math.max(0, e.hp / maxHp);
      if (ratio >= 0.82) continue;
      this.drawSmoke(e, ratio, now);
    }

    for (const hit of this.hitEffects) {
      if (!this.canShowDamageAt(state, hit.targetOwnerId, hit.x, hit.y, viewerPlayerId)) continue;
      const age = now - hit.bornAt;
      const progress = Math.min(1, age / 520);
      const fade = 1 - progress;
      const p = gridToScreen(hit.x, hit.y);
      const pulse = 1 - Math.min(1, age / 120);
      this.fillStyle(0xffe3a0, 0.16 * pulse);
      this.fillCircle(p.x, p.y - 10, 5 + pulse * 5);
      this.lineStyle(1.5, 0xffd35a, 0.68 * fade);
      this.strokeCircle(p.x, p.y - 10, 8 + progress * 8);
      for (let i = 0; i < 3; i++) {
        const angle = i * 2.1 + hit.targetId * 0.37;
        const drift = progress * (8 + i * 3);
        const sx = p.x + Math.cos(angle) * drift;
        const sy = p.y - 12 - progress * (10 + i * 4) + Math.sin(angle) * drift * 0.35;
        this.fillStyle(0x59635d, 0.2 * fade);
        this.fillEllipse(sx, sy, 5 + i * 2 + progress * 5, 3 + i + progress * 3);
      }
    }
  }

  private drawSmoke(e: EntityState, ratio: number, now: number): void {
    const p = gridToScreen(e.x, e.y);
    const severity = Phaser.Math.Clamp(1 - ratio, 0.18, 1);
    const originY = p.y - (e.type === 'building' ? 34 : e.typeId === 'infantry' || e.typeId === 'rocketTrooper' ? 17 : 21);
    const phase = now / 420 + e.id * 0.23;
    for (let i = 0; i < 3; i++) {
      const rise = ((phase + i * 0.32) % 1) * (8 + severity * 10);
      const drift = Math.sin(phase * 2 + i * 1.7) * (2 + severity * 3);
      this.fillStyle(i === 0 ? 0x26342f : 0x53605a, (0.16 + severity * 0.1) * (1 - i * 0.16));
      this.fillEllipse(
        p.x + drift + (i - 1) * 3,
        originY - rise - i * 3,
        7 + severity * 6 + i * 2,
        4 + severity * 4 + i,
      );
    }
    if (ratio < 0.45) {
      this.fillStyle(0xff8a3d, 0.24 + severity * 0.14);
      this.fillCircle(p.x + Math.sin(phase) * 2, originY + 2, 2.5 + severity * 2);
    }
  }

  private canShowDamageAt(state: GameState, ownerId: number, x: number, y: number, viewerPlayerId: number): boolean {
    if (ownerId === viewerPlayerId) return true;
    return getFog(state.visibility, viewerPlayerId, Math.floor(x), Math.floor(y), state.map.width) === FOG_VISIBLE;
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

  private drawGrounding(drawable: { e: EntityState; px: number; py: number }[], state: GameState, alpha: number): void {
    for (const { e, px, py } of drawable) {
      const current = gridToScreen(px, py);
      const visual = UNIT_VISUALS[e.typeId] ?? DEFAULT_UNIT_VISUAL;
      const shadowWidth = Math.max(16, visual.width * 0.58);
      const shadowHeight = e.typeId === 'infantry' || e.typeId === 'rocketTrooper' ? 4 : 6;

      this.groundLayer.fillStyle(0x061018, e.activity === 'moving' ? 0.24 : 0.34);
      this.groundLayer.fillEllipse(current.x, current.y + 2, shadowWidth, shadowHeight);

      if (e.activity !== 'moving') continue;
      const motion = getUnitMotionVisual(e, state.tick, alpha);
      const previous = gridToScreen(e.prevX, e.prevY);
      const dx = current.x - previous.x;
      const dy = current.y - previous.y;
      let distance = Math.hypot(dx, dy);
      // alpha 接近 0 时本帧还没产生可见位移，退回到逻辑朝向，尘迹仍然有稳定方向。
      if (distance < 0.01) {
        const worldDx = Math.cos(e.facing);
        const worldDy = Math.sin(e.facing);
        const facingScreen = gridToScreen(worldDx, worldDy);
        distance = Math.hypot(facingScreen.x, facingScreen.y);
        if (distance > 0) {
          this.drawMotionDust(current.x, current.y, facingScreen.x, facingScreen.y, distance, motion);
        }
        continue;
      }
      if (distance < 0.01) continue;

      // 尘迹长度按本帧实际位移计算，不会在单位停下后继续漂移。
      const trail = Math.min(9, distance * 2.4);
      this.groundLayer.lineStyle(2, 0xc6c7a7, 0.16);
      this.groundLayer.lineBetween(current.x, current.y + 2, current.x - (dx / distance) * trail, current.y + 2 - (dy / distance) * trail);
      this.drawMotionDust(current.x, current.y, dx, dy, distance, motion);
    }
  }

  private drawMotionDust(x: number, y: number, dx: number, dy: number, distance: number, motion: UnitMotionVisual): void {
    const backX = -dx / distance;
    const backY = -dy / distance;
    const sideX = -backY;
    const sideY = backX;
    const pulse = Math.max(0, Math.sin(motion.phase * Math.PI * 2));
    for (let i = 0; i < 2; i++) {
      const spread = (i === 0 ? -1 : 1) * (1.5 + pulse * 1.5);
      const offset = 4 + i * 3 + (1 - pulse) * 2;
      const puffX = x + backX * offset + sideX * spread;
      const puffY = y + 2 + backY * offset + sideY * spread;
      this.groundLayer.fillStyle(0xbfc7ae, 0.08 + pulse * 0.14);
      this.groundLayer.fillEllipse(puffX, puffY, 2.2 + pulse * 2.2, 1.4 + pulse * 1.4);
    }
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

const DEFAULT_UNIT_VISUAL = { width: 32, height: 32, originY: 0.92 };
const UNIT_VISUALS: Record<string, { width: number; height: number; originY: number }> = {
  // 原创图集的接触点都在帧底部附近，统一锚到地面而不是锚到图像几何中心。
  infantry: { width: 46, height: 48, originY: 0.92 },
  tank: { width: 58, height: 48, originY: 0.92 },
  harvester: { width: 60, height: 44, originY: 0.92 },
  rocketTrooper: { width: 48, height: 50, originY: 0.95 },
  scout: { width: 64, height: 48, originY: 0.94 },
  artillery: { width: 70, height: 54, originY: 0.94 },
  heavyTank: { width: 72, height: 56, originY: 0.94 },
};

function isVisibleTo(state: GameState, e: EntityState, viewerPlayerId: number): boolean {
  if (e.ownerId === viewerPlayerId) return true;
  const fog = getFog(state.visibility, viewerPlayerId, Math.floor(e.x), Math.floor(e.y), state.map.width);
  return fog === FOG_VISIBLE;
}
