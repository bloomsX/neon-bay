// NEON BAY — staged states for the four screenshots. Each stage puts the
// world into one composed moment (title, drive, chase, mission) using only
// the simulation's own pieces, then the capture tool waits for the ready
// flag before shooting. Nothing here is a mockup: every shot is a real
// render of the running game.
import { CFG } from './config.js';

function nearestCar(world, cls, x, z) {
  let best = null;
  let bestD = 1e9;
  for (const car of world.cars) {
    if (car.wreck) continue;
    if (cls && car.cls !== cls) continue;
    const d = Math.hypot(car.x - x, car.z - z);
    if (d < bestD) { best = car; bestD = d; }
  }
  return best;
}

function putPlayerInCar(world, car, x, z, angle, speed) {
  car.mode = 'player';
  car.x = x; car.z = z;
  car.angle = angle;
  car.speed = speed;
  car.targetSpeed = speed;
  car.driver = false;
  const p = world.player;
  p.onFoot = false;
  p.carId = car.id;
  p.x = x; p.z = z;
  p.angle = angle;
  p.speed = Math.abs(speed);
  p.camYaw = angle - Math.PI / 2;
  p.camPitch = -0.1;
}

function spawnChasePolice(world, px, pz, angle, count) {
  let made = 0;
  const back = angle + Math.PI;
  const offsets = [[14, -4], [20, 4], [28, -2], [38, 6], [48, -5]];
  for (let i = 0; i < count; i++) {
    const id = Math.max(...world.cars.map((c) => c.id)) + 1;
    const ox = offsets[i % offsets.length][0];
    const oz = offsets[i % offsets.length][1];
    const car = {
      id, kind: 'police', cls: 'police',
      x: px + Math.cos(back) * ox - Math.sin(back) * oz,
      z: pz + Math.sin(back) * ox + Math.cos(back) * oz,
      angle, speed: 30, targetSpeed: CFG.carClasses.police.top,
      color: 0xf2f2f2, hp: CFG.carHealth, wreck: false, driver: true,
      route: [], wp: 0, mode: 'chase', brake: false, ramAt: -10, stuckAt: 0, idleAt: 0,
    };
    world.cars.push(car);
    made++;
  }
  return made;
}

// Stage one of the four shots. Returns a short label for the log.
export function stageShot(world, name) {
  const p = world.player;
  if (name === 'start') {
    // Title moment: Kai on the west road, downtown ahead, sunset behind.
    p.x = -168; p.z = -36;
    p.angle = 0;
    p.onFoot = true;
    p.carId = -1;
    p.camYaw = -Math.PI / 2;
    p.camPitch = -0.08;
    world.wanted.heat = 0;
    world.wanted.stars = 0;
    return 'title';
  }
  if (name === 'drive') {
    // Sunset run: a sportscar heading west into the sun on the south road.
    const car = nearestCar(world, 'sport', 0, 36) || nearestCar(world, null, 0, 36);
    putPlayerInCar(world, car, 60, 36, Math.PI, 25);
    world.wanted.heat = 0;
    world.wanted.stars = 0;
    return 'drive';
  }
  if (name === 'chase') {
    // Three stars: Kai fleeing west with three police on his bumper. The
    // camera sits AHEAD of the car (head-on) so the pursuing police are
    // visible beyond it; a chase cam behind the player would hide them
    // behind the camera. Police stay close so they read in the frame.
    const car = nearestCar(world, 'sport', -20, -36) || nearestCar(world, null, -20, -36);
    putPlayerInCar(world, car, -20, -36, Math.PI, 28);
    p.camYaw = Math.PI + Math.PI / 2; // camera in front, looking back
    world.wanted.heat = 300;
    world.wanted.stars = 3;
    world.wanted.lastCrimeAt = world.time;
    spawnChasePolice(world, -20, -36, Math.PI, 3);
    return 'chase';
  }
  // mission: on foot at the docks, the beacon pillar ahead, ocean beyond.
  world.mission.index = 0;
  world.mission.storyDone = false;
  p.x = -136; p.z = 136;
  // The camera looks along (cos(angle), -sin(angle)), so the angle that
  // faces the beacon at (-150, 150) is atan2(-dz, dx), not atan2(dz, dx).
  p.angle = Math.atan2(-(150 - 136), -150 - (-136));
  p.onFoot = true;
  p.carId = -1;
  p.camYaw = p.angle - Math.PI / 2;
  p.camPitch = -0.1;
  world.wanted.heat = 0;
  world.wanted.stars = 0;
  return 'mission';
}
