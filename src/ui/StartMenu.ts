import { Difficulty } from '../game/state/GameState';

const STORAGE_KEY = 'raw.difficulty';
const URL_PARAM = 'd';

const DIFFICULTY_META: Record<Difficulty, { label: string; hint: string }> = {
  easy: { label: '简单', hint: '玩家 $8000 · AI 出兵更慢更迟钝' },
  normal: { label: '普通', hint: '玩家 $5000 · AI 节奏均衡' },
  hard: { label: '困难', hint: '玩家 $4000 · AI 频繁出击' },
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
  // 优先级：URL > localStorage > 默认 normal
  const preset = fromUrl() ?? readSaved() ?? 'normal';

  const wrap = document.createElement('div');
  wrap.id = 'start-menu';
  wrap.style.cssText = [
    'position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:24px',
    'background:radial-gradient(circle at 50% 40%, #18241d 0%, #08090a 100%)',
    'color:#e8edf2;font-family:system-ui,-apple-system,sans-serif;z-index:900',
  ].join(';');
  wrap.innerHTML = `
    <h1 style="font-size:48px;margin:0;letter-spacing:.05em">红警 Web</h1>
    <p style="font-size:14px;margin:0;color:#a0b0a6;letter-spacing:.08em">原创 RTS 原型 · 选择难度开始</p>
    <div id="start-buttons" style="display:flex;gap:14px;margin-top:8px"></div>
    <p style="font-size:11px;margin:18px 0 0;color:#6b7c72">操作：左键选中/框选 · 右键移动/攻击 · H 回主视图 · 空格暂停 · Ctrl+1~9 编队 · 1~9 复读</p>
  `;
  document.body.appendChild(wrap);

  const btnWrap = wrap.querySelector<HTMLDivElement>('#start-buttons')!;
  (Object.keys(DIFFICULTY_META) as Difficulty[]).forEach((d) => {
    const meta = DIFFICULTY_META[d];
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.difficulty = d;
    btn.style.cssText = [
      'padding:14px 22px;font-size:18px;cursor:pointer;min-width:140px;text-align:center',
      `background:${d === preset ? '#2c4a78' : '#1c2820'};color:#e8edf2`,
      'border:1px solid #506253;border-radius:6px',
    ].join(';');
    btn.innerHTML = `<div style="font-weight:600">${meta.label}</div><div style="font-size:11px;color:#a0b0a6;margin-top:4px">${meta.hint}</div>`;
    btn.addEventListener('click', () => {
      remember(d);
      wrap.remove();
      onPick(d);
    });
    btnWrap.appendChild(btn);
  });
}
