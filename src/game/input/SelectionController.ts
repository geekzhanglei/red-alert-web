import Phaser from 'phaser';
import { Game } from '../core/Game';
import { EntityState } from '../state/entities';
import { PLAYER_ID } from '../state/GameState';
import { tileAt } from '../state/map';
import { gridToScreen, screenToGrid } from '../render/isometric';
import { assignDestinations } from '../pathfinding/destinations';
import { isEntityAnchorInRect, isPointInTileDiamond } from './selectionGeometry';

const DRAG_THRESHOLD = 5; // 像素：小于视为点击，大于视为框选
const UNIT_CLICK_RADIUS = 22; // 地图世界像素：单位地面锚点的点击半径

export interface SelectionControllerOptions {
  /** 小地图、建筑放置等模式可以临时接管指针，避免一次点击触发两套命令。 */
  isPointerBlocked?: (screenX: number, screenY: number) => boolean;
}

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
  private canvas: HTMLCanvasElement;
  private activePointerId: number | null = null;

  constructor(
    private scene: Phaser.Scene,
    private game: Game,
    private cam: Phaser.Cameras.Scene2D.Camera,
    private options: SelectionControllerOptions = {},
  ) {
    // 框选矩形：屏幕空间（scrollFactor 0），放在最上层
    this.box = scene.add
      .rectangle(0, 0, 0, 0, 0xffffff, 0.15)
      .setStrokeStyle(1, 0xffffff, 0.8)
      .setScrollFactor(0)
      .setDepth(100)
      .setVisible(false);

    // 选择只保留一套 DOM Pointer Events。此前 Phaser + DOM 双绑定会重复改 pressed，
    // 且 pointermove 的 button 通常为 -1，导致兜底路径永远无法进入框选。
    this.canvas = scene.game.canvas as HTMLCanvasElement;
    this.canvas.style.touchAction = 'none';
    const domDown = (e: PointerEvent) => {
      const p = this.clientToGame(e.clientX, e.clientY);
      if (this.options.isPointerBlocked?.(p.x, p.y)) return;
      if (e.button === 2) {
        this.onRightClickScreen(p.x, p.y);
        e.preventDefault();
        return;
      }
      if (e.button === 0) {
        this.pressX = p.x;
        this.pressY = p.y;
        this.pressed = true;
        this.boxActive = false;
        this.activePointerId = e.pointerId;
        this.canvas.setPointerCapture?.(e.pointerId);
        e.preventDefault();
      }
    };
    const domMove = (e: PointerEvent) => {
      if (!this.pressed || e.pointerId !== this.activePointerId) return;
      const p = this.clientToGame(e.clientX, e.clientY);
      if (Math.hypot(p.x - this.pressX, p.y - this.pressY) > DRAG_THRESHOLD) {
        this.boxActive = true;
        this.updateBox(this.pressX, this.pressY, p.x, p.y);
        this.selectBox(this.pressX, this.pressY, p.x, p.y);
      }
    };
    const domUp = (e: PointerEvent) => {
      if (!this.pressed || e.pointerId !== this.activePointerId) return;
      const p = this.clientToGame(e.clientX, e.clientY);
      this.pressed = false;
      this.activePointerId = null;
      if (this.boxActive) {
        this.boxActive = false;
        this.box.setVisible(false);
        this.selectBox(this.pressX, this.pressY, p.x, p.y);
      } else if (Math.hypot(p.x - this.pressX, p.y - this.pressY) < DRAG_THRESHOLD) {
        this.selectAtScreen(p.x, p.y);
      }
    };
    const domCancel = (e: PointerEvent) => {
      if (e.pointerId !== this.activePointerId) return;
      this.pressed = false;
      this.boxActive = false;
      this.activePointerId = null;
      this.box.setVisible(false);
    };
    this.canvas.addEventListener('pointerdown', domDown);
    this.canvas.addEventListener('pointermove', domMove);
    this.canvas.addEventListener('pointerup', domUp);
    this.canvas.addEventListener('pointercancel', domCancel);
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** 用屏幕坐标（DOM 事件原始 clientX/Y）选中。 */
  private selectAtScreen(screenX: number, screenY: number): void {
    const world = this.cam.getWorldPoint(screenX, screenY);
    const hit = this.findTopmostEntity(world.x, world.y, PLAYER_ID);
    this.game.state.selectedEntityIds = hit ? [hit.id] : [];
  }

  /** DOM client 坐标 → Phaser 游戏画布坐标，兼容页面偏移与 CSS 缩放。 */
  private clientToGame(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left) * (this.scene.scale.width / rect.width),
      y: (clientY - rect.top) * (this.scene.scale.height / rect.height),
    };
  }

  /** 框选：屏幕矩形反投影为地图世界矩形，选中锚点落入其中的己方实体。 */
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
      // 不能把逻辑格坐标 e.x/e.y 与渲染世界像素 minX/minY 混比。
      // 先将实体锚点投影到同一坐标系，建筑和单位共用这一规则。
      if (e && e.ownerId === PLAYER_ID && isEntityAnchorInRect(e, minX, minY, maxX, maxY)) {
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

  /** 找到点击位置最上层实体。单位优先于建筑，避免点在站在建筑上的单位时误选建筑。 */
  private findTopmostEntity(wx: number, wy: number, ownerId?: number): EntityState | null {
    const state = this.game.state;
    for (let i = state.entitiesOrder.length - 1; i >= 0; i--) {
      const e = state.entities[state.entitiesOrder[i]];
      if (
        e &&
        e.type === 'unit' &&
        (ownerId === undefined || e.ownerId === ownerId) &&
        this.pointHitsUnit(wx, wy, e)
      ) {
        return e;
      }
    }
    for (let i = state.entitiesOrder.length - 1; i >= 0; i--) {
      const e = state.entities[state.entitiesOrder[i]];
      if (
        e &&
        e.type === 'building' &&
        (ownerId === undefined || e.ownerId === ownerId) &&
        e.occupiedTiles.some((t) => isPointInTileDiamond(wx, wy, t.x, t.y))
      ) {
        return e;
      }
    }
    return null;
  }

  private pointHitsUnit(wx: number, wy: number, e: EntityState): boolean {
    const anchor = gridToScreen(e.x, e.y);
    return Math.hypot(anchor.x - wx, anchor.y - wy) <= UNIT_CLICK_RADIUS;
  }

  /**
   * 右键：点在敌方实体（单位或建筑）上 → 对全部选中单位发 attack；否则对目标格分配落点发 move。
   * 目标格不可走则不响应。命令只入队，由下一 tick 统一应用。
   */
  private onRightClickScreen(screenX: number, screenY: number): void {
    const state = this.game.state;
    const units = state.selectedEntityIds
      .map((id) => state.entities[id])
      .filter((e): e is EntityState => Boolean(e) && e.type === 'unit' && e.ownerId === PLAYER_ID);
    if (units.length === 0) return;

    const world = this.cam.getWorldPoint(screenX, screenY);
    const target = this.findTopmostEntity(world.x, world.y);
    if (target && target.ownerId !== PLAYER_ID) {
      // 攻击命令：右键敌方单位
      for (const e of units) {
        state.pendingCommands.push({ type: 'attack', playerId: PLAYER_ID, entityId: e.id, targetEntityId: target.id });
      }
      return;
    }

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
