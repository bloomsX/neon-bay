// NEON BAY — stability suite. Imports the pure simulation and drives it
// through the mission chain, busted/wasted, saves, a 10-sim-minute soak,
// edge cases and determinism, then runs a headless browser pass (boot, walk,
// steal, drive, shoot, pause) and fails on any console error or any request
// that leaves localhost. Run: node tools/stability.mjs
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { CFG } from '../game/src/config.js';
import {
  createWorld, stepWorld, serializeWorld, deserializeWorld, missionBeacon,
} from '../game/src/world.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const ROAD_LINES = [-176, -108, -36, 36, 108, 176];

let passed = 0;
let failed = 0;
const failures = [];

function check(name, cond) {
  if (cond) passed++;
  else {
    failed++;
    if (failures.length < 40) failures.push(name);
  }
}

function blankInput() {
  return {
    keys: { up: false, down: false, left: false, right: false, run: false },
    actions: { steal: false, fire: false, pause: false, mute: false, confirm: false },
    look: { dx: 0, dy: 0 },
    shotRay: null,
  };
}

function stepN(world, n, mutate) {
  const input = blankInput();
  for (let i = 0; i < n; i++) {
    if (mutate) mutate(input, i);
    stepWorld(world, input, CFG.step);
  }
  return input;
}

function snapshot(world) {
  return JSON.stringify({
    p: [world.player.x, world.player.z, world.player.angle, world.player.health, world.player.cash],
    cars: world.cars.map((c) => [c.id, Math.round(c.x * 100) / 100, Math.round(c.z * 100) / 100, Math.round(c.angle * 1000) / 1000, Math.round(c.speed * 100) / 100]),
    peds: world.peds.map((q) => [q.id, Math.round(q.x * 100) / 100, Math.round(q.z * 100) / 100]),
    mission: [world.mission.index, world.mission.storyDone],
    heat: world.wanted.heat,
    stats: world.stats,
  });
}

function rayAt(from, target, y = 1) {
  const dx = target.x - from.x;
  const dy = y - 1.4;
  const dz = target.z - from.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  return { ox: from.x, oy: 1.4, oz: from.z, dx: dx / len, dy: dy / len, dz: dz / len };
}

// ------------------------------------------------------------------ 1. city
{
  const w = createWorld(1337);
  check('city has buildings', w.city.buildings.length >= 30);
  check('city has palms', w.city.palms.length >= 40);
  check('city has streetlights', w.city.lights.length >= 20);
  check('city has a CLUB NEON sign', w.city.signs.some((s) => s.text === 'CLUB NEON'));
  check('city has 5 signs', w.city.signs.length === 5);
  let overlap = 0;
  const bs = w.city.buildings;
  for (let i = 0; i < bs.length; i++) {
    for (let j = i + 1; j < bs.length; j++) {
      const a = bs[i], b = bs[j];
      if (Math.abs(a.x - b.x) < (a.w + b.w) / 2 - 0.5 && Math.abs(a.z - b.z) < (a.d + b.d) / 2 - 0.5) overlap++;
    }
  }
  check('no overlapping buildings', overlap === 0);
  check('all buildings on land', bs.every((b) => b.x > -180 && b.x < 180 && b.z > -180 && b.z < 180));
  const m3 = CFG.missions[2].beacon;
  const onRoadX = [-176, -108, -36, 36, 108, 176].some((c) => Math.abs(m3[0] - c) <= 8);
  const onRoadZ = [-176, -108, -36, 36, 108, 176].some((c) => Math.abs(m3[1] - c) <= 8);
  check('mission 3 beacon reachable by car', onRoadX || onRoadZ);
}

// ---------------------------------------------------------- 2. determinism
{
  const drive = (w) => {
    const input = blankInput();
    input.keys.up = true;
    for (let i = 0; i < 600; i++) {
      if (i === 200) input.actions.steal = true;
      if (i === 300) input.keys.left = true;
      if (i === 400) input.keys.left = false;
      stepWorld(w, input, CFG.step);
    }
  };
  const a = createWorld(1337);
  const b = createWorld(1337);
  drive(a);
  drive(b);
  check('same seed + same inputs = same state', snapshot(a) === snapshot(b));
  const c = createWorld(999);
  check('different seed = different city', JSON.stringify(c.city.buildings) !== JSON.stringify(a.city.buildings));
  const d = createWorld(1337);
  check('same seed = same city', JSON.stringify(d.city.buildings) === JSON.stringify(a.city.buildings));
}

// ---------------------------------------------------------- 3. mission chain
{
  const w = createWorld(1337);
  check('mission starts at 0', w.mission.index === 0 && !w.mission.storyDone);
  for (let m = 0; m < 3; m++) {
    const beacon = CFG.missions[m].beacon;
    const before = w.player.cash;
    w.player.x = beacon[0];
    w.player.z = beacon[1];
    stepN(w, 2);
    check(`mission ${m + 1} completes`, w.mission.index === m + 1 || w.mission.storyDone);
    check(`mission ${m + 1} pays $${CFG.missions[m].pay}`, w.player.cash === before + CFG.missions[m].pay);
    if (m === 0) check('mission 2 starts with heat 200', w.wanted.heat === 200);
    if (m === 1) check('mission 3 starts with heat cleared', w.wanted.heat === 0);
  }
  check('story done after mission 3', w.mission.storyDone === true);
  check('earned equals 3600', w.stats.earned === 3600);
  check('mission beacon is null after story', missionBeacon(w) === null);
}

// ------------------------------------------------- 4. busted / wasted mid-chain
{
  const w = createWorld(1337);
  w.mission.index = 1;
  w.player.cash = 1200;
  w.wanted.heat = 300;
  w.player.x = 0; w.player.z = 0;
  const cop = w.cars.find((c) => c.kind === 'police') || null;
  // Place a police car on top of the player, on foot, standing still.
  w.cars.push({
    id: 999, kind: 'police', cls: 'police', x: 2, z: 0, angle: 0, speed: 0,
    targetSpeed: 0, color: 0xf2f2f2, hp: 100, wreck: false, driver: true,
    route: [], wp: 0, mode: 'chase', brake: false, ramAt: -10, stuckAt: 0, idleAt: 0,
  });
  void cop;
  let busted = false;
  for (let i = 0; i < 60 * 6; i++) {
    const before = w.events.length;
    stepN(w, 1);
    if (w.events.some((e) => e.type === 'busted')) { busted = true; break; }
    void before;
  }
  check('busted after being held by police', busted);
  check('busted fine is $500', w.player.cash === 700);
  check('busted keeps mission progress', w.mission.index === 1 && !w.mission.storyDone);
  check('busted clears heat', w.wanted.heat === 0 && w.wanted.stars === 0);
  check('busted respawns at south edge', Math.abs(w.player.x) < 1 && Math.abs(w.player.z - 172) < 1);
  check('busted restores health', w.player.health === CFG.playerHealth);

  const w2 = createWorld(1337);
  w2.mission.index = 2;
  w2.player.cash = 900;
  w2.player.health = 5;
  w2.player.x = 0; w2.player.z = 0;
  w2.cars.push({
    id: 999, kind: 'police', cls: 'police', x: 3, z: 0, angle: 0, speed: 10,
    targetSpeed: 30, color: 0xf2f2f2, hp: 100, wreck: false, driver: true,
    route: [], wp: 0, mode: 'chase', brake: false, ramAt: -10, stuckAt: 0, idleAt: 0,
  });
  let wasted = false;
  for (let i = 0; i < 60 * 5; i++) {
    stepN(w2, 1);
    if (w2.events.some((e) => e.type === 'wasted')) { wasted = true; break; }
  }
  check('wasted after a lethal ram', wasted);
  check('wasted fine is $250', w2.player.cash === 650);
  check('wasted keeps mission progress', w2.mission.index === 2);
  check('wasted restores health', w2.player.health === CFG.playerHealth);
}

// ---------------------------------------------------------------- 5. saves
{
  const w = createWorld(1337);
  w.player.cash = 1234;
  w.player.x = 40; w.player.z = -60;
  w.mission.index = 2;
  w.stats.fares = 3;
  w.stats.topSpeed = 33.5;
  const data = serializeWorld(w);
  const w2 = createWorld(1337);
  check('valid save loads', deserializeWorld(w2, data) === true);
  check('save restores cash', w2.player.cash === 1234);
  check('save restores mission', w2.mission.index === 2);
  check('save restores fares', w2.stats.fares === 3);
  check('save restores position', w2.player.x === 40 && w2.player.z === -60);
  const corrupt = [
    null, undefined, {}, { v: 2 }, { v: 1 }, { v: 1, cash: 'x' },
    { v: 1, cash: NaN, health: 100, missionIndex: 0, x: 0, z: 0, angle: 0 },
    { v: 1, cash: Infinity, health: 100, missionIndex: 0, x: 0, z: 0, angle: 0 },
    { v: 1, cash: -5, health: 100, missionIndex: 0, x: 0, z: 0, angle: 0 },
    { v: 1, cash: 100, health: 100, missionIndex: 99, x: 0, z: 0, angle: 0 },
    { v: 1, cash: 100, health: 100, missionIndex: -1, x: 0, z: 0, angle: 0 },
    { v: 1, cash: 100, health: 0, missionIndex: 0, x: 0, z: 0, angle: 0 },
    { v: 1, cash: 100, health: 999, missionIndex: 0, x: 0, z: 0, angle: 0 },
    { v: 1, cash: 100, health: 100, missionIndex: 0, x: NaN, z: 0, angle: 0 },
    { v: 1, cash: 100, health: 100, missionIndex: 0, x: 0, z: 0 },
    'not an object',
  ];
  let ok = 0;
  for (const bad of corrupt) {
    const w3 = createWorld(1337);
    w3.player.cash = 777;
    let threw = false;
    let applied = false;
    try { applied = deserializeWorld(w3, bad); } catch (err) { threw = true; }
    if (!threw && applied === false && w3.player.cash === 777) ok++;
  }
  check(`all ${corrupt.length} corrupt saves rejected safely`, ok === corrupt.length);
  // A finished-story save loads as story done.
  const done = serializeWorld(w);
  done.missionIndex = 3;
  const w4 = createWorld(1337);
  check('finished save loads as story done', deserializeWorld(w4, done) && w4.mission.storyDone);
}

// ------------------------------------------------------- 6. enter / exit x20
{
  const w = createWorld(1337);
  let cycles = 0;
  for (let i = 0; i < 20; i++) {
    // Teleport next to the nearest traffic car; a cycle counts when the
    // player gets into ANY car and back out (traffic is dense, the nearest
    // car is not always the same one).
    const car = w.cars
      .filter((c) => c.kind === 'traffic' && !c.wreck)
      .sort((a, b) => Math.hypot(a.x - w.player.x, a.z - w.player.z) - Math.hypot(b.x - w.player.x, b.z - w.player.z))[0];
    w.player.x = car.x + 1;
    w.player.z = car.z;
    w.player.onFoot = true;
    w.player.carId = -1;
    const input = blankInput();
    input.actions.steal = true;
    stepWorld(w, input, CFG.step);
    if (!w.player.onFoot && w.player.carId >= 0) {
      const input2 = blankInput();
      input2.actions.steal = true;
      stepWorld(w, input2, CFG.step);
      if (w.player.onFoot && w.player.carId === -1) cycles++;
    }
  }
  check('enter/exit works 20 times', cycles === 20);
  // Stealing counts once per driver: steal five DIFFERENT cars with a
  // driver still inside and the counter must rise by exactly five.
  const w2 = createWorld(1337);
  const drivers = w2.cars.filter((c) => c.kind === 'traffic' && c.driver && !c.wreck).slice(0, 5);
  let stolen = 0;
  for (const car of drivers) {
    w2.player.x = car.x + 1;
    w2.player.z = car.z;
    w2.player.onFoot = true;
    w2.player.carId = -1;
    const input = blankInput();
    input.actions.steal = true;
    stepWorld(w2, input, CFG.step);
    if (w2.player.carId === car.id) stolen++;
    // Hand the car back: exit so the next steal starts on foot.
    const input2 = blankInput();
    input2.actions.steal = true;
    stepWorld(w2, input2, CFG.step);
  }
  check('stealing five different driver cars counts five', stolen === 5 && w2.stats.stolen === 5);
}

// ---------------------------------------------------------------- 7. shooting
{
  const w = createWorld(1337);
  // Isolate the shot: park every car far away and put the pedestrian 3 m
  // ahead of the player on the open road, so no wall or car can block the ray.
  for (const car of w.cars) { car.x = 175; car.z = 175; car.speed = 0; }
  const ped = w.peds[0];
  ped.x = w.player.x + 3;
  ped.z = w.player.z;
  ped.health = 1;
  const heatBefore = w.wanted.heat;
  const input = blankInput();
  input.actions.fire = true;
  input.shotRay = rayAt(w.player, ped);
  stepWorld(w, input, CFG.step);
  check('shot fells a pedestrian', ped.state === 'fallen');
  check('shooting raises heat', w.wanted.heat > heatBefore);
  check('shot is recorded', w.lastShot && w.lastShot.hit === 'ped');
  // Cooldown: a second shot in the same window is ignored.
  const shotAt = w.lastShot.at;
  const input2 = blankInput();
  input2.actions.fire = true;
  input2.shotRay = rayAt(w.player, ped);
  stepWorld(w, input2, CFG.step);
  check('pistol cooldown blocks a second shot', w.lastShot.at === shotAt);
  // Shooting a police car damages it (pull it close first).
  w.wanted.heat = 300;
  stepN(w, 5);
  const cop = w.cars.find((c) => c.kind === 'police' && !c.wreck);
  check('police spawns at 3 stars', !!cop);
  if (cop) {
    cop.x = w.player.x + 10;
    cop.z = w.player.z;
    cop.speed = 0;
    const hpBefore = cop.hp;
    const input3 = blankInput();
    input3.actions.fire = true;
    input3.shotRay = rayAt(w.player, cop);
    w.lastFireAt = -10;
    stepWorld(w, input3, CFG.step);
    check('shot damages a police car', cop.hp === hpBefore - CFG.pistolDamage);
    // Wreck it with repeated hits.
    for (let i = 0; i < 4; i++) {
      w.lastFireAt = -10;
      const inp = blankInput();
      inp.actions.fire = true;
      inp.shotRay = rayAt(w.player, cop);
      stepWorld(w, inp, CFG.step);
    }
    check('police car wrecks at 0 hp', cop.wreck === true);
    check('wreck counts', w.stats.wrecks >= 1);
  }
  // A wall blocks the shot.
  const w2 = createWorld(1337);
  const b = w2.city.buildings[0];
  const input4 = blankInput();
  input4.actions.fire = true;
  input4.shotRay = {
    ox: b.x - b.w, oy: 1.4, oz: b.z,
    dx: 1, dy: 0, dz: 0,
  };
  stepWorld(w2, input4, CFG.step);
  check('a building blocks the shot', w2.lastShot && w2.lastShot.hit === 'wall');
}

// ------------------------------------------------- 8. wanted levels + blocks
{
  for (let stars = 0; stars <= 5; stars++) {
    const w = createWorld(1337);
    w.wanted.heat = stars * 100;
    w.wanted.lastCrimeAt = w.time;
    stepN(w, 30);
    check(`heat ${stars * 100} gives ${stars} stars`, w.wanted.stars === stars);
    const cops = w.cars.filter((c) => c.kind === 'police' && !c.wreck && c.mode !== 'roadblock').length;
    check(`${stars} stars spawns ${stars} police`, cops === stars);
    if (stars >= 4) {
      const blocks = w.cars.filter((c) => c.mode === 'roadblock').length;
      check(`${stars} stars raises roadblocks`, blocks >= 1);
    }
  }
  // Heat decays and the player escapes. The player must actually EVADE: a
  // cop that catches a standing player busts them (clearing the heat) before
  // it can decay. So the player starts in a sportscar and drives away.
  const w = createWorld(1337);
  w.wanted.heat = 110;
  w.wanted.lastCrimeAt = w.time - 10;
  const sport = w.cars.find((c) => c.cls === 'sport' && !c.wreck)
    || w.cars.find((c) => c.kind === 'traffic');
  sport.mode = 'player';
  w.player.onFoot = false;
  w.player.carId = sport.id;
  w.player.x = sport.x;
  w.player.z = sport.z;
  w.player.angle = sport.angle;
  const drive = blankInput();
  drive.keys.up = true;
  for (let i = 0; i < 60 * 60; i++) stepWorld(w, drive, CFG.step);
  check('heat decays to zero', w.wanted.heat === 0 && w.wanted.stars === 0);
  check('escape counts once', w.stats.escaped === 1);
}

// ------------------------------------------------------------------ 9. taxi
{
  const w = createWorld(1337);
  const taxi = w.cars.find((c) => c.kind === 'taxi');
  // Park every other car far away so the steal can only pick the taxi.
  for (const car of w.cars) {
    if (car !== taxi) { car.x = 175; car.z = 175; car.speed = 0; }
  }
  w.player.x = taxi.x + 1;
  w.player.z = taxi.z;
  const input = blankInput();
  input.actions.steal = true;
  stepWorld(w, input, CFG.step);
  check('entering the taxi starts the job', w.taxi.phase === 'toPassenger');
  const ped = w.peds.find((q) => q.id === w.taxi.passengerId);
  check('a passenger waits', !!ped);
  if (ped) {
    // Drive the taxi (the player's car) onto the passenger, then to the dest.
    taxi.x = ped.x;
    taxi.z = ped.z;
    stepN(w, 2);
    check('passenger boards', w.taxi.phase === 'toDest');
    taxi.x = w.taxi.dest.x;
    taxi.z = w.taxi.dest.z;
    const before = w.player.cash;
    stepN(w, 2);
    check('fare is paid', w.player.cash > before && w.stats.fares === 1);
  }
}

// --------------------------------------------------------------- 10. pickups
{
  const w = createWorld(1337);
  const cashPk = w.pickups.find((p) => p.kind === 'cash');
  w.player.cash = 0;
  w.player.x = cashPk.x;
  w.player.z = cashPk.z;
  stepN(w, 2);
  check('cash pickup pays $50', w.player.cash === 50 && cashPk.taken === true);
  const hpPk = w.pickups.find((p) => p.kind === 'health');
  w.player.health = 40;
  w.player.lastDamageAt = w.time; // no regen during the check
  w.player.x = hpPk.x;
  w.player.z = hpPk.z;
  stepN(w, 2);
  check('health pickup heals 30', w.player.health === 70);
}

// ---------------------------------------------------- 11. traffic + peds run
{
  const w = createWorld(1337);
  const input = blankInput();
  let minGap = 1e9;
  let offRoad = 0;
  let nanFound = false;
  for (let i = 0; i < 3600; i++) {
    stepWorld(w, input, CFG.step);
    if (i % 10 === 0) {
      for (const c of w.cars) {
        if (!Number.isFinite(c.x) || !Number.isFinite(c.z)) nanFound = true;
        if (c.x < -205 || c.x > 185 || c.z < -185 || c.z > 185) offRoad++;
        const nearRoad = ROAD_LINES.some((l) => Math.abs(c.x - l) <= 9) || ROAD_LINES.some((l) => Math.abs(c.z - l) <= 9);
        if (c.mode === 'route' && !nearRoad) offRoad++;
      }
      for (let a = 0; a < w.cars.length; a++) {
        for (let b = a + 1; b < w.cars.length; b++) {
          const ca = w.cars[a], cb = w.cars[b];
          if (ca.wreck || cb.wreck) continue;
          minGap = Math.min(minGap, Math.hypot(ca.x - cb.x, ca.z - cb.z));
        }
      }
      for (const q of w.peds) {
        if (!Number.isFinite(q.x) || !Number.isFinite(q.z)) nanFound = true;
        if (q.x < -205 || q.x > 185 || q.z < -185 || q.z > 185) offRoad++;
      }
    }
  }
  check('no NaN in a 60s traffic run', !nanFound);
  check('traffic stays on roads and in bounds', offRoad === 0);
  check('cars never overlap', minGap > 2);
}

// ------------------------------------------------------- 12. 10-minute soak
{
  const w = createWorld(1337);
  const input = blankInput();
  input.keys.up = true;
  let bad = 0;
  let checks = 0;
  for (let i = 0; i < 36000; i++) {
    if (i === 5000) input.actions.steal = true;
    if (i === 9000) input.actions.steal = true;
    if (i === 12000) { input.actions.fire = true; input.shotRay = { ox: w.player.x, oy: 1.4, oz: w.player.z, dx: 1, dy: 0, dz: 0 }; }
    stepWorld(w, input, CFG.step);
    if (i % 60 === 0) {
      checks += 4;
      if (!Number.isFinite(w.player.x) || !Number.isFinite(w.player.z)) bad++;
      if (w.player.health < 0 || w.player.health > CFG.playerHealth) bad++;
      if (w.wanted.heat < 0 || w.wanted.heat > CFG.heatMax) bad++;
      if (w.wanted.stars < 0 || w.wanted.stars > 5) bad++;
      if (w.cars.length > 60) bad++;
    }
  }
  check(`10-minute soak clean (${checks} sampled checks)`, bad === 0);
  check('soak advances time 600s', Math.abs(w.time - 600) < 1);
}

// ------------------------------------------- 13. headless browser play pass
async function browserPass() {
  const PORT = 8099;
  const server = spawn(process.execPath, ['serve.ts', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname,
    stdio: 'ignore',
  });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    // Wait for the server to answer.
    for (let i = 0; i < 40; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${PORT}/`);
        if (res.ok) break;
      } catch (err) { /* not up yet */ }
      await sleep(250);
    }
    const browser = await chromium.launch({
      executablePath: `${process.env.HOME}/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome`,
      args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = [];
    const external = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('request', (r) => {
      const u = r.url();
      if (!u.startsWith('http://127.0.0.1') && !u.startsWith('http://localhost') && !u.startsWith('data:') && !u.startsWith('blob:')) {
        external.push(u);
      }
    });
    await page.goto(`http://127.0.0.1:${PORT}/?seed=1337`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__game !== undefined, null, { timeout: 20000 });
    check('game boots to the title screen', await page.evaluate(() => {
      const t = document.querySelector('.title');
      return t && getComputedStyle(t).display !== 'none';
    }));
    await page.click('.btn-big');
    await sleep(1500);
    check('start button begins play', await page.evaluate(() => window.__game.state() === 'playing'));
    // Walk forward. SwiftShader renders at a few FPS and the fixed-step sim
    // caps steps per frame, so the sim runs slower than wall clock here:
    // hold the key longer and expect a modest distance.
    const before = await page.evaluate(() => ({ x: window.__game.world.player.x, z: window.__game.world.player.z }));
    await page.keyboard.down('KeyW');
    await sleep(4000);
    await page.keyboard.up('KeyW');
    const after = await page.evaluate(() => ({ x: window.__game.world.player.x, z: window.__game.world.player.z }));
    check('walking moves the player', Math.hypot(after.x - before.x, after.z - before.z) > 1.5);
    // Teleport next to a car and steal it, then drive.
    await page.evaluate(() => {
      const w = window.__game.world;
      const car = w.cars.find((c) => c.kind === 'traffic' && !c.wreck);
      w.player.x = car.x + 1;
      w.player.z = car.z;
    });
    await page.keyboard.press('KeyE');
    await sleep(300);
    check('stealing puts the player in a car', await page.evaluate(() => !window.__game.world.player.onFoot));
    // Point the stolen car down a straight road, then drive.
    await page.evaluate(() => {
      const w = window.__game.world;
      const car = w.cars.find((c) => c.id === w.player.carId);
      car.x = -100; car.z = -36; car.angle = 0; car.speed = 0;
      w.player.x = -100; w.player.z = -36;
    });
    const d0 = await page.evaluate(() => window.__game.world.stats.distance);
    await page.keyboard.down('KeyW');
    await sleep(8000);
    await page.keyboard.up('KeyW');
    const d1 = await page.evaluate(() => window.__game.world.stats.distance);
    check('driving covers distance', d1 - d0 > 5);
    // Shoot.
    await page.keyboard.press('KeyF');
    await sleep(300);
    check('shooting records a shot', await page.evaluate(() => !!window.__game.world.lastShot));
    // Pause and resume.
    await page.keyboard.press('KeyP');
    await sleep(300);
    check('pause opens the pause menu', await page.evaluate(() => window.__game.state() === 'paused'));
    await page.keyboard.press('KeyP');
    await sleep(300);
    check('pause resumes play', await page.evaluate(() => window.__game.state() === 'playing'));
    // The renderer produced frames.
    const info = await page.evaluate(() => window.__game.render.getInfo());
    check('renderer draws calls', info.calls >= 10 && info.calls <= 40);
    check('renderer draws triangles', info.triangles > 5000 && info.triangles < 40000);
    check('no console errors in the browser pass', errors.length === 0);
    check('no requests leave localhost', external.length === 0);
    if (errors.length) console.log('  console errors:', errors.slice(0, 5));
    if (external.length) console.log('  external requests:', external.slice(0, 5));
    await browser.close();
  } finally {
    server.kill();
  }
}

await browserPass();

console.log(`\nStability: ${passed} passed, ${failed} failed.`);
if (failed) {
  console.log('Failures:');
  for (const f of failures) console.log('  - ' + f);
  process.exit(1);
}
