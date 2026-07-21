let ctx = null;

function getCtx() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  return ctx;
}

function beep({ freq = 440, duration = 0.08, type = 'square', gain = 0.08, slide = 0 }) {
  try {
    const ac = getCtx();
    const osc = ac.createOscillator();
    const amp = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ac.currentTime);
    if (slide) osc.frequency.linearRampToValueAtTime(freq + slide, ac.currentTime + duration);
    amp.gain.setValueAtTime(gain, ac.currentTime);
    amp.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + duration);
    osc.connect(amp).connect(ac.destination);
    osc.start();
    osc.stop(ac.currentTime + duration + 0.02);
  } catch (e) {
    // Audio may be blocked before first user gesture; fail silently.
  }
}

export const SFX = {
  hit: () => beep({ freq: 220, duration: 0.07, type: 'square', slide: 160 }),
  shoot: () => beep({ freq: 340, duration: 0.09, type: 'sawtooth', slide: 240 }),
  wall: () => beep({ freq: 180, duration: 0.05, type: 'triangle' }),
  goal: () => {
    beep({ freq: 520, duration: 0.18, type: 'square', slide: 300, gain: 0.1 });
    setTimeout(() => beep({ freq: 700, duration: 0.22, type: 'square', slide: 400, gain: 0.1 }), 90);
  },
  countdown: () => beep({ freq: 440, duration: 0.06, type: 'sine' }),
  go: () => beep({ freq: 660, duration: 0.16, type: 'sine', slide: 200 }),
  win: () => {
    [523, 659, 784, 1046].forEach((f, i) =>
      setTimeout(() => beep({ freq: f, duration: 0.16, type: 'square', gain: 0.09 }), i * 110)
    );
  },
};
