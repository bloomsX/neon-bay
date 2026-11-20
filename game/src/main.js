// NEON BAY — bootstrap and the frame loop. Owns the game state (title,
// playing, paused), the fixed-step simulation, the camera auto-align while
// driving, the save cadence, and the headless hooks the capture tools use:
// window.__shotReady (set once a staged shot has settled), window.__fps,
// window.__errors, and window.__game / window.__debug.
import * as THREE from '../vendor/three.module.min.js';
import { CFG } from './config.js';
import { createWorld, stepWorld, serializeWorld, deserializeWorld, saveSummary } from './world.js';
import { createRenderer } from './render.js';
import { createHud } from './hud.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';
import { stageShot } from './shots.js';

const params = new URLSearchParams(location.search);
const seedParam = parseInt(params.get('seed') || '', 10);
const seed = Number.isFinite(seedParam) ? seedParam : CFG.seed;
const shotName = params.get('shot');
const debug = params.get('debug') === '1';

const world = createWorld(seed);
const canvas = document.getElementById('game');
const render = createRenderer(canvas, world);
const audio = createAudio();
const input = createInput(canvas);

let state = 'title';
let staged = null;
let shotFrames = 0;
let shotStartAt = 0;
let lastSaveAt = 0;
let lastT = performance.now();
let acc = 0;
let fps = 60;
let fpsFrames = 0;
let fpsAt = performance.now();
const exploded = new Set();

window.__errors = [];
window.addEventListener('error', (e) => window.__errors.push(String(e.message || e.error)));
window.addEventListener('unhandledrejection', (e) => window.__errors.push(String(e.reason)));

const hud = createHud({
  hideFps: !!shotName,
  onStart: (useSave) => startGame(useSave),
  onResume: () => { audio.click(); setPaused(false); },
  onMenu: () => { audio.click(); toTitle(); },
});

function readSave() {
  try {
    const raw = localStorage.getItem(CFG.saveKey);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

function writeSave() {
  try {
    localStorage.setItem(CFG.saveKey, JSON.stringify(serializeWorld(world)));
    lastSaveAt = world.time;
  } catch (err) { /* storage full or blocked: the game keeps running */ }
}

function toTitle() {
  state = 'title';
  staged = null;
  hud.showTitle(saveSummary(readSave()));
  hud.hideHud();
  hud.hidePause();
  audio.setEngine(false, 0);
}

function startGame(useSave) {
  audio.resume();
  audio.click();
  audio.startMusic();
  if (useSave) {
    const data = readSave();
    if (data) deserializeWorld(world, data);
  }
  hud.hideTitle();
  hud.showHud();
  state = 'playing';
  lastT = performance.now();
  acc = 0;
}

function setPaused(on) {
  if (on && state === 'playing') {
    state = 'paused';
    hud.showPause();
    writeSave();
    audio.setEngine(false, 0);
  } else if (!on && state === 'paused') {
    state = 'playing';
    hud.hidePause();
    lastT = performance.now();
    acc = 0;
  }
}

function drainEvents() {
  for (const ev of world.events) {
    if (ev.type === 'mission' || ev.type === 'story') {
      hud.toast(`Misi selesai! +$${ev.pay || 0}`);
      audio.mission();
      writeSave();
    } else if (ev.type === 'steal') {
      hud.toast('Mobil dicuri! Polisi mengincarmu.');
      audio.steal();
    } else if (ev.type === 'enter') {
      hud.toast('Kamu masuk mobil.');
    } else if (ev.type === 'escaped') {
      hud.toast('Lolos dari polisi!');
    } else if (ev.type === 'roadblock') {
      hud.toast('Polisi memasang blokade jalan!');
    } else if (ev.type === 'busted') {
      hud.showEnd('busted', ev.fine);
      audio.busted();
      writeSave();
    } else if (ev.type === 'wasted') {
      hud.showEnd('wasted', ev.fine);
      audio.wasted();
      writeSave();
    } else if (ev.type === 'pickup') {
      hud.toast(ev.kind === 'cash' ? `+$${ev.value}` : `+${ev.value} HP`);
      audio.pickup(ev.kind);
    } else if (ev.type === 'fare') {
      hud.toast(`Ongkos taksi: +$${ev.fare}`);
      audio.fare();
    } else if (ev.type === 'taxi') {
      hud.toast(ev.text);
    } else if (ev.type === 'crash') {
      audio.crash(ev.speed || 10);
    } else if (ev.type === 'shot') {
      audio.shot();
      if (ev.hit === 'wall') render.spark(world.lastShot.to[0], world.lastShot.to[1], world.lastShot.to[2]);
    } else if (ev.type === 'wreck') {
      hud.toast('Mobil meledak!');
    }
  }
  world.events.length = 0;
  // Explosions for freshly wrecked cars.
  for (const car of world.cars) {
    if (car.wreck && !exploded.has(car.id)) {
      exploded.add(car.id);
      render.explode(car.x, 1, car.z);
      audio.crash(20);
    }
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  const rawDt = Math.min(0.1, Math.max(0, (now - lastT) / 1000));
  lastT = now;
  fpsFrames++;
  if (now - fpsAt >= 500) {
    fps = (fpsFrames * 1000) / (now - fpsAt);
    fpsFrames = 0;
    fpsAt = now;
    window.__fps = fps;
  }

  // UI actions are handled once per frame, never per substep.
  if (input.actions.pause) {
    input.actions.pause = false;
    if (state === 'playing') setPaused(true);
    else if (state === 'paused') setPaused(false);
  }
  if (input.actions.mute) {
    input.actions.mute = false;
    audio.setMuted(!audio.muted);
    hud.toast(audio.muted ? 'Suara mati' : 'Suara hidup');
  }
  if (input.actions.confirm && state === 'title') {
    input.actions.confirm = false;
    startGame(false);
  }

  if (state === 'playing') {
    // Chase camera: ease the orbit behind the car when not dragging.
    // Skipped for staged shots: the chase still is composed head-on on
    // purpose, and the auto-align would swing it back behind the car.
    if (!shotName && !world.player.onFoot && now - input.lastDragAt > 1200) {
      const car = world.cars.find((c) => c.id === world.player.carId);
      if (car) {
        const target = car.angle - Math.PI / 2;
        let d = target - world.player.camYaw;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        world.player.camYaw += d * Math.min(1, rawDt * 1.4);
      }
    }
    // The shot ray is taken from the camera at the start of the frame.
    let shotRay = null;
    if (input.actions.fire) {
      const dir = render.camera.getWorldDirection(new THREE.Vector3());
      shotRay = {
        ox: render.camera.position.x, oy: render.camera.position.y, oz: render.camera.position.z,
        dx: dir.x, dy: dir.y, dz: dir.z,
      };
    }
    acc += rawDt;
    let steps = 0;
    while (acc >= CFG.step && steps < CFG.maxStepsPerFrame) {
      stepWorld(world, { keys: input.keys, actions: input.actions, look: input.look, shotRay }, CFG.step);
      acc -= CFG.step;
      steps++;
    }
    if (steps === CFG.maxStepsPerFrame) acc = 0;
    drainEvents();
    audio.setEngine(!world.player.onFoot, world.player.speed);
    if (world.time - lastSaveAt > 30) writeSave();
    if (staged) {
      shotFrames++;
      if (shotFrames >= 10 && now - shotStartAt >= 1000) window.__shotReady = true;
    }
  }

  render.adapt(fps, now);
  render.render(rawDt, now / 1000);
  hud.update(world, fps, state);
}

function resize() {
  render.resize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', resize);
resize();

window.__game = { world, render, hud, input, audio, state: () => state };
window.__fps = 60;
window.__shotReady = false;
window.__setLockRatio = (v) => render.lockRatio(v);
if (debug) window.__debug = { world, render };

if (shotName) {
  // Staged capture: skip the title, drop straight into the composed shot.
  // The title shot keeps its overlay; the gameplay shots show the HUD.
  staged = stageShot(world, shotName);
  shotFrames = 0;
  shotStartAt = performance.now();
  if (shotName === 'start') {
    hud.showTitle(null);
  } else {
    hud.hideTitle();
    hud.showHud();
  }
  state = 'playing';
  audio.resume();
} else {
  toTitle();
}

requestAnimationFrame(frame);
