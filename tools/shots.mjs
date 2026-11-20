// NEON BAY — staged screenshot capture. Serves the game, loads each shot
// from shots.json at 2x device pixel ratio, waits for the game's ready flag,
// captures at 2560x1440 and downsamples to 1280x720 JPEG (quality 90) with
// PIL. Every file must land inside the gate (long side <= 1280, <= 256 KiB,
// short side >= 480). Fails the run on any console error or any request
// that leaves localhost. Run: node tools/shots.mjs [--port 8091]
import { spawn, execFile } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const args = process.argv.slice(2);
const portIdx = args.indexOf('--port');
const PORT = portIdx >= 0 ? parseInt(args[portIdx + 1], 10) : 8091;
const ROOT = new URL('..', import.meta.url).pathname;
const shots = JSON.parse(readFileSync(`${ROOT}shots.json`, 'utf8')).shots;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function downscale(pngPath, jpgPath) {
  return new Promise((resolve, reject) => {
    const script = [
      'import sys',
      'from PIL import Image',
      'im = Image.open(sys.argv[1]).convert("RGB")',
      'im = im.resize((1280, 720), Image.LANCZOS)',
      'im.save(sys.argv[2], "JPEG", quality=90)',
    ].join('\n');
    execFile('python3', ['-c', script, pngPath, jpgPath], (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || String(err)));
      else resolve();
    });
  });
}

async function main() {
  const server = spawn(process.execPath, ['serve.ts', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
  const report = { shots: [], errors: [], external: [] };
  let browser = null;
  try {
    for (let i = 0; i < 40; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${PORT}/`);
        if (res.ok) break;
      } catch (err) { /* not up yet */ }
      await sleep(250);
    }
    browser = await chromium.launch({
      executablePath: `${process.env.HOME}/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome`,
      args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
    });
    for (const shot of shots) {
      const page = await browser.newPage({
        viewport: { width: 1280, height: 720 },
        deviceScaleFactor: 2,
      });
      const errors = [];
      const external = [];
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      page.on('pageerror', (e) => errors.push(String(e)));
      page.on('request', (r) => {
        const u = r.url();
        if (!u.startsWith('http://127.0.0.1') && !u.startsWith('http://localhost') && !u.startsWith('data:') && !u.startsWith('blob:')) {
          external.push(u);
        }
      });
      await page.goto(`http://127.0.0.1:${PORT}/?shot=${shot.id}&seed=1337`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__game !== undefined, null, { timeout: 20000 });
      await page.evaluate(() => window.__setLockRatio(2));
      await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 90000 });
      await sleep(400);
      const pngPath = `/tmp/neonbay-${shot.id}.png`;
      const jpgPath = `${ROOT}screenshots/${shot.file}`;
      await page.screenshot({ path: pngPath, type: 'png' });
      await downscale(pngPath, jpgPath);
      const size = statSync(jpgPath).size;
      const entry = { id: shot.id, file: shot.file, width: 1280, height: 720, bytes: size, errors, external };
      report.shots.push(entry);
      report.errors.push(...errors);
      report.external.push(...external);
      console.log(`${shot.id}: ${shot.file} ${size} bytes ${size <= 262144 ? 'OK' : 'OVER GATE'} errors=${errors.length} external=${external.length}`);
      await page.close();
    }
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
  writeFileSync(`${ROOT}shots-report.json`, JSON.stringify(report, null, 2));
  const bad = report.shots.filter((s) => s.bytes > 262144 || s.errors.length || s.external.length);
  if (bad.length || report.errors.length || report.external.length) {
    console.log('SHOT CAPTURE FAILED');
    process.exit(1);
  }
  console.log('All 4 screenshots inside the gate, zero console errors, zero external requests.');
}

await main();
