import { cents, type Cents } from '@pcs/shared';
import type { MinigameId } from './types';

/**
 * Everything the arcade sells.
 *
 * Prices live here rather than in the database because they are game design,
 * not player data — and because the buy endpoint has to resolve a price from
 * an id it was given, never accept a price it was told.
 *
 * Nothing in this catalogue may affect a payout, a hitbox, or a difficulty
 * curve. Buying Rayquaza does not make you richer.
 */

export interface Cosmetic {
  id: string;
  game: MinigameId;
  name: string;
  blurb: string;
  price: Cents;
  /** Dex number, naming the sprite file the importer downloads. Flappy only. */
  sprite?: number;
  /** Two colours the UI themes the item's card and its game with. */
  palette: readonly [string, string];
}

/** Dex ids the sprite importer fetches. Kept beside the catalogue that needs them. */
export const FLAPPY_SPRITES = [16, 41, 25, 130, 6, 384] as const;

export const COSMETICS: readonly Cosmetic[] = [
  // --- Flappy: who you fly as -------------------------------------------
  {
    id: 'flappy-pidgey', game: 'flappy', name: 'Pidgey',
    blurb: 'Everyone starts on Route 1.',
    price: cents(0), sprite: 16, palette: ['#c8a870', '#6d5a3a'],
  },
  {
    id: 'flappy-zubat', game: 'flappy', name: 'Zubat',
    blurb: 'It cannot see the obstacles either.',
    price: cents(2_500), sprite: 41, palette: ['#8f7fd6', '#4a3f7a'],
  },
  {
    id: 'flappy-pikachu', game: 'flappy', name: 'Pikachu',
    blurb: 'Cannot fly. Refuses to be told.',
    price: cents(6_000), sprite: 25, palette: ['#f2cb45', '#8a6a2a'],
  },
  {
    id: 'flappy-gyarados', game: 'flappy', name: 'Gyarados',
    blurb: 'Enormous, furious, airborne.',
    price: cents(12_000), sprite: 130, palette: ['#5aa8d8', '#2a5a7a'],
  },
  {
    id: 'flappy-charizard', game: 'flappy', name: 'Charizard',
    blurb: 'The one the whole hobby is about.',
    price: cents(25_000), sprite: 6, palette: ['#e8763a', '#8a3a1a'],
  },
  {
    id: 'flappy-rayquaza', game: 'flappy', name: 'Rayquaza',
    blurb: 'Sky high, in every sense.',
    price: cents(50_000), sprite: 384, palette: ['#5ac888', '#1a5a3a'],
  },

  // --- Match: the back of the card --------------------------------------
  {
    id: 'match-classic', game: 'match', name: 'Classic back',
    blurb: 'The blue back you already know.',
    price: cents(0), palette: ['#3a5aa8', '#1a2a5a'],
  },
  {
    id: 'match-holo', game: 'match', name: 'Holo foil',
    blurb: 'Catches the light on every flip.',
    price: cents(4_000), palette: ['#6fe6ff', '#a98cff'],
  },
  {
    id: 'match-gold', game: 'match', name: 'Gold etch',
    blurb: 'Etched brass. Deeply unnecessary.',
    price: cents(15_000), palette: ['#f7cd72', '#8a6a2a'],
  },
  {
    id: 'match-glitch', game: 'match', name: 'Glitch back',
    blurb: 'A misprint someone paid a lot for.',
    price: cents(30_000), palette: ['#ff7ec2', '#8affc1'],
  },

  // --- Type: the surface you type on ------------------------------------
  {
    id: 'type-manila', game: 'type', name: 'Manila pad',
    blurb: 'Legal pad, felt-tip, no ceremony.',
    price: cents(0), palette: ['#e6dcc9', '#6d6759'],
  },
  {
    id: 'type-brass', game: 'type', name: 'Brass terminal',
    blurb: 'Amber phosphor on black glass.',
    price: cents(4_500), palette: ['#f7cd72', '#d3a03c'],
  },
  {
    id: 'type-foil', game: 'type', name: 'Foil holo',
    blurb: 'Typing on the face of a Charizard.',
    price: cents(18_000), palette: ['#a98cff', '#6fe6ff'],
  },
];

const BY_ID = new Map(COSMETICS.map((c) => [c.id, c]));

export const cosmeticById = (id: string): Cosmetic | undefined => BY_ID.get(id);

export const cosmeticsForGame = (game: MinigameId): Cosmetic[] =>
  COSMETICS.filter((c) => c.game === game);

/** The free item every player owns from the start. */
export function defaultCosmeticFor(game: MinigameId): Cosmetic {
  const found = cosmeticsForGame(game).find((c) => c.price === 0);
  if (!found) throw new Error(`No free default cosmetic for ${game}`);
  return found;
}
