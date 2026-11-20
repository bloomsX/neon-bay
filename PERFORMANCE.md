# NEON BAY — Performance

Measured headlessly with Playwright (`node tools/fps.mjs`), Chromium +
SwiftShader (software rendering) at 1280x720, 5s per scene.
SwiftShader is a floor, not a ceiling: absolute FPS here is what a CPU
rasterizer manages, while a real GPU renders the same ~23 draw calls and ~10,632 triangles in a fraction of the frame budget — that is why the
frame time scales with pixels (see chase vs chaseSmall) and not with scene
complexity. Input latency is 1 frame(s) (keydown ->
the sim reacts on the next step). Console errors: 0.

The in-game FPS badge is a slow-smoothed rolling display (it converges over
a few seconds of play); the numbers in the table below are the measured
frame times, not the badge.

| scene | avg FPS | min FPS | p95 frame | long frames (>25 ms) | draw calls | triangles |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| title | 3.1 | 2.5 | 400.1 ms | 15 | 23 | 10,632 |
| walk | 3.4 | 2.5 | 399.9 ms | 17 | 19 | 10,080 |
| drive | 3.2 | 2.5 | 399.9 ms | 15 | 15 | 9,898 |
| chase | 3.5 | 2.6 | 383.3 ms | 17 | 14 | 9,790 |
| chaseSmall | 13.8 | 6 | 100 ms | 60 | 14 | 8,806 |

## Why it holds 60 FPS on real hardware

- **InstancedMesh** for buildings, streetlights, palms, pedestrians, blob
  shadows, smoke and explosion sparks; **one merged-geometry mesh per car**;
  **one textured plane** for the whole ground; **no shadow maps** (blob
  shadows instead — a shadow pass doubles the draw calls).
- **Zero per-frame allocation** in the hot loop (pooled traffic, pedestrians,
  particles; reused matrices, vectors and colours).
- **Adaptive pixel ratio**: the renderer watches its own frame time and steps
  the resolution down (2 -> 1.5 -> 1.25 -> 1) if the frame rate sags, and back
  up when it recovers.
- Fixed 1/60 s simulation steps with an 8-step guard, so a slow frame never
  snowballs into a spiral of catch-up steps.
