import * as THREE from 'three';
import { buildScene, buildRenderer, buildCamera, fitCameraFov, ARENA } from './scene.js';
import { Paddle, Ball, BALL_RADIUS } from './entities.js';
import { Match, decodeSide, stepPaddlePhysics } from './game.js';
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

    // Guest-only: latest snapshot from host, used to diff against the
    // next incoming packet for one-shot events (goal/hit/shoot SFX).
    this.remote = null;
    // Guest-only: continuous-position interpolation targets, for the
    // OPPONENT's paddle and the ball only (not the guest's own paddle -
    // see _predictedSelf below). State only arrives a limited number of
    // times/sec over the network, so snapping straight to each new
    // position produces a visible stutter - especially noticeable on a
    // relayed (TURN) connection where arrival timing is less even.
    // Instead we keep the last known network position as a target and
    // smoothly ease the rendered position toward it every frame.
    this._netTargetP1x = 0;
    this._netTargetP2x = 0;
    this._netTargetBallX = 0;
    this._netTargetBallZ = 0;
    this._paddleInterpRate = 14; // opponent paddle - moves up to 620 units/sec
    this._netTargetBallVx = 0;   // ball extrapolation velocity (from host snapshots)
    this._netTargetBallVz = 0;

    // Guest-only: client-side prediction for the guest's OWN paddle.
    // Without this, every keypress has to travel guest -> host -> guest
    // (a full round trip over the relay) before any movement is visible,
    // which reads as input lag no amount of visual smoothing can hide.
    // Instead the guest runs the exact same paddle physics locally, the
    // instant a key is pressed, and only gently reconciles toward the
    // host's confirmed position afterward to correct for drift - see
    // _stepInterpolation.
    this._predictedSelf = { x: 0, vx: 0 };
    this._idleTime = 0; // how long the paddle has had zero input, for reconciliation gating
    this.IDLE_RECONCILE_DELAY = 0.22; // seconds of idle before trusting host's confirmed position
    this.IDLE_RECONCILE_RATE = 8;     // correction speed once idle-gated reconciliation kicks in
    this.HARD_ERROR_THRESHOLD = 140;  // units of divergence that imply a real desync, not just lag
    this.HARD_ERROR_RATE = 10;        // correction speed for the large-divergence safety net

    // Simulation and rendering stay at full frame rate; only the network
    // *send* rate is throttled, since a paddle game doesn't need 60
    // updates/sec to feel responsive, and every message costs real
    // bandwidth (and, over a TURN relay, real quota). Client-side
    // prediction (above) means the guest's own responsiveness no longer
    // depends on this rate at all, so it can run lower than before
    // without feeling worse - which also means less relay traffic.
    this._stateSendAccum = 0;
    this._inputSendAccum = 0;
    this._pendingShoot = false;
    this.STATE_SEND_INTERVAL = 1 / 10; // host -> guest state, 10Hz (dead reckoning keeps ball smooth between updates)
    this.INPUT_SEND_INTERVAL = 1 / 15; // guest -> host input, 15Hz (client-side prediction masks latency)
    this._lastSentSnapshot = null;     // cached serialized state for dirty-check
    this._lastSentDir = 0;             // last direction sent to host, for guest input dirty-check

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
    this.ui.setHint('A / D to move · Space to shoot');
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
    this.ui.setHint('A / D to move · Space to shoot');
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
    this._stateSendAccum = 0;
    this._inputSendAccum = 0;
    this._pendingShoot = false;
    this._predictedSelf = { x: 0, vx: 0 };
    this._idleTime = 0;
    this._netTargetP1x = 0;
    this._netTargetP2x = 0;
    this._netTargetBallX = 0;
    this._netTargetBallZ = 0;
    this._netTargetBallVx = 0;
    this._netTargetBallVz = 0;
    this._lastSentSnapshot = null;
    this._lastSentDir = 0;
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
      this._stateSendAccum += dt;
      if (this.net && this._stateSendAccum >= this.STATE_SEND_INTERVAL) {
        this._stateSendAccum = 0;
        const snap = this.match.serialize();
        // Dirty-check: skip sending if nothing changed since the last
        // state packet. During idle moments (ball held, paddles still,
        // countdown) this eliminates up to 100% of relay traffic.
        if (!this._lastSentSnapshot || !arraysEqual(this._lastSentSnapshot, snap)) {
          this._lastSentSnapshot = snap;
          this.net.send({ t: 'state', s: snap });
        }
      }
    } else if (this.mode === 'guest') {
      // Direction is read every frame (not just on throttled send frames)
      // so client-side prediction below stays perfectly responsive
      // regardless of how often we actually transmit it over the network.
      const dir = readAxis(this.keyboard, CONTROLS.p1);

      // consumeJustPressed clears the edge-triggered flag as soon as it's
      // read, so if we only read it on send frames (throttled below) a
      // press on a skipped frame would be lost. Accumulate it every
      // frame regardless, and only clear once actually sent.
      if (this.keyboard.consumeJustPressed(CONTROLS.p1.shoot)) this._pendingShoot = true;

      this._inputSendAccum += dt;
      if (this.net && this._inputSendAccum >= this.INPUT_SEND_INTERVAL) {
        this._inputSendAccum = 0;
        // Dirty-check: skip sending if input hasn't changed and there's no
        // pending shoot. During idle holding this cuts guest->host traffic
        // to near zero while the host keeps applying dir=0, shoot=false.
        const inputChanged = dir !== this._lastSentDir || this._pendingShoot;
        if (inputChanged) {
          this._lastSentDir = dir;
          this.net.send({ t: 'input', dir, shoot: this._pendingShoot });
        }
        this._pendingShoot = false;
      }

      // Client-side prediction: move the guest's own paddle immediately
      // using the same physics the host runs, instead of waiting for a
      // round trip.
      stepPaddlePhysics(this._predictedSelf, dir, dt);

      // Reconciliation toward the host's confirmed position. While
      // actively moving, the host's confirmation always legitimately
      // lags the local prediction by about one round trip - that's
      // expected latency, not drift, so continuously blending toward it
      // would just fight the prediction and re-introduce the exact lag
      // it's meant to hide (visible as "delayed start / delayed stop").
      // Correction only runs once the paddle has been idle long enough
      // for the host's confirmation to have caught up, or immediately if
      // the divergence is large enough to indicate a real desync (e.g.
      // dropped packets) rather than expected phase lag.
      this._idleTime = dir === 0 ? this._idleTime + dt : 0;
      const error = Math.abs(this._netTargetP2x - this._predictedSelf.x);
      let reconcileRate = 0;
      if (error > this.HARD_ERROR_THRESHOLD) {
        reconcileRate = this.HARD_ERROR_RATE;
      } else if (this._idleTime > this.IDLE_RECONCILE_DELAY) {
        reconcileRate = this.IDLE_RECONCILE_RATE;
      }
      if (reconcileRate > 0) {
        const t = 1 - Math.exp(-reconcileRate * dt);
        this._predictedSelf.x += (this._netTargetP2x - this._predictedSelf.x) * t;
      }
      this.match.p2.x = this._predictedSelf.x;

      this._stepInterpolation(dt);
    }
  }

  _bindNetworkData() {
    if (!this.net) return;
    this.net.onData = (data) => {
      if (data.t === 'state' && this.mode === 'guest') {
        const prev = this.remote;
        this.remote = data.s;
        this._handleRemoteState(prev, data.s);
      } else if (data.t === 'input' && this.mode === 'host') {
        this._remoteInput = { dir: data.dir, shoot: data.shoot };
      } else if (data.t === 'rematch') {
        this.ui.clearPanel();
        this._rematch(true);
      }
    };
  }

  /** Called exactly once per incoming network state packet (not once per
   * render frame) - applies discrete fields immediately and fires
   * one-shot events (goal, hit, shoot) by comparing to the previous
   * packet. Continuous fields are stored as interpolation targets; see
   * _stepInterpolation for how those get eased toward each frame. */
  _handleRemoteState(prev, cur) {
    // Snapshot indices: [p1x, p2x, ballx, ballz, ballvx, ballvz, carriedByCode, scoreP1, scoreP2, overFlag, winnerCode]
    this.match.ball.carriedBy = decodeSide(cur[6]);
    this.match.score = { p1: cur[7], p2: cur[8] };
    this.match.over = !!cur[9];
    this.match.winner = decodeSide(cur[10]);

    this._netTargetP1x = cur[0];
    this._netTargetP2x = cur[1];
    this._netTargetBallX = cur[2];
    this._netTargetBallZ = cur[3];
    this._netTargetBallVx = cur[4];
    this._netTargetBallVz = cur[5];

    if (prev) {
      const prevCarried = prev[6];
      const curCarried = cur[6];
      if (prevCarried && !curCarried) SFX.shoot();
      if (!prevCarried && curCarried) { SFX.hit(); this.shake = 0.15; }
      if (cur[7] !== prev[7] || cur[8] !== prev[8]) {
        SFX.goal();
        this.ui.flashScreen();
        this.shake = 0.3;
        const p1Scored = cur[7] > prev[7];
        const scorerIsMe = this.mirror ? !p1Scored : p1Scored;
        this.ui.flashGoal(scorerIsMe ? 'YOU SCORE!' : 'OPPONENT SCORES');
      }
      if (cur[9] && !prev[9]) this._endMatch();
    }
    const { me, opp } = this._selfOppScore();
    this.ui.updateScore(me, opp);
  }

  /** Interpolates the OPPONENT's paddle and the ball toward the latest
   * network targets every frame. The opponent paddle uses exponential
   * easing (slow-moving, variable speed). The ball uses dead reckoning:
   * it extrapolates using the velocity received from the host for smooth
   * continuous motion between 15 Hz snapshots, with wall-reflection
   * clamping to prevent overshoot and gentle correction toward the
   * authoritative host position. The guest's own paddle is handled
   * separately via client-side prediction (see the guest branch of
   * _step), not interpolated here. */
  _stepInterpolation(dt) {
    const tPaddle = 1 - Math.exp(-this._paddleInterpRate * dt);
    this.match.p1.x += (this._netTargetP1x - this.match.p1.x) * tPaddle;

    const b = this.match.ball;
    if (b.carriedBy) {
      // Ball held by a paddle: ease toward target position
      const tCarry = 1 - Math.exp(-30 * dt);
      b.x += (this._netTargetBallX - b.x) * tCarry;
      b.z += (this._netTargetBallZ - b.z) * tCarry;
    } else {
      // Ball in flight: dead reckoning via received velocity
      b.x += this._netTargetBallVx * dt;
      b.z += this._netTargetBallVz * dt;

      // Reflect off arena side walls to avoid overshoot
      const wallLimit = ARENA.wallX - BALL_RADIUS;
      if (b.x > wallLimit) { b.x = wallLimit; this._netTargetBallVx = -Math.abs(this._netTargetBallVx); }
      else if (b.x < -wallLimit) { b.x = -wallLimit; this._netTargetBallVx = Math.abs(this._netTargetBallVx); }

      // Gentle correction toward the authoritative host position
      const tc = 1 - Math.exp(-18 * dt);
      b.x += (this._netTargetBallX - b.x) * tc;
      b.z += (this._netTargetBallZ - b.z) * tc;
    }
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

function arraysEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) { if (a[i] !== b[i]) return false; }
  return true;
}

new App();
