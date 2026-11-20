// NEON BAY — the simulation. No drawing, no browser in here: the city, the cars,
// the pedestrians, the police, the wanted system, the missions, the taxi job and
// the combat are pure rules over numbers, so the game can be stepped headlessly,
// staged for a screenshot, and replayed from a seed. The renderer only mirrors
// this state.
//
// The city is a 5x5 block grid (see config.js). Roads run on both axes; the beach
// and ocean sit on the east edge. Everything is seeded: one seed, one city.
//
// Bugs the previous draft carried, fixed here:
//   * collideBuildings() never reported a hit, so crashing into a building did
//     no damage and no shake — it now returns whether a push happened.
//   * stepMissions() read m.index AFTER setMission() had already advanced it,
//     so the "you escaped the police" branch on mission 1 could never run — the
//     completed index is now captured before advancing.
//   * Traffic cars spawned with atan2(dz, dx) while movement uses sin/cos the
//     other way round, so every car started 90 degrees off its lane — fixed to
//     atan2(dx, dz).
import {
  BEACH_X, CAR, CAR_CLASSES, CITY_HALF, COMBAT, MISSIONS, OCEAN_X, PED, PICKUPS,
  PLAYER, ROAD, ROAD_LINES, TAXI, WANTED, blockRect, DOWNTOWN,
} from './config.js';
import { clamp, dist2, gauss, lerpAngle, pick, pickWeighted, range, rangeInt } from './random.js';
import { ACTION_ENTER, ACTION_SHOOT } from './input.js';

export const EVENT_SHOT = 1;
export const EVENT_CRASH = 2;
export const EVENT_PICKUP = 4;
export const EVENT_MISSION = 8;
export const EVENT_BUSTED = 16;
export const EVENT_WASTED = 32;
export const EVENT_STAR_UP = 64;
export const EVENT_STAR_DOWN = 128;
export const EVENT_STEAL = 256;
export const EVENT_EXPLOSION = 512;
export const EVENT_FARE = 1024;

// Car paint jobs (hex). The player's car is always the hot pink one.
const PAINTS = [0xffc93c, 0x2ec4ff, 0xff5a3c, 0x9dff3c, 0xe8e8f0, 0x7a5cff, 0x3cffb0, 0xff8a3c];
// Traffic class mix: most cars are sedans, some are fast sports cars, some taxis,
// a rare few are trucks.
const TRAFFIC_CLASSES = ['sedan', 'sedan', 'sedan', 'sport', 'taxi', 'sedan', 'sport', 'taxi', 'truck'];

function circleHitsAABB(x, z, r, b) {
  const cx = clamp(x, b.x0, b.x1);
  const cz = clamp(z, b.z0, b.z1);
  const dx = x - cx;
  const dz = z - cz;
  return dx * dx + dz * dz < r * r;
}

function pushOutOfAABB(p, r, b) {
  const cx = clamp(p.x, b.x0, b.x1);
  const cz = clamp(p.z, b.z0, b.z1);
  let dx = p.x - cx;
  let dz = p.z - cz;
  let d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return false;
  if (d2 < 0.0001) {
    // Centre inside the box: push out along the smallest penetration axis.
    const pl = Math.min(p.x - b.x0, b.x1 - p.x);
    const pt = Math.min(p.z - b.z0, b.z1 - p.z);
    if (pl < pt) p.x = p.x - b.x0 < b.x1 - p.x ? b.x0 - r : b.x1 + r;
    else p.z = p.z - b.z0 < b.z1 - p.z ? b.z0 - r : b.z1 + r;
    return true;
  }
  const d = Math.sqrt(d2);
  const push = (r - d) / d;
  p.x += dx * push;
  p.z += dz * push;
  return true;
}

export function createWorld(random) {
  const state = {
    time: 0,
    seed: 0,
    buildings: [],
    lights: [],
    palms: [],
    player: null,
    cars: [],
    peds: [],
    pickups: [],
    roadblocks: [], // {x, z, angle, life} — police barricades at 4+ stars
    explosions: [], // {x, z, life, max} — pooled by the renderer for particles
    taxi: { active: false, phase: 'idle', passenger: null, dest: null, fare: 0, timer: 0 },
    wanted: { heat: 0, stars: 0, lastCrime: -999, bustedHold: 0 },
    mission: { index: 0, done: false, storyDone: false, text: '', beacon: null },
    message: '',
    messageTimer: 0,
    stats: { earned: 0, stolen: 0, escaped: 0, fares: 0, topSpeed: 0, distance: 0, wrecks: 0 },
    tracer: null, // {x0,y0,z0,x1,y1,z1,life} for the renderer, set on shots
    shake: 0,
    flash: 0,
  };

  // ---------- city generation (seeded, deterministic) ----------
  function generateCity() {
    state.buildings = [];
    state.lights = [];
    state.palms = [];
    const downtown = new Set(DOWNTOWN.map(([a, b]) => `${a},${b}`));
    for (let bx = 0; bx < 5; bx += 1) {
      for (let bz = 0; bz < 5; bz += 1) {
        const rect = blockRect(bx, bz);
        const roll = random();
        const isDowntown = downtown.has(`${bx},${bz}`);
        if (roll < 0.14) {
          // Park: palms + open grass, no buildings.
          const n = 5 + Math.floor(random() * 4);
          for (let i = 0; i < n; i += 1) {
            state.palms.push({ x: range(random, rect.x0 + 4, rect.x1 - 4), z: range(random, rect.z0 + 4, rect.z1 - 4), s: range(random, 0.8, 1.3) });
          }
          continue;
        }
        if (roll < 0.24) {
          // Parking lot: flat, a few palms at the edge.
          state.palms.push({ x: rect.x0 + 3, z: rect.z0 + 3, s: 1 });
          state.palms.push({ x: rect.x1 - 3, z: rect.z1 - 3, s: 1 });
          continue;
        }
        const count = isDowntown ? 2 : 1 + Math.floor(random() * 3);
        const cols = count === 1 ? 1 : 2;
        const rows = Math.ceil(count / cols);
        for (let i = 0; i < count; i += 1) {
          const cx = cols === 1 ? (rect.x0 + rect.x1) / 2 : rect.x0 + ((i % cols) + 0.5) * ((rect.x1 - rect.x0) / cols);
          const cz = rows === 1 ? (rect.z0 + rect.z1) / 2 : rect.z0 + (Math.floor(i / cols) + 0.5) * ((rect.z1 - rect.z0) / rows);
          const w = range(random, 12, (rect.x1 - rect.x0) / cols - 6);
          const d = range(random, 12, (rect.z1 - rect.z0) / rows - 6);
          const h = isDowntown ? range(random, 30, 58) : range(random, 8, 26);
          state.buildings.push({
            x0: cx - w / 2, z0: cz - d / 2, x1: cx + w / 2, z1: cz + d / 2,
            h, color: Math.floor(random() * 8), seed: random(),
            neon: isDowntown && random() < 0.55,
          });
        }
        if (random() < 0.5) {
          state.palms.push({ x: rect.x0 + 3, z: rect.z0 + 3, s: range(random, 0.8, 1.2) });
        }
      }
    }
    // Streetlights along every road, every other intersection, both sides.
    for (const line of ROAD_LINES) {
      for (const other of ROAD_LINES) {
        if ((line + other) % 128 === 0) {
          state.lights.push({ x: line + ROAD / 2 + 1, z: other + ROAD / 2 + 1 });
        }
      }
    }
    // Beach palms along the sand.
    for (let z = -180; z <= 180; z += 22) {
      state.palms.push({ x: BEACH_X + 8 + random() * 14, z: z + range(random, -5, 5), s: range(random, 0.9, 1.4) });
    }
  }

  // ---------- traffic routes ----------
  function makeLoop() {
    // A rectangle loop around 1-2 blocks, on road centre lines, right-hand lanes.
    const bx = 1 + Math.floor(random() * 3);
    const bz = 1 + Math.floor(random() * 3);
    const x0 = ROAD_LINES[bx];
    const x1 = ROAD_LINES[bx + 1 + Math.floor(random() * 2)];
    const z0 = ROAD_LINES[bz];
    const z1 = ROAD_LINES[bz + 1 + Math.floor(random() * 2)];
    const pts = [
      { x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 },
    ];
    if (random() < 0.5) pts.reverse();
    return pts;
  }

  function spawnTrafficCar() {
    const loop = makeLoop();
    const start = loop[Math.floor(random() * loop.length)];
    const cls = pick(random, TRAFFIC_CLASSES);
    const tuning = CAR_CLASSES[cls];
    const car = {
      id: nextCarId++,
      kind: 'traffic',
      cls,
      x: start.x + range(random, -2, 2),
      z: start.z + range(random, -2, 2),
      angle: 0,
      speed: range(random, CAR.trafficSpeed[0], CAR.trafficSpeed[1]),
      targetSpeed: range(random, CAR.trafficSpeed[0], CAR.trafficSpeed[1]),
      color: cls === 'taxi' ? 0xffc93c : pick(random, PAINTS),
      health: 100,
      route: loop,
      wp: 1,
      stopped: 0,
      smoke: 0,
      vx: 0,
      vz: 0,
    };
    // Movement uses x = sin(angle), z = cos(angle): the heading IS atan2(dx, dz).
    car.angle = Math.atan2(loop[1].x - loop[0].x, loop[1].z - loop[0].z);
    car.maxSpeed = tuning.maxSpeed;
    return car;
  }

  function spawnPed(x, z) {
    const angle = Math.floor(random() * 4) * (Math.PI / 2);
    return {
      x: x ?? range(random, -180, 180),
      z: z ?? range(random, -180, 180),
      angle,
      speed: range(random, PED.walkSpeed[0], PED.walkSpeed[1]),
      state: 'walk',
      flee: 0,
      health: COMBAT.pedHealth,
      down: 0,
      shirt: Math.floor(random() * 8),
      skin: pick(random, [0xe8b98a, 0xc98d64, 0x8a5a3b, 0xf0c8a0]),
      bob: random() * Math.PI * 2,
      driver: false, // true only for a car-theft victim: it flees, then leaves
    };
  }

  function spawnPickup(kind) {
    // On a sidewalk: just off a road line.
    const line = pick(random, ROAD_LINES);
    const along = range(random, -180, 180);
    const side = random() < 0.5 ? 1 : -1;
    if (random() < 0.5) return { kind, x: line + side * (ROAD / 2 + 2.5), z: along, active: true, timer: 0 };
    return { kind, x: along, z: line + side * (ROAD / 2 + 2.5), active: true, timer: 0 };
  }

  // ---------- reset ----------
  function reset(seed) {
    state.seed = seed;
    state.time = 0;
    state.player = {
      x: -20, z: 60, angle: Math.PI / 2, camYaw: Math.PI / 2, camPitch: 0.32,
      onFoot: true, carId: -1, health: PLAYER.health, cash: 0,
      speed: 0, vx: 0, vz: 0, invuln: 0, bustedHold: 0,
    };
    state.cars = [];
    for (let i = 0; i < CAR.trafficCount; i += 1) state.cars.push(spawnTrafficCar());
    state.peds = [];
    for (let i = 0; i < PED.count; i += 1) state.peds.push(spawnPed());
    state.pickups = [];
    for (let i = 0; i < PICKUPS.cashCount; i += 1) state.pickups.push(spawnPickup('cash'));
    for (let i = 0; i < PICKUPS.healthCount; i += 1) state.pickups.push(spawnPickup('health'));
    state.roadblocks = [];
    state.explosions = [];
    state.taxi = { active: false, phase: 'idle', passenger: null, dest: null, fare: 0, timer: 0 };
    state.wanted = { heat: 0, stars: 0, lastCrime: -999, bustedHold: 0 };
    setMission(0);
    state.message = '';
    state.messageTimer = 0;
    state.stats = { earned: 0, stolen: 0, escaped: 0, fares: 0, topSpeed: 0, distance: 0, wrecks: 0 };
    state.tracer = null;
    state.shake = 0;
    state.flash = 0;
  }

  function setMission(index) {
    const m = MISSIONS[index];
    state.mission.index = index;
    state.mission.done = false;
    state.mission.beacon = m ? { x: m.beacon.x, z: m.beacon.z } : null;
    state.mission.text = m ? m.brief : '';
    if (m && m.wantedOnStart) {
      state.wanted.heat = m.wantedOnStart * WANTED.starHeat;
      state.wanted.lastCrime = state.time;
    }
  }

  function say(text, seconds = 4) {
    state.message = text;
    state.messageTimer = seconds;
  }

  function addCrime(heat) {
    const before = state.wanted.stars;
    state.wanted.heat = Math.min(WANTED.maxStars * WANTED.starHeat, state.wanted.heat + heat);
    state.wanted.lastCrime = state.time;
    const after = Math.min(WANTED.maxStars, Math.floor(state.wanted.heat / WANTED.starHeat));
    state.wanted.stars = after;
    return after > before ? EVENT_STAR_UP : 0;
  }

  function addExplosion(x, z) {
    state.explosions.push({ x, z, life: 0.9, max: 0.9 });
    state.shake = Math.max(state.shake, 0.8);
    state.flash = Math.max(state.flash, 0.5);
    // Splash damage to anyone standing close.
    const p = state.player;
    if (dist2(p.x, p.z, x, z) < COMBAT.explosionRadius * COMBAT.explosionRadius) {
      p.health = Math.max(0, p.health - COMBAT.explosionDamage * 0.5);
    }
    for (const car of state.cars) {
      if (car.kind === 'police' && car.health > 0 && dist2(car.x, car.z, x, z) < COMBAT.explosionRadius * COMBAT.explosionRadius) {
        car.health = Math.max(0, car.health - COMBAT.explosionDamage);
        if (car.health <= 0) {
          car.smoke = 1;
          state.stats.wrecks += 1;
        }
      }
    }
    return EVENT_EXPLOSION;
  }

  // ---------- helpers ----------
  let nextCarId = 0;
  function carById(id) {
    for (const car of state.cars) if (car.id === id) return car;
    return null;
  }

  /** Pushes p out of every building it overlaps. Returns true if it hit one. */
  function collideBuildings(p, r) {
    let hit = false;
    for (const b of state.buildings) {
      if (p.x > b.x0 - r && p.x < b.x1 + r && p.z > b.z0 - r && p.z < b.z1 + r) {
        if (pushOutOfAABB(p, r, b)) hit = true;
      }
    }
    return hit;
  }

  function nearestCar(x, z, maxDist, kinds) {
    let best = null;
    let bestD = maxDist * maxDist;
    for (const car of state.cars) {
      if (kinds && !kinds.includes(car.kind)) continue;
      const d = dist2(x, z, car.x, car.z);
      if (d < bestD) {
        bestD = d;
        best = car;
      }
    }
    return best;
  }

  // ---------- player on foot ----------
  function stepPlayerOnFoot(dt, input) {
    const p = state.player;
    const speed = input.run ? PLAYER.runSpeed : PLAYER.walkSpeed;
    const sin = Math.sin(p.camYaw);
    const cos = Math.cos(p.camYaw);
    // Camera yaw: forward is -Z rotated by yaw. Move relative to camera.
    let mx = (-sin * input.fwd + -cos * input.strafe);
    let mz = (-cos * input.fwd + sin * input.strafe);
    const len = Math.hypot(mx, mz);
    if (len > 0.01) {
      mx /= len;
      mz /= len;
      p.x += mx * speed * dt;
      p.z += mz * speed * dt;
      p.angle = Math.atan2(mx, mz);
      p.speed = speed;
    } else {
      p.speed = 0;
    }
    p.x = clamp(p.x, -CITY_HALF + 2, OCEAN_X - 4);
    p.z = clamp(p.z, -CITY_HALF + 2, CITY_HALF - 2);
    collideBuildings(p, PLAYER.radius);
    if (p.invuln > 0) p.invuln -= dt;
  }

  // ---------- player driving ----------
  function stepPlayerCar(dt, input) {
    const p = state.player;
    const car = carById(p.carId);
    if (!car) {
      p.onFoot = true;
      p.carId = -1;
      return;
    }
    const tuning = CAR_CLASSES[car.cls] || CAR_CLASSES.sedan;
    const steer = input.strafe;
    const turning = clamp(steer * (car.speed >= 0 ? 1 : -1), -1, 1);
    car.angle += turning * 1.9 * dt * clamp(Math.abs(car.speed) / 8, 0, 1) * (car.speed < 0 ? -1 : 1);
    if (input.fwd > 0) car.speed += tuning.accel * dt;
    else if (input.fwd < 0) {
      if (car.speed > 0.5) car.speed -= tuning.brake * dt;
      else car.speed -= tuning.reverseAccel * dt;
    } else {
      car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), 8 * dt);
    }
    car.speed = clamp(car.speed, -tuning.maxReverse, tuning.maxSpeed);
    // Arcade grip: velocity eases toward the heading so the car drifts, then grips.
    const hx = Math.sin(car.angle);
    const hz = Math.cos(car.angle);
    const grip = 1 - Math.exp(-tuning.grip * dt);
    car.vx += (hx * car.speed - car.vx) * grip;
    car.vz += (hz * car.speed - car.vz) * grip;
    const prevX = car.x;
    const prevZ = car.z;
    car.x += car.vx * dt;
    car.z += car.vz * dt;
    car.x = clamp(car.x, -CITY_HALF + 2, OCEAN_X - 4);
    car.z = clamp(car.z, -CITY_HALF + 2, CITY_HALF - 2);
    const hit = collideBuildings(car, CAR.radius);
    if (hit && Math.abs(car.speed) > 12) {
      car.speed *= 0.45;
      p.health = Math.max(0, p.health - 4);
      state.shake = Math.max(state.shake, 0.35);
      state.flash = Math.max(state.flash, 0.25);
      return EVENT_CRASH;
    }
    p.x = car.x;
    p.z = car.z;
    p.angle = car.angle;
    p.speed = car.speed;
    state.stats.distance += Math.hypot(car.x - prevX, car.z - prevZ);
    state.stats.topSpeed = Math.max(state.stats.topSpeed, Math.abs(car.speed));
    return 0;
  }

  // ---------- traffic AI: follow a road loop, brake for the car ahead ----------
  function stepTraffic(dt) {
    for (const car of state.cars) {
      if (car.kind !== 'traffic') continue;
      // A traffic car without a route just waits (defensive: without this,
      // a null route throws every frame and freezes the game loop).
      if (!car.route || car.route.length === 0) continue;
      const target = car.route[car.wp];
      const dx = target.x - car.x;
      const dz = target.z - car.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 4) {
        car.wp = (car.wp + 1) % car.route.length;
        continue;
      }
      const want = Math.atan2(dx, dz);
      car.angle = lerpAngle(car.angle, want, Math.min(1, 3.2 * dt));
      // Brake for the car ahead in our lane.
      let ahead = false;
      for (const other of state.cars) {
        if (other === car) continue;
        const ox = other.x - car.x;
        const oz = other.z - car.z;
        const forward = ox * Math.sin(car.angle) + oz * Math.cos(car.angle);
        const side = Math.abs(ox * Math.cos(car.angle) - oz * Math.sin(car.angle));
        if (forward > 0 && forward < 11 && side < 3.4) {
          ahead = true;
          break;
        }
      }
      const wantSpeed = ahead ? 0 : car.targetSpeed;
      car.speed += clamp(wantSpeed - car.speed, -14 * dt, 6 * dt);
      car.x += Math.sin(car.angle) * car.speed * dt;
      car.z += Math.cos(car.angle) * car.speed * dt;
      // Keep cars on the road network: if somehow off-road, steer back is handled by
      // the loop waypoints themselves (all waypoints sit on road centre lines).
    }
    // Car-car separation (soft push so traffic never overlaps).
    for (let i = 0; i < state.cars.length; i += 1) {
      for (let j = i + 1; j < state.cars.length; j += 1) {
        const a = state.cars[i];
        const b = state.cars[j];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < 7.5 && d2 > 0.001) {
          const d = Math.sqrt(d2);
          const push = (2.74 - d) / 2;
          const nx = dx / d;
          const nz = dz / d;
          a.x -= nx * push;
          a.z -= nz * push;
          b.x += nx * push;
          b.z += nz * push;
        }
      }
    }
  }

  // ---------- police AI: seek the player, ram in a car, grab on foot ----------
  function stepPolice(dt) {
    const p = state.player;
    const wantCount = state.wanted.stars > 0 ? Math.min(3, state.wanted.stars) : 0;
    let police = state.cars.filter((c) => c.kind === 'police');
    while (police.length < wantCount) {
      // Spawn on a road 80-110 units away from the player.
      const angle = random() * Math.PI * 2;
      const sx = clamp(p.x + Math.sin(angle) * 95, -185, 185);
      const sz = clamp(p.z + Math.cos(angle) * 95, -185, 185);
      const car = {
        id: nextCarId++, kind: 'police', cls: 'police', x: sx, z: sz, angle: 0, speed: 0,
        targetSpeed: CAR.policeMaxSpeed, color: 0x1c2733, health: COMBAT.policeCarHealth,
        route: null, wp: 0, stopped: 0, smoke: 0, vx: 0, vz: 0, explodeIn: -1,
      };
      state.cars.push(car);
      police.push(car);
    }
    // One hold timer for all cruisers: it grows while ANY cop is on top of you
    // on foot and decays only when none is — a far cruiser must not cancel the
    // hold a near one is building (the old per-car decay did exactly that).
    let anyNear = false;
    for (const car of police) {
      if (car.health <= 0) {
        // Wrecked: coast to a stop, smoke, then explode after a short fuse.
        car.speed = Math.max(0, car.speed - 20 * dt);
        car.smoke = 1;
        car.x += Math.sin(car.angle) * car.speed * dt;
        car.z += Math.cos(car.angle) * car.speed * dt;
        if (car.explodeIn < 0) car.explodeIn = 1.6;
        car.explodeIn -= dt;
        if (car.explodeIn <= 0) {
          car.explodeIn = -2; // exploded once
          addExplosion(car.x, car.z);
          state.stats.wrecks += 1;
        }
        continue;
      }
      const dx = p.x - car.x;
      const dz = p.z - car.z;
      const dist = Math.hypot(dx, dz);
      const want = Math.atan2(dx, dz);
      car.angle = lerpAngle(car.angle, want, Math.min(1, 2.6 * dt));
      const targetSpeed = dist > 90 ? CAR.policeMaxSpeed : CAR.policeMaxSpeed * 0.92;
      car.speed += clamp(targetSpeed - car.speed, -18 * dt, 12 * dt);
      car.x += Math.sin(car.angle) * car.speed * dt;
      car.z += Math.cos(car.angle) * car.speed * dt;
      collideBuildings(car, CAR.radius);
      if (dist < 3.2) {
        if (p.onFoot) {
          anyNear = true;
        } else {
          // Ram: shove the player's car and hurt the player.
          const pc = carById(p.carId);
          if (pc) {
            pc.speed *= 0.82;
            pc.x += Math.sin(car.angle) * 1.2;
            pc.z += Math.cos(car.angle) * 1.2;
          }
          p.health = Math.max(0, p.health - 6 * dt);
          state.shake = Math.max(state.shake, 0.4);
        }
      }
    }
    if (anyNear) state.wanted.bustedHold += dt;
    else state.wanted.bustedHold = Math.max(0, state.wanted.bustedHold - dt);
    // Despawn police once the heat is gone and they are far away.
    if (state.wanted.stars === 0) {
      state.cars = state.cars.filter((c) => {
        if (c.kind !== 'police') return true;
        return dist2(c.x, c.z, p.x, p.z) < 150 * 150;
      });
    }
    // Roadblocks at 4-5 stars: two parked cruisers across the road ahead of you.
    if (state.wanted.stars >= WANTED.roadblockStars && state.roadblocks.length === 0) {
      const ahead = p.onFoot ? p.angle : (carById(p.carId)?.angle ?? p.angle);
      const bx = clamp(p.x + Math.sin(ahead) * 46, -180, 180);
      const bz = clamp(p.z + Math.cos(ahead) * 46, -180, 180);
      state.roadblocks.push(
        { x: bx + 3.4, z: bz, angle: ahead + Math.PI / 2, life: 14 },
        { x: bx - 3.4, z: bz, angle: ahead + Math.PI / 2, life: 14 },
      );
      say('POLISI MEMBLOKIR JALAN DI DEPAN!', 4);
    }
    for (const rb of state.roadblocks) rb.life -= dt;
    state.roadblocks = state.roadblocks.filter((rb) => rb.life > 0);
    // A roadblock is solid: the player's car bounces off it, hard.
    if (!p.onFoot) {
      const car = carById(p.carId);
      if (car) {
        for (const rb of state.roadblocks) {
          if (dist2(car.x, car.z, rb.x, rb.z) < 3.4 * 3.4 && Math.abs(car.speed) > 6) {
            car.speed *= -0.3;
            p.health = Math.max(0, p.health - 8);
            state.shake = Math.max(state.shake, 0.6);
            state.flash = Math.max(state.flash, 0.3);
            say('Kamu menabrak blokade polisi!', 3);
          }
        }
      }
    }
  }

  // ---------- pedestrians: stroll the sidewalks, flee from danger ----------
  function stepPeds(dt) {
    const p = state.player;
    for (const ped of state.peds) {
      if (ped.down > 0) {
        ped.down -= dt;
        if (ped.down <= 0) {
          // A fresh pedestrian wanders in from elsewhere.
          const fresh = spawnPed();
          ped.x = fresh.x;
          ped.z = fresh.z;
          ped.angle = fresh.angle;
          ped.health = COMBAT.pedHealth;
          ped.state = 'walk';
        }
        continue;
      }
      const danger = state.flash > 0.4 || (!p.onFoot && Math.abs(p.speed) > 14 && dist2(ped.x, ped.z, p.x, p.z) < 12 * 12);
      if (danger && ped.state !== 'flee') {
        ped.state = 'flee';
        ped.flee = 3;
      }
      if (ped.state === 'flee') {
        ped.flee -= dt;
        const dx = ped.x - p.x;
        const dz = ped.z - p.z;
        const d = Math.hypot(dx, dz) || 1;
        ped.angle = Math.atan2(dx / d, dz / d);
        ped.x += Math.sin(ped.angle) * PED.fleeSpeed * dt;
        ped.z += Math.cos(ped.angle) * PED.fleeSpeed * dt;
        if (ped.flee <= 0) ped.state = 'walk';
      } else {
        // Stroll: mostly straight, turn at intersections or at random.
        if (random() < dt * 0.06) ped.angle += (random() < 0.5 ? 1 : -1) * (Math.PI / 2);
        ped.x += Math.sin(ped.angle) * ped.speed * dt;
        ped.z += Math.cos(ped.angle) * ped.speed * dt;
      }
      ped.x = clamp(ped.x, -CITY_HALF + 2, OCEAN_X - 4);
      ped.z = clamp(ped.z, -CITY_HALF + 2, CITY_HALF - 2);
      // Never walk through a building: bounce off the block edge.
      for (const b of state.buildings) {
        if (ped.x > b.x0 - 1 && ped.x < b.x1 + 1 && ped.z > b.z0 - 1 && ped.z < b.z1 + 1) {
          ped.angle += Math.PI / 2;
          ped.x = clamp(ped.x, b.x0 - 1.2, b.x1 + 1.2);
          ped.z = clamp(ped.z, b.z0 - 1.2, b.z1 + 1.2);
          break;
        }
      }
      ped.bob += dt * (ped.state === 'flee' ? 14 : 7);
    }
    // Player car vs pedestrian: a hit knocks them down and is a crime.
    if (!p.onFoot) {
      for (const ped of state.peds) {
        if (ped.down > 0) continue;
        if (dist2(ped.x, ped.z, p.x, p.z) < 2.2 * 2.2 && Math.abs(p.speed) > 4) {
          ped.down = 4;
          ped.health = 0;
          addCrime(WANTED.hitPedHeat);
          say('Kamu menabrak pejalan kaki! +★', 3);
        }
      }
    }
    // A car-theft victim flees for 5 s and then leaves the area. Without this
    // the ped array grew by one on every theft, forever — and the renderer's
    // ped InstancedMesh is sized once at creation, so the extra victims
    // became invisible pedestrians that could still be run over.
    state.peds = state.peds.filter((ped) => !(ped.driver && ped.state !== 'flee'));
  }

  // ---------- wanted: heat decays when you lay low ----------
  function stepWanted(dt) {
    const w = state.wanted;
    const before = w.stars;
    let policeNear = false;
    for (const car of state.cars) {
      if (car.kind === 'police' && dist2(car.x, car.z, state.player.x, state.player.z) < 70 * 70) {
        policeNear = true;
        break;
      }
    }
    if (state.time - w.lastCrime > WANTED.decayDelay && !policeNear && w.heat > 0) {
      w.heat = Math.max(0, w.heat - WANTED.decayRate * dt);
    }
    w.stars = Math.min(WANTED.maxStars, Math.floor(w.heat / WANTED.starHeat));
    if (w.stars < before) return EVENT_STAR_DOWN;
    return 0;
  }

  // ---------- missions ----------
  function stepMissions() {
    const m = state.mission;
    if (m.done || !m.beacon) return 0;
    const p = state.player;
    if (dist2(p.x, p.z, m.beacon.x, m.beacon.z) < 7 * 7) {
      const def = MISSIONS[m.index];
      const completed = m.index; // capture BEFORE setMission() advances the index
      p.cash += def.reward;
      state.stats.earned += def.reward;
      const last = completed >= MISSIONS.length - 1;
      if (last) {
        state.mission.storyDone = true;
        state.mission.done = true;
        state.mission.beacon = null;
        state.mission.text = 'CERITA SELESAI — Neon Bay milikmu sekarang. Free roam!';
        say(`MISI SELESAI! +$${def.reward} — CERITA TAMAT`, 6);
      } else {
        if (completed === 0) {
          // Reaching the hideout clears the OLD heat: you lay low, the cops
          // lose you — and then mission 2 starts fresh with its own 2 stars.
          state.wanted.heat = 0;
          state.wanted.stars = 0;
          state.stats.escaped += 1;
          setMission(completed + 1);
          say(`MISI SELESAI! +$${def.reward} — kamu lolos dari polisi`, 5);
        } else {
          setMission(completed + 1);
          say(`MISI SELESAI! +$${def.reward}`, 5);
        }
      }
      return EVENT_MISSION;
    }
    return 0;
  }

  // ---------- taxi side job ----------
  function stepTaxi(dt) {
    const t = state.taxi;
    const p = state.player;
    if (!t.active) {
      // A fare appears now and then while you roam (never during a mission beacon chase).
      if (state.time > 20 && random() < dt * 0.02) {
        const line = pick(random, ROAD_LINES);
        const along = range(random, -170, 170);
        const px = random() < 0.5 ? line + 9 : along;
        const pz = random() < 0.5 ? along : line + 9;
        const dest = spawnPickup('cash');
        t.active = true;
        t.phase = 'pickup';
        t.passenger = { x: px, z: pz };
        t.dest = { x: dest.x, z: dest.z };
        t.fare = 0;
        t.timer = TAXI.passengerWait;
        say('PENUMPANG TAKSI! Jemput penanda kuning di peta.', 4);
      }
      return 0;
    }
    t.timer -= dt;
    if (t.timer <= 0) {
      t.active = false;
      t.phase = 'idle';
      say('Penumpang pergi — terlambat menjemput.', 3);
      return 0;
    }
    if (t.phase === 'pickup') {
      if (dist2(p.x, p.z, t.passenger.x, t.passenger.z) < 6 * 6) {
        t.phase = 'dropoff';
        const d = Math.hypot(t.dest.x - t.passenger.x, t.dest.z - t.passenger.z);
        t.fare = Math.round(TAXI.fareBase + d * TAXI.farePerMetre);
        t.timer = 60;
        say(`Penumpang naik! Antar ke tujuan — tarif $${t.fare}`, 4);
      }
      return 0;
    }
    if (t.phase === 'dropoff' && dist2(p.x, p.z, t.dest.x, t.dest.z) < 7 * 7) {
      p.cash += t.fare;
      state.stats.earned += t.fare;
      state.stats.fares += 1;
      say(`TAKSI SELESAI! +$${t.fare}`, 4);
      t.active = false;
      t.phase = 'idle';
      return EVENT_FARE;
    }
    return 0;
  }

  // ---------- combat: hitscan pistol, pooled tracer for the renderer ----------
  function shoot(camYaw) {
    const p = state.player;
    const ox = p.x;
    const oz = p.z;
    const oy = p.onFoot ? 1.4 : 1.1;
    const dx = -Math.sin(camYaw);
    const dz = -Math.cos(camYaw);
    let best = null;
    let bestT = COMBAT.range;
    // Pedestrians.
    for (const ped of state.peds) {
      if (ped.down > 0) continue;
      const rx = ped.x - ox;
      const rz = ped.z - oz;
      const t = rx * dx + rz * dz;
      if (t < 1 || t > bestT) continue;
      const perp = Math.abs(rx * dz - rz * dx);
      if (perp < 1.1) {
        bestT = t;
        best = { kind: 'ped', ref: ped };
      }
    }
    // Police cars.
    for (const car of state.cars) {
      if (car.kind !== 'police' || car.health <= 0) continue;
      const rx = car.x - ox;
      const rz = car.z - oz;
      const t = rx * dx + rz * dz;
      if (t < 1 || t > bestT) continue;
      const perp = Math.abs(rx * dz - rz * dx);
      if (perp < 2.2) {
        bestT = t;
        best = { kind: 'car', ref: car };
      }
    }
    const tx = ox + dx * bestT;
    const tz = oz + dz * bestT;
    state.tracer = { x0: ox, y0: oy, z0: oz, x1: tx, y1: 1.2, z1: tz, life: 0.09 };
    state.flash = Math.max(state.flash, 0.2);
    let event = EVENT_SHOT;
    if (best) {
      if (best.kind === 'ped') {
        best.ref.health -= COMBAT.damage;
        if (best.ref.health <= 0) {
          best.ref.down = 5;
          event |= addCrime(WANTED.killHeat);
          say('Kamu menembak pejalan kaki! +★', 3);
        } else {
          best.ref.state = 'flee';
          best.ref.flee = 4;
          event |= addCrime(WANTED.shootHeat);
        }
      } else {
        best.ref.health -= COMBAT.damage;
        if (best.ref.health <= 0) {
          best.ref.smoke = 1;
          best.ref.explodeIn = 1.6; // the wreck burns, then blows up
          event |= addCrime(WANTED.killHeat);
          say('Mobil polisi hancur!', 3);
        } else {
          event |= addCrime(WANTED.shootHeat);
        }
      }
    }
    return event;
  }

  // ---------- enter / exit a car ----------
  function enterCar() {
    const p = state.player;
    if (!p.onFoot) {
      // Get out: leave the car parked where it is.
      const car = carById(p.carId);
      if (car) {
        car.speed = 0;
        p.x = car.x + Math.cos(car.angle) * 2.4;
        p.z = car.z - Math.sin(car.angle) * 2.4;
      }
      p.onFoot = true;
      p.carId = -1;
      return 0;
    }
    const car = nearestCar(p.x, p.z, PLAYER.enterRange, ['traffic']);
    if (!car) {
      say('Tidak ada mobil di dekatmu. Dekati mobil lalu tekan E.', 2.5);
      return 0;
    }
    // The driver bails out and flees.
    const driver = spawnPed(car.x + 2, car.z + 2);
    driver.state = 'flee';
    driver.flee = 5;
    driver.driver = true;
    state.peds.push(driver);
    car.kind = 'player';
    car.route = null;
    car.targetSpeed = 0;
    car.vx = 0;
    car.vz = 0;
    p.onFoot = false;
    p.carId = car.id;
    state.stats.stolen += 1;
    const clsName = car.cls === 'sport' ? 'SPORT' : car.cls === 'taxi' ? 'TAKSI' : car.cls === 'truck' ? 'TRUK' : 'SEDAN';
    say(`Mobil ${clsName} dicuri! Polisi mengincarmu. +★`, 3.5);
    return EVENT_STEAL | addCrime(WANTED.stealHeat);
  }

  // ---------- pickups ----------
  function stepPickups(dt) {
    const p = state.player;
    for (const pk of state.pickups) {
      if (!pk.active) {
        pk.timer -= dt;
        if (pk.timer <= 0) {
          const fresh = spawnPickup(pk.kind);
          pk.x = fresh.x;
          pk.z = fresh.z;
          pk.active = true;
        }
        continue;
      }
      if (dist2(p.x, p.z, pk.x, pk.z) < 2 * 2) {
        pk.active = false;
        pk.timer = PICKUPS.respawn;
        if (pk.kind === 'cash') {
          const value = Math.floor(range(random, PICKUPS.cashValue[0], PICKUPS.cashValue[1]));
          p.cash += value;
          state.stats.earned += value;
          say(`+$${value} uang jalanan`, 2.5);
        } else {
          p.health = Math.min(PLAYER.health, p.health + 25);
          say('+25 HP', 2.5);
        }
        return EVENT_PICKUP;
      }
    }
    return 0;
  }

  // ---------- busted / wasted ----------
  function stepBusted() {
    const p = state.player;
    if (state.wanted.bustedHold >= WANTED.bustedHold && p.onFoot) {
      return respawn('BUSTED — kamu ditangkap! Denda $500.', 500);
    }
    if (p.health <= 0) {
      return respawn('WASTED — kamu tumbang! Biaya rumah sakit $250.', 250);
    }
    return 0;
  }

  function respawn(text, fine) {
    const p = state.player;
    p.cash = Math.max(0, p.cash - fine);
    p.health = PLAYER.health;
    p.x = -172;
    p.z = -168;
    p.angle = Math.PI / 2;
    p.onFoot = true;
    p.carId = -1;
    state.wanted.heat = 0;
    state.wanted.stars = 0;
    state.wanted.bustedHold = 0;
    state.wanted.lastCrime = state.time;
    state.roadblocks = [];
    say(text, 5);
    return text.startsWith('BUSTED') ? EVENT_BUSTED : EVENT_WASTED;
  }

  // ---------- drive assist: steers the player's car along the road (screenshot autopilot) ----------
  function driveAssist() {
    const p = state.player;
    const car = carById(p.carId);
    if (!car) return { fwd: 1, strafe: 0, run: false };
    // Heading convention: a car with angle a moves as (sin a, cos a), so the
    // heading for direction (dx, dz) is atan2(dx, dz) — east is +PI/2, west
    // -PI/2, south 0, north PI. (The old code had the two axes swapped here:
    // it steered a westbound car toward north, which is why staged drives
    // wandered off the road and into building blocks.)
    const alongX = Math.abs(Math.sin(car.angle)) > Math.abs(Math.cos(car.angle));
    let target;
    if (alongX) target = Math.atan2(Math.sign(Math.sin(car.angle)) || 1, 0);
    else target = Math.atan2(0, Math.sign(Math.cos(car.angle)) || 1);
    // Nudge toward the nearest lane centre on the cross axis.
    const cross = alongX ? car.z : car.x;
    let bestLine = ROAD_LINES[0];
    let bestD = Infinity;
    for (const line of ROAD_LINES) {
      const d = Math.abs(cross - line);
      if (d < bestD) {
        bestD = d;
        bestLine = line;
      }
    }
    const lane = cross > bestLine ? bestLine + 3 : bestLine - 3;
    const err = lane - cross;
    let strafe = clamp(err * 0.12, -1, 1);
    const angleErr = ((target - car.angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    strafe = clamp(strafe + angleErr * 0.9, -1, 1);
    return { fwd: 1, strafe, run: false };
  }

  // ---------- the step ----------
  let fireCooldown = 0;
  function step(dt, input, actions) {
    let events = 0;
    state.time += dt;
    if (state.messageTimer > 0) state.messageTimer -= dt;
    if (state.shake > 0) state.shake = Math.max(0, state.shake - dt * 1.4);
    if (state.flash > 0) state.flash = Math.max(0, state.flash - dt * 3);
    if (state.tracer) {
      state.tracer.life -= dt;
      if (state.tracer.life <= 0) state.tracer = null;
    }
    for (const ex of state.explosions) ex.life -= dt;
    state.explosions = state.explosions.filter((ex) => ex.life > 0);
    fireCooldown = Math.max(0, fireCooldown - dt);

    // Camera orbit is owned by the renderer; the world only needs the yaw for movement.
    const p = state.player;
    if (actions & ACTION_ENTER) events |= enterCar();
    if ((actions & ACTION_SHOOT) && fireCooldown <= 0) {
      fireCooldown = COMBAT.fireInterval;
      events |= shoot(p.camYaw);
    }

    if (p.onFoot) stepPlayerOnFoot(dt, input);
    else events |= stepPlayerCar(dt, input);
    stepTraffic(dt);
    stepPolice(dt);
    // Every car and pedestrian stays inside the playable area. The player's
    // car is clamped in stepPlayerCar, but traffic and police were not: a
    // cruiser chasing a player on the beach drove straight past the waterline
    // into the ocean. One clamp here covers every kind, present and future.
    for (const car of state.cars) {
      car.x = clamp(car.x, -CITY_HALF + 2, OCEAN_X - 4);
      car.z = clamp(car.z, -CITY_HALF + 2, CITY_HALF - 2);
    }
    for (const ped of state.peds) {
      ped.x = clamp(ped.x, -CITY_HALF + 2, OCEAN_X - 4);
      ped.z = clamp(ped.z, -CITY_HALF + 2, CITY_HALF - 2);
    }
    stepPeds(dt);
    events |= stepWanted(dt);
    events |= stepMissions();
    events |= stepTaxi(dt);
    events |= stepPickups(dt);
    events |= stepBusted();
    return events;
  }

  function snapshot() {
    return {
      cash: state.player.cash,
      missionsDone: state.mission.storyDone ? 3 : state.mission.index,
      storyDone: state.mission.storyDone,
      earned: state.stats.earned,
      stolen: state.stats.stolen,
      escaped: state.stats.escaped,
      fares: state.stats.fares,
      topSpeed: Math.round(state.stats.topSpeed * 3.6),
    };
  }

  function applySnapshot(save) {
    if (!save) return;
    state.player.cash = save.cash || 0;
    state.stats.earned = save.earned || 0;
    state.stats.stolen = save.stolen || 0;
    state.stats.escaped = save.escaped || 0;
    state.stats.fares = save.fares || 0;
    if (save.storyDone) {
      state.mission.storyDone = true;
      state.mission.done = true;
      state.mission.beacon = null;
      state.mission.text = 'CERITA SELESAI — Neon Bay milikmu sekarang. Free roam!';
    } else if (save.missionsDone > 0) {
      setMission(Math.min(save.missionsDone, MISSIONS.length - 1));
    }
  }

  generateCity();
  reset(1);

  return { state, reset, step, shoot, enterCar, driveAssist, snapshot, applySnapshot, generateCity };
}
