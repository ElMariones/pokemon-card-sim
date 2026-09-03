/**
 * Where a sprite actually is inside its own image.
 *
 * A Gen V battle sprite is a 96x96 canvas with a Pokémon somewhere in the
 * middle of it. Pidgey occupies about a third of that box; the rest is empty
 * pixels. Colliding against the box means dying to a gap the player could see
 * daylight through, and it means Pidgey and Rayquaza — very different animals —
 * fly identically sized hitboxes.
 *
 * So the box is measured rather than assumed: scan the alpha channel, keep the
 * rectangle that has anything in it, and let the game place and size the sprite
 * from that. The scan is pure and takes raw pixels, so it can be tested without
 * a browser; the browser's only job is to hand it an ImageData.
 */

/** A rectangle in image space, as fractions of the image's width and height. */
export interface SpriteBounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * What to use when a sprite has not been measured — the first frames of a run,
 * or a browser that refused us the pixels. Deliberately a little smaller than
 * a typical sprite's real extent, so the fallback is forgiving rather than
 * lethal: an unmeasured bird should not die to a gap it looked clear of.
 */
export const DEFAULT_BOUNDS: SpriteBounds = { x0: 0.24, y0: 0.24, x1: 0.76, y1: 0.76 };

/** Below this, a pixel is antialiasing or a shadow's edge, not the animal. */
const ALPHA_FLOOR = 24;

/**
 * The tightest rectangle containing every pixel more opaque than ALPHA_FLOOR.
 *
 * `rgba` is a canvas ImageData buffer: four bytes per pixel, row major.
 * Returns DEFAULT_BOUNDS for a fully transparent image, because "the sprite is
 * nowhere" is not something the caller can position anything against.
 */
export function opaqueBounds(rgba: Uint8ClampedArray, width: number, height: number): SpriteBounds {
  if (width <= 0 || height <= 0) return DEFAULT_BOUNDS;

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      if (rgba[row + x * 4 + 3]! < ALPHA_FLOOR) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < 0) return DEFAULT_BOUNDS;

  // maxX is the last opaque *column*, so the rectangle's right edge is one
  // pixel past it. Off by one here is off by one pixel of hitbox on every
  // frame of every run.
  return {
    x0: minX / width,
    y0: minY / height,
    x1: (maxX + 1) / width,
    y1: (maxY + 1) / height,
  };
}

/** The same rectangle on an image that is drawn mirrored. */
export function mirrorBounds(b: SpriteBounds): SpriteBounds {
  return { x0: 1 - b.x1, y0: b.y0, x1: 1 - b.x0, y1: b.y1 };
}

export const boundsWidth = (b: SpriteBounds): number => b.x1 - b.x0;
export const boundsHeight = (b: SpriteBounds): number => b.y1 - b.y0;
