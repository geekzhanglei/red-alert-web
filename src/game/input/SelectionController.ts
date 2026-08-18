import Phaser from 'phaser';
import { Game } from '../core/Game';
import { EntityState } from '../state/entities';
import { PLAYER_ID } from '../state/GameState';
import { tileAt } from '../state/map';
import { screenToGrid } from '../render/isometric';
import { assignDestinations } from '../pathfinding/destinations';

const DRAG_THRESHOLD = 5; // 像素：小于视为点击，大于视为框选
const CLICK_HIT_RADIUS = 0.6; // 格：点击选单位的命中半径

/**
 * 选择与命令输入（docs/04-selection-pathfinding.md）：
 * - 左键点击选中单位 / 点击空白清空；左键拖拽框选（屏幕矩形反投影为世界 AABB）。
 * - 右键对目标格分配落点后向全部选中单位发 move 命令（寻路由命令系统在应用时计算）。
 * 命令只入队（pendingCommands），由下一 tick 的命令系统统一应用（决策四）。
 */
export class SelectionController {
  private pressX = 0;
  private pressY = 0;
  private pressed = false;
  private boxActive = false;
  private box: Phaser.GameObjects.Rectangle;

  constructor(
    scene: Phaser.Scene,
    private game: Game,
    private cam: Phaser.Cameras.Scene2D.Camera,
  ) {
    // 框选矩形：屏幕空间（scrollFactor 0），放在最上层
    this.box = scene.add
      .rectangle(0, 0, 0, 0, 0xffffff, 0.15)
      .setStrokeStyle(1, 0xffffff, 0.8)
      .setScrollFactor(0)
      .setDepth(100)
      .setVisible(false);

    scene.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.leftButtonDown()) {
        this.pressX = p.x;
        this.pressY = p.y;
        this.pressed = true;
      }
      if (p.rightButtonDown()) this.issueMove(p);
    });
    scene.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!this.pressed || !p.leftButtonDown()) return;
      if (Math.hypot(p.x - this.pressX, p.y - this.pressY) > DRAG_THRESHOLD) {
        this.boxActive = true;
        this.updateBox(this.pressX, this.pressY, p.x, p.y);
        this.selectBox(this.pressX, this.pressY, p.x, p.y); // 拖拽中实时更新选中
      }
    });
    scene.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (!this.pressed) return;
      this.pressed = false;
      if (this.boxActive) {
        this.boxActive = false;
        this.box.setVisible(false);
        this.selectBox(this.pressX, this.pressY, p.x, p.y); // 以释放位置最终结算
      } else if (p.leftButtonReleased() && Math.hypot(p.x - this.pressX, p.y - this.pressY) < DRAG_THRESHOLD) {
        this.selectAt(p);
      }
    });
  }

  /** 点击：选中最上层单位；点空白清空选择。 */
  private selectAt(p: Phaser.Input.Pointer): void {
    const world = this.cam.getWorldPoint(p.x, p.y);
    const hit = this.findTopmostUnit(world.x, world.y);
    this.game.state.selectedEntityIds = hit ? [hit.id] : [];
  }

  /** 框选：屏幕矩形四角反投影 → 世界 AABB → 选中落在其中的己方单位。 */
  private selectBox(sx0: number, sy0: number, sx1: number, sy1: number): void {
    const corners = [
      this.cam.getWorldPoint(sx0, sy0),
      this.cam.getWorldPoint(sx1, sy0),
      this.cam.getWorldPoint(sx0, sy1),
      this.cam.getWorldPoint(sx1, sy1),
    ];
    const minX = Math.min(...corners.map((c) => c.x));
    const maxX = Math.max(...corners.map((c) => c.x));
    const minY = Math.min(...corners.map((c) => c.y));
    const maxY = Math.max(...corners.map((c) => c.y));

    const ids: number[] = [];
    for (const id of this.game.state.entitiesOrder) {
      const e = this.game.state.entities[id];
      if (e && e.type === 'unit' && e.ownerId === PLAYER_ID && e.x >= minX && e.x <= maxX && e.y >= minY && e.y <= maxY) {
        ids.push(id);
      }
    }
    this.game.state.selectedEntityIds = ids;
  }

  private updateBox(sx0: number, sy0: number, sx1: number, sy1: number): void {
    const x = Math.min(sx0, sx1);
    const y = Math.min(sy0, sy1);
    const w = Math.abs(sx1 - sx0);
    const h = Math.abs(sy1 - sy0);
    this.box.setPosition(x + w / 2, y + h / 2);
    this.box.setSize(w, h);
    this.box.setVisible(true);
  }

  /** 找到点击位置附近最上层的单位（渲染按 x+y 深度，最上层近似 = 列表末尾；阶段三用世界点就近即可）。 */
  private findTopmostUnit(wx: number, wy: number): EntityState | null {
    const state = this.game.state;
    for (let i = state.entitiesOrder.length - 1; i >= 0; i--) {
      const e = state.entities[state.entitiesOrder[i]];
      if (e && e.type === 'unit' && Math.hypot(e.x - wx, e.y - wy) <= CLICK_HIT_RADIUS) return e;
    }
    return null;
  }

  /** 右键：给选中的己方单位分配不同落点，各自发 move 命令。目标格不可走则不响应。 */
  private issueMove(p: Phaser.Input.Pointer): void {
    const state = this.game.state;
    const units = state.selectedEntityIds
      .map((id) => state.entities[id])
      .filter((e): e is EntityState => Boolean(e) && e.type === 'unit' && e.ownerId === PLAYER_ID);
    if (units.length === 0) return;

    const world = this.cam.getWorldPoint(p.x, p.y);
    const g = screenToGrid(world.x, world.y);
    const gx = Math.round(g.x);
    const gy = Math.round(g.y);
    const tile = tileAt(state.map, gx, gy);
    if (!tile || !tile.walkable) return; // 不可走格不移动

    const dests = assignDestinations(state.map, { x: gx, y: gy }, units.length, (x, y) => this.isFreeDestination(x, y));
    units.forEach((e, i) => {
      const d = dests[i];
      if (d) {
        state.pendingCommands.push({ type: 'move', playerId: PLAYER_ID, entityId: e.id, targetX: d.x, targetY: d.y });
      }
    });
  }

  /** 落点可用性：可走且未被静止单位占用（移动中的单位不算障碍）。 */
  private isFreeDestination(x: number, y: number): boolean {
    const state = this.game.state;
    const tile = tileAt(state.map, x, y);
    if (!tile || !tile.walkable) return false;
    if (tile.occupiedBy != null) {
      const occupier = state.entities[tile.occupiedBy];
      if (occupier && occupier.type === 'unit' && occupier.activity === 'moving') return true;
      return false;
    }
    return true;
  }
}
