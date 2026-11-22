// NEON BAY — main.ts
// Entrypoint for the make.fun bounty. It hands the game in: copies game/
// and screenshots/ from this repository into the output directory and
// writes /output/dossier.json with buildDossier from vendor/makefun-game.ts.
// Standard library only, deterministic output, no timestamps, no network.

import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)));
const outputDir = resolve(process.env.MAKEFUN_OUTPUT_DIR || '/output');

rmSync(outputDir, { recursive: true, force: true });
mkdirSync(outputDir, { recursive: true });

cpSync(join(repoRoot, 'game'), join(outputDir, 'game'), { recursive: true });
cpSync(join(repoRoot, 'screenshots'), join(outputDir, 'screenshots'), { recursive: true });

const dossier = buildDossier(outputDir, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
});
writeFileSync(join(outputDir, 'dossier.json'), dossier);

console.log('NEON BAY handed in to ' + outputDir);
