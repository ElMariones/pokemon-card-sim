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
 *
 * Every item is a picture of a Pokémon, because that is what the arcade is
 * decorating: the bird you fly, the back of the card you flip, the art behind
 * the passage you type. The three `art*` fields below say which picture, and
 * they are the only thing the UI needs in order to render an item — a palette
 * is there to tint the furniture around it, never to stand in for it.
 */

export interface Cosmetic {
  id: string;
  game: MinigameId;
  name: string;
  blurb: string;
  price: Cents;
  /**
   * Dex number of the animated battle sprite the player flies. Flappy only.
   * Names the GIF `data:sprites` downloads into public/sprites/pokemon.
   */
  sprite?: number;
  /**
   * Dex number of the official artwork used as a card back or a backdrop.
   * Names the WebP `data:artwork` writes into public/sprites/artwork.
   */
  artwork?: number;
  /**
   * A committed image used exactly as-is, rather than framed. Only the real
   * Pokémon card back needs this: it is already a card back, so wrapping it in
   * a generated one would be drawing a frame around a frame.
   */
  image?: string;
  /** Two colours the UI themes the item's card and its game with. */
  palette: readonly [string, string];
}

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
  //
  // The free default is the real card back — the blue one every player has
  // held — so an unspent player is looking at the genuine article and every
  // purchase is a deliberate step away from it.
  {
    id: 'match-official', game: 'match', name: 'Official back',
    blurb: 'The blue back, exactly as printed.',
    price: cents(0), image: '/card-back.jpg', palette: ['#2f56a6', '#16255c'],
  },
  {
    id: 'match-pikachu', game: 'match', name: 'Pikachu back',
    blurb: 'The mascot, on the side you see most.',
    price: cents(4_000), artwork: 25, palette: ['#f2cb45', '#8a6a2a'],
  },
  {
    id: 'match-eevee', game: 'match', name: 'Eevee back',
    blurb: 'Undecided, and charming about it.',
    price: cents(9_000), artwork: 133, palette: ['#c99a63', '#6d4a2a'],
  },
  {
    id: 'match-charizard', game: 'match', name: 'Charizard back',
    blurb: 'Face down, and still the expensive one.',
    price: cents(18_000), artwork: 6, palette: ['#e8763a', '#8a3a1a'],
  },
  {
    id: 'match-mewtwo', game: 'match', name: 'Mewtwo back',
    blurb: 'It already knows where the pair is.',
    price: cents(32_000), artwork: 150, palette: ['#a98cff', '#4b3a8a'],
  },

  // --- Type: the art behind the passage ---------------------------------
  {
    id: 'type-snorlax', game: 'type', name: 'Snorlax desk',
    blurb: 'Nothing hurries him either.',
    price: cents(0), artwork: 143, palette: ['#5f7fa6', '#2d3d55'],
  },
  {
    id: 'type-lucario', game: 'type', name: 'Lucario focus',
    blurb: 'Reads the passage before you do.',
    price: cents(4_500), artwork: 448, palette: ['#5aa8d8', '#2a5a7a'],
  },
  {
    id: 'type-mew', game: 'type', name: 'Mew study',
    blurb: 'Pink, weightless, faintly smug.',
    price: cents(12_000), artwork: 151, palette: ['#ff9ecb', '#8a3a63'],
  },
  {
    id: 'type-rayquaza', game: 'type', name: 'Rayquaza ozone',
    blurb: 'Typing at altitude.',
    price: cents(28_000), artwork: 384, palette: ['#5ac888', '#1a5a3a'],
  },
];

/**
 * The dex ids each importer fetches, derived from the catalogue rather than
 * listed beside it. A hand-kept second list is a list that eventually
 * disagrees with the first, and the failure would be a missing image in the
 * shop rather than anything that raises.
 */
export const FLAPPY_SPRITES: readonly number[] = [
  ...new Set(COSMETICS.flatMap((c) => (c.sprite ? [c.sprite] : []))),
];

export const ARTWORK_DEX: readonly number[] = [
  ...new Set(COSMETICS.flatMap((c) => (c.artwork ? [c.artwork] : []))),
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

/** Where an item's picture lives, or undefined for an item that has none. */
export function cosmeticImage(cosmetic: Cosmetic): string | undefined {
  if (cosmetic.image) return cosmetic.image;
  if (cosmetic.artwork) return `/sprites/artwork/${cosmetic.artwork}.webp`;
  if (cosmetic.sprite) return `/sprites/pokemon/${cosmetic.sprite}.gif`;
  return undefined;
}
