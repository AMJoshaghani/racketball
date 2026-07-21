import * as THREE from 'three';
import { buildScene, buildRenderer, buildCamera, fitCameraFov, ARENA } from './scene.js';
import { Paddle, Ball } from './entities.js';
import { Match } from './game.js';
import { Keyboard, CONTROLS, readAxis } from './input.js';
import { AIController } from './ai.js';
import { NetSession } from './network.js';
import { UI } from './ui.js';
import { SFX } from './audio.js';
import { TouchControls } from './touch.js';

const clock = new THREE.Clock();

class App {
  constructor() {
    this.ui = new UI();
    this.keyboard = new Keyboard();
    this.touch = new TouchControls(this.keyboard);

    const gameRoot = document.getElementById('game-root');
    this.scene = buildScene();
    this.camera = buildCamera();
    this.renderer = buildRenderer(gameRoot);

    this.paddleP1 = new Paddle(this.scene, { z: ARENA.baselineZ, color: 0x00f0c0 });
    this.paddleP2 = new Paddle(this.scene, { z: -ARENA.baselineZ, color: 0xff3d6e });
    this.ball = new Ball(this.scene);

    window.addEventListener('resize', () => this._onResize());
    window.addEventListener('orientationchange', () => setTimeout(() => this._onResize(), 50));

    this.mode = null;      // 'local' | 'ai' | 'host' | 'guest'
    this.mirror = false;   // true when local player is Match.p2 (guest)
    this.match = null;
    this.ai = null;
    this.net = null;
    this.state = 'menu';   // 'menu' | 'countdown' | 'playing' | 'over'
    this.countdownT = 0;
    this.shake = 0;

    // Guest-only: latest + previous snapshot from host, for diffing events.
    this.remote = null;
    this.remotePrev = null;

    this._loop = this._loop.bind(this);
    this._showMainMenu();
    requestAnimationFrame(this._loop);
  }

  _onResize() {
    fitCameraFov(this.camera);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  _showMainMenu() {
    this.state = 'menu';
    this.mode = null;
    if (this.net) { this.net.destroy(); this.net = null; }
    this.ui.hideHUD();
    this.ui.setHint('');
    this.touch.hide();
    this.ui.showMainMenu({
      onLocal: () => this._startLocal(),
      onAI: () => this._pickDifficulty(),
      onHost: () => this._startHost(),
      onJoin: () => this._startJoin(),
    });
  }

  _pickDifficulty() {
    this.ui.showDifficultyMenu({
      onPick: (d) => this._startAI(d),
      onBack: () => this._showMainMenu(),
    });
  }

  _startLocal() {
    this.mode = 'local';
    this.mirror = false;
    this.match = new Match();
    this.touch.build([
      { scheme: CONTROLS.p2, side: 'left' },
      { scheme: CONTROLS.p1, side: 'right' },
    ]);
    this.ui.setHint('P1: A/D move · Space shoot   —   P2: ←/→ move · Enter shoot');
    this._beginCountdown();
  }

  _startAI(difficulty) {
    this.mode = 'ai';
    this.mirror = false;
    this.aiDifficulty = difficulty;
    this.match = new Match();
    this.ai = new AIController(difficulty);
    this.touch.build([{ scheme: CONTROLS.p1, side: 'right' }]);
    this.ui.setHint('A / D to move · Space to shoot');
    this._beginCountdown();
  }

  _startHost() {
    this.mode = 'host';
    this.mirror = false;
    this.match = new Match();
    this.net = new NetSession();
    this._bindNetworkData();
    this.touch.build([{ scheme: CONTROLS.p1, side: 'right' }]);
    this.ui.showHostScreen({});
    this.ui.bindBack(() => this._showMainMenu());
    this.net.onOpenId = (id) => this.ui.setHostId(id);
    this.net.onConnected = () => {
      this.ui.setStatus('Opponent connected!');
      this._beginCountdown();
    };
    this.net.onClose = () => this._handleDisconnect();
    this.net.onError = (err) => this.ui.showPeerError(String((err && err.type) || err), () => this._showMainMenu());
    this.net.host().catch(() => {});
  }

  _startJoin() {
    this.mode = 'guest';
    this.mirror = true;
    this.match = new Match();
    this.net = new NetSession();
    this._bindNetworkData();
    this.touch.build([{ scheme: CONTROLS.p1, side: 'right' }]);
    this.ui.showJoinScreen({
      onBack: () => this._showMainMenu(),
      onSubmit: (code) => {
        this.ui.setStatus('Connecting…');
        this.net.onConnected = () => this._beginCountdown();
        this.net.onClose = () => this._handleDisconnect();
        this.net.onError = () => this.ui.setStatus('Could not connect. Check the code and try again.');
        this.net.join(code).catch(() => {});
      },
    });
  }

  _handleDisconnect() {
    if (this.state === 'playing' || this.state === 'countdown') {
      this.ui.showPeerError('Your opponent disconnected.', () => this._showMainMenu());
      this.touch.hide();
      this.state = 'over';
    }
  }

  _beginCountdown() {
    this.state = 'countdown';
    this.countdownT = 3.0;
    this.ui.clearPanel();
    this.ui.showHUD();
    this.ui.updateScore(0, 0);
    this.ui.showCountdown(3);
    this.touch.show();
  }

  _selfOppScore() {
    if (!this.match) return { me: 0, opp: 0 };
    const s = this.match.score;
    return this.mirror ? { me: s.p2, opp: s.p1 } : { me: s.p1, opp: s.p2 };
  }

  _handleEvents(events) {
    for (const ev of events) {
      if (ev === 'shoot') SFX.shoot();
      else if (ev.startsWith('hit:')) { SFX.hit(); this.shake = 0.15; }
      else if (ev === 'wall') SFX.wall();
      else if (ev.startsWith('goal:')) {
        SFX.goal();
        this.ui.flashScreen();
        this.shake = 0.3;
        const scorer = ev.split(':')[1];
        const scorerIsMe = this.mirror ? scorer === 'p2' : scorer === 'p1';
        this.ui.flashGoal(scorerIsMe ? 'YOU SCORE!' : 'OPPONENT SCORES');
      } else if (ev.startsWith('win:')) {
        this._endMatch();
      }
    }
    const { me, opp } = this._selfOppScore();
    this.ui.updateScore(me, opp);
  }

  _endMatch() {
    this.state = 'over';
    this.touch.hide();
    const won = this.mirror ? this.match.winner === 'p2' : this.match.winner === 'p1';
    if (won) SFX.win();
    const { me, opp } = this._selfOppScore();
    setTimeout(() => {
      this.ui.showGameOver({
        won,
        score: { me, opp },
        onRematch: () => this._rematch(),
        onMenu: () => this._showMainMenu(),
      });
    }, 400);
  }

  _rematch(fromPeer = false) {
    this.match = new Match();
    if (this.mode === 'ai') this.ai = new AIController(this.aiDifficulty);
    if (!fromPeer && this.net) this.net.send({ t: 'rematch' });
    this.remote = null;
    this.remotePrev = null;
    this._beginCountdown();
  }

  _localInput() {
    return { dir: readAxis(this.keyboard, CONTROLS.p1), shoot: this.keyboard.consumeJustPressed(CONTROLS.p1.shoot) };
  }

  _step(dt) {
    if (this.state === 'countdown') {
      this.countdownT -= dt;
      const n = Math.ceil(this.countdownT);
      if (n > 0) this.ui.showCountdown(n);
      else this.ui.showCountdown(0);
      if (this.countdownT <= -0.6) {
        this.ui.hideCountdown();
        SFX.go();
        this.state = 'playing';
      }
      return;
    }
    if (this.state !== 'playing') return;

    if (this.mode === 'local') {
      const p1In = { dir: readAxis(this.keyboard, CONTROLS.p1), shoot: this.keyboard.consumeJustPressed(CONTROLS.p1.shoot) };
      const p2In = { dir: readAxis(this.keyboard, CONTROLS.p2), shoot: this.keyboard.consumeJustPressed(CONTROLS.p2.shoot) };
      const events = this.match.step(dt, p1In, p2In);
      this._handleEvents(events);
    } else if (this.mode === 'ai') {
      const p1In = this._localInput();
      const b = this.match.ball;
      const aiIn = this.ai.decide(dt, {
        ball: { x: b.x, z: b.z, vx: b.vx, vz: b.vz, carriedBy: b.carriedBy === 'p2' ? 'ai' : b.carriedBy },
        self: this.match.p2,
      });
      const events = this.match.step(dt, p1In, aiIn);
      this._handleEvents(events);
    } else if (this.mode === 'host') {
      const p1In = this._localInput();
      const p2In = this._remoteInput || { dir: 0, shoot: false };
      const events = this.match.step(dt, p1In, p2In);
      this._handleEvents(events);
      this.net && this.net.send({ t: 'state', s: this.match.serialize() });
    } else if (this.mode === 'guest') {
      const selfIn = this._localInput();
      this.net && this.net.send({ t: 'input', dir: selfIn.dir, shoot: selfIn.shoot });
      this._applyRemoteDiff();
    }
  }

  _bindNetworkData() {
    if (!this.net) return;
    this.net.onData = (data) => {
      if (data.t === 'state' && this.mode === 'guest') {
        this.remotePrev = this.remote;
        this.remote = data.s;
      } else if (data.t === 'input' && this.mode === 'host') {
        this._remoteInput = { dir: data.dir, shoot: data.shoot };
      } else if (data.t === 'rematch') {
        this.ui.clearPanel();
        this._rematch(true);
      }
    };
  }

  _applyRemoteDiff() {
    if (!this.remote) return;
    const prev = this.remotePrev;
    const cur = this.remote;
    this.match.applySnapshot(cur);

    if (prev) {
      if (prev.ball.carriedBy && !cur.ball.carriedBy) SFX.shoot();
      if (!prev.ball.carriedBy && cur.ball.carriedBy) { SFX.hit(); this.shake = 0.15; }
      if (cur.score.p1 !== prev.score.p1 || cur.score.p2 !== prev.score.p2) {
        SFX.goal();
        this.ui.flashScreen();
        this.shake = 0.3;
        const p1Scored = cur.score.p1 > prev.score.p1;
        const scorerIsMe = this.mirror ? !p1Scored : p1Scored;
        this.ui.flashGoal(scorerIsMe ? 'YOU SCORE!' : 'OPPONENT SCORES');
      }
      if (cur.over && !prev.over) this._endMatch();
    }
    const { me, opp } = this._selfOppScore();
    this.ui.updateScore(me, opp);
  }

  _render(dt = 0.016) {
    // Mirror world-Z for the guest so their own paddle always renders near-camera.
    const mz = (z) => (this.mirror ? -z : z);

    const selfP = this.mirror ? this.match.p2 : this.match.p1;
    const oppP = this.mirror ? this.match.p1 : this.match.p2;

    this.paddleP1.setX(selfP.x);
    this.paddleP1.mesh.position.z = ARENA.baselineZ;
    this.paddleP2.setX(oppP.x);
    this.paddleP2.mesh.position.z = -ARENA.baselineZ;

    const b = this.match.ball;
    this.ball.x = b.x;
    this.ball.z = mz(b.z);
    this.ball.y = 65;
    this.ball.sync();

    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt);
      const s = this.shake * 14;
      this.camera.position.x = (Math.random() - 0.5) * s;
      this.camera.position.y = 520 + (Math.random() - 0.5) * s * 0.5;
    } else {
      this.camera.position.x = 0;
      this.camera.position.y = 520;
    }
    this.camera.position.z = ARENA.baselineZ + 480;
    this.camera.lookAt(0, 40, 0);

    this.renderer.render(this.scene, this.camera);
  }

  _loop() {
    requestAnimationFrame(this._loop);
    const dt = Math.min(clock.getDelta(), 0.05);
    this._step(dt);
    if (this.match) this._render(dt);
  }
}

new App();
