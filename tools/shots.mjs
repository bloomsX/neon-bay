// NEON BAY — tools/shots.mjs
// Captures the four screenshots from the live game: serves game/, loads each
// ?shot= staging in headless Chromium at 1280x720, waits for
// window.__shotReady, and saves a JPEG (quality 82, re-tried lower if the
// file would exceed the 256 KiB cap). Writes shots-report.json.
// Usage: node tools/shots.mjs [--port 8080]

import { spawn } from 'node:child_process';
import { statSync, writeFileSync } from 'node:fs';
import { chromium } from '/home/hatch/workspace/node_modules/playwright-core/index.mjs';

const PORT = Number(process.argv.find((a, i, arr) => arr[i - 1] === '--port') || 8092);
const ROOT = new URL('..', import.meta.url).pathname;
const SHOTS = [
  { shot: 'cover', file: '1-start.jpg' },
  { shot: 'drive', file: '2-drive.jpg' },
  { shot: 'chase', file: '3-chase.jpg' },
  { shot: 'mission', file: '4-mission.jpg' },
];
const MAX_BYTES = 262144;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

const server = spawn('node', ['serve.ts', '--port', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
const report = { shots: [] };
try {
  await sleep(1500);
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  for (const s of SHOTS) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`http://localhost:${PORT}/?shot=${s.shot}`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__shotReady === true, { timeout: 180000 });
    await sleep(400);
    const path = `${ROOT}screenshots/${s.file}`;
    let quality = 82;
    await page.screenshot({ path, type: 'jpeg', quality });
    let size = statSync(path).size;
    while (size > MAX_BYTES && quality > 55) {
      quality -= 10;
      await page.screenshot({ path, type: 'jpeg', quality });
      size = statSync(path).size;
    }
    report.shots.push({ file: s.file, shot: s.shot, width: 1280, height: 720, bytes: size, quality, console_errors: errors });
    console.log(s.file, size + ' bytes', 'quality ' + quality, errors.length ? 'ERRORS: ' + errors.join(' | ') : 'clean');
    await page.close();
  }
  await browser.close();
} finally {
  server.kill();
}
writeFileSync(new URL('../shots-report.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
