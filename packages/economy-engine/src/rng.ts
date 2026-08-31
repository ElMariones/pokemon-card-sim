/**
 * Randomness in this package is always injected.
 *
 * Nothing here calls `Math.random()`. Every function that needs chance takes
 * an `Rng` so that a market day, a condition roll or a grade can be replayed
 * exactly from a seed — which is what makes the balance simulation in
 * `simulation.test.ts` meaningful and what lets the server publish a seed hash
 * for an auditable outcome (DESIGN.md sections 5 and 22).
 */

/** Returns a float in [0, 1). Same contract as `Math.random`. */
export type Rng = () => number;

/**
 * mulberry32: small, fast, and good enough for a game economy. Deterministic
 * across engines because it is pure 32-bit integer math.
 */
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

/** Integer in [min, max], inclusive. */
export const randInt = (rng: Rng, min: number, max: number): number =>
  min + Math.floor(rng() * (max - min + 1));

/** Float in [min, max). */
export const randRange = (rng: Rng, min: number, max: number): number => min + rng() * (max - min);

/**
 * Approximately normal, mean 0, standard deviation 1, hard-bounded to +/-3.
 *
 * The bound matters: an unbounded Gaussian tail on a daily price shock is
 * exactly how a market simulation ends up with a card worth 4 cents or
 * 40 million dollars after a few thousand ticks.
 */
export function randNormal(rng: Rng): number {
  // Irwin-Hall n=6, centred and scaled to unit variance.
  let sum = 0;
  for (let i = 0; i < 6; i++) sum += rng();
  return (sum - 3) * Math.SQRT2;
}

/** Pick one item from a weighted list. Weights need not be normalized. */
export function weightedPick<T>(rng: Rng, items: readonly { value: T; weight: number }[]): T {
  const total = items.reduce((a, b) => a + b.weight, 0);
  if (total <= 0) throw new RangeError('weightedPick needs at least one positive weight');
  let roll = rng() * total;
  for (const item of items) {
    roll -= item.weight;
    if (roll < 0) return item.value;
  }
  return items[items.length - 1]!.value;
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  if (items.length === 0) throw new RangeError('pick needs a non-empty array');
  return items[Math.floor(rng() * items.length)]!;
}
