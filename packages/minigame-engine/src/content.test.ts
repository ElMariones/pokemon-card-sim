import { describe, expect, it } from 'vitest';
import { MATCH_PAIRS, buildContent, seedRng } from './index';

describe('seedRng', () => {
  it('produces the same stream for the same seed', () => {
    const a = seedRng('abc123');
    const b = seedRng('abc123');
    for (let i = 0; i < 20; i++) expect(a()).toBe(b());
  });

  it('produces a different stream for a different seed', () => {
    expect(seedRng('abc123')()).not.toBe(seedRng('abc124')());
  });
});

describe('buildContent — the load-bearing determinism', () => {
  // The whole verification scheme rests on the server being able to rebuild
  // exactly what the client played. If this drifts, cheating becomes free.
  it('rebuilds identical content from the same seed for every game', () => {
    for (const game of ['match', 'flappy', 'type'] as const) {
      expect(buildContent(game, 'seed-xyz')).toEqual(buildContent(game, 'seed-xyz'));
    }
  });

  it('builds different content from a different seed', () => {
    expect(buildContent('type', 'seed-a')).not.toEqual(buildContent('type', 'seed-b'));
  });
});

describe('match content', () => {
  it('lays out every pair exactly twice', () => {
    const content = buildContent('match', 'deal-1');
    if (content.kind !== 'match') throw new Error('wrong kind');
    expect(content.layout).toHaveLength(MATCH_PAIRS * 2);
    for (let pair = 0; pair < MATCH_PAIRS; pair++) {
      expect(content.layout.filter((p) => p === pair)).toHaveLength(2);
    }
  });

  it('shuffles — the layout is not simply in order', () => {
    const content = buildContent('match', 'deal-1');
    if (content.kind !== 'match') throw new Error('wrong kind');
    const sorted = [...content.layout].sort((a, b) => a - b);
    expect(content.layout).not.toEqual(sorted);
  });
});

describe('flappy content', () => {
  it('generates gap centres inside the playfield for a long run', () => {
    const content = buildContent('flappy', 'pipes-1');
    if (content.kind !== 'flappy') throw new Error('wrong kind');
    expect(content.gaps.length).toBeGreaterThanOrEqual(200);
    for (const gap of content.gaps) {
      expect(gap).toBeGreaterThanOrEqual(0.15);
      expect(gap).toBeLessThanOrEqual(0.85);
    }
  });
});

describe('type content', () => {
  it('builds a passage of real length from the in-world corpus', () => {
    const content = buildContent('type', 'passage-1');
    if (content.kind !== 'type') throw new Error('wrong kind');
    expect(content.passage.length).toBeGreaterThan(120);
    expect(content.passage.length).toBe(content.length);
    expect(content.passage.trim()).toBe(content.passage);
  });

  it('contains no double spaces, so a typed character count is unambiguous', () => {
    const content = buildContent('type', 'passage-2');
    if (content.kind !== 'type') throw new Error('wrong kind');
    expect(content.passage).not.toMatch(/ {2}/);
  });
});
