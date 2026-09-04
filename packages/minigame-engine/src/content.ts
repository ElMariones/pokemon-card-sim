import { seedRng, shuffle, type Rng } from './rng';
import { TYPE_CORPUS } from './corpus';
import type { MinigameId } from './types';

/**
 * Everything a run's content is made of, rebuilt from its seed.
 *
 * The server hands this to the client at start and rebuilds it at settle, so a
 * claim can be checked against what was actually achievable. Only the typing
 * game currently needs the rebuild to verify a score, but all three generate
 * their content the same way so a future ceiling can rely on it.
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

/**
 * The Pokémon that wander onto the Snake board and join the line.
 *
 * Dex numbers, because that is what names both GIFs a follower needs — the
 * front sprite for walking down or sideways, the back sprite for walking up.
 * Deliberately small and deliberately Kanto-heavy: these are the ones a
 * collector recognises at 30 pixels.
 */
export const SNAKE_ROSTER: readonly number[] = [
  1, 4, 7, 39, 52, 54, 58, 66, 43, 129, 133, 143, 94, 175, 393, 35, 37, 147,
];

export const SNAKE_COLS = 24;
export const SNAKE_ROWS = 15;
/** The fastest the line ever moves, one cell per tick. The ceiling depends on it. */
export const SNAKE_MIN_TICK_MS = 95;
export const SNAKE_POINTS_POKEMON = 10;
export const SNAKE_POINTS_BERRY = 4;

export interface SnakeContent {
  kind: 'snake';
  cols: number;
  rows: number;
  /**
   * Which Pokémon appears, in order: indexes into SNAKE_ROSTER. Where it
   * appears cannot come from the seed — a free cell depends on where the line
   * is — so the client rolls that from the same stream, past this list.
   */
  visitors: number[];
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
  const visitors: number[] = [];
  for (let i = 0; i < 300; i++) visitors.push(Math.floor(rng() * SNAKE_ROSTER.length));
  return { kind: 'snake', cols: SNAKE_COLS, rows: SNAKE_ROWS, visitors };
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
