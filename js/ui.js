const root = () => document.getElementById('ui-root');

function el(tag, className, html) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

export class UI {
  constructor() {
    this.panel = null;
    this._buildPersistent();
  }

  _buildPersistent() {
    this.hud = el('div', 'hud hidden');
    this.hud.id = 'hud';
    this.hud.innerHTML = `
      <div class="score me" id="score-me">0</div>
      <div class="dash">:</div>
      <div class="score opp" id="score-opp">0</div>
    `;
    root().appendChild(this.hud);

    this.hint = el('div', 'hidden');
    this.hint.id = 'hint';
    root().appendChild(this.hint);

    this.countdown = el('div', 'hidden');
    this.countdown.id = 'countdown';
    root().appendChild(this.countdown);

    this.goalBanner = el('div');
    this.goalBanner.id = 'goal-banner';
    root().appendChild(this.goalBanner);

    this.flash = el('div');
    this.flash.id = 'flash';
    root().appendChild(this.flash);
  }

  clearPanel() {
    if (this.panel) {
      this.panel.remove();
      this.panel = null;
    }
  }

  _panel(innerHtml) {
    this.clearPanel();
    this.panel = el('div', 'panel', innerHtml);
    root().appendChild(this.panel);
    return this.panel;
  }

  showMainMenu({ onLocal, onAI, onHost, onJoin }) {
    const p = this._panel(`
      <h1>RacketBall</h1>
      <h2>3D Arcade Paddle-Ball</h2>
      <div class="btn-col">
        <div class="btn primary" data-a="local">Local 2-Player</div>
        <div class="btn primary" data-a="ai">Single Player vs AI</div>
        <div class="btn" data-a="host">Host Online Match</div>
        <div class="btn" data-a="join">Join Online Match</div>
      </div>
    `);
    p.querySelector('[data-a="local"]').onclick = onLocal;
    p.querySelector('[data-a="ai"]').onclick = onAI;
    p.querySelector('[data-a="host"]').onclick = onHost;
    p.querySelector('[data-a="join"]').onclick = onJoin;
  }

  showDifficultyMenu({ onPick, onBack }) {
    const p = this._panel(`
      <h1>Choose Difficulty</h1>
      <div class="btn-col">
        <div class="btn" data-d="easy">Easy</div>
        <div class="btn primary" data-d="normal">Normal</div>
        <div class="btn" data-d="hard">Hard</div>
        <div class="btn ghost" data-a="back">Back</div>
      </div>
    `);
    p.querySelectorAll('[data-d]').forEach((b) => {
      b.onclick = () => onPick(b.dataset.d);
    });
    p.querySelector('[data-a="back"]').onclick = onBack;
  }

  showHostScreen({ status = 'Opening connection…' }) {
    const p = this._panel(`
      <h1>Host Match</h1>
      <h2>Share this code with your opponent</h2>
      <div class="id-display" id="host-id">…</div>
      <div class="btn ghost" data-a="copy">Copy Code</div>
      <div class="status-line" id="host-status">${status}</div>
      <div class="btn ghost" data-a="back" style="margin-top:14px;">Cancel</div>
    `);
    return p;
  }

  setHostId(id) {
    const idEl = document.getElementById('host-id');
    if (idEl) idEl.textContent = id;
    const copyBtn = this.panel && this.panel.querySelector('[data-a="copy"]');
    if (copyBtn) {
      copyBtn.onclick = () => {
        navigator.clipboard && navigator.clipboard.writeText(id).catch(() => {});
        copyBtn.textContent = 'Copied!';
        setTimeout(() => (copyBtn.textContent = 'Copy Code'), 1200);
      };
    }
  }

  setStatus(text) {
    const s = document.getElementById('host-status') || document.getElementById('join-status');
    if (s) s.textContent = text;
  }

  bindBack(onBack) {
    const b = this.panel && this.panel.querySelector('[data-a="back"]');
    if (b) b.onclick = onBack;
  }

  showJoinScreen({ onSubmit, onBack }) {
    const p = this._panel(`
      <h1>Join Match</h1>
      <h2>Enter the host's code</h2>
      <input type="text" id="join-code" placeholder="paste code here" autofocus>
      <div class="btn primary" data-a="join">Connect</div>
      <div class="status-line" id="join-status"></div>
      <div class="btn ghost" data-a="back" style="margin-top:14px;">Cancel</div>
    `);
    const input = p.querySelector('#join-code');
    const go = () => {
      const v = input.value.trim();
      if (v) onSubmit(v);
    };
    p.querySelector('[data-a="join"]').onclick = go;
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    p.querySelector('[data-a="back"]').onclick = onBack;
    input.focus();
  }

  showGameOver({ won, score, onRematch, onMenu }) {
    const p = this._panel(`
      <h1>${won ? 'Victory!' : 'Defeat'}</h1>
      <h2>Final Score ${score.me} — ${score.opp}</h2>
      <div class="btn-col">
        <div class="btn primary" data-a="rematch">Rematch</div>
        <div class="btn ghost" data-a="menu">Main Menu</div>
      </div>
    `);
    p.querySelector('[data-a="rematch"]').onclick = onRematch;
    p.querySelector('[data-a="menu"]').onclick = onMenu;
  }

  showPeerError(message, onBack) {
    const p = this._panel(`
      <h1>Connection Error</h1>
      <p class="sub">${message}</p>
      <div class="btn ghost" data-a="back">Back to Menu</div>
    `);
    p.querySelector('[data-a="back"]').onclick = onBack;
  }

  setHint(text) {
    this.hint.textContent = text;
    this.hint.classList.toggle('hidden', !text);
  }

  showHUD() { this.hud.classList.remove('hidden'); }
  hideHUD() { this.hud.classList.add('hidden'); }

  updateScore(me, opp) {
    document.getElementById('score-me').textContent = me;
    document.getElementById('score-opp').textContent = opp;
  }

  showCountdown(n) {
    this.countdown.textContent = n > 0 ? n : 'GO!';
    this.countdown.classList.remove('hidden');
  }

  hideCountdown() {
    this.countdown.classList.add('hidden');
  }

  flashGoal(text) {
    this.goalBanner.textContent = text;
    this.goalBanner.style.transition = 'none';
    this.goalBanner.style.opacity = '1';
    this.goalBanner.style.transform = 'translate(-50%, -50%) scale(1.15)';
    requestAnimationFrame(() => {
      this.goalBanner.style.transition = 'opacity 0.9s ease, transform 0.9s ease';
      this.goalBanner.style.opacity = '0';
      this.goalBanner.style.transform = 'translate(-50%, -50%) scale(1)';
    });
  }

  flashScreen() {
    this.flash.style.transition = 'none';
    this.flash.style.opacity = '0.35';
    requestAnimationFrame(() => {
      this.flash.style.transition = 'opacity 0.3s ease';
      this.flash.style.opacity = '0';
    });
  }
}
