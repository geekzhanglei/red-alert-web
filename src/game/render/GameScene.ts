import Phaser from 'phaser';
import { Game } from '../core/Game';
import { GameLoop, TICK_MS } from '../core/GameLoop';
import { createInitialGameState, PLAYER_ID } from '../state/GameState';
import { Terrain, tileAt } from '../state/map';
import { screenToGrid } from './isometric';
import { MapRenderer, mapWorldBounds } from './MapRenderer';
import { UnitRenderer } from './UnitRenderer';
import { BuildingRenderer } from './BuildingRenderer';
import { CameraController } from '../input/CameraController';
import { SelectionController } from '../input/SelectionController';
import { BuildingPlacementController } from '../input/BuildingPlacementController';
import { canAfford } from '../state/players';
import { Minimap } from './Minimap';
import { ResultOverlay } from '../../ui/ResultOverlay';
import { loadAllSprites } from '../../assets/loadSprites';

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
  private mapRenderer!: MapRenderer;
  private units!: UnitRenderer;
  private buildings!: BuildingRenderer;
  private minimap!: Minimap;
  private cameraControl!: CameraController;
  private placement!: BuildingPlacementController;
  private tileInfoEl: HTMLElement | null = null;
  private selectionInfoEl: HTMLElement | null = null;
  private moneyEl: HTMLElement | null = null;
  private prodPanelEl: HTMLElement | null = null;
  private buildButtons: HTMLButtonElement[] = [];
  private resultOverlay = new ResultOverlay();
  private prodPanelStructureKey = '';

  constructor() {
    super('game');
  }

  create(): void {
    this.sim = new Game(createInitialGameState());

    // 预加载原创贴图（docs/01-architecture.md 决策三）
    loadAllSprites(this);

    this.mapRenderer = new MapRenderer(this);
    // 等纹理全部加载完成后再建地形贴图层（否则 first frame 走兜底）
    this.load.once('complete', () => {
      this.mapRenderer.init(this, this.sim.state.map);
    });
    this.load.start();
    this.buildings = new BuildingRenderer(this);
    this.units = new UnitRenderer(this);
    this.minimap = new Minimap(this, this.sim.state);

    const cam = this.cameras.main;
    const bounds = mapWorldBounds(this.sim.state.map);
    cam.setBounds(bounds.x, bounds.y, bounds.width, bounds.height);
    cam.centerOn(bounds.centerX, bounds.centerY);
    cam.setBackgroundColor('#101511');

    this.cameraControl = new CameraController(this, cam, { leftButtonPan: false });
    new SelectionController(this, this.sim, cam);
    this.placement = new BuildingPlacementController(this, this.sim, cam);
    this.placement.onCancel = () => this.refreshBuildButtons();

    this.tileInfoEl = document.getElementById('tile-info');
    this.selectionInfoEl = document.getElementById('selection-info');
    this.moneyEl = document.getElementById('money');
    this.prodPanelEl = document.getElementById('prod-panel');
    this.prodPanelEl?.addEventListener('click', (event) => this.handleProductionClick(event));
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.updateTileInfo(p));
    this.wireBuildBar();
  }

  update(_time: number, delta: number): void {
    this.loop.frame(delta);
    // 建筑先画（背景），单位后画（前景角色），与等距遮挡一致
    this.buildings.update(this.sim.state, PLAYER_ID);
    this.units.update(this.sim.state, this.loop.alpha, PLAYER_ID);
    this.mapRenderer.updateFog(this.sim.state, PLAYER_ID);
    this.minimap.update(this.sim.state);
    this.cameraControl.update(delta / 1000, this.scale.width, this.scale.height);
    this.placement.render();
    this.updateSelectionInfo();
    this.updateMoney();
    this.updateProdPanel();
    this.refreshBuildButtons();
    this.resultOverlay.update(this.sim.state);
  }

  private tick(): void {
    this.sim.update(TICK_MS);
  }

  private wireBuildBar(): void {
    this.buildButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('#build-bar button'));
    for (const btn of this.buildButtons) {
      const defId = btn.dataset.building;
      if (!defId) continue;
      const def = this.sim.state.buildingDefs[defId];
      if (!def) {
        // 阶段五·B 尚未实现：禁掉
        btn.disabled = true;
        continue;
      }
      btn.addEventListener('click', () => this.placement.select(def));
    }
  }

  /** 资金变化实时刷新；按钮 affordability / active 状态同步。 */
  private refreshBuildButtons(): void {
    for (const btn of this.buildButtons) {
      const defId = btn.dataset.building;
      if (!defId) continue;
      const def = this.sim.state.buildingDefs[defId];
      if (!def) continue;
      const affordable = canAfford(this.sim.state, PLAYER_ID, def.cost);
      btn.disabled = !affordable;
      btn.classList.toggle('active', this.placement.isActive() && this.placement.selectedId() === def.id);
    }
  }

  private updateMoney(): void {
    if (!this.moneyEl) return;
    this.moneyEl.textContent = `$${this.sim.state.players[PLAYER_ID].money}`;
  }

  /** 选中己方建筑时显示生产队列 + 训练按钮；未选中/选中单位时清空。 */
  private updateProdPanel(): void {
    if (!this.prodPanelEl) return;
    const state = this.sim.state;
    const sel = state.selectedEntityIds[0];
    const b = sel != null ? state.entities[sel] : null;
    if (!b || b.type !== 'building' || b.ownerId !== PLAYER_ID) {
      if (this.prodPanelStructureKey !== '') this.prodPanelEl.innerHTML = '';
      this.prodPanelStructureKey = '';
      this.prodPanelEl.style.display = 'none';
      return;
    }
    this.prodPanelEl.style.display = '';
    const def = state.buildingDefs[b.typeId];
    const player = state.players[PLAYER_ID];
    const powerShort = player.powerConsumed > player.powerProduced;
    const structureKey = `${b.id}|${b.typeId}|${b.productionQueue.join(',')}`;
    if (structureKey !== this.prodPanelStructureKey) {
      let html = `<div class="prod-title">${def.name} #${b.id}</div>`;
      html += `<div class="prod-power" data-prod-power></div>`;
      if (b.productionQueue.length === 0) {
        html += `<div data-prod-queue><div style="color:#a0b0a6;margin:4px 0">无生产</div></div>`;
      } else {
        const producing = b.productionQueue[0];
        const unitDef = state.defs[producing];
        html += `<div data-prod-queue><div class="prod-row"><span>${unitDef.name}</span><div class="prod-bar"><div data-prod-progress></div></div></div>`;
        html += b.productionQueue
          .slice(1)
          .map((q) => `<div class="prod-row"><span>${state.defs[q].name}</span><span style="color:#a0b0a6">排队</span></div>`)
          .join('');
        html += `</div>`;
      }
      html += `<div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">`;
      for (const unitId of def.produces) {
        const unitDef = state.defs[unitId];
        html += `<button data-train="${unitId}" data-building="${b.id}">${unitDef.name} $${unitDef.cost}</button>`;
      }
      html += `</div>`;
      this.prodPanelEl.innerHTML = html;
      this.prodPanelStructureKey = structureKey;
    }
    const powerEl = this.prodPanelEl.querySelector<HTMLElement>('[data-prod-power]');
    if (powerEl) powerEl.textContent = `电力 ${player.powerProduced}/${player.powerConsumed}${powerShort ? ' · 缺电（生产×2）' : ''}`;
    const queueEl = this.prodPanelEl.querySelector<HTMLElement>('[data-prod-queue]');
    if (queueEl && structureKey === this.prodPanelStructureKey) {
      const producing = b.productionQueue[0];
      if (producing) {
        const unitDef = state.defs[producing];
        const ticks = unitDef.buildTicks * (powerShort ? 2 : 1);
        const pct = Math.min(100, Math.floor((b.productionProgress / ticks) * 100));
        const progressEl = queueEl.querySelector<HTMLElement>('[data-prod-progress]');
        if (progressEl) progressEl.style.width = `${pct}%`;
      }
    }
    this.prodPanelEl.querySelectorAll<HTMLButtonElement>('button[data-train]').forEach((btn) => {
      const unit = state.defs[btn.dataset.train ?? ''];
      if (unit) btn.disabled = player.money < unit.cost;
    });
  }

  private handleProductionClick(event: Event): void {
    const target = event.target as HTMLElement;
    const btn = target.closest<HTMLButtonElement>('button[data-train]');
    if (!btn) return;
    this.sim.state.pendingCommands.push({
      type: 'train',
      playerId: PLAYER_ID,
      buildingId: Number(btn.dataset.building),
      unitTypeId: btn.dataset.train ?? '',
    });
  }

  private updateSelectionInfo(): void {
    if (!this.selectionInfoEl) return;
    const state = this.sim.state;
    if (state.selectedEntityIds.length === 0) {
      this.selectionInfoEl.textContent = '选择：无';
      return;
    }
    const items = state.selectedEntityIds.map((id) => state.entities[id]).filter((e): e is NonNullable<typeof e> => Boolean(e));
    if (items.length === 1) {
      const e = items[0];
      const def = e.type === 'building' ? state.buildingDefs[e.typeId] : state.defs[e.typeId];
      const tag = e.type === 'building' ? '建筑' : '';
      this.selectionInfoEl.textContent = `选择：${def.name}${tag} · 生命 ${Math.ceil(e.hp)}/${def.maxHp}`;
    } else {
      this.selectionInfoEl.textContent = `选择：${items.length} 个实体`;
    }
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
