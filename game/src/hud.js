// NEON BAY — the heads-up display and the menus. All interface text is in
// Indonesian. The HUD is built in code so the page itself stays a thin shell.
import { CFG } from './config.js';

function el(tag, cls, parent, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

function money(n) {
  return '$' + Math.floor(n).toLocaleString('id-ID');
}

export function createHud(callbacks) {
  const root = document.body;

  // --- in-game HUD -------------------------------------------------------
  const hud = el('div', 'hud', root);
  hud.style.display = 'none';
  const topLeft = el('div', 'hud-topleft', hud);
  const cashEl = el('div', 'hud-cash', topLeft, '$0');
  const healthWrap = el('div', 'hud-health', topLeft);
  const healthBar = el('div', 'hud-health-bar', healthWrap);
  const starsEl = el('div', 'hud-stars', topLeft, '☆☆☆☆☆');
  const fpsEl = el('div', 'hud-fps', hud, '');
  // The FPS badge is a live perf readout; staged screenshots are taken on
  // software rendering, where it would read 1-2 FPS and mislead anyone who
  // sees the still. Hide it whenever the game is running in shot mode.
  if (callbacks.hideFps) fpsEl.style.display = 'none';
  const missionEl = el('div', 'hud-mission', hud);
  const missionTitle = el('div', 'hud-mission-title', missionEl, '');
  const missionBrief = el('div', 'hud-mission-brief', missionEl, '');
  const missionDist = el('div', 'hud-mission-dist', missionEl, '');
  const mapWrap = el('div', 'hud-mapwrap', hud);
  const map = document.createElement('canvas');
  map.width = 190;
  map.height = 190;
  map.className = 'hud-map';
  mapWrap.appendChild(map);
  const mapCtx = map.getContext('2d');
  const speedEl = el('div', 'hud-speed', hud, '');
  speedEl.style.display = 'none';
  const cross = el('div', 'hud-cross', hud);
  cross.textContent = '+';
  const toasts = el('div', 'hud-toasts', hud);

  // --- title screen ------------------------------------------------------
  const title = el('div', 'overlay title', root);
  el('div', 'title-logo', title, 'NEON BAY');
  el('div', 'title-sub', title, 'Kota ini milikmu sebelum matahari terbenam.');
  const story = el('div', 'title-story', title);
  story.textContent = 'Kai Mercer, seorang kurir, salah mengantar paket — dan sekarang satu kota memburunya. ' +
    'Selesaikan tiga misi sebelum senja: ambil paket di dermaga, kabur dari kejaran polisi, dan antar ke Club Neon. ' +
    'Curi mobil, cari uang, dan jangan sampai tertangkap.';
  const controls = el('div', 'title-controls', title);
  const rows = [
    ['W A S D', 'Jalan / mengemudi'],
    ['Shift', 'Lari'],
    ['E', 'Curi / keluar mobil'],
    ['Klik / F', 'Tembak'],
    ['Seret mouse', 'Putar kamera'],
    ['P', 'Jeda'], ['M', 'Suara'],
  ];
  for (const [k, v] of rows) {
    const r = el('div', 'ctl-row', controls);
    el('span', 'ctl-key', r, k);
    el('span', 'ctl-desc', r, v);
  }
  const startBtn = el('button', 'btn-big', title, 'MULAI');
  const continueBtn = el('button', 'btn-big btn-ghost', title, '');
  continueBtn.style.display = 'none';
  el('div', 'title-foot', title, 'Game orisinal 100% · dibuat untuk make.fun · mainkan offline di browser desktop');

  // --- pause -------------------------------------------------------------
  const pause = el('div', 'overlay pause', root);
  pause.style.display = 'none';
  el('div', 'pause-title', pause, 'JEDA');
  const resumeBtn = el('button', 'btn-big', pause, 'LANJUTKAN');
  const menuBtn = el('button', 'btn-big btn-ghost', pause, 'MENU UTAMA');

  // --- busted / wasted ----------------------------------------------------
  const end = el('div', 'overlay end', root);
  end.style.display = 'none';
  const endTitle = el('div', 'end-title', end, '');
  const endText = el('div', 'end-text', end, '');

  let mapAt = 0;
  let endTimer = 0;

  function toast(text) {
    const t = el('div', 'toast', toasts, text);
    setTimeout(() => { if (t.parentNode) t.parentNode.removeChild(t); }, 3600);
    while (toasts.children.length > 4) toasts.removeChild(toasts.firstChild);
  }

  function drawMap(world) {
    const W = 190;
    const H = 190;
    const sx = (x) => ((x + 220) / 416) * W;
    const sz = (z) => ((z + 196) / 392) * H;
    mapCtx.fillStyle = '#0a2450';
    mapCtx.fillRect(0, 0, W, H);
    mapCtx.fillStyle = '#d9b380';
    mapCtx.fillRect(sx(-204), 0, sx(-180) - sx(-204), H);
    mapCtx.fillStyle = '#23232e';
    mapCtx.fillRect(sx(-180), 0, sx(180) - sx(-180), H);
    mapCtx.fillStyle = '#3a3a48';
    for (let bx = -144; bx <= 144; bx += 72) {
      for (let bz = -144; bz <= 144; bz += 72) {
        mapCtx.fillRect(sx(bx - 28), sz(bz - 28), sx(bx + 28) - sx(bx - 28), sz(bz + 28) - sz(bz - 28));
      }
    }
    mapCtx.fillStyle = '#5a5a68';
    for (const c of [-176, -108, -36, 36, 108, 176]) {
      mapCtx.fillRect(sx(c) - 1, 0, 2, H);
      mapCtx.fillRect(0, sz(c) - 1, W, 2);
    }
    const dot = (x, z, color, r) => {
      mapCtx.fillStyle = color;
      mapCtx.beginPath();
      mapCtx.arc(sx(x), sz(z), r, 0, Math.PI * 2);
      mapCtx.fill();
    };
    for (const pk of world.pickups) {
      if (!pk.taken) dot(pk.x, pk.z, '#59ff8a', 2);
    }
    for (const car of world.cars) {
      if (car.wreck) continue;
      if (car.kind === 'police') dot(car.x, car.z, '#ff3b30', 3);
      else if (car.kind === 'taxi') dot(car.x, car.z, '#ffc400', 3);
      else dot(car.x, car.z, '#c8c8d0', 2);
    }
    // Objective beacon.
    const b = currentBeacon(world);
    if (b) {
      const pulse = 3 + Math.sin(performance.now() / 300) * 1.5;
      dot(b.x, b.z, '#ffd23e', pulse);
      mapCtx.strokeStyle = '#ffd23e';
      mapCtx.beginPath();
      mapCtx.arc(sx(b.x), sz(b.z), pulse + 3, 0, Math.PI * 2);
      mapCtx.stroke();
    }
    // Player arrow.
    const p = world.player;
    mapCtx.save();
    mapCtx.translate(sx(p.x), sz(p.z));
    mapCtx.rotate(Math.atan2(Math.sin(p.angle), Math.cos(p.angle)) + Math.PI / 2);
    mapCtx.fillStyle = '#ffffff';
    mapCtx.beginPath();
    mapCtx.moveTo(0, -6);
    mapCtx.lineTo(4, 5);
    mapCtx.lineTo(-4, 5);
    mapCtx.closePath();
    mapCtx.fill();
    mapCtx.restore();
  }

  function currentBeacon(w) {
    if (w.mission.storyDone) return null;
    if (w.taxi.phase === 'toPassenger' || w.taxi.phase === 'toDest') return w.taxi.dest;
    const m = CFG.missions[w.mission.index];
    return { x: m.beacon[0], z: m.beacon[1] };
  }

  startBtn.addEventListener('click', () => callbacks.onStart(false));
  continueBtn.addEventListener('click', () => callbacks.onStart(true));
  resumeBtn.addEventListener('click', () => callbacks.onResume());
  menuBtn.addEventListener('click', () => callbacks.onMenu());

  return {
    showHud() { hud.style.display = 'block'; },
    hideHud() { hud.style.display = 'none'; },
    showTitle(saveText) {
      title.style.display = 'flex';
      pause.style.display = 'none';
      end.style.display = 'none';
      hud.style.display = 'none';
      if (saveText) {
        continueBtn.style.display = 'block';
        continueBtn.textContent = 'LANJUTKAN — ' + saveText;
      } else {
        continueBtn.style.display = 'none';
      }
    },
    hideTitle() { title.style.display = 'none'; },
    showPause() { pause.style.display = 'flex'; },
    hidePause() { pause.style.display = 'none'; },
    showEnd(kind, fine) {
      end.style.display = 'flex';
      if (kind === 'busted') {
        endTitle.textContent = 'TERTANGKAP!';
        endText.textContent = `Polisi menahanmu. Denda ${money(fine)} dipotong dari uangmu.`;
      } else {
        endTitle.textContent = 'TEWAS';
        endText.textContent = `Kamu tumbang. Biaya rumah sakit ${money(fine)} dipotong dari uangmu.`;
      }
      endTimer = performance.now();
    },
    hideEnd() { end.style.display = 'none'; },
    toast,
    update(world, fps, state) {
      if (state !== 'playing' && state !== 'paused') return;
      const p = world.player;
      cashEl.textContent = money(p.cash);
      const hp = Math.max(0, Math.round(p.health));
      healthBar.style.width = hp + '%';
      healthBar.style.background = hp > 50 ? '#59d867' : hp > 25 ? '#ff9a2e' : '#ff3b30';
      const stars = world.wanted.stars;
      starsEl.textContent = '★'.repeat(stars) + '☆'.repeat(5 - stars);
      starsEl.style.color = stars >= 3 ? '#ff3b30' : stars > 0 ? '#ffd23e' : '#8a8a9a';
      fpsEl.textContent = Math.round(fps) + ' FPS';
      const mt = missionText(world);
      missionTitle.textContent = mt.title;
      missionBrief.textContent = mt.brief;
      missionDist.textContent = mt.distance > 0
        ? `Jarak: ${Math.round(mt.distance)} m · Hadiah: ${money(mt.pay)}`
        : '';
      if (p.onFoot) {
        speedEl.style.display = 'none';
      } else {
        speedEl.style.display = 'block';
        speedEl.textContent = Math.round(p.speed * 3.6) + ' km/j';
      }
      const now = performance.now();
      if (now - mapAt > 100) {
        mapAt = now;
        drawMap(world);
      }
      if (end.style.display === 'flex' && now - endTimer > 2600) {
        end.style.display = 'none';
      }
    },
  };
}

function missionText(world) {
  if (world.mission.storyDone) {
    return { title: 'Bebas — Neon Bay', brief: 'Cerita selesai. Jelajahi kota, cari uang, hindari polisi.', pay: 0, distance: 0 };
  }
  const m = CFG.missions[world.mission.index];
  const p = world.player;
  return {
    title: m.title,
    brief: m.brief,
    pay: m.pay,
    distance: Math.hypot(p.x - m.beacon[0], p.z - m.beacon[1]),
  };
}
