# Minigames Arcade Design

**Date:** 2026-09-03
**Status:** Approved product direction; implementation contract

## Purpose

Give the player a way to earn money with their hands instead of their wallet.
Three short skill games sit behind a single arcade page, pay real cash into the
existing ledger, and feed a cosmetics shop that only changes how the games look.

The arcade is a side income and a spending sink. It is not a second economy: it
pays into the same wallet that buys packs, it is capped, and everything it sells
is decorative. A player who never opens it loses nothing but flavour.

## Product principles

1. **The arcade must not out-earn the card game.** A capped, modest income keeps
   the strategic question in DESIGN.md §30 — open, sell, grade, hold — intact.
   If grinding Flappy were the cheapest route to a booster box, every other loop
   would become decoration.
2. **The server owns every number that becomes money.** Payout curves, prices,
   ceilings, and the cap live in a package the client cannot reach.
3. **A score claim is checked against content the server can reproduce.** The
   seed is the shared secret of correctness, not a signature.
4. **Cosmetics are cosmetic.** Nothing in the shop changes a payout, a hitbox,
   or a difficulty curve. Buying Rayquaza does not make you richer.
5. **Money is integer cents, and every movement writes a transaction row** with
   `balanceAfter`, like every other economic action in the game.
6. **A rejected claim is recorded, not just refused.** The audit trail is how
   anyone would ever notice the scheme being probed.

## The honest problem: rule 2 versus skill games

CLAUDE.md's second non-negotiable says the server decides every economic outcome
and the client never reports what it got. A skill game cannot fully honour that.
Only the browser knows whether the player cleared the pipe.

This design does not pretend otherwise. It **bounds** the exploit instead of
claiming to eliminate it, along four axes:

- **Single-use tokens.** A run is a database row. Settling it is a state
  transition under a row lock, so a captured request cannot be replayed.
- **An independent clock.** The server records `startedAt` itself and measures
  elapsed time against its own clock, never the client's `durationMs`.
- **Reproducible content.** The server generated the passage, the grid, and the
  pipe sequence from the seed, so it knows what was achievable.
- **A ceiling on the prize.** Even a perfect forgery is worth at most the
  remaining daily cap.

The residual risk is a patient cheater earning up to the cap they could have
earned by playing. That is an acceptable trade for a cosmetic side loop, and it
is stated here so nobody later mistakes this for full server authority.

Full server-side replay of an input trace was considered and rejected: it would
require every game's physics to live in a DOM-free shared simulation, roughly
doubling the work, to protect a capped decorative currency.

## Player experience

### The arcade hub — `/games`

Three cabinets, one per game, each showing the player's best score, what they
have earned today, and how much of the daily allowance remains. A fourth panel
links to the shop. When the cap is spent, cabinets stay playable but say plainly
that further runs pay nothing — a score is still a score.

### Card Match

A 6×4 grid of twelve pairs, face down. The faces are real card art drawn from
the catalogue; the backs are the existing `card-back.jpg`. Flip two, keep them
if they match. Scored on move efficiency first and time second, so careful play
beats frantic play.

The twelve cards are chosen server-side from the run seed and returned with the
run, so the client cannot request an easier deal or reshuffle after peeking.

### Flappy Pokémon

The player's chosen Pokémon flies right through gaps in stacked booster boxes.
One input: flap. Gravity, a fixed spawn interval, and a gap that narrows as the
score climbs.

Rendered in the DOM with a `requestAnimationFrame` loop rather than on a canvas.
This is deliberate: the Gen-V sprites are **animated GIFs**, and a canvas
`drawImage` of a GIF paints only its first frame. The DOM keeps the pixel art
alive, and the scene is a handful of transformed elements — well within budget.

Starts as Pidgey. The rest of the roster comes from the shop.

### Speed Type

A passage assembled from real card names, set names, and eras, so the text reads
as in-world rather than as lorem ipsum. Scored on correct characters, with WPM
and accuracy shown live.

This game is the one that can be checked exactly: the server built the passage
from the seed, so a claim of more correct characters than the passage contains
is refuted by arithmetic.

### The shop — `/games/shop`

Grouped by game. Each item shows its price, whether it is owned, and whether it
is equipped. Defaults are free and owned from the start, so no game is ever
unplayable. Equipping is immediate and swaps atomically.

| Game | Item | Price |
| --- | --- | ---: |
| Flappy | Pidgey | free |
| Flappy | Zubat | $25 |
| Flappy | Pikachu | $60 |
| Flappy | Gyarados | $120 |
| Flappy | Charizard | $250 |
| Flappy | Rayquaza | $500 |
| Match | Classic back | free |
| Match | Holo foil back | $40 |
| Match | Gold-etched back | $150 |
| Match | Glitch back | $300 |
| Type | Manila pad | free |
| Type | Brass terminal | $45 |
| Type | Foil holo | $180 |

Prices are resolved server-side from the catalogue. The client sends an id.

## Technical design

### Package boundaries

A new pure package, **`@pcs/minigame-engine`**, modelled on `pack-engine`: no
React, no DOM, no database, no I/O, deterministic given a seed. It owns

- **payout curves** — score to cents, per game;
- **plausibility ceilings** — the most a claim may assert for a given elapsed
  time;
- **the cosmetics catalogue** — ids, prices, defaults, and per-item render data;
- **seeded content generators** — the memory deal, the pipe sequence, the typing
  passage.

Both the server and the browser run the same generators from the same seed. That
shared determinism is what makes a claim checkable, so it is tested directly.

`apps/web/src/server/minigame-service.ts` is the only module that touches the
database and the ledger. The games are client components under
`apps/web/src/app/games/`.

### Schema

```
minigame_runs
  id            text pk          -- the run token; opaque, single-use
  user_id       text -> users
  game          text             -- 'match' | 'flappy' | 'type'
  seed          text
  status        text             -- 'open' | 'settled' | 'expired' | 'rejected'
  score         integer
  duration_ms   integer
  payout        integer          -- cents, after the cap clamp
  reject_reason text
  started_at    timestamp        -- the SERVER's clock, never the client's
  expires_at    timestamp
  settled_at    timestamp

minigame_cosmetics
  id            text pk
  user_id       text -> users
  cosmetic_id   text
  game          text
  equipped      boolean
  acquired_at   timestamp
```

Two indexes carry real weight:

- `unique (user_id, cosmetic_id)` — a double-clicked buy button cannot charge
  twice, and the guarantee lives in the database rather than in a check that
  happened a moment earlier.
- `unique (user_id, game) where equipped` — "exactly one skin equipped per game"
  becomes an invariant the database enforces, so a failed half-swap cannot leave
  the player with two or none.

Ledger gains two transaction types: `minigame_payout` and `cosmetic_purchase`.

### The run lifecycle

```
POST /api/minigames/start   { game }
  -> requirePlayer, expire any stale open runs for this user+game
  -> insert run { status:'open', seed, startedAt: now, expiresAt: now + 15m }
  -> 200 { runId, seed, content, equipped, capRemaining }

POST /api/minigames/settle  { runId, score, durationMs }
  -> db.transaction:
       SELECT run FOR UPDATE
       reject unless status='open' AND now < expiresAt AND userId matches
       serverElapsed = now - startedAt
       reject if score > ceiling(game, serverElapsed)
       reject if durationMs > serverElapsed + slack     (claimed longer than possible)
       payout = min(curve(game, score), capRemaining(userId))
       applyTransactionInTx('minigame_payout')  when payout > 0
       mark run settled with score, payout
  -> 200 { payout, balanceAfter, capRemaining, best }
```

A rejection writes `status='rejected'` with a reason and returns 400. The run is
spent either way; there is no retry that keeps the token alive.

### The daily cap

**$150.00 (15 000 cents) per UTC day, across all three games.**

It is *computed*, never counted: the sum of `minigame_payout` transactions since
UTC midnight. Progression already establishes this reasoning — a counter can
drift when a request fails halfway and nothing can repair it afterwards, while a
query derived from the same rows the rest of the game reads cannot.

A payout is clamped to what remains, so a great run when nearly capped pays the
remainder rather than failing.

### Plausibility ceilings

| Game | Ceiling |
| --- | --- |
| Flappy | `elapsedMs / MIN_MS_PER_GAP` — pipes cannot be cleared faster than they spawn |
| Match | 12 pairs need ≥ 12 matched turns, and no human resolves a turn faster than ~400 ms |
| Type | correct characters ≤ the length of the passage the seed produced, and ≤ 250 WPM |

Every ceiling is generous against real play and decisive against fabrication.
They exist to refuse the impossible, not to police the merely excellent.

### Sprites

`scripts/import/fetch-sprites.ts` downloads the listed Gen-V animated sprites
from the PokeAPI sprite repository into `apps/web/public/sprites/pokemon/`,
skipping files it already has. Wired up as `npm run data:sprites`.

The files are **committed, not hotlinked**. Card art is hotlinked because the
catalogue is tens of thousands of images that change; this is six small GIFs
that never change. Committing them keeps a new host out of `next.config`
`remotePatterns` and keeps the arcade working without a network round trip.

Unlike the `data:*` importers, this one touches no database, so it does not
carry the PGlite single-process hazard and is safe to run with the dev server up.

## Testing

**Unit — `packages/minigame-engine/src/*.test.ts`**

- payouts are monotonic in score, never negative, and clamp at the cap;
- each ceiling rejects a known-impossible claim and accepts realistic play,
  including a deliberately excellent run that must not be refused;
- catalogue integrity: unique ids, exactly one free default per game, all prices
  positive integers;
- **seed determinism** — the same seed produces an identical deal, pipe
  sequence, and passage on repeated calls. The entire verification scheme rests
  on the server reproducing what the client played, so this is the load-bearing
  test.

**Integration — `tests/minigame-service.test.ts`, on the existing `getMemoryDb`**

- start → settle → cash arrives, ledger row written with the right
  `balanceAfter`;
- a replayed token is rejected;
- an expired run is rejected;
- a claim above the ceiling is rejected and recorded with its reason;
- a large win clamps to the remaining daily cap, and a fully capped player earns
  zero while still recording the run;
- a cosmetic cannot be bought twice, nor bought without the cash;
- equipping swaps atomically, leaving exactly one equipped per game.

## Out of scope

Leaderboards, multiplayer, streaks and daily bonuses, achievements, sound, and
any cosmetic that alters gameplay. Trainer titles were considered and cut.
