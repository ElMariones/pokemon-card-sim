# Minigames Arcade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a three-game arcade at `/games` that pays capped real cash into the existing ledger and a cosmetics shop that spends it back.

**Architecture:** A new pure package `@pcs/minigame-engine` owns every number that becomes money — payout curves, plausibility ceilings, the cosmetics catalogue, and seeded content generators. A run is a single-use database row rather than a signed token, so settling it is a state transition under a row lock. `minigame-service.ts` is the only module that touches the database and the ledger; the games are client components.

**Tech Stack:** TypeScript, Next.js 16 App Router, React 19, Drizzle ORM over PGlite/Neon, Tailwind v4, framer-motion, vitest.

**Spec:** `docs/superpowers/specs/2026-09-03-minigames-arcade-design.md`

## Global Constraints

- **Money is integer cents.** Use `Cents` and `cents()` from `@pcs/shared`. No floats anywhere in a money path.
- **Every money movement writes a `transactions` row** via `applyTransactionInTx` from `@pcs/economy-engine`. Nothing else may write `users.cash`.
- **`@pcs/minigame-engine` imports no React, no DOM, no database, and performs no I/O.** Pure functions, deterministic given a seed. Enforced by review.
- **Never call `Math.random()` in the engine.** Randomness is injected as an `Rng` (`mulberry32` from `@pcs/economy-engine`, or a local copy — see Task 1).
- **The server never trusts a client-supplied duration, price, or payout.** It measures elapsed time from its own `startedAt`, and resolves prices from the catalogue by id.
- **Do not modify** `apps/web/src/server/game.ts`, `apps/web/src/app/api/sets/route.ts`, or `packages/economy-engine/src/ledger.ts` beyond the single additive change in Task 5 — another agent has uncommitted work in those files.
- **Daily cap: 15 000 cents ($150.00) per UTC day**, across all three games, computed from the ledger.
- **Games:** `'match' | 'flappy' | 'type'`.
- Run `npm run test`, `npm run typecheck`, and `npm run lint` before each commit.

---

### Task 1: The `@pcs/minigame-engine` package and its payout curves

**Files:**
- Create: `packages/minigame-engine/package.json`
- Create: `packages/minigame-engine/src/index.ts`
- Create: `packages/minigame-engine/src/types.ts`
- Create: `packages/minigame-engine/src/payout.ts`
- Test: `packages/minigame-engine/src/payout.test.ts`
- Modify: `tsconfig.base.json` (add the path alias)
- Modify: `vitest.config.ts` (add the resolve alias)
- Modify: `apps/web/next.config.ts` (add to `transpilePackages`)
- Modify: `apps/web/package.json` (add the dependency)

**Interfaces:**
- Consumes: `Cents`, `cents` from `@pcs/shared`.
- Produces: `MinigameId`, `DAILY_CAP_CENTS`, `payoutFor(game, score) -> Cents`, `clampToDailyCap(payout, earnedTodayCents) -> Cents`.

- [ ] **Step 1: Write the failing test**

`packages/minigame-engine/src/payout.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/minigame-engine`
Expected: FAIL — cannot resolve `./index`.

- [ ] **Step 3: Scaffold the package**

`packages/minigame-engine/package.json`:

```json
{
  "name": "@pcs/minigame-engine",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "dependencies": { "@pcs/shared": "*" }
}
```

`packages/minigame-engine/src/types.ts`:

```ts
/** The three cabinets. Every game-keyed record in this package is total over these. */
export type MinigameId = 'match' | 'flappy' | 'type';

export const MINIGAME_IDS: readonly MinigameId[] = ['match', 'flappy', 'type'] as const;

export const isMinigameId = (v: unknown): v is MinigameId =>
  typeof v === 'string' && (MINIGAME_IDS as readonly string[]).includes(v);
```

`packages/minigame-engine/src/payout.ts`:

```ts
import { cents, type Cents } from '@pcs/shared';
import type { MinigameId } from './types';

/**
 * What the arcade pays, and the ceiling on how much of it a player can collect.
 *
 * These curves are the reason this package exists. They are the numbers that
 * turn a score into money, so they live on the server side of the wall and the
 * browser never sees them — a client that could compute its own payout would
 * only have to lie about one number instead of two.
 *
 * The shape of every curve is gently superlinear: a run twice as long is worth
 * slightly more than twice as much, so pushing a good run further stays
 * interesting, but not so much that the tail dominates the cap.
 */

/** $150.00 per UTC day across all three games. Roughly one mid-tier booster box. */
export const DAILY_CAP_CENTS = 15_000;

export function payoutFor(game: MinigameId, score: number): Cents {
  if (!Number.isFinite(score) || score <= 0) return cents(0);
  const s = Math.floor(score);

  switch (game) {
    // Score is pipes cleared. 10 pipes ~ $1.55, 30 ~ $4.95, 60 ~ $10.80.
    case 'flappy':
      return cents(15 * s + Math.floor((s * s) / 20));

    // Score is the board result, 0..1000, already weighted for moves and time.
    case 'match':
      return cents(Math.floor(s * 1.5));

    // Score is correct characters typed.
    case 'type':
      return cents(s * 4);
  }
}

/**
 * Clamp a payout to what is left of today's allowance.
 *
 * A great run when nearly capped pays the remainder rather than failing — the
 * player did the work, and refusing the whole thing over the last few cents
 * would read as a bug.
 */
export function clampToDailyCap(payout: Cents, earnedTodayCents: Cents): Cents {
  const remaining = DAILY_CAP_CENTS - earnedTodayCents;
  if (remaining <= 0) return cents(0);
  return cents(Math.min(payout, remaining));
}
```

`packages/minigame-engine/src/index.ts`:

```ts
export * from './types';
export * from './payout';
```

- [ ] **Step 4: Wire the package into the toolchain**

In `tsconfig.base.json`, add to `compilerOptions.paths`:

```json
"@pcs/minigame-engine": ["./packages/minigame-engine/src/index.ts"]
```

In `vitest.config.ts`, add to `resolve.alias`:

```ts
'@pcs/minigame-engine': r('./packages/minigame-engine/src/index.ts'),
```

In `apps/web/next.config.ts`, add `"@pcs/minigame-engine"` to `transpilePackages`.

In `apps/web/package.json`, add `"@pcs/minigame-engine": "*"` to `dependencies`.

Then run `npm install` so the workspace symlink is created.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run packages/minigame-engine`
Expected: PASS, 9 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/minigame-engine tsconfig.base.json vitest.config.ts apps/web/next.config.ts apps/web/package.json package-lock.json
git commit -m "Add the minigame engine and its payout curves"
```

---

### Task 2: Seeded content generators

**Files:**
- Create: `packages/minigame-engine/src/rng.ts`
- Create: `packages/minigame-engine/src/corpus.ts`
- Create: `packages/minigame-engine/src/content.ts`
- Test: `packages/minigame-engine/src/content.test.ts`
- Modify: `packages/minigame-engine/src/index.ts`

**Interfaces:**
- Consumes: `MinigameId` from Task 1.
- Produces: `seedRng(seed: string) -> Rng`, `MatchContent`, `FlappyContent`, `TypeContent`, `MinigameContent`, `buildContent(game, seed) -> MinigameContent`.

- [ ] **Step 1: Write the failing test**

`packages/minigame-engine/src/content.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/minigame-engine/src/content.test.ts`
Expected: FAIL — `buildContent` is not exported.

- [ ] **Step 3: Implement the generators**

`packages/minigame-engine/src/rng.ts`:

```ts
/**
 * Deterministic randomness, seeded from a string.
 *
 * Deliberately a local copy of mulberry32 rather than an import from
 * economy-engine: this package is the one place where the server and the
 * browser must agree bit for bit, and that agreement should not be able to
 * break because an unrelated package changed its generator.
 */

export type Rng = () => number;

/** FNV-1a. Turns an opaque seed string into the 32-bit integer mulberry32 wants. */
export function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const seedRng = (seed: string): Rng => mulberry32(hashSeed(seed));

/** Fisher-Yates, driven by an injected Rng so the shuffle is replayable. */
export function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
```

`packages/minigame-engine/src/corpus.ts`:

```ts
/**
 * The typing game's word supply.
 *
 * These are real card names, set names and era words, so the passage reads as
 * something from inside the game rather than as filler. The corpus lives here
 * rather than being drawn from the card database on purpose: the server has to
 * rebuild the exact passage from the seed at settle time, and a corpus that
 * changes when an importer runs would make yesterday's run unverifiable.
 */

export const TYPE_CORPUS: readonly string[] = [
  'Charizard', 'Blastoise', 'Venusaur', 'Pikachu', 'Raichu', 'Alakazam',
  'Machamp', 'Gengar', 'Gyarados', 'Lapras', 'Eevee', 'Vaporeon', 'Jolteon',
  'Flareon', 'Snorlax', 'Articuno', 'Zapdos', 'Moltres', 'Dragonite', 'Mewtwo',
  'Mew', 'Lugia', 'Ho-Oh', 'Celebi', 'Rayquaza', 'Groudon', 'Kyogre', 'Jirachi',
  'Garchomp', 'Lucario', 'Darkrai', 'Arceus', 'Zoroark', 'Greninja', 'Zacian',
  'base set', 'jungle', 'fossil', 'team rocket', 'neo genesis', 'skyridge',
  'ruby and sapphire', 'diamond and pearl', 'black and white', 'evolving skies',
  'hidden fates', 'shining fates', 'crown zenith', 'obsidian flames',
  'holographic', 'reverse holo', 'illustration rare', 'secret rare', 'promo',
  'first edition', 'shadowless', 'near mint', 'lightly played', 'graded',
  'population report', 'centering', 'surface', 'binder', 'sleeve', 'toploader',
  'booster box', 'elite trainer box', 'pull rate', 'god pack', 'hit',
];
```

`packages/minigame-engine/src/content.ts`:

```ts
import { seedRng, shuffle, type Rng } from './rng';
import { TYPE_CORPUS } from './corpus';
import type { MinigameId } from './types';

/**
 * Everything a run's content is made of, rebuilt from its seed.
 *
 * The server hands this to the client at start and rebuilds it at settle, so a
 * claim can be checked against what was actually achievable. Only the typing
 * game currently needs the rebuild for verification, but every game generates
 * its content the same way so that a future ceiling can rely on it.
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
  // level and never has to fall back on unseeded randomness to continue.
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
```

Add to `packages/minigame-engine/src/index.ts`:

```ts
export * from './rng';
export * from './corpus';
export * from './content';
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/minigame-engine`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/minigame-engine
git commit -m "Generate every minigame's content from its run seed"
```

---

### Task 3: Plausibility ceilings

**Files:**
- Create: `packages/minigame-engine/src/verify.ts`
- Test: `packages/minigame-engine/src/verify.test.ts`
- Modify: `packages/minigame-engine/src/index.ts`

**Interfaces:**
- Consumes: `MinigameId`, `MinigameContent`, `buildContent` from Tasks 1-2.
- Produces: `ClaimVerdict`, `verifyClaim(input: ClaimInput) -> ClaimVerdict` where
  `ClaimInput = { game: MinigameId; score: number; durationMs: number; serverElapsedMs: number; content: MinigameContent }`.

- [ ] **Step 1: Write the failing test**

`packages/minigame-engine/src/verify.test.ts`:

```ts
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
    // Network and page-load time legitimately sit between the two.
    const c = { ...claim('flappy', 5, 10_000), serverElapsedMs: 25_000 };
    expect(verifyClaim(c).ok).toBe(true);
  });
});

describe('verifyClaim — flappy', () => {
  it('accepts a strong but human run', () => {
    // 40 pipes in 45 seconds is excellent play, and must not be refused.
    expect(verifyClaim(claim('flappy', 40, 45_000)).ok).toBe(true);
  });

  it('rejects more pipes than could have spawned', () => {
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
  it('accepts a fast typist', () => {
    // ~110 WPM over 30 seconds is fast and entirely real.
    expect(verifyClaim(claim('type', 275, 30_000)).ok).toBe(true);
  });

  it('rejects more correct characters than the passage contains', () => {
    const c = claim('type', 5_000, 60_000);
    expect(verifyClaim(c).ok).toBe(false);
  });

  it('rejects a superhuman words-per-minute rate', () => {
    // The whole passage in two seconds is roughly 1500 WPM.
    expect(verifyClaim(claim('type', 250, 2_000)).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/minigame-engine/src/verify.test.ts`
Expected: FAIL — `verifyClaim` is not exported.

- [ ] **Step 3: Implement the ceilings**

`packages/minigame-engine/src/verify.ts`:

```ts
import { MATCH_PAIRS, type MinigameContent } from './content';
import type { MinigameId } from './types';

/**
 * The plausibility ceilings.
 *
 * These exist to refuse the impossible, not to police the merely excellent.
 * Every constant here is set generously against real play: a ceiling that
 * occasionally rejects a genuinely great run would be a far worse bug than one
 * that occasionally pays a cheater the daily cap they could have earned anyway.
 *
 * The server passes its own measured elapsed time. The client's `durationMs` is
 * only ever used to make a claim *stricter* — it can shorten a run's implied
 * time budget, never lengthen it.
 */

/** Obstacles cannot be cleared faster than they spawn. */
const FLAPPY_MIN_MS_PER_GAP = 700;
/** Two extra, for the pipes already on screen when a run begins. */
const FLAPPY_GRACE = 2;

/** No one resolves a pair — two flips and a look — faster than this. */
const MATCH_MIN_MS_PER_TURN = 350;
export const MATCH_MAX_SCORE = 1_000;

/** Comfortably above the human record of roughly 220 WPM. */
const TYPE_MAX_WPM = 250;
/** The conventional definition of a "word" for typing speed. */
const CHARS_PER_WORD = 5;

/** A slow page load or a slow network sits between the two clocks. */
const CLOCK_SLACK_MS = 2_000;

export interface ClaimInput {
  game: MinigameId;
  score: number;
  durationMs: number;
  /** now - startedAt, measured by the server against its own clock. */
  serverElapsedMs: number;
  /** Rebuilt from the run's seed. */
  content: MinigameContent;
}

export type ClaimVerdict = { ok: true } | { ok: false; reason: string };

const reject = (reason: string): ClaimVerdict => ({ ok: false, reason });

export function verifyClaim(input: ClaimInput): ClaimVerdict {
  const { game, score, durationMs, serverElapsedMs, content } = input;

  if (!Number.isInteger(score) || score < 0) return reject('score_not_a_natural_number');
  if (!Number.isFinite(durationMs) || durationMs < 0) return reject('duration_invalid');
  if (durationMs > serverElapsedMs + CLOCK_SLACK_MS) return reject('duration_exceeds_server_clock');

  // Trust whichever clock is less favourable to the claim.
  const budget = Math.min(durationMs, serverElapsedMs);

  switch (game) {
    case 'flappy': {
      const ceiling = Math.floor(budget / FLAPPY_MIN_MS_PER_GAP) + FLAPPY_GRACE;
      if (score > ceiling) return reject('flappy_score_exceeds_spawn_rate');
      return { ok: true };
    }

    case 'match': {
      if (score > MATCH_MAX_SCORE) return reject('match_score_above_board_maximum');
      if (score > 0 && budget < MATCH_PAIRS * MATCH_MIN_MS_PER_TURN) {
        return reject('match_solved_faster_than_humanly_possible');
      }
      return { ok: true };
    }

    case 'type': {
      if (content.kind !== 'type') return reject('content_mismatch');
      if (score > content.length) return reject('type_score_exceeds_passage_length');
      const maxChars = (TYPE_MAX_WPM * CHARS_PER_WORD * budget) / 60_000;
      if (score > maxChars) return reject('type_score_exceeds_human_wpm');
      return { ok: true };
    }
  }
}
```

Add `export * from './verify';` to `packages/minigame-engine/src/index.ts`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/minigame-engine`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/minigame-engine
git commit -m "Refuse impossible minigame scores without policing good ones"
```

---

### Task 4: The cosmetics catalogue

**Files:**
- Create: `packages/minigame-engine/src/cosmetics.ts`
- Test: `packages/minigame-engine/src/cosmetics.test.ts`
- Modify: `packages/minigame-engine/src/index.ts`

**Interfaces:**
- Consumes: `MinigameId`, `MINIGAME_IDS` from Task 1.
- Produces: `Cosmetic` (`{ id, game, name, blurb, price: Cents, kind, sprite?, palette? }`), `COSMETICS`, `cosmeticById(id) -> Cosmetic | undefined`, `cosmeticsForGame(game) -> Cosmetic[]`, `defaultCosmeticFor(game) -> Cosmetic`, `FLAPPY_SPRITES` (the dex ids the importer downloads).

- [ ] **Step 1: Write the failing test**

`packages/minigame-engine/src/cosmetics.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  COSMETICS, MINIGAME_IDS, cosmeticById, cosmeticsForGame, defaultCosmeticFor,
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

  it('gives every flappy cosmetic a sprite to render', () => {
    for (const c of cosmeticsForGame('flappy')) {
      expect(c.sprite).toBeTruthy();
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/minigame-engine/src/cosmetics.test.ts`
Expected: FAIL — `COSMETICS` is not exported.

- [ ] **Step 3: Implement the catalogue**

`packages/minigame-engine/src/cosmetics.ts`:

```ts
import { cents, type Cents } from '@pcs/shared';
import type { MinigameId } from './types';

/**
 * Everything the arcade sells.
 *
 * Prices live here rather than in the database because they are game design,
 * not player data — and because the buy endpoint must resolve a price from an
 * id it was given rather than accept a price it was told.
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
  /** Dex number; the sprite file the importer downloads. Flappy only. */
  sprite?: number;
  /** Two CSS colours the UI uses to theme the item's card and its game. */
  palette?: readonly [string, string];
}

/** Dex ids the sprite importer fetches. Kept beside the catalogue that needs them. */
export const FLAPPY_SPRITES = [16, 41, 25, 130, 6, 384] as const;

export const COSMETICS: readonly Cosmetic[] = [
  // --- Flappy: who you fly as -------------------------------------------
  { id: 'flappy-pidgey', game: 'flappy', name: 'Pidgey', blurb: 'Everyone starts on Route 1.', price: cents(0), sprite: 16, palette: ['#c8a870', '#6d5a3a'] },
  { id: 'flappy-zubat', game: 'flappy', name: 'Zubat', blurb: 'It cannot see the pipes either.', price: cents(2_500), sprite: 41, palette: ['#8f7fd6', '#4a3f7a'] },
  { id: 'flappy-pikachu', game: 'flappy', name: 'Pikachu', blurb: 'Does not fly. Refuses to be told.', price: cents(6_000), sprite: 25, palette: ['#f2cb45', '#8a6a2a'] },
  { id: 'flappy-gyarados', game: 'flappy', name: 'Gyarados', blurb: 'Enormous, furious, airborne.', price: cents(12_000), sprite: 130, palette: ['#5aa8d8', '#2a5a7a'] },
  { id: 'flappy-charizard', game: 'flappy', name: 'Charizard', blurb: 'The one the whole hobby is about.', price: cents(25_000), sprite: 6, palette: ['#e8763a', '#8a3a1a'] },
  { id: 'flappy-rayquaza', game: 'flappy', name: 'Rayquaza', blurb: 'Sky high, in every sense.', price: cents(50_000), sprite: 384, palette: ['#5ac888', '#1a5a3a'] },

  // --- Match: the back of the card --------------------------------------
  { id: 'match-classic', game: 'match', name: 'Classic back', blurb: 'The blue back you already know.', price: cents(0), palette: ['#3a5aa8', '#1a2a5a'] },
  { id: 'match-holo', game: 'match', name: 'Holo foil', blurb: 'Catches the light when it flips.', price: cents(4_000), palette: ['#6fe6ff', '#a98cff'] },
  { id: 'match-gold', game: 'match', name: 'Gold etch', blurb: 'Etched brass, deeply unnecessary.', price: cents(15_000), palette: ['#f7cd72', '#8a6a2a'] },
  { id: 'match-glitch', game: 'match', name: 'Glitch back', blurb: 'A misprint someone paid a lot for.', price: cents(30_000), palette: ['#ff7ec2', '#8affc1'] },

  // --- Type: the surface you type on ------------------------------------
  { id: 'type-manila', game: 'type', name: 'Manila pad', blurb: 'Legal pad, felt-tip, no ceremony.', price: cents(0), palette: ['#e6dcc9', '#6d6759'] },
  { id: 'type-brass', game: 'type', name: 'Brass terminal', blurb: 'Amber phosphor on black glass.', price: cents(4_500), palette: ['#f7cd72', '#d3a03c'] },
  { id: 'type-foil', game: 'type', name: 'Foil holo', blurb: 'Typing on the surface of a charizard.', price: cents(18_000), palette: ['#a98cff', '#6fe6ff'] },
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
```

Add `export * from './cosmetics';` to `packages/minigame-engine/src/index.ts`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/minigame-engine`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/minigame-engine
git commit -m "Price the arcade's cosmetics on the server side of the wall"
```

---

### Task 5: Schema and ledger types

**Files:**
- Modify: `packages/db/src/schema.ts` (append two tables)
- Modify: `packages/economy-engine/src/ledger.ts` (two entries in `TransactionType` — the only permitted change to this file)

**Interfaces:**
- Produces: `minigameRuns`, `minigameCosmetics` Drizzle tables; `'minigame_payout'` and `'cosmetic_purchase'` transaction types.

- [ ] **Step 1: Append the tables**

At the end of `packages/db/src/schema.ts`:

```ts
/**
 * One arcade run. The row *is* the run token (DESIGN spec: minigames arcade).
 *
 * A skill game cannot be fully server-authoritative — only the browser knows
 * whether the player cleared the pipe — so the design bounds the exploit
 * instead. This table is three of those four bounds: the id is opaque and
 * single-use, `startedAt` is the server's own clock rather than the client's,
 * and `seed` lets the server rebuild exactly what was played.
 *
 * Rejected claims are kept, not deleted. The audit trail is the only way anyone
 * would ever notice the scheme being probed.
 */
export const minigameRuns = pgTable('minigame_runs', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  game: text('game').notNull(),
  seed: text('seed').notNull(),
  status: text('status').notNull().default('open'),
  score: integer('score'),
  durationMs: integer('duration_ms'),
  /** Cents actually paid, after the daily-cap clamp. */
  payout: integer('payout'),
  rejectReason: text('reject_reason'),
  startedAt: timestamp('started_at').notNull().defaultNow(),
  expiresAt: timestamp('expires_at').notNull(),
  settledAt: timestamp('settled_at'),
}, (t) => [
  index('minigame_runs_user_idx').on(t.userId, t.startedAt),
  index('minigame_runs_open_idx').on(t.userId, t.game, t.status),
]);

/**
 * Which cosmetics a player owns, and which one is equipped per game.
 *
 * Both indexes are load-bearing. The first makes a double-clicked buy button
 * incapable of charging twice — in the database, not in a check that happened a
 * moment earlier. The second makes "exactly one equipped per game" an invariant
 * the database enforces, so a half-completed swap cannot leave a player with
 * two skins equipped or none.
 */
export const minigameCosmetics = pgTable('minigame_cosmetics', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  cosmeticId: text('cosmetic_id').notNull(),
  game: text('game').notNull(),
  equipped: boolean('equipped').notNull().default(false),
  acquiredAt: timestamp('acquired_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('minigame_cosmetics_user_item_uq').on(t.userId, t.cosmeticId),
  uniqueIndex('minigame_cosmetics_equipped_uq').on(t.userId, t.game)
    .where(sql`${t.equipped}`),
  index('minigame_cosmetics_user_idx').on(t.userId, t.game),
]);
```

- [ ] **Step 2: Add the two transaction types**

In `packages/economy-engine/src/ledger.ts`, extend the `TransactionType` union with two members, leaving every existing line untouched:

```ts
  | 'level_reward'
  | 'minigame_payout'
  | 'cosmetic_purchase';
```

- [ ] **Step 3: Push the schema and verify the tables exist**

Stop the dev server first — PGlite allows one process at a time (CLAUDE.md).

Run: `npm run db:push`
Expected: the two new tables are created without touching existing data.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema.ts packages/economy-engine/src/ledger.ts
git commit -m "Store arcade runs and cosmetic ownership"
```

---

### Task 6: The minigame service

**Files:**
- Create: `apps/web/src/server/minigame-service.ts`
- Test: `tests/minigame-service.test.ts`

**Interfaces:**
- Consumes: everything exported by `@pcs/minigame-engine`; `applyTransactionInTx` from `@pcs/economy-engine`; `getDb` from `@pcs/db`.
- Produces:
  - `class MinigameError extends Error { code: string }`
  - `startRun(userId: string, game: MinigameId): Promise<StartedRun>` where `StartedRun = { runId, seed, content, cardIds?, equipped, capRemaining, best }`
  - `settleRun(userId, runId, score, durationMs): Promise<SettledRun>` where `SettledRun = { payout, balanceAfter, capRemaining, best, capped }`
  - `getArcade(userId): Promise<ArcadeView>` — per-game best and today's earnings, plus owned/equipped cosmetics
  - `buyCosmetic(userId, cosmeticId): Promise<{ balanceAfter: Cents }>`
  - `equipCosmetic(userId, cosmeticId): Promise<void>`
  - `earnedToday(db, userId): Promise<Cents>`

- [ ] **Step 1: Write the failing integration test**

`tests/minigame-service.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { getMemoryDb, type Database } from '@pcs/db';
import { minigameCosmetics, minigameRuns, transactions, users } from '@pcs/db/schema';
import { DAILY_CAP_CENTS } from '@pcs/minigame-engine';
import {
  MinigameError, buyCosmetic, earnedToday, equipCosmetic, settleRun, startRun,
} from '../apps/web/src/server/minigame-service';

const USER = 'player';

// The service resolves its own connection through getDb(), so the tests point
// that at a throwaway in-memory database the same way the market tests do.
let db: Database;

async function migrate(database: Database) {
  // Mirrors the two tables added in Task 5. Kept explicit rather than derived
  // so a schema change that breaks the service fails loudly here.
  await database.execute(`
    create table users (
      id text primary key, session_token text, display_name text,
      cash integer not null, xp integer not null default 0,
      level integer not null default 1, album_capacity integer not null default 100,
      created_at timestamp not null default now(), last_seen_at timestamp not null default now()
    );
    create table transactions (
      id text primary key, user_id text not null, type text not null,
      amount integer not null, balance_after integer not null,
      item_type text, item_id text, metadata jsonb,
      created_at timestamp not null default now()
    );
    create table minigame_runs (
      id text primary key, user_id text not null, game text not null, seed text not null,
      status text not null default 'open', score integer, duration_ms integer,
      payout integer, reject_reason text,
      started_at timestamp not null default now(), expires_at timestamp not null,
      settled_at timestamp
    );
    create table minigame_cosmetics (
      id text primary key, user_id text not null, cosmetic_id text not null,
      game text not null, equipped boolean not null default false,
      acquired_at timestamp not null default now()
    );
    create unique index minigame_cosmetics_user_item_uq on minigame_cosmetics (user_id, cosmetic_id);
    create unique index minigame_cosmetics_equipped_uq on minigame_cosmetics (user_id, game) where equipped;
  `);
}

beforeEach(async () => {
  db = await getMemoryDb();
  await migrate(db);
  await db.insert(users).values({ id: USER, cash: 100_000 });
  (globalThis as Record<symbol, unknown>)[Symbol.for('pcs.db.connection')] = Promise.resolve(db);
});

/** Move a run's clock back so a realistic amount of time appears to have passed. */
async function ageRun(runId: string, ms: number) {
  await db.update(minigameRuns)
    .set({ startedAt: new Date(Date.now() - ms) })
    .where(eq(minigameRuns.id, runId));
}

describe('startRun', () => {
  it('opens a run with a seed and reproducible content', async () => {
    const run = await startRun(USER, 'type');
    expect(run.runId).toBeTruthy();
    expect(run.seed).toBeTruthy();
    expect(run.content.kind).toBe('type');
  });

  it('equips the free default when the player owns nothing', async () => {
    const run = await startRun(USER, 'flappy');
    expect(run.equipped.id).toBe('flappy-pidgey');
  });
});

describe('settleRun', () => {
  it('pays the player and writes a ledger row', async () => {
    const run = await startRun(USER, 'flappy');
    await ageRun(run.runId, 45_000);

    const result = await settleRun(USER, run.runId, 20, 44_000);

    expect(result.payout).toBeGreaterThan(0);
    expect(result.balanceAfter).toBe(100_000 + result.payout);

    const [row] = await db.select().from(transactions)
      .where(and(eq(transactions.userId, USER), eq(transactions.type, 'minigame_payout')));
    expect(row?.amount).toBe(result.payout);
    expect(row?.balanceAfter).toBe(result.balanceAfter);
  });

  it('refuses a replayed token', async () => {
    const run = await startRun(USER, 'flappy');
    await ageRun(run.runId, 45_000);
    await settleRun(USER, run.runId, 10, 44_000);

    await expect(settleRun(USER, run.runId, 10, 44_000)).rejects.toThrow(MinigameError);
  });

  it('refuses an expired run', async () => {
    const run = await startRun(USER, 'flappy');
    await db.update(minigameRuns)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(minigameRuns.id, run.runId));

    await expect(settleRun(USER, run.runId, 10, 44_000)).rejects.toThrow(/expired/i);
  });

  it('refuses another player\'s run', async () => {
    await db.insert(users).values({ id: 'intruder', cash: 0 });
    const run = await startRun(USER, 'flappy');
    await expect(settleRun('intruder', run.runId, 10, 44_000)).rejects.toThrow(MinigameError);
  });

  it('records why an impossible claim was refused', async () => {
    const run = await startRun(USER, 'flappy');
    await ageRun(run.runId, 5_000);

    await expect(settleRun(USER, run.runId, 900, 5_000)).rejects.toThrow(MinigameError);

    const [row] = await db.select().from(minigameRuns).where(eq(minigameRuns.id, run.runId));
    expect(row?.status).toBe('rejected');
    expect(row?.rejectReason).toBe('flappy_score_exceeds_spawn_rate');
  });

  it('clamps a big win to what is left of the daily cap', async () => {
    await db.insert(transactions).values({
      id: 'seed-earning', userId: USER, type: 'minigame_payout',
      amount: DAILY_CAP_CENTS - 100, balanceAfter: 100_000,
    });

    const run = await startRun(USER, 'flappy');
    await ageRun(run.runId, 120_000);
    const result = await settleRun(USER, run.runId, 100, 119_000);

    expect(result.payout).toBe(100);
    expect(result.capped).toBe(true);
    expect(result.capRemaining).toBe(0);
  });

  it('still records the run when the cap pays nothing', async () => {
    await db.insert(transactions).values({
      id: 'capped', userId: USER, type: 'minigame_payout',
      amount: DAILY_CAP_CENTS, balanceAfter: 100_000,
    });

    const run = await startRun(USER, 'flappy');
    await ageRun(run.runId, 45_000);
    const result = await settleRun(USER, run.runId, 20, 44_000);

    expect(result.payout).toBe(0);
    const [row] = await db.select().from(minigameRuns).where(eq(minigameRuns.id, run.runId));
    expect(row?.status).toBe('settled');
    expect(row?.score).toBe(20);
  });
});

describe('earnedToday', () => {
  it('counts only minigame payouts', async () => {
    await db.insert(transactions).values([
      { id: 't1', userId: USER, type: 'minigame_payout', amount: 500, balanceAfter: 0 },
      { id: 't2', userId: USER, type: 'card_sale', amount: 9_000, balanceAfter: 0 },
    ]);
    expect(await earnedToday(db, USER)).toBe(500);
  });
});

describe('buyCosmetic', () => {
  it('charges the catalogue price and grants ownership', async () => {
    const { balanceAfter } = await buyCosmetic(USER, 'flappy-zubat');
    expect(balanceAfter).toBe(100_000 - 2_500);

    const [owned] = await db.select().from(minigameCosmetics)
      .where(eq(minigameCosmetics.cosmeticId, 'flappy-zubat'));
    expect(owned?.userId).toBe(USER);
  });

  it('refuses to sell the same cosmetic twice', async () => {
    await buyCosmetic(USER, 'flappy-zubat');
    await expect(buyCosmetic(USER, 'flappy-zubat')).rejects.toThrow(/already own/i);
  });

  it('refuses an unknown cosmetic id', async () => {
    await expect(buyCosmetic(USER, 'flappy-missingno')).rejects.toThrow(MinigameError);
  });

  it('refuses when the player cannot afford it', async () => {
    await db.update(users).set({ cash: 100 }).where(eq(users.id, USER));
    await expect(buyCosmetic(USER, 'flappy-rayquaza')).rejects.toThrow(/afford/i);
  });
});

describe('equipCosmetic', () => {
  it('leaves exactly one item equipped for the game', async () => {
    await buyCosmetic(USER, 'flappy-zubat');
    await buyCosmetic(USER, 'flappy-pikachu');
    await equipCosmetic(USER, 'flappy-zubat');
    await equipCosmetic(USER, 'flappy-pikachu');

    const equipped = await db.select().from(minigameCosmetics)
      .where(and(eq(minigameCosmetics.userId, USER), eq(minigameCosmetics.equipped, true)));
    expect(equipped).toHaveLength(1);
    expect(equipped[0]?.cosmeticId).toBe('flappy-pikachu');
  });

  it('refuses to equip something the player does not own', async () => {
    await expect(equipCosmetic(USER, 'flappy-charizard')).rejects.toThrow(/own/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/minigame-service.test.ts`
Expected: FAIL — cannot resolve `minigame-service`.

- [ ] **Step 3: Implement the service**

`apps/web/src/server/minigame-service.ts`. Structure it as:

```ts
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { randomBytes, randomUUID } from 'node:crypto';
import { getDb } from '@pcs/db';
import { minigameCosmetics, minigameRuns, transactions } from '@pcs/db/schema';
import { applyTransactionInTx } from '@pcs/economy-engine';
import { cents, type Cents } from '@pcs/shared';
import {
  DAILY_CAP_CENTS, buildContent, clampToDailyCap, cosmeticById, cosmeticsForGame,
  defaultCosmeticFor, payoutFor, verifyClaim,
  type Cosmetic, type MinigameContent, type MinigameId,
} from '@pcs/minigame-engine';
```

Key implementation notes, in order:

1. `class MinigameError extends Error` carrying a `code` string, mirroring `MissionError` in `progression-service.ts`.
2. `RUN_TTL_MS = 15 * 60 * 1000`.
3. `earnedToday(db, userId)`: `sum(amount)` over `transactions` where `type = 'minigame_payout'` and `createdAt >= ` UTC midnight. Computed, never counted — a counter drifts when a request fails halfway and nothing can repair it afterwards (the reasoning `progression-service` already uses).
4. `startRun`: expire the user's stale open runs for that game (`status = 'expired'`), then insert a new row with `seed = randomBytes(12).toString('hex')` and `expiresAt = now + RUN_TTL_MS`. Return `runId`, `seed`, `buildContent(game, seed)`, the equipped cosmetic, `capRemaining`, and the player's best score for that game.
5. `settleRun`: inside `db.transaction`, `SELECT ... FOR UPDATE` the run. Throw `MinigameError` for a missing run, a wrong `userId`, a non-`open` status, or `expiresAt < now`. Compute `serverElapsedMs = Date.now() - startedAt`. Call `verifyClaim`; on `ok: false`, write `status = 'rejected'` with the reason and throw. Otherwise `payout = clampToDailyCap(payoutFor(game, score), earned)`, call `applyTransactionInTx` when `payout > 0` with `type: 'minigame_payout'`, `itemType: 'minigame'`, `itemId: game`, and metadata `{ runId, score }`, then mark the run settled.
6. `buyCosmetic`: resolve the price with `cosmeticById` (throw on unknown), reject if already owned, then inside one `db.transaction` call `applyTransactionInTx` with a negative amount and insert the ownership row. Catch `InsufficientFundsError` and rethrow as a `MinigameError` reading "You cannot afford that yet."
7. `equipCosmetic`: inside one transaction, verify ownership, clear `equipped` for that user and game, then set it on the chosen row — in that order, so the partial unique index is never transiently violated.
8. `getArcade`: per game, the best settled score, today's earnings, `capRemaining`, and the owned/equipped cosmetics merged over the full catalogue so the shop can render owned state in one query.

Owned-cosmetic resolution rule, used by both `startRun` and `getArcade`: if the player has an equipped row for the game, use it; otherwise fall back to `defaultCosmeticFor(game)`. The free default is never inserted as a row — it is what "no row" means, so a new player needs no seeding.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/minigame-service.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 5: Run the whole suite and typecheck**

Run: `npm run test && npm run typecheck`
Expected: clean, with no regression in the existing suites.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/server/minigame-service.ts tests/minigame-service.test.ts
git commit -m "Settle arcade runs against the server's own clock"
```

---

### Task 7: API routes

**Files:**
- Create: `apps/web/src/app/api/minigames/route.ts` (GET the arcade view)
- Create: `apps/web/src/app/api/minigames/start/route.ts`
- Create: `apps/web/src/app/api/minigames/settle/route.ts`
- Create: `apps/web/src/app/api/minigames/shop/buy/route.ts`
- Create: `apps/web/src/app/api/minigames/shop/equip/route.ts`

**Interfaces:**
- Consumes: `requirePlayer` from `@/server/session`; the Task 6 service functions.
- Produces: the five endpoints the client components call.

- [ ] **Step 1: Write the routes**

Every route follows the established shape from `api/progression/claim/route.ts`: `export const dynamic = 'force-dynamic'`, `requirePlayer()` returning 401 on no session, a `try`/`catch` around `request.json()` returning 400 on a malformed body, explicit type checks on every field, `MinigameError` mapped to 400 with its `code`, and anything else logged and returned as a 500 with a neutral message.

`start` validates `isMinigameId(game)`. `settle` validates that `runId` is a string and that `score` and `durationMs` are finite numbers — and passes them through untouched, because the service is what decides whether they are plausible. `buy` and `equip` validate that `cosmeticId` is a string; the price is never read from the request.

- [ ] **Step 2: Verify the routes compile and typecheck**

Run: `npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/api/minigames
git commit -m "Expose the arcade over five endpoints that trust nothing"
```

---

### Task 8: The sprite importer

**Files:**
- Create: `scripts/import/fetch-sprites.ts`
- Modify: `package.json` (add `data:sprites`)
- Create (generated): `apps/web/public/sprites/pokemon/*.gif`

**Interfaces:**
- Consumes: `FLAPPY_SPRITES` from `@pcs/minigame-engine`.
- Produces: `apps/web/public/sprites/pokemon/<dex>.gif` for each id in `FLAPPY_SPRITES`.

- [ ] **Step 1: Write the importer**

`scripts/import/fetch-sprites.ts` downloads
`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/versions/generation-v/black-white/animated/<dex>.gif`
for every id in `FLAPPY_SPRITES`, into `apps/web/public/sprites/pokemon/`.

It must: create the directory if absent; skip a file that already exists (idempotent, like every other importer); fail loudly with the dex id and status code on a non-200; and print a one-line summary of downloaded versus skipped.

Head the file with a comment explaining the two decisions worth knowing: the sprites are Gen-V **animated** GIFs because the flappy game renders in the DOM specifically so they animate, and unlike the `data:*` importers this one touches no database and so carries none of the PGlite single-process hazard.

Add to `package.json` scripts:

```json
"data:sprites": "tsx scripts/import/fetch-sprites.ts"
```

- [ ] **Step 2: Run it**

Run: `npm run data:sprites`
Expected: 6 files downloaded into `apps/web/public/sprites/pokemon/`.

- [ ] **Step 3: Verify idempotency**

Run: `npm run data:sprites`
Expected: 6 skipped, 0 downloaded.

- [ ] **Step 4: Commit**

```bash
git add scripts/import/fetch-sprites.ts package.json apps/web/public/sprites
git commit -m "Fetch the flappy roster's pixel art into the repo"
```

---

### Task 9: The arcade hub and the shop

**Files:**
- Create: `apps/web/src/app/games/page.tsx`
- Create: `apps/web/src/app/games/shop/page.tsx`
- Create: `apps/web/src/components/games/ArcadeCabinet.tsx`
- Create: `apps/web/src/components/games/CosmeticCard.tsx`
- Create: `apps/web/src/components/games/useMinigameRun.ts`
- Modify: `apps/web/src/components/AppHeader.tsx` (one nav entry)
- Modify: `apps/web/src/app/globals.css` (arcade styles, appended in their own section)

**Interfaces:**
- Consumes: the Task 7 endpoints.
- Produces: `useMinigameRun(game)` — the hook every game uses, returning
  `{ status, run, start(), settle(score, durationMs), result, error }`, where
  `run` carries `{ runId, seed, content, equipped }` and `result` carries
  `{ payout, balanceAfter, capRemaining, best, capped }`.

**Design direction:** read the `frontend-design` skill before writing any JSX. The arcade must read as part of the vitrine aesthetic — the existing ink/manila/brass palette, `pane` surfaces, `t-display` and `t-num` type — not as a bolted-on toy. The one licence worth taking is a pixel register that exists nowhere else in the app: `image-rendering: pixelated` on the sprites, and a CRT-adjacent treatment on the cabinets that stays inside the established colours.

- [ ] **Step 1: Build `useMinigameRun`**

A client hook wrapping `POST /api/minigames/start` and `POST /api/minigames/settle`. It owns the run lifecycle so no game component has to: `idle -> starting -> playing -> settling -> done`. On settle it calls `setCash` from `usePlayer()` with the returned `balanceAfter` so the header updates without a refetch, exactly as the missions page does after a claim.

- [ ] **Step 2: Build the hub page**

`/games` fetches `GET /api/minigames` and renders three `ArcadeCabinet` cards plus a shop link. Each cabinet shows the game's name, a one-line description, the player's best score, and today's earnings. A single shared meter shows the daily allowance across all three. When the cap is spent, say so plainly on each cabinet — playable, but paying nothing.

- [ ] **Step 3: Build the shop page**

`/games/shop` groups cosmetics by game, showing price, owned state, and equipped state. Buying calls `POST /api/minigames/shop/buy` and equipping calls `.../equip`; both refresh the arcade view and push `balanceAfter` into the header. An item the player cannot afford is visibly disabled with the shortfall named, not silently inert.

- [ ] **Step 4: Add the nav entry**

In `AppHeader.tsx`, add `{ href: "/games", label: "Arcade", icon: Gamepad2 }` to `NAV` and import `Gamepad2` from `lucide-react`. Place it after Missions. Change nothing else in that file.

- [ ] **Step 5: Verify in the browser**

Start the dev server through the preview tooling, open `/games` and `/games/shop`, and confirm: both pages render, the cabinets show real numbers, the nav entry highlights, the console is clean, and the layout holds at a mobile width.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/games apps/web/src/components/games apps/web/src/components/AppHeader.tsx apps/web/src/app/globals.css
git commit -m "Build the arcade hub and its cosmetics shop"
```

---

### Task 10: Card Match

**Files:**
- Create: `apps/web/src/app/games/match/page.tsx`
- Create: `apps/web/src/components/games/MatchGame.tsx`
- Modify: `apps/web/src/app/api/minigames/start/route.ts` (return card art for a match run)

**Interfaces:**
- Consumes: `useMinigameRun('match')`; `MatchContent.layout` from the run.
- Produces: a run settled with `score` in `0..1000`.

**Scoring, which must match the ceiling in Task 3:**

```
score = max(0, 1000 - (moves - 12) * 25 - floor(elapsedSeconds) * 5)
```

Twelve moves is a perfect board. Moves are weighted more heavily than seconds so careful play beats frantic play.

- [ ] **Step 1: Serve the card art**

For a `match` run, the start route additionally selects 12 random cards with a non-null `imageSmall` from the `cards` table and returns them as `cardIds` alongside `{ id, name, imageSmall }`. The layout that arranges them comes from the seed; which cards they are does not need to be verifiable, because the match ceiling depends only on moves and time.

- [ ] **Step 2: Build the board**

A 6×4 grid. Backs use `/card-back.jpg` tinted by the equipped cosmetic's palette. Flipping uses a CSS 3D rotation consistent with the existing `CardFace` treatment. Two flipped non-matching cards return face down after ~700ms, during which further input is ignored. A matched pair stays face up and dims slightly.

Track `moves` (a move is a completed pair of flips) and elapsed time from the first flip. On the last match, compute the score, call `settle`, and show the payout.

- [ ] **Step 3: Verify in the browser**

Play a full board. Confirm the payout arrives, the header cash increases by exactly that amount, and `/finances` shows the new transaction.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/games/match apps/web/src/components/games/MatchGame.tsx apps/web/src/app/api/minigames/start/route.ts
git commit -m "Add Card Match to the arcade"
```

---

### Task 11: Flappy Pokémon

**Files:**
- Create: `apps/web/src/app/games/flappy/page.tsx`
- Create: `apps/web/src/components/games/FlappyGame.tsx`

**Interfaces:**
- Consumes: `useMinigameRun('flappy')`; `FlappyContent.gaps`; the equipped cosmetic's `sprite` dex id, rendered from `/sprites/pokemon/<dex>.gif`.
- Produces: a run settled with `score` = obstacles cleared.

**Physics, which must stay inside the Task 3 ceiling of one obstacle per 700ms:**

```
gravity        0.55 px/frame²      flap impulse   -8.4 px/frame
spawn interval 1500ms              scroll speed   2.6 px/frame
gap height     190px, narrowing to 140px by score 30
```

At the fastest, obstacles arrive every 1500ms — comfortably above the 700ms floor, so honest play is never refused.

- [ ] **Step 1: Build the loop**

A `requestAnimationFrame` loop over DOM elements, **not** a canvas: the sprites are animated GIFs and `drawImage` would paint only their first frame. Positions are applied as `transform: translate3d(...)`, and every frame reads a delta so the game runs at the same speed on a 120Hz display.

Obstacles are stacked booster boxes rather than green pipes. Gap centres come from `content.gaps[i]` as a fraction of playfield height, so the level is the seed's.

Input: click, tap, and Space. Space must `preventDefault` so the page does not scroll. Pause on `visibilitychange` — a backgrounded tab throttles rAF, and an unpaused game would register as a death the player never saw.

Respect `prefers-reduced-motion` by removing the parallax background only; the game itself still moves, because it must.

- [ ] **Step 2: Verify in the browser**

Play a run. Confirm the sprite animates (it is a GIF in the DOM), the score increments once per obstacle, death settles the run, and the payout matches `15 * score + floor(score² / 20)`.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/games/flappy apps/web/src/components/games/FlappyGame.tsx
git commit -m "Add Flappy Pokemon to the arcade"
```

---

### Task 12: Speed Type

**Files:**
- Create: `apps/web/src/app/games/type/page.tsx`
- Create: `apps/web/src/components/games/TypeGame.tsx`

**Interfaces:**
- Consumes: `useMinigameRun('type')`; `TypeContent.passage`.
- Produces: a run settled with `score` = correct characters typed.

- [ ] **Step 1: Build the test**

Render the passage with each character in one of four states: untyped, correct, incorrect, current. A hidden input captures keystrokes so mobile keyboards work; the visible passage is the interface.

The timer starts on the first keystroke, not on page load — otherwise reading time counts against the player's WPM and the score understates their speed. Live WPM and accuracy display as they type. The run ends when the passage is complete or the player presses Escape.

`score` is the count of correct characters. Because the server rebuilt the same passage from the seed, a score above its length is refused by arithmetic.

The equipped cosmetic themes the surface: manila pad, brass terminal, or foil holo.

- [ ] **Step 2: Verify in the browser**

Complete a passage. Confirm the payout is `4 * correctChars` cents, and that deliberately mistyping lowers the score.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/games/type apps/web/src/components/games/TypeGame.tsx
git commit -m "Add Speed Type to the arcade"
```

---

### Task 13: End-to-end verification

**Files:**
- Modify: `docs/DESIGN.md` (a short section recording the arcade and its cap)
- Modify: `CLAUDE.md` (one line under the non-negotiables noting the documented exception)

- [ ] **Step 1: Full suite**

Run: `npm run test && npm run typecheck && npm run lint`
Expected: all clean. Paste the real output; do not summarise it.

- [ ] **Step 2: Play all three games in the browser**

For each: start, play, settle, and confirm the cash delta in the header matches the payout and that `/finances` lists the transaction with the right `balanceAfter`.

- [ ] **Step 3: Confirm the cap holds**

Insert `minigame_payout` transactions summing to just under the cap, then settle a winning run and confirm it pays only the remainder and reports `capped: true`.

- [ ] **Step 4: Document the rule-2 exception**

CLAUDE.md rule 2 says the client never reports what it got. The arcade is the one place that is not literally true, and leaving that undocumented would make the next reader think it is a bug rather than a decision. Add one line under the non-negotiables pointing at the spec, and a short DESIGN.md section covering the cap, the run-token model, and the fact that cosmetics never affect payouts.

- [ ] **Step 5: Commit**

```bash
git add docs/DESIGN.md CLAUDE.md
git commit -m "Record the arcade's documented exception to client-authority"
```
