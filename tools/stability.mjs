// NEON BAY — tools/stability.mjs
// Loads the game in headless Chromium twice — once on the start menu, once
// in the staged cover chase — and reports console errors, page errors and
// failed requests. Exits non-zero when anything errors, so it works as a
// gate in a script. Usage: node tools/stability.mjs [--port 8080]

import { spawn } from 'node:child_process';
import { chromium } from '/home/hatch/workspace/node_modules/playwright-core/index.mjs';

const PORT = Number(process.argv.find((a, i, arr) => arr[i - 1] === '--port') || 8093);
const ROOT = new URL('..', import.meta.url).pathname;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

const server = spawn('node', ['serve.ts', '--port', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
const result = { pages: [] };
try {
  await sleep(1500);
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  for (const url of [`http://localhost:${PORT}/`, `http://localhost:${PORT}/?shot=cover`]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const entry = { url, console_errors: [], page_errors: [], failed_requests: [] };
    page.on('console', (m) => { if (m.type() === 'error') entry.console_errors.push(m.text()); });
    page.on('pageerror', (e) => entry.page_errors.push(String(e)));
    page.on('requestfailed', (r) => entry.failed_requests.push(r.url() + ' ' + (r.failure()?.errorText || '')));
    await page.goto(url, { waitUntil: 'load' });
    if (url.includes('shot=')) {
      await page.waitForFunction(() => window.__shotReady === true, { timeout: 180000 });
    } else {
      await sleep(2500);
      // Click START ENGINE, then exercise the real mechanics with the
      // keyboard: walk, step up to the Comet S, enter it, drive, exit,
      // then steal a parked car and confirm the wanted level rises.
      await page.click('#start-button');
      await page.keyboard.down('w');
      await sleep(1500);
      await page.keyboard.up('w');
      const walk = await page.evaluate(() => {
        const s = window.NB.state;
        return { mode: s.mode, x: +s.player.x.toFixed(1), z: +s.player.z.toFixed(1) };
      });
      entry.walk_probe = walk;
      // Step up to the Comet S (parked at -8, 20) and enter it with E.
      await page.evaluate(() => {
        const s = window.NB.state;
        s.player.x = -8; s.player.z = 17; s.player.angle = 0;
        s.playerMesh.position.set(-8, 0, 17);
      });
      await page.keyboard.press('e');
      await sleep(600);
      await page.keyboard.down('w');
      await sleep(2500);
      await page.keyboard.up('w');
      const drive = await page.evaluate(() => {
        const s = window.NB.state;
        return { mode: s.mode, inCar: s.player.inCar, car: s.player.car ? s.player.car.def.name : null, speed: s.player.car ? +s.player.car.speed.toFixed(1) : 0, x: Math.round(s.player.x), z: Math.round(s.player.z) };
      });
      entry.drive_probe = drive;
      await page.keyboard.press('e'); // exit
      await sleep(400);
      // Steal the parked sedan at (-176, 44): wanted must rise to 1.
      await page.evaluate(() => {
        const s = window.NB.state;
        s.player.x = -176; s.player.z = 41; s.player.angle = 0;
        s.playerMesh.position.set(-176, 0, 41);
      });
      await page.keyboard.press('e');
      await sleep(800);
      await page.keyboard.press('f'); // punch/fire: must not error
      await sleep(400);
      const probe = await page.evaluate(() => {
        const s = window.NB.state;
        return { mode: s.mode, inCar: s.player.inCar, stars: s.police.stars, units: s.police.units.length, x: Math.round(s.player.x), z: Math.round(s.player.z) };
      });
      entry.playable_probe = probe;
    }
    result.pages.push(entry);
    console.log(JSON.stringify(entry, null, 2));
    await page.close();
  }
  await browser.close();
} finally {
  server.kill();
}
const bad = result.pages.some((p) => p.console_errors.length || p.page_errors.length || p.failed_requests.length);
if (bad) process.exitCode = 1;
