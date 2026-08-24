import { Difficulty } from '../game/state/GameState';

const STORAGE_KEY = 'raw.difficulty';
const URL_PARAM = 'd';

const DIFFICULTY_META: Record<Difficulty, { code: string; label: string; hint: string; threat: string }> = {
  easy: { code: '01', label: '新兵演习', hint: '初始资金 $8000 · 敌军反应较慢', threat: '低威胁' },
  normal: { code: '02', label: '前线冲突', hint: '初始资金 $5000 · 标准作战节奏', threat: '标准' },
  hard: { code: '03', label: '钢铁风暴', hint: '初始资金 $4000 · 敌军频繁出击', threat: '高威胁' },
};

function readSaved(): Difficulty | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'easy' || v === 'normal' || v === 'hard') return v;
  } catch {
    // 沙盒/隐私模式可能拒绝 localStorage，回退 URL。
  }
  return null;
}

function fromUrl(): Difficulty | null {
  const q = new URLSearchParams(window.location.search).get(URL_PARAM);
  if (q === 'easy' || q === 'normal' || q === 'hard') return q;
  return null;
}

function remember(d: Difficulty): void {
  try {
    localStorage.setItem(STORAGE_KEY, d);
  } catch {
    /* 沙盒里无 storage 也无所谓 */
  }
}

/** 启动遮罩：玩家先选难度再 boot。回调 onPick 在用户点按钮后触发。 */
export function mountStartMenu(onPick: (d: Difficulty) => void): void {
  const preset = fromUrl() ?? readSaved() ?? 'normal';

  const wrap = document.createElement('div');
  wrap.id = 'start-menu';
  wrap.innerHTML = `
    <div class="start-backdrop" aria-hidden="true">
      <span class="scan-line"></span>
      <span class="radar-ring radar-ring-a"></span>
      <span class="radar-ring radar-ring-b"></span>
    </div>
    <section class="command-console" aria-labelledby="game-title">
      <header class="command-header">
        <span class="command-emblem" aria-hidden="true"><i></i></span>
        <div class="command-brand">
          <p>FIELD COMMAND NETWORK // 07</p>
          <h1 id="game-title">铁幕前线</h1>
        </div>
        <div class="system-state" aria-label="系统在线"><span></span> 战区链路正常</div>
      </header>

      <div class="command-body">
        <nav class="campaign-nav" aria-label="游戏模式">
          <p class="panel-label">作战档案</p>
          <button class="campaign-tab is-active" type="button"><span>01</span><strong>遭遇战</strong><small>SKIRMISH</small></button>
          <button class="campaign-tab" type="button" disabled><span>02</span><strong>战役任务</strong><small>COMING SOON</small></button>
          <button class="campaign-tab" type="button" disabled><span>03</span><strong>网络对战</strong><small>OFFLINE</small></button>
          <div class="commander-card">
            <span class="commander-avatar" aria-hidden="true"></span>
            <div><small>指挥官</small><strong>PLAYER 01</strong></div>
          </div>
        </nav>

        <div class="mission-panel">
          <div class="mission-heading">
            <div>
              <p class="panel-label">任务配置 / MISSION SETUP</p>
              <h2>选择交战强度</h2>
              <p>侦察卫星已锁定目标区域。选择难度后立即部署基地车。</p>
            </div>
            <div class="mission-code" aria-hidden="true">RA<br /><b>26</b></div>
          </div>
          <div id="start-buttons" class="difficulty-grid"></div>
          <div class="battle-briefing">
            <span><small>区域</small><strong>北境矿区 04</strong></span>
            <span><small>任务</small><strong>摧毁敌方基地</strong></span>
            <span><small>环境</small><strong>能见度有限</strong></span>
          </div>
        </div>
      </div>

      <footer class="command-footer">
        <p><kbd>左键</kbd> 选择 / 框选　<kbd>右键</kbd> 移动 / 攻击　<kbd>H</kbd> 回主视图　<kbd>空格</kbd> 暂停</p>
        <span>ORIGINAL BROWSER RTS PROTOTYPE</span>
      </footer>
    </section>
  `;
  document.body.appendChild(wrap);

  const btnWrap = wrap.querySelector<HTMLDivElement>('#start-buttons')!;
  (Object.keys(DIFFICULTY_META) as Difficulty[]).forEach((d) => {
    const meta = DIFFICULTY_META[d];
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.difficulty = d;
    btn.className = `difficulty-card${d === preset ? ' is-selected' : ''}`;
    btn.setAttribute('aria-pressed', d === preset ? 'true' : 'false');
    btn.innerHTML = `
      <span class="difficulty-code">${meta.code}</span>
      <span class="difficulty-copy"><strong>${meta.label}</strong><small>${meta.hint}</small></span>
      <span class="difficulty-threat">${meta.threat}</span>
      <span class="difficulty-launch">部署 <b aria-hidden="true">›</b></span>
    `;
    btn.addEventListener('mouseenter', () => {
      btnWrap.querySelectorAll('.difficulty-card').forEach((item) => item.classList.remove('is-preview'));
      btn.classList.add('is-preview');
    });
    btn.addEventListener('click', () => {
      remember(d);
      wrap.classList.add('is-launching');
      window.setTimeout(() => {
        wrap.remove();
        onPick(d);
      }, 180);
    });
    btnWrap.appendChild(btn);
  });
}
