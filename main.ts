// Meridian Docks: a three.js tactical FPS entry (Node 22, standard library only). The
// game is this directory's game/ folder — plain static files the browser loads as ES
// modules, three.js from an import map — and this program hands it in: it stages game/
// and screenshots/ beside this file into the output directory and writes dossier.json,
// the summary the judge reads, with the vendored make.fun library.
//
// Play it locally with `node serve.ts`, then open http://localhost:8080.
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// The scorer's own caps (reference/gate.json). Only text_max_bytes shapes the bytes;
// the others refuse an entry the scorer would refuse: more than 4 screenshots or one
// over 256 KiB; more than 993 files in game/ or 48 MiB of game files, in all — game/
// counts beside /output's own 1000-entry cap, its screenshots/ and dossier.json.
const DOSSIER_LIMITS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
};

// Copy the entry into the output directory: the game itself, then the screenshots
// that prove it runs. The game folder is required; screenshots are optional, so a
// fresh checkout stages cleanly before any capture exists.
function stageEntry(sourceDir, outDir) {
  const gameDir = join(sourceDir, 'game');
  if (!existsSync(gameDir)) throw new Error(`game/ not found beside main.ts (${gameDir})`);
  mkdirSync(outDir, { recursive: true });
  cpSync(gameDir, join(outDir, 'game'), { recursive: true });
  mkdirSync(join(outDir, 'screenshots'), { recursive: true });
  const shotsDir = join(sourceDir, 'screenshots');
  if (existsSync(shotsDir)) cpSync(shotsDir, join(outDir, 'screenshots'), { recursive: true });
}

function main() {
  stageEntry(here, out);
  writeFileSync(join(out, 'dossier.json'), buildDossier(out, DOSSIER_LIMITS));
}

main();
