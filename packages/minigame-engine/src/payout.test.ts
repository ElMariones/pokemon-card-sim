import { describe, expect, it } from 'vitest';
import { cents } from '@pcs/shared';
import { DAILY_CAP_CENTS, clampToDailyCap, payoutFor, type MinigameId } from './index';

const GAMES: MinigameId[] = ['match', 'flappy', 'type'];

describe('payoutFor', () => {
  it('pays nothing for a score of zero', () => {
    for (const game of GAMES) expect(payoutFor(game, 0)).toBe(0);
  });

  it('never returns a negative payout, even for a negative score', () => {
    for (const game of GAMES) expect(payoutFor(game, -50)).toBe(0);
  });

  it('is monotonic in score', () => {
    for (const game of GAMES) {
      for (let s = 1; s < 200; s++) {
        expect(payoutFor(game, s)).toBeGreaterThanOrEqual(payoutFor(game, s - 1));
      }
    }
  });

  it('always returns whole cents', () => {
    for (const game of GAMES) {
      for (let s = 0; s < 200; s += 7) {
        expect(Number.isInteger(payoutFor(game, s))).toBe(true);
      }
    }
  });

  it('takes more than one good run to reach the daily cap', () => {
    // A single excellent run must not cap the player out; the arcade is a
    // side income, not a replacement for the card game (DESIGN.md 30).
    expect(payoutFor('flappy', 60)).toBeLessThan(DAILY_CAP_CENTS / 4);
    expect(payoutFor('match', 850)).toBeLessThan(DAILY_CAP_CENTS / 4);
    expect(payoutFor('type', 300)).toBeLessThan(DAILY_CAP_CENTS / 4);
  });
});

describe('clampToDailyCap', () => {
  it('pays in full when the player has earned nothing today', () => {
    expect(clampToDailyCap(cents(500), cents(0))).toBe(500);
  });

  it('pays only the remainder when the cap is nearly spent', () => {
    expect(clampToDailyCap(cents(500), cents(DAILY_CAP_CENTS - 200))).toBe(200);
  });

  it('pays zero once the cap is spent', () => {
    expect(clampToDailyCap(cents(500), cents(DAILY_CAP_CENTS))).toBe(0);
  });

  it('pays zero rather than a negative when the ledger somehow overshot', () => {
    expect(clampToDailyCap(cents(500), cents(DAILY_CAP_CENTS + 999))).toBe(0);
  });
});
