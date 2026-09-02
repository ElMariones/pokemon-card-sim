# NPC Dealer Market Design

**Date:** 2026-09-02  
**Status:** Approved product direction; implementation contract

## Purpose

Turn the existing Market into the game's card-trading destination. Players keep
their current stall for selling cards and gain a dealer circuit where they can
browse persistent NPC stock, buy raw or graded cards, negotiate, and combine
wanted cards with cash. Other simulated collectors can buy stock first, so a
good find is an opportunity rather than a permanent catalogue entry.

This remains a single-player, player-to-NPC system. It does not introduce real
player listings, authentication, moderation, or shared inventory.

## Product principles

1. The market creates stories. Dealers, stock, and missed opportunities should
   be memorable without requiring long dialogue.
2. Urgency must be real but fair. Stock can sell while the player is away, but
   an opened negotiation receives a short hold.
3. Sellers are learnable, not arbitrary. Their specialty, patience, price
   posture, traffic, and wanted cards explain their behavior.
4. All economic outcomes are server-authoritative, deterministic once created,
   and auditable. Reloading cannot reroll stock, a negotiation, or another
   buyer's purchase.
5. All money is integer cents. Every cash movement writes a transaction with
   `balanceAfter`.
6. Market values and negotiation guidance never claim false precision.

## Player experience

### Market structure

The page has two stable tabs:

- **Buy cards** opens the NPC dealer circuit and is the default.
- **Sell cards** contains the existing player-listing feature, visually
  upgraded but behaviorally preserved.

The selected tab is encoded in the URL so Back, Forward, and reload preserve
context. The root application shell remains unchanged.

### Dealer circuit

Four code-defined dealer profiles provide recognizable specialties while the
database owns their mutable stock:

| Dealer | Specialty | Refresh | Temperament | Traffic |
| --- | --- | ---: | --- | --- |
| Mina | Modern hits and illustration rares | 3 hours | Impatient, moderate markup | High |
| Rory | Broad-era binder cards | 5 hours | Patient, flexible | Medium |
| Jules | Graded cards | 7 hours | Firm, narrow interests | Medium |
| Old Oak | Vintage and scarce cards | 9 hours | Patient, high-value focus | Low |

Each shop holds six listings. Empty positions refill on its next staggered
rotation. A small share of unsold stale inventory rotates out; the rest remains.
Stock is personal to the current player, persistent across sessions, and seeded
on the server.

Stock selection excludes bulk. Candidates must have a usable price and meet a
minimum effective value of $2.00. Selection is weighted toward `rare`,
`ultra_rare`, `secret_rare`, and `promo` tiers and toward cards above $10. The
dealer profile supplies era, raw/graded, and value-band preferences. Gameplay
never branches on `rarityRaw`.

List prices range approximately from 103% to 132% of effective market value.
Condition modifies raw-card value. Graded listings store the generated company,
numeric grade, label, and value snapshot; the same grade is attached to the
inventory item when purchased.

### Other collectors

Every listing receives a hidden `otherBuyerAt` timestamp when generated. It is
sampled once from a deterministic, listing-specific schedule influenced by:

- price attractiveness versus effective market value;
- normalized rarity and demand;
- graded status;
- the dealer's foot traffic;
- a bounded random factor.

Balance targets are 30 minutes–3 hours for hot, fairly priced chase cards;
2–8 hours for normally desirable stock; and 5–18 hours for expensive,
overpriced specialist stock. These are simulation targets, never exact promises
in the UI.

Market reads lazily settle elapsed listings. Due stock becomes
`sold_to_npc`, displays briefly as “Sold to another collector,” and leaves an
empty position until refresh. The UI describes demand as **quiet**,
**some interest**, **drawing attention**, or **likely to move**. It never shows
the hidden timestamp or a fabricated countdown.

Opening negotiation creates or resumes a five-minute hold. `otherBuyerAt` does
not settle during a valid hold. Closing the sheet releases the hold. An expired
hold no longer protects the card.

### Negotiation

Negotiation is deliberately short and mechanical rather than dialogue-heavy.
The sheet contains the card, asking price, market estimate, one total-offer
slider, trade selection, cash due, risk label, anger meter, and three actions:
**Make offer**, **Pay asking price**, and **Walk away**.

The slider controls total consideration, not cash alone:

```text
total offer = trade credit + cash due
cash due = max(1 cent, total offer - trade credit)
```

The player cannot select trades whose credit equals or exceeds the total offer.
This avoids cash-back barter and guarantees every purchase has a ledger entry.

Each listing stores a hidden seller floor between roughly 86% and 101% of
effective market value, adjusted by dealer temperament, markup, demand, and
stock age. The floor is fixed at generation. An offer at or above the current
acceptance threshold succeeds. A lower offer is rejected, anger rises, and the
seller can return a lower counteroffer that never crosses the hidden floor.

Anger uses integer basis-point comparisons. The intended shape is:

```text
shortfallBp = max(0, (counteroffer - totalOffer) / counteroffer * 10,000)
angerDelta = temperamentBase
           + shortfallBp / 180
           + repeatedOfferPenalty
           + (totalOffer < 60% of counteroffer ? 25 : 0)
```

Values are rounded to integers and clamped. Dealer profiles tune the base and
repetition penalty. A fair miss adds little anger; a ridiculously low offer
adds at least 25 extra points. At 100 anger the negotiation becomes `walked`
and that listing is permanently unavailable to the player. Repeating the same
offer cannot reroll a result.

The client receives only a coarse risk band derived from offer distance and
current anger:

- **Comfortable** — near the current counteroffer.
- **Pushing it** — meaningful discount, modest anger risk.
- **Risky** — likely rejection and material anger.
- **Insulting** — severe anger increase.

Acceptance and anger are calculated on the server. The client may preview the
published risk-band formula for responsiveness, but server output is final.

### Trades

Each shop rotation generates wanted criteria from its dealer profile: preferred
eras, normalized rarity tiers, graded/raw preference, and two exact card
wishlist targets. The negotiation response includes only owned, available cards
that match at least one criterion.

Trade credit is always computed from the card's current effective value:

- general wanted match: 80%–90%, depending on dealer;
- exact wishlist card: 100%;
- graded card: grade-adjusted value before the interest multiplier.

Favorited cards remain selectable but receive a visible warning. Cards that are
listed, awaiting grading, sold, or otherwise unavailable never appear. Selected
trade items are re-read and locked during settlement; client-submitted values
are ignored.

### Purchase settlement

A successful negotiated purchase and a full-price purchase use the same atomic
settlement:

1. Lock the user, stock listing, negotiation, and selected inventory rows.
2. Revalidate stock availability, hold ownership, offer, trade eligibility, and
   current values.
3. Reject insufficient funds before changing ownership.
4. Mark traded inventory items `traded`.
5. Create the purchased inventory item with acquisition source
   `npc_market_purchase` and acquisition price equal to the cash paid.
6. Create its completed grade row when the stock is graded.
7. Mark stock `purchased` and negotiation `accepted`.
8. Debit cash and append one `card_purchase` ledger transaction whose metadata
   records asking price, accepted total, cash paid, trade IDs and credits,
   dealer, card, and stock listing.

The transaction helper must support participating in the caller's existing
database transaction; nested transactions may not leave cash and inventory in
different states.

## Data model

### `npc_shop_rotations`

- `id`, `userId`, `shopId`
- `rotationNumber`
- `startedAt`, `refreshAt`
- wanted criteria JSON snapshot
- unique `(userId, shopId, rotationNumber)` and lookup index on
  `(userId, shopId, refreshAt)`

### `npc_shop_stock`

- `id`, `rotationId`, `userId`, `shopId`, `slot`
- `cardId`, `condition`
- optional `gradeCompany`, `numericGrade`, `gradeLabel`, `isBlackLabel`
- `marketValue`, `askPrice`, `sellerFloor`
- `demandBand`, `otherBuyerAt`
- `status`: `available`, `held`, `purchased`, `sold_to_npc`, `rotated`, `walked`
- `holdUserId`, `holdUntil`, `createdAt`, `resolvedAt`
- unique `(rotationId, slot)` and indexes on user/shop/status and due sales

### `npc_negotiations`

- `id`, `userId`, `stockId`
- `status`: `active`, `accepted`, `walked`, `abandoned`, `expired`
- `anger`, `attempts`, `counterPrice`, `lastOffer`
- `createdAt`, `updatedAt`
- one active negotiation per user and stock listing

Historical stock and negotiations remain as an audit trail. Purchased cards are
normal `inventory_items`; the NPC system does not create a second ownership
model.

## Module boundaries

### `@pcs/economy-engine`

A new pure NPC-market module owns dealer-independent math:

- list-price and seller-floor calculation;
- demand band and other-buyer delay calculation;
- trade-credit calculation;
- risk-band preview;
- anger and counteroffer resolution;
- deterministic selection helpers.

It knows nothing about React, database rows, sessions, or image URLs. Tests use
fixed RNGs and integer cents/basis points.

### Web server

`npc-market-service.ts` owns rotation materialization, lazy settlement, query
views, negotiation mutation, trade eligibility, and atomic purchase settlement.
Dealer profiles live in a focused server-safe configuration module. The client
never supplies a user ID, market value, grade, trade credit, anger, or outcome.

### HTTP API

- `GET /api/market/buy` — settle elapsed stock, materialize due rotations, and
  return dealers, stock, activity, and server time.
- `POST /api/market/negotiate/open` — open/resume the hold and return the
  negotiation plus eligible trade cards.
- `POST /api/market/negotiate/offer` — submit stock ID, negotiation ID, total
  offer, and selected inventory IDs; return rejection/counter/anger or the
  completed purchase.
- `POST /api/market/negotiate/release` — abandon the active hold.
- `POST /api/market/buy-now` — atomically purchase at asking price, optionally
  applying eligible trade cards.

Malformed input returns 400, absent sessions 401, unavailable or stale stock
409, insufficient funds 400, and unexpected errors 500. Error copy says what
changed and what the player can do next.

## Interface design

The feature stays inside the established “vitrine after closing” identity. It
adds dealer character through arrangement and copy rather than new decorative
colors.

### Tokens

- Ink `#080b13`: page depth.
- Vitrine `#10151f`: dealer cases.
- Raised vitrine `#161d2b`: selected shop and offer sheet.
- Seam `#29334a`: structural dividers.
- Manila `#e6dcc9`: primary copy.
- Brass `#d3a03c`: selected state and market opportunity.

Archivo remains the compact display face; Instrument Sans handles copy and DM
Mono is limited to money, grades, and market figures. Holo colors remain card
only. Anger uses the existing gain-to-brass-to-loss palette rather than a new
rainbow scale.

### Desktop composition

```text
+ Buy cards | Sell cards -------------------------------------------+
| Dealer rail                | Selected dealer                       |
| Mina  3 new                | portrait / posture / next refresh     |
| Rory  1 new                |                                       |
| Jules                      | [stock] [stock] [stock]               |
| Old Oak                    | [stock] [stock] [empty/sold]          |
+----------------------------+---------------------------------------+
| Recent market activity                                             |
+--------------------------------------------------------------------+
```

The dealer rail is left-aligned and narrow; the cards remain the dominant
visual material. On mobile it becomes a horizontal snap selector above a
two-column stock grid. The negotiation view is a right-side case drawer on
desktop and a full-height bottom sheet on mobile. The memorable interaction is
the single anger gauge tightening as the offer moves; surrounding motion stays
quiet.

### Stock cards

Each tile includes the inspectable card/slab, asking price, market comparison,
condition or grade, demand label, and new-arrival marker. Clicking the card
opens inspection; the explicit **Make a deal** action opens negotiation. Empty
sold slots explain when that dealer next refreshes.

### Sell redesign

The existing selling behavior remains intact. Its presentation becomes the
player's stall:

- a compact summary of active cards, listed value, expected net, total visits,
  and completed sales;
- active listing cards with a market-position bar, expected-wait language,
  dealer alternative, and cancel action;
- a distinct recent-sales ledger;
- the existing listing dialog and price guide, restyled to match the new page.

## Accessibility and responsive behavior

- Tabs, dealer selection, offers, trades, and closing the sheet are keyboard
  operable with visible brass focus.
- Slider value, risk, anger, trade credit, and cash due have textual equivalents
  and live-region announcements.
- Color is never the only anger or demand signal.
- The sheet traps focus, closes with Escape, restores focus to its listing, and
  warns before discarding an active offer.
- Reduced motion disables gauge easing and drawer movement while preserving
  state changes.
- Touch targets are at least 44px and the mobile drawer keeps its primary action
  above the safe-area inset.

## Testing contract

### Economy unit tests

- Stock selection never emits unpriced/bulk cards and respects normalized
  rarity/profile constraints.
- Same seed and inputs produce identical stock, pricing, sale delay, and
  negotiation results.
- Other-buyer delay responds monotonically to demand and asking ratio and stays
  inside configured bounds.
- Trade credit uses effective raw/graded value and the correct interest rate.
- Very low offers increase anger faster than fair misses; anger clamps at 100.
- Counteroffers never increase and never cross the seller floor.
- Identical repeated offers cannot reroll acceptance.
- All arithmetic returns integer cents or integer basis points.

### Service/integration tests

- Rotations persist across reads and refresh only when due.
- Due stock sells lazily and a valid hold prevents settlement.
- A released or expired hold no longer prevents settlement.
- Failed negotiation persists and locks only that stock listing.
- Buy-now and accepted offers create exactly one inventory item and ledger row.
- Graded purchases create the expected completed grade.
- Trades reject foreign, unavailable, duplicate, or uninterested inventory IDs.
- Concurrent purchase attempts cannot duplicate a card or overdraw cash.
- Settlement failure rolls back cash, trade statuses, stock, grade, and purchase.
- Balance audit remains consistent after cash-only and mixed trades.

### UI and repository verification

- Component tests cover tabs, dealer switching, risk/anger copy, trade totals,
  empty/sold slots, errors, and mobile sheet controls.
- Existing selling-market tests remain green.
- Run `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build`.
- Run a focused database-backed smoke flow: load stock, negotiate, trade two
  cards plus cash, verify inventory/grade/ledger, then reload and confirm the
  listing remains purchased.

## Scope boundaries

This feature does not add dealer reputation, friendship levels, auctions, buy
orders, shop rent, real players, NPC cash balances, or sealed-product trading.
The persisted dealer and negotiation model leaves room for reputation later
without requiring it now.

