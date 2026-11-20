// NEON BAY — screenshot capture (Playwright, headless Chromium).
// Captures the 4 staged shots from shots.json into screenshots/.
//
// GATE LIMIT (hard, sealed — kit competition.yaml reference/gate.json, and the
// entry's own main.ts CAPS): each screenshot at most 256 KiB, LONG SIDE AT
// MOST 1280 px, short side at least 480 px. A 1920x1080 or 3840x2160 FILE would
// fail the gate outright ("long side over the 1280 px cap"), so no submitted
// still can be Full HD or 4K. What the gate does NOT cap is the RENDER
// resolution: the page is captured at a 1280x720 CSS viewport with
// deviceScaleFactor 2, so Chromium renders the game + HUD at 2560x1440 device
// pixels and downsamples to a 1280x720 JPEG (Playwright scale: 'css'). The
// submitted still is gate-legal and visibly crisper than a native 1280x720
// render (2x supersampled anti-aliasing, sharper HUD text). The game itself
// still renders crisply at high DPR on real displays; only the stills are
// capped. The renderer's adaptive pixel-ratio step-down is pinned at its
// maximum during capture via window.__lockRatio (game/src/render.js).
// Each shot tries JPEG qualities 90..45 and keeps the first encode that fits
// under 250 KiB (a safety margin under the 262,144 cap).
// Usage: node tools/shots.mjs [--port 8091] [--only 1-start.jpg]
// Exits non-zero if any shot fails, the game logs a console error, or a network
// request escapes localhost (the game must load fully offline).
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, statSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from '../../node_modules/playwright-core/index.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const SHOTS = JSON.parse(readFileSync(join(root, 'shots.json'), 'utf8'));

const PORT = Number(process.argv.find((a) => a.startsWith('--port='))?.split('=')[1] ?? 8091);
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.split('=')[1];
const MAX_BYTES = 250000; // scorer cap is 262144; keep a safety margin

// Gate-legal output is 1280x720; the 2x deviceScaleFactor makes the render
// 2560x1440 and Playwright's scale:'css' downsamples to the 1280x720 file.
const VIEWPORT = { width: 1280, height: 720 };
const DEVICE_SCALE_FACTOR = 2;
const QUALITIES = [90, 85, 75, 65, 55, 45];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const server = spawn(process.execPath, ['serve.ts', '--port', String(PORT), '--quiet'], { cwd: root, stdio: 'ignore' });
  const results = [];
  let failed = false;
  try {
    // Wait for the server.
    for (let i = 0; i < 40; i += 1) {
      try {
        await fetch(`http://127.0.0.1:${PORT}/`);
        break;
      } catch {
        await sleep(250);
      }
    }
    const browser = await chromium.launch({
      executablePath: `${process.env.HOME}/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome`,
      args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
    });
    try {
      for (const shot of SHOTS) {
        if (ONLY && shot.name !== ONLY) continue;
        const page = await browser.newPage({
          viewport: VIEWPORT,
          deviceScaleFactor: DEVICE_SCALE_FACTOR,
        });
        // Pin the game's adaptive pixel ratio at its maximum before any game
        // code runs, so the 2x render is not stepped down in headless mode.
        await page.addInitScript(() => {
          window.__lockRatio = true;
        });
        const errors = [];
        const external = [];
        page.on('console', (m) => {
          if (m.type() === 'error') errors.push(m.text());
        });
        page.on('pageerror', (e) => errors.push(String(e)));
        page.on('request', (r) => {
          const url = r.url();
          if (!url.startsWith(`http://127.0.0.1:${PORT}`) && !url.startsWith('data:') && !url.startsWith('blob:')) {
            external.push(url);
          }
        });
        let captured = null;
        await page.goto(`http://127.0.0.1:${PORT}/${shot.query}`, { waitUntil: 'domcontentloaded' });
        try {
          await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 60000 });
        } catch {
          errors.push(`__shotReady never fired for ${shot.name}`);
        }
        await sleep(400); // let the sunset + HUD settle one more frame
        if (!errors.length) {
          for (const q of QUALITIES) {
            const buf = await page.screenshot({ type: 'jpeg', quality: q, scale: 'css' });
            if (buf.length <= MAX_BYTES) {
              captured = { label: '1280x720 (2x supersampled)', quality: q, bytes: buf.length, buf };
              break;
            }
          }
        }
        if (!captured) {
          console.error(`FAIL ${shot.name}: no quality fits the 256 KiB cap`);
          failed = true;
        } else {
          const outPath = join(root, 'screenshots', shot.name);
          mkdirSync(join(root, 'screenshots'), { recursive: true });
          writeFileSync(outPath, captured.buf);
          const stats = statSync(outPath);
          results.push({ name: shot.name, res: captured.label, quality: captured.quality, bytes: stats.size });
          console.log(`${shot.name}: ${captured.label} q${captured.quality} ${(stats.size / 1024).toFixed(1)} KiB`);
        }
        if (errors.length) {
          console.error(`ERRORS in ${shot.name}:`, errors.slice(0, 5).join(' | '));
          failed = true;
        }
        if (external.length) {
          console.error(`EXTERNAL REQUESTS in ${shot.name}:`, external.slice(0, 5).join(' | '));
          failed = true;
        }
        await page.close();
      }
    } finally {
      await browser.close();
    }
  } finally {
    server.kill();
  }
  writeFileSync(join(root, 'shots-report.json'), JSON.stringify({ shots: results, failed }, null, 2));
  console.log(JSON.stringify({ shots: results, failed }, null, 2));
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
