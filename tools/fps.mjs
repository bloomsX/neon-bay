// NEON BAY — tools/fps.mjs
// Measures the game's frame rate in headless Chromium: serves game/, loads
// the chase shot (traffic + pedestrians + 3-star pursuit active), counts
// requestAnimationFrame ticks for 8 seconds, and writes fps-report.json.
// Usage: node tools/fps.mjs [--port 8080]

import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { chromium } from '/home/hatch/workspace/node_modules/playwright-core/index.mjs';

const PORT = Number(process.argv.find((a, i, arr) => arr[i - 1] === '--port') || 8091);
const ROOT = new URL('..', import.meta.url).pathname;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

const server = spawn('node', ['serve.ts', '--port', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
try {
  await sleep(1500);
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://localhost:${PORT}/?shot=chase`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__shotReady === true, { timeout: 180000 });
  // Drive forward for the whole measurement so the world streams past.
  await page.keyboard.down('w');
  const frames = await page.evaluate(() => new Promise((resolve) => {
    let n = 0;
    const start = performance.now();
    function tick() {
      n++;
      if (performance.now() - start < 8000) requestAnimationFrame(tick);
      else resolve({ frames: n, ms: performance.now() - start });
    }
    requestAnimationFrame(tick);
  }));
  await page.keyboard.up('w');
  await browser.close();
  const fps = frames.frames / (frames.ms / 1000);
  const report = {
    measured_at: 'local',
    viewport: '1280x720',
    scene: 'chase shot: traffic + pedestrians + 3-star pursuit + helicopter',
    duration_s: +(frames.ms / 1000).toFixed(2),
    frames: frames.frames,
    fps: +fps.toFixed(1),
    frame_ms_avg: +(frames.ms / frames.frames).toFixed(2),
    console_errors: errors,
  };
  writeFileSync(new URL('../fps-report.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  if (errors.length) process.exitCode = 1;
} finally {
  server.kill();
}
