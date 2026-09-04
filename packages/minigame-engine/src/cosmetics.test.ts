import { describe, expect, it } from 'vitest';
import {
  ARTWORK_DEX, COSMETICS, MINIGAME_IDS, SPRITE_DEX, cosmeticById, cosmeticImage,
  cosmeticsForGame, defaultCosmeticFor,
} from './index';

describe('the cosmetics catalogue', () => {
  it('has unique ids', () => {
    const ids = COSMETICS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('prices everything as a non-negative whole number of cents', () => {
    for (const c of COSMETICS) {
      expect(Number.isInteger(c.price)).toBe(true);
      expect(c.price).toBeGreaterThanOrEqual(0);
    }
  });

  it('gives every game exactly one free default, so no game is ever unplayable', () => {
    for (const game of MINIGAME_IDS) {
      const free = cosmeticsForGame(game).filter((c) => c.price === 0);
      expect(free).toHaveLength(1);
      expect(defaultCosmeticFor(game).price).toBe(0);
      expect(defaultCosmeticFor(game).game).toBe(game);
    }
  });

  it('offers something to buy in every game', () => {
    for (const game of MINIGAME_IDS) {
      expect(cosmeticsForGame(game).length).toBeGreaterThan(1);
    }
  });

  it('resolves a cosmetic by id and refuses an unknown one', () => {
    expect(cosmeticById('flappy-pidgey')?.game).toBe('flappy');
    expect(cosmeticById('snake-ekans')?.game).toBe('snake');
    expect(cosmeticById('nope')).toBeUndefined();
  });

  it('gives every item a picture, because a picture is the entire product', () => {
    for (const c of COSMETICS) {
      expect(cosmeticImage(c), c.id).toBeTruthy();
    }
  });

  it('asks each importer for exactly the ids the catalogue draws', () => {
    const sprites = COSMETICS.flatMap((c) => (c.sprite ? [c.sprite] : []));
    expect([...SPRITE_DEX].sort()).toEqual([...new Set(sprites)].sort());
    const drawn = COSMETICS.flatMap((c) => (c.artwork ? [c.artwork] : []));
    expect([...ARTWORK_DEX].sort()).toEqual([...new Set(drawn)].sort());
  });

  it('gives every flappy and snake cosmetic an animated sprite to render', () => {
    for (const game of ['flappy', 'snake'] as const) {
      for (const c of cosmeticsForGame(game)) {
        expect(c.sprite, c.id).toBeTruthy();
      }
    }
  });

  it('gives every cosmetic a palette, so nothing renders unthemed', () => {
    for (const c of COSMETICS) {
      expect(c.palette).toHaveLength(2);
    }
  });
});
