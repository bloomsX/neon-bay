// NEON BAY — the three.js renderer. Builds the scene once from the world
// data, then syncs it from the simulation every frame. Cheap by design:
// instanced meshes for everything repeated, one merged car geometry, no
// shadow maps, no per-frame allocation in the hot path.
import * as THREE from '../vendor/three.module.min.js';
import { CFG } from './config.js';
import { makeRng, hashString, clamp, lerp } from './random.js';

const ROAD_LINES = [-176, -108, -36, 36, 108, 176];
const BLOCK_CENTRES = [-144, -72, 0, 72, 144];

// Append a coloured box to the part arrays (positions, normals, colours,
// indices). Used to merge a whole car / pedestrian into one geometry.
function boxPart(P, N, C, I, cx, cy, cz, sx, sy, sz, r, g, b) {
  const base = P.length / 3;
  const hx = sx / 2, hy = sy / 2, hz = sz / 2;
  const corners = [
    [-hx, -hy, -hz], [hx, -hy, -hz], [hx, hy, -hz], [-hx, hy, -hz],
    [-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz],
  ];
  const faces = [
    [0, 1, 2, 3, 0, 0, -1], [4, 7, 6, 5, 0, 0, 1],
    [0, 4, 5, 1, 0, -1, 0], [3, 2, 6, 7, 0, 1, 0],
    [0, 3, 7, 4, -1, 0, 0], [1, 5, 6, 2, 1, 0, 0],
  ];
  for (const f of faces) {
    const idx = [f[0], f[1], f[2], f[3]];
    for (const ci of idx) {
      const c = corners[ci];
      P.push(cx + c[0], cy + c[1], cz + c[2]);
      N.push(f[4], f[5], f[6]);
      C.push(r, g, b);
    }
    I.push(base + idx[0], base + idx[1], base + idx[2], base + idx[0], base + idx[2], base + idx[3]);
  }
}

function mergedGeometry(parts) {
  const P = [], N = [], C = [], I = [];
  for (const part of parts) boxPart(P, N, C, I, ...part);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  g.setIndex(I);
  return g;
}

function carGeometry() {
  return mergedGeometry([
    // Body (white: the instance colour tints it).
    [0, 0.62, 0, 4.4, 0.75, 2.0, 1, 1, 1],
    // Cabin (dark glass).
    [-0.2, 1.28, 0, 2.2, 0.62, 1.7, 0.10, 0.12, 0.18],
    // Wheels (near black).
    [1.5, 0.35, 0.95, 0.7, 0.7, 0.35, 0.05, 0.05, 0.05],
    [1.5, 0.35, -0.95, 0.7, 0.7, 0.35, 0.05, 0.05, 0.05],
    [-1.5, 0.35, 0.95, 0.7, 0.7, 0.35, 0.05, 0.05, 0.05],
    [-1.5, 0.35, -0.95, 0.7, 0.7, 0.35, 0.05, 0.05, 0.05],
    // Bumpers.
    [2.2, 0.5, 0, 0.25, 0.3, 1.9, 0.15, 0.15, 0.15],
    [-2.2, 0.5, 0, 0.25, 0.3, 1.9, 0.15, 0.15, 0.15],
  ]);
}

function pedGeometry() {
  return mergedGeometry([
    // Legs.
    [0, 0.35, 0, 0.5, 0.7, 0.32, 0.12, 0.12, 0.16],
    // Torso (white: tinted by the instance colour).
    [0, 1.05, 0, 0.62, 0.72, 0.36, 1, 1, 1],
    // Head (skin).
    [0, 1.62, 0, 0.36, 0.36, 0.36, 0.82, 0.62, 0.45],
    // Arms.
    [-0.36, 1.05, 0, 0.14, 0.6, 0.14, 1, 1, 1],
    [0.36, 1.05, 0, 0.14, 0.6, 0.14, 1, 1, 1],
  ]);
}

function gradientTexture(stops, w = 16, h = 512) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  for (const [at, color] of stops) grad.addColorStop(at, color);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function radialTexture(inner, outer, size = 128) {
  const cv = document.createElement('canvas');
  cv.width = size; cv.height = size;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function signTexture(text, color) {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 128;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = 'rgba(8, 6, 18, 0.92)';
  ctx.fillRect(0, 0, 512, 128);
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.strokeRect(6, 6, 500, 116);
  ctx.font = 'bold 64px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = color;
  ctx.shadowBlur = 26;
  ctx.fillStyle = color;
  ctx.fillText(text, 256, 66);
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, 256, 66);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function groundTexture(world) {
  const S = 1024;
  const cv = document.createElement('canvas');
  cv.width = S; cv.height = S;
  const ctx = cv.getContext('2d');
  const X = (x) => ((x + 220) / 416) * S;
  const Z = (z) => ((z + 196) / 392) * S;
  const rng = makeRng(hashString('ground') + world.seed);
  // Ocean.
  ctx.fillStyle = '#0a2450';
  ctx.fillRect(0, 0, S, S);
  ctx.strokeStyle = 'rgba(120, 180, 255, 0.25)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 40; i++) {
    const y = rng() * S;
    const x0 = rng() * X(-204) * 0.7;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x0 + 30 + rng() * 90, y);
    ctx.stroke();
  }
  // Beach.
  const sand = ctx.createLinearGradient(X(-204), 0, X(-180), 0);
  sand.addColorStop(0, '#c9a06a');
  sand.addColorStop(1, '#e0bd85');
  ctx.fillStyle = sand;
  ctx.fillRect(X(-204), 0, X(-180) - X(-204), S);
  ctx.fillStyle = 'rgba(120, 80, 40, 0.35)';
  for (let i = 0; i < 160; i++) {
    ctx.fillRect(X(-204) + rng() * (X(-180) - X(-204)), rng() * S, 2, 2);
  }
  // City asphalt.
  ctx.fillStyle = '#23232e';
  ctx.fillRect(X(-180), 0, X(180) - X(-180), S);
  // Blocks: sidewalk ring + interior (park green / lot grey / building base).
  for (let bi = 0; bi < 5; bi++) {
    for (let bj = 0; bj < 5; bj++) {
      const bx = BLOCK_CENTRES[bi];
      const bz = BLOCK_CENTRES[bj];
      const district = world.city.buildings.length ? districtOfBlock(bi - 2, bj - 2) : 'oldtown';
      ctx.fillStyle = '#3a3a48';
      ctx.fillRect(X(bx - 28), Z(bz - 28), X(bx + 28) - X(bx - 28), Z(bz + 28) - Z(bz - 28));
      if (district === 'park') ctx.fillStyle = '#2d5a34';
      else if (district === 'lot') ctx.fillStyle = '#33333e';
      else ctx.fillStyle = '#2e2e3c';
      ctx.fillRect(X(bx - 26), Z(bz - 26), X(bx + 26) - X(bx - 26), Z(bz + 26) - Z(bz - 26));
      if (district === 'lot') {
        ctx.strokeStyle = 'rgba(220, 220, 220, 0.5)';
        ctx.lineWidth = 2;
        for (let s = -18; s <= 18; s += 6) {
          ctx.beginPath();
          ctx.moveTo(X(bx + s), Z(bz - 20));
          ctx.lineTo(X(bx + s), Z(bz - 8));
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(X(bx + s), Z(bz + 8));
          ctx.lineTo(X(bx + s), Z(bz + 20));
          ctx.stroke();
        }
      }
    }
  }
  // Lane dashes along every road.
  ctx.fillStyle = '#d8b13a';
  for (const c of ROAD_LINES) {
    for (let z = -176; z < 176; z += 12) {
      ctx.fillRect(X(c) - 1, Z(z), 2, 6);
    }
    for (let x = -176; x < 176; x += 12) {
      ctx.fillRect(X(x), Z(c) - 1, 6, 2);
    }
  }
  // Crosswalks at intersections.
  ctx.fillStyle = 'rgba(240, 240, 240, 0.75)';
  for (const rx of ROAD_LINES) {
    for (const rz of ROAD_LINES) {
      for (let s = -6; s <= 6; s += 4) {
        ctx.fillRect(X(rx + s) - 1, Z(rz - 11), 2, 5);
        ctx.fillRect(X(rx + s) - 1, Z(rz + 6), 2, 5);
        ctx.fillRect(X(rx - 11), Z(rz + s) - 1, 5, 2);
        ctx.fillRect(X(rx + 6), Z(rz + s) - 1, 5, 2);
      }
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function districtOfBlock(bx, bz) {
  if (bx >= 0 && Math.abs(bz) <= 1) return 'downtown';
  if (bx <= -1 && bz <= -1) return 'docks';
  if ((bx === 1 && bz === 2) || (bx === -1 && bz === 1)) return 'park';
  if ((bx === 2 && bz === -2) || (bx === -2 && bz === 2)) return 'lot';
  return 'oldtown';
}

export function createRenderer(canvas, world) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  const maxRatio = Math.min(window.devicePixelRatio || 1, 2);
  let pixelRatio = maxRatio;
  let lockedRatio = null;
  renderer.setPixelRatio(pixelRatio);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x2a1638, 130, 430);
  scene.background = gradientTexture([
    [0, '#160b2e'], [0.35, '#5b2350'], [0.55, '#c14a5e'],
    [0.7, '#ff8a3d'], [0.78, '#ffb37a'], [1, '#3a1c40'],
  ]);

  const camera = new THREE.PerspectiveCamera(CFG.camFov, 1, 0.1, 900);

  const hemi = new THREE.HemisphereLight(0xffb37a, 0x2a1f3d, 1.5);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xff9a4d, 1.8);
  sun.position.set(-120, 80, 40);
  scene.add(sun);
  scene.add(new THREE.AmbientLight(0x403060, 0.5));

  // Sun disc low over the ocean.
  const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: radialTexture('rgba(255, 240, 200, 1)', 'rgba(255, 120, 40, 0)'),
    blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
  }));
  sunSprite.position.set(-380, 58, 10);
  sunSprite.scale.set(150, 150, 1);
  scene.add(sunSprite);

  // Ground.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(416, 392),
    new THREE.MeshLambertMaterial({ map: groundTexture(world) }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(-12, 0, 0);
  scene.add(ground);

  // Animated ocean swell: two scrolling translucent streak layers.
  const oceanLayers = [];
  {
    const tex = new THREE.CanvasTexture(streakCanvas());
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(3, 6);
    for (let i = 0; i < 2; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: tex.clone(), transparent: true, opacity: 0.22,
        depthWrite: false, blending: THREE.AdditiveBlending,
      });
      mat.map.repeat.set(3, 6);
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(46, 392), mat);
      plane.rotation.x = -Math.PI / 2;
      plane.position.set(-200 + i * 14, 0.25 + i * 0.12, 0);
      scene.add(plane);
      oceanLayers.push({ mesh: plane, speed: 0.008 + i * 0.005 });
    }
  }
  function streakCanvas() {
    const cv = document.createElement('canvas');
    cv.width = 128; cv.height = 128;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, 128, 128);
    const rng = makeRng(77);
    ctx.strokeStyle = 'rgba(160, 200, 255, 0.8)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 26; i++) {
      const y = rng() * 128;
      const x = rng() * 90;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 12 + rng() * 26, y);
      ctx.stroke();
    }
    return cv;
  }

  // Buildings + windows (instanced).
  const buildings = world.city.buildings;
  const buildingMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshLambertMaterial({ color: 0xffffff }),
    Math.max(1, buildings.length),
  );
  buildingMesh.frustumCulled = false;
  {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const col = new THREE.Color();
    buildings.forEach((b, i) => {
      p.set(b.x, b.h / 2, b.z);
      s.set(b.w, b.h, b.d);
      m.compose(p, q, s);
      buildingMesh.setMatrixAt(i, m);
      if (b.district === 'downtown') col.setHSL(0.72 + b.hue * 0.08, 0.32, 0.42 + b.hue * 0.18);
      else if (b.district === 'docks') col.setHSL(0.08, 0.25, 0.38 + b.hue * 0.12);
      else col.setHSL(0.06 + b.hue * 0.12, 0.35, 0.5 + b.hue * 0.14);
      buildingMesh.setColorAt(i, col);
    });
  }
  scene.add(buildingMesh);

  // Windows: two faces per building, capped so the count stays sane.
  const windowSpots = [];
  {
    const rng = makeRng(hashString('windows') + world.seed);
    for (const b of buildings) {
      const floors = Math.min(8, Math.max(1, Math.floor(b.h / 4)));
      const colsEW = Math.min(5, Math.max(1, Math.floor(b.w / 3.4)));
      const colsNS = Math.min(5, Math.max(1, Math.floor(b.d / 3.4)));
      let made = 0;
      const cap = 64;
      for (let f = 0; f < floors && made < cap; f++) {
        const y = 2.6 + f * 3.6;
        if (y > b.h - 1.5) break;
        for (let c = 0; c < colsEW && made < cap; c++) {
          const z = b.z - b.d / 2 + ((c + 0.5) / colsEW) * b.d;
          windowSpots.push({ x: b.x + b.w / 2 + 0.07, y, z, ry: Math.PI / 2, lit: rng() < 0.55 });
          windowSpots.push({ x: b.x - b.w / 2 - 0.07, y, z, ry: -Math.PI / 2, lit: rng() < 0.55 });
          made += 2;
        }
        for (let c = 0; c < colsNS && made < cap; c++) {
          const x = b.x - b.w / 2 + ((c + 0.5) / colsNS) * b.w;
          windowSpots.push({ x, y, z: b.z + b.d / 2 + 0.07, ry: 0, lit: rng() < 0.55 });
          windowSpots.push({ x, y, z: b.z - b.d / 2 - 0.07, ry: Math.PI, lit: rng() < 0.55 });
          made += 2;
        }
      }
    }
  }
  const windowMesh = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1.3, 1.7),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
    Math.max(1, windowSpots.length),
  );
  windowMesh.frustumCulled = false;
  {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const s = new THREE.Vector3(1, 1, 1);
    const p = new THREE.Vector3();
    const col = new THREE.Color();
    windowSpots.forEach((w, i) => {
      p.set(w.x, w.y, w.z);
      e.set(0, w.ry, 0);
      q.setFromEuler(e);
      m.compose(p, q, s);
      windowMesh.setMatrixAt(i, m);
      col.set(w.lit ? 0xffd27a : 0x141a2a);
      windowMesh.setColorAt(i, col);
    });
  }
  scene.add(windowMesh);

  // Neon signs.
  const signs = world.city.signs.map((sg, i) => {
    const tex = signTexture(sg.text, sg.color);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
    const w = Math.min(18, sg.w * 0.8);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, 3), mat);
    mesh.position.set(sg.x + sg.w / 2 + 0.16, sg.h * 0.72, sg.z);
    mesh.rotation.y = Math.PI / 2;
    scene.add(mesh);
    return { mesh, mat, base: new THREE.Color(0xffffff), phase: i * 1.3 };
  });

  // Palms: trunks + canopies.
  const palms = world.city.palms;
  const trunkMesh = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.16, 0.3, 5, 6),
    new THREE.MeshLambertMaterial({ color: 0x6b4a2a }),
    Math.max(1, palms.length),
  );
  trunkMesh.frustumCulled = false;
  const leafMesh = new THREE.InstancedMesh(
    new THREE.ConeGeometry(2.3, 2.6, 6),
    new THREE.MeshLambertMaterial({ color: 0x2e7a3a }),
    Math.max(1, palms.length),
  );
  leafMesh.frustumCulled = false;
  {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    palms.forEach((pl, i) => {
      p.set(pl.x, 2.5 * pl.s, pl.z);
      s.set(pl.s, pl.s, pl.s);
      m.compose(p, q, s);
      trunkMesh.setMatrixAt(i, m);
      p.set(pl.x, 5.4 * pl.s, pl.z);
      s.set(pl.s, pl.s * 0.62, pl.s);
      m.compose(p, q, s);
      leafMesh.setMatrixAt(i, m);
    });
  }
  scene.add(trunkMesh);
  scene.add(leafMesh);

  // Streetlights: poles + glowing lamps.
  const lights = world.city.lights;
  const poleMesh = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.09, 0.13, 6, 6),
    new THREE.MeshLambertMaterial({ color: 0x22222a }),
    Math.max(1, lights.length),
  );
  poleMesh.frustumCulled = false;
  const lampMesh = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.3, 6, 4),
    new THREE.MeshBasicMaterial({ color: 0xffd9a0 }),
    Math.max(1, lights.length),
  );
  lampMesh.frustumCulled = false;
  {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3(1, 1, 1);
    const p = new THREE.Vector3();
    lights.forEach((l, i) => {
      p.set(l.x, 3, l.z);
      m.compose(p, q, s);
      poleMesh.setMatrixAt(i, m);
      p.set(l.x, 6.1, l.z);
      m.compose(p, q, s);
      lampMesh.setMatrixAt(i, m);
    });
  }
  scene.add(poleMesh);
  scene.add(lampMesh);

  // Cars: one merged geometry, one instanced mesh, colour per car.
  const MAX_CARS = 44;
  const carMesh = new THREE.InstancedMesh(
    carGeometry(),
    new THREE.MeshLambertMaterial({ vertexColors: true }),
    MAX_CARS,
  );
  carMesh.frustumCulled = false;
  const lightBarMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1.6, 0.28, 0.5),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
    8,
  );
  lightBarMesh.frustumCulled = false;
  scene.add(carMesh);
  scene.add(lightBarMesh);

  // Pedestrians.
  const MAX_PEDS = 64;
  const pedMesh = new THREE.InstancedMesh(
    pedGeometry(),
    new THREE.MeshLambertMaterial({ vertexColors: true }),
    MAX_PEDS,
  );
  pedMesh.frustumCulled = false;
  scene.add(pedMesh);

  // Soft blobs of shadow under cars and peds.
  const MAX_SHADOWS = 110;
  const shadowMesh = new THREE.InstancedMesh(
    new THREE.CircleGeometry(1, 12),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false }),
    MAX_SHADOWS,
  );
  shadowMesh.frustumCulled = false;
  scene.add(shadowMesh);

  // Mission beacon: light pillar + floating marker.
  const beacon = new THREE.Mesh(
    new THREE.CylinderGeometry(2.2, 2.2, 60, 12, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xffd23e, transparent: true, opacity: 0.2,
      side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
    }),
  );
  beacon.visible = false;
  scene.add(beacon);
  const marker = new THREE.Mesh(
    new THREE.OctahedronGeometry(1.1),
    new THREE.MeshBasicMaterial({ color: 0xffd23e }),
  );
  marker.visible = false;
  scene.add(marker);

  // Shot tracer + muzzle flash.
  const tracerGeo = new THREE.BufferGeometry();
  tracerGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
  const tracer = new THREE.Line(tracerGeo, new THREE.LineBasicMaterial({ color: 0xfff2a0, transparent: true, opacity: 0.9 }));
  tracer.visible = false;
  tracer.frustumCulled = false;
  scene.add(tracer);
  const flash = new THREE.Sprite(new THREE.SpriteMaterial({
    map: radialTexture('rgba(255, 250, 200, 1)', 'rgba(255, 160, 40, 0)'),
    blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
  }));
  flash.scale.set(2.2, 2.2, 1);
  flash.visible = false;
  scene.add(flash);

  // Particle pool: smoke, sparks, explosion debris.
  const MAX_PARTICLES = 96;
  const particleMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.32, 0.32, 0.32),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }),
    MAX_PARTICLES,
  );
  particleMesh.frustumCulled = false;
  scene.add(particleMesh);
  const particles = [];
  for (let i = 0; i < MAX_PARTICLES; i++) {
    particles.push({ x: 0, y: -10, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, size: 1, r: 1, g: 1, b: 1 });
  }
  let particleCursor = 0;
  function spawnParticle(x, y, z, vx, vy, vz, life, size, r, g, b) {
    const pt = particles[particleCursor];
    particleCursor = (particleCursor + 1) % MAX_PARTICLES;
    pt.x = x; pt.y = y; pt.z = z;
    pt.vx = vx; pt.vy = vy; pt.vz = vz;
    pt.life = life; pt.max = life; pt.size = size;
    pt.r = r; pt.g = g; pt.b = b;
  }
  const rngVisual = makeRng(hashString('visual') + world.seed);

  // The player on foot is a pedestrian instance with a bright coat.
  const tmpM = new THREE.Matrix4();
  const tmpQ = new THREE.Quaternion();
  const tmpE = new THREE.Euler();
  const tmpV = new THREE.Vector3();
  const tmpS = new THREE.Vector3();
  const tmpC = new THREE.Color();
  const zeroM = new THREE.Matrix4().makeScale(0, 0, 0);

  let camPos = new THREE.Vector3(-167, 4, 0);
  let fovCur = CFG.camFov;
  let fpsEma = 30;
  let adaptAt = 0;

  function updateInstances(t, dt) {
    const p = world.player;
    // Cars.
    let ci = 0;
    for (const car of world.cars) {
      if (ci >= MAX_CARS) break;
      if (car.wreck) {
        // A wreck sits low and smokes.
        tmpE.set(0, -car.angle, 0.06);
        tmpQ.setFromEuler(tmpE);
        tmpV.set(car.x, 0.28, car.z);
        tmpS.set(1, 0.82, 1);
        if (rngVisual() < dt * 6) {
          spawnParticle(car.x, 1.2, car.z, (rngVisual() - 0.5) * 1.2, 1.5 + rngVisual(), (rngVisual() - 0.5) * 1.2, 1.6, 1.6, 0.25, 0.25, 0.25);
        }
      } else {
        tmpE.set(0, -car.angle, 0);
        tmpQ.setFromEuler(tmpE);
        tmpV.set(car.x, 0, car.z);
        tmpS.set(1, 1, 1);
      }
      tmpM.compose(tmpV, tmpQ, tmpS);
      carMesh.setMatrixAt(ci, tmpM);
      tmpC.setHex(car.color);
      carMesh.setColorAt(ci, tmpC);
      ci++;
    }
    for (; ci < MAX_CARS; ci++) carMesh.setMatrixAt(ci, zeroM);
    carMesh.instanceMatrix.needsUpdate = true;
    if (carMesh.instanceColor) carMesh.instanceColor.needsUpdate = true;
    // Police light bars flash red/blue.
    let li = 0;
    const redOn = Math.floor(t * 2.5) % 2 === 0;
    for (const car of world.cars) {
      if (li >= 8 || car.kind !== 'police' || car.wreck) continue;
      tmpE.set(0, -car.angle, 0);
      tmpQ.setFromEuler(tmpE);
      tmpV.set(car.x - Math.cos(car.angle) * 0.2, 1.62, car.z - Math.sin(car.angle) * 0.2);
      tmpS.set(1, 1, 1);
      tmpM.compose(tmpV, tmpQ, tmpS);
      lightBarMesh.setMatrixAt(li, tmpM);
      tmpC.set(redOn ? 0xff2a2a : 0x2a5aff);
      lightBarMesh.setColorAt(li, tmpC);
      li++;
    }
    for (; li < 8; li++) lightBarMesh.setMatrixAt(li, zeroM);
    lightBarMesh.instanceMatrix.needsUpdate = true;
    if (lightBarMesh.instanceColor) lightBarMesh.instanceColor.needsUpdate = true;
    // Pedestrians (and the player on foot).
    let pi = 0;
    for (const ped of world.peds) {
      if (pi >= MAX_PEDS) break;
      const bob = ped.state === 'walk' ? Math.abs(Math.sin(t * 6 + ped.id)) * 0.06 : 0;
      if (ped.state === 'fallen') {
        tmpE.set(Math.PI / 2, 0, 0);
        tmpQ.setFromEuler(tmpE);
        tmpV.set(ped.x, 0.35, ped.z);
      } else {
        tmpE.set(0, -ped.angle, 0);
        tmpQ.setFromEuler(tmpE);
        tmpV.set(ped.x, bob, ped.z);
      }
      tmpS.set(1, 1, 1);
      tmpM.compose(tmpV, tmpQ, tmpS);
      pedMesh.setMatrixAt(pi, tmpM);
      tmpC.setHex(ped.color);
      pedMesh.setColorAt(pi, tmpC);
      pi++;
    }
    if (p.onFoot && pi < MAX_PEDS) {
      tmpE.set(0, -p.angle, 0);
      tmpQ.setFromEuler(tmpE);
      tmpV.set(p.x, 0, p.z);
      tmpS.set(1, 1, 1);
      tmpM.compose(tmpV, tmpQ, tmpS);
      pedMesh.setMatrixAt(pi, tmpM);
      tmpC.setHex(0xffd23e);
      pedMesh.setColorAt(pi, tmpC);
      pi++;
    }
    for (; pi < MAX_PEDS; pi++) pedMesh.setMatrixAt(pi, zeroM);
    pedMesh.instanceMatrix.needsUpdate = true;
    if (pedMesh.instanceColor) pedMesh.instanceColor.needsUpdate = true;
    // Shadows.
    let si = 0;
    const putShadow = (x, z, sx, sz) => {
      if (si >= MAX_SHADOWS) return;
      tmpE.set(-Math.PI / 2, 0, 0);
      tmpQ.setFromEuler(tmpE);
      tmpV.set(x, 0.04, z);
      tmpS.set(sx, sz, 1);
      tmpM.compose(tmpV, tmpQ, tmpS);
      shadowMesh.setMatrixAt(si, tmpM);
      si++;
    };
    for (const car of world.cars) putShadow(car.x, car.z, 2.6, 1.5);
    for (const ped of world.peds) if (ped.state !== 'fallen') putShadow(ped.x, ped.z, 0.7, 0.7);
    if (p.onFoot) putShadow(p.x, p.z, 0.8, 0.8);
    for (; si < MAX_SHADOWS; si++) shadowMesh.setMatrixAt(si, zeroM);
    shadowMesh.instanceMatrix.needsUpdate = true;
    // Particles.
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const pt = particles[i];
      if (pt.life > 0) {
        pt.life -= dt;
        pt.x += pt.vx * dt;
        pt.y += pt.vy * dt;
        pt.z += pt.vz * dt;
        pt.vy += 0.6 * dt;
        const s = Math.max(0.01, pt.size * (0.4 + 0.6 * (pt.life / pt.max)));
        tmpE.set(0, 0, 0);
        tmpQ.setFromEuler(tmpE);
        tmpV.set(pt.x, Math.max(0.2, pt.y), pt.z);
        tmpS.set(s, s, s);
        tmpM.compose(tmpV, tmpQ, tmpS);
        particleMesh.setMatrixAt(i, tmpM);
        tmpC.setRGB(pt.r, pt.g, pt.b);
        particleMesh.setColorAt(i, tmpC);
      } else {
        particleMesh.setMatrixAt(i, zeroM);
      }
    }
    particleMesh.instanceMatrix.needsUpdate = true;
    if (particleMesh.instanceColor) particleMesh.instanceColor.needsUpdate = true;
  }

  function syncCamera(dt) {
    const p = world.player;
    const driving = !p.onFoot;
    const dist = driving ? CFG.camCarDist : CFG.camFootDist;
    const height = driving ? CFG.camCarHeight : CFG.camFootHeight;
    const ox = Math.sin(p.camYaw);
    const oz = Math.cos(p.camYaw);
    const want = new THREE.Vector3(p.x + ox * dist, height + 1.2, p.z + oz * dist);
    // Keep the camera out of buildings: lift it above any roof it sits under.
    for (const b of world.city.buildings) {
      if (Math.abs(want.x - b.x) < b.w / 2 + 1 && Math.abs(want.z - b.z) < b.d / 2 + 1) {
        if (want.y < b.h + 1.5) want.y = b.h + 1.5;
      }
    }
    want.x = clamp(want.x, CFG.boundXMin - 24, CFG.boundXMax + 16);
    want.z = clamp(want.z, CFG.boundZMin - 16, CFG.boundZMax + 16);
    const a = 1 - Math.pow(0.002, dt);
    camPos.lerp(want, a);
    const shake = world.shake * 0.35;
    camera.position.set(
      camPos.x + (Math.random() - 0.5) * shake,
      camPos.y + (Math.random() - 0.5) * shake,
      camPos.z + (Math.random() - 0.5) * shake,
    );
    const look = new THREE.Vector3(p.x - ox * 3, 1.6, p.z - oz * 3);
    camera.lookAt(look);
    const targetFov = driving ? lerp(CFG.camFov, CFG.camFovFast, clamp(p.speed / 40, 0, 1)) : CFG.camFov;
    fovCur = lerp(fovCur, targetFov, 1 - Math.pow(0.01, dt));
    if (Math.abs(camera.fov - fovCur) > 0.05) {
      camera.fov = fovCur;
      camera.updateProjectionMatrix();
    }
  }

  function resize(w, h) {
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function render(dt, t) {
    // Beacon follows the current objective (mission or taxi).
    const beaconPos = currentBeacon(world);
    if (beaconPos) {
      beacon.visible = true;
      marker.visible = true;
      beacon.position.set(beaconPos.x, 30, beaconPos.z);
      marker.position.set(beaconPos.x, 6 + Math.sin(t * 2) * 0.6, beaconPos.z);
      marker.rotation.y = t * 1.5;
    } else {
      beacon.visible = false;
      marker.visible = false;
    }
    // Ocean scroll + sign pulse.
    for (const layer of oceanLayers) {
      layer.mesh.material.map.offset.x += layer.speed * dt;
    }
    for (const sg of signs) {
      const pulse = 0.82 + 0.18 * Math.sin(t * 2 + sg.phase);
      sg.mat.color.setScalar(pulse);
    }
    // Shot tracer + muzzle flash, briefly.
    const shot = world.lastShot;
    if (shot && world.time - shot.at < 0.09) {
      tracer.visible = true;
      const pos = tracerGeo.attributes.position;
      pos.setXYZ(0, shot.from[0], shot.from[1], shot.from[2]);
      pos.setXYZ(1, shot.to[0], shot.to[1], shot.to[2]);
      pos.needsUpdate = true;
      flash.visible = true;
      flash.position.set(shot.from[0], shot.from[1], shot.from[2]);
    } else {
      tracer.visible = false;
      flash.visible = false;
    }
    updateInstances(t, dt);
    syncCamera(dt);
    renderer.render(scene, camera);
  }

  function currentBeacon(w) {
    if (w.mission.storyDone) return null;
    if (w.taxi.phase === 'toPassenger' || w.taxi.phase === 'toDest') return w.taxi.dest;
    const m = CFG.missions[w.mission.index];
    return { x: m.beacon[0], z: m.beacon[1] };
  }

  function adapt(fps, now) {
    fpsEma = fpsEma * 0.9 + fps * 0.1;
    if (lockedRatio !== null) return;
    if (now - adaptAt < 2) return;
    adaptAt = now;
    // Adaptive resolution: on hardware too weak to hold 22 FPS at 1x, drop
    // below 1x (0.75, then 0.5) instead of stuttering. Real GPUs hold 2x;
    // screenshots lock the ratio at 2, so this never touches them.
    const steps = [2, 1.5, 1.25, 1, 0.75, 0.5];
    const idx = steps.indexOf(pixelRatio);
    if (fpsEma < 22 && idx < steps.length - 1) {
      pixelRatio = steps[idx + 1];
      renderer.setPixelRatio(pixelRatio);
    } else if (fpsEma > 42 && idx > 0) {
      pixelRatio = steps[idx - 1];
      renderer.setPixelRatio(pixelRatio);
    }
  }

  return {
    renderer, scene, camera,
    render, resize,
    getInfo: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles }),
    getPixelRatio: () => pixelRatio,
    lockRatio: (v) => {
      lockedRatio = v;
      if (v !== null) {
        pixelRatio = v;
        renderer.setPixelRatio(v);
      }
    },
    adapt,
    explode: (x, y, z) => {
      for (let i = 0; i < 22; i++) {
        const a = rngVisual() * Math.PI * 2;
        const sp = 3 + rngVisual() * 9;
        spawnParticle(x, y + 0.5, z, Math.cos(a) * sp, 2 + rngVisual() * 6, Math.sin(a) * sp,
          0.7 + rngVisual() * 0.8, 1 + rngVisual() * 1.6,
          1, 0.45 + rngVisual() * 0.4, 0.1);
      }
      for (let i = 0; i < 10; i++) {
        spawnParticle(x, y + 1, z, (rngVisual() - 0.5) * 2, 1 + rngVisual() * 2, (rngVisual() - 0.5) * 2,
          1.5 + rngVisual(), 2 + rngVisual(), 0.3, 0.3, 0.3);
      }
    },
    spark: (x, y, z) => {
      for (let i = 0; i < 8; i++) {
        spawnParticle(x, y, z, (rngVisual() - 0.5) * 6, rngVisual() * 4, (rngVisual() - 0.5) * 6,
          0.3 + rngVisual() * 0.3, 0.6, 1, 0.8, 0.3);
      }
    },
  };
}
