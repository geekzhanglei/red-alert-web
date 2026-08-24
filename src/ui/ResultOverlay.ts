import { GameState, PLAYER_ID } from '../game/state/GameState';

const OVERLAY_ID = 'result-overlay';

/** 显示战局结果；重开采用 reload，保证模拟、AI 与输入状态完整复位。 */
export class ResultOverlay {
  private lastShown = false;
  private el: HTMLElement | null = null;

  update(state: GameState): void {
    if (!state.gameOver) {
      if (this.lastShown) {
        this.el?.remove();
        this.el = null;
        this.lastShown = false;
      }
      return;
    }
    if (this.lastShown) return;
    this.show(state);
    this.lastShown = true;
  }

  private show(state: GameState): void {
    const winner = state.winner;
    if (winner === null) return;
    const isPlayerWin = winner === PLAYER_ID;
    const isDraw = winner === 'draw';
    const title = isDraw ? '交战终止' : isPlayerWin ? '任务完成' : '任务失败';
    const sub = isDraw
      ? '双方作战力量同时失去响应'
      : isPlayerWin
        ? '敌方指挥中心已被摧毁，区域控制权已确认'
        : '我方指挥中心失守，部队已撤出交战区域';
    const status = isDraw ? 'STALEMATE' : isPlayerWin ? 'OBJECTIVE COMPLETE' : 'OPERATION FAILED';
    const theme = isDraw ? 'draw' : isPlayerWin ? 'victory' : 'defeat';

    const wrap = document.createElement('div');
    wrap.id = OVERLAY_ID;
    wrap.className = `result-overlay result-${theme}`;
    wrap.innerHTML = `
      <div class="result-scan" aria-hidden="true"></div>
      <section class="result-console" aria-labelledby="result-title">
        <header><span>战区报告 // AAR-04</span><i aria-hidden="true"></i><b>${status}</b></header>
        <div class="result-content">
          <span class="result-insignia" aria-hidden="true"></span>
          <p>AFTER ACTION REPORT</p>
          <h1 id="result-title">${title}</h1>
          <div class="result-rule"></div>
          <p class="result-summary">${sub}</p>
          <button id="result-restart" type="button"><span>返回作战菜单</span><b aria-hidden="true">›</b></button>
        </div>
        <footer><span>记录已写入指挥档案</span><span>LINK STATUS: STANDBY</span></footer>
      </section>
    `;
    document.body.appendChild(wrap);
    wrap.querySelector<HTMLButtonElement>('#result-restart')?.addEventListener('click', () => location.reload());
    this.el = wrap;
  }
}
