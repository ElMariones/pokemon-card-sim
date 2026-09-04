import { describe, expect, it } from 'vitest';
import { buildContent, verifyClaim, type MinigameId } from './index';

const claim = (game: MinigameId, score: number, ms: number, seed = 's') => ({
  game,
  score,
  durationMs: ms,
  serverElapsedMs: ms + 200,
  content: buildContent(game, seed),
});

describe('verifyClaim — shared rules', () => {
  it('rejects a non-integer score', () => {
    expect(verifyClaim(claim('flappy', 3.5, 10_000)).ok).toBe(false);
  });

  it('rejects a negative score', () => {
    expect(verifyClaim(claim('flappy', -1, 10_000)).ok).toBe(false);
  });

  it('rejects a run that claims to have lasted longer than the server observed', () => {
    const c = { ...claim('flappy', 1, 10_000), serverElapsedMs: 3_000 };
    expect(verifyClaim(c).ok).toBe(false);
  });

  it('accepts a claimed duration a little under the server elapsed time', () => {
    // Network and page-load time legitimately sit between the two clocks.
    const c = { ...claim('flappy', 5, 10_000), serverElapsedMs: 25_000 };
    expect(verifyClaim(c).ok).toBe(true);
  });
});

describe('verifyClaim — flappy', () => {
  it('accepts a strong but human run', () => {
    // 40 obstacles in 45 seconds is excellent play, and must not be refused.
    expect(verifyClaim(claim('flappy', 40, 45_000)).ok).toBe(true);
  });

  it('rejects more obstacles than could have spawned', () => {
    expect(verifyClaim(claim('flappy', 500, 20_000)).ok).toBe(false);
  });
});

describe('verifyClaim — match', () => {
  it('accepts a fast, clean board', () => {
    expect(verifyClaim(claim('match', 850, 40_000)).ok).toBe(true);
  });

  it('rejects a board solved faster than a human can flip the cards', () => {
    expect(verifyClaim(claim('match', 1000, 800)).ok).toBe(false);
  });

  it('rejects a score above the board maximum', () => {
    expect(verifyClaim(claim('match', 5_000, 40_000)).ok).toBe(false);
  });
});

describe('verifyClaim — type', () => {
  it('accepts a fast typist who finished the whole passage', () => {
    // The entire passage in 30 seconds is a bit over 100 WPM — fast, and
    // entirely real. Refusing this would be far worse than paying a cheat.
    const c = claim('type', 0, 30_000);
    if (c.content.kind !== 'type') throw new Error('wrong kind');
    expect(verifyClaim({ ...c, score: c.content.length }).ok).toBe(true);
  });

  it('rejects more correct characters than the passage contains', () => {
    expect(verifyClaim(claim('type', 5_000, 60_000)).ok).toBe(false);
  });

  it('rejects a superhuman words-per-minute rate', () => {
    // The whole passage in two seconds is roughly 1500 WPM.
    expect(verifyClaim(claim('type', 250, 2_000)).ok).toBe(false);
  });
});

describe('verifyClaim — snake', () => {
  it('accepts a long, fast, excellent run', () => {
    // Roughly a point a second for three minutes is expert play, and must
    // not be refused: the ceiling exists to refuse the impossible, not to
    // police the merely excellent.
    expect(verifyClaim(claim('snake', 170, 180_000)).ok).toBe(true);
  });

  it('accepts the exact contents of the seeded stream at a plausible pace', () => {
    const c = claim('snake', 0, 10_000);
    if (c.content.kind !== 'snake') throw new Error('wrong kind');
    const score = c.content.foods.slice(0, 10).reduce(
      (sum, food) => sum + (food.kind === 'berry' ? 1 : 2), 0,
    );
    expect(verifyClaim({ ...c, score }).ok).toBe(true);
  });

  it('rejects more points than the stream could have fed by then', () => {
    // 150 points in ten seconds would need a snack every 65ms — above even
    // the most pokémon-heavy stream the seed could have produced.
    expect(verifyClaim(claim('snake', 150, 10_000)).ok).toBe(false);

    // One point over what the actual seeded stream supports at 60s is refused
    // too, however the seed fell.
    const c = claim('snake', 0, 60_000);
    if (c.content.kind !== 'snake') throw new Error('wrong kind');
    const eaten = Math.floor(60_000 / 650) + 3;
    const points = (items: typeof c.content.foods) =>
      items.reduce((sum, f) => sum + (f.kind === 'berry' ? 1 : 2), 0);
    expect(verifyClaim({ ...c, score: points(c.content.foods.slice(0, eaten)) + 1 }).ok)
      .toBe(false);
    // The same window at the stream's own worst-case value is accepted.
    expect(verifyClaim({ ...c, score: eaten }).ok).toBe(true);
  });

  it('rejects a claim above even the whole stream', () => {
    expect(verifyClaim(claim('snake', 10_000, 3_600_000)).ok).toBe(false);
  });

  it('rejects a snake score on another game’s content', () => {
    const c = claim('snake', 5, 10_000);
    expect(verifyClaim({ ...c, content: buildContent('flappy', 's') }).ok).toBe(false);
  });
});
