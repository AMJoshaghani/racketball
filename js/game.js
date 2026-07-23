import { ARENA } from './scene.js';
import { PADDLE_SIZE, BALL_RADIUS } from './entities.js';

export const BASE_SHOT_SPEED = 780;   // up from the original 620, less time to react
export const SHOT_SPEED_RAMP = 65;    // added to shot speed on every successful catch this rally
export const MAX_SHOT_SPEED = 1600;   // cap so long rallies don't go absurd
export const AIM_FACTOR = 1.35;
export const MAX_AIM_VX = 480;
export const WIN_SCORE = 7;
export const GOAL_MARGIN = 40;

/**
 * Pure simulation of one match: two paddles + one ball.
 * Rendering code reads `paddleP1/paddleP2/ball` state each frame and
 * mirrors it onto Three.js meshes. Kept free of any THREE.* references
 * so it's trivial to reason about, test, or run headless (e.g. as the
 * authoritative host in an online match).
 */
export class Match {
  constructor() {
    this.p1 = { x: 0, vx: 0, z: ARENA.baselineZ };
    this.p2 = { x: 0, vx: 0, z: -ARENA.baselineZ };
    this.ball = { x: 0, z: 0, vx: 0, vz: 0, carriedBy: 'p1' };
    this.score = { p1: 0, p2: 0 };
    this.rallySpeed = BASE_SHOT_SPEED;
    this.over = false;
    this.winner = null;
  }

  _stepPaddle(p, dir, dt) {
    const speed = 620;
    const accel = 4200;
    const desired = dir * speed;
    const diff = desired - p.vx;
    const maxDelta = accel * dt;
    p.vx += Math.max(-maxDelta, Math.min(maxDelta, diff));
    p.x += p.vx * dt;
    const limit = ARENA.halfWidth - PADDLE_SIZE.w / 2;
    p.x = Math.max(-limit, Math.min(limit, p.x));
  }

  _serve(toWhom) {
    this.ball.carriedBy = toWhom;
    this.ball.vx = 0;
    this.ball.vz = 0;
    this.ball.x = toWhom === 'p1' ? this.p1.x : this.p2.x;
    this.rallySpeed = BASE_SHOT_SPEED;
  }

  /**
   * Advance the match by dt seconds given both players' inputs.
   * inputs: { dir: -1|0|1, shoot: boolean }
   * Returns an array of event strings for the caller to react to
   * (sound effects, screen shake, HUD updates, etc).
   */
  step(dt, p1Input, p2Input) {
    const events = [];
    if (this.over) return events;

    this._stepPaddle(this.p1, p1Input.dir || 0, dt);
    this._stepPaddle(this.p2, p2Input.dir || 0, dt);

    const b = this.ball;

    if (b.carriedBy) {
      const carrier = b.carriedBy === 'p1' ? this.p1 : this.p2;
      const wantsShoot = b.carriedBy === 'p1' ? p1Input.shoot : p2Input.shoot;
      b.x = carrier.x;
      b.z = b.carriedBy === 'p1'
        ? carrier.z - (PADDLE_SIZE.d / 2 + BALL_RADIUS + 6)
        : carrier.z + (PADDLE_SIZE.d / 2 + BALL_RADIUS + 6);

      if (wantsShoot) {
        const dirSign = b.carriedBy === 'p1' ? -1 : 1;
        b.vz = this.rallySpeed * dirSign;
        b.vx = Math.max(-MAX_AIM_VX, Math.min(MAX_AIM_VX, carrier.vx * AIM_FACTOR));
        b.carriedBy = null;
        events.push('shoot');
      }
    } else {
      // Swept check: remember where the ball started this frame so a fast
      // ball can't tunnel straight through the paddle's catch band without
      // ever being sampled inside it in a single point-in-time check.
      const prevZ = b.z;
      b.x += b.vx * dt;
      b.z += b.vz * dt;

      const wallLimit = ARENA.wallX - BALL_RADIUS;
      if (b.x > wallLimit) { b.x = wallLimit; b.vx *= -1; events.push('wall'); }
      if (b.x < -wallLimit) { b.x = -wallLimit; b.vx *= -1; events.push('wall'); }

      // Catch check against whichever paddle the ball is approaching.
      const approaching = b.vz < 0 ? this.p2 : this.p1;
      const approachingId = b.vz < 0 ? 'p2' : 'p1';
      const bandHalf = PADDLE_SIZE.d / 2 + BALL_RADIUS;
      const bandMin = approaching.z - bandHalf;
      const bandMax = approaching.z + bandHalf;
      const segMin = Math.min(prevZ, b.z);
      const segMax = Math.max(prevZ, b.z);
      const crossesBand = segMax >= bandMin && segMin <= bandMax;
      const withinX = Math.abs(b.x - approaching.x) <= PADDLE_SIZE.w / 2 + BALL_RADIUS * 0.15;

      if (crossesBand && withinX) {
        b.carriedBy = approachingId;
        b.vx = 0;
        b.vz = 0;
        this.rallySpeed = Math.min(MAX_SHOT_SPEED, this.rallySpeed + SHOT_SPEED_RAMP);
        events.push('hit:' + approachingId);
      } else if (b.z <= -ARENA.baselineZ - GOAL_MARGIN) {
        this.score.p1 += 1;
        events.push('goal:p1');
        this._serve('p2');
        if (this.score.p1 >= WIN_SCORE) { this.over = true; this.winner = 'p1'; events.push('win:p1'); }
      } else if (b.z >= ARENA.baselineZ + GOAL_MARGIN) {
        this.score.p2 += 1;
        events.push('goal:p2');
        this._serve('p1');
        if (this.score.p2 >= WIN_SCORE) { this.over = true; this.winner = 'p2'; events.push('win:p2'); }
      }
    }

    return events;
  }

  /**
   * Snapshot for network sync (host -> guest), kept as a compact array
   * instead of a nested object so repeated key names don't get sent on
   * every message - this runs many times a second, so payload size adds
   * up fast over a metered TURN relay.
   * [p1x, p2x, ballx, ballz, carriedByCode, scoreP1, scoreP2, overFlag, winnerCode]
   */
  serialize() {
    return [
      Math.round(this.p1.x),
      Math.round(this.p2.x),
      Math.round(this.ball.x),
      Math.round(this.ball.z),
      encodeSide(this.ball.carriedBy),
      this.score.p1,
      this.score.p2,
      this.over ? 1 : 0,
      encodeSide(this.winner),
    ];
  }

  applySnapshot(s) {
    this.p1.x = s[0]; this.p2.x = s[1];
    this.ball.x = s[2]; this.ball.z = s[3]; this.ball.carriedBy = decodeSide(s[4]);
    this.score = { p1: s[5], p2: s[6] };
    this.over = !!s[7]; this.winner = decodeSide(s[8]);
  }
}

export function encodeSide(side) {
  return side === 'p1' ? 1 : side === 'p2' ? 2 : 0;
}
export function decodeSide(code) {
  return code === 1 ? 'p1' : code === 2 ? 'p2' : null;
}
