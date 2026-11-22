# NEON BAY — Performance Notes

How the game stays fast on a modest machine, and what was measured.

## Budgets

- Buildings: one shared window texture per warmth variant, reused across all
  buildings; each building is a single box with six materials. Roughly 40
  buildings, one draw call each.
- Lights: one shadow-casting directional sun (1024px shadow map, fixed
  320-unit frustum), one hemisphere light, one ambient light. The helicopter
  carries the only other light, a single spotlight, and only at 3+ stars.
- Streetlights, windows and neon signs are emissive / basic materials, not
  lights — they glow without costing a light.
- Traffic is capped at 12 cars, pedestrians at 16, police at 5 units plus one
  helicopter. All meshes are boxes, cylinders and spheres with shared
  geometries where practical.
- Pixel ratio is capped at 1.5 so high-DPI screens do not quadruple the
  fragment work.
- The minimap redraws on a 190x190 canvas once per frame; it is 2D canvas,
  not WebGL, and costs almost nothing.
- No per-frame allocations in the hot loop beyond the small vectors the
  camera update already owns; traffic and pedestrians reuse their objects.

## Measured

See `fps-report.json` for the local measurement (Chromium, 1280x720, default
viewport, 10 seconds of driving with traffic, pedestrians and a 3-star chase
active). `tools/fps.mjs` reproduces it: `node tools/fps.mjs`.

Caveat: the sandbox has no GPU, so the local number is SwiftShader
software rendering on a shared 1.5-CPU VM (about 1–2 fps at 1280x720) and
does NOT represent play on real hardware: the same scene is 26k triangles
and ~500 draw calls, the per-frame JavaScript (HUD, traffic, pedestrians)
measures about 0.1 ms, and the menu renders at the same rate as gameplay,
which shows the cost is entirely in software rasterisation. On any machine
with a GPU the game is expected to run at full frame rate; the local number
is recorded honestly here rather than hidden.

## Known costs

- The first frame compiles the window textures and the city; after that the
  frame time is dominated by draw calls, not by JavaScript.
- The sunset sky is a single large sphere with a gradient texture — one draw
  call, no shader work.
- Shadows are the single biggest cost; if a machine struggles, the first
  thing to lower is `CFG.PERF.shadowMap` (1024 to 512) and then the pixel
  ratio cap.
