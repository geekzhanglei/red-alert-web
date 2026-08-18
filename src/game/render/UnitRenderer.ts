import Phaser from 'phaser';
import { GameState } from '../state/GameState';
import { EntityState } from '../state/entities';
import { TILE_H, TILE_W, gridToScreen } from './isometric';

/** 按阵营配色的简单位色板；贴图素材就位后由原创 sprite 取代。 */
const OWNER_COLORS: Record<number, number> = {
  0: 0x3f7dff, // 玩家：蓝
  1: 0xe04848, // 敌方：红（阶段六）
};

/**
 * 单位渲染层：每帧从 GameState 全量重绘单位、选中环与移动目标标记。
 * 只读状态，绝不写回（docs/01-architecture.md 决策一）。
 * 位置用 prevX/prevY 与当前值按 alpha 插值，让固定 tick 的移动在渲染帧上平滑。
 */
export class UnitRenderer extends Phaser.GameObjects.Graphics {
  constructor(scene: Phaser.Scene) {
    super(scene);
    scene.add.existing(this);
  }

  update(state: GameState, alpha: number): void {
    this.clear();
    this.drawTargetMarkers(state);
    this.drawMovePaths(state);

    // 等距遮挡：按渲染位置的 x+y（远→近）排序，重叠时后面的单位盖住前面的。
    // 排序用插值后的位置，避免单位移动时绘制顺序来回抖动。
    const drawable: { e: EntityState; px: number; py: number }[] = [];
    for (const id of state.entitiesOrder) {
      const e = state.entities[id];
      if (!e || e.type !== 'unit') continue;
      drawable.push({ e, px: this.lerp(e.prevX, e.x, alpha), py: this.lerp(e.prevY, e.y, alpha) });
    }
    drawable.sort((a, b) => a.px + a.py - (b.px + b.py));

    for (const { e, px, py } of drawable) {
      this.drawUnit(state, e, px, py);
      if (state.selectedEntityIds.includes(e.id)) this.drawSelectionRing(e, px, py);
    }
  }

  private drawUnit(state: GameState, e: EntityState, px: number, py: number): void {
    const s = gridToScreen(px, py);
    const color = OWNER_COLORS[e.ownerId] ?? 0xffffff;
    // 等距下 y 轴视觉压缩为一半：世界朝向角 → 屏幕显示角。
    const screenAngle = Math.atan2(Math.sin(e.facing) * TILE_H, Math.cos(e.facing) * TILE_W);

    this.save();
    this.translateCanvas(s.x, s.y);
    this.rotateCanvas(screenAngle);
    if (e.typeId === 'tank') {
      this.fillStyle(color, 1);
      this.fillRoundedRect(-10, -7, 20, 14, 3);
      this.fillStyle(0x20342a, 1);
      this.fillRect(-10, -3, 8, 3);
      this.fillRect(-10, 2, 8, 3);
      this.fillStyle(0xe8edf2, 0.95);
      this.fillRect(2, -1.5, 8, 3);
    } else {
      this.fillStyle(color, 1);
      this.fillCircle(0, 0, 5);
      this.lineStyle(1.5, 0xe8edf2, 0.9);
      this.lineBetween(0, 0, 7, 0);
    }
    this.restore();
  }

  private drawSelectionRing(e: EntityState, px: number, py: number): void {
    const s = gridToScreen(px, py);
    this.lineStyle(2, 0xf2d93b, 0.95);
    this.strokeEllipse(s.x, s.y, 20, 10); // 2:1 等距扁椭圆
  }

  /** 选中且正在移动的单位画寻路路径折线（从当前位置到终点），便于验证寻路。 */
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
