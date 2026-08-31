/**
 * Exact integer arithmetic for the economy.
 *
 * Every multiplier in this package is expressed in **basis points**: an
 * integer where 10000 means 1.0x. This mirrors the `_bp` columns in the
 * schema (`trend_modifier_bp`, `demand_modifier_bp`, `magnitude_bp`) and it
 * exists for one reason: a float multiplier stored in Postgres and read back
 * on another machine is not guaranteed to reproduce the same cents, and this
 * game's ledger has to reconcile to the last penny.
 *
 * Money never leaves `Cents`. Multipliers never leave `Bp`.
 */
import { cents, type Cents } from '@pcs/shared';

export type Bp = number & { readonly __brand: 'Bp' };

/** 1.0x */
export const BP_ONE = 10_000 as Bp;
export const BP_ZERO = 0 as Bp;

export const bp = (n: number): Bp => {
  if (!Number.isFinite(n)) throw new RangeError(`Bp must be finite, got ${n}`);
  return Math.round(n) as Bp;
};

/** Build a Bp from a human-readable ratio. `ratioToBp(1.15) === 11500`. */
export const ratioToBp = (ratio: number): Bp => bp(ratio * 10_000);

/** Only for display and for statistics in tests. Never for money. */
export const bpToRatio = (value: Bp): number => value / 10_000;

/**
 * Compose two multipliers. Rounds to the nearest basis point, so a chain of
 * six modifiers can drift by at most a few 1/10000ths before it touches money
 * — well below one cent on any card in the catalogue.
 */
export const mulBp = (a: Bp, b: Bp): Bp => bp((a * b) / 10_000);

export const composeBp = (...factors: Bp[]): Bp => factors.reduce(mulBp, BP_ONE);

export const addBp = (a: Bp, b: Bp): Bp => bp(a + b);

export const clampBp = (value: Bp, min: Bp, max: Bp): Bp =>
  bp(Math.min(max, Math.max(min, value)));

/** Apply a multiplier to money. This is the only place bp meets cents. */
export const applyBp = (amount: Cents, factor: Bp): Cents => cents((amount * factor) / 10_000);

/** The bp value that maps `from` onto `to`. Used for reporting spreads. */
export const bpBetween = (from: Cents, to: Cents): Bp => (from === 0 ? BP_ONE : bp((to / from) * 10_000));

export const clampCents = (amount: Cents, min: Cents, max: Cents): Cents =>
  cents(Math.min(max, Math.max(min, amount)));

/**
 * Split `total` into parts proportional to `weights`, such that the parts sum
 * back to `total` **exactly**.
 *
 * Naively applying a percentage to each part and rounding independently either
 * invents or destroys a cent whenever the remainders do not line up. Largest
 * remainder allocation hands every leftover cent to the parts with the biggest
 * fractional claim, so the books always balance. This is what a sale that
 * splits into proceeds + fee, or a bundle price split across its contents,
 * must use.
 */
export function splitCents(total: Cents, weights: readonly number[]): Cents[] {
  if (weights.length === 0) return [];
  if (weights.some((w) => w < 0 || !Number.isFinite(w))) {
    throw new RangeError('splitCents weights must be finite and non-negative');
  }
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum === 0) {
    // Degenerate: give everything to the first bucket rather than lose it.
    return weights.map((_, i) => cents(i === 0 ? total : 0));
  }

  const sign = total < 0 ? -1 : 1;
  const magnitude = Math.abs(total);

  const exact = weights.map((w) => (magnitude * w) / sum);
  const floors = exact.map((v) => Math.floor(v));
  let remainder = magnitude - floors.reduce((a, b) => a + b, 0);

  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  const out = floors.slice();
  for (let k = 0; remainder > 0; k++, remainder--) {
    const target = order[k % order.length];
    if (target) out[target.i] = (out[target.i] ?? 0) + 1;
  }

  return out.map((v) => cents(sign * v));
}

/**
 * Take `factor` of `total` and return `[taken, remaining]` with
 * `taken + remaining === total`. The complement is computed by subtraction,
 * never by rounding a second percentage, so no cent is created or lost.
 */
export function partitionBp(total: Cents, factor: Bp): [Cents, Cents] {
  const taken = applyBp(total, factor);
  return [taken, cents(total - taken)];
}
