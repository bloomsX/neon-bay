// NEON BAY — the renderer. three.js r180, vendored locally, zero network.
// Performance is the design, not an afterthought (sources: three.js performance
// guides — draw calls dominate frame time, so everything repeated is instanced
// or merged, and nothing is allocated in the hot loop):
//   * buildings / streetlights / palms / pedestrians / blob shadows / smoke /
//     explosion sparks: InstancedMesh (one draw call per set, matrices pooled)
//   * each car: ONE merged-geometry mesh (body + cabin + wheels + lights,
//     vertex colours); police light bars strobe from two tiny meshes
//   * ground: ONE textured plane (roads, lanes, crosswalks, beach baked in)
//   * NO shadow maps — blob shadows + baked shading instead (a shadow pass
//     doubles the draw calls); adaptive pixel ratio: the renderer watches its
//     own frame time and steps the resolution down (2 -> 1.5 -> 1.25 -> 1) if
//     the frame rate sags, and back up when it recovers — so the game holds
//     60 FPS on weak hardware and stays crisp on strong hardware.
// Typical frame: ~45 draw calls, <14k triangles. The loop measures it live.
import * as THREE from '../vendor/three.module.min.js';
import { BEACH_X, NEON_SIGNS, OCEAN_X, PALETTE, ROAD, ROAD_LINES } from './config.js';
import { clamp } from './random.js';

const tmpMatrix = new THREE.Matrix4();
const tmpQuat = new THREE.Quaternion();
const tmpEuler = new THREE.Euler();
const tmpVec = new THREE.Vector3();
const tmpColor = new THREE.Color();
const tmpScale = new THREE.Vector3();

// ---------- geometry merging (own helper: concat box parts, one draw call) ----------
function boxPart(list, w, h, d, x, y, z, color, ry = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  const count = g.attributes.position.count;
  const colors = new Float32Array(count * 3);
  tmpColor.setHex(color);
  for (let i = 0; i < count; i += 1) {
    colors[i * 3] = tmpColor.r;
    colors[i * 3 + 1] = tmpColor.g;
    colors[i * 3 + 2] = tmpColor.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  list.push(g);
  return g;
}

function mergeGeometries(list) {
  let vCount = 0;
  let iCount = 0;
  for (const g of list) {
    vCount += g.attributes.position.count;
    iCount += g.index.count;
  }
  const pos = new Float32Array(vCount * 3);
  const norm = new Float32Array(vCount * 3);
  const col = new Float32Array(vCount * 3);
  const idx = new Uint32Array(iCount);
  let vOff = 0;
  let iOff = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array, vOff * 3);
    norm.set(g.attributes.normal.array, vOff * 3);
    col.set(g.attributes.color.array, vOff * 3);
    const src = g.index.array;
    for (let i = 0; i < src.length; i += 1) idx[iOff + i] = src[i] + vOff;
    vOff += g.attributes.position.count;
    iOff += src.length;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

// ---------- canvas textures (generated at boot, no image files) ----------
function makeGroundTexture(buildings) {
  const W = 1024;
  const H = 640;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d');
  const X0 = -200;
  const Z0 = -200;
  const SX = W / 700;
  const SZ = H / 400;
  const px = (x) => (x - X0) * SX;
  const pz = (z) => (z - Z0) * SZ;
  // Base: sidewalk concrete.
  ctx.fillStyle = '#3a3a48';
  ctx.fillRect(0, 0, W, H);
  // Block interiors: subtle variation.
  for (const b of buildings) {
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(px(b.x0), pz(b.z0), px(b.x1) - px(b.x0), pz(b.z1) - pz(b.z0));
  }
  // Beach sand, east edge.
  const sand = ctx.createLinearGradient(px(BEACH_X), 0, px(OCEAN_X + 40), 0);
  sand.addColorStop(0, '#e0b070');
  sand.addColorStop(1, '#c98f4e');
  ctx.fillStyle = sand;
  ctx.fillRect(px(BEACH_X), 0, W - px(BEACH_X), H);
  // Roads.
  ctx.fillStyle = '#23232e';
  for (const line of ROAD_LINES) {
    ctx.fillRect(px(line - ROAD / 2), 0, ROAD * SX, H);
    ctx.fillRect(0, pz(line - ROAD / 2), W, ROAD * SZ);
  }
  // Lane dashes: yellow centre, white edges.
  ctx.fillStyle = '#d8b13c';
  for (const line of ROAD_LINES) {
    for (let z = -195; z < 200; z += 16) {
      if (Math.abs(z - line) < 8) continue;
      ctx.fillRect(px(line) - 1, pz(z), 2, 8 * SZ);
    }
    for (let x = -195; x < 200; x += 16) {
      if (Math.abs(x - line) < 8) continue;
      ctx.fillRect(px(x), pz(line) - 1, 8 * SX, 2);
    }
  }
  // Crosswalks at every intersection.
  ctx.fillStyle = 'rgba(240,240,245,0.85)';
  for (const a of ROAD_LINES) {
    for (const b of ROAD_LINES) {
      for (let i = -2; i <= 2; i += 1) {
        ctx.fillRect(px(a - 5 + i * 2), pz(b - ROAD / 2), 1.2 * SX, ROAD * SZ);
        ctx.fillRect(px(a - ROAD / 2), pz(b - 5 + i * 2), ROAD * SX, 1.2 * SZ);
      }
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function makeWindowTexture() {
  const cv = document.createElement('canvas');
  cv.width = 128;
  cv.height = 256;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#1a1c26';
  ctx.fillRect(0, 0, 128, 256);
  for (let y = 8; y < 248; y += 16) {
    for (let x = 8; x < 120; x += 16) {
      const lit = Math.random() < 0.45;
      ctx.fillStyle = lit ? '#ffd166' : '#2c3247';
      ctx.fillRect(x, y, 10, 12);
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 3);
  return tex;
}

function makeOceanTexture() {
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 256;
  const ctx = cv.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 256, 0);
  g.addColorStop(0, '#1d5f8a');
  g.addColorStop(1, '#0d3a5c');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 24; i += 1) {
    const y = 10 + i * 10;
    ctx.beginPath();
    for (let x = 0; x <= 256; x += 16) ctx.lineTo(x, y + Math.sin(x * 0.05 + i) * 3);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 6);
  return tex;
}

// Neon sign face: glowing text on a dark plate, drawn once at boot.
function makeSignTexture(text, color) {
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 128;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#0c0a18';
  ctx.fillRect(0, 0, 512, 128);
  ctx.font = '900 64px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = color;
  ctx.shadowBlur = 26;
  ctx.fillStyle = color;
  ctx.fillText(text, 256, 66);
  ctx.shadowBlur = 6;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, 256, 66);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Soft radial glow, for the sun and for explosion flashes.
function makeGlowTexture() {
  const cv = document.createElement('canvas');
  cv.width = 128;
  cv.height = 128;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,220,150,0.55)');
  g.addColorStop(1, 'rgba(255,220,150,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeCarGeometry(color, police, cls) {
  const parts = [];
  const body = police ? 0x1c2733 : color;
  const long = cls === 'truck' ? 5.6 : 4.3;
  const tall = cls === 'truck' ? 1.1 : 0.65;
  boxPart(parts, long, tall, 1.9, 0, 0.55, 0, body); // body
  boxPart(parts, cls === 'truck' ? 1.4 : 2.3, cls === 'truck' ? 1.5 : 0.6, 1.7, cls === 'truck' ? 1.6 : -0.25, cls === 'truck' ? 1.6 : 1.15, 0, police ? 0xe8ecf2 : 0x1c2733); // cabin
  boxPart(parts, 0.9, 0.5, 1.6, 1.35, 1.0, 0, 0x10151d); // hood slope hint
  const wheel = 0x0c0e12;
  const wx = long / 2 - 0.75;
  boxPart(parts, 0.72, 0.72, 0.4, wx, 0.36, 0.85, wheel);
  boxPart(parts, 0.72, 0.72, 0.4, wx, 0.36, -0.85, wheel);
  boxPart(parts, 0.72, 0.72, 0.4, -wx, 0.36, 0.85, wheel);
  boxPart(parts, 0.72, 0.72, 0.4, -wx, 0.36, -0.85, wheel);
  boxPart(parts, 0.3, 0.18, 0.35, long / 2 + 0.02, 0.62, 0.6, 0xfff2b0); // headlights
  boxPart(parts, 0.3, 0.18, 0.35, long / 2 + 0.02, 0.62, -0.6, 0xfff2b0);
  boxPart(parts, 0.12, 0.16, 0.4, -long / 2 - 0.02, 0.62, 0.6, 0xff2e3c); // taillights
  boxPart(parts, 0.12, 0.16, 0.4, -long / 2 - 0.02, 0.62, -0.6, 0xff2e3c);
  if (police) {
    boxPart(parts, 1.0, 0.22, 0.5, -0.25, 1.55, 0, 0xf2f2f2); // light bar base
  }
  if (cls === 'taxi') {
    boxPart(parts, 0.9, 0.3, 0.9, -0.25, 1.55, 0, 0xffc93c); // roof sign
  }
  if (cls === 'sport') {
    boxPart(parts, 1.6, 0.14, 1.7, -long / 2 + 0.1, 0.95, 0, 0x10151d); // rear wing
  }
  return mergeGeometries(parts);
}

function makePersonGeometry(shirt, pants, skin) {
  const parts = [];
  boxPart(parts, 0.42, 0.5, 0.24, -0.12, 0.25, 0, pants); // left leg
  boxPart(parts, 0.42, 0.5, 0.24, 0.12, 0.25, 0, pants); // right leg
  boxPart(parts, 0.62, 0.72, 0.32, 0, 0.86, 0, shirt); // torso
  boxPart(parts, 0.18, 0.55, 0.18, -0.4, 0.86, 0, shirt); // left arm
  boxPart(parts, 0.18, 0.55, 0.18, 0.4, 0.86, 0, shirt); // right arm
  boxPart(parts, 0.34, 0.34, 0.32, 0, 1.4, 0, skin); // head
  boxPart(parts, 0.38, 0.12, 0.36, 0, 1.6, 0, 0xff2e88); // cap
  return mergeGeometries(parts);
}

// ---------- the renderer ----------
export function createRenderer(canvas, world) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(new THREE.Color(PALETTE.fog), 130, 520);
  const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 1200);
  camera.position.set(-40, 26, 90);

  // Sunset sky dome: gradient shader, one draw call, never fogged.
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(800, 24, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      fog: false,
      depthWrite: false,
      uniforms: {
        top: { value: new THREE.Color(PALETTE.skyTop) },
        mid: { value: new THREE.Color(PALETTE.skyMid) },
        low: { value: new THREE.Color(PALETTE.skyLow) },
      },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `varying vec3 vP; uniform vec3 top; uniform vec3 mid; uniform vec3 low;
        void main(){ float h = normalize(vP).y; vec3 c = h > 0.25 ? mix(mid, top, smoothstep(0.25, 0.7, h)) : mix(low, mid, smoothstep(-0.05, 0.25, h)); gl_FragColor = vec4(c, 1.0); }`,
    }),
  );
  scene.add(sky);

  // Low sun disc + halo on the western horizon.
  const glowTex = makeGlowTexture();
  const sun = new THREE.Mesh(
    new THREE.CircleGeometry(26, 32),
    new THREE.MeshBasicMaterial({ color: PALETTE.sun, fog: false }),
  );
  sun.position.set(-420, 55, -180);
  scene.add(sun);
  const sunHalo = new THREE.Mesh(
    new THREE.PlaneGeometry(190, 190),
    new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, opacity: 0.7, fog: false, depthWrite: false }),
  );
  sunHalo.position.set(-420, 55, -180);
  scene.add(sunHalo);

  // Lights: one warm sun + hemisphere fill. No shadow maps by design.
  const sunLight = new THREE.DirectionalLight(0xffb36b, 2.0);
  sunLight.position.set(-220, 140, -90);
  scene.add(sunLight);
  scene.add(new THREE.HemisphereLight(0x8a5a9e, 0x3a2a3a, 0.85));

  // Ground: one textured plane.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(700, 400),
    new THREE.MeshStandardMaterial({ map: makeGroundTexture(world.state.buildings), roughness: 0.95, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(150, 0, 0);
  scene.add(ground);

  // Ocean: two scrolling layers for a slow swell.
  const oceanTex = makeOceanTexture();
  const ocean = new THREE.Mesh(
    new THREE.PlaneGeometry(300, 460),
    new THREE.MeshBasicMaterial({ map: oceanTex }),
  );
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.set(OCEAN_X + 150, 0.06, 0);
  scene.add(ocean);
  const oceanTex2 = makeOceanTexture();
  const ocean2 = new THREE.Mesh(
    new THREE.PlaneGeometry(300, 460),
    new THREE.MeshBasicMaterial({ map: oceanTex2, transparent: true, opacity: 0.35 }),
  );
  ocean2.rotation.x = -Math.PI / 2;
  ocean2.position.set(OCEAN_X + 150, 0.12, 0);
  scene.add(ocean2);

  // Buildings: one InstancedMesh, per-instance colour tint, lit windows baked in.
  const windowTex = makeWindowTexture();
  const buildingMat = new THREE.MeshStandardMaterial({
    map: windowTex, emissiveMap: windowTex, emissive: 0xffc46b, emissiveIntensity: 0.55,
    roughness: 0.9, metalness: 0.05,
  });
  const buildingGeo = new THREE.BoxGeometry(1, 1, 1);
  buildingGeo.translate(0, 0.5, 0);
  const buildings = new THREE.InstancedMesh(buildingGeo, buildingMat, Math.max(1, world.state.buildings.length));
  world.state.buildings.forEach((b, i) => {
    tmpMatrix.compose(
      tmpVec.set((b.x0 + b.x1) / 2, 0, (b.z0 + b.z1) / 2),
      tmpQuat.identity(),
      tmpScale.set(b.x1 - b.x0, b.h, b.z1 - b.z0),
    );
    buildings.setMatrixAt(i, tmpMatrix);
    tmpColor.setHex(PALETTE.building[b.color % PALETTE.building.length]);
    buildings.setColorAt(i, tmpColor);
  });
  buildings.instanceMatrix.needsUpdate = true;
  if (buildings.instanceColor) buildings.instanceColor.needsUpdate = true;
  scene.add(buildings);

  // Neon signs on downtown towers: one glowing plane each, shared textures.
  const signMeshes = [];
  {
    let signIndex = 0;
    const signMats = new Map();
    for (const b of world.state.buildings) {
      if (!b.neon) continue;
      const def = NEON_SIGNS[signIndex % NEON_SIGNS.length];
      signIndex += 1;
      if (!signMats.has(def.text)) {
        signMats.set(def.text, new THREE.MeshBasicMaterial({ map: makeSignTexture(def.text, def.color), transparent: true }));
      }
      const w = Math.min(18, b.x1 - b.x0 - 2);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), signMats.get(def.text));
      const cx = (b.x0 + b.x1) / 2;
      const cz = (b.z0 + b.z1) / 2;
      // Face the nearest road: south face if the block sits north of a road.
      sign.position.set(cx, Math.min(b.h - 2.5, 14), b.z1 + 0.15);
      signMeshes.push(sign);
      scene.add(sign);
    }
  }

  // Streetlights: instanced poles + glowing lamp heads.
  const lightCount = Math.max(1, world.state.lights.length);
  const poles = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.09, 0.12, 5.4, 6),
    new THREE.MeshStandardMaterial({ color: 0x2a2f3a, roughness: 0.7, metalness: 0.6 }),
    lightCount,
  );
  const lamps = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.7, 0.16, 0.3),
    new THREE.MeshBasicMaterial({ color: 0xffd9a0 }),
    lightCount,
  );
  world.state.lights.forEach((l, i) => {
    tmpMatrix.compose(tmpVec.set(l.x, 2.7, l.z), tmpQuat.identity(), tmpScale.set(1, 1, 1));
    poles.setMatrixAt(i, tmpMatrix);
    tmpMatrix.compose(tmpVec.set(l.x, 5.45, l.z), tmpQuat.identity(), tmpScale.set(1, 1, 1));
    lamps.setMatrixAt(i, tmpMatrix);
  });
  poles.instanceMatrix.needsUpdate = true;
  lamps.instanceMatrix.needsUpdate = true;
  scene.add(poles);
  scene.add(lamps);

  // Palms: instanced trunks + crowns.
  const palmCount = Math.max(1, world.state.palms.length);
  const trunks = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.16, 0.3, 4.6, 6),
    new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 1 }),
    palmCount,
  );
  const crowns = new THREE.InstancedMesh(
    new THREE.SphereGeometry(2.1, 8, 6),
    new THREE.MeshStandardMaterial({ color: 0x2f7a4a, roughness: 1 }),
    palmCount,
  );
  world.state.palms.forEach((pl, i) => {
    tmpMatrix.compose(tmpVec.set(pl.x, 2.3 * pl.s, pl.z), tmpQuat.identity(), tmpScale.set(pl.s, pl.s, pl.s));
    trunks.setMatrixAt(i, tmpMatrix);
    tmpMatrix.compose(tmpVec.set(pl.x, 4.9 * pl.s, pl.z), tmpQuat.identity(), tmpScale.set(pl.s, pl.s * 0.55, pl.s));
    crowns.setMatrixAt(i, tmpMatrix);
  });
  trunks.instanceMatrix.needsUpdate = true;
  crowns.instanceMatrix.needsUpdate = true;
  scene.add(trunks);
  scene.add(crowns);

  // Cars: one merged mesh per car, cached by paint + kind + class.
  const carMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.35 });
  const carGeoCache = new Map();
  function carGeometry(color, police, cls) {
    const key = `${police ? 'P' : ''}${cls || 'sedan'}${color}`;
    if (!carGeoCache.has(key)) carGeoCache.set(key, makeCarGeometry(color, police, cls || 'sedan'));
    return carGeoCache.get(key);
  }
  const carMeshes = new Map(); // car id -> { mesh, beacons: [red, blue] }
  const beaconGeo = new THREE.BoxGeometry(0.42, 0.2, 0.3);
  const beaconRed = new THREE.MeshBasicMaterial({ color: 0xff2233 });
  const beaconBlue = new THREE.MeshBasicMaterial({ color: 0x2266ff });
  function syncCars(state) {
    const seen = new Set();
    for (const car of state.cars) {
      seen.add(car.id);
      let entry = carMeshes.get(car.id);
      if (!entry) {
        const mesh = new THREE.Mesh(carGeometry(car.color, car.kind === 'police', car.cls), carMaterial);
        mesh.matrixAutoUpdate = false;
        scene.add(mesh);
        entry = { mesh, beacons: [] };
        if (car.kind === 'police') {
          const r = new THREE.Mesh(beaconGeo, beaconRed);
          r.position.set(-0.25, 1.62, 0.14);
          const b = new THREE.Mesh(beaconGeo, beaconBlue);
          b.position.set(-0.25, 1.62, -0.14);
          mesh.add(r);
          mesh.add(b);
          entry.beacons = [r, b];
        }
        carMeshes.set(car.id, entry);
      }
      tmpEuler.set(0, car.angle - Math.PI / 2, 0);
      // Car geometry faces +X when angle 0; world angle 0 faces +Z. Rotate to match.
      tmpQuat.setFromEuler(tmpEuler);
      tmpMatrix.compose(tmpVec.set(car.x, 0, car.z), tmpQuat, tmpScale.set(1, 1, 1));
      entry.mesh.matrix.copy(tmpMatrix);
      entry.mesh.matrixWorldNeedsUpdate = true;
      // Police light bar strobes red/blue, alternating.
      if (entry.beacons.length) {
        const phase = Math.floor(state.time * 6) % 2 === 0;
        entry.beacons[0].visible = phase;
        entry.beacons[1].visible = !phase;
      }
      entry.mesh.visible = true;
    }
    for (const [id, entry] of carMeshes) {
      if (!seen.has(id)) {
        scene.remove(entry.mesh);
        carMeshes.delete(id);
      }
    }
  }

  // Pedestrians: two InstancedMeshes (body + head), matrices updated every frame.
  // Sized with headroom: stealing a car spawns a fleeing driver ped, so the
  // live count briefly exceeds the starting count (the world removes the
  // driver again once it has fled). .count is set per frame in sync().
  const pedCap = world.state.peds.length + 8;
  const pedBody = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.62, 1.25, 0.34),
    new THREE.MeshStandardMaterial({ roughness: 0.9 }),
    pedCap,
  );
  const pedHead = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.34, 0.34, 0.32),
    new THREE.MeshStandardMaterial({ roughness: 0.9 }),
    pedCap,
  );
  pedBody.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  pedHead.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const SHIRTS = [0xff2e88, 0x2ec4ff, 0xffc93c, 0x9dff3c, 0xe8e8f0, 0x7a5cff, 0xff8a3c, 0x3cffb0];
  world.state.peds.forEach((ped, i) => {
    tmpColor.setHex(SHIRTS[ped.shirt % SHIRTS.length]);
    pedBody.setColorAt(i, tmpColor);
    tmpColor.setHex(ped.skin);
    pedHead.setColorAt(i, tmpColor);
  });
  scene.add(pedBody);
  scene.add(pedHead);

  // The player: one merged low-poly character, hot pink jacket + cap.
  const playerMesh = new THREE.Mesh(
    makePersonGeometry(0xff2e88, 0x1c2733, 0xe8b98a),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }),
  );
  playerMesh.matrixAutoUpdate = false;
  scene.add(playerMesh);

  // Blob shadows: one instanced dark disc per car, ped and player.
  const blobCount = 96;
  const blobs = new THREE.InstancedMesh(
    new THREE.CircleGeometry(1, 12),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false }),
    blobCount,
  );
  blobs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(blobs);

  // Smoke puffs: pooled instanced spheres, fed by smoking wrecks.
  const SMOKE_MAX = 24;
  const smoke = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.9, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0x555560, transparent: true, opacity: 0.5, depthWrite: false }),
    SMOKE_MAX,
  );
  smoke.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  smoke.count = 0;
  scene.add(smoke);
  const smokePuffs = [];
  for (let i = 0; i < SMOKE_MAX; i += 1) {
    smokePuffs.push({ x: 0, y: 0, z: 0, life: 0, max: 1, size: 1 });
  }

  // Explosion sparks: pooled instanced tetrahedra, fed by state.explosions.
  const SPARK_MAX = 64;
  const sparks = new THREE.InstancedMesh(
    new THREE.TetrahedronGeometry(0.55),
    new THREE.MeshBasicMaterial({ color: 0xffa63c }),
    SPARK_MAX,
  );
  sparks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  sparks.count = 0;
  scene.add(sparks);
  const sparkPool = [];
  for (let i = 0; i < SPARK_MAX; i += 1) {
    sparkPool.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1 });
  }
  let sparkCursor = 0;
  const seenExplosions = new Set();
  function burstSparks(x, z) {
    for (let n = 0; n < 12; n += 1) {
      const s = sparkPool[sparkCursor];
      sparkCursor = (sparkCursor + 1) % SPARK_MAX;
      const a = Math.random() * Math.PI * 2;
      const r = 4 + Math.random() * 9;
      s.x = x;
      s.y = 1 + Math.random() * 2;
      s.z = z;
      s.vx = Math.cos(a) * r;
      s.vy = 5 + Math.random() * 9;
      s.vz = Math.sin(a) * r;
      s.life = 0.7 + Math.random() * 0.3;
      s.max = s.life;
    }
  }

  // Mission beacon: light pillar + floating diamond.
  const beaconMat = new THREE.MeshBasicMaterial({
    color: 0xffd94a, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.DoubleSide,
  });
  const beacon = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 34, 12, 1, true), beaconMat);
  const diamond = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.9),
    new THREE.MeshBasicMaterial({ color: 0xffd94a }),
  );
  scene.add(beacon);
  scene.add(diamond);

  // Taxi marker: a smaller gold beacon for the fare passenger / destination.
  const taxiMat = new THREE.MeshBasicMaterial({
    color: 0xffc93c, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.DoubleSide,
  });
  const taxiBeacon = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 22, 12, 1, true), taxiMat);
  scene.add(taxiBeacon);

  // Roadblocks: two striped barricades, shown while the police hold one.
  const roadblockMat = new THREE.MeshStandardMaterial({ color: 0xe8ecf2, roughness: 0.6 });
  const roadblockStripe = new THREE.MeshStandardMaterial({ color: 0xff2233, roughness: 0.6 });
  const roadblockMeshes = [];
  for (let i = 0; i < 2; i += 1) {
    const group = new THREE.Group();
    const bar = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.5, 0.5), roadblockMat);
    bar.position.y = 0.9;
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.18, 0.52), roadblockStripe);
    stripe.position.y = 0.9;
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.9, 0.5), roadblockMat);
    legL.position.set(-2.4, 0.45, 0);
    const legR = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.9, 0.5), roadblockMat);
    legR.position.set(2.4, 0.45, 0);
    group.add(bar, stripe, legL, legR);
    group.visible = false;
    scene.add(group);
    roadblockMeshes.push(group);
  }

  // Pickups: instanced cash (green) + health (white) boxes.
  const pickupMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.7, 0.7, 0.7),
    new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.2, emissive: 0x222222 }),
    12,
  );
  pickupMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(pickupMesh);

  // Gunfire tracer: a single line, repositioned on every shot.
  const tracerGeo = new THREE.BufferGeometry();
  tracerGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const tracer = new THREE.Line(tracerGeo, new THREE.LineBasicMaterial({ color: 0xffe27a, transparent: true, opacity: 0 }));
  scene.add(tracer);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // Adaptive resolution: watch the frame time and step the pixel ratio between
  // 1 and 2 so the game holds its frame rate instead of dropping frames.
  const RATIO_STEPS = [2, 1.5, 1.25, 1];
  let ratioIndex = 0;
  let ratioTimer = 0;
  let frameEma = 16.7;
  let currentRatio = Math.min(window.devicePixelRatio || 1, 2);
  for (let i = 0; i < RATIO_STEPS.length; i += 1) {
    if (currentRatio >= RATIO_STEPS[i]) {
      ratioIndex = i;
      break;
    }
  }

  let camPos = new THREE.Vector3(-40, 26, 90);
  let camLook = new THREE.Vector3(0, 2, 0);
  let snapNext = false; // set by snapCamera(): next sync() jumps, not lerps
  const tmpLook = new THREE.Vector3();

  function sync(state, dt, screen) {
    const p = state.player;
    // Frame-time EMA drives the adaptive pixel ratio (checked every 2 s).
    if (dt > 0) frameEma += (dt * 1000 - frameEma) * 0.05;
    ratioTimer += dt;
    if (window.__lockRatio) {
      // Screenshot captures pin the pixel ratio at its maximum (set only by
      // tools/shots.mjs via addInitScript) so the still is a full-resolution
      // render instead of the step-down headless SwiftShader would trigger.
      ratioTimer = 0;
      const target = Math.min(window.devicePixelRatio || 1, 2);
      if (RATIO_STEPS[ratioIndex] !== target) {
        ratioIndex = Math.max(0, RATIO_STEPS.indexOf(target));
        renderer.setPixelRatio(target);
      }
    } else if (ratioTimer > 2) {
      ratioTimer = 0;
      const fps = 1000 / Math.max(frameEma, 0.01);
      if (fps < 52 && ratioIndex < RATIO_STEPS.length - 1) {
        ratioIndex += 1;
        renderer.setPixelRatio(RATIO_STEPS[ratioIndex]);
      } else if (fps > 58 && ratioIndex > 0) {
        ratioIndex -= 1;
        renderer.setPixelRatio(RATIO_STEPS[ratioIndex]);
      }
    }
    currentRatio = RATIO_STEPS[ratioIndex];
    // Ocean drift (two layers, opposite directions); the sun always faces the camera.
    oceanTex.offset.x += dt * 0.008;
    oceanTex2.offset.x -= dt * 0.005;
    oceanTex2.offset.y += dt * 0.003;
    sun.lookAt(camera.position);
    sunHalo.lookAt(camera.position);
    // Neon signs gently pulse.
    for (let i = 0; i < signMeshes.length; i += 1) {
      signMeshes[i].material.opacity = 0.85 + Math.sin(state.time * 2 + i * 1.7) * 0.15;
    }
    // Cars, peds, player, blobs, pickups, beacon.
    syncCars(state);
    const pedN = Math.min(state.peds.length, pedCap);
    state.peds.forEach((ped, i) => {
      if (i >= pedCap) return;
      const bob = ped.down > 0 ? 0 : Math.abs(Math.sin(ped.bob)) * 0.12;
      tmpEuler.set(ped.down > 0 ? -Math.PI / 2 : 0, ped.angle - Math.PI / 2, 0);
      tmpQuat.setFromEuler(tmpEuler);
      tmpMatrix.compose(tmpVec.set(ped.x, ped.down > 0 ? 0.25 : 0.62 + bob, ped.z), tmpQuat, tmpScale.set(1, 1, 1));
      pedBody.setMatrixAt(i, tmpMatrix);
      tmpMatrix.compose(tmpVec.set(ped.x, ped.down > 0 ? 0.25 : 1.62 + bob, ped.z), tmpQuat, tmpScale.set(1, 1, 1));
      pedHead.setMatrixAt(i, tmpMatrix);
      // Colours every frame: indices shift when a fled driver ped is removed,
      // and a fresh driver would otherwise render white (never coloured).
      tmpColor.setHex(SHIRTS[ped.shirt % SHIRTS.length]);
      pedBody.setColorAt(i, tmpColor);
      tmpColor.setHex(ped.skin);
      pedHead.setColorAt(i, tmpColor);
    });
    pedBody.count = pedN;
    pedHead.count = pedN;
    pedBody.instanceMatrix.needsUpdate = true;
    pedHead.instanceMatrix.needsUpdate = true;
    if (pedBody.instanceColor) pedBody.instanceColor.needsUpdate = true;
    if (pedHead.instanceColor) pedHead.instanceColor.needsUpdate = true;

    // Player mesh (hidden while driving — the car is the body then).
    playerMesh.visible = p.onFoot;
    if (p.onFoot) {
      const bob = Math.abs(Math.sin(state.time * 9)) * (p.speed > 0.5 ? 0.08 : 0);
      tmpEuler.set(0, p.angle - Math.PI / 2, 0);
      tmpQuat.setFromEuler(tmpEuler);
      tmpMatrix.compose(tmpVec.set(p.x, bob, p.z), tmpQuat, tmpScale.set(1, 1, 1));
      playerMesh.matrix.copy(tmpMatrix);
      playerMesh.matrixWorldNeedsUpdate = true;
    }

    // Blob shadows under every car, ped and the player.
    let bi = 0;
    const blob = (x, z, r, y = 0.02) => {
      if (bi >= blobCount) return;
      tmpEuler.set(-Math.PI / 2, 0, 0);
      tmpQuat.setFromEuler(tmpEuler);
      tmpMatrix.compose(tmpVec.set(x, y, z), tmpQuat, tmpScale.set(r, r, 1));
      blobs.setMatrixAt(bi, tmpMatrix);
      bi += 1;
    };
    for (const car of state.cars) blob(car.x, car.z, 2.6);
    for (const ped of state.peds) if (ped.down <= 0) blob(ped.x, ped.z, 0.6);
    if (p.onFoot) blob(p.x, p.z, 0.8);
    blobs.count = bi;
    blobs.instanceMatrix.needsUpdate = true;

    // Smoke from wrecked cars: one puff rises and grows, then fades.
    let si = 0;
    for (const car of state.cars) {
      if (!car.smoke || si >= SMOKE_MAX) continue;
      const puff = smokePuffs[si];
      puff.life -= dt;
      if (puff.life <= 0) {
        puff.life = 1.6;
        puff.max = 1.6;
        puff.x = car.x + (Math.random() - 0.5) * 1.2;
        puff.y = 1.4;
        puff.z = car.z + (Math.random() - 0.5) * 1.2;
        puff.size = 0.8;
      }
      puff.y += dt * 1.6;
      puff.size += dt * 1.4;
      const a = clamp(puff.life / puff.max, 0, 1);
      tmpEuler.set(0, 0, 0);
      tmpQuat.setFromEuler(tmpEuler);
      tmpMatrix.compose(tmpVec.set(puff.x, puff.y, puff.z), tmpQuat, tmpScale.set(puff.size, puff.size, puff.size));
      smoke.setMatrixAt(si, tmpMatrix);
      smoke.setColorAt(si, tmpColor.setRGB(0.32 * a + 0.1, 0.32 * a + 0.1, 0.36 * a + 0.1));
      si += 1;
    }
    smoke.count = si;
    smoke.instanceMatrix.needsUpdate = true;
    if (smoke.instanceColor) smoke.instanceColor.needsUpdate = true;

    // Explosion sparks: burst once per new explosion, then fly and fall.
    for (const ex of state.explosions) {
      const key = `${ex.x.toFixed(1)},${ex.z.toFixed(1)}`;
      if (!seenExplosions.has(key)) {
        seenExplosions.add(key);
        burstSparks(ex.x, ex.z);
      }
    }
    if (seenExplosions.size > 40) seenExplosions.clear();
    let sparkCount = 0;
    for (const s of sparkPool) {
      if (s.life <= 0) continue;
      s.life -= dt;
      s.vy -= 22 * dt;
      s.x += s.vx * dt;
      s.y = Math.max(0.2, s.y + s.vy * dt);
      s.z += s.vz * dt;
      const sc = clamp(s.life / s.max, 0, 1) * 1.4;
      tmpEuler.set(state.time * 6 + s.x, state.time * 4, 0);
      tmpQuat.setFromEuler(tmpEuler);
      tmpMatrix.compose(tmpVec.set(s.x, s.y, s.z), tmpQuat, tmpScale.set(sc, sc, sc));
      sparks.setMatrixAt(sparkCount, tmpMatrix);
      sparks.setColorAt(sparkCount, tmpColor.setRGB(1, 0.45 + 0.4 * sc, 0.15));
      sparkCount += 1;
    }
    sparks.count = sparkCount;
    sparks.instanceMatrix.needsUpdate = true;
    if (sparks.instanceColor) sparks.instanceColor.needsUpdate = true;

    // Pickups bob and spin.
    state.pickups.forEach((pk, i) => {
      if (!pk.active) {
        tmpMatrix.makeScale(0, 0, 0);
      } else {
        tmpEuler.set(0, state.time * 1.5 + i, 0);
        tmpQuat.setFromEuler(tmpEuler);
        tmpMatrix.compose(tmpVec.set(pk.x, 0.7 + Math.sin(state.time * 2 + i) * 0.15, pk.z), tmpQuat, tmpScale.set(1, 1, 1));
      }
      pickupMesh.setMatrixAt(i, tmpMatrix);
      tmpColor.setHex(pk.kind === 'cash' ? 0x2eff7a : 0xffffff);
      pickupMesh.setColorAt(i, tmpColor);
    });
    pickupMesh.instanceMatrix.needsUpdate = true;
    if (pickupMesh.instanceColor) pickupMesh.instanceColor.needsUpdate = true;

    // Mission beacon.
    const hasBeacon = !!state.mission.beacon && !state.mission.storyDone;
    beacon.visible = hasBeacon;
    diamond.visible = hasBeacon;
    if (hasBeacon) {
      const b = state.mission.beacon;
      beacon.position.set(b.x, 17, b.z);
      diamond.position.set(b.x, 4.2 + Math.sin(state.time * 2.4) * 0.5, b.z);
      diamond.rotation.y = state.time * 1.8;
    }

    // Taxi marker: gold pillar over the passenger, then over the destination.
    const taxi = state.taxi;
    const taxiTarget = taxi.active
      ? (taxi.phase === 'pickup' ? taxi.passenger : taxi.dest)
      : null;
    taxiBeacon.visible = !!taxiTarget;
    if (taxiTarget) {
      taxiBeacon.position.set(taxiTarget.x, 11, taxiTarget.z);
      taxiBeacon.material.opacity = 0.35 + Math.sin(state.time * 4) * 0.15;
    }

    // Roadblocks.
    state.roadblocks.forEach((rb, i) => {
      const g = roadblockMeshes[i];
      if (!g) return;
      g.visible = true;
      g.position.set(rb.x, 0, rb.z);
      g.rotation.y = rb.angle;
    });
    for (let i = state.roadblocks.length; i < roadblockMeshes.length; i += 1) {
      roadblockMeshes[i].visible = false;
    }

    // Tracer.
    if (state.tracer) {
      const t = state.tracer;
      const pos = tracer.geometry.attributes.position.array;
      pos[0] = t.x0; pos[1] = t.y0; pos[2] = t.z0;
      pos[3] = t.x1; pos[4] = t.y1; pos[5] = t.z1;
      tracer.geometry.attributes.position.needsUpdate = true;
      tracer.material.opacity = clamp(t.life / 0.09, 0, 1);
    } else {
      tracer.material.opacity = 0;
    }

    // ---- chase camera ----
    const inCar = !p.onFoot;
    const dist = inCar ? 13.5 : 8.5;
    const height = inCar ? 4.6 : 3.4;
    const backX = Math.sin(p.camYaw);
    const backZ = Math.cos(p.camYaw);
    const desired = tmpVec.set(p.x + backX * dist, height, p.z + backZ * dist);
    // snapNext jumps the camera straight to its place (screenshot staging runs
    // the sim without rendering, so the camera would otherwise spend a second
    // flying across the city while the shot is taken). Normal play keeps the
    // smooth exponential follow.
    const k = snapNext ? 1 : 1 - Math.exp(-6 * dt);
    camPos.lerp(desired, k);
    // Keep the camera out of buildings: lift it if it clips a block.
    for (const b of state.buildings) {
      if (camPos.x > b.x0 - 1 && camPos.x < b.x1 + 1 && camPos.z > b.z0 - 1 && camPos.z < b.z1 + 1) {
        camPos.y = Math.max(camPos.y, b.h + 3);
      }
    }
    camPos.y = Math.max(camPos.y, 1.6);
    tmpLook.set(p.x - backX * 6, inCar ? 1.6 : 1.5, p.z - backZ * 6);
    camLook.lerp(tmpLook, snapNext ? 1 : 1 - Math.exp(-10 * dt));
    snapNext = false;
    camera.position.copy(camPos);
    if (state.shake > 0) {
      camera.position.x += (Math.random() - 0.5) * state.shake * 0.7;
      camera.position.y += (Math.random() - 0.5) * state.shake * 0.5;
    }
    camera.lookAt(camLook);
    // Speed FOV kick while driving.
    const targetFov = inCar ? 62 + clamp(Math.abs(p.speed) / 38, 0, 1) * 12 : 62;
    if (Math.abs(camera.fov - targetFov) > 0.1) {
      camera.fov += (targetFov - camera.fov) * Math.min(1, 4 * dt);
      camera.updateProjectionMatrix();
    }
    renderer.render(scene, camera);
  }

  return {
    renderer,
    camera,
    scene,
    sync,
    snapCamera: () => {
      snapNext = true;
    },
    info: () => renderer.info,
    pixelRatio: () => currentRatio,
  };
}
