# PokeCard Simulator

A Pokémon TCG collector's life simulator: buy packs with virtual money, open them
with a reveal sequence worth watching, build a collection, work set checklists,
trade singles, grade your hits, and hold sealed product — without spending a cent
of real money.

Pack opening is the hook. The collection is what keeps you. The economy is what
makes the decisions mean something.

> Full product and game design: [`docs/DESIGN.md`](docs/DESIGN.md).
> Engineering rules: [`CLAUDE.md`](CLAUDE.md).

## Quick start

```bash
npm install
npm run db:push
npm run data:all
npm run dev
```

No Docker and no Postgres install required. Development runs on **PGlite** —
real Postgres compiled to WebAssembly, persisted to `data/pgdata`. Setting
`DATABASE_URL` switches to Neon with no code change, because the SQL dialect is
identical.

## Layout

```
apps/web              Next.js 16 app (App Router) + server-authoritative API
packages/shared       Domain types. Money, rarity, confidence. No I/O.
packages/db           Drizzle schema + the PGlite/Neon driver.
packages/card-data    Catalogue queries. Knows nothing about players.
packages/pack-engine  Pure, deterministic pack simulation. No React, no DB.
packages/economy-engine  Pricing, grading, market, ledger, progression.
scripts/import        Catalogue and price importers.
scripts/simulate      Statistical pack-simulation harness.
scripts/validate      Data-quality report.
```

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the web app |
| `npm run db:push` | Apply migrations |
| `npm run db:reset` | Delete the local PGlite database |
| `npm run data:all` | Import sets, cards, then prices |
| `npm run data:validate` | Data-quality report (DESIGN.md §34) |
| `npm run simulate` | Run 100k simulated pack openings and check distributions |
| `npm test` | Unit + statistical tests |

## Data and attribution

Card data and images come from the [Pokémon TCG API](https://pokemontcg.io) and
the [`PokemonTCG/pokemon-tcg-data`](https://github.com/PokemonTCG/pokemon-tcg-data)
dataset; prices are TCGplayer and Cardmarket figures surfaced by that API.

This is a non-commercial fan project. Pokémon and all card content are ©
Nintendo / Creatures Inc. / GAME FREAK inc. / The Pokémon Company. No real
currency is involved anywhere in this application and nothing here is a
prediction of, or advice about, real card values.
