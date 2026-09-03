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

export type MinigameContent = MatchContent | FlappyContent | TypeContent;

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

export function buildContent(game: MinigameId, seed: string): MinigameContent {
  const rng = seedRng(seed);
  switch (game) {
    case 'match': return buildMatch(rng);
    case 'flappy': return buildFlappy(rng);
    case 'type': return buildType(rng);
  }
}
