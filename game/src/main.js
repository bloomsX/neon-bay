// NEON BAY — boot and the one loop. Input is read every frame, the world advances
// in fixed 1/60 s steps (several in a slow frame, none in a fast one), the renderer
// paints what is there. Screens: title, play, paused, busted, wasted.
//
// ?seed=N fixes the city. ?shot=start|drive|chase|mission (with &seed=N) stages
// that scene instead of running the loop, paints it three times and sets
// window.__shotReady for a screenshot. window.__fps / window.__game expose the
// live frame rate and renderer stats for the performance harness, and
// window.__debug (with ?debug=1) exposes the world for headless play-tests.
import { STEP, SAVE_KEY } from './config.js';
import { createRandom, clamp, lerpAngle } from './random.js';
import {
  createWorld, EVENT_BUSTED, EVENT_CRASH, EVENT_EXPLOSION, EVENT_FARE,
  EVENT_MISSION, EVENT_PICKUP, EVENT_SHOT, EVENT_WASTED,
} from './world.js';
import { ACTION_CONFIRM, ACTION_ENTER, ACTION_MUTE, ACTION_PAUSE, ACTION_SHOOT, createInput } from './input.js';
import { createRenderer } from './render.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';
import { stageShot } from './shots.js';

const MAX_FRAME = 0.25; // a hung tab never fast-forwards more than this per frame

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : 1;

window.__errors = [];
window.addEventListener('error', (event) => {
  window.__errors.push(String(event.message || event.error || 'unknown error'));
});
window.addEventListener('unhandledrejection', (event) => {
  window.__errors.push(`unhandled rejection: ${event.reason}`);
});

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const world = createWorld(createRandom(seed));
const renderer = createRenderer(canvas, world);
const hud = createHud(world);
const audio = createAudio();
const input = createInput(canvas);

// Debug hook for the headless play-test harness (?debug=1): exposes the world so
// the harness can stage busy scenes (drive, chase) and measure input latency.
// Never enabled in normal play; it changes nothing about the game itself.
if (params.get('debug') === '1') window.__debug = { world, render: renderer };

function readSave() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeSave() {
  try {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(world.snapshot()));
  } catch {
    // Storage can be off (private windows): progress then lasts this visit only.
  }
}

function showOverlay(id) {
  for (const el of document.querySelectorAll('.overlay')) el.classList.remove('show');
  if (id) document.getElementById(id).classList.add('show');
}

function runShot(name) {
  const staged = stageShot(name, world);
  hud.update(world.state, staged.screen, 60);
  if (staged.screen === 'title') showOverlay('overlay-start');
  // Staging ran the sim without rendering, so the chase camera is still at its
  // spawn point — snap it behind the player before the first painted frame.
  renderer.snapCamera();
  let painted = 0;
  function paint() {
    renderer.sync(world.state, 1 / 60, staged.screen);
    painted += 1;
    if (painted < 3) requestAnimationFrame(paint);
    else {
      window.__shotReady = true;
      window.__game = {
        fps: 60,
        calls: renderer.info().render.calls,
        triangles: renderer.info().render.triangles,
        pixelRatio: renderer.pixelRatio(),
      };
    }
  }
  requestAnimationFrame(paint);
}

function runGame() {
  let screen = 'title';
  let accumulator = 0;
  let last = performance.now();
  let fps = 60;
  let lastDragAt = -10;
  let lastSkidAt = -10;
  const save = readSave();
  const continueBtn = document.getElementById('btn-continue');
  const bestEl = document.getElementById('best-line');
  if (save && (save.cash > 0 || save.missionsDone > 0 || (save.fares || 0) > 0)) {
    continueBtn.style.display = 'inline-block';
    const parts = [`$${save.cash.toLocaleString('en-US')}`];
    parts.push(save.storyDone ? 'cerita tamat' : `misi ${save.missionsDone}/3 selesai`);
    if (save.fares > 0) parts.push(`${save.fares} taksi`);
    if (save.topSpeed) parts.push(`top ${save.topSpeed} km/h`);
    bestEl.textContent = `Save ditemukan: ${parts.join(' · ')}`;
  }

  function announce(message) {
    status.textContent = message;
  }

  function startGame(fresh) {
    if (fresh) {
      world.reset(seed);
    } else if (save) {
      world.reset(seed);
      world.applySnapshot(save);
    }
    audio.unlock();
    audio.click();
    screen = 'play';
    showOverlay(null);
    announce('Neon Bay. WASD jalan, E curi mobil, klik untuk menembak.');
  }

  function endRun(kind, title, line) {
    screen = kind;
    writeSave();
    document.getElementById('end-title').textContent = title;
    document.getElementById('end-line').textContent = line;
    showOverlay('overlay-end');
    audio.busted();
    announce(`${title} ${line}`);
  }

  document.getElementById('btn-start').addEventListener('click', () => startGame(true));
  continueBtn.addEventListener('click', () => startGame(false));
  document.getElementById('btn-resume').addEventListener('click', () => {
    screen = 'play';
    showOverlay(null);
    audio.click();
  });
  document.getElementById('btn-restart').addEventListener('click', () => startGame(true));
  document.getElementById('btn-title').addEventListener('click', () => {
    screen = 'title';
    showOverlay('overlay-start');
  });

  function handleActions() {
    const actions = input.takeActions();
    const drag = input.takeDrag();
    if (drag.x !== 0 || drag.y !== 0) {
      world.state.player.camYaw -= drag.x * 0.005;
      world.state.player.camPitch = clamp((world.state.player.camPitch || 0) - drag.y * 0.002, -0.4, 0.5);
      lastDragAt = world.state.time;
    }
    if (actions & ACTION_MUTE) {
      audio.setMuted(!audio.isMuted());
      announce(audio.isMuted() ? 'Suara mati.' : 'Suara hidup.');
    }
    if (screen === 'title' || screen === 'busted' || screen === 'wasted') {
      if (actions & ACTION_CONFIRM) startGame(true);
      return actions;
    }
    if (actions & ACTION_PAUSE) {
      if (screen === 'play') {
        screen = 'paused';
        showOverlay('overlay-pause');
        writeSave();
        announce('Paused.');
      } else if (screen === 'paused') {
        screen = 'play';
        showOverlay(null);
        announce('Playing.');
      }
    }
    return actions;
  }

  function step(actions) {
    const p = world.state.player;
    // While driving, the camera eases back behind the car unless the player
    // dragged it recently — the car, not the camera, does the steering.
    if (!p.onFoot && world.state.time - lastDragAt > 2) {
      const car = world.state.cars.find((c) => c.id === p.carId);
      if (car) p.camYaw = lerpAngle(p.camYaw, car.angle + Math.PI, 0.06);
    }
    const move = input.move();
    const events = world.step(STEP, move, screen === 'play' ? actions : 0);
    if (events & EVENT_SHOT) audio.gunshot();
    if (events & EVENT_CRASH) audio.crash();
    if (events & EVENT_PICKUP) audio.pickup();
    if (events & EVENT_FARE) audio.fare();
    if (events & EVENT_EXPLOSION) audio.explosion();
    if (events & EVENT_MISSION) {
      audio.mission();
      writeSave();
    }
    if (events & EVENT_BUSTED) endRun('busted', 'BUSTED!', 'Polisi menangkapmu. Kamu bangun di rumah sakit — dan dompetmu lebih tipis.');
    else if (events & EVENT_WASTED) endRun('wasted', 'WASTED!', 'Kamu tumbang di jalanan Neon Bay. Tagihan rumah sakit menanti.');
    // Hard cornering at speed screeches the tyres (throttled, one per second).
    if (!p.onFoot && Math.abs(p.speed) > 22 && Math.abs(move.strafe) > 0.5 && world.state.time - lastSkidAt > 1) {
      lastSkidAt = world.state.time;
      audio.skid();
    }
  }

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    if (dt > 0) fps += (1 / Math.max(dt, 1e-4) - fps) * 0.06;
    const actions = handleActions();
    const t0 = performance.now();
    if (screen === 'play') {
      accumulator += dt;
      let guard = 0;
      // Edge actions (enter car, shoot) fire ONCE per frame: the same bitmask
      // must not be replayed into every catch-up sub-step, or one E press
      // enters AND exits the car in the same frame (and a third replay fails
      // with "no car nearby" because the car is already kind 'player').
      // At 60 FPS the accumulator runs one step per frame so this never
      // showed; at low FPS it runs up to 8.
      while (accumulator >= STEP && guard < 8) {
        step(guard === 0 ? actions : 0);
        accumulator -= STEP;
        guard += 1;
        if (screen !== 'play') {
          accumulator = 0;
          break;
        }
      }
      if (guard >= 8) accumulator = 0;
    } else if (screen === 'title') {
      // The city stays alive behind the menu: traffic and pedestrians drift on.
      accumulator += dt;
      while (accumulator >= STEP) {
        world.step(STEP, { fwd: 0, strafe: 0, run: false }, 0);
        accumulator -= STEP;
      }
    } else {
      accumulator = 0;
    }
    const p = world.state.player;
    audio.update(p.onFoot ? 0 : p.speed, !p.onFoot, world.state.wanted.stars, dt);
    const tSync = performance.now();
    renderer.sync(world.state, dt, screen);
    const tHud = performance.now();
    hud.update(world.state, screen, screen === 'play' ? fps : 60, dt);
    if (params.get('debug') === '1') {
      window.__perf = {
        frameMs: +(performance.now() - t0).toFixed(2),
        syncMs: +(tHud - tSync).toFixed(2),
        hudMs: +(performance.now() - tHud).toFixed(2),
        pixelRatio: renderer.pixelRatio(),
      };
    }
    window.__fps = fps;
    window.__game = {
      fps,
      calls: renderer.info().render.calls,
      triangles: renderer.info().render.triangles,
      pixelRatio: renderer.pixelRatio(),
    };
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === 'play') {
      screen = 'paused';
      showOverlay('overlay-pause');
      writeSave();
      announce('Paused.');
    }
  });

  showOverlay('overlay-start');
  announce('Neon Bay. Press Space or click Start to play.');
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
