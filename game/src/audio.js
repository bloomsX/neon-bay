// NEON BAY — fully procedural sound. No audio files: a 112 BPM synthwave
// loop (bass, arpeggio, pad, hats) scheduled with a lookahead timer, plus
// one-shot effects for clicks, shots, crashes, pickups and story beats.
// Everything runs through one master gain so M can mute it instantly.
export function createAudio() {
  let ctx = null;
  let master = null;
  let musicGain = null;
  let noiseBuf = null;
  let muted = false;
  let musicOn = false;
  let scheduler = null;
  let nextBeatAt = 0;
  let beat = 0;
  let engineOsc = null;
  let engineGain = null;
  let engineFilter = null;

  const BPM = 112;
  const BEAT = 60 / BPM;
  // Am — F — C — G, one bar each. Frequencies in Hz.
  const CHORDS = [
    { root: 55.0, tones: [220.0, 261.63, 329.63] }, // Am
    { root: 43.65, tones: [174.61, 220.0, 261.63] }, // F
    { root: 65.41, tones: [196.0, 261.63, 329.63] }, // C
    { root: 49.0, tones: [196.0, 246.94, 293.66] }, // G
  ];

  function ensure() {
    if (ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.5;
      master.connect(ctx.destination);
      musicGain = ctx.createGain();
      musicGain.gain.value = 0.34;
      musicGain.connect(master);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      // Engine hum: a saw through a lowpass, driven by speed.
      engineOsc = ctx.createOscillator();
      engineOsc.type = 'sawtooth';
      engineOsc.frequency.value = 42;
      engineFilter = ctx.createBiquadFilter();
      engineFilter.type = 'lowpass';
      engineFilter.frequency.value = 320;
      engineGain = ctx.createGain();
      engineGain.gain.value = 0;
      engineOsc.connect(engineFilter);
      engineFilter.connect(engineGain);
      engineGain.connect(master);
      engineOsc.start();
      return true;
    } catch (err) {
      return false;
    }
  }

  function env(gainNode, t, peak, decay) {
    gainNode.gain.setValueAtTime(0.0001, t);
    gainNode.gain.exponentialRampToValueAtTime(peak, t + 0.012);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  }

  function tone(freq, t, dur, type, peak, dest) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    env(g, t, peak, dur);
    o.connect(g);
    g.connect(dest || master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  function noise(t, dur, peak, filterFreq, type = 'lowpass') {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = filterFreq;
    const g = ctx.createGain();
    env(g, t, peak, dur);
    src.connect(f);
    f.connect(g);
    g.connect(master);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  function scheduleBar(barIndex, t0) {
    const chord = CHORDS[barIndex % CHORDS.length];
    // Bass: root on every 8th, alternating root and octave.
    for (let e = 0; e < 8; e++) {
      const f = e % 2 === 0 ? chord.root : chord.root * 2;
      tone(f, t0 + (e * BEAT) / 2, BEAT * 0.45, 'triangle', 0.5, musicGain);
    }
    // Arpeggio: 16ths cycling the chord tones across two octaves.
    for (let s = 0; s < 16; s++) {
      const toneIdx = s % 3;
      const oct = s % 6 < 3 ? 1 : 2;
      tone(chord.tones[toneIdx] * oct, t0 + (s * BEAT) / 4, BEAT * 0.22, 'square', 0.07, musicGain);
    }
    // Pad: two detuned saws for the whole bar.
    for (const det of [-6, 6]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = chord.tones[0] / 2;
      o.detune.value = det;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 900;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(0.05, t0 + 0.4);
      g.gain.setValueAtTime(0.05, t0 + BEAT * 4 - 0.4);
      g.gain.linearRampToValueAtTime(0.0001, t0 + BEAT * 4);
      o.connect(f);
      f.connect(g);
      g.connect(musicGain);
      o.start(t0);
      o.stop(t0 + BEAT * 4 + 0.05);
    }
    // Hats on the offbeat 8ths.
    for (let e = 0; e < 8; e++) {
      if (e % 2 === 1) noise(t0 + (e * BEAT) / 2, 0.05, 0.05, 7000, 'highpass');
    }
  }

  function tick() {
    if (!ctx || !musicOn) return;
    while (nextBeatAt < ctx.currentTime + 0.18) {
      scheduleBar(beat, nextBeatAt);
      nextBeatAt += BEAT * 4;
      beat++;
    }
  }

  return {
    resume() {
      if (!ensure()) return;
      if (ctx.state === 'suspended') ctx.resume();
    },
    setMuted(m) {
      muted = m;
      if (master) master.gain.value = m ? 0 : 0.5;
    },
    get muted() { return muted; },
    startMusic() {
      if (!ensure() || musicOn) return;
      musicOn = true;
      nextBeatAt = ctx.currentTime + 0.1;
      beat = 0;
      scheduler = setInterval(tick, 40);
    },
    stopMusic() {
      musicOn = false;
      if (scheduler) { clearInterval(scheduler); scheduler = null; }
    },
    setEngine(on, speed) {
      if (!ctx || !engineGain) return;
      const t = ctx.currentTime;
      engineGain.gain.setTargetAtTime(on ? 0.05 + Math.min(0.05, speed * 0.0012) : 0, t, 0.1);
      engineOsc.frequency.setTargetAtTime(42 + speed * 2.2, t, 0.08);
      engineFilter.frequency.setTargetAtTime(280 + speed * 22, t, 0.1);
    },
    click() {
      if (!ensure()) return;
      tone(880, ctx.currentTime, 0.07, 'sine', 0.25);
    },
    shot() {
      if (!ensure()) return;
      const t = ctx.currentTime;
      noise(t, 0.14, 0.5, 2400);
      tone(220, t, 0.1, 'square', 0.22);
    },
    crash(speed) {
      if (!ensure()) return;
      noise(ctx.currentTime, 0.3, Math.min(0.5, 0.15 + speed * 0.01), 500);
    },
    pickup(kind) {
      if (!ensure()) return;
      const t = ctx.currentTime;
      if (kind === 'cash') {
        tone(987.77, t, 0.09, 'sine', 0.3);
        tone(1318.5, t + 0.08, 0.14, 'sine', 0.3);
      } else {
        tone(523.25, t, 0.1, 'sine', 0.3);
        tone(783.99, t + 0.09, 0.16, 'sine', 0.3);
      }
    },
    mission() {
      if (!ensure()) return;
      const t = ctx.currentTime;
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, t + i * 0.09, 0.22, 'triangle', 0.28));
    },
    steal() {
      if (!ensure()) return;
      const t = ctx.currentTime;
      tone(196, t, 0.12, 'sawtooth', 0.2);
      tone(147, t + 0.1, 0.18, 'sawtooth', 0.2);
    },
    busted() {
      if (!ensure()) return;
      const t = ctx.currentTime;
      [392, 311, 233].forEach((f, i) => tone(f, t + i * 0.16, 0.3, 'triangle', 0.3));
    },
    wasted() {
      if (!ensure()) return;
      const t = ctx.currentTime;
      tone(110, t, 0.7, 'sine', 0.4);
      noise(t, 0.5, 0.3, 300);
    },
    fare() {
      if (!ensure()) return;
      const t = ctx.currentTime;
      tone(1046.5, t, 0.1, 'sine', 0.28);
      tone(1568, t + 0.09, 0.18, 'sine', 0.28);
    },
  };
}
