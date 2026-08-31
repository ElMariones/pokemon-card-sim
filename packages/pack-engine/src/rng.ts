import { createHash, randomBytes } from 'node:crypto';

/**
 * Deterministic randomness for pack openings.
 *
 * Math.random() is banned here for two reasons: it cannot be seeded, so a
 * reported bad opening can never be reproduced, and its quality is
 * implementation-defined. We use xoshiro128**, which is fast, has a 2^128
 * period, and passes the standard statistical test suites.
 *
 * Production seeds come from node:crypto. Tests pass a fixed string, and the
 * same seed must always produce the same pack — that property is what makes
 * an opening auditable after the fact.
 */

export type Rng = () => number;

/** Expand an arbitrary string seed into four well-mixed 32-bit words. */
function seedState(seed: string): [number, number, number, number] {
  const digest = createHash('sha256').update(seed).digest();
  return [
    digest.readUInt32LE(0),
    digest.readUInt32LE(4),
    digest.readUInt32LE(8),
    digest.readUInt32LE(12),
  ];
}

const rotl = (x: number, k: number): number => ((x << k) | (x >>> (32 - k))) >>> 0;

/**
 * xoshiro128** — returns a float in [0, 1).
 *
 * The generator produces a 32-bit integer; dividing by 2^32 gives a uniform
 * float whose granularity (2^-32) is far finer than any pull rate we model.
 */
export function makeRng(seed: string): Rng {
  let [s0, s1, s2, s3] = seedState(seed);

  // A zero state is a fixed point for xoshiro; sha256 makes this essentially
  // impossible, but the generator degenerates completely if it happens.
  if ((s0 | s1 | s2 | s3) === 0) s0 = 1;

  return () => {
    const result = (Math.imul(rotl(Math.imul(s1, 5) >>> 0, 7), 9) >>> 0) >>> 0;
    const t = (s1 << 9) >>> 0;

    s2 = (s2 ^ s0) >>> 0;
    s3 = (s3 ^ s1) >>> 0;
    s1 = (s1 ^ s2) >>> 0;
    s0 = (s0 ^ s3) >>> 0;
    s2 = (s2 ^ t) >>> 0;
    s3 = rotl(s3, 11);

    return result / 4294967296;
  };
}

/** A cryptographically random seed, for real openings. */
export const createSeed = (): string => randomBytes(32).toString('base64url');

/**
 * Published alongside every opening so a result can be audited without
 * revealing the seed itself (which would let a player predict later packs).
 */
export const hashSeed = (seed: string): string =>
  createHash('sha256').update(seed).digest('hex');

export interface Weighted {
  weight: number;
}

/**
 * Pick one entry with probability proportional to its weight.
 *
 * Entries with weight <= 0 are unreachable, which the callers rely on to
 * disable a card without removing it from a table.
 */
export function weightedPick<T extends Weighted>(entries: readonly T[], rng: Rng): T {
  if (entries.length === 0) {
    throw new Error('weightedPick called with an empty table');
  }

  let total = 0;
  for (const e of entries) if (e.weight > 0) total += e.weight;

  if (total <= 0) {
    throw new Error('weightedPick called with no positively-weighted entries');
  }

  let roll = rng() * total;
  for (const e of entries) {
    if (e.weight <= 0) continue;
    roll -= e.weight;
    // Strictly-less-than would make the final entry unreachable when the roll
    // lands exactly on the cumulative total.
    if (roll < 0) return e;
  }

  // Only reachable through floating-point drift on the final comparison.
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e && e.weight > 0) return e;
  }
  throw new Error('weightedPick failed to select an entry');
}

/**
 * Pick `n` distinct entries. Used for slots that must not repeat a card.
 *
 * If the table cannot supply `n` distinct entries, this returns as many as it
 * can rather than looping forever — a small set legitimately has fewer holos
 * than a pack has holo slots.
 */
export function weightedPickDistinct<T extends Weighted>(
  entries: readonly T[],
  n: number,
  rng: Rng,
  keyOf: (entry: T) => string,
): T[] {
  const chosen: T[] = [];
  const used = new Set<string>();
  const pool = entries.filter((e) => e.weight > 0);

  const distinctAvailable = new Set(pool.map(keyOf)).size;
  const target = Math.min(n, distinctAvailable);

  let guard = 0;
  const maxAttempts = target * 200 + 100;

  while (chosen.length < target && guard++ < maxAttempts) {
    const pick = weightedPick(pool, rng);
    const key = keyOf(pick);
    if (used.has(key)) continue;
    used.add(key);
    chosen.push(pick);
  }

  // Rejection sampling degrades badly when one entry dominates the weight, so
  // fall back to a deterministic sweep of what is left.
  if (chosen.length < target) {
    for (const e of pool) {
      if (chosen.length >= target) break;
      const key = keyOf(e);
      if (used.has(key)) continue;
      used.add(key);
      chosen.push(e);
    }
  }

  return chosen;
}
