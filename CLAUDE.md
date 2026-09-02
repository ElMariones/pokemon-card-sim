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
6. **A pack's price is real market data.** `market_base_price` first, the
   contents-derived `simulator_price` only where no market covers the set. A
   set whose contents beat its price is a real market fact, not a bug — but a
   newly appearing one is usually a pull-model bug, which is what
   `data:price-packs --strict` is for.

## Package boundaries (DESIGN.md §35)

These are enforced by review, and they matter:

- `@pcs/pack-engine` — knows nothing about React, the database, or money.
  Pure functions over templates and tables. Fully deterministic given a seed.
- `@pcs/economy-engine` — knows nothing about image URLs or React.
- `@pcs/card-data` — knows nothing about user accounts.
- `@pcs/db` — owns the schema and the driver. No game rules.
- `@pcs/shared` — types only, no I/O.

## Database

Dev uses PGlite (Postgres in WebAssembly, persisted to `data/pgdata`). No Docker
needed. Setting `DATABASE_URL` switches to Neon with no code change, because the
dialect is identical.

```bash
npm run db:push      # create tables
npm run data:all     # import catalogue + prices (singles and sealed)
npm run dev
```

`data:all` runs, in order: sets, cards, prices (tcgcsv then the API fallback),
`data:price-packs` (measures contents, creates templates), and
`data:pack-prices` (writes the real sealed price). The last two are ordered:
pack prices need the templates to exist.

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

### Getting the result to production

The importers only ever write to PGlite. `npm run db:sync-supabase` pushes the
local state to the linked Supabase project through the authenticated CLI —
pending migrations first (made idempotent, since that remote has drifted), then
card prices, pack prices and templates. It is additive and safe to re-run;
`--schema` limits it to DDL and `--dry-run` prints without writing.

Related: `getDb()` caches the connection on `globalThis`, not in a module
variable. Importing this package through both `@pcs/db` and a relative path
yields two module instances, and Next.js hot reload makes more — each would
otherwise open its own PGlite connection to the same directory, and writes
through one are invisible to the other. That failure mode looks like a balance
update succeeding and then silently reverting.

## Data sources

- Catalogue: `PokemonTCG/pokemon-tcg-data` bulk JSON on GitHub (no rate limit).
- Prices: `tcgcsv.com`, TCGplayer's own daily export, cached per group under
  `data/raw/tcgcsv`. `api.pokemontcg.io/v2` is the fallback for cards it misses.
  Both feeds go through `selectBasePrice`, never a second price policy.
- Sealed: the same tcgcsv export carries booster packs, boxes and ETBs. Pack
  price comes from there, not from the pack's simulated contents — see
  `apply-pack-prices.ts` and DESIGN.md §14.
- Images: hotlinked from `images.pokemontcg.io` through the `CardImageAsset`
  indirection, so they can be moved to our own storage without touching
  gameplay code.

## Testing

Probability code is tested statistically, not by example. A pack template change
must keep `npm run simulate` inside its declared tolerance.
