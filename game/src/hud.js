// NEON BAY — the DOM HUD. All HUD text lives in the DOM (crisp at any resolution,
// zero GPU cost) while the 3D view stays pure game. The minimap is a small 2D
// canvas: roads, the player arrow, traffic, police, the mission blip and pickups.
// Every update is cached: a DOM write only happens when the value actually
// changed, so the HUD costs nothing on a steady frame.
import { BEACH_X, CITY_HALF, MISSIONS, OCEAN_X, ROAD_LINES, districtAt } from './config.js';

const STAR_FULL = '★';
const STAR_EMPTY = '☆';

export function createHud(world) {
  const cashEl = document.getElementById('hud-cash');
  const cashPop = document.getElementById('hud-cash-pop');
  const districtEl = document.getElementById('hud-district');
  const starsEl = document.getElementById('hud-stars');
  const healthFill = document.getElementById('hud-health-fill');
  const healthText = document.getElementById('hud-health-text');
  const speedEl = document.getElementById('hud-speed');
  const speedBar = document.getElementById('hud-speed-bar');
  const missionTitle = document.getElementById('hud-mission-title');
  const missionText = document.getElementById('hud-mission-text');
  const missionDist = document.getElementById('hud-mission-dist');
  const missionSteps = document.getElementById('hud-mission-steps');
  const taxiEl = document.getElementById('hud-taxi');
  const messageEl = document.getElementById('hud-message');
  const vignette = document.getElementById('vignette');
  const crosshair = document.getElementById('crosshair');
  const map = document.getElementById('minimap');
  const mapCtx = map.getContext('2d');
  const fpsEl = document.getElementById('hud-fps');

  let lastCash = -1;
  let lastStars = -1;
  let lastHealth = -1;
  let lastMission = -1;
  let lastMessage = '';
  let lastFps = -1;
  let lastDistrict = '';
  let lastTaxi = '';
  let lastSpeedKmh = -1;
  let popTimer = 0;

  function drawMap(state) {
    const W = map.width;
    const H = map.height;
    const S = W / (CITY_HALF * 2 + 80);
    const ox = W / 2;
    const oy = H / 2;
    const mx = (x) => ox + x * S;
    const my = (z) => oy + z * S;
    mapCtx.clearRect(0, 0, W, H);
    mapCtx.fillStyle = 'rgba(10,12,20,0.72)';
    mapCtx.fillRect(0, 0, W, H);
    // Ocean + beach.
    mapCtx.fillStyle = '#1d5f8a';
    mapCtx.fillRect(mx(OCEAN_X), 0, W - mx(OCEAN_X), H);
    mapCtx.fillStyle = '#c98f4e';
    mapCtx.fillRect(mx(BEACH_X), 0, mx(OCEAN_X) - mx(BEACH_X), H);
    // Roads.
    mapCtx.strokeStyle = '#5a5a6e';
    mapCtx.lineWidth = 3;
    for (const line of ROAD_LINES) {
      mapCtx.beginPath();
      mapCtx.moveTo(mx(line), my(-CITY_HALF));
      mapCtx.lineTo(mx(line), my(CITY_HALF));
      mapCtx.stroke();
      mapCtx.beginPath();
      mapCtx.moveTo(mx(-CITY_HALF), my(line));
      mapCtx.lineTo(mx(CITY_HALF), my(line));
      mapCtx.stroke();
    }
    // Pickups.
    for (const pk of state.pickups) {
      if (!pk.active) continue;
      mapCtx.fillStyle = pk.kind === 'cash' ? '#2eff7a' : '#ffffff';
      mapCtx.fillRect(mx(pk.x) - 1.5, my(pk.z) - 1.5, 3, 3);
    }
    // Taxi fare: gold square (passenger) / gold ring (destination).
    const taxi = state.taxi;
    if (taxi.active) {
      const target = taxi.phase === 'pickup' ? taxi.passenger : taxi.dest;
      if (target) {
        mapCtx.fillStyle = '#ffc93c';
        mapCtx.fillRect(mx(target.x) - 3, my(target.z) - 3, 6, 6);
      }
    }
    // Mission beacon: pulsing diamond.
    const b = state.mission.beacon;
    if (b) {
      const pulse = 4 + Math.sin(state.time * 5) * 2;
      mapCtx.fillStyle = '#ffd94a';
      mapCtx.beginPath();
      mapCtx.moveTo(mx(b.x), my(b.z) - pulse);
      mapCtx.lineTo(mx(b.x) + pulse, my(b.z));
      mapCtx.lineTo(mx(b.x), my(b.z) + pulse);
      mapCtx.lineTo(mx(b.x) - pulse, my(b.z));
      mapCtx.closePath();
      mapCtx.fill();
    }
    // Traffic (yellow), police (flashing blue/red).
    for (const car of state.cars) {
      if (car.kind === 'police') {
        mapCtx.fillStyle = Math.floor(state.time * 4) % 2 === 0 ? '#ff2233' : '#2266ff';
        mapCtx.beginPath();
        mapCtx.arc(mx(car.x), my(car.z), 3.4, 0, Math.PI * 2);
        mapCtx.fill();
      } else if (car.kind === 'traffic') {
        mapCtx.fillStyle = '#ffd94a';
        mapCtx.fillRect(mx(car.x) - 1.5, my(car.z) - 1.5, 3, 3);
      }
    }
    // Player arrow.
    const p = state.player;
    mapCtx.save();
    mapCtx.translate(mx(p.x), my(p.z));
    mapCtx.rotate(Math.PI - p.angle);
    mapCtx.fillStyle = '#ff2e88';
    mapCtx.beginPath();
    mapCtx.moveTo(0, -7);
    mapCtx.lineTo(5, 5);
    mapCtx.lineTo(0, 2.5);
    mapCtx.lineTo(-5, 5);
    mapCtx.closePath();
    mapCtx.fill();
    mapCtx.restore();
  }

  function update(state, screen, fps, dt = 1 / 60) {
    const p = state.player;
    // Cash, with a floating "+$N" pop whenever it jumps.
    if (p.cash !== lastCash) {
      if (lastCash >= 0 && p.cash > lastCash) {
        cashPop.textContent = `+$${(p.cash - lastCash).toLocaleString('en-US')}`;
        cashPop.classList.add('show');
        popTimer = 1.1;
      }
      lastCash = p.cash;
      cashEl.textContent = `$${p.cash.toLocaleString('en-US')}`;
    }
    if (popTimer > 0) {
      popTimer -= dt;
      if (popTimer <= 0) cashPop.classList.remove('show');
    }
    // District name, under the cash.
    const district = districtAt(p.x, p.z);
    if (district !== lastDistrict) {
      lastDistrict = district;
      districtEl.textContent = district;
    }
    // Wanted stars.
    if (state.wanted.stars !== lastStars) {
      lastStars = state.wanted.stars;
      starsEl.textContent = STAR_FULL.repeat(state.wanted.stars) + STAR_EMPTY.repeat(5 - state.wanted.stars);
      starsEl.classList.toggle('hot', state.wanted.stars > 0);
    }
    // Health bar.
    const hp = Math.max(0, Math.round(p.health));
    if (hp !== lastHealth) {
      lastHealth = hp;
      healthFill.style.width = `${hp}%`;
      healthFill.classList.toggle('low', hp < 35);
      healthText.textContent = `${hp}`;
    }
    // Speed + speed bar (0-160 km/h scale).
    const kmh = Math.round(Math.abs(p.speed || 0) * 3.6);
    if (kmh !== lastSpeedKmh) {
      lastSpeedKmh = kmh;
      speedEl.textContent = p.onFoot ? 'ON FOOT' : `${kmh} km/h`;
      speedBar.style.width = `${Math.min(100, (kmh / 160) * 100)}%`;
    }
    // Mission tracker: title, brief, distance, and the 3-step checklist.
    if (state.mission.index !== lastMission || state.mission.storyDone) {
      lastMission = state.mission.index;
      const def = MISSIONS[state.mission.index];
      missionTitle.textContent = state.mission.storyDone ? 'CERITA SELESAI' : def ? def.title : 'FREE ROAM';
      const done = state.mission.storyDone ? 3 : state.mission.index;
      missionSteps.textContent = `●`.repeat(done) + `○`.repeat(3 - done);
    }
    missionText.textContent = state.mission.text;
    if (state.mission.beacon) {
      const d = Math.hypot(p.x - state.mission.beacon.x, p.z - state.mission.beacon.z);
      missionDist.textContent = `${Math.round(d)}m`;
    } else {
      missionDist.textContent = '';
    }
    // Taxi job line.
    const taxi = state.taxi;
    const taxiText = taxi.active
      ? (taxi.phase === 'pickup' ? `🚕 Jemput penumpang — ${Math.ceil(taxi.timer)} dtk` : `🚕 Antar ke tujuan — $${taxi.fare}`)
      : '';
    if (taxiText !== lastTaxi) {
      lastTaxi = taxiText;
      taxiEl.textContent = taxiText;
      taxiEl.classList.toggle('show', taxiText !== '');
    }
    // Toast message.
    if (state.message !== lastMessage) {
      lastMessage = state.message;
      messageEl.textContent = state.message;
    }
    messageEl.classList.toggle('show', state.messageTimer > 0 && state.message !== '');
    // Damage vignette (red flash, or steady when health is low).
    vignette.style.opacity = state.flash > 0 ? String(state.flash * 0.5) : (p.health < 35 ? '0.45' : '0');
    crosshair.style.display = screen === 'play' && p.onFoot ? 'block' : 'none';
    // FPS readout.
    const fpsRound = Math.round(fps);
    if (fpsRound !== lastFps) {
      lastFps = fpsRound;
      fpsEl.textContent = `${fpsRound} FPS`;
      fpsEl.classList.toggle('slow', fpsRound < 50);
    }
    drawMap(state);
  }

  return { update };
}
