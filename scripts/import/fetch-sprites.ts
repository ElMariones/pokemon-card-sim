import fs from 'node:fs';
import path from 'node:path';
import { FLAPPY_SPRITES } from '@pcs/minigame-engine';

/**
 * Download the flappy roster's pixel art.
 *
 * These are Generation V *animated* sprites, and the animation is the reason
 * the flappy game renders in the DOM rather than on a canvas: `drawImage` of a
 * GIF paints only its first frame, so a canvas version would fly a dead sprite.
 *
 * The files are committed rather than hotlinked. Card art is hotlinked because
 * the catalogue is tens of thousands of images that change; this is six small
 * GIFs that never change, and committing them keeps a second host out of
 * next.config's remotePatterns and off the runtime path entirely.
 *
 * Unlike the `data:*` importers this one touches no database, so it carries
 * none of the PGlite single-process hazard and is safe to run with the dev
 * server up.
 */

const BASE =
  'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/versions/generation-v/black-white/animated';

const OUT_DIR = path.join(process.cwd(), 'apps', 'web', 'public', 'sprites', 'pokemon');

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  let downloaded = 0;
  let skipped = 0;

  for (const dex of FLAPPY_SPRITES) {
    const dest = path.join(OUT_DIR, `${dex}.gif`);
    if (fs.existsSync(dest)) {
      skipped++;
      continue;
    }

    const url = `${BASE}/${dex}.gif`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Sprite ${dex} failed: ${res.status} ${res.statusText} (${url})`);
    }

    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length === 0) throw new Error(`Sprite ${dex} came back empty (${url})`);

    fs.writeFileSync(dest, bytes);
    console.log(`  ${dex}.gif  ${(bytes.length / 1024).toFixed(1)} KB`);
    downloaded++;
  }

  console.log(`sprites: ${downloaded} downloaded, ${skipped} already present -> ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
