import { GameState, PLAYER_ID } from '../game/state/GameState';

const OVERLAY_ID = 'result-overlay';

/**
 * 胜负界面（Step 1）：监听 state.gameOver，第一次为 true 时显示遮罩（胜负文字 + 重开按钮）。
 * 重开按钮 = reload 页面，最干净的复位方式（避免重置 AI 缓存等隐性状态）。
 * 内存开销：DOM 元素 + 一个 100ms 轮询，零额外依赖。
 */
export class ResultOverlay {
  private lastShown = false;
  private el: HTMLElement | null = null;

  update(state: GameState): void {
    if (!state.gameOver) {
      // 游戏重启 / 读档回到游戏中：清掉旧遮罩
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
    if (winner === null) return; // 进行中
    const isPlayerWin = winner === PLAYER_ID;
    const isDraw = winner === 'draw';
    const title = isDraw ? '平局' : isPlayerWin ? '胜利' : '失败';
    const sub = isDraw
      ? '双方在同一刻同归于尽'
      : isPlayerWin
        ? '敌方基地已被摧毁'
        : '你的基地已被摧毁';
    const wrap = document.createElement('div');
    wrap.id = OVERLAY_ID;
    wrap.style.cssText = `
      position: fixed; inset: 0; display: flex; flex-direction: column;
      align-items: center; justify-content: center; gap: 16px;
      background: rgba(0,0,0,0.65); color: #e8edf2;
      font-family: system-ui, -apple-system, sans-serif; z-index: 1000;
    `;
    wrap.innerHTML = `
      <h1 style="font-size:64px;margin:0;color:${isPlayerWin ? '#4caf50' : isDraw ? '#f2d93b' : '#e04848'}">${title}</h1>
      <p style="font-size:18px;margin:0;color:#a0b0a6">${sub}</p>
      <button id="result-restart" type="button" style="padding:10px 22px;font-size:16px;background:#2c4a78;color:#e8edf2;border:1px solid #506253;border-radius:6px;cursor:pointer">重新开始</button>
    `;
    document.body.appendChild(wrap);
    const btn = wrap.querySelector<HTMLButtonElement>('#result-restart');
    btn?.addEventListener('click', () => location.reload());
    this.el = wrap;
  }
}
