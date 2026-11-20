// NEON BAY — the world simulation. Pure JavaScript, no browser or three.js
// dependency, so the stability suite can import it in Node. Deterministic:
// the same seed plus the same inputs always produce the same state.
//
// Layout: 5x5 blocks on a 72 m pitch. Block centres at -144, -72, 0, 72,
// 144. Roads run between the blocks (centrelines -108, -36, 36, 108) and
// around the edge (-176, 176). The west strip is beach, then ocean.
// x grows east, z grows south. Angles: 0 faces east (+x), turning toward
// +z (south) is positive rotation.
import { CFG } from './config.js';
import { makeRng, int, range, pick, shuffle, clamp, angleDiff, turnToward } from './random.js';

const TAU = Math.PI * 2;
const ROAD_LINES = [-176, -108, -36, 36, 108, 176];
const BLOCK_CENTRES = [-144, -72, 0, 72, 144];

// ---------------------------------------------------------------- city ---

function districtOf(bx, bz) {
  if (bx >= 0 && Math.abs(bz) <= 1) return 'downtown';
  if (bx <= -1 && bz <= -1) return 'docks';
  if ((bx === 1 && bz === 2) || (bx === -1 && bz === 1)) return 'park';
  if ((bx === 2 && bz === -2) || (bx === -2 && bz === 2)) return 'lot';
  return 'oldtown';
}

function buildCity(rng) {
  const buildings = [];
  const palms = [];
  const lights = [];
  const signs = [];
  let signSlots = [
    { text: 'CLUB NEON', color: '#ff2e88', want: 'downtown' },
    { text: 'HOTEL BAY', color: '#29d3ff', want: 'downtown' },
    { text: 'NEON BAR', color: '#ff9a2e', want: 'oldtown' },
    { text: 'DOCKS 24H', color: '#59ff8a', want: 'docks' },
    { text: 'PIZZA', color: '#ffe14d', want: 'oldtown' },
  ];
  for (let bi = 0; bi < 5; bi++) {
    for (let bj = 0; bj < 5; bj++) {
      const bx = BLOCK_CENTRES[bi];
      const bz = BLOCK_CENTRES[bj];
      const district = districtOf(bi - 2, bj - 2);
      if (district === 'park') {
        for (let i = 0; i < 9; i++) {
          palms.push({ x: bx + range(rng, -24, 24), z: bz + range(rng, -24, 24), s: range(rng, 0.9, 1.3) });
        }
        continue;
      }
      if (district === 'lot') continue;
      // One building per 2x2 cell of the block, jittered, so none overlap.
      const cells = shuffle(rng, [0, 1, 2, 3]);
      const count = district === 'downtown' ? int(rng, 2, 3) : int(rng, 2, 4);
      for (let c = 0; c < count; c++) {
        const cell = cells[c];
        const cx = bx + (cell % 2 === 0 ? -14 : 14);
        const cz = bz + (cell < 2 ? -14 : 14);
        let w, d, h;
        // Cells are 28 m apart, so a building may reach at most 13 m from its
        // cell centre (28 - 13 - 13 = 2 m gap). Sizes are capped at 20 m wide
        // with +/-2 m jitter: 10 + 2 = 12 m reach, a 4 m gap between neighbours.
        if (district === 'downtown') {
          w = range(rng, 14, 20); d = range(rng, 14, 20); h = range(rng, 34, 78);
        } else if (district === 'docks') {
          w = range(rng, 16, 20); d = range(rng, 16, 20); h = range(rng, 8, 13);
        } else {
          w = range(rng, 12, 18); d = range(rng, 12, 18); h = range(rng, 8, 17);
        }
        const b = {
          x: cx + range(rng, -2, 2), z: cz + range(rng, -2, 2),
          w, d, h, district,
          hue: range(rng, 0, 1),
        };
        buildings.push(b);
        // Neon signs: first matching building of each wanted district wins.
        const si = signSlots.findIndex((s) => s.want === district);
        if (si >= 0) {
          const slot = signSlots.splice(si, 1)[0];
          signs.push({ text: slot.text, color: slot.color, x: b.x, z: b.z, w: b.w, h: b.h, face: 'east' });
        }
      }
      // Palms along the block's sidewalk corners.
      for (let i = 0; i < 3; i++) {
        const side = pick(rng, ['n', 's', 'e', 'w']);
        if (side === 'n') palms.push({ x: bx + range(rng, -24, 24), z: bz - 30, s: range(rng, 0.9, 1.25) });
        if (side === 's') palms.push({ x: bx + range(rng, -24, 24), z: bz + 30, s: range(rng, 0.9, 1.25) });
        if (side === 'e') palms.push({ x: bx + 30, z: bz + range(rng, -24, 24), s: range(rng, 0.9, 1.25) });
        if (side === 'w') palms.push({ x: bx - 30, z: bz + range(rng, -24, 24), s: range(rng, 0.9, 1.25) });
      }
    }
  }
  // Streetlights at road intersections (one or two per crossing).
  for (const x of ROAD_LINES) {
    for (const z of ROAD_LINES) {
      if (x === -176 || x === 176 || z === -176 || z === 176) {
        if (rng() < 0.5) continue;
      }
      lights.push({ x: x + 9, z: z + 9 });
      if (rng() < 0.4) lights.push({ x: x - 9, z: z - 9 });
    }
  }
  // The Club Neon sign must sit on the block east of the mission-3 road.
  // If no downtown building took it, pin it to the closest downtown tower.
  if (!signs.some((s) => s.text === 'CLUB NEON')) {
    let best = null;
    let bestD = 1e9;
    for (const b of buildings) {
      if (b.district !== 'downtown') continue;
      const d = Math.hypot(b.x - 0, b.z - 0);
      if (d < bestD) { bestD = d; best = b; }
    }
    if (best) signs.push({ text: 'CLUB NEON', color: '#ff2e88', x: best.x, z: best.z, w: best.w, h: best.h, face: 'east' });
  }
  return { buildings, palms, lights, signs };
}

// A point on a sidewalk (just outside a block edge), for peds and pickups.
function sidewalkPoint(rng) {
  const bx = pick(rng, BLOCK_CENTRES);
  const bz = pick(rng, BLOCK_CENTRES);
  const side = pick(rng, ['n', 's', 'e', 'w']);
  if (side === 'n') return { x: clamp(bx + range(rng, -24, 24), -176, 176), z: bz - 30 };
  if (side === 's') return { x: clamp(bx + range(rng, -24, 24), -176, 176), z: bz + 30 };
  if (side === 'e') return { x: bx + 30, z: clamp(bz + range(rng, -24, 24), -176, 176) };
  return { x: bx - 30, z: clamp(bz + range(rng, -24, 24), -176, 176) };
}

function nearestRoadPoint(x, z) {
  let best = null;
  let bestD = 1e9;
  for (const rx of ROAD_LINES) {
    for (const rz of ROAD_LINES) {
      const d = Math.hypot(x - rx, z - rz);
      if (d < bestD) { bestD = d; best = { x: rx, z: rz }; }
    }
  }
  return best;
}

// ------------------------------------------------------------- entities ---

function makeRoute(rng, bx, bz, ccw) {
  const x1 = bx - 36, x2 = bx + 36, z1 = bz - 36, z2 = bz + 36;
  // Right-hand lanes: heading east -> z+4, south -> x-4, west -> z-4,
  // north -> x+4. Clockwise (north edge eastbound first):
  let pts = [
    { x: x2, z: z1 + 4 },
    { x: x2 - 4, z: z2 },
    { x: x1, z: z2 - 4 },
    { x: x1 + 4, z: z1 },
  ];
  if (ccw) {
    pts = [
      { x: x1, z: z1 - 4 },
      { x: x1 + 4, z: z2 },
      { x: x2, z: z2 + 4 },
      { x: x2 - 4, z: z1 },
    ];
  }
  return pts;
}

function makeCar(world, id, cls, kind) {
  const rng = world.rng;
  const bx = pick(rng, BLOCK_CENTRES);
  const bz = pick(rng, BLOCK_CENTRES);
  const route = makeRoute(rng, bx, bz, rng() < 0.5);
  // Spawn ON the waypoint the car actually targets: a car that starts at
  // waypoint 2 while targeting waypoint 0 would cut diagonally across the
  // block instead of following the road. Jitter a little so two cars that
  // share a waypoint do not spawn exactly on top of each other.
  const startIdx = int(rng, 0, 3);
  const start = route[startIdx];
  const colors = {
    compact: [0xd8d8d8, 0x3a6fd8, 0xd84a4a, 0x3aa655],
    sedan: [0x222226, 0x8a8f98, 0x7a4fd0, 0xd8b13a],
    sport: [0xff2e4d, 0xffd23e, 0x2effc8, 0xff7a1a],
    truck: [0x5a6b7a, 0x9a7a3a, 0x4a5a6b, 0x8a8a8a],
    taxi: [0xffc400],
    police: [0xf2f2f2],
  };
  const palette = colors[cls] || colors.sedan;
  return {
    id, kind, cls,
    x: start.x + range(rng, -2, 2), z: start.z + range(rng, -2, 2),
    angle: 0, speed: 0,
    targetSpeed: cls === 'truck' ? 9 : cls === 'sport' ? 16 : cls === 'compact' ? 11 : 13,
    color: palette[Math.floor(rng() * palette.length)],
    hp: CFG.carHealth,
    wreck: false,
    driver: kind === 'traffic',
    route, wp: startIdx,
    mode: 'route',
    brake: false,
    ramAt: -10,
    stuckAt: 0,
    idleAt: 0,
  };
}

function makePed(world, id) {
  const rng = world.rng;
  const p = sidewalkPoint(rng);
  const bx = pick(rng, BLOCK_CENTRES);
  const bz = pick(rng, BLOCK_CENTRES);
  return {
    id,
    x: p.x, z: p.z,
    angle: range(rng, 0, TAU),
    speed: range(rng, 1.1, 2.0),
    state: 'walk',
    stateT: 0,
    color: pick(rng, [0xff5a5a, 0x5aff8a, 0x5aa8ff, 0xffe14d, 0xff8ad8, 0x8a5aff, 0xffffff, 0x3a3a3a]),
    route: makeRoute(rng, bx, bz, rng() < 0.5),
    wp: 0,
    fleeX: 0, fleeZ: 0,
  };
}

// ------------------------------------------------------------- creation ---

export function createWorld(seed = CFG.seed) {
  const rng = makeRng(seed);
  const world = {
    seed,
    rng,
    time: 0,
    tick: 0,
    city: buildCity(rng),
    player: {
      x: -160, z: -36, angle: 0, camYaw: -Math.PI / 2, camPitch: -0.12,
      onFoot: true, carId: -1,
      health: CFG.playerHealth, cash: 0,
      speed: 0, lastDamageAt: -100, bustedHold: 0,
    },
    cars: [],
    peds: [],
    wanted: { heat: 0, stars: 0, lastCrimeAt: -100, escapedAt: -100 },
    mission: { index: 0, storyDone: false },
    taxi: { phase: 'idle', passengerId: -1, dest: null, waitAt: 0 },
    pickups: [],
    stats: { earned: 0, stolen: 0, escaped: 0, fares: 0, topSpeed: 0, distance: 0, wrecks: 0 },
    events: [],
    lastShot: null,
    shake: 0,
    savedAt: 0,
  };
  const classes = ['compact', 'sedan', 'sport', 'truck'];
  for (let i = 0; i < CFG.trafficCount; i++) {
    world.cars.push(makeCar(world, i, classes[i % classes.length], 'traffic'));
  }
  // The taxi is a traffic car with a yellow coat and a job to do.
  const taxi = makeCar(world, CFG.trafficCount, 'taxi', 'taxi');
  world.cars.push(taxi);
  world.taxi.carId = taxi.id;
  for (let i = 0; i < CFG.parkedCount; i++) {
    const car = makeCar(world, CFG.trafficCount + 1 + i, classes[(i + 1) % classes.length], 'parked');
    car.mode = 'parked';
    car.driver = false;
    car.targetSpeed = 0;
    const lot = pick(rng, [{ x: 144, z: -144 }, { x: -144, z: 144 }, { x: 72, z: 144 }]);
    car.x = lot.x + range(rng, -18, 18);
    car.z = lot.z + range(rng, -18, 18);
    car.angle = pick(rng, [0, Math.PI / 2, Math.PI, -Math.PI / 2]);
    world.cars.push(car);
  }
  for (let i = 0; i < CFG.pedCount; i++) world.peds.push(makePed(world, i));
  for (let i = 0; i < 8; i++) {
    const p = sidewalkPoint(rng);
    world.pickups.push({ id: i, kind: 'cash', x: p.x, z: p.z, taken: false, respawnAt: 0 });
  }
  for (let i = 0; i < 6; i++) {
    const p = sidewalkPoint(rng);
    world.pickups.push({ id: 8 + i, kind: 'health', x: p.x, z: p.z, taken: false, respawnAt: 0 });
  }
  return world;
}

// ------------------------------------------------------------ collision ---

function collideBuildings(world, x, z, r) {
  for (const b of world.city.buildings) {
    const hx = b.w / 2 + r;
    const hz = b.d / 2 + r;
    const dx = x - b.x;
    const dz = z - b.z;
    if (Math.abs(dx) < hx && Math.abs(dz) < hz) {
      const px = hx - Math.abs(dx);
      const pz = hz - Math.abs(dz);
      if (px < pz) x = b.x + (dx > 0 ? hx : -hx);
      else z = b.z + (dz > 0 ? hz : -hz);
    }
  }
  return { x, z };
}

function segmentHitsBox(ox, oy, oz, dx, dy, dz, b) {
  // Slab test against a building AABB (y from 0 to h).
  let tmin = 0;
  let tmax = 1e9;
  const mins = [b.x - b.w / 2, 0, b.z - b.d / 2];
  const maxs = [b.x + b.w / 2, b.h, b.z + b.d / 2];
  const o = [ox, oy, oz];
  const d = [dx, dy, dz];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < mins[i] || o[i] > maxs[i]) return -1;
    } else {
      let t1 = (mins[i] - o[i]) / d[i];
      let t2 = (maxs[i] - o[i]) / d[i];
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return -1;
    }
  }
  return tmin;
}

function rayHitsSphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = cx - ox, ly = cy - oy, lz = cz - oz;
  const t = lx * dx + ly * dy + lz * dz;
  if (t < 0) return -1;
  const d2 = lx * lx + ly * ly + lz * lz - t * t;
  if (d2 > r * r) return -1;
  return t - Math.sqrt(r * r - d2);
}

// -------------------------------------------------------------- helpers ---

export function missionBeacon(world) {
  if (world.mission.storyDone) return null;
  if (world.taxi.phase === 'toPassenger' || world.taxi.phase === 'toDest') {
    // The taxi job borrows the beacon while it runs.
    return world.taxi.dest;
  }
  return { x: CFG.missions[world.mission.index].beacon[0], z: CFG.missions[world.mission.index].beacon[1] };
}

export function missionText(world) {
  if (world.mission.storyDone) {
    return { title: 'Bebas — Neon Bay', brief: 'Cerita selesai. Jelajahi kota, cari uang, dan hindari polisi.', pay: 0, distance: 0 };
  }
  const m = CFG.missions[world.mission.index];
  const p = world.player;
  return { title: m.title, brief: m.brief, pay: m.pay, distance: Math.hypot(p.x - m.beacon[0], p.z - m.beacon[1]) };
}

function pushEvent(world, type, data) {
  if (world.events.length > 32) world.events.shift();
  world.events.push({ type, ...data });
}

function policeCount(world) {
  return world.cars.filter((c) => c.kind === 'police' && !c.wreck).length;
}

function spawnPolice(world) {
  const p = world.player;
  const back = nearestRoadPoint(p.x - Math.cos(p.angle) * 60, p.z - Math.sin(p.angle) * 60);
  const id = world.cars.length ? Math.max(...world.cars.map((c) => c.id)) + 1 : 0;
  const car = {
    id, kind: 'police', cls: 'police',
    x: back.x + range(world.rng, -6, 6), z: back.z + range(world.rng, -6, 6),
    angle: 0, speed: 0, targetSpeed: CFG.carClasses.police.top,
    color: 0xf2f2f2, hp: CFG.carHealth, wreck: false, driver: true,
    route: [], wp: 0, mode: 'chase', brake: false, ramAt: -10, stuckAt: 0, idleAt: 0,
  };
  world.cars.push(car);
  return car;
}

function despawnPolice(world, car) {
  const i = world.cars.indexOf(car);
  if (i >= 0) world.cars.splice(i, 1);
}

function respawnPlayer(world, fine, why) {
  const p = world.player;
  p.cash = Math.max(0, p.cash - fine);
  p.x = 0; p.z = 172;
  p.angle = -Math.PI / 2;
  p.camYaw = -Math.PI;
  p.health = CFG.playerHealth;
  p.onFoot = true;
  p.carId = -1;
  p.speed = 0;
  p.bustedHold = 0;
  world.wanted.heat = 0;
  world.wanted.stars = 0;
  // The police stand down; mission progress is kept.
  for (const c of [...world.cars]) {
    if (c.kind === 'police') despawnPolice(world, c);
    if (c.mode === 'roadblock') { c.mode = 'route'; c.targetSpeed = 12; }
  }
  world.taxi.phase = 'idle';
  world.taxi.passengerId = -1;
  pushEvent(world, why, { fine });
}

function completeMission(world) {
  const m = CFG.missions[world.mission.index];
  world.player.cash += m.pay;
  world.stats.earned += m.pay;
  pushEvent(world, 'mission', { title: m.title, pay: m.pay });
  world.mission.index++;
  if (world.mission.index >= CFG.missions.length) {
    world.mission.storyDone = true;
    world.mission.index = CFG.missions.length - 1;
    pushEvent(world, 'story', {});
  } else if (world.mission.index === 1) {
    world.wanted.heat = CFG.missions[1].startHeat;
    world.wanted.lastCrimeAt = world.time; // 5 s grace before the heat decays
  } else if (world.mission.index === 2) {
    world.wanted.heat = 0;
  }
}

// ------------------------------------------------------------- stepping ---

function stepPlayer(world, input, dt) {
  const p = world.player;
  const k = input.keys;
  let mx = 0;
  let mz = 0;
  // Forward is away from the camera: (-sin(camYaw), -cos(camYaw)).
  // Right is (cos(camYaw), -sin(camYaw)).
  if (k.up) { mx -= Math.sin(p.camYaw); mz -= Math.cos(p.camYaw); }
  if (k.down) { mx += Math.sin(p.camYaw); mz += Math.cos(p.camYaw); }
  if (k.left) { mx += Math.sin(p.camYaw - Math.PI / 2); mz += Math.cos(p.camYaw - Math.PI / 2); }
  if (k.right) { mx += Math.sin(p.camYaw + Math.PI / 2); mz += Math.cos(p.camYaw + Math.PI / 2); }
  const len = Math.hypot(mx, mz);
  if (len > 0.01) {
    mx /= len; mz /= len;
    const speed = k.run ? CFG.runSpeed : CFG.walkSpeed;
    p.x += mx * speed * dt;
    p.z += mz * speed * dt;
    p.speed = speed;
    const target = Math.atan2(mz, mx);
    p.angle = turnToward(p.angle, target, 10 * dt);
    world.stats.distance += speed * dt;
  } else {
    p.speed = 0;
  }
  const fixed = collideBuildings(world, p.x, p.z, CFG.playerRadius);
  p.x = clamp(fixed.x, CFG.boundXMin, CFG.boundXMax);
  p.z = clamp(fixed.z, CFG.boundZMin, CFG.boundZMax);
  // Health regen after a quiet spell.
  if (world.time - p.lastDamageAt > CFG.healthRegenDelay && p.health < CFG.playerHealth) {
    p.health = Math.min(CFG.playerHealth, p.health + CFG.healthRegen * dt);
  }
}

function stepPlayerCar(world, input, dt) {
  const p = world.player;
  const car = world.cars.find((c) => c.id === p.carId);
  if (!car) { p.onFoot = true; p.carId = -1; return; }
  const cls = CFG.carClasses[car.cls];
  const k = input.keys;
  let throttle = 0;
  if (k.up) throttle = 1;
  if (k.down) throttle = -0.7;
  let steer = 0;
  if (k.left) steer = 1;
  if (k.right) steer = -1;
  // Steering fades at speed so the car stays controllable.
  const steerAuthority = clamp(1 - Math.abs(car.speed) / (cls.top * 1.6), 0.35, 1);
  const dir = car.speed >= 0 ? 1 : -1;
  car.angle += steer * cls.turn * steerAuthority * dir * dt;
  if (throttle > 0) car.speed += cls.accel * dt;
  else if (throttle < 0) car.speed += cls.brake * throttle * dt;
  else car.speed *= Math.pow(0.4, dt);
  if (car.speed > cls.top) car.speed = cls.top;
  if (car.speed < -cls.top * 0.4) car.speed = -cls.top * 0.4;
  car.x += Math.cos(car.angle) * car.speed * dt;
  car.z += Math.sin(car.angle) * car.speed * dt;
  const fixed = collideBuildings(world, car.x, car.z, 1.6);
  if (fixed.x !== car.x || fixed.z !== car.z) {
    if (Math.abs(car.speed) > 10) pushEvent(world, 'crash', { speed: Math.abs(car.speed) });
    car.speed *= 0.6;
    car.x = fixed.x; car.z = fixed.z;
  }
  car.x = clamp(car.x, CFG.boundXMin, CFG.boundXMax);
  car.z = clamp(car.z, CFG.boundZMin, CFG.boundZMax);
  p.x = car.x; p.z = car.z;
  p.angle = car.angle;
  p.speed = Math.abs(car.speed);
  if (Math.abs(car.speed) > world.stats.topSpeed) world.stats.topSpeed = Math.abs(car.speed);
  world.stats.distance += Math.abs(car.speed) * dt;
}

function carAhead(world, car, maxDist) {
  const fx = Math.cos(car.angle);
  const fz = Math.sin(car.angle);
  let best = null;
  let bestD = maxDist;
  for (const o of world.cars) {
    if (o === car || o.wreck) continue;
    const dx = o.x - car.x;
    const dz = o.z - car.z;
    const d = Math.hypot(dx, dz);
    if (d > maxDist || d < 0.5) continue;
    const along = (dx * fx + dz * fz) / d;
    const side = Math.abs(-dx * fz + dz * fx);
    if (along > 0.85 && side < 3 && d < bestD) { best = o; bestD = d; }
  }
  return best ? { car: best, dist: bestD } : null;
}

function stepTrafficCar(world, car, dt) {
  if (car.wreck || car.mode !== 'route') return;
  const target = car.route[car.wp];
  if (!target) return;
  const dx = target.x - car.x;
  const dz = target.z - car.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 7) {
    car.wp = (car.wp + 1) % car.route.length;
    return;
  }
  const want = Math.atan2(dz, dx);
  car.angle = turnToward(car.angle, want, 2.6 * dt);
  // Brake for the car ahead, otherwise cruise. Slow for the corner so a
  // fast car never overshoots the 16 m road band.
  const ahead = carAhead(world, car, 16);
  let goal = car.targetSpeed;
  if (dist < 18) goal = Math.min(goal, 9);
  if (ahead) {
    goal = Math.min(goal, ahead.car.speed);
    if (ahead.dist < 7) goal = 0;
  }
  const cls = CFG.carClasses[car.cls];
  if (car.speed < goal) car.speed = Math.min(goal, car.speed + cls.accel * 0.7 * dt);
  else if (car.speed > goal) car.speed = Math.max(goal, car.speed - cls.brake * dt);
  car.x += Math.cos(car.angle) * car.speed * dt;
  car.z += Math.sin(car.angle) * car.speed * dt;
  car.x = clamp(car.x, CFG.boundXMin, CFG.boundXMax);
  car.z = clamp(car.z, CFG.boundZMin, CFG.boundZMax);
}

function stepPoliceCar(world, car, dt) {
  if (car.wreck) return;
  const p = world.player;
  // Road-aware chase: if a building blocks the straight line, aim for the
  // road intersection nearest the player instead.
  let tx = p.x;
  let tz = p.z;
  const dx = p.x - car.x;
  const dz = p.z - car.z;
  const dist = Math.hypot(dx, dz);
  let blocked = false;
  for (const b of world.city.buildings) {
    if (Math.abs(b.x - (car.x + p.x) / 2) > 120 || Math.abs(b.z - (car.z + p.z) / 2) > 120) continue;
    const t = segmentHitsBox(car.x, 1, car.z, dx, 0, dz, b);
    if (t >= 0 && t <= dist) { blocked = true; break; }
  }
  if (blocked) {
    const near = nearestRoadPoint(p.x, p.z);
    tx = near.x; tz = near.z;
  }
  const want = Math.atan2(tz - car.z, tx - car.x);
  car.angle = turnToward(car.angle, want, 2.8 * dt);
  const cls = CFG.carClasses.police;
  let goal = Math.min(cls.top, Math.max(14, Math.abs(p.speed) + 5));
  // A cop must be able to HOLD an on-foot (or crawling) player: creep in
  // and stop next to them instead of orbiting at 14 m/s, or the busted
  // timer can never fill.
  if ((p.onFoot || p.speed < 3) && dist < 12) goal = Math.min(goal, 4);
  if ((p.onFoot || p.speed < 3) && dist < 5) goal = 0;
  if (car.speed < goal) car.speed = Math.min(goal, car.speed + cls.accel * dt);
  else car.speed = Math.max(goal, car.speed - cls.brake * dt);
  car.x += Math.cos(car.angle) * car.speed * dt;
  car.z += Math.sin(car.angle) * car.speed * dt;
  const fixed = collideBuildings(world, car.x, car.z, 1.6);
  car.x = clamp(fixed.x, CFG.boundXMin, CFG.boundXMax);
  car.z = clamp(fixed.z, CFG.boundZMin, CFG.boundZMax);
  // Ram the player when close.
  if (dist < 5 && world.time - car.ramAt > CFG.ramCooldown) {
    car.ramAt = world.time;
    damagePlayer(world, CFG.ramDamage);
    pushEvent(world, 'ram', {});
    if (!p.onFoot) {
      const pc = world.cars.find((c) => c.id === p.carId);
      if (pc) pc.speed *= 0.7;
    }
  }
  // Stuck against a wall: respawn on a road behind the player.
  if (car.speed < 1 && dist > 20) {
    car.stuckAt += dt;
    if (car.stuckAt > 3) {
      const back = nearestRoadPoint(p.x - Math.cos(p.angle) * 55, p.z - Math.sin(p.angle) * 55);
      car.x = back.x; car.z = back.z;
      car.angle = Math.atan2(p.z - back.z, p.x - back.x);
      car.speed = 10;
      car.stuckAt = 0;
    }
  } else {
    car.stuckAt = 0;
  }
}

function damagePlayer(world, amount) {
  const p = world.player;
  p.health -= amount;
  p.lastDamageAt = world.time;
  if (p.health <= 0) {
    p.health = 0;
    respawnPlayer(world, CFG.wastedFine, 'wasted');
  }
}

function stepPeds(world, dt) {
  for (const ped of world.peds) {
    if (ped.state === 'fallen') {
      ped.stateT -= dt;
      if (ped.stateT <= 0) {
        // Get up far away: respawn on a fresh sidewalk point.
        const spot = sidewalkPoint(world.rng);
        ped.x = spot.x; ped.z = spot.z;
        ped.state = 'walk';
        ped.stateT = 0;
      }
      continue;
    }
    if (ped.state === 'flee') {
      ped.stateT -= dt;
      ped.x += Math.cos(ped.angle) * 4 * dt;
      ped.z += Math.sin(ped.angle) * 4 * dt;
      const fixed = collideBuildings(world, ped.x, ped.z, 0.5);
      ped.x = clamp(fixed.x, CFG.boundXMin, CFG.boundXMax);
      ped.z = clamp(fixed.z, CFG.boundZMin, CFG.boundZMax);
      if (ped.stateT <= 0) ped.state = 'walk';
      continue;
    }
    const target = ped.route[ped.wp];
    if (!target) continue;
    const dx = target.x - ped.x;
    const dz = target.z - ped.z;
    if (Math.hypot(dx, dz) < 4) {
      ped.wp = (ped.wp + 1) % ped.route.length;
      continue;
    }
    const want = Math.atan2(dz, dx);
    ped.angle = turnToward(ped.angle, want, 3 * dt);
    ped.x += Math.cos(ped.angle) * ped.speed * dt;
    ped.z += Math.sin(ped.angle) * ped.speed * dt;
    // A car bearing down scares a pedestrian off the road.
    for (const car of world.cars) {
      if (car.wreck || car.speed < 3) continue;
      const d = Math.hypot(car.x - ped.x, car.z - ped.z);
      if (d < 6) {
        ped.state = 'flee';
        ped.stateT = 3;
        ped.angle = Math.atan2(ped.z - car.z, ped.x - car.x);
        break;
      }
    }
  }
}

function stepWanted(world, dt) {
  const w = world.wanted;
  const prevStars = w.stars;
  if (world.time - w.lastCrimeAt > CFG.heatDecayDelay && w.heat > 0) {
    w.heat = Math.max(0, w.heat - CFG.heatDecay * dt);
  }
  w.stars = Math.min(5, Math.floor(w.heat / CFG.heatPerStar));
  if (prevStars >= 1 && w.stars === 0 && world.time - w.escapedAt > 30) {
    w.escapedAt = world.time;
    world.stats.escaped++;
    pushEvent(world, 'escaped', {});
  }
  // Keep the police count matched to the stars.
  const want = w.stars;
  let have = policeCount(world);
  while (have < want) {
    spawnPolice(world);
    have++;
  }
  // Extra police leave once the heat is gone; roadblocks clear below 4.
  if (w.stars === 0) {
    for (const c of [...world.cars]) {
      if (c.kind === 'police') {
        const d = Math.hypot(c.x - world.player.x, c.z - world.player.z);
        if (d > 120) despawnPolice(world, c);
        else { c.mode = 'leave'; }
      }
    }
  }
  if (w.stars >= 4) {
    const blocks = world.cars.filter((c) => c.mode === 'roadblock' && !c.wreck);
    if (blocks.length === 0) {
      const p = world.player;
      const ahead = { x: p.x + Math.cos(p.angle) * 60, z: p.z + Math.sin(p.angle) * 60 };
      const near = nearestRoadPoint(ahead.x, ahead.z);
      for (let i = 0; i < 2; i++) {
        const car = spawnPolice(world);
        car.mode = 'roadblock';
        car.x = near.x + (i === 0 ? -5 : 5);
        car.z = near.z + (i === 0 ? 4 : -4);
        car.angle = Math.atan2(1, 0) + (i === 0 ? 0.3 : -0.3);
        car.speed = 0;
        car.targetSpeed = 0;
      }
      pushEvent(world, 'roadblock', {});
    }
  } else {
    for (const c of world.cars) {
      if (c.mode === 'roadblock') { c.mode = 'chase'; c.targetSpeed = CFG.carClasses.police.top; }
    }
  }
  // Leaving police drive off and despawn at range.
  for (const c of [...world.cars]) {
    if (c.mode === 'leave') {
      const away = Math.atan2(c.z - world.player.z, c.x - world.player.x);
      c.angle = turnToward(c.angle, away, 2 * dt);
      c.speed = Math.min(20, c.speed + 8 * dt);
      c.x += Math.cos(c.angle) * c.speed * dt;
      c.z += Math.sin(c.angle) * c.speed * dt;
      if (Math.hypot(c.x - world.player.x, c.z - world.player.z) > 150) despawnPolice(world, c);
    }
  }
  // Busted: a cop holds the player still while wanted.
  if (w.stars > 0) {
    const p = world.player;
    let held = false;
    for (const c of world.cars) {
      if (c.kind !== 'police' || c.wreck || c.mode === 'roadblock') continue;
      const d = Math.hypot(c.x - p.x, c.z - p.z);
      if (d < 7 && (p.onFoot || p.speed < 2)) { held = true; break; }
    }
    if (held) {
      p.bustedHold += dt;
      if (p.bustedHold >= CFG.bustedHold) respawnPlayer(world, CFG.bustedFine, 'busted');
    } else {
      p.bustedHold = Math.max(0, p.bustedHold - dt * 2);
    }
  }
}

function stepMissions(world) {
  if (world.mission.storyDone) return;
  const m = CFG.missions[world.mission.index];
  const p = world.player;
  if (Math.hypot(p.x - m.beacon[0], p.z - m.beacon[1]) < CFG.beaconRadius) {
    completeMission(world);
  }
}

function stepTaxi(world, dt) {
  const t = world.taxi;
  const taxiCar = world.cars.find((c) => c.id === t.carId);
  if (!taxiCar || taxiCar.wreck) {
    if (t.phase !== 'idle') { t.phase = 'idle'; t.passengerId = -1; }
    return;
  }
  const p = world.player;
  const inTaxi = !p.onFoot && p.carId === taxiCar.id;
  if (t.phase === 'idle') {
    if (inTaxi) {
      // A passenger waves from a nearby sidewalk.
      const spot = sidewalkPoint(world.rng);
      const ped = {
        id: 1000 + Math.floor(world.time),
        x: spot.x, z: spot.z, angle: 0, speed: 0, state: 'wait', stateT: 0,
        color: 0xffe14d, route: [], wp: 0, fleeX: 0, fleeZ: 0,
      };
      world.peds.push(ped);
      t.passengerId = ped.id;
      t.dest = { x: spot.x, z: spot.z };
      t.phase = 'toPassenger';
      pushEvent(world, 'taxi', { text: 'Penumpang menunggu — jemput dia!' });
    }
    return;
  }
  if (t.phase === 'toPassenger') {
    const ped = world.peds.find((q) => q.id === t.passengerId);
    if (!ped) { t.phase = 'idle'; return; }
    if (!inTaxi) return;
    if (Math.hypot(p.x - ped.x, p.z - ped.z) < 6) {
      world.peds.splice(world.peds.indexOf(ped), 1);
      const dest = nearestRoadPoint(
        p.x + range(world.rng, -160, 160),
        p.z + range(world.rng, -160, 160),
      );
      t.dest = { x: clamp(dest.x, -170, 170), z: clamp(dest.z, -170, 170) };
      t.phase = 'toDest';
      t.fareBase = Math.hypot(t.dest.x - p.x, t.dest.z - p.z);
      pushEvent(world, 'taxi', { text: 'Penumpang naik! Antar ke tujuan.' });
    }
    return;
  }
  if (t.phase === 'toDest') {
    if (!inTaxi) {
      t.phase = 'idle';
      t.passengerId = -1;
      pushEvent(world, 'taxi', { text: 'Penumpang kabur. Cari penumpang lain.' });
      return;
    }
    if (Math.hypot(p.x - t.dest.x, p.z - t.dest.z) < CFG.beaconRadius) {
      const fare = Math.round((CFG.taxiBaseFare + (t.fareBase || 100) * CFG.taxiPerMetre) / 10) * 10;
      p.cash += fare;
      world.stats.fares++;
      pushEvent(world, 'fare', { fare });
      t.phase = 'cooldown';
      t.waitAt = world.time + 8;
    }
    return;
  }
  if (t.phase === 'cooldown' && world.time >= t.waitAt) {
    t.phase = 'idle';
  }
}

function stepPickups(world, dt) {
  const p = world.player;
  for (const pk of world.pickups) {
    if (pk.taken) {
      if (world.time >= pk.respawnAt) pk.taken = false;
      continue;
    }
    if (Math.hypot(p.x - pk.x, p.z - pk.z) < CFG.pickupRadius) {
      pk.taken = true;
      pk.respawnAt = world.time + CFG.pickupRespawn;
      if (pk.kind === 'cash') {
        p.cash += CFG.cashPickupValue;
        pushEvent(world, 'pickup', { kind: 'cash', value: CFG.cashPickupValue });
      } else {
        p.health = Math.min(CFG.playerHealth, p.health + CFG.healthPickupValue);
        pushEvent(world, 'pickup', { kind: 'health', value: CFG.healthPickupValue });
      }
    }
  }
}

function stepShoot(world, shot) {
  if (!shot) return;
  const { ox, oy, oz, dx, dy, dz } = shot;
  const range = CFG.pistolRange;
  let bestT = range;
  let best = null;
  // Buildings block the shot.
  for (const b of world.city.buildings) {
    const t = segmentHitsBox(ox, oy, oz, dx, dy, dz, b);
    if (t >= 0 && t < bestT) { bestT = t; best = { kind: 'wall' }; }
  }
  // Peds.
  for (const ped of world.peds) {
    if (ped.state === 'fallen') continue;
    const t = rayHitsSphere(ox, oy, oz, dx, dy, dz, ped.x, 1.0, ped.z, 0.9);
    if (t >= 0 && t < bestT) { bestT = t; best = { kind: 'ped', ped }; }
  }
  // Cars.
  for (const car of world.cars) {
    if (car.wreck) continue;
    const t = rayHitsSphere(ox, oy, oz, dx, dy, dz, car.x, 1.0, car.z, 2.4);
    if (t >= 0 && t < bestT) { bestT = t; best = { kind: 'car', car }; }
  }
  const hx = ox + dx * bestT;
  const hy = oy + dy * bestT;
  const hz = oz + dz * bestT;
  world.lastShot = { from: [ox, oy, oz], to: [hx, hy, hz], hit: best ? best.kind : 'none', at: world.time };
  world.shake = Math.min(1, world.shake + 0.5);
  world.wanted.heat = Math.min(CFG.heatMax, world.wanted.heat + CFG.shotHeat);
  world.wanted.lastCrimeAt = world.time;
  if (best && best.kind === 'ped') {
    best.ped.state = 'fallen';
    best.ped.stateT = 12;
    world.wanted.heat = Math.min(CFG.heatMax, world.wanted.heat + CFG.pedShotHeat);
    pushEvent(world, 'shot', { hit: 'ped' });
  } else if (best && best.kind === 'car') {
    const car = best.car;
    car.hp -= CFG.pistolDamage;
    if (car.hp <= 0 && !car.wreck) {
      car.wreck = true;
      car.speed = 0;
      world.stats.wrecks++;
      world.wanted.heat = Math.min(CFG.heatMax, world.wanted.heat + CFG.wreckHeat);
      pushEvent(world, 'wreck', { kind: car.kind });
      // The driver bails out of a wrecked traffic car.
      if (car.driver) {
        car.driver = false;
        const ped = makePed(world, 2000 + car.id);
        ped.x = car.x + 3; ped.z = car.z + 3;
        ped.state = 'flee'; ped.stateT = 4;
        ped.angle = Math.atan2(ped.z - car.z, ped.x - car.x);
        world.peds.push(ped);
      }
    }
    pushEvent(world, 'shot', { hit: 'car' });
  } else {
    pushEvent(world, 'shot', { hit: best ? 'wall' : 'none' });
  }
  // Nearby pedestrians scatter at the sound.
  for (const ped of world.peds) {
    if (ped.state === 'fallen') continue;
    if (Math.hypot(ped.x - ox, ped.z - oz) < 25) {
      ped.state = 'flee';
      ped.stateT = 4;
      ped.angle = Math.atan2(ped.z - oz, ped.x - ox);
    }
  }
}

function trySteal(world) {
  const p = world.player;
  if (!p.onFoot) {
    // Exit the car.
    const car = world.cars.find((c) => c.id === p.carId);
    if (car) {
      car.mode = 'parked';
      car.speed = 0;
      car.targetSpeed = 0;
      car.idleAt = world.time;
      p.x = car.x - Math.sin(car.angle) * 3;
      p.z = car.z + Math.cos(car.angle) * 3;
      const fixed = collideBuildings(world, p.x, p.z, CFG.playerRadius);
      p.x = fixed.x; p.z = fixed.z;
    }
    p.onFoot = true;
    p.carId = -1;
    p.speed = 0;
    return;
  }
  let best = null;
  let bestD = 4.5;
  for (const car of world.cars) {
    if (car.wreck) continue;
    const d = Math.hypot(car.x - p.x, car.z - p.z);
    if (d < bestD) { best = car; bestD = d; }
  }
  if (!best) return;
  if (best.driver) {
    // Pull the driver out; they flee on foot.
    best.driver = false;
    const ped = makePed(world, 3000 + best.id);
    ped.x = best.x - Math.sin(best.angle) * 3;
    ped.z = best.z + Math.cos(best.angle) * 3;
    ped.state = 'flee'; ped.stateT = 5;
    ped.angle = Math.atan2(ped.z - best.z, ped.x - best.x);
    world.peds.push(ped);
    world.stats.stolen++;
    world.wanted.heat = Math.min(CFG.heatMax, world.wanted.heat + CFG.stealHeat);
    world.wanted.lastCrimeAt = world.time;
    pushEvent(world, 'steal', { kind: best.cls });
  }
  best.mode = 'player';
  p.onFoot = false;
  p.carId = best.id;
  p.angle = best.angle;
  pushEvent(world, 'enter', { kind: best.cls });
}

// --------------------------------------------------------------- main ---

// One fixed simulation step. `input` carries the keys, the edge-triggered
// actions (consumed here, so a slow frame can never fire one twice), the
// mouse-look delta and, when the player fired, the shot ray from the camera.
export function stepWorld(world, input, dt = CFG.step) {
  world.time += dt;
  world.tick++;
  // Camera orbit from mouse drag: consumed once per step, whichever branch runs.
  const p0 = world.player;
  p0.camYaw += (input.look.dx || 0) * 0.004;
  p0.camPitch = clamp(p0.camPitch + (input.look.dy || 0) * 0.003, -0.5, 0.45);
  input.look.dx = 0;
  input.look.dy = 0;
  const a = input.actions || {};
  if (a.steal) { a.steal = false; trySteal(world); }
  if (a.fire) {
    a.fire = false;
    if (world.time - (world.lastFireAt || -10) >= CFG.pistolCooldown) {
      world.lastFireAt = world.time;
      stepShoot(world, input.shotRay || null);
    }
  }
  if (world.player.onFoot) stepPlayer(world, input, dt);
  else stepPlayerCar(world, input, dt);
  for (const car of world.cars) {
    if (car.mode === 'route') stepTrafficCar(world, car, dt);
    else if (car.mode === 'chase') stepPoliceCar(world, car, dt);
    else if (car.mode === 'parked' && world.time - car.idleAt > 40) {
      // An abandoned car rejoins traffic once the player is far away.
      const d = Math.hypot(car.x - world.player.x, car.z - world.player.z);
      if (d > 45 && car.kind !== 'parked') {
        car.mode = 'route';
        car.targetSpeed = 12;
      }
    }
  }
  // Pairwise separation: two cars crossing at an intersection must never
  // overlap. Cheap O(n^2) push-apart for ~30 cars, run every step.
  const movers = world.cars.filter((c) => !c.wreck && c.mode !== 'player');
  for (let i = 0; i < movers.length; i++) {
    for (let j = i + 1; j < movers.length; j++) {
      const a = movers[i];
      const b = movers[j];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const d = Math.hypot(dx, dz);
      if (d < 3.5) {
        // Two cars exactly on top of each other have no separation axis;
        // push them apart along x by id order instead of dividing by zero.
        const ux = d > 0.01 ? dx / d : (a.id < b.id ? 1 : -1);
        const uz = d > 0.01 ? dz / d : 0;
        const push = (3.5 - d) / 2;
        a.x -= ux * push; a.z -= uz * push;
        b.x += ux * push; b.z += uz * push;
      }
    }
  }
  // Player-car shoving: keep cars from overlapping the player's car.
  const p = world.player;
  if (!p.onFoot) {
    const pc = world.cars.find((c) => c.id === p.carId);
    if (pc) {
      for (const o of world.cars) {
        if (o === pc || o.wreck) continue;
        const dx = o.x - pc.x;
        const dz = o.z - pc.z;
        const d = Math.hypot(dx, dz);
        if (d < 4 && d > 0.01) {
          const push = (4 - d) / 2;
          o.x += (dx / d) * push;
          o.z += (dz / d) * push;
          if (Math.abs(o.speed) > 8 && Math.abs(pc.speed) > 8) {
            o.speed *= 0.5;
            pc.speed *= 0.8;
            pushEvent(world, 'crash', { speed: Math.abs(pc.speed) });
          }
        }
      }
    }
  }
  stepPeds(world, dt);
  stepWanted(world, dt);
  stepMissions(world);
  stepTaxi(world, dt);
  stepPickups(world, dt);
  if (world.shake > 0) world.shake = Math.max(0, world.shake - dt * 3);
}

// ---------------------------------------------------------------- save ---

export function serializeWorld(world) {
  return {
    v: 1,
    cash: world.player.cash,
    health: world.player.health,
    missionIndex: world.mission.storyDone ? CFG.missions.length : world.mission.index,
    missionsDone: world.mission.storyDone,
    fares: world.stats.fares,
    topSpeed: world.stats.topSpeed,
    earned: world.stats.earned,
    x: world.player.x,
    z: world.player.z,
    angle: world.player.angle,
    time: world.time,
  };
}

// Apply a loaded save after strict validation. Returns true when applied,
// false when the data is missing or corrupt (the game then starts fresh).
export function deserializeWorld(world, data) {
  try {
    if (!data || typeof data !== 'object' || data.v !== 1) return false;
    const num = (v) => typeof v === 'number' && Number.isFinite(v);
    if (!num(data.cash) || !num(data.health) || !num(data.missionIndex)) return false;
    if (!num(data.x) || !num(data.z) || !num(data.angle)) return false;
    if (data.missionIndex < 0 || data.missionIndex > CFG.missions.length) return false;
    if (data.cash < 0 || data.cash > 1000000) return false;
    if (data.health <= 0 || data.health > CFG.playerHealth) return false;
    world.player.cash = data.cash;
    world.player.health = data.health;
    world.player.x = clamp(data.x, CFG.boundXMin, CFG.boundXMax);
    world.player.z = clamp(data.z, CFG.boundZMin, CFG.boundZMax);
    world.player.angle = data.angle;
    world.player.camYaw = data.angle - Math.PI / 2;
    if (data.missionIndex >= CFG.missions.length) {
      world.mission.storyDone = true;
      world.mission.index = CFG.missions.length - 1;
    } else {
      world.mission.index = Math.floor(data.missionIndex);
    }
    if (num(data.fares)) world.stats.fares = Math.max(0, data.fares);
    if (num(data.topSpeed)) world.stats.topSpeed = Math.max(0, data.topSpeed);
    if (num(data.earned)) world.stats.earned = Math.max(0, data.earned);
    return true;
  } catch (err) {
    return false;
  }
}

export function saveSummary(data) {
  if (!data) return null;
  const done = data.missionIndex >= CFG.missions.length ? CFG.missions.length : data.missionIndex;
  return `Uang $${Math.floor(data.cash)} · Misi ${done}/${CFG.missions.length} · Taksi ${data.fares || 0}x`;
}
