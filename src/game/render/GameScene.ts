import Phaser from 'phaser';
import { Game } from '../core/Game';
import { GameLoop, TICK_MS } from '../core/GameLoop';
import { createInitialGameState, PLAYER_ID, Difficulty } from '../state/GameState';
import type { GameState } from '../state/GameState';
import type { EntityState } from '../state/entities';
import { Terrain, tileAt } from '../state/map';
import { screenToGrid } from './isometric';
import { MapRenderer, mapWorldBounds } from './MapRenderer';
import { UnitRenderer } from './UnitRenderer';
import { BuildingRenderer } from './BuildingRenderer';
import { CameraController } from '../input/CameraController';
import { SelectionController } from '../input/SelectionController';
import { SquadController } from '../input/SquadController';
import { BuildingPlacementController } from '../input/BuildingPlacementController';
import { upgradeCost } from '../state/commands';
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
  private powerEl: HTMLElement | null = null;
  private prodPanelEl: HTMLElement | null = null;
  private speedOverlayEl: HTMLElement | null = null;
  private buildButtons: HTMLButtonElement[] = [];
  private resultOverlay = new ResultOverlay();
  private prodPanelStructureKey = '';
  private activeProductionTab = '';

  constructor() {
    super('game');
  }

  create(): void {
    const diff = (window as unknown as { __diff?: Difficulty }).__diff ?? 'normal';
    this.sim = new Game(createInitialGameState({ difficulty: diff }));

    // 预加载原创贴图（docs/01-architecture.md 决策三）
    loadAllSprites(this);

    this.mapRenderer = new MapRenderer(this);
    // 等纹理全部加载完成后再建地形贴图层（否则 first frame 走兜底）
    this.load.once('complete', () => {
      this.mapRenderer.init(this, this.sim.state.map);
      window.dispatchEvent(new Event('raw:scene-ready'));
    });
    this.load.start();
    this.buildings = new BuildingRenderer(this);
    this.units = new UnitRenderer(this);
    this.minimap = new Minimap(this, this.sim.state, {
      onJump: (gx, gy) => {
        // 地图坐标 → 等距屏幕坐标 → 居中
        const sx = (gx - gy) * 32; // TILE_W/2 = 32
        const sy = (gx + gy) * 16; // TILE_H/2 = 16
        this.cameras.main.centerOn(sx, sy);
      },
    });

    const cam = this.cameras.main;
    const bounds = mapWorldBounds(this.sim.state.map);
    cam.setBounds(bounds.x, bounds.y, bounds.width, bounds.height);
    cam.centerOn(bounds.centerX, bounds.centerY);
    cam.setBackgroundColor('#101511');

    this.cameraControl = new CameraController(this, cam, {
      leftButtonPan: false,
      // CameraController 接收地图世界像素，不是 0~63 的逻辑格坐标。
      homeView: { x: bounds.centerX, y: bounds.centerY, zoom: 1 },
    });
    new SelectionController(this, this.sim, cam, {
      isPointerBlocked: (x, y) => this.placement.isActive() || this.minimap.containsScreenPoint(x, y),
    });
    // 选择控制器先注册 DOM listener：放置模式下它会先判断 blocked 并退出，
    // 随后的放置 listener 再落建筑，避免同一次点击又选中地图实体。
    this.placement = new BuildingPlacementController(this, this.sim, cam);
    this.placement.onCancel = () => this.refreshBuildButtons();
    new SquadController(this, this.sim);

    this.tileInfoEl = document.getElementById('tile-info');
    this.selectionInfoEl = document.getElementById('selection-info');
    this.moneyEl = document.getElementById('money');
    this.powerEl = document.getElementById('power-status');
    this.prodPanelEl = document.getElementById('prod-panel');
    this.prodPanelEl?.addEventListener('click', (event) => this.handleProductionClick(event));
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.updateTileInfo(p));
    this.wireBuildBar();
    this.wireViewActions();
    this.wireKeyboard();
  }

  private wireViewActions(): void {
    document.getElementById('home-view')?.addEventListener('click', () => this.cameraControl.goHome());
    document.getElementById('back-to-menu')?.addEventListener('click', () => window.location.reload());
  }

  /** 暂停/速度指示器：屏幕中央半透明大字。游戏进行中显示，胜负已结时隐藏。 */
  private ensureSpeedOverlay(): void {
    if (this.speedOverlayEl) return;
    this.speedOverlayEl = document.createElement('div');
    this.speedOverlayEl.id = 'speed-overlay';
    document.body.appendChild(this.speedOverlayEl);
  }

  private updateSpeedOverlay(): void {
    this.ensureSpeedOverlay();
    if (!this.speedOverlayEl) return;
    if (this.sim.state.gameOver) {
      this.speedOverlayEl.style.opacity = '0';
      return;
    }
    if (this.loop.paused) {
      this.speedOverlayEl.textContent = '战术暂停';
      this.speedOverlayEl.dataset.mode = 'paused';
      this.speedOverlayEl.style.opacity = '1';
    } else if (this.loop.timeScale > 1) {
      this.speedOverlayEl.textContent = `${this.loop.timeScale}×`;
      this.speedOverlayEl.dataset.mode = 'speed';
      this.speedOverlayEl.style.opacity = '1';
    } else {
      this.speedOverlayEl.style.opacity = '0';
    }
  }

  /** 空格暂停、Shift+1/2/3 切 1×/2×/4×；裸数字键留给编队复读。 */
  private wireKeyboard(): void {
    const kb = this.input.keyboard;
    if (!kb) return;
    const tryRate = (scale: number) => (event: KeyboardEvent) => {
      if (!event.shiftKey) return;
      if (this.sim.state.gameOver) return;
      this.loop.setTimeScale(scale);
    };
    const tryTogglePause = () => {
      if (this.sim.state.gameOver) return;
      this.loop.togglePause();
    };
    kb.on('keydown-SPACE', tryTogglePause);
    kb.on('keydown-ONE', tryRate(1));
    kb.on('keydown-TWO', tryRate(2));
    kb.on('keydown-THREE', tryRate(4));
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
    this.updatePower();
    this.updateSelectionPanel();
    this.refreshBuildButtons();
    this.updateSpeedOverlay();
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

  private updatePower(): void {
    if (!this.powerEl) return;
    const player = this.sim.state.players[PLAYER_ID];
    this.powerEl.textContent = `${player.powerProduced} / ${player.powerConsumed}`;
    this.powerEl.dataset.state = player.powerConsumed > player.powerProduced ? 'short' : 'ok';
  }

  /** 经典 RTS 左侧栏：选中实体时固定显示状态、生产页签、队列环形进度和升级卡片。 */
  private updateSelectionPanel(): void {
    if (!this.prodPanelEl) return;
    const state = this.sim.state;
    const sel = state.selectedEntityIds;
    const player = state.players[PLAYER_ID];
    const items = sel.map((id) => state.entities[id]).filter((e): e is EntityState => Boolean(e));

    if (items.length === 0) {
      this.prodPanelEl.innerHTML = '';
      this.prodPanelStructureKey = '';
      this.activeProductionTab = '';
      this.prodPanelEl.style.display = 'none';
      return;
    }
    this.prodPanelEl.style.display = '';

    // 进度不参与结构 key，避免每个 tick 重建 DOM 导致页签闪烁；进度由 refreshProductionPanel 更新。
    const structureKey = `${sel.join(',')}|${player.money}|${player.powerProduced}|${player.powerConsumed}|${
      items.map((e) => `${e.id}:${e.type}:${e.typeId}:${Math.ceil(e.hp)}:${e.upgraded}:${e.type === 'building' ? e.productionQueue.join(',') : ''}`).join(';')
    }`;
    if (structureKey !== this.prodPanelStructureKey) {
      this.prodPanelEl.innerHTML = this.renderSelectionPanel(state, items, player);
      this.prodPanelStructureKey = structureKey;
    }

    const sample = items[0];
    const powerShort = player.powerConsumed > player.powerProduced;
    this.refreshProductionPanel(state, sample, player, powerShort);
    this.prodPanelEl.querySelectorAll<HTMLButtonElement>('button[data-upgrade]').forEach((btn) => {
      btn.disabled = player.money < Number(btn.dataset.cost ?? '0');
    });
  }

  private renderSelectionPanel(state: GameState, items: EntityState[], player: GameState['players'][number]): string {
    const sample = items[0];
    const friendly = sample.ownerId === PLAYER_ID;
    const def = sample.type === 'unit' ? state.defs[sample.typeId] : state.buildingDefs[sample.typeId];
    const maxHp = def.maxHp * sample.hpMultiplier;
    const hpRatio = Math.max(0, Math.min(100, (sample.hp / maxHp) * 100));
    const title = sample.type === 'unit' ? def.name : def.name;
    const countLabel = items.length > 1 ? ` ×${items.length}` : '';
    let html = `<div class="selection-panel-card">
      <div class="selection-panel-heading"><div><small>SELECTED ${sample.type === 'unit' ? 'UNIT' : 'STRUCTURE'}</small><h2>${title}${countLabel}</h2></div><span class="selection-badge">${sample.type === 'unit' ? 'UNIT' : 'BASE'}</span></div>
      <div class="selection-health"><div><span>完整度</span><b>${Math.ceil(sample.hp)} / ${Math.round(maxHp)}</b></div><i><em style="width:${hpRatio}%"></em></i></div>
      <div class="selection-stats">`;
    if (sample.type === 'unit') {
      const unitDef = state.defs[sample.typeId];
      html += `<div><small>护甲</small><b>${unitDef.armor}</b></div><div><small>速度</small><b>${unitDef.speed} 格/秒</b></div>`;
      if (unitDef.weapon) {
        html += `<div><small>攻击</small><b>${(unitDef.weapon.damage * sample.damageMultiplier).toFixed(1)}</b></div><div><small>射程</small><b>${unitDef.weapon.range}</b></div>`;
      }
      html += `<div><small>状态</small><b>${this.activityLabel(sample.activity)}</b></div>`;
    } else {
      const buildingDef = state.buildingDefs[sample.typeId];
      html += `<div><small>占地</small><b>${buildingDef.footprint.w}×${buildingDef.footprint.h}</b></div><div><small>电力</small><b>+${buildingDef.powerProvided + sample.powerBonus} / -${buildingDef.powerConsumed}</b></div>`;
      if (buildingDef.weapon) html += `<div><small>防御</small><b>${buildingDef.weapon.damage}</b></div>`;
      if (buildingDef.visionRange) html += `<div><small>视野</small><b>${buildingDef.visionRange} 格</b></div>`;
    }
    html += `</div>`;

    if (sample.type === 'building' && items.length === 1 && friendly) {
      const buildingDef = state.buildingDefs[sample.typeId];
      const allProduces = Array.from(new Set([...buildingDef.produces, ...sample.producesExtra]));
      if (allProduces.length > 0) {
        if (!allProduces.includes(this.activeProductionTab)) this.activeProductionTab = allProduces[0];
        html += `<section class="production-section"><div class="section-caption"><span>生产序列</span><small>PRODUCTION</small></div><div class="production-tabs" role="tablist">`;
        for (const unitId of allProduces) {
          const unitDef = state.defs[unitId];
          if (!unitDef) continue;
          html += `<button type="button" class="production-tab${unitId === this.activeProductionTab ? ' is-active' : ''}" data-prod-tab="${unitId}" role="tab" aria-selected="${unitId === this.activeProductionTab}"><strong>${unitDef.name}</strong><small>$${unitDef.cost}</small></button>`;
        }
        html += `</div><div class="production-detail"><div><small>当前页签</small><strong data-prod-active-name></strong></div><button type="button" class="production-start" data-prod-start data-train="${this.activeProductionTab}" data-building="${sample.id}"></button></div><div class="power-line" data-prod-power></div><div data-prod-queue>${this.renderQueueMarkup(state, sample, player)}</div></section>`;
      }
    }

    if (friendly) {
      const cost = upgradeCost(state, sample);
      if (sample.upgraded) {
        html += `<section class="upgrade-card is-complete"><div class="upgrade-ring" style="--progress:100%"><span>UP</span></div><div><small>升级状态</small><strong>已升级 · 战术强化完成</strong></div><b>✓</b></section>`;
      } else {
        html += `<section class="upgrade-card"><div class="upgrade-ring" style="--progress:0%"><span>UP</span></div><div><small>升级状态</small><strong>可进行战术升级</strong><em>强化生命、伤害或解锁单位</em></div><button type="button" class="upgrade-btn" data-upgrade="${sample.id}" data-cost="${cost}">升级 <b>$${cost}</b></button></section>`;
      }
    } else {
      html += `<div class="enemy-status"><span>敌方目标</span><b>不可操作</b></div>`;
    }
    return `${html}</div>`;
  }

  private renderQueueMarkup(state: GameState, sample: EntityState, player: GameState['players'][number]): string {
    if (sample.type !== 'building' || sample.productionQueue.length === 0) return '<div class="queue-empty">当前没有生产中的单位</div>';
    const producing = sample.productionQueue[0];
    const unitDef = state.defs[producing];
    if (!unitDef) return '<div class="queue-empty">生产数据不可用</div>';
    const powerShort = player.powerConsumed > player.powerProduced;
    const ticks = unitDef.buildTicks * (powerShort ? 2 : 1);
    const pct = Math.min(100, Math.floor((sample.productionProgress / ticks) * 100));
    return `<div class="queue-card"><div class="production-ring" data-prod-ring style="--progress:${pct}%"><span data-prod-percent>${pct}%</span></div><div class="queue-copy"><strong>${unitDef.name}</strong><small data-prod-queue-state>生产中</small><div class="queued-list" data-prod-queued>${sample.productionQueue.slice(1).map((q) => `<span>${state.defs[q]?.name ?? q}</span>`).join('')}</div></div></div>`;
  }

  private refreshProductionPanel(state: GameState, sample: EntityState, player: GameState['players'][number], powerShort: boolean): void {
    if (!this.prodPanelEl) return;
    this.syncProductionTabUI(state, player);
    const powerEl = this.prodPanelEl.querySelector<HTMLElement>('[data-prod-power]');
    if (powerEl) powerEl.textContent = `电力 ${player.powerProduced} / ${player.powerConsumed}${powerShort ? ' · 缺电：生产速度减半' : ''}`;
    const queueEl = this.prodPanelEl.querySelector<HTMLElement>('[data-prod-queue]');
    if (!queueEl || sample.type !== 'building' || sample.productionQueue.length === 0) {
      if (queueEl) queueEl.innerHTML = '<div class="queue-empty">当前没有生产中的单位</div>';
      return;
    }
    const producing = sample.productionQueue[0];
    const unitDef = state.defs[producing];
    if (!unitDef) return;
    const ticks = unitDef.buildTicks * (powerShort ? 2 : 1);
    const pct = Math.min(100, Math.floor((sample.productionProgress / ticks) * 100));
    const ring = queueEl.querySelector<HTMLElement>('[data-prod-ring]');
    const percent = queueEl.querySelector<HTMLElement>('[data-prod-percent]');
    const stateText = queueEl.querySelector<HTMLElement>('[data-prod-queue-state]');
    if (ring) ring.style.setProperty('--progress', `${pct}%`);
    if (percent) percent.textContent = `${pct}%`;
    if (stateText) stateText.textContent = `${sample.productionQueue.length > 1 ? `生产中 · 队列 ${sample.productionQueue.length}` : '生产中'} · ${Math.max(0, Math.ceil((ticks - sample.productionProgress) / 20))} 秒`;
    const queued = queueEl.querySelector<HTMLElement>('[data-prod-queued]');
    if (queued) queued.innerHTML = sample.productionQueue.slice(1).map((q) => `<span>${state.defs[q]?.name ?? q}</span>`).join('');
  }

  private syncProductionTabUI(state: GameState, player: GameState['players'][number]): void {
    if (!this.prodPanelEl) return;
    const tabs = Array.from(this.prodPanelEl.querySelectorAll<HTMLButtonElement>('[data-prod-tab]'));
    if (tabs.length === 0) return;
    if (!tabs.some((tab) => tab.dataset.prodTab === this.activeProductionTab)) this.activeProductionTab = tabs[0].dataset.prodTab ?? '';
    tabs.forEach((tab) => {
      const active = tab.dataset.prodTab === this.activeProductionTab;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    const activeDef = state.defs[this.activeProductionTab];
    const nameEl = this.prodPanelEl.querySelector<HTMLElement>('[data-prod-active-name]');
    const start = this.prodPanelEl.querySelector<HTMLButtonElement>('[data-prod-start]');
    if (activeDef && start) {
      start.dataset.train = activeDef.id;
      start.disabled = player.money < activeDef.cost;
      start.innerHTML = `开始生产 <b>$${activeDef.cost}</b>`;
    }
    if (nameEl) nameEl.textContent = activeDef?.name ?? '未选择';
  }

  private activityLabel(a: string): string {
    return a === 'idle' ? '待机' : a === 'moving' ? '移动中' : a === 'attacking' ? '战斗中' : a;
  }

  private handleProductionClick(event: Event): void {
    const target = event.target as HTMLElement;
    const tab = target.closest<HTMLButtonElement>('button[data-prod-tab]');
    if (tab) {
      this.activeProductionTab = tab.dataset.prodTab ?? '';
      this.syncProductionTabUI(this.sim.state, this.sim.state.players[PLAYER_ID]);
      return;
    }
    const trainBtn = target.closest<HTMLButtonElement>('button[data-train]');
    if (trainBtn) {
      this.sim.state.pendingCommands.push({
        type: 'train',
        playerId: PLAYER_ID,
        buildingId: Number(trainBtn.dataset.building),
        unitTypeId: trainBtn.dataset.train ?? '',
      });
      return;
    }
    const upBtn = target.closest<HTMLButtonElement>('button[data-upgrade]');
    if (upBtn) {
      this.sim.state.pendingCommands.push({
        type: 'upgrade',
        playerId: PLAYER_ID,
        entityId: Number(upBtn.dataset.upgrade),
      });
    }
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
      const maxHp = def.maxHp * e.hpMultiplier;
      this.selectionInfoEl.textContent = `选择：${def.name}${tag} · 生命 ${Math.ceil(e.hp)}/${Math.round(maxHp)}`;
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
