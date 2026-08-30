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

Dev uses PGlite (Postgres in WebAssembly, persisted to `data/pgdata`). No Docker
needed. Setting `DATABASE_URL` switches to Neon with no code change, because the
dialect is identical.

```bash
npm run db:push      # create tables
npm run data:all     # import catalogue + prices
npm run dev
```

## Data sources

- Catalogue: `PokemonTCG/pokemon-tcg-data` bulk JSON on GitHub (no rate limit).
- Prices: `api.pokemontcg.io/v2` (TCGplayer + Cardmarket), no key required.
- Images: hotlinked from `images.pokemontcg.io` through the `CardImageAsset`
  indirection, so they can be moved to our own storage without touching
  gameplay code.

## Testing

Probability code is tested statistically, not by example. A pack template change
must keep `npm run simulate` inside its declared tolerance.
