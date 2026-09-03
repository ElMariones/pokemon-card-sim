import { cents, type Cents } from '@pcs/shared';
import type { MinigameId } from './types';

/**
 * What the arcade pays, and the ceiling on how much of it a player can collect.
 *
 * These curves are the reason this package exists. They are the numbers that
 * turn a score into money, so they live on the server side of the wall and the
 * browser never sees them — a client that could compute its own payout would
 * only have to lie about one number instead of two.
 *
 * The shape of every curve is gently superlinear: a run twice as long is worth
 * slightly more than twice as much, so pushing a good run further stays
 * interesting, without the tail growing fast enough to dominate the cap.
 */

/** $150.00 per UTC day across all three games. Roughly one mid-tier booster box. */
export const DAILY_CAP_CENTS = 15_000;

export function payoutFor(game: MinigameId, score: number): Cents {
  if (!Number.isFinite(score) || score <= 0) return cents(0);
  const s = Math.floor(score);

  switch (game) {
    // Score is obstacles cleared. 10 ~ $1.55, 30 ~ $4.95, 60 ~ $10.80.
    case 'flappy':
      return cents(15 * s + Math.floor((s * s) / 20));

    // Score is the board result, 0..1000, already weighted for moves and time.
    case 'match':
      return cents(Math.floor(s * 1.5));

    // Score is correct characters typed.
    case 'type':
      return cents(s * 4);
  }
}

/**
 * Clamp a payout to what is left of today's allowance.
 *
 * A great run when nearly capped pays the remainder rather than failing — the
 * player did the work, and refusing the whole thing over the last few cents
 * would read as a bug rather than as a rule.
 */
export function clampToDailyCap(payout: Cents, earnedTodayCents: Cents): Cents {
  const remaining = DAILY_CAP_CENTS - earnedTodayCents;
  if (remaining <= 0) return cents(0);
  return cents(Math.min(payout, remaining));
}
