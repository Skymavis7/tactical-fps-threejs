// All sound is synthesised with WebAudio: no audio files, no network, nothing to license.
// A shared noise buffer feeds the percussive sounds; tones are plain oscillators. Every
// call is guarded, so the game also runs where audio is unavailable (headless captures).
export function createAudio() {
  let ctx = null;
  let noise = null;
  let muted = false;
  let master = null;

  function ensure() {
    if (ctx) return ctx;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      const length = ctx.sampleRate * 0.5;
      noise = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    } catch {
      ctx = null;
    }
    return ctx;
  }

  function burst({ duration, filterFreq, filterQ = 1, gain = 0.5, type = 'bandpass', at = 0 }) {
    if (muted || !ensure()) return;
    const t = ctx.currentTime + at;
    const source = ctx.createBufferSource();
    source.buffer = noise;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    filter.Q.value = filterQ;
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(gain, t);
    amp.gain.exponentialRampToValueAtTime(0.001, t + duration);
    source.connect(filter).connect(amp).connect(master);
    source.start(t, Math.random() * 0.3);
    source.stop(t + duration + 0.02);
  }

  function tone({ freq, freqEnd = 0, duration, gain = 0.2, type = 'sine', at = 0 }) {
    if (muted || !ensure()) return;
    const t = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t + duration);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(gain, t);
    amp.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(amp).connect(master);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  const SHOTS = {
    pistol: { duration: 0.09, filterFreq: 1800, gain: 0.5 },
    smg: { duration: 0.07, filterFreq: 2200, gain: 0.42 },
    rifle: { duration: 0.12, filterFreq: 1400, gain: 0.6 },
    dmr: { duration: 0.22, filterFreq: 900, gain: 0.7 },
  };

  return {
    unlock() {
      ensure();
      if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    },
    setMuted(value) {
      muted = value;
    },
    isMuted() {
      return muted;
    },
    shot(id) {
      const spec = SHOTS[id] || SHOTS.rifle;
      burst(spec);
      tone({ freq: 160, freqEnd: 55, duration: 0.1, gain: 0.35, type: 'triangle' });
    },
    distantShot() {
      burst({ duration: 0.14, filterFreq: 700, gain: 0.14 });
    },
    dry() {
      tone({ freq: 900, duration: 0.03, gain: 0.12, type: 'square' });
    },
    reload() {
      tone({ freq: 500, duration: 0.04, gain: 0.14, type: 'square' });
      tone({ freq: 700, duration: 0.04, gain: 0.14, type: 'square', at: 0.28 });
      tone({ freq: 420, duration: 0.05, gain: 0.16, type: 'square', at: 0.55 });
    },
    hit(kill) {
      tone({ freq: kill ? 1560 : 1180, duration: 0.06, gain: 0.16, type: 'sine' });
      if (kill) tone({ freq: 1960, duration: 0.09, gain: 0.16, type: 'sine', at: 0.07 });
    },
    hurt() {
      tone({ freq: 220, freqEnd: 140, duration: 0.12, gain: 0.2, type: 'sawtooth' });
    },
    step() {
      burst({ duration: 0.05, filterFreq: 300, gain: 0.05, type: 'lowpass' });
    },
    throwPin() {
      tone({ freq: 1400, duration: 0.03, gain: 0.1, type: 'square' });
    },
    bounce() {
      tone({ freq: 320, duration: 0.05, gain: 0.1, type: 'triangle' });
    },
    plantBeep(final) {
      tone({ freq: final ? 1900 : 1250, duration: final ? 0.3 : 0.07, gain: 0.16, type: 'sine' });
    },
    explosion() {
      burst({ duration: 1.1, filterFreq: 240, gain: 0.9, type: 'lowpass' });
      tone({ freq: 70, freqEnd: 28, duration: 0.9, gain: 0.7, type: 'sine' });
    },
    roundWin(win) {
      const notes = win ? [523, 659, 784] : [392, 330];
      notes.forEach((freq, i) => tone({ freq, duration: 0.22, gain: 0.16, type: 'triangle', at: i * 0.14 }));
    },
    click() {
      tone({ freq: 800, duration: 0.04, gain: 0.12, type: 'square' });
    },
    buy() {
      tone({ freq: 880, duration: 0.06, gain: 0.14, type: 'sine' });
      tone({ freq: 1320, duration: 0.09, gain: 0.14, type: 'sine', at: 0.06 });
    },
  };
}
