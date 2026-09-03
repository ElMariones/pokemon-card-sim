import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BOUNDS, boundsHeight, boundsWidth, mirrorBounds, opaqueBounds,
} from './index';

/**
 * Build an RGBA buffer with one opaque rectangle in it, the way a sprite sheet
 * hands us a Pokémon sitting in a mostly empty box.
 */
function withRect(
  width: number, height: number,
  rect: { x: number; y: number; w: number; h: number },
  alpha = 255,
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      data[(y * width + x) * 4 + 3] = alpha;
    }
  }
  return data;
}

describe('opaqueBounds', () => {
  it('finds the rectangle a sprite actually occupies', () => {
    const data = withRect(100, 100, { x: 20, y: 30, w: 40, h: 20 });
    expect(opaqueBounds(data, 100, 100)).toEqual({ x0: 0.2, y0: 0.3, x1: 0.6, y1: 0.5 });
  });

  it('counts the last opaque column, so a full-bleed sprite measures as full', () => {
    const data = withRect(10, 10, { x: 0, y: 0, w: 10, h: 10 });
    expect(opaqueBounds(data, 10, 10)).toEqual({ x0: 0, y0: 0, x1: 1, y1: 1 });
  });

  it('finds a single pixel rather than collapsing to nothing', () => {
    const data = withRect(10, 10, { x: 4, y: 7, w: 1, h: 1 });
    expect(opaqueBounds(data, 10, 10)).toEqual({ x0: 0.4, y0: 0.7, x1: 0.5, y1: 0.8 });
  });

  it('ignores near-transparent pixels, which are antialiasing and not the animal', () => {
    const data = withRect(20, 20, { x: 5, y: 5, w: 5, h: 5 });
    // A faint halo one pixel outside the body on every side.
    for (let i = 4; i < 11; i++) {
      data[(4 * 20 + i) * 4 + 3] = 8;
      data[(i * 20 + 4) * 4 + 3] = 8;
    }
    expect(opaqueBounds(data, 20, 20)).toEqual({ x0: 0.25, y0: 0.25, x1: 0.5, y1: 0.5 });
  });

  it('falls back rather than returning an inverted box for an empty image', () => {
    expect(opaqueBounds(new Uint8ClampedArray(400), 10, 10)).toEqual(DEFAULT_BOUNDS);
    expect(opaqueBounds(new Uint8ClampedArray(0), 0, 0)).toEqual(DEFAULT_BOUNDS);
  });

  it('never returns a box wider or taller than the image', () => {
    const data = withRect(32, 32, { x: 0, y: 3, w: 32, h: 20 });
    const b = opaqueBounds(data, 32, 32);
    expect(boundsWidth(b)).toBeLessThanOrEqual(1);
    expect(boundsHeight(b)).toBeLessThanOrEqual(1);
    expect(b.x0).toBeGreaterThanOrEqual(0);
    expect(b.y1).toBeLessThanOrEqual(1);
  });
});

describe('mirrorBounds', () => {
  it('reflects a box across the vertical centre line', () => {
    expect(mirrorBounds({ x0: 0.1, y0: 0.3, x1: 0.4, y1: 0.8 }))
      .toEqual({ x0: 0.6, y0: 0.3, x1: 0.9, y1: 0.8 });
  });

  it('keeps the box the same size, because a mirror is not a resize', () => {
    const b = { x0: 0.12, y0: 0.2, x1: 0.77, y1: 0.9 };
    const m = mirrorBounds(b);
    expect(boundsWidth(m)).toBeCloseTo(boundsWidth(b), 10);
    expect(boundsHeight(m)).toBeCloseTo(boundsHeight(b), 10);
  });

  it('is its own inverse', () => {
    const b = { x0: 0.12, y0: 0.2, x1: 0.77, y1: 0.9 };
    const round = mirrorBounds(mirrorBounds(b));
    expect(round.x0).toBeCloseTo(b.x0, 10);
    expect(round.x1).toBeCloseTo(b.x1, 10);
  });
});

describe('DEFAULT_BOUNDS', () => {
  it('is forgiving: smaller than a real sprite rather than larger', () => {
    // A Gen V sprite's subject typically spans well over half its canvas, so a
    // fallback of about half is a hitbox the player will never feel cheated by.
    expect(boundsWidth(DEFAULT_BOUNDS)).toBeLessThan(0.6);
    expect(boundsHeight(DEFAULT_BOUNDS)).toBeLessThan(0.6);
    expect(boundsWidth(DEFAULT_BOUNDS)).toBeGreaterThan(0.3);
  });
});
