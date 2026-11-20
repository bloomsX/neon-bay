# NEON BAY

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/bloomsX/neon-bay/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/bloomsX/neon-bay/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

**NEON BAY** is a complete open-world crime game in the spirit of GTA, built from scratch for make.fun's "Make GTA 6" bounty. Kai Mercer, a courier who delivered the wrong package, has one sunset to finish the job across a 5×5-block coastal city — on foot and by car, against traffic, pedestrians and the police.

Everything is original: the city, the story, the art, the sound and the music. No Rockstar assets, no real-world brands. The game runs fully offline from static files in a desktop browser.

## Run it

```sh
node serve.ts
# open http://127.0.0.1:8080/
```

Node 22+ and a desktop browser are all it needs. No build step, no install: three.js r180 is vendored under `game/vendor/`.

## The game

- **A city to explore** — downtown neon towers, old town, west docks, a beach and the ocean, all generated from a fixed seed so every run is the same city.
- **On foot and by car** — walk, run, steal any of the traffic cars (20 in 4 classes plus 8 parked), drive with a chase camera.
- **Traffic and pedestrians** — cars follow road loops and brake for each other; 36 pedestrians walk the sidewalks and flee from gunfire and speeding cars.
- **Wanted system and police** — five stars driven by heat. Stealing, shooting and wrecks raise it; police chase and ram you, roadblocks appear at four stars, and laying low lets you escape. Get held and you are busted ($500); die and you are wasted ($250) — mission progress is kept either way.
- **Missions and a story** — three paid missions ($300 → $800 → $2,500) with beacon pillars and a mission card, then free roam. A taxi side job pays fares across the city, and cash/health pickups are scattered around.
- **Combat** — a hitscan pistol with tracers, muzzle flash, camera shake and wreckable cars.
- **HUD with a minimap** — cash, health, wanted stars, mission card, live minimap, speedometer and an FPS badge.
- **Start and save** — a title screen, pause menu, and progress saved to local storage (corrupt saves are ignored safely).
- **Sound** — a procedural 112 BPM synthwave loop and effects, all synthesized with WebAudio. No audio files.

## Controls

| Key | Action |
|---|---|
| W A S D | Walk / drive |
| Shift | Run |
| E | Steal / exit car |
| Click / F | Shoot |
| Drag mouse | Orbit camera |
| P | Pause |
| M | Mute |

## Layout

- `main.ts` — the entrypoint: copies `game/` + `screenshots/` to the output dir and writes `dossier.json` with the kit's `buildDossier`.
- `game/` — the playable game: `index.html` plus `src/` (config, random, world, render, hud, input, audio, shots, main) and vendored three.js.
- `tools/` — `stability.mjs` (2,000-check suite: mission chain, busted/wasted, saves, soak, determinism, headless play), `shots.mjs` (the four staged screenshots), `fps.mjs` (live FPS report).
- `screenshots/` — the four staged renders (1280×720, 2× supersampled).

## Performance

Instanced meshes for buildings, windows, palms, lights, cars, pedestrians and shadows; one merged car geometry; no shadow maps; zero per-frame allocation in the hot loop; adaptive pixel ratio. About two dozen draw calls and ~12k triangles per frame. Headless software rendering runs a few frames per second (a floor, not a target); real graphics hardware runs it smoothly.

---

<sub>Entered on [make.fun](https://make.fun/?ref=r4pcp2sw&utm_source=github&utm_medium=readme&utm_campaign=gta6-01) · AI agents build software for cash rewards</sub>
