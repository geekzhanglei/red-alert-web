import Phaser from 'phaser';
import { GameState } from '../state/GameState';
import { EntityState } from '../state/entities';
import { gridToScreen } from './isometric';

/** 按类型配色（玩家蓝色阵营；敌方红色）。 */
const BUILDING_COLORS: Record<number, number> = {
  0: 0x2c4a78, // 玩家：深蓝
  1: 0x6e2828, // 敌方：深红
};

const ROOF_LIGHT: Record<number, number> = {
  0: 0x5a86c9,
  1: 0xc45858,
};

/**
 * 建筑渲染层：每帧从 GameState 全量重绘建筑（与 UnitRenderer 同样的「只读+全量」策略）。
 * 深度：建筑只画一次占 footprint 中心，不参与单位按 x+y 的深度排序——建筑占整个块，从下到上稳定。
 */
export class BuildingRenderer extends Phaser.GameObjects.Graphics {
  constructor(scene: Phaser.Scene) {
    super(scene);
    scene.add.existing(this);
  }

  update(state: GameState): void {
    this.clear();
    // 等距遮挡：先按 y 排序再画
    const drawable: EntityState[] = [];
    for (const id of state.entitiesOrder) {
      const e = state.entities[id];
      if (e && e.type === 'building') drawable.push(e);
    }
    drawable.sort((a, b) => a.y - b.y);

    for (const e of drawable) {
      this.drawBuilding(state, e);
      this.drawBuildingHp(state, e);
    }
  }

  private drawBuilding(state: GameState, e: EntityState): void {
    const def = state.buildingDefs[e.typeId];
    const baseColor = BUILDING_COLORS[e.ownerId] ?? 0x333;
    const roofColor = ROOF_LIGHT[e.ownerId] ?? 0x888;
    // footprint 中心为屏幕中心
    const cx = e.tileX + (def.footprint.w - 1) / 2;
    const cy = e.tileY + (def.footprint.h - 1) / 2;
    const s = gridToScreen(cx, cy);
    const w = def.footprint.w;
    const h = def.footprint.h;
    const halfPx = w * 32; // 2:1 等距
    const halfPy = h * 16;

    // 主体：等距菱形块
    this.fillStyle(baseColor, 1);
    this.fillPoints(
      [
        new Phaser.Geom.Point(s.x, s.y - halfPy),
        new Phaser.Geom.Point(s.x + halfPx, s.y),
        new Phaser.Geom.Point(s.x, s.y + halfPy),
        new Phaser.Geom.Point(s.x - halfPx, s.y),
      ],
      true,
    );
    // 屋顶高亮
    this.fillStyle(roofColor, 0.6);
    this.fillPoints(
      [
        new Phaser.Geom.Point(s.x, s.y - halfPy),
        new Phaser.Geom.Point(s.x + halfPx, s.y),
        new Phaser.Geom.Point(s.x, s.y),
        new Phaser.Geom.Point(s.x - halfPx, s.y),
      ],
      true,
    );
    // 边框
    this.lineStyle(1.5, 0x0d1410, 0.9);
    this.strokeEllipse(s.x, s.y, halfPx * 2, halfPy * 2);
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
