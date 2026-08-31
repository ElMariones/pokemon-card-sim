# Roadmap

Maps the milestones in [`DESIGN.md`](DESIGN.md) §25 to actual status.

Legend: ✅ done · 🚧 in progress · ⬜ not started

## Milestone 0 — Technical spike
- ✅ Confirm data/image sources are reachable and usable
- ✅ Normalized schema defined (`packages/db/src/schema.ts`)
- ✅ Zero-install Postgres for development (PGlite), production-identical dialect
- ✅ One pack simulated end to end (100k-opening harness, deviations under 0.12pp)
- ✅ Pack opening animation

## Milestone 1 — Vertical slice
- ✅ Anonymous session + starting cash ($500, DESIGN.md §7)
- ✅ Pack purchase → open → collection → sell loop
- ✅ Persistent inventory verified end to end
- ✅ Ledger audit: stored balance always equals the sum of transactions
- ✅ Overdrafts refused

## Milestone 2 — Card database pipeline
- ✅ Import sets, cards, rarities, images with source tracking (174 sets, 20,440 cards)
- ✅ Data-quality report (§34), all integrity checks passing
- ✅ Prices: 18,850 of 20,440 cards (92.2%). The remainder have no source
      price at all and stay null rather than being invented.
- ✅ Price pipeline split into fetch (network only) and apply (database only)
- ⬜ Admin import tooling

## Milestone 3 — Multi-set pack engine
- ✅ Data-driven templates, slot rules, pull tables with confidence levels
- ✅ 100k-opening statistical test harness (§29)
- ⬜ Authored templates beyond the two flagship sets

## Milestone 4 — Collection experience
- 🚧 Binder UI, set pages, filters, search, completion tracking
- ⬜ Favorites, duplicate handling, collection statistics

## Milestone 5 — Economy v1
- ✅ Dynamic pricing, NPC dealer buylist, transaction ledger
- ✅ Market simulation: mean-reverting drift plus scoped, directional events
- ✅ Pack prices derived from simulating 4,000 openings per set; every set
      returns 87.0%, so none is profitable to spam-open
- ⬜ Market events wired into live prices in the UI
- ⬜ Price history charts, profit/loss tracking

## Milestone 6 — Grading
- 🚧 Submission, fees, turnaround timers, grade generation, graded value
- ⬜ Graded-card selling flow

## Milestone 7 — Sealed market
- ✅ Sealed inventory: bundles, ETBs, booster boxes, collection boxes, tins
- ✅ Sealed value derived from simulated pack price, so all 136 priced sets
      gain a lineup with no per-set data entry
- ✅ Sealed drift with an age bonus; buy-then-resell is strictly lossy
- ✅ Open-vs-hold, verified not to double-charge for the packs inside
- ⬜ Sealed price history

## Milestone 8 — Progression
- ✅ XP, 10 collector levels, unlocks
- ✅ Daily/weekly/long-term missions with progress derived from queries
- ✅ Rewards claimable exactly once, enforced by a unique key
- ⬜ Unlocks actually gating features in the UI (computed, not yet enforced)
- ⬜ Achievements, cosmetics

## Milestone 9 — Full catalogue
- ✅ Full historical import (174 sets)
- ⬜ Per-set authored pack templates replacing era-derived estimates

## Milestone 10 — Advanced market / shop sim
- ✅ Player listings at any asking price, with the card held in escrow
- ✅ NPC buyers arriving on a timer, resolved lazily and deterministically
- ✅ Sale chance decaying with the asking ratio but never reaching zero, so an
      over-priced card still sells eventually
- ✅ 5% marketplace fee, so the stall beats the dealer without making it
      pointless
- ✅ Duplicate detection and one-click bulk sale, excluding favourites and
      graded copies
- ⬜ Auctions, buy orders, NPC shop with rent and reputation

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
