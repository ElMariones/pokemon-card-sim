/**
 * Deterministic randomness, seeded from a string.
 *
 * Deliberately a local copy of mulberry32 rather than an import from
 * economy-engine: this package is the one place where the server and the
 * browser must agree bit for bit, and that agreement should not be able to
 * break because an unrelated package tuned its generator.
 */

export type Rng = () => number;

/** FNV-1a. Turns an opaque seed string into the 32-bit integer mulberry32 wants. */
export function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const seedRng = (seed: string): Rng => mulberry32(hashSeed(seed));

/** Fisher-Yates, driven by an injected Rng so the shuffle is replayable. */
export function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
