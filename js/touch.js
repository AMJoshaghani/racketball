// Touch controls for phones/tablets. These don't talk to the game logic
// directly at all, they just add/remove the same key codes into the
// existing Keyboard instance's `keys` and `justPressed` sets that PC
// keyboard input already uses. Match.step(), readAxis(), and
// consumeJustPressed() never know or care whether a code came from a
// physical key or a thumb on glass.

function el(tag, className) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}

function bindHold(node, onStart, onEnd) {
  const start = (e) => { e.preventDefault(); node.classList.add('active'); onStart(); };
  const end = (e) => { e.preventDefault(); node.classList.remove('active'); onEnd(); };
  node.addEventListener('pointerdown', start);
  node.addEventListener('pointerup', end);
  node.addEventListener('pointercancel', end);
  node.addEventListener('pointerleave', end);
  // Stops the browser trying to treat a held button as a scroll/drag.
  node.style.touchAction = 'none';
}

export class TouchControls {
  constructor(keyboard) {
    this.keyboard = keyboard;
    this.root = el('div', 'touch-controls hidden');
    document.getElementById('ui-root').appendChild(this.root);
  }

  /**
   * pads: array of { scheme, side: 'left'|'right' }
   * scheme is one of CONTROLS.p1 / CONTROLS.p2 from input.js.
   */
  build(pads) {
    this.root.innerHTML = '';
    pads.forEach(({ scheme, side }) => this._buildPad(scheme, side));
  }

  _buildPad(scheme, side) {
    const wrap = el('div', `touch-pad touch-pad-${side}`);

    const move = el('div', 'touch-move');
    const leftBtn = el('div', 'touch-btn');
    leftBtn.textContent = '\u25C0';
    const rightBtn = el('div', 'touch-btn');
    rightBtn.textContent = '\u25B6';
    bindHold(leftBtn, () => this.keyboard.keys.add(scheme.left[0]), () => this.keyboard.keys.delete(scheme.left[0]));
    bindHold(rightBtn, () => this.keyboard.keys.add(scheme.right[0]), () => this.keyboard.keys.delete(scheme.right[0]));
    move.append(leftBtn, rightBtn);

    const shootBtn = el('div', 'touch-btn touch-shoot');
    shootBtn.textContent = 'SHOOT';
    bindHold(
      shootBtn,
      () => this.keyboard.justPressed.add(scheme.shoot[0]),
      () => {}
    );

    // Left-side pads mirror the button order so "outer" buttons stay
    // near the edge of the screen for both thumbs.
    if (side === 'left') wrap.append(shootBtn, move);
    else wrap.append(move, shootBtn);

    this.root.appendChild(wrap);
  }

  show() { this.root.classList.remove('hidden'); }
  hide() { this.root.classList.add('hidden'); }
}
