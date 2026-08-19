import Phaser from 'phaser';
import { Game } from '../core/Game';
import { PLAYER_ID } from '../state/GameState';
import { BuildingDefinition } from '../data/buildings';
import { screenToGrid, gridToScreen } from '../render/isometric';
import { canPlace } from '../state/commands';
import { canAfford } from '../state/players';

/**
 * 建筑放置控制器（docs/06-economy.md §A3）：选种 → 鼠标移动预览（ghost）→ 点击确认 → 取消（Esc/右键空白）。
 * 预览是渲染层概念；实际产生 build 命令在用户左键点击落格时。
 * canPlace / canAfford 在落格时再做一次校验，不能只信预览颜色。
 */
export class BuildingPlacementController {
  private ghost: Phaser.GameObjects.Graphics;
  private label: Phaser.GameObjects.Text;
  private selected: BuildingDefinition | null = null;
  /** 当前鼠标位置（屏幕坐标），ghost 跟随它移动。 */
  private curX = 0;
  private curY = 0;
  private active = false;
  /** 选种按钮在 HUD 上，本控制器通过 onSelect 回调接收。 */
  onCancel: () => void = () => {};

  constructor(
    scene: Phaser.Scene,
    private game: Game,
    private cam: Phaser.Cameras.Scene2D.Camera,
  ) {
    // ghost 使用世界坐标绘制；label 才是跟随屏幕指针的 HUD 元素。
    // 如果给 ghost 设置 scrollFactor(0)，镜头平移/缩放后会与实际落点错位。
    this.ghost = scene.add.graphics().setDepth(90).setVisible(false);
    this.label = scene.add
      .text(0, 0, '', { fontFamily: 'system-ui', fontSize: '12px', color: '#e8edf2' })
      .setScrollFactor(0)
      .setDepth(91)
      .setVisible(false);

    scene.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      this.curX = p.x;
      this.curY = p.y;
    });
    scene.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (!this.active) return;
      if (p.leftButtonDown()) this.tryBuild(p);
      if (p.rightButtonDown()) this.cancel();
    });
    // Esc 取消
    scene.input.keyboard?.on('keydown-ESC', () => this.cancel());
  }

  /** HUD 按钮触发。 */
  select(def: BuildingDefinition): void {
    this.selected = def;
    this.active = true;
    this.ghost.setVisible(true);
    this.label.setVisible(true);
  }

  cancel(): void {
    this.active = false;
    this.selected = null;
    this.ghost.setVisible(false);
    this.label.setVisible(false);
    this.onCancel();
  }

  isActive(): boolean {
    return this.active;
  }

  selectedId(): string | null {
    return this.selected?.id ?? null;
  }

  /** 每帧调用：根据当前鼠标重画 ghost（合法绿色/非法红色）与费用标签。 */
  render(): void {
    if (!this.active || !this.selected) return;
    const world = this.cam.getWorldPoint(this.curX, this.curY);
    const g = screenToGrid(world.x, world.y);
    const gx = Math.round(g.x);
    const gy = Math.round(g.y);
    const def = this.selected;
    const placeable = canPlace(this.game.state, gx, gy, def) && canAfford(this.game.state, PLAYER_ID, def.cost);
    const color = placeable ? 0x4caf50 : 0xe04848;

    this.ghost.clear();
    for (let dy = 0; dy < def.footprint.h; dy++) {
      for (let dx = 0; dx < def.footprint.w; dx++) {
        const c = gridToScreen(gx + dx, gy + dy);
        this.ghost.lineStyle(2, color, 0.9);
        this.ghost.fillStyle(color, 0.2);
        const pts = diamond(c.x, c.y);
        this.ghost.fillPoints(pts, true);
        this.ghost.strokePoints(pts, true, true);
      }
    }
    this.label.setText(`${def.name} $${def.cost} · ${placeable ? '可建' : '不可建'}`);
    this.label.setPosition(this.curX + 14, this.curY + 14);
    this.label.setColor(placeable ? '#a8e0a8' : '#ffa0a0');
  }

  private tryBuild(p: Phaser.Input.Pointer): void {
    if (!this.selected) return;
    const def = this.selected;
    const world = this.cam.getWorldPoint(p.x, p.y);
    const g = screenToGrid(world.x, world.y);
    const gx = Math.round(g.x);
    const gy = Math.round(g.y);
    if (!canPlace(this.game.state, gx, gy, def) || !canAfford(this.game.state, PLAYER_ID, def.cost)) {
      return; // 落格校验失败，保留 ghost 让玩家继续尝试
    }
    this.game.state.pendingCommands.push({ type: 'build', playerId: PLAYER_ID, buildingTypeId: def.id, x: gx, y: gy });
    // 连续放置：扣钱后若仍可负担且不撤销，进入「继续放」体验——这里选择落一次就停，避免误操作花光钱
    this.cancel();
  }
}

function diamond(cx: number, cy: number): Phaser.Geom.Point[] {
  return [
    new Phaser.Geom.Point(cx, cy - 16),
    new Phaser.Geom.Point(cx + 32, cy),
    new Phaser.Geom.Point(cx, cy + 16),
    new Phaser.Geom.Point(cx - 32, cy),
  ];
}
