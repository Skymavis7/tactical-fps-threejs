// Audio — every sound is synthesised with WebAudio. No audio files are
// shipped. The context is created lazily on the first user gesture (the
// Deploy click) so autoplay policies never block it.

let ctx = null;
let master = null;
let muted = false;

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext ?? window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);
  return ctx;
}

export function initAudio() {
  const c = ensure();
  if (c && c.state === 'suspended') c.resume().catch(() => {});
}

export function setMuted(m) { muted = m; if (master) master.gain.value = m ? 0 : 0.5; }

// A short filtered-noise burst (gunshots, explosions, impacts).
function noiseBurst({ dur, freq, q = 1, gain, type = 'lowpass', when = 0 }) {
  const c = ensure();
  if (!c || muted) return;
  const t = c.currentTime + when;
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource();
  src.buffer = buf;
  const filter = c.createBiquadFilter();
  filter.type = type; filter.frequency.value = freq; filter.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(filter).connect(g).connect(master);
  src.start(t);
  src.stop(t + dur);
}

// A short oscillator tone (beeps, chimes, clicks).
function tone({ freq, freqEnd = null, dur, gain, type = 'sine', when = 0 }) {
  const c = ensure();
  if (!c || muted) return;
  const t = c.currentTime + when;
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (freqEnd !== null) o.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

export const sfx = {
  // weapon, by class: pistol snaps, rifle cracks, DMR thumps
  shot(kind = 'rifle') {
    if (kind === 'pistol') { noiseBurst({ dur: 0.09, freq: 2400, gain: 0.5 }); tone({ freq: 190, freqEnd: 70, dur: 0.07, gain: 0.25, type: 'square' }); }
    else if (kind === 'smg') { noiseBurst({ dur: 0.07, freq: 3000, gain: 0.4 }); }
    else if (kind === 'dmr') { noiseBurst({ dur: 0.22, freq: 1400, gain: 0.7 }); tone({ freq: 120, freqEnd: 45, dur: 0.18, gain: 0.35, type: 'square' }); }
    else { noiseBurst({ dur: 0.12, freq: 2000, gain: 0.55 }); tone({ freq: 150, freqEnd: 60, dur: 0.09, gain: 0.3, type: 'square' }); }
  },
  dryFire() { tone({ freq: 1200, dur: 0.03, gain: 0.12, type: 'square' }); },
  reload() {
    tone({ freq: 500, dur: 0.04, gain: 0.15, type: 'square' });
    tone({ freq: 700, dur: 0.04, gain: 0.15, type: 'square', when: 0.18 });
    tone({ freq: 950, dur: 0.05, gain: 0.18, type: 'square', when: 0.42 });
  },
  hit() { tone({ freq: 2100, dur: 0.05, gain: 0.22 }); },
  kill() {
    tone({ freq: 660, dur: 0.09, gain: 0.25 });
    tone({ freq: 990, dur: 0.12, gain: 0.25, when: 0.08 });
  },
  hurt() { tone({ freq: 140, freqEnd: 70, dur: 0.18, gain: 0.3, type: 'sawtooth' }); },
  buy() {
    tone({ freq: 880, dur: 0.06, gain: 0.2 });
    tone({ freq: 1320, dur: 0.08, gain: 0.2, when: 0.06 });
  },
  denied() { tone({ freq: 220, dur: 0.12, gain: 0.2, type: 'square' }); },
  plantTick() { tone({ freq: 1250, dur: 0.05, gain: 0.18 }); },
  planted() {
    tone({ freq: 1250, dur: 0.08, gain: 0.22 });
    tone({ freq: 1250, dur: 0.08, gain: 0.22, when: 0.15 });
  },
  beep() { tone({ freq: 980, dur: 0.07, gain: 0.16 }); },
  explosion() {
    noiseBurst({ dur: 0.9, freq: 500, gain: 0.9 });
    noiseBurst({ dur: 0.5, freq: 180, gain: 0.7, when: 0.05 });
    tone({ freq: 90, freqEnd: 28, dur: 0.7, gain: 0.5, type: 'sine' });
  },
  roundStart() {
    tone({ freq: 523, dur: 0.1, gain: 0.2 });
    tone({ freq: 784, dur: 0.14, gain: 0.2, when: 0.1 });
  },
  roundWin() {
    [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, dur: 0.16, gain: 0.22, when: i * 0.11 }));
  },
  roundLose() {
    [392, 330, 262, 196].forEach((f, i) => tone({ freq: f, dur: 0.18, gain: 0.2, when: i * 0.12 }));
  },
  step() { noiseBurst({ dur: 0.04, freq: 500, gain: 0.05 }); },
  grenadeThrow() { noiseBurst({ dur: 0.12, freq: 900, gain: 0.15, type: 'bandpass', q: 2 }); },
  bounce() { tone({ freq: 300, freqEnd: 180, dur: 0.06, gain: 0.12 }); },
};
