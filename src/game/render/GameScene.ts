import Phaser from 'phaser';
import { Game } from '../core/Game';
import { GameLoop, TICK_MS } from '../core/GameLoop';
import { createInitialGameState } from '../state/GameState';
import { Terrain, tileAt } from '../state/map';
import { screenToGrid } from './isometric';
import { drawMapLayer, mapWorldBounds } from './MapRenderer';
import { UnitRenderer } from './UnitRenderer';
import { CameraController } from '../input/CameraController';
import { SelectionController } from '../input/SelectionController';

const TERRAIN_NAMES: Record<Terrain, string> = {
  grass: '草地',
  water: '水域',
  rock: '岩石',
  ore: '矿石',
};

/**
 * 主游戏场景。
 * 渲染帧（Phaser update）只做三件事：用固定 tick 累加器推进逻辑、按当前状态重绘、
 * 处理纯视觉的摄像机操作。逻辑推进永远在 GameLoop 里以固定步长发生（决策二）。
 */
export class GameScene extends Phaser.Scene {
  private sim!: Game;
  private loop = new GameLoop(TICK_MS, () => this.tick());
  private units!: UnitRenderer;
  private cameraControl!: CameraController;
  private tileInfoEl: HTMLElement | null = null;
  private selectionInfoEl: HTMLElement | null = null;

  constructor() {
    super('game');
  }

  create(): void {
    this.sim = new Game(createInitialGameState());

    drawMapLayer(this, this.sim.state.map);
    this.units = new UnitRenderer(this);

    const cam = this.cameras.main;
    const bounds = mapWorldBounds(this.sim.state.map);
    cam.setBounds(bounds.x, bounds.y, bounds.width, bounds.height);
    cam.centerOn(bounds.centerX, bounds.centerY);
    cam.setBackgroundColor('#101511');

    // 阶段二：左键让给选择，平移用中键拖拽 + 边缘滚屏；阶段三左键拖拽再让给框选。
    this.cameraControl = new CameraController(this, cam, { leftButtonPan: false });
    new SelectionController(this, this.sim, cam);

    this.tileInfoEl = document.getElementById('tile-info');
    this.selectionInfoEl = document.getElementById('selection-info');
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.updateTileInfo(p));
  }

  update(_time: number, delta: number): void {
    this.loop.frame(delta);
    this.units.update(this.sim.state, this.loop.alpha);
    this.cameraControl.update(delta / 1000, this.scale.width, this.scale.height);
    this.updateSelectionInfo();
  }

  private tick(): void {
    this.sim.update(TICK_MS);
  }

  private updateSelectionInfo(): void {
    if (!this.selectionInfoEl) return;
    const state = this.sim.state;
    if (state.selectedEntityIds.length === 0) {
      this.selectionInfoEl.textContent = '选择：无';
      return;
    }
    const names = state.selectedEntityIds
      .map((id) => state.entities[id] && state.defs[state.entities[id].typeId].name)
      .filter((n): n is string => Boolean(n));
    this.selectionInfoEl.textContent =
      names.length === 1 ? `选择：${names[0]}` : `选择：${names.length} 个单位`;
  }

  private updateTileInfo(p: Phaser.Input.Pointer): void {
    if (!this.tileInfoEl) return;
    const world = this.cameras.main.getWorldPoint(p.x, p.y);
    const g = screenToGrid(world.x, world.y);
    const gx = Math.floor(g.x);
    const gy = Math.floor(g.y);
    const tile = tileAt(this.sim.state.map, gx, gy);
    this.tileInfoEl.textContent = tile
      ? `鼠标：格 ${gx},${gy} · ${TERRAIN_NAMES[tile.terrain]}`
      : `鼠标：格 ${gx},${gy} · 地图外`;
  }
}
