import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { ARTWORK_DEX } from '@pcs/minigame-engine';

/**
 * Download the official artwork the arcade decorates itself with.
 *
 * Match uses these as the back of the card and Speed Type uses them as the art
 * behind the passage, so unlike the flappy roster these are seen large and
 * still — which is why they are Sugimori's official artwork rather than a 96px
 * battle sprite.
 *
 * They are re-encoded on the way in. The originals are ~130 KB PNGs at 475px,
 * and nothing here is ever drawn above 480px, so a WebP at that size is the
 * same picture at roughly a quarter of the bytes. The files are committed for
 * the same reason the sprites are: a fixed, tiny set that never changes is
 * cheaper to hold than a second image host on the runtime path.
 *
 * Unlike the `data:*` importers this one touches no database, so it carries
 * none of the PGlite single-process hazard and is safe to run with the dev
 * server up.
 */

const BASE =
  'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork';

const OUT_DIR = path.join(process.cwd(), 'apps', 'web', 'public', 'sprites', 'artwork');

/** Wide enough for the largest surface that draws one — a full-bleed card back. */
const WIDTH = 480;

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  let written = 0;
  let skipped = 0;

  for (const dex of ARTWORK_DEX) {
    const dest = path.join(OUT_DIR, `${dex}.webp`);
    if (fs.existsSync(dest)) {
      skipped++;
      continue;
    }

    const url = `${BASE}/${dex}.png`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Artwork ${dex} failed: ${res.status} ${res.statusText} (${url})`);
    }

    const source = Buffer.from(await res.arrayBuffer());
    if (source.length === 0) throw new Error(`Artwork ${dex} came back empty (${url})`);

    // `fit: inside` because the artwork is transparent-backed and squarish;
    // padding it to a fixed box would only add pixels the CSS has to hide.
    const bytes = await sharp(source)
      .resize({ width: WIDTH, height: WIDTH, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 86 })
      .toBuffer();

    fs.writeFileSync(dest, bytes);
    console.log(
      `  ${dex}.webp  ${(source.length / 1024).toFixed(0)} KB -> ${(bytes.length / 1024).toFixed(1)} KB`,
    );
    written++;
  }

  console.log(`artwork: ${written} written, ${skipped} already present -> ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
