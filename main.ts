// NEON BAY — a complete open-world crime game for make.fun bounty gta6-01
// ("Make GTA 6"). Node 22, standard library only. The game is this directory's
// game/ folder: plain static files a desktop browser loads offline (game/index.html
// and its ES modules, three.js r180 vendored under game/vendor/, no network
// request anywhere), and this program hands it in: it validates the tree against
// the sealed gate (reference/gate.json — see the kit's competition.yaml), copies
// game/ and screenshots/ from beside this file to /output, and writes
// /output/dossier.json — the summary the judge reads — with the vendored make.fun
// library (vendor/makefun-game.ts, copied from the kit unchanged).
//
// The game: a sunset coastal city ("Neon Bay") you explore on foot and by car.
// Traffic and pedestrians, cars to steal (sedans, sports cars, taxis, trucks),
// a 5-star wanted system with police pursuit and roadblocks, a 3-mission story
// plus a taxi side job, combat with explosions, a HUD with a live minimap and
// district names, a start screen and a localStorage save, synthesized WebAudio
// sound with a procedural synthwave loop, and a renderer built for a locked
// 60 FPS (instanced scenery, one merged mesh per car, one textured ground
// plane, no shadow maps — blob shadows instead, adaptive pixel ratio).
//
// Serve it locally with `node serve.ts`, then open http://localhost:8080.
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// Play-test + screenshots (headless, Playwright):
//   node tools/shots.mjs   — captures screenshots/ at 1280x720 (the gate's max),
//                          rendered 2x supersampled from 2560x1440 (see tools/shots.mjs)
//   node tools/fps.mjs     — measures FPS per scene and writes PERFORMANCE.md

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const out = process.env.MAKEFUN_OUTPUT_DIR ?? (outIndex === -1 ? '/output' : args[outIndex + 1]);

const REQUIRED_FILES = [
  'game/index.html',
  'game/src/main.js',
  'game/src/world.js',
  'game/src/render.js',
  'game/src/config.js',
  'game/src/input.js',
  'game/src/random.js',
  'game/src/audio.js',
  'game/src/hud.js',
  'game/src/shots.js',
  'game/vendor/three.module.min.js',
  'game/vendor/three.core.min.js',
  'LICENSE',
];

// The sealed gate's caps (kit competition.yaml, reference/gate.json): game/ at
// most 993 files and directories together and 48 MiB in all, each path at most
// 1,000 UTF-8 bytes, game/index.html at most 1 MiB, 3 to 4 screenshots of at
// most 256 KiB, long side at most 1280 and short side at least 480 pixels, the
// dossier at most 1.5 MiB and its text at most 163,840 bytes (160 KiB).
const CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, min: 3, max_bytes: 262144, long_side_max: 1280, short_side_min: 480 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
  index_max_bytes: 1048576,
  dossier_max_bytes: 1572864,
};

function fail(message) {
  console.error(`main.ts: ${message}`);
  process.exit(1);
}

function walk(dir, base = '') {
  const outFiles = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) outFiles.push(...walk(full, rel));
    else if (entry.isFile()) outFiles.push(rel);
  }
  return outFiles;
}

/** Image dimensions without a dependency: PNG IHDR, or a JPEG SOF marker. */
function imageSize(file) {
  const buf = readFileSync(file);
  if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) break;
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
      }
      i += 2 + len;
    }
  }
  return null;
}

// --- 1. Required files exist. ---
for (const file of REQUIRED_FILES) {
  if (!existsSync(join(here, file))) fail(`missing required file: ${file}`);
}

// --- 2. The game loads nothing over the network: no http(s), protocol-relative
// or absolute URLs in any HTML/JS/CSS under game/. (Three.js is vendored.) ---
const EXTERNAL = /(?:src|href)\s*=\s*["']https?:|\bfrom\s+["']https?:|import\s*\(\s*["']https?:|url\(\s*["']https?:|["']\/\/[a-z0-9]/i;
for (const file of walk(join(here, 'game'))) {
  if (!/\.(html|js|mjs|css)$/.test(file)) continue;
  const text = readFileSync(join(here, 'game', file), 'utf8');
  if (EXTERNAL.test(text)) fail(`game/${file} references an external URL — the game must load offline`);
}

// --- 3. game/ size caps. ---
const gameFiles = walk(join(here, 'game'));
if (gameFiles.length > CAPS.game_max_files) fail(`game/ has ${gameFiles.length} files — over the ${CAPS.game_max_files} cap`);
const gameBytes = gameFiles.reduce((n, f) => n + statSync(join(here, 'game', f)).size, 0);
if (gameBytes > CAPS.game_max_bytes) fail(`game/ is ${gameBytes} bytes — over the ${CAPS.game_max_bytes} cap`);
for (const f of gameFiles) {
  if (Buffer.byteLength(`game/${f}`, 'utf8') > CAPS.game_path_max_bytes) fail(`game/${f} path is over the ${CAPS.game_path_max_bytes} byte cap`);
}
const indexSize = statSync(join(here, 'game', 'index.html')).size;
if (indexSize > CAPS.index_max_bytes) fail(`game/index.html is ${indexSize} bytes — over the ${CAPS.index_max_bytes} cap`);

// --- 4. Screenshots: the 3-4 named in shots.json, each a JPEG/PNG under the
// 256 KiB cap, long side at most 1280 px and short side at least 480 px. ---
const shotsDir = join(here, 'screenshots');
if (!existsSync(shotsDir)) fail('missing screenshots/ — run node tools/shots.mjs first');
const planned = JSON.parse(readFileSync(join(here, 'shots.json'), 'utf8')).map((s) => s.name);
const shots = readdirSync(shotsDir).filter((f) => /\.(jpe?g|png)$/i.test(f)).sort();
if (shots.length < CAPS.screenshots.min || shots.length > CAPS.screenshots.max) {
  fail(`expected ${CAPS.screenshots.min}-${CAPS.screenshots.max} screenshots, found ${shots.length}`);
}
for (const name of planned) {
  if (!shots.includes(name)) fail(`shots.json lists ${name} but screenshots/ has no such file`);
}
for (const shot of shots) {
  const full = join(shotsDir, shot);
  const size = statSync(full).size;
  if (size > CAPS.screenshots.max_bytes) {
    fail(`screenshots/${shot} is ${size} bytes — over the ${CAPS.screenshots.max_bytes} byte cap`);
  }
  const dims = imageSize(full);
  if (!dims) fail(`screenshots/${shot}: could not read dimensions`);
  const longSide = Math.max(dims.width, dims.height);
  const shortSide = Math.min(dims.width, dims.height);
  if (longSide > CAPS.screenshots.long_side_max) {
    fail(`screenshots/${shot} is ${dims.width}x${dims.height} — long side over the ${CAPS.screenshots.long_side_max} px cap`);
  }
  if (shortSide < CAPS.screenshots.short_side_min) {
    fail(`screenshots/${shot} is ${dims.width}x${dims.height} — short side under the ${CAPS.screenshots.short_side_min} px minimum`);
  }
  console.log(`shot ${shot}: ${dims.width}x${dims.height}, ${(size / 1024).toFixed(1)} KiB`);
}

// --- 5. Copy the game and the screenshots, then write the dossier. ---
mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
cpSync(shotsDir, join(out, 'screenshots'), { recursive: true });
const dossier = buildDossier(out, CAPS);
writeFileSync(join(out, 'dossier.json'), dossier);
if (Buffer.byteLength(dossier, 'utf8') > CAPS.dossier_max_bytes) {
  fail(`dossier.json is over the ${CAPS.dossier_max_bytes} byte cap`);
}

console.log(`NEON BAY handed in: ${shots.length} screenshots, game/ ${(gameBytes / 1048576).toFixed(2)} MiB -> ${out}`);
