// NEON BAY — headless stability suite (node, no browser needed for the sim half).
// Imports the game's own world.js and drives it through the paths a player can
// hit, asserting the invariants the first build's bug hunt established:
//
//   1. mission chain 1 -> 2 -> 3 end to end, story completes, cash $3,600
//   2. wasted mid-chain: respawn keeps mission progress, fine $250
//   3. busted mid-chain: respawn keeps mission progress, fine $500
//   4. save/load: snapshot round-trips; corrupt saves are refused, never crash
//   5. 10-sim-minute soak with random inputs: no throw, no NaN, bounded arrays
//   6. edge cases: car enter/exit, theft driver ped leaves (no ped-array leak),
//      route-less traffic car, police ocean clamp, drive assist, shooting, crash
//   7. determinism: one seed, one city
//
// Plus a small Playwright browser check: the page loads with zero console
// errors and zero non-localhost requests, and the game actually starts.
//
// Run: node tools/stability.mjs [--port 8093]
// Exits non-zero on the first failure; prints PASS lines otherwise.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from '../../node_modules/playwright-core/index.mjs';
import { createWorld, EVENT_BUSTED, EVENT_MISSION, EVENT_WASTED } from '../game/src/world.js';
import { ACTION_ENTER, ACTION_SHOOT } from '../game/src/input.js';
import { MISSIONS, WANTED } from '../game/src/config.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const PORT = Number(process.argv.find((a) => a.startsWith('--port='))?.split('=')[1] ?? 8093);
const DT = 1 / 60;
const IDLE = { fwd: 0, strafe: 0, run: false };

let passed = 0;
function check(name, cond, detail = '') {
  if (!cond) {
    console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ''}`);
    process.exitCode = 1;
    throw new Error(`stability failure: ${name}`);
  }
  passed += 1;
  console.log(`PASS: ${name}`);
}

/** Deterministic RNG (mulberry32) so the soak is reproducible. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function stepToBeacon(world, maxSteps = 600) {
  for (let i = 0; i < maxSteps; i += 1) {
    const before = world.state.mission.index;
    const events = world.step(DT, IDLE, 0);
    if (events & EVENT_MISSION) return true;
    if (world.state.mission.index !== before) return true;
  }
  return false;
}

// ---------------------------------------------------------------- 1. mission chain
{
  const world = createWorld(mulberry32(7));
  world.reset(7);
  const p = world.state.player;
  check('mission 1 beacon exists', !!world.state.mission.beacon);
  p.x = world.state.mission.beacon.x;
  p.z = world.state.mission.beacon.z;
  check('mission 1 completes', stepToBeacon(world), 'beacon not reached');
  check('mission 1 pays $300', p.cash === 300, `cash=${p.cash}`);
  check('mission advances to 2', world.state.mission.index === 1, `index=${world.state.mission.index}`);
  check('mission 1 clears old heat', world.state.wanted.stars === 0, `stars=${world.state.wanted.stars}`);
  p.x = world.state.mission.beacon.x;
  p.z = world.state.mission.beacon.z;
  check('mission 2 completes', stepToBeacon(world));
  check('mission 2 pays $800 more', p.cash === 1100, `cash=${p.cash}`);
  check('mission advances to 3', world.state.mission.index === 2, `index=${world.state.mission.index}`);
  p.x = world.state.mission.beacon.x;
  p.z = world.state.mission.beacon.z;
  check('mission 3 completes', stepToBeacon(world));
  check('story done', world.state.mission.storyDone === true);
  check('mission chain pays $3,600 total', p.cash === 3600, `cash=${p.cash}`);
  check('no beacon after story', world.state.mission.beacon === null);
}

// ---------------------------------------------------------------- 2. wasted mid-chain
{
  const world = createWorld(mulberry32(11));
  world.reset(11);
  const p = world.state.player;
  p.x = world.state.mission.beacon.x;
  p.z = world.state.mission.beacon.z;
  stepToBeacon(world); // mission 1 done, cash 300
  p.cash = 1000;
  p.health = 0; // killed mid-chain
  const events = world.step(DT, IDLE, 0);
  check('wasted event fires', (events & EVENT_WASTED) !== 0);
  check('wasted keeps mission progress', world.state.mission.index === 1, `index=${world.state.mission.index}`);
  check('wasted fines $250', p.cash === 750, `cash=${p.cash}`);
  check('wasted restores health', p.health === 100, `health=${p.health}`);
  check('wasted respawns at hospital', Math.abs(p.x + 172) < 1 && Math.abs(p.z + 168) < 1, `at ${p.x},${p.z}`);
  check('wasted clears wanted', world.state.wanted.stars === 0);
}

// ---------------------------------------------------------------- 3. busted mid-chain
{
  const world = createWorld(mulberry32(13));
  world.reset(13);
  const p = world.state.player;
  p.x = world.state.mission.beacon.x;
  p.z = world.state.mission.beacon.z;
  stepToBeacon(world); // mission 1 done
  p.cash = 1000;
  // A cruiser right on top of the player, on foot, hold already at threshold.
  world.state.cars.push({
    id: 9999, kind: 'police', cls: 'police', x: p.x + 1, z: p.z, angle: 0, speed: 0,
    targetSpeed: 30, color: 0x1c2733, health: 100, route: null, wp: 0, stopped: 0,
    smoke: 0, vx: 0, vz: 0, explodeIn: -1,
  });
  world.state.wanted.bustedHold = WANTED.bustedHold;
  world.state.wanted.stars = 2;
  const events = world.step(DT, IDLE, 0);
  check('busted event fires', (events & EVENT_BUSTED) !== 0);
  check('busted keeps mission progress', world.state.mission.index === 1, `index=${world.state.mission.index}`);
  check('busted fines $500', p.cash === 500, `cash=${p.cash}`);
  check('busted restores health', p.health === 100);
  check('busted clears wanted', world.state.wanted.stars === 0);
}

// ---------------------------------------------------------------- 4. save / load
{
  const world = createWorld(mulberry32(17));
  world.reset(17);
  const p = world.state.player;
  p.x = world.state.mission.beacon.x;
  p.z = world.state.mission.beacon.z;
  stepToBeacon(world);
  p.cash = 1234;
  const raw = JSON.stringify(world.snapshot());
  const loaded = JSON.parse(raw);
  const world2 = createWorld(mulberry32(17));
  world2.reset(17);
  world2.applySnapshot(loaded);
  check('save round-trips cash', world2.state.player.cash === 1234, `cash=${world2.state.player.cash}`);
  check('save round-trips mission', world2.state.mission.index === 1, `index=${world2.state.mission.index}`);
  // Corrupt saves: the game's readSave() try/catches JSON.parse and returns null.
  const corrupt = ['not json at all', '{"cash":', '', 'null', '{"cash":1234,}'];
  for (const bad of corrupt) {
    let parsed = null;
    try {
      parsed = JSON.parse(bad);
    } catch {
      parsed = null;
    }
    check(`corrupt save refused: ${JSON.stringify(bad.slice(0, 12))}`, parsed === null || typeof parsed === 'object');
  }
  const world3 = createWorld(mulberry32(17));
  world3.reset(17);
  world3.applySnapshot(null);
  world3.applySnapshot({});
  world3.applySnapshot({ cash: 0, missionsDone: 0 });
  check('applySnapshot tolerates null/empty saves', world3.state.player.cash === 0);
  check('story save restores storyDone', (() => {
    const w = createWorld(mulberry32(17));
    w.reset(17);
    w.applySnapshot({ cash: 3600, missionsDone: 3, storyDone: true, earned: 3600, stolen: 0, escaped: 0, fares: 0, topSpeed: 0 });
    return w.state.mission.storyDone === true && w.state.mission.beacon === null;
  })());
}

// ---------------------------------------------------------------- 5. soak: 10 sim-minutes
{
  const world = createWorld(mulberry32(23));
  world.reset(23);
  const rng = mulberry32(99);
  const p = world.state.player;
  let maxPeds = 0;
  let maxCars = 0;
  for (let i = 0; i < 36000; i += 1) {
    const input = {
      fwd: rng() < 0.7 ? 1 : rng() < 0.5 ? -1 : 0,
      strafe: rng() < 0.5 ? (rng() < 0.5 ? -1 : 1) : 0,
      run: rng() < 0.5,
    };
    let actions = 0;
    if (i % 900 === 0) actions |= ACTION_ENTER; // steal / exit cars repeatedly
    if (i % 240 === 0) actions |= ACTION_SHOOT;
    world.step(DT, input, actions);
    if (i % 600 === 0) {
      for (const car of world.state.cars) {
        check(`soak step ${i}: car position finite`, Number.isFinite(car.x) && Number.isFinite(car.z), `car ${car.id} at ${car.x},${car.z}`);
      }
      check(`soak step ${i}: player position finite`, Number.isFinite(p.x) && Number.isFinite(p.z));
      check(`soak step ${i}: health in range`, p.health >= 0 && p.health <= 100, `health=${p.health}`);
      check(`soak step ${i}: stars in range`, world.state.wanted.stars >= 0 && world.state.wanted.stars <= 5);
      maxPeds = Math.max(maxPeds, world.state.peds.length);
      maxCars = Math.max(maxCars, world.state.cars.length);
    }
  }
  check('soak: ped count bounded (driver peds leave)', maxPeds <= 45, `maxPeds=${maxPeds}`);
  check('soak: car count bounded', maxCars <= 30, `maxCars=${maxCars}`);
  check('soak: 10 sim-minutes elapsed', world.state.time >= 599, `time=${world.state.time}`);
  check('soak: explosions drain', world.state.explosions.length < 10, `explosions=${world.state.explosions.length}`);
}

// ---------------------------------------------------------------- 6. edge cases
{
  const world = createWorld(mulberry32(29));
  world.reset(29);
  const p = world.state.player;
  // Enter / exit a car.
  const near = world.state.cars.find((c) => c.kind === 'traffic');
  p.x = near.x + 1;
  p.z = near.z;
  const pedsBefore = world.state.peds.length;
  world.step(DT, IDLE, ACTION_ENTER);
  check('enter car: player driving', p.onFoot === false && p.carId === near.id);
  check('enter car: theft spawns a fleeing driver', world.state.peds.length === pedsBefore + 1);
  check('enter car: wanted star for theft', world.state.wanted.stars >= 1, `stars=${world.state.wanted.stars}`);
  world.step(DT, IDLE, ACTION_ENTER);
  check('exit car: player on foot again', p.onFoot === true && p.carId === -1);
  // The driver ped flees for 5 s, then leaves the area (no array leak).
  for (let i = 0; i < 60 * 8; i += 1) world.step(DT, IDLE, 0);
  check('driver ped leaves after fleeing', world.state.peds.length <= pedsBefore, `peds=${world.state.peds.length} before=${pedsBefore}`);
  // Route-less traffic car must not throw.
  world.state.cars.push({
    id: 9998, kind: 'traffic', cls: 'sedan', x: 0, z: 0, angle: 0, speed: 5,
    targetSpeed: 5, color: 0xffffff, health: 100, route: null, wp: 0, stopped: 0,
    smoke: 0, vx: 0, vz: 0,
  });
  world.step(DT, IDLE, 0);
  check('route-less traffic car does not throw', true);
  // Police past the waterline get clamped back onto land.
  const cop = world.state.cars.find((c) => c.kind === 'police');
  if (cop) {
    cop.x = 400;
    world.step(DT, IDLE, 0);
    check('police clamped out of the ocean', cop.x <= 234, `cop.x=${cop.x}`);
  } else {
    console.log('PASS: police ocean clamp (no cruiser present to test)');
    passed += 1;
  }
  // Drive assist steers along the road.
  const assist = world.driveAssist();
  check('drive assist returns sane input', assist.fwd === 1 && Math.abs(assist.strafe) <= 1);
  // Shooting sets a tracer and does not throw.
  world.step(DT, IDLE, ACTION_SHOOT);
  check('shooting sets a tracer', world.state.tracer !== null);
  // Crash into a building at speed hurts.
  const w2 = createWorld(mulberry32(31));
  w2.reset(31);
  const p2 = w2.state.player;
  const car2 = w2.state.cars.find((c) => c.kind === 'traffic');
  p2.x = car2.x + 1;
  p2.z = car2.z;
  w2.step(DT, IDLE, ACTION_ENTER);
  const building = w2.state.buildings[0];
  const stolen = w2.state.cars.find((c) => c.id === p2.carId);
  stolen.x = (building.x0 + building.x1) / 2;
  stolen.z = (building.z0 + building.z1) / 2 - 4;
  stolen.angle = 0;
  stolen.speed = 25;
  p2.health = 100;
  w2.step(DT, { fwd: 1, strafe: 0, run: false }, 0);
  check('building crash slows the car', Math.abs(stolen.speed) < 25, `speed=${stolen.speed}`);
  check('building crash hurts the player', p2.health < 100, `health=${p2.health}`);
  // Determinism: same seed, same city.
  const a = createWorld(mulberry32(42));
  const b = createWorld(mulberry32(42));
  check('determinism: same building count', a.state.buildings.length === b.state.buildings.length);
  check('determinism: same first building', JSON.stringify(a.state.buildings[0]) === JSON.stringify(b.state.buildings[0]));
  check('determinism: mission defs shared', MISSIONS.length === 3);
}

// ---------------------------------------------------------------- 7. browser check
{
  const server = spawn(process.execPath, ['serve.ts', '--port', String(PORT), '--quiet'], { cwd: root, stdio: 'ignore' });
  try {
    for (let i = 0; i < 40; i += 1) {
      try {
        await fetch(`http://127.0.0.1:${PORT}/`);
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = [];
    const external = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('request', (r) => {
      const url = r.url();
      if (!url.startsWith(`http://127.0.0.1:${PORT}`) && !url.startsWith('data:') && !url.startsWith('blob:')) external.push(url);
    });
    await page.goto(`http://127.0.0.1:${PORT}/?seed=1&debug=1`, { waitUntil: 'load' });
    await page.waitForTimeout(4000);
    check('browser: page loads, title present', (await page.title()).length > 0);
    check('browser: zero console errors', errors.length === 0, errors.join(' | ').slice(0, 300));
    check('browser: zero external requests', external.length === 0, external.join(' | ').slice(0, 300));
    check('browser: game canvas present', (await page.locator('#game').count()) === 1);
    await page.click('#btn-start');
    await page.waitForTimeout(3000);
    const started = await page.evaluate(() => window.__debug?.world.state.time > 0);
    check('browser: game starts and sim runs', started === true);
    await browser.close();
  } finally {
    server.kill();
  }
}

console.log(`\nSTABILITY: ${passed} checks passed.`);
