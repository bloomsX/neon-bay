// NEON BAY — audio.js
// Procedural WebAudio sound: no audio files, no network. Engine hum that
// follows speed, a two-tone NBPD siren, a tiny radio melody per station,
// and short UI blips. Everything is built from oscillators and noise, and
// the whole module stays silent until the player starts the game (browsers
// require a gesture before audio may begin).

(function () {
  'use strict';

  var ctx = null;
  var master = null;
  var engineOsc = null, engineOsc2 = null, engineGain = null;
  var sirenOsc = null, sirenGain = null, sirenLfo = null;
  var radioTimer = null, radioStep = 0;
  var muted = false;
  var started = false;

  function ensure() {
    if (ctx) return true;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      return true;
    } catch (e) {
      return false;
    }
  }

  function start() {
    if (!ensure()) return;
    if (ctx.state === 'suspended') ctx.resume();
    if (started) return;
    started = true;
    // Engine: two detuned saws through a lowpass, gain by speed.
    engineOsc = ctx.createOscillator();
    engineOsc.type = 'sawtooth';
    engineOsc.frequency.value = 55;
    engineOsc2 = ctx.createOscillator();
    engineOsc2.type = 'square';
    engineOsc2.frequency.value = 28;
    var filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    engineGain = ctx.createGain();
    engineGain.gain.value = 0;
    engineOsc.connect(filter);
    engineOsc2.connect(filter);
    filter.connect(engineGain);
    engineGain.connect(master);
    engineOsc.start();
    engineOsc2.start();
    // Siren: a sine that alternates between two tones via an LFO.
    sirenOsc = ctx.createOscillator();
    sirenOsc.type = 'sine';
    sirenOsc.frequency.value = 660;
    sirenGain = ctx.createGain();
    sirenGain.gain.value = 0;
    sirenLfo = ctx.createOscillator();
    sirenLfo.type = 'square';
    sirenLfo.frequency.value = 1.4;
    var lfoGain = ctx.createGain();
    lfoGain.gain.value = 110;
    sirenLfo.connect(lfoGain);
    lfoGain.connect(sirenOsc.frequency);
    sirenOsc.connect(sirenGain);
    sirenGain.connect(master);
    sirenOsc.start();
    sirenLfo.start();
    startRadio();
  }

  function setEngine(speedNorm, inCar) {
    if (!ctx || !engineGain) return;
    var t = ctx.currentTime;
    engineGain.gain.setTargetAtTime(inCar ? 0.05 + speedNorm * 0.09 : 0.0, t, 0.1);
    engineOsc.frequency.setTargetAtTime(50 + speedNorm * 140, t, 0.1);
    engineOsc2.frequency.setTargetAtTime(25 + speedNorm * 70, t, 0.1);
  }

  function setSiren(stars) {
    if (!ctx || !sirenGain) return;
    sirenGain.gain.setTargetAtTime(stars > 0 ? 0.045 + stars * 0.008 : 0, ctx.currentTime, 0.2);
  }

  function sirenBurst() {
    if (!ctx || !sirenGain) return;
    sirenGain.gain.setTargetAtTime(0.12, ctx.currentTime, 0.05);
    setTimeout(function () {
      if (sirenGain) sirenGain.gain.setTargetAtTime(0.05, ctx.currentTime, 0.3);
    }, 500);
  }

  function blip(freq, dur, type, vol) {
    if (!ensure()) return;
    if (ctx.state === 'suspended') ctx.resume();
    var o = ctx.createOscillator();
    o.type = type || 'sine';
    o.frequency.value = freq;
    var g = ctx.createGain();
    g.gain.setValueAtTime(vol || 0.12, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (dur || 0.12));
    o.connect(g);
    g.connect(master);
    o.start();
    o.stop(ctx.currentTime + (dur || 0.12) + 0.02);
  }

  function uiBlip(freq) { blip(freq || 660, 0.09, 'sine', 0.12); }

  function missionDone() {
    if (!ensure()) return;
    [523, 659, 784, 1046].forEach(function (f, i) {
      setTimeout(function () { blip(f, 0.22, 'triangle', 0.16); }, i * 110);
    });
  }

  function gunshot() {
    if (!ensure()) return;
    var dur = 0.12;
    var buffer = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
    var data = buffer.getChannelData(0);
    for (var i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    var src = ctx.createBufferSource();
    src.buffer = buffer;
    var g = ctx.createGain();
    g.gain.value = 0.25;
    var f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1800;
    src.connect(f); f.connect(g); g.connect(master);
    src.start();
  }

  function crash() {
    if (!ensure()) return;
    blip(90, 0.25, 'sawtooth', 0.2);
    blip(60, 0.3, 'square', 0.12);
  }

  // Radio: a looping 8-step bass + lead pattern per station, from the
  // station's root note and tempo. Pure oscillators, nothing sampled.
  var SCALES = {
    220: [0, 3, 5, 7, 10, 12, 15, 12],
    196: [0, 2, 3, 5, 7, 10, 12, 10],
    174: [0, 3, 5, 8, 10, 12, 15, 12],
    146: [0, 0, 7, 0, 10, 0, 12, 7],
  };

  function startRadio() {
    if (radioTimer) return;
    radioTimer = setInterval(function () {
      if (muted || !ctx || ctx.state !== 'running') return;
      var state = window.NB.state;
      if (!state || state.mode !== 'playing') return;
      var station = window.NB.CFG.RADIO[state.radio];
      var scale = SCALES[station.root] || SCALES[220];
      var stepDur = 60 / station.tempo / 2;
      void stepDur;
      var note = scale[radioStep % scale.length];
      var freq = station.root * Math.pow(2, note / 12);
      blip(freq, 0.22, 'triangle', 0.05);
      if (radioStep % 2 === 0) blip(freq / 2, 0.3, 'sine', 0.07);
      radioStep++;
    }, 240);
  }

  function setMuted(m) {
    muted = m;
    if (master) master.gain.value = m ? 0 : 0.5;
  }

  window.NB = window.NB || {};
  window.NB.Audio = {
    start: start,
    ensure: ensure,
    setEngine: setEngine,
    setSiren: setSiren,
    sirenBurst: sirenBurst,
    uiBlip: uiBlip,
    missionDone: missionDone,
    gunshot: gunshot,
    crash: crash,
    setMuted: setMuted,
  };
})();
