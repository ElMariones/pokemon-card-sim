import { seedRng, shuffle, type Rng } from './rng';
import { TYPE_CORPUS } from './corpus';
import type { MinigameId } from './types';

/**
 * Everything a run's content is made of, rebuilt from its seed.
 *
 * The server hands this to the client at start and rebuilds it at settle, so a
 * claim can be checked against what was actually achievable. Only the typing
 * game currently needs the rebuild to verify a score exactly, but every game
 * generates its content the same way so a future ceiling can rely on it — the
 * snake's ceiling, for example, adds up the seeded snack stream.
 */

export const MATCH_PAIRS = 12;
export const TYPE_TARGET_CHARS = 260;

export interface MatchContent {
  kind: 'match';
  pairs: number;
  /** One pair index per cell, each appearing exactly twice. */
  layout: number[];
}

export interface FlappyContent {
  kind: 'flappy';
  /** Gap centre as a fraction of playfield height, one per obstacle. */
  gaps: number[];
}

export interface TypeContent {
  kind: 'type';
  passage: string;
  length: number;
}

/** What one caught snack is worth. Berries are the steady trickle, a wild
 * Pokémon is the jackpot — it scores double *and* joins the parade. */
export const SNAKE_BERRY_POINTS = 1;
export const SNAKE_POKEMON_POINTS = 2;

/**
 * The wild Pokémon that can appear on the meadow, as dex numbers naming the
 * animated GIFs in public/sprites/pokemon. Chosen for silhouettes that still
 * read at tail size — small, round, and brightly coloured — so a growing
 * parade stays legible as a parade.
 */
export const SNAKE_WILD_DEX: readonly number[] = [
  10, 13, 39, 52, 54, 63, 81, 92, 118, 129, 133, 152,
  155, 158, 161, 179, 187, 194, 263, 265, 280, 300, 325, 399,
] as const;

/** The shared food stream stays long enough that a run never exhausts it. */
export const SNAKE_CONTENT_ITEMS = 500;
/** How often a spawn is a wild Pokémon rather than a berry. */
const SNAKE_POKEMON_CHANCE = 0.35;

export type SnakeFood = { kind: 'berry' } | { kind: 'pokemon'; dex: number };

/** What a snack pays when eaten; the parade and the payout both add this up. */
export function snakeFoodPoints(food: SnakeFood): number {
  return food.kind === 'berry' ? SNAKE_BERRY_POINTS : SNAKE_POKEMON_POINTS;
}

export interface SnakeContent {
  kind: 'snake';
  /**
   * The spawn stream: the run eats item 0 first, item 1 second, and so on.
   * One item is on the field at a time, so the order in which the player can
   * score is exactly this order — which is what lets the server put a ceiling
   * on a claim. It is also the order the parade is built in.
   */
  foods: SnakeFood[];
}

export type MinigameContent = MatchContent | FlappyContent | TypeContent | SnakeContent;

function buildMatch(rng: Rng): MatchContent {
  const cells: number[] = [];
  for (let pair = 0; pair < MATCH_PAIRS; pair++) cells.push(pair, pair);
  return { kind: 'match', pairs: MATCH_PAIRS, layout: shuffle(rng, cells) };
}

function buildFlappy(rng: Rng): FlappyContent {
  // Far more obstacles than anyone will reach, so a long run never runs out of
  // level and never has to fall back on unseeded randomness to keep going.
  const gaps: number[] = [];
  for (let i = 0; i < 400; i++) gaps.push(0.15 + rng() * 0.7);
  return { kind: 'flappy', gaps };
}

function buildType(rng: Rng): TypeContent {
  const words: string[] = [];
  let length = 0;
  while (length < TYPE_TARGET_CHARS) {
    const word = TYPE_CORPUS[Math.floor(rng() * TYPE_CORPUS.length)]!;
    words.push(word);
    length += word.length + 1;
  }
  const passage = words.join(' ').trim();
  return { kind: 'type', passage, length: passage.length };
}

function buildSnake(rng: Rng): SnakeContent {
  // The species come from a shuffled deck that is re-dealt when it runs out,
  // so the meadow offers a genuine mix of the roster and a long parade never
  // shows one species twice in a row unless the deck turns over.
  const deck = shuffle(rng, SNAKE_WILD_DEX);
  let dealt = 0;
  const foods: SnakeFood[] = [];
  for (let i = 0; i < SNAKE_CONTENT_ITEMS; i++) {
    if (rng() < SNAKE_POKEMON_CHANCE) {
      foods.push({ kind: 'pokemon', dex: deck[dealt % deck.length]! });
      dealt++;
    } else {
      foods.push({ kind: 'berry' });
    }
  }
  return { kind: 'snake', foods };
}

export function buildContent(game: MinigameId, seed: string): MinigameContent {
  const rng = seedRng(seed);
  switch (game) {
    case 'match': return buildMatch(rng);
    case 'flappy': return buildFlappy(rng);
    case 'type': return buildType(rng);
    case 'snake': return buildSnake(rng);
  }
}
