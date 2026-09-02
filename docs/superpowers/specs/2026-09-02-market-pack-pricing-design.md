# Market-anchored pack pricing

Date: 2026-09-02
Status: approved, implementing

## Problem

A pack's price is currently derived from its own contents:
`simulator_price = derivePackPrice(measuredEV) = EV × 1.15`, written by
`scripts/simulate/price-packs.ts`. Two consequences:

1. **Every pack returns the same ~85%.** A 1,000,000-pack simulation across all
   141 openable sets puts mean hold return at 85.7% and mean liquidation return
   at 55.7%, with no set above 100%. The price is a function of the contents, so
   the contents can never beat the price. Choosing a pack is a choice between
   near-identical odds, and the pack shop carries no market knowledge.
2. **Real sealed prices are absent.** The real market values a 1999 Base Set
   pack at $846 and a Pitch Black pack at $5.79. Our derivation puts them at
   $1,127 and (for the four newest sets) nothing at all.

Separately, `me2pt5`, `me3`, `me4` and `me5` have 661 imported cards and **zero**
prices, because `api.pokemontcg.io` publishes no price block for them. They have
no pack template and are therefore not openable, which also left the four
hand-curated sealed snapshots in `scripts/import/pack-market-prices.ts` attached
to nothing (0 `market-median:` rows in the database).

## Decision

Pack price becomes real-world data, exactly like `cards.market_base_price`, and
the EV derivation is demoted to a last-resort fallback.

### Source: tcgcsv.com

A daily mirror of TCGplayer's own feed (`/tcgplayer/3/<groupId>/products` and
`/prices`), which is the same upstream `api.pokemontcg.io` republishes.
Measured against our existing cache for Mega Evolution, variant-aligned prices
agree to a median of 4.5% (p90 20%). It wins on coverage — 148 `Normal` rows
against the API's 110, and full price data for all four 2026 sets — and costs
one request per set instead of paginated API calls.

It is therefore the **primary** card price source, with the existing
`api.pokemontcg.io` cache as fallback. Both feed the existing
`selectBasePrice`; tcgcsv rows are adapted into the `PriceSourceCard` shape
rather than given a second price policy.

Raw responses are cached under `data/raw/tcgcsv/`. Nothing at runtime talks to
tcgcsv.

### Set to TCGplayer group

Resolution order, first hit wins:

1. `set.ptcgoCode === group.abbreviation`
2. normalized name equality (case, `&`/`and`, punctuation, `SV10:`-style prefix)
3. explicit override table for the leftovers

Subsets need no inheritance rule: the catalogue gives a subset its parent's
`ptcgoCode` (`swsh12tg` and `swsh12` are both `SIT`; all 8 pairs behave this
way), so they resolve to the parent's group and inherit its pack price as a
consequence of the mapping. The 25 sets with no `ptcgoCode` — POP 1-9, trainer
kits, McDonald's, Southern Islands, Rumble — are exactly the sets that never had
a booster pack.

### Pack price resolution

`resolvePackPrice()` in `@pcs/economy-engine`, first hit wins:

| Order | Source | Confidence |
|---|---|---|
| 1 | hand-curated `MARKET_SNAPSHOTS` override | `documented_community_data` |
| 2 | tcgcsv booster-pack market price | `documented_community_data` |
| 3 | median real pack price of the set's era | `estimated` |
| 4 | `derivePackPrice(simulatedEV)` | `estimated` |

Sealed products inherit automatically: `sealedBaseValue` and
`sealedRetailPrice` already derive boxes and ETBs from the pack price.

### Schema

`pack_templates` gains four columns mirroring `cards`:
`market_base_price` (nullable), `price_confidence`, `price_source`,
`price_updated_at`. `simulator_price` remains as the EV diagnostic and as
fallback tier 4.

### The balance invariant changes

DESIGN.md §30 requires that opening is not *always* profitable. It does not
require that no pack is ever profitable, but `price-packs.ts` enforced the
stronger rule by failing when any set returned ≥ 100%.

At real market prices, 7 of 101 comparable sets have simulated contents worth
more than the pack (Black Bolt 437%, White Flare 402%, Shrouded Fable 347%,
Chilling Reign 175%, Detective Pikachu 120%, Celebrations 108%, Paldea Evolved
101%); 4 stay cash-positive after the dealer spread. These are almost certainly
a pull-model artifact: the engine picks uniformly *within* a rarity tier, so
sets stuffed with chase cards over-value.

Decision: ship the real prices. `price-packs.ts` stops writing prices and
becomes a report; the hard failure becomes a warning, with `--strict` retained.
The economy test asserts the +EV set list against an **allowlist**, so these 7
stay green while a newly profitable set fails CI as a pull-model regression.

### Price movement

Out of scope. The base price is stored now; `driftSealed()` in
`economy-engine/src/sealed.ts` is already the correct mover and gets wired up
separately.

## Components

| Unit | Responsibility | Depends on |
|---|---|---|
| `card-data/tcgplayer-groups.ts` | set ↔ group resolution | nothing (pure) |
| `card-data/tcgcsv.ts` | tcgcsv rows → `PriceSourceCard`; pick the booster-pack product | `price-selection` types |
| `economy-engine/pricing.ts` | `resolvePackPrice`, `eraMedianPackPrice` | `shared` |
| `scripts/import/fetch-tcgcsv.ts` | network → `data/raw/tcgcsv/` | nothing in the app |
| `scripts/import/apply-prices.ts` | card prices, tcgcsv primary + API fallback | both adapters |
| `scripts/import/apply-pack-prices.ts` | pack market prices → `pack_templates` | resolver + adapter |
| `scripts/simulate/price-packs.ts` | EV report, no longer a price writer | pack-engine |

## Risks

- **Card-number matching.** tcgcsv numbers products by `extendedData.Number`
  ("001/132"); promo and gallery numbering (`TG01`, `GG01`, `SWSH001`) is where
  this goes quietly wrong. The importer reports a per-set match rate and refuses
  a set below 90% unless `--force` is passed.
- **Third-party availability.** tcgcsv rate-limits with a non-JSON page, which
  is how a parallel probe silently produced 220 corrupt files. The fetcher is
  serial, delayed, and retries on parse failure. The cache is committed.
- **The +EV sets are a real grind loop** until the pull model weights within
  tier. The report makes them visible on every run.

## Testing

- Unit: group resolution (code, name, override, subset sharing), tcgcsv adapter
  (variant mapping, zero-as-missing, sealed-product selection excluding code
  cards / art bundles / cases), `resolvePackPrice` ordering and era median.
- Data: per-set card match rate gate in the importer.
- Simulation: `price-packs` reports return% per set and the +EV allowlist.
