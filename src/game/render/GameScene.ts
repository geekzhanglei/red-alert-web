import Phaser from 'phaser';
import { Game } from '../core/Game';
import { GameLoop, TICK_MS } from '../core/GameLoop';
import { createInitialGameState, PLAYER_ID, Difficulty } from '../state/GameState';
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
  private prodPanelEl: HTMLElement | null = null;
  private speedOverlayEl: HTMLElement | null = null;
  private buildButtons: HTMLButtonElement[] = [];
  private resultOverlay = new ResultOverlay();
  private prodPanelStructureKey = '';

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

  /** 选中己方建筑时显示生产队列 + 训练按钮；未选中/选中单位时清空。 */
  private updateSelectionPanel(): void {
    if (!this.prodPanelEl) return;
    const state = this.sim.state;
    const sel = state.selectedEntityIds;
    const player = state.players[PLAYER_ID];

    if (sel.length === 0) {
      if (this.prodPanelStructureKey !== '') this.prodPanelEl.innerHTML = '';
      this.prodPanelStructureKey = '';
      this.prodPanelEl.style.display = 'none';
      return;
    }
    this.prodPanelEl.style.display = '';

    // 收集：按 typeId + (kind) 分组，多选时 group card
    const items = sel.map((id) => state.entities[id]).filter((e): e is NonNullable<typeof e> => Boolean(e));
    const groups = new Map<string, { type: 'unit' | 'building'; typeId: string; entities: NonNullable<typeof items[number]>[] }>();
    for (const e of items) {
      const k = `${e.type}:${e.typeId}`;
      let g = groups.get(k);
      if (!g) { g = { type: e.type, typeId: e.typeId, entities: [] }; groups.set(k, g); }
      g.entities.push(e);
    }
    const powerShort = player.powerConsumed > player.powerProduced;

    // 结构 key 含选中内容+资金+电力+生产队列
    const structureKey = `${sel.join(',')}|${player.money}|${player.powerProduced}|${player.powerConsumed}|${
      items.map((e) => (e.type === 'building' ? `${e.id}:${e.productionQueue.join(',')}:${e.productionProgress}` : `${e.id}:${e.hp}`)).join(';')
    }`;

    if (structureKey !== this.prodPanelStructureKey) {
      let html = '';
      for (const g of groups.values()) {
        const isFriendly = g.entities[0].ownerId === PLAYER_ID;
        const isEnemy = !isFriendly;
        const cardCls = `group-card${isEnemy ? ' enemy' : ''}`;
        html += `<div class="${cardCls}" data-group="${g.type}:${g.typeId}">`;
        if (g.type === 'unit') {
          const def = state.defs[g.typeId];
          const cnt = g.entities.length;
          const sample = g.entities[0];
          const effMax = def.maxHp * sample.hpMultiplier;
          html += `<div class="prod-title">${def.name}${cnt > 1 ? ` ×${cnt}` : ''} #${sample.id}${sample.upgraded ? ' ★' : ''}${isEnemy ? ' <span style="color:#e07070">(敌方)</span>' : ''}</div>`;
          html += `<div class="stat-row"><span class="lbl">生命</span><span>${Math.ceil(sample.hp)}/${Math.round(effMax)}</span></div>`;
          html += `<div class="stat-row"><span class="lbl">护甲</span><span>${def.armor}</span></div>`;
          html += `<div class="stat-row"><span class="lbl">速度</span><span>${def.speed} 格/秒</span></div>`;
          if (def.weapon) {
            const effDmg = def.weapon.damage * sample.damageMultiplier;
            html += `<div class="stat-row"><span class="lbl">攻击</span><span>${effDmg.toFixed(1)} / 射程 ${def.weapon.range} / 冷却 ${def.weapon.reloadTicks}t</span></div>`;
          }
          html += `<div class="stat-row"><span class="lbl">状态</span><span>${this.activityLabel(sample.activity)}</span></div>`;
          if (isFriendly && !sample.upgraded) {
            const cost = upgradeCost(state, sample);
            html += `<button class="upgrade-btn" data-upgrade="${sample.id}" data-cost="${cost}" data-upgrade-kind="unit" ${player.money < cost ? 'disabled' : ''}>升级 $${cost}</button>`;
          } else if (sample.upgraded) {
            html += `<div class="stat-row"><span style="color:#ffd24a">★ 已升级</span></div>`;
          }
        } else {
          // 建筑
          const def = state.buildingDefs[g.typeId];
          const cnt = g.entities.length;
          const sample = g.entities[0];
          const effMax = def.maxHp * sample.hpMultiplier;
          html += `<div class="prod-title">${def.name}${cnt > 1 ? ` ×${cnt}` : ''} #${sample.id}${sample.upgraded ? ' ★' : ''}${isEnemy ? ' <span style="color:#e07070">(敌方)</span>' : ''}</div>`;
          html += `<div class="stat-row"><span class="lbl">生命</span><span>${Math.ceil(sample.hp)}/${Math.round(effMax)}</span></div>`;
          html += `<div class="stat-row"><span class="lbl">护甲</span><span>${def.armor}</span></div>`;
          html += `<div class="stat-row"><span class="lbl">占地</span><span>${def.footprint.w}×${def.footprint.h}</span></div>`;
          html += `<div class="stat-row"><span class="lbl">电力</span><span>${def.powerProvided + sample.powerBonus} / 消耗 ${def.powerConsumed}</span></div>`;
          if (def.weapon) {
            html += `<div class="stat-row"><span class="lbl">防御</span><span>${def.weapon.damage} / 射程 ${def.weapon.range} / 冷却 ${def.weapon.reloadTicks}t</span></div>`;
          }
          if (def.visionRange) {
            html += `<div class="stat-row"><span class="lbl">视野</span><span>${def.visionRange} 格</span></div>`;
          }
          const allProduces = Array.from(new Set([...def.produces, ...sample.producesExtra]));
          if (allProduces.length > 0) {
            html += `<div class="stat-row"><span class="lbl">生产</span><span>${allProduces.map((p) => state.defs[p]?.name ?? p).join(' · ')}</span></div>`;
          }
          // 电力/生产进度的实数据仅在「单选 1 个」时显示（避免 group 卡片含义混淆）
          if (cnt === 1 && isFriendly) {
            html += `<div data-prod-power></div>`;
            html += `<div data-prod-queue></div>`;
            // 训练按钮
            html += `<div data-prod-trains style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">`;
            for (const unitId of allProduces) {
              const unitDef = state.defs[unitId];
              if (!unitDef) continue;
              html += `<button data-train="${unitId}" data-building="${sample.id}" ${player.money < unitDef.cost ? 'disabled' : ''}>${unitDef.name} $${unitDef.cost}</button>`;
            }
            html += `</div>`;
            if (!sample.upgraded) {
              const cost = upgradeCost(state, sample);
              html += `<button class="upgrade-btn" data-upgrade="${sample.id}" data-cost="${cost}" data-upgrade-kind="building" ${player.money < cost ? 'disabled' : ''}>升级 $${cost}</button>`;
            } else {
              html += `<div class="stat-row"><span style="color:#ffd24a">★ 已升级</span></div>`;
            }
          }
        }
        html += `</div>`;
      }
      this.prodPanelEl.innerHTML = html;
      this.prodPanelStructureKey = structureKey;
    }

    // 动态部分：电力、训练按钮 disable、升级按钮 disable（按当前资金）
    const powerEl = this.prodPanelEl.querySelector<HTMLElement>('[data-prod-power]');
    if (powerEl) powerEl.textContent = `电力 ${player.powerProduced}/${player.powerConsumed}${powerShort ? ' · 缺电（生产×2）' : ''}`;
    const queueEl = this.prodPanelEl.querySelector<HTMLElement>('[data-prod-queue]');
    if (queueEl) {
      const sample = items.find((e) => e.type === 'building' && e.ownerId === PLAYER_ID);
      if (sample && sample.type === 'building') {
        if (sample.productionQueue.length === 0) {
          queueEl.innerHTML = '<div style="color:#a0b0a6;margin:4px 0">无生产</div>';
        } else {
          const producing = sample.productionQueue[0];
          const unitDef = state.defs[producing];
          const ticks = unitDef.buildTicks * (powerShort ? 2 : 1);
          const pct = Math.min(100, Math.floor((sample.productionProgress / ticks) * 100));
          let qh = `<div class="prod-row"><span>${unitDef.name}</span><div class="prod-bar"><div style="width:${pct}%"></div></div></div>`;
          qh += sample.productionQueue
            .slice(1)
            .map((q: string) => `<div class="prod-row"><span>${state.defs[q].name}</span><span style="color:#a0b0a6">排队</span></div>`)
            .join('');
          queueEl.innerHTML = qh;
        }
      }
    }
    // 训练按钮 affordability
    this.prodPanelEl.querySelectorAll<HTMLButtonElement>('button[data-train]').forEach((btn) => {
      const u = state.defs[btn.dataset.train ?? ''];
      if (u) btn.disabled = player.money < u.cost;
    });
    // 升级按钮 affordability
    this.prodPanelEl.querySelectorAll<HTMLButtonElement>('button[data-upgrade]').forEach((btn) => {
      const cost = Number(btn.dataset.cost ?? '0');
      btn.disabled = player.money < cost;
    });
  }

  private activityLabel(a: string): string {
    return a === 'idle' ? '待机' : a === 'moving' ? '移动中' : a === 'attacking' ? '战斗中' : a;
  }

  private handleProductionClick(event: Event): void {
    const target = event.target as HTMLElement;
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
