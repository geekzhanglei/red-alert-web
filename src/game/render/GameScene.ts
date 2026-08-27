import Phaser from 'phaser';
import { Game } from '../core/Game';
import { GameLoop, TICK_MS } from '../core/GameLoop';
import { createInitialGameState, PLAYER_ID, Difficulty } from '../state/GameState';
import type { GameState } from '../state/GameState';
import type { EntityState } from '../state/entities';
import { Terrain, tileAt } from '../state/map';
import { gridToScreen, screenToGrid } from './isometric';
import { MapRenderer, mapWorldBounds } from './MapRenderer';
import { UnitRenderer } from './UnitRenderer';
import { BuildingRenderer } from './BuildingRenderer';
import { CameraController } from '../input/CameraController';
import { SelectionController } from '../input/SelectionController';
import { SquadController } from '../input/SquadController';
import { BuildingPlacementController } from '../input/BuildingPlacementController';
import { canAfford, canSustainBuilding } from '../state/players';
import { Minimap } from './Minimap';
import { ResultOverlay } from '../../ui/ResultOverlay';
import { BUILDING_SPRITE_URLS, loadAllSprites, UNIT_SPRITE_URLS } from '../../assets/loadSprites';
import { GameAudio } from '../audio/GameAudio';
import {
  getBattlefieldInfo,
  loadBattlefield,
  requestBattlefieldResume,
  saveBattlefield,
} from '../state/battlefieldSave';

const TERRAIN_NAMES: Record<Terrain, string> = {
  grass: '草地',
  water: '水域',
  rock: '岩石',
  ore: '矿石',
};

type CatalogTab = 'structures' | 'defense' | 'infantry' | 'vehicles';

const CATALOG_LABELS: Record<CatalogTab, { title: string; code: string }> = {
  structures: { title: '基地建造', code: 'STRUCTURES' },
  defense: { title: '防御设施', code: 'DEFENSE' },
  infantry: { title: '步兵单位', code: 'INFANTRY' },
  vehicles: { title: '载具单位', code: 'VEHICLES' },
};

const UNIT_CATALOG: Record<'infantry' | 'vehicles', string[]> = {
  infantry: ['infantry', 'rocketTrooper'],
  vehicles: ['harvester', 'scout', 'tank', 'artillery', 'heavyTank'],
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
  private speedOverlayEl: HTMLElement | null = null;
  private buildButtons: HTMLButtonElement[] = [];
  private catalogTabs: HTMLButtonElement[] = [];
  private unitCatalogEl: HTMLElement | null = null;
  private catalogEmptyEl: HTMLElement | null = null;
  private catalogTitleEl: HTMLElement | null = null;
  private catalogCodeEl: HTMLElement | null = null;
  private activeCatalogTab: CatalogTab = 'structures';
  private catalogStructureKey = '';
  private resultOverlay = new ResultOverlay();
  private optionsDialogEl: HTMLElement | null = null;
  private mouseSensitivityEl: HTMLInputElement | null = null;
  private mouseSensitivityValueEl: HTMLOutputElement | null = null;
  private optionsSaveStatusEl: HTMLElement | null = null;
  private masterVolumeEl: HTMLInputElement | null = null;
  private masterVolumeValueEl: HTMLOutputElement | null = null;
  private musicVolumeEl: HTMLInputElement | null = null;
  private musicVolumeValueEl: HTMLOutputElement | null = null;
  private ambientVolumeEl: HTMLInputElement | null = null;
  private ambientVolumeValueEl: HTMLOutputElement | null = null;
  private optionsPauseOwned = false;
  private audio!: GameAudio;

  constructor() {
    super('game');
  }

  create(): void {
    const diff = (window as unknown as { __diff?: Difficulty }).__diff ?? 'normal';
    const resumeRequested = Boolean((window as unknown as { __resumeBattlefield?: boolean }).__resumeBattlefield);
    const restored = resumeRequested ? loadBattlefield() : null;
    this.sim = new Game(restored ?? createInitialGameState({ difficulty: diff }));
    this.audio = new GameAudio();

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
    const commandCenter = this.sim.state.entitiesOrder
      .map((id) => this.sim.state.entities[id])
      .find((entity) => entity?.type === 'building' && entity.ownerId === PLAYER_ID && entity.typeId === 'base');
    const home = commandCenter
      ? gridToScreen(commandCenter.x, commandCenter.y)
      : { x: bounds.centerX, y: bounds.centerY };
    const initialSensitivity = this.readMouseSensitivity();
    cam.setBounds(bounds.x, bounds.y, bounds.width, bounds.height);
    cam.centerOn(home.x, home.y);
    cam.setBackgroundColor('#2b412e');

    this.cameraControl = new CameraController(this, cam, {
      leftButtonPan: false,
      // 原版红警 2 是固定比例视图，滚轮不改变战场缩放，避免边缘出现黑色空洞。
      allowZoom: false,
      sensitivity: initialSensitivity,
      // CameraController 接收地图世界像素，不是 0~63 的逻辑格坐标。
      homeView: { x: home.x, y: home.y, zoom: 1 },
    });
    new SelectionController(this, this.sim, cam, {
      isPointerBlocked: () => this.placement.isActive(),
    });
    // 选择控制器先注册 DOM listener：放置模式下它会先判断 blocked 并退出，
    // 随后的放置 listener 再落建筑，避免同一次点击又选中地图实体。
    this.placement = new BuildingPlacementController(this, this.sim, cam);
    this.placement.onCancel = () => this.refreshCatalog(true);
    new SquadController(this, this.sim);

    this.tileInfoEl = document.getElementById('tile-info');
    this.selectionInfoEl = document.getElementById('selection-info');
    this.moneyEl = document.getElementById('money');
    this.powerEl = document.getElementById('power-status');
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.updateTileInfo(p));
    this.wireBuildBar();
    this.wireCatalog();
    this.wireViewActions();
    this.wireOptions();
    this.wireKeyboard();
  }

  private wireViewActions(): void {
    document.getElementById('home-view')?.addEventListener('click', () => this.cameraControl.goHome());
    document.getElementById('back-to-menu')?.addEventListener('click', () => window.location.reload());
  }

  private readMouseSensitivity(): number {
    try {
      const stored = Number(window.localStorage.getItem('red-alert.mouseSensitivity'));
      if (Number.isFinite(stored)) return Phaser.Math.Clamp(stored, 50, 200) / 100;
    } catch {
      // 隐私模式或禁用存储时使用默认值，不影响游戏运行。
    }
    return 1;
  }

  private persistMouseSensitivity(percent: number): void {
    try {
      window.localStorage.setItem('red-alert.mouseSensitivity', String(percent));
    } catch {
      // 无法持久化时仍保留当前局内设置。
    }
  }

  private wireOptions(): void {
    this.optionsDialogEl = document.getElementById('options-dialog');
    this.mouseSensitivityEl = document.getElementById('mouse-sensitivity') as HTMLInputElement | null;
    this.mouseSensitivityValueEl = document.getElementById('mouse-sensitivity-value') as HTMLOutputElement | null;
    this.optionsSaveStatusEl = document.getElementById('options-save-status');
    this.masterVolumeEl = document.getElementById('master-volume') as HTMLInputElement | null;
    this.masterVolumeValueEl = document.getElementById('master-volume-value') as HTMLOutputElement | null;
    this.musicVolumeEl = document.getElementById('music-volume') as HTMLInputElement | null;
    this.musicVolumeValueEl = document.getElementById('music-volume-value') as HTMLOutputElement | null;
    this.ambientVolumeEl = document.getElementById('ambient-volume') as HTMLInputElement | null;
    this.ambientVolumeValueEl = document.getElementById('ambient-volume-value') as HTMLOutputElement | null;

    const initialPercent = Math.round(this.cameraControl.getSensitivity() * 100);
    if (this.mouseSensitivityEl) this.mouseSensitivityEl.value = String(initialPercent);
    if (this.mouseSensitivityValueEl) this.mouseSensitivityValueEl.value = `${initialPercent}%`;
    const initialVolume = Math.round(this.audio.getVolume() * 100);
    if (this.masterVolumeEl) this.masterVolumeEl.value = String(initialVolume);
    if (this.masterVolumeValueEl) this.masterVolumeValueEl.value = `${initialVolume}%`;
    const initialMusicVolume = Math.round(this.audio.getMusicVolume() * 100);
    if (this.musicVolumeEl) this.musicVolumeEl.value = String(initialMusicVolume);
    if (this.musicVolumeValueEl) this.musicVolumeValueEl.value = `${initialMusicVolume}%`;
    const initialAmbientVolume = Math.round(this.audio.getAmbientVolume() * 100);
    if (this.ambientVolumeEl) this.ambientVolumeEl.value = String(initialAmbientVolume);
    if (this.ambientVolumeValueEl) this.ambientVolumeValueEl.value = `${initialAmbientVolume}%`;

    document.getElementById('open-options')?.addEventListener('click', () => { this.audio.playUi(); this.setOptionsOpen(true); });
    document.getElementById('close-options')?.addEventListener('click', () => { this.audio.playUi(); this.setOptionsOpen(false); });
    document.getElementById('resume-game')?.addEventListener('click', () => { this.audio.playUi(); this.setOptionsOpen(false); });
    document.getElementById('save-battlefield')?.addEventListener('click', () => {
      const info = saveBattlefield(this.sim.state);
      if (this.optionsSaveStatusEl) {
        this.optionsSaveStatusEl.textContent = info
          ? `战场已保存 · 第 ${info.tick} 回合`
          : '保存失败：浏览器存储不可用';
      }
    });
    document.getElementById('load-battlefield')?.addEventListener('click', () => {
      const info = getBattlefieldInfo();
      if (!info) {
        if (this.optionsSaveStatusEl) this.optionsSaveStatusEl.textContent = '没有可读取的战场存档';
        return;
      }
      if (!requestBattlefieldResume()) {
        if (this.optionsSaveStatusEl) this.optionsSaveStatusEl.textContent = '读取失败：浏览器存储不可用';
        return;
      }
      window.location.reload();
    });
    this.masterVolumeEl?.addEventListener('input', () => {
      const percent = Phaser.Math.Clamp(Number(this.masterVolumeEl?.value ?? 42), 0, 100);
      this.audio.setVolume(percent / 100);
      if (this.masterVolumeValueEl) this.masterVolumeValueEl.value = `${percent}%`;
    });
    this.musicVolumeEl?.addEventListener('input', () => {
      const percent = Phaser.Math.Clamp(Number(this.musicVolumeEl?.value ?? 24), 0, 100);
      this.audio.setMusicVolume(percent / 100);
      if (this.musicVolumeValueEl) this.musicVolumeValueEl.value = `${percent}%`;
    });
    this.ambientVolumeEl?.addEventListener('input', () => {
      const percent = Phaser.Math.Clamp(Number(this.ambientVolumeEl?.value ?? 18), 0, 100);
      this.audio.setAmbientVolume(percent / 100);
      if (this.ambientVolumeValueEl) this.ambientVolumeValueEl.value = `${percent}%`;
    });
    this.optionsDialogEl?.addEventListener('click', (event) => {
      if (event.target === this.optionsDialogEl) this.setOptionsOpen(false);
    });
    this.mouseSensitivityEl?.addEventListener('input', () => {
      const percent = Phaser.Math.Clamp(Number(this.mouseSensitivityEl?.value ?? 100), 50, 200);
      this.cameraControl.setSensitivity(percent / 100);
      if (this.mouseSensitivityValueEl) this.mouseSensitivityValueEl.value = `${percent}%`;
      this.persistMouseSensitivity(percent);
    });
    window.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      // 建造预览优先响应 Esc 取消，避免一次按键同时打开选项窗口。
      if (this.optionsDialogEl?.hidden && this.placement.isActive()) return;
      event.preventDefault();
      this.setOptionsOpen(Boolean(this.optionsDialogEl?.hidden));
    });
  }

  private setOptionsOpen(open: boolean): void {
    if (!this.optionsDialogEl) return;
    this.optionsDialogEl.hidden = !open;
    if (open) {
      if (this.placement.isActive()) this.placement.cancel();
      if (!this.loop.paused) {
        this.loop.togglePause();
        this.optionsPauseOwned = true;
      }
      this.mouseSensitivityEl?.focus();
    } else if (this.optionsPauseOwned) {
      this.loop.togglePause();
      this.optionsPauseOwned = false;
    }
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
    this.audio.observeState(this.sim.state);
    this.audio.consumeEvents(this.sim.state.events);
    // 建筑先画（背景），单位后画（前景角色），与等距遮挡一致
    this.buildings.update(this.sim.state, PLAYER_ID);
    this.units.update(this.sim.state, this.loop.alpha, PLAYER_ID);
    this.mapRenderer.updateResources(this.sim.state);
    this.mapRenderer.updateAnimations(this.sim.state, this.time.now);
    this.mapRenderer.updateFog(this.sim.state, PLAYER_ID);
    this.minimap.update(this.sim.state);
    this.cameraControl.update(delta / 1000, this.scale.width, this.scale.height);
    this.placement.render();
    this.updateSelectionInfo();
    this.updateMoney();
    this.updatePower();
    this.refreshCatalog();
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
      const icon = btn.querySelector<HTMLElement>('.build-icon');
      const iconUrl = BUILDING_SPRITE_URLS[defId];
      if (icon && iconUrl) {
        icon.classList.add('has-sprite');
        icon.style.backgroundImage = `url("${iconUrl}")`;
      }
      btn.addEventListener('click', () => this.placement.select(def));
    }
  }

  private wireCatalog(): void {
    this.catalogTabs = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-catalog-tab]'));
    this.unitCatalogEl = document.getElementById('unit-catalog');
    this.catalogEmptyEl = document.getElementById('catalog-empty');
    this.catalogTitleEl = document.getElementById('catalog-title');
    this.catalogCodeEl = document.getElementById('catalog-code');
    for (const tab of this.catalogTabs) {
      tab.addEventListener('click', () => {
        this.activeCatalogTab = (tab.dataset.catalogTab as CatalogTab | undefined) ?? 'structures';
        this.refreshCatalog(true);
      });
    }
    this.unitCatalogEl?.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      const button = target.closest<HTMLButtonElement>('button[data-train-global]');
      const unitTypeId = button?.dataset.trainGlobal;
      if (!button || !unitTypeId || button.disabled) return;
      const producer = this.findProducerFor(unitTypeId);
      if (!producer) return;
      this.sim.state.pendingCommands.push({
        type: 'train',
        playerId: PLAYER_ID,
        buildingId: producer.id,
        unitTypeId,
      });
    });
    this.refreshCatalog(true);
  }

  /** 资金变化实时刷新；按钮 affordability / active 状态同步。 */
  private refreshBuildButtons(): void {
    for (const btn of this.buildButtons) {
      const defId = btn.dataset.building;
      if (!defId) continue;
      const def = this.sim.state.buildingDefs[defId];
      if (!def) continue;
      const category = btn.dataset.catalog as CatalogTab | undefined;
      const visible = category === this.activeCatalogTab && this.isBuildingUnlocked(defId);
      btn.hidden = !visible;
      const affordable = canAfford(this.sim.state, PLAYER_ID, def.cost);
      const powerReady = canSustainBuilding(this.sim.state, PLAYER_ID, def);
      btn.disabled = !affordable || !powerReady;
      btn.dataset.reason = !affordable ? 'money' : !powerReady ? 'power' : '';
      btn.title = !affordable ? `${def.name} · 资金不足` : !powerReady ? `${def.name} · 电力不足` : `${def.name} · 点击放置`;
      btn.classList.toggle('active', this.placement.isActive() && this.placement.selectedId() === def.id);
    }
  }

  private refreshCatalog(force = false): void {
    const state = this.sim.state;
    const ownedTech = state.entitiesOrder
      .map((id) => state.entities[id])
      .filter((e): e is EntityState => Boolean(e) && e.type === 'building' && e.ownerId === PLAYER_ID)
      .map((e) => `${e.id}:${e.typeId}:${e.upgraded}:${e.producesExtra.join(',')}:${e.productionQueue.join(',')}`)
      .join('|');
    const structureKey = `${this.activeCatalogTab}|${ownedTech}`;
    const labels = CATALOG_LABELS[this.activeCatalogTab];
    if (this.catalogTitleEl) this.catalogTitleEl.textContent = labels.title;
    if (this.catalogCodeEl) this.catalogCodeEl.textContent = labels.code;
    this.catalogTabs.forEach((tab) => tab.classList.toggle('is-active', tab.dataset.catalogTab === this.activeCatalogTab));
    this.refreshBuildButtons();

    if ((force || structureKey !== this.catalogStructureKey) && this.unitCatalogEl) {
      this.unitCatalogEl.innerHTML = this.renderUnitCatalog();
      this.catalogStructureKey = structureKey;
    }
    this.refreshUnitCatalogProgress();
    const visibleBuildings = this.buildButtons.filter((btn) => !btn.hidden).length;
    const visibleUnits = this.unitCatalogEl?.querySelectorAll('button[data-train-global]').length ?? 0;
    if (this.catalogEmptyEl) this.catalogEmptyEl.hidden = visibleBuildings + visibleUnits > 0;
    const hint = document.getElementById('build-hint');
    if (hint) hint.textContent = this.activeCatalogTab === 'structures' || this.activeCatalogTab === 'defense'
      ? '选择图标开始放置 · 左键确认 · 右键 / Esc 取消'
      : '选择已解锁单位加入生产队列';
  }

  private renderUnitCatalog(): string {
    if (this.activeCatalogTab !== 'infantry' && this.activeCatalogTab !== 'vehicles') return '';
    return UNIT_CATALOG[this.activeCatalogTab]
      .filter((unitTypeId) => this.findProducerFor(unitTypeId))
      .map((unitTypeId) => {
        const def = this.sim.state.defs[unitTypeId];
        const spriteUrl = UNIT_SPRITE_URLS[unitTypeId];
        const combatLabel = def.weapon ? `攻击 ${def.weapon.damage} · 射程 ${def.weapon.range}` : '无攻击';
        return `<button type="button" class="catalog-unit" data-train-global="${unitTypeId}" title="${def.name} · ${combatLabel} · 生命 ${def.maxHp}"><span class="catalog-thumb" style="--catalog-image:url('${spriteUrl}')" aria-hidden="true"></span><span class="catalog-item-copy"><strong>${def.name}</strong><small>$${def.cost} · ${combatLabel}</small></span><span class="catalog-queue-count" data-catalog-queue-count hidden></span><span class="catalog-progress" data-catalog-progress hidden><i></i><b></b></span></button>`;
      })
      .join('');
  }

  private refreshUnitCatalogProgress(): void {
    if (!this.unitCatalogEl) return;
    const player = this.sim.state.players[PLAYER_ID];
    const powerShort = player.powerConsumed > player.powerProduced;
    this.unitCatalogEl.querySelectorAll<HTMLButtonElement>('button[data-train-global]').forEach((button) => {
      const unitTypeId = button.dataset.trainGlobal ?? '';
      const def = this.sim.state.defs[unitTypeId];
      const producers = this.findProducersFor(unitTypeId);
      button.disabled = !def || producers.length === 0 || player.money < def.cost;
      const progress = button.querySelector<HTMLElement>('[data-catalog-progress]');
      const countBadge = button.querySelector<HTMLElement>('[data-catalog-queue-count]');
      const totalQueued = producers.reduce(
        (total, producer) => total + producer.productionQueue.filter((queued) => queued === unitTypeId).length,
        0,
      );
      if (countBadge) {
        countBadge.hidden = totalQueued === 0;
        countBadge.textContent = `×${totalQueued}`;
      }
      if (!progress || !def || producers.length === 0) return;
      const activeProducer = producers
        .filter((producer) => producer.productionQueue[0] === unitTypeId)
        .sort((a, b) => b.productionProgress - a.productionProgress)[0];
      progress.hidden = totalQueued === 0;
      if (totalQueued === 0) return;
      const ring = progress.querySelector<HTMLElement>('i');
      const label = progress.querySelector<HTMLElement>('b');
      if (activeProducer) {
        const ticks = def.buildTicks * (powerShort ? 2 : 1);
        const pct = Math.min(100, Math.floor((activeProducer.productionProgress / ticks) * 100));
        ring?.style.setProperty('--progress', `${pct}%`);
        if (label) label.textContent = `${pct}%`;
      } else {
        ring?.style.setProperty('--progress', '0%');
        if (label) label.textContent = '待产';
      }
    });
  }

  private findProducerFor(unitTypeId: string): EntityState | null {
    return this.findProducersFor(unitTypeId)[0] ?? null;
  }

  private findProducersFor(unitTypeId: string): EntityState[] {
    const candidates = this.sim.state.entitiesOrder
      .map((id) => this.sim.state.entities[id])
      .filter((entity): entity is EntityState => {
        if (!entity || entity.type !== 'building' || entity.ownerId !== PLAYER_ID) return false;
        const def = this.sim.state.buildingDefs[entity.typeId];
        return def.produces.includes(unitTypeId) || entity.producesExtra.includes(unitTypeId);
      });
    candidates.sort((a, b) => a.productionQueue.length - b.productionQueue.length || a.id - b.id);
    return candidates;
  }

  private isBuildingUnlocked(typeId: string): boolean {
    const owned = new Set(
      this.sim.state.entitiesOrder
        .map((id) => this.sim.state.entities[id])
        .filter((entity) => entity?.type === 'building' && entity.ownerId === PLAYER_ID)
        .map((entity) => entity.typeId),
    );
    const requirements: Record<string, string[]> = {
      refinery: ['base'],
      powerPlant: ['base'],
      barracks: ['powerPlant'],
      factory: ['refinery'],
      guardTower: ['barracks'],
      radar: ['factory'],
    };
    return (requirements[typeId] ?? []).every((required) => owned.has(required));
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
    const gauge = document.getElementById('power-gauge');
    if (gauge) {
      const scale = Math.max(100, player.powerProduced, player.powerConsumed);
      const supply = Math.min(100, (player.powerProduced / scale) * 100);
      const demand = Math.min(100, (player.powerConsumed / scale) * 100);
      gauge.style.setProperty('--power-level', `${supply}%`);
      gauge.style.setProperty('--power-demand', `${demand}%`);
      gauge.dataset.state = player.powerConsumed > player.powerProduced ? 'short' : 'ok';
      gauge.setAttribute('aria-valuenow', String(Math.round(supply)));
      gauge.setAttribute('aria-valuetext', `发电 ${player.powerProduced}，消耗 ${player.powerConsumed}`);
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
