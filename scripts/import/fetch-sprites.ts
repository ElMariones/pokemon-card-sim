import fs from 'node:fs';
import path from 'node:path';
import { FLAPPY_SPRITES, SNAKE_BERRIES, SNAKE_SPRITES } from '@pcs/minigame-engine';

/**
 * Download the arcade's pixel art.
 *
 * These are Generation V *animated* sprites, and the animation is the reason
 * the flappy and snake games render in the DOM rather than on a canvas:
 * `drawImage` of a GIF paints only its first frame, so a canvas version would
 * fly a dead sprite.
 *
 * Flappy needs a front sprite per roster entry. Snake needs the front *and*
 * the back of everything that can stand in the line, because a Pokémon walking
 * up the board shows the player its back; the front, mirrored or not, does the
 * other three directions. Snake also scatters berries, which come from the
 * item sprite set.
 *
 * The files are committed rather than hotlinked. Card art is hotlinked because
 * the catalogue is tens of thousands of images that change; this is a few
 * dozen small GIFs that never change, and committing them keeps a second host
 * out of next.config's remotePatterns and off the runtime path entirely.
 *
 * Unlike the `data:*` importers this one touches no database, so it carries
 * none of the PGlite single-process hazard and is safe to run with the dev
 * server up.
 */

const BASE = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites';
const ANIMATED = `${BASE}/pokemon/versions/generation-v/black-white/animated`;

const OUT_DIR = path.join(process.cwd(), 'apps', 'web', 'public', 'sprites');

async function fetchTo(url: string, dest: string): Promise<boolean> {
  if (fs.existsSync(dest)) return false;
  fs.mkdirSync(path.dirname(dest), { recursive: true });

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText} (${url})`);

  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length === 0) throw new Error(`Empty response (${url})`);

  fs.writeFileSync(dest, bytes);
  console.log(`  ${path.relative(OUT_DIR, dest)}  ${(bytes.length / 1024).toFixed(1)} KB`);
  return true;
}

async function main() {
  let downloaded = 0;
  let skipped = 0;
  const tally = (did: boolean) => (did ? downloaded++ : skipped++);

  const fronts = new Set<number>([...FLAPPY_SPRITES, ...SNAKE_SPRITES]);
  for (const dex of fronts) {
    tally(await fetchTo(`${ANIMATED}/${dex}.gif`, path.join(OUT_DIR, 'pokemon', `${dex}.gif`)));
  }
  for (const dex of SNAKE_SPRITES) {
    tally(await fetchTo(
      `${ANIMATED}/back/${dex}.gif`,
      path.join(OUT_DIR, 'pokemon', 'back', `${dex}.gif`),
    ));
  }
  for (const berry of SNAKE_BERRIES) {
    tally(await fetchTo(`${BASE}/items/${berry}.png`, path.join(OUT_DIR, 'items', `${berry}.png`)));
  }

  console.log(`sprites: ${downloaded} downloaded, ${skipped} already present -> ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
