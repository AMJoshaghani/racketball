// Lightweight keyboard state tracker.
// Replaces the old third-party KeyboardState.js dependency.

export class Keyboard {
  constructor() {
    this.keys = new Set();
    this.justPressed = new Set();
    this._onDown = (e) => {
      if (!e.repeat) this.justPressed.add(e.code);
      this.keys.add(e.code);
    };
    this._onUp = (e) => this.keys.delete(e.code);
    window.addEventListener('keydown', this._onDown);
    window.addEventListener('keyup', this._onUp);
  }

  isDown(code) {
    return this.keys.has(code);
  }

  /** True on any of the given key codes. */
  any(codes) {
    return codes.some((c) => this.keys.has(c));
  }

  /** One-shot: true only on the frame(s) since the key was pressed, then consumed. */
  consumeJustPressed(codes) {
    let hit = false;
    for (const c of codes) {
      if (this.justPressed.has(c)) {
        this.justPressed.delete(c);
        hit = true;
      }
    }
    return hit;
  }

  dispose() {
    window.removeEventListener('keydown', this._onDown);
    window.removeEventListener('keyup', this._onUp);
  }
}

// Shared control scheme so UI hints and input reading stay in sync.
export const CONTROLS = {
  p1: { left: ['KeyA'], right: ['KeyD'], shoot: ['Space'] },
  p2: { left: ['ArrowLeft'], right: ['ArrowRight'], shoot: ['Enter'] },
};

export function readAxis(keyboard, scheme) {
  let dir = 0;
  if (keyboard.any(scheme.left)) dir -= 1;
  if (keyboard.any(scheme.right)) dir += 1;
  return dir;
}
