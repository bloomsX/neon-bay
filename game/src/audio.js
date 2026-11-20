// NEON BAY — synthesized sound. No audio files: every sound is built from
// oscillators and filtered noise at boot, so the game stays fully offline and
// the download stays small. Engine hum, police siren, gunshot, pickup chime,
// mission fanfare, crash thud, UI clicks — plus a procedural synthwave loop:
// a bassline and a sparse arp that start when you drive, because a sunset city
// without music is only half a game. Everything runs through one master gain
// (M mutes it) and nothing allocates inside the per-frame update.
export function createAudio() {
  let ctx = null;
  let master = null;
  let musicGain = null;
  let engineOsc = null;
  let engineGain = null;
  let sirenOsc = null;
  let sirenGain = null;
  let muted = false;
  let started = false;
  // Music sequencer state (16th-note grid at 112 BPM, A minor).
  let musicTimer = null;
  let musicStep = 0;
  const BASS = [55, 0, 55, 0, 65.41, 0, 55, 0, 49, 0, 49, 0, 58.27, 0, 65.41, 0];
  const ARP = [220, 261.63, 329.63, 440, 329.63, 261.63, 220, 261.63, 196, 246.94, 293.66, 392, 293.66, 246.94, 196, 220];

  function ensure() {
    if (ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.5;
      master.connect(ctx.destination);
      musicGain = ctx.createGain();
      musicGain.gain.value = 0.14;
      musicGain.connect(master);
      // Engine: sawtooth through a low-pass, pitch follows speed.
      engineOsc = ctx.createOscillator();
      engineOsc.type = 'sawtooth';
      engineOsc.frequency.value = 55;
      const engineFilter = ctx.createBiquadFilter();
      engineFilter.type = 'lowpass';
      engineFilter.frequency.value = 420;
      engineGain = ctx.createGain();
      engineGain.gain.value = 0;
      engineOsc.connect(engineFilter);
      engineFilter.connect(engineGain);
      engineGain.connect(master);
      engineOsc.start();
      // Siren: triangle that wails between two tones.
      sirenOsc = ctx.createOscillator();
      sirenOsc.type = 'triangle';
      sirenOsc.frequency.value = 750;
      sirenGain = ctx.createGain();
      sirenGain.gain.value = 0;
      sirenOsc.connect(sirenGain);
      sirenGain.connect(master);
      sirenOsc.start();
      started = true;
      return true;
    } catch {
      return false;
    }
  }

  function noiseBurst(duration, filterFreq, gainValue, type = 'lowpass') {
    if (!ctx) return;
    const len = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    const gain = ctx.createGain();
    gain.gain.value = gainValue;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    src.start();
  }

  function tone(freq, duration, type = 'sine', gainValue = 0.25, when = 0, dest = null) {
    if (!ctx) return;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const gain = ctx.createGain();
    const t0 = ctx.currentTime + when;
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(gainValue, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
    osc.connect(gain);
    gain.connect(dest || master);
    osc.start(t0);
    osc.stop(t0 + duration + 0.05);
  }

  function startMusic() {
    if (musicTimer || !ctx) return;
    const stepMs = (60 / 112 / 4) * 1000;
    musicTimer = setInterval(() => {
      if (muted) return;
      const bass = BASS[musicStep % BASS.length];
      if (bass > 0) tone(bass, 0.22, 'triangle', 0.5, 0, musicGain);
      // Arp plays every other bar, quiet, so it never fights the siren.
      if (musicStep % 32 >= 16) {
        const arp = ARP[musicStep % ARP.length];
        tone(arp, 0.12, 'sine', 0.1, 0, musicGain);
      }
      musicStep += 1;
    }, stepMs);
  }

  return {
    /** Call from a user gesture (the Start button) — browsers block audio before one. */
    unlock() {
      if (ensure() && ctx.state === 'suspended') ctx.resume();
      startMusic();
    },
    setMuted(value) {
      muted = value;
      if (master) master.gain.value = muted ? 0 : 0.5;
    },
    isMuted() {
      return muted;
    },
    /** Continuous layers, called every frame: engine by speed, siren by wanted stars. */
    update(speed, inCar, wantedStars, dt) {
      if (!ctx || !started) return;
      const now = ctx.currentTime;
      const targetEngine = inCar ? 0.05 + Math.min(0.16, Math.abs(speed) * 0.004) : 0;
      engineGain.gain.setTargetAtTime(targetEngine, now, 0.08);
      engineOsc.frequency.setTargetAtTime(55 + Math.abs(speed) * 3.2, now, 0.08);
      const sirenTarget = wantedStars > 0 ? 0.05 : 0;
      sirenGain.gain.setTargetAtTime(sirenTarget, now, 0.2);
      if (wantedStars > 0) {
        sirenOsc.frequency.setTargetAtTime(660 + Math.sin(now * 2.4) * 140, now, 0.05);
      }
    },
    gunshot() {
      noiseBurst(0.12, 1800, 0.5);
    },
    crash() {
      noiseBurst(0.25, 300, 0.6);
    },
    skid() {
      noiseBurst(0.18, 2400, 0.12, 'highpass');
    },
    explosion() {
      noiseBurst(0.7, 160, 0.9);
      tone(55, 0.5, 'sine', 0.5);
    },
    pickup() {
      tone(880, 0.12, 'sine', 0.22);
      tone(1320, 0.18, 'sine', 0.2, 0.07);
    },
    fare() {
      tone(1047, 0.1, 'triangle', 0.2);
      tone(1319, 0.16, 'triangle', 0.2, 0.08);
    },
    mission() {
      [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, 'triangle', 0.22, i * 0.09));
    },
    busted() {
      [392, 330, 262].forEach((f, i) => tone(f, 0.3, 'sawtooth', 0.18, i * 0.14));
    },
    click() {
      tone(660, 0.06, 'square', 0.12);
    },
  };
}
