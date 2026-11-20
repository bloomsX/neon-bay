# NEON BAY — Performance Report

Rebuild 3 (recording 6), 2026-11-20. All numbers below are measured, not
estimated. The frame-rate numbers come from headless Chromium on SwiftShader
(software rendering, no GPU) at 1280x720 — that is the floor. On real
graphics hardware the game runs much faster: the scene is ~23k triangles
across 15-22 draw calls with zero per-frame allocation in the hot loop.

## Frame rate (live play, SwiftShader floor)

Measured with `node tools/fps.mjs`: each scene is played live (keys held,
simulation running) for 5 s after a 2 s warmup, sampling the game's own
frame meter. Full data in `fps-report.json`.

| Scene | Avg FPS | Min FPS | Draw calls | Triangles | Pixel ratio |
|-------|--------:|--------:|-----------:|----------:|------------:|
| Title | 4.64 | 3.91 | 17 | 22,996 | 0.5 |
| Walking | 4.11 | 3.87 | 17 | 22,996 | 0.5 |
| Driving | 4.79 | 4.29 | 22 | 23,056 | 0.5 |
| 3-star chase | 4.22 | 3.87 | 15 | 22,992 | 0.5 |

Zero console errors during the measurement.

## Adaptive resolution

The renderer starts at the device pixel ratio (capped at 2x) and steps down
through 2 -> 1.5 -> 1.25 -> 1 -> 0.75 -> 0.5 when the frame rate stays
below 22 FPS, stepping back up above 42 FPS. On SwiftShader it settles at
0.5x, which is what roughly doubles the frame rate versus a fixed 1x
(1.9 FPS before the adaptive floor was added). On real hardware it holds
2x. Staged screenshots lock the ratio at 2x, so capture quality is never
affected by this.

## What the engine does to stay fast

- One `InstancedMesh` per object class (buildings, windows, palms, lamps,
  cars, pedestrians, shadows, particles) — 15-22 draw calls for the whole
  city, ~23k triangles total.
- Fixed 1/60 s simulation steps, decoupled from the render rate, with a
  cap of 8 steps per frame so a slow frame cannot spiral.
- No shadow maps; lighting is one hemisphere light plus emissive windows
  and neon signs. No per-frame allocation in the render loop.
- Traffic, pedestrians and police are a pure simulation (`game/src/world.js`
  has no browser dependencies) and are unit-tested headlessly.
- Zero network requests: three.js r180 is vendored
  (`game/vendor/three.module.min.js` + `three.core.min.js`, sha512-verified
  against the npm registry) and all audio is procedural WebAudio.

## Submission gates (verified with a real `main.ts` run)

- Dossier text: **111,217 bytes** (cap 163,840) — schema `makefun/dossier/v1`,
  4 screenshots, cover image 0. `main.ts` exits 0.
- Game payload: 832 KiB (cap 50 MiB), 10 source files + 2 vendored files.
- Screenshots: 4 x 1280x720 JPEG, all inside the gate (long side <= 1280,
  <= 256 KiB, short side >= 480). See `shots-report.json`:
  1-start.jpg 86,169 B; 2-drive.jpg 105,188 B; 3-chase.jpg 116,109 B;
  4-mission.jpg 75,564 B. Zero console errors, zero external requests
  during capture.

## Stability

`node tools/stability.mjs`: **90 passed, 0 failed.** Covers city
generation (no overlapping buildings), determinism, the full 3-mission
chain ($300 / $800 / $2,500), busted/wasted mid-chain, saves (valid load +
16 corrupt shapes rejected safely), enter/exit x20, shooting (pedestrian,
police car, wall blocking), wanted levels 0-5 (police counts, roadblocks
at 4+ stars, heat decay + escape), the taxi job, pickups, a 60 s traffic
run (no NaN, cars on roads, no overlap), a 10-minute soak (36,000 steps),
and a headless browser play pass (boot, walk, steal, drive, shoot, pause,
zero console errors, zero external requests).
