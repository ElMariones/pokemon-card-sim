# Roadmap

Maps the milestones in [`DESIGN.md`](DESIGN.md) §25 to actual status.

Legend: ✅ done · 🚧 in progress · ⬜ not started

## Milestone 0 — Technical spike
- ✅ Confirm data/image sources are reachable and usable
- ✅ Normalized schema defined (`packages/db/src/schema.ts`)
- ✅ Zero-install Postgres for development (PGlite), production-identical dialect
- 🚧 One pack simulated end to end
- 🚧 Pack opening animation prototype

## Milestone 1 — Vertical slice
- ✅ Anonymous session + starting cash ($500, DESIGN.md §7)
- 🚧 Pack purchase → open → collection → sell loop
- ⬜ Persistent inventory verified end to end

## Milestone 2 — Card database pipeline
- 🚧 Import sets, cards, rarities, images, prices with source tracking
- 🚧 Data-quality report (§34)
- ⬜ Admin import tooling

## Milestone 3 — Multi-set pack engine
- 🚧 Data-driven templates, slot rules, pull tables with confidence levels
- 🚧 100k-opening statistical test harness (§29)

## Milestone 4 — Collection experience
- 🚧 Binder UI, set pages, filters, search, completion tracking
- ⬜ Favorites, duplicate handling, collection statistics

## Milestone 5 — Economy v1
- 🚧 Dynamic pricing, NPC dealer buylist, transaction ledger
- ⬜ Price history charts, profit/loss tracking

## Milestone 6 — Grading
- 🚧 Submission, fees, turnaround timers, grade generation, graded value
- ⬜ Graded-card selling flow

## Milestone 7 — Sealed market
- ⬜ Sealed inventory, boxes/ETBs/tins, sealed price movement, open-vs-hold

## Milestone 8 — Progression
- 🚧 XP, 10 collector levels, missions, unlocks
- ⬜ Achievements, cosmetics

## Milestone 9 — Full catalogue
- 🚧 Full historical import (~170 sets)
- ⬜ Per-set authored pack templates replacing era-derived estimates

## Milestone 10 — Advanced market / shop sim
- ⬜ Listings, auctions, NPC customers, shop management

## Milestone 11 — Polish / launch
- ⬜ Mobile, performance, sound design, monitoring, economy balance pass

---

## Known deviation from the design document

DESIGN.md §28 advises *"do not start by importing 20,000+ cards"* and §26 sets the
MVP at 1–3 sets. The full catalogue was imported first by explicit decision.

The consequence, and how it is handled: **nobody has published pull rates for
~170 historical sets.** Rather than invent them, pack templates come in two
kinds, and the difference is visible to the player:

| Kind | How it's made | `confidence` |
| --- | --- | --- |
| Authored | Hand-written from a cited source, per flagship set | `documented_community_data` or better |
| Derived | Generated from the set's era and its real rarity composition | `estimated` |

Per §5, only `official` / `manufacturer_published` rates may be displayed as an
exact percentage. Everything else is labelled as an estimate. Replacing derived
templates with authored ones, set by set, is ongoing data work — Milestone 9.
