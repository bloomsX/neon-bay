// NEON BAY — live FPS report. Serves the game and measures real play (not
// staged idle pages): title, walking, driving and a three-star chase, each
// after a warmup, sampling the game's own frame meter. Writes
// fps-report.json and prints the table. Run: node tools/fps.mjs [--port 8092]
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const args = process.argv.slice(2);
const portIdx = args.indexOf('--port');
const PORT = portIdx >= 0 ? parseInt(args[portIdx + 1], 10) : 8092;
const ROOT = new URL('..', import.meta.url).pathname;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function measure(page, label, setup, holdKey) {
  await setup();
  await sleep(2000); // warmup: let the adaptive pixel ratio settle
  const samples = [];
  const t0 = Date.now();
  if (holdKey) await page.keyboard.down(holdKey);
  while (Date.now() - t0 < 5000) {
    samples.push(await page.evaluate(() => window.__fps || 0));
    await sleep(250);
  }
  if (holdKey) await page.keyboard.up(holdKey);
  const info = await page.evaluate(() => ({
    ...window.__game.render.getInfo(),
    ratio: window.__game.render.getPixelRatio(),
  }));
  const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
  const min = Math.min(...samples);
  const row = {
    scene: label,
    avg: Math.round(avg * 100) / 100,
    min: Math.round(min * 100) / 100,
    calls: info.calls,
    triangles: info.triangles,
    pixelRatio: info.ratio,
  };
  console.log(`${label.padEnd(14)} avg ${row.avg.toFixed(2)}  min ${row.min.toFixed(2)}  calls ${row.calls}  tris ${row.triangles}  ratio ${row.pixelRatio}`);
  return row;
}

async function main() {
  const server = spawn(process.execPath, ['serve.ts', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
  const rows = [];
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
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    rows.push(await measure(page, 'title', async () => {
      await page.goto(`http://127.0.0.1:${PORT}/?seed=1337`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__game !== undefined, null, { timeout: 20000 });
    }));
    rows.push(await measure(page, 'walk', async () => {
      await page.click('.btn-big');
      await sleep(800);
    }, 'KeyW'));
    rows.push(await measure(page, 'drive', async () => {
      await page.goto(`http://127.0.0.1:${PORT}/?shot=drive&seed=1337`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 90000 });
    }, 'KeyW'));
    rows.push(await measure(page, 'chase', async () => {
      await page.goto(`http://127.0.0.1:${PORT}/?shot=chase&seed=1337`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 90000 });
    }, 'KeyW'));

    const report = {
      generatedAt: new Date().toISOString(),
      note: 'Headless Chromium on SwiftShader (software rendering, no GPU). These numbers are a floor; real graphics hardware runs much faster.',
      viewport: { width: 1280, height: 720 },
      scenes: rows,
      consoleErrors: errors,
    };
    writeFileSync(`${ROOT}fps-report.json`, JSON.stringify(report, null, 2));
    console.log('console errors:', errors.length);
    if (errors.length) {
      console.log(errors.slice(0, 5));
      process.exit(1);
    }
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
}

await main();
