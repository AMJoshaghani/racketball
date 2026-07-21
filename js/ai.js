import { ARENA } from './scene.js';
import { BALL_RADIUS } from './entities.js';

// Difficulty tuning. `predict` blends in a wall-bounce-aware intercept
// forecast (0 = ignore it and just chase the ball's current x, 1 = fully
// trust the forecast). `error` is random aim/positioning noise in units.
const DIFFICULTY = {
  easy:   { speedMul: 0.55, error: 130, reaction: 0.35, predict: 0.0, shotDelayMin: 0.5,  shotDelayMax: 0.9 },
  normal: { speedMul: 0.80, error: 60,  reaction: 0.16, predict: 0.6, shotDelayMin: 0.3,  shotDelayMax: 0.55 },
  hard:   { speedMul: 1.05, error: 20,  reaction: 0.06, predict: 1.0, shotDelayMin: 0.12, shotDelayMax: 0.3 },
};

const WALL_LIMIT = ARENA.wallX - BALL_RADIUS;

/** Reflects a straight-line (no-bounce) x projection off the side walls. */
function foldReflect(x, limit) {
  let v = x;
  let guard = 0;
  while ((v > limit || v < -limit) && guard < 8) {
    if (v > limit) v = 2 * limit - v;
    else if (v < -limit) v = -2 * limit - v;
    guard += 1;
  }
  return v;
}

/** Predicts where the ball will cross the AI paddle's z-line, including bounces. */
function predictInterceptX(ball, aiZ) {
  if (ball.vz === 0) return ball.x;
  const t = (aiZ - ball.z) / ball.vz;
  if (!isFinite(t) || t < 0) return ball.x;
  const raw = ball.x + ball.vx * t;
  return foldReflect(raw, WALL_LIMIT);
}

export class AIController {
  constructor(difficulty = 'normal') {
    this.difficulty = difficulty;
    this.cfg = DIFFICULTY[difficulty] || DIFFICULTY.normal;
    this.targetOffset = (Math.random() * 2 - 1) * this.cfg.error;
    this._retarget = 0;
    this.holdShoot = 0;
    this.shotDelay = this._rollShotDelay();
  }

  _rollShotDelay() {
    const { shotDelayMin, shotDelayMax } = this.cfg;
    return shotDelayMin + Math.random() * (shotDelayMax - shotDelayMin);
  }

  /**
   * ball: { x, z, vx, vz, carriedBy } where carriedBy is 'ai' when the
   * AI currently holds the ball. self: the AI's own paddle ({ x, z }).
   */
  decide(dt, { ball, self }) {
    this._retarget -= dt;
    if (this._retarget <= 0) {
      this.targetOffset = (Math.random() * 2 - 1) * this.cfg.error;
      this._retarget = this.cfg.reaction + Math.random() * 0.15;
    }

    let dir = 0;
    let shoot = false;

    const ownsBall = ball.carriedBy === 'ai';
    // self.z is negative (AI's baseline). A ball flying toward the AI has vz < 0.
    const headingToAI = ball.carriedBy === null && ball.vz < 0;

    if (ownsBall || headingToAI) {
      const predicted = predictInterceptX(ball, self.z);
      const chaseTarget = this.cfg.predict > 0
        ? ball.x + (predicted - ball.x) * this.cfg.predict
        : ball.x;
      const target = chaseTarget + this.targetOffset;
      const delta = target - self.x;
      if (Math.abs(delta) > 6) dir = Math.sign(delta);

      if (ownsBall) {
        this.holdShoot += dt;
        if (this.holdShoot > this.shotDelay) {
          shoot = true;
          this.holdShoot = 0;
          this.shotDelay = this._rollShotDelay();
        }
      }
    } else {
      // Ball heading away. Drift back toward center to get ready.
      const delta = 0 - self.x;
      if (Math.abs(delta) > 40) dir = Math.sign(delta) * 0.35;
    }

    dir *= this.cfg.speedMul;
    return { dir, shoot };
  }
}
