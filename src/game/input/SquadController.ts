import Phaser from 'phaser';
import { Game } from '../core/Game';
import { PLAYER_ID } from '../state/GameState';

/**
 * 数字键编队/复读（docs/11-control-groups.md）。
 * Ctrl + 1~9：把当前 selectedEntityIds 存到 squads[数字]。
 * 单按 1~9：把 squads[数字] 写回 selectedEntityIds（且过滤掉死亡/失主的单位）。
 * 双击 1~9：等价于单按（和 RTS 一致）。
 */
export class SquadController {
  /** 1~9 范围。 */
  static readonly KEYS = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE'] as const;

  constructor(scene: Phaser.Scene, private game: Game) {
    const kb = scene.input.keyboard;
    if (!kb) return;
    for (let i = 0; i < SquadController.KEYS.length; i++) {
      const slot = i + 1;
      const code = SquadController.KEYS[i];
      kb.on(`keydown-${code}` as any, (ev: KeyboardEvent) => this.onPress(slot, ev.ctrlKey || ev.metaKey));
    }
  }

  private onPress(slot: number, withCtrl: boolean): void {
    const state = this.game.state;
    if (withCtrl) {
      // 保存：复制当前选中，过滤掉非己方或死亡
      const ids = state.selectedEntityIds.filter((id) => {
        const e = state.entities[id];
        return e && e.ownerId === PLAYER_ID;
      });
      state.squads[slot] = ids;
      this.flash(`${ids.length} 单位 → 编队 ${slot}`);
      return;
    }
    // 复读：写回选中（再过滤一次死亡/失主，避免读出僵尸）
    const ids = state.squads[slot] ?? [];
    state.selectedEntityIds = ids.filter((id) => {
      const e = state.entities[id];
      return e && e.ownerId === PLAYER_ID;
    });
    this.flash(`编队 ${slot} · ${state.selectedEntityIds.length} 单位`);
  }

  /** 简短反馈（屏幕中央一闪即逝的文字；阶段允许直接 DOM textContent）。 */
  private flash(text: string): void {
    const el = document.getElementById('squad-flash');
    if (!el) return;
    el.textContent = text;
    el.style.opacity = '1';
    setTimeout(() => { el.style.opacity = '0'; }, 800);
  }
}
