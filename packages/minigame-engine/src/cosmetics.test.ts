import { describe, expect, it } from 'vitest';
import {
  ARTWORK_DEX, COSMETICS, FLAPPY_SPRITES, MINIGAME_IDS, SNAKE_ROSTER, SNAKE_SPRITES,
  cosmeticById, cosmeticImage, cosmeticsForGame, defaultCosmeticFor,
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
    expect(cosmeticById('nope')).toBeUndefined();
  });

  it('gives every item a picture, because a picture is the entire product', () => {
    for (const c of COSMETICS) {
      expect(cosmeticImage(c), c.id).toBeTruthy();
    }
  });

  it('asks each importer for exactly the ids the catalogue draws', () => {
    expect([...FLAPPY_SPRITES].sort()).toEqual(
      [...new Set(cosmeticsForGame('flappy').map((c) => c.sprite!))].sort(),
    );
    const drawn = COSMETICS.flatMap((c) => (c.artwork ? [c.artwork] : []));
    expect([...ARTWORK_DEX].sort()).toEqual([...new Set(drawn)].sort());
  });

  it('gives every flappy and snake cosmetic a sprite to render', () => {
    for (const c of [...cosmeticsForGame('flappy'), ...cosmeticsForGame('snake')]) {
      expect(c.sprite).toBeTruthy();
    }
  });

  it('asks the importer for every Pokémon that can stand in the snake line', () => {
    for (const dex of SNAKE_ROSTER) expect(SNAKE_SPRITES).toContain(dex);
    for (const c of cosmeticsForGame('snake')) expect(SNAKE_SPRITES).toContain(c.sprite);
  });

  it('gives every cosmetic a palette, so nothing renders unthemed', () => {
    for (const c of COSMETICS) {
      expect(c.palette).toHaveLength(2);
    }
  });
});
