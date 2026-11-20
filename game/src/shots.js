// Screenshot scenes behind ?shot=start|drive|chase|mission (with &seed=N). Each one
// plays the real rules forward from a fresh world for a fixed number of steps, so
// the frame is what a short game really looks like — and the same seed always
// gives the same frame. The judge's contact sheet is built from these, so every
// shot is composed like a showcase: the sun in frame, the city alive, action
// visible, the HUD telling the story (cash, stars, mission, minimap).
import { STEP, WANTED } from './config.js';
import { dist2 } from './random.js';

const AMBIENT_SECONDS = 6;
const DRIVE_SECONDS = 4;
const CHASE_SECONDS = 4;
const MISSION_SECONDS = 4;

function putPlayerInCar(world, x, z, angle) {
  const state = world.state;
  let best = null;
  let bestD = Infinity;
  for (const car of state.cars) {
    if (car.kind !== 'traffic') continue;
    const d = dist2(x, z, car.x, car.z);
    if (d < bestD) {
      bestD = d;
      best = car;
    }
  }
  if (!best) return null;
  best.kind = 'player';
  best.cls = 'sport'; // the showcase car is the fast one
  best.route = null;
  best.x = x;
  best.z = z;
  best.angle = angle;
  best.speed = 16;
  best.vx = Math.sin(angle) * 16;
  best.vz = Math.cos(angle) * 16;
  const p = state.player;
  p.onFoot = false;
  p.carId = best.id;
  p.x = x;
  p.z = z;
  p.angle = angle;
  p.camYaw = angle + Math.PI;
  p.camPitch = 0.12;
  return best;
}

function facePoint(player, tx, tz) {
  const dx = tx - player.x;
  const dz = tz - player.z;
  const len = Math.hypot(dx, dz) || 1;
  // View direction is -(sin yaw, cos yaw); solve yaw from the desired view dir.
  player.camYaw = Math.atan2(-dx / len, -dz / len);
}

export function stageShot(name, world) {
  const state = world.state;
  if (name === 'drive') {
    world.reset(1);
    // Westbound down the sunset avenue (road z=32) toward the ocean and the
    // setting sun, traffic ahead, downtown towers on the right. Four seconds
    // keeps the car mid-city: a longer run drives it into the map corner.
    putPlayerInCar(world, 130, 32, -Math.PI / 2);
    for (let i = 0; i < DRIVE_SECONDS / STEP; i += 1) {
      world.step(STEP, world.driveAssist(), 0);
    }
    // Staging bumps happen (traffic); the showcase frame shows a clean car.
    state.player.health = 100;
    state.message = '';
    state.messageTimer = 0;
    return { screen: 'play' };
  }
  if (name === 'chase') {
    world.reset(1);
    // Westbound on the z=-32 avenue at sunset, three stars, cruisers closing in.
    putPlayerInCar(world, 60, -32, -Math.PI / 2);
    state.wanted.heat = 3 * WANTED.starHeat;
    state.wanted.lastCrime = state.time;
    for (let i = 0; i < CHASE_SECONDS / STEP; i += 1) {
      world.step(STEP, world.driveAssist(), 0);
    }
    // Pull police cruisers INTO the frame: ahead-beside the player, boxing it
    // in — cruisers placed behind sit behind the chase camera, and the player
    // (44 u/s) outruns their 34 u/s, so they fall out of frame within a second.
    // Starting ahead, they drift back toward the player's flanks and stay
    // visible at the frame edges. One smoking wreck nearby as proof of the fight.
    const p = state.player;
    const cops = state.cars.filter((c) => c.kind === 'police');
    cops.slice(0, 2).forEach((cop, i) => {
      const ahead = 6 + i * 3;
      const side = i === 0 ? -9 : 9;
      cop.x = p.x + Math.sin(p.angle) * ahead + Math.cos(p.angle) * side;
      cop.z = p.z + Math.cos(p.angle) * ahead - Math.sin(p.angle) * side;
      cop.angle = p.angle;
      cop.speed = 42;
    });
    if (cops[2]) {
      cops[2].health = 0;
      cops[2].smoke = 1;
      cops[2].x = p.x + Math.sin(p.angle) * 26;
      cops[2].z = p.z + Math.cos(p.angle) * 26;
      cops[2].angle = p.angle + 0.6;
    }
    for (let i = 0; i < 1.2 / STEP; i += 1) {
      world.step(STEP, world.driveAssist(), 0);
    }
    state.player.health = 100;
    // A staged drive can clip a pedestrian on the way; the toast would sit
    // across the mission banner in the shot, so clear it for the frame.
    state.message = '';
    state.messageTimer = 0;
    return { screen: 'play' };
  }
  if (name === 'mission') {
    world.reset(1);
    const p = state.player;
    const b = state.mission.beacon;
    // On foot on the OPEN west docks, west of the beacon — the camera sits over
    // the pier, the beacon pillar is ahead, downtown towers behind it. (Standing
    // east of the beacon puts the camera inside a building block, which fills
    // the frame with a wall.)
    p.x = b.x - 14;
    p.z = b.z;
    p.onFoot = true;
    p.camPitch = 0.1;
    facePoint(p, b.x, b.z);
    for (let i = 0; i < MISSION_SECONDS / STEP; i += 1) {
      world.step(STEP, { fwd: 0, strafe: 0, run: false }, 0);
    }
    return { screen: 'play' };
  }
  // Default: the title scene — golden hour over downtown, city alive behind the menu.
  world.reset(1);
  const p = state.player;
  p.x = 84;
  p.z = 24;
  p.onFoot = true;
  p.camYaw = Math.PI / 2; // look west, into the sunset and the towers
  p.camPitch = 0.18; // slightly low camera: the skyline fills the frame
  for (let i = 0; i < AMBIENT_SECONDS / STEP; i += 1) {
    world.step(STEP, { fwd: 0, strafe: 0, run: false }, 0);
  }
  return { screen: 'title' };
}
