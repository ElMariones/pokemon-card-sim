/**
 * All money in this project is an integer number of cents.
 *
 * Floating point dollars are banned. `0.1 + 0.2 !== 0.3` is not an acceptable
 * property for a system that keeps an auditable ledger, and every currency
 * bug we would otherwise spend a week chasing starts with a float somewhere.
 */
export type Cents = number & { readonly __brand: 'Cents' };

export const cents = (n: number): Cents => {
  if (!Number.isFinite(n)) throw new RangeError(`Cents must be finite, got ${n}`);
  return Math.round(n) as Cents;
};

/** Convert a source price like 8.78 (dollars) into 878 cents. */
export const dollarsToCents = (dollars: number): Cents => cents(dollars * 100);

export const ZERO = cents(0);

export const addCents = (a: Cents, b: Cents): Cents => cents(a + b);
export const subCents = (a: Cents, b: Cents): Cents => cents(a - b);

/** Multiply money by a dimensionless factor (a market modifier, a grade multiplier). */
export const scaleCents = (amount: Cents, factor: number): Cents => cents(amount * factor);

export function formatCents(amount: Cents, currency = 'USD', locale = 'en-US'): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount / 100);
}
