# PokeCard Simulator — working agreement

A Pokémon TCG collector's life simulator. `docs/DESIGN.md` is the product spec;
this file is the set of rules that keep the code honest.

## Non-negotiables

1. **Money is integer cents.** Use `Cents` from `@pcs/shared`. No floats, ever.
2. **The server decides every economic outcome.** Pack contents, prices, grades,
   balances. The client asks "open pack 123"; it never reports what it got.
   (DESIGN.md §22.)
3. **Never fake precision.** Every pull rate and price carries a `Confidence`.
   Only `official` / `manufacturer_published` may be shown as an exact
   percentage; everything else says "estimated". (DESIGN.md §5.)
4. **Gameplay never branches on a raw rarity string.** Source data has 38 of
   them and they changed meaning across eras. Normalize to `RarityTier` via
   `normalizeRarity`; keep `rarityRaw` for display only.
5. **Every money movement writes a `transactions` row** with `balanceAfter`.
   The ledger is the audit trail.

## Package boundaries (DESIGN.md §35)

These are enforced by review, and they matter:

- `@pcs/pack-engine` — knows nothing about React, the database, or money.
  Pure functions over templates and tables. Fully deterministic given a seed.
- `@pcs/economy-engine` — knows nothing about image URLs or React.
- `@pcs/card-data` — knows nothing about user accounts.
- `@pcs/db` — owns the schema and the driver. No game rules.
- `@pcs/shared` — types only, no I/O.

## Database

Supabase project `ckrybfpctqqrijrvmnhb` is the canonical database. Agents have
authenticated Supabase tooling for that project and must inspect the live schema
before database work. Every approved schema or data change must be applied to
Supabase and verified there; committing local SQL alone is not completion.

Normal localhost development uses that confirmed Supabase database. Put its
Postgres connection string in the ignored repository-root `.env.local` as
`DATABASE_URL`, then run `npm run dev`. Isolated tests may instead use the
explicit mock command `npm run dev:mock`, which uses PGlite. Never test against
an accidental or unconfirmed third database. See `docs/DATABASE.md`.

```bash
npm run db:push      # create tables
npm run data:all     # import catalogue + prices
npm run dev          # confirmed Supabase only
npm run dev:mock     # explicit local PGlite database
```

### PGlite is single-process. This will bite you.

Only ONE OS process may hold `data/pgdata` at a time. Running an importer while
the dev server is up does not queue or fail cleanly — it corrupts the data
directory, and the next boot dies with a WASM `Aborted()` that names no cause.

Stop the dev server before running any `data:*` script. If it does get
corrupted, the fix is cheap because every importer is idempotent:

```bash
npm run db:reset && npm run db:push && npm run data:all
```

Neon has no such restriction, so this is a development-only hazard.

Related: `getDb()` caches the connection on `globalThis`, not in a module
variable. Importing this package through both `@pcs/db` and a relative path
yields two module instances, and Next.js hot reload makes more — each would
otherwise open its own PGlite connection to the same directory, and writes
through one are invisible to the other. That failure mode looks like a balance
update succeeding and then silently reverting.

## Data sources

- Catalogue: `PokemonTCG/pokemon-tcg-data` bulk JSON on GitHub (no rate limit).
- Prices: `api.pokemontcg.io/v2` (TCGplayer + Cardmarket), no key required.
- Images: hotlinked from `images.pokemontcg.io` through the `CardImageAsset`
  indirection, so they can be moved to our own storage without touching
  gameplay code.

## Testing

Probability code is tested statistically, not by example. A pack template change
must keep `npm run simulate` inside its declared tolerance.
