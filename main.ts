// NEON BAY — the entrypoint (Node 22, erasable TypeScript, no build step).
// Hands in the game: copies game/ and the screenshots into the output
// directory and writes dossier.json with the kit's own buildDossier, so the
// dossier the scorer recomputes is byte-identical to the one handed in.
//
//   MAKEFUN_OUTPUT_DIR=/output node main.ts
//
// The output directory defaults to /output. The run is deterministic: the
// same repository always writes the same bytes.
import { buildDossier } from './vendor/makefun-game.ts';
import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(fileURLToPath(import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR || '/output';
const gameDir = join(repoRoot, 'game');
const shotsDir = join(repoRoot, 'screenshots');

const CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
};

function isImage(name) {
  return /\.(png|jpe?g)$/i.test(name);
}

function main() {
  if (!existsSync(gameDir)) throw new Error('game/ is missing from the repository');
  if (!existsSync(join(gameDir, 'index.html'))) throw new Error('game/index.html is missing');
  mkdirSync(join(outDir, 'game'), { recursive: true });
  mkdirSync(join(outDir, 'screenshots'), { recursive: true });
  cpSync(gameDir, join(outDir, 'game'), { recursive: true });
  const shots = existsSync(shotsDir) ? readdirSync(shotsDir).filter(isImage).sort() : [];
  if (shots.length < 3) throw new Error(`screenshots/ holds ${shots.length} images, need 3 or 4`);
  for (const name of shots.slice(0, 4)) {
    cpSync(join(shotsDir, name), join(outDir, 'screenshots', name));
  }
  const dossier = buildDossier(outDir, CAPS);
  writeFileSync(join(outDir, 'dossier.json'), dossier);
  const parsed = JSON.parse(new TextDecoder().decode(dossier));
  console.log(`NEON BAY dossier written to ${outDir}`);
  console.log(`  schema: ${parsed.schema}`);
  console.log(`  dossier text: ${parsed.text.length} bytes (cap 163840)`);
  console.log(`  images: ${parsed.images.length} (cover ${parsed.cover})`);
  console.log(`  screenshots: ${shots.slice(0, 4).join(', ')}`);
  console.log(`  dossier.json: ${dossier.length} bytes`);
}

main();
