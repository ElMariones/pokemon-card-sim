# Pokémon TCG Collector Simulator — Game & Web App Design Document

**Working title:** PokeCard Simulator

**Document type:** Product + Game Design + Technical Design

**Target:** Desktop-first responsive web app, later mobile/PWA

**Core fantasy:** *"What if I could live the full life of a Pokémon card collector without needing to spend real money?"*

---

## 1. Vision

Build a browser-based Pokémon TCG collection simulator where the player starts with a small amount of virtual money and gradually becomes a serious collector/dealer.

The player can:

- Buy Pokémon TCG packs and sealed products with virtual currency.
- Open packs with satisfying, animated reveals.
- Build a collection/album.
- Complete individual set checklists.
- Buy and sell singles.
- Track card values and portfolio value.
- Send cards to a virtual grading service.
- Sell graded cards at a premium later.
- Buy sealed products and hold them as investments.
- Complete collection milestones and unlock better opportunities.
- Make risky but informed decisions between opening, collecting, grading, flipping, and investing.
- Progress from casual collector to high-end collector / virtual card shop owner.

The long-term goal is not just a pack-opening simulator. It is a **collection-management and card-market simulator with pack opening as the emotional centerpiece**.

---

## 2. Important Product Principle: Separate Real-World Data from Game Rules

The app should treat Pokémon TCG data as an external dataset and the game's economy as its own simulation layer.

### Real-world data layer

Stores things such as:

- Set name
- Set abbreviation/code
- Series
- Release date
- Card number
- Card name
- Rarity
- Card image URL / asset reference
- Card variants / printings
- Set symbol or product artwork where available
- Known pack composition
- Known rarity / pull-rate data
- Source and source date
- Confidence level of the pull-rate data

### Game layer

Stores:

- Player money
- Inventory
- Collection progress
- Pack prices
- Card market values
- Buy/sell spreads
- Grading fees
- Grading outcomes
- Market trends
- NPC/vendor behavior
- Missions
- XP
- Unlocks
- Achievements

This separation is critical: real card data can be updated without rewriting the whole game economy.

---

## 3. Scope of the Card Database

The user experience should eventually aim for **the broadest practical coverage of Pokémon TCG sets and products**, with all of the available for sale packs..

PkmnCards currently exposes a very large historical set catalogue spanning Classic, Gym, Neo, e-Card, EX, Diamond & Pearl, Platinum, HeartGold & SoulSilver, Black & White, XY, Sun & Moon, Sword & Shield, Scarlet & Violet, Mega Evolution, promos, trainer kits, special products, etc. citeturn688332search0

PkmnCards also exposes thousands of indexed Pokémon card records and supports rarity/set filtering, making it useful as one reference for building a normalized database. citeturn688332search3turn688332search4

### Recommended content model

Do **not** model the database as only `Set -> Pack`.

Use:

```text
Series
  └── Set / Expansion
        ├── Card
        ├── Pack Template(s)
        ├── Sealed Product(s)
        └── Pull Table(s)
```

Example:

```text
Scarlet & Violet
  └── 151
       ├── Card 001
       ├── Card 002
       ├── ...
       ├── Booster Pack
       ├── Booster Bundle
       ├── ETB
       ├── Collection Boxes
       └── Pull Profiles
```

This allows the app to support:

1. Standard booster packs.
2. Special-set packs.
3. Products containing a fixed number of packs.
4. Products with promo cards.
5. Historical / unusual products.
6. Future sets added later.

---

## 4. Data Sources and Licensing Strategy

### Candidate sources

The proposed sources are:

- Official Pokémon TCG galleries: `tcg.pokemon.com/en-us/all-galleries/`
- PkmnCards set/card database: `pkmncards.com/sets/`
- My TCG Collection pack simulator: `mytcgcollection.com/sets/pack-sim`

PkmnCards describes itself as a Pokémon TCG card database intended for high-quality card viewing and reference, and its set catalogue includes a large historical range. citeturn688332search7turn688332search0

My TCG Collection describes itself as a free Pokémon pack simulator and collection tracker, with English/Japanese collection and price-tracking features. citeturn283709search0

You can grab images from those sites to the proyect.

### Recommended asset abstraction

Never reference source URLs directly from gameplay code.

Use:

```text
CardImageAsset
- card_id
- source
- source_url
- local_asset_path
- image_type
- license_status
- attribution
- checksum
- imported_at
```

---

## 5. Pull-Rate / Pack Simulation System

This is one of the most important systems in the project.

### Goal

Opening a pack should feel authentic to the selected product/set rather than simply choosing a random card weighted by rarity.

### Use slot-based pack templates

Example:

```json
{
  "pack": "sv_base_booster",
  "slots": [
    { "name": "energy", "table": "sv_base_energy" },
    { "name": "common_1", "table": "sv_base_common" },
    { "name": "common_2", "table": "sv_base_common" },
    { "name": "uncommon_1", "table": "sv_base_uncommon" },
    { "name": "uncommon_2", "table": "sv_base_uncommon" },
    { "name": "uncommon_3", "table": "sv_base_uncommon" },
    { "name": "reverse_holo_1", "table": "sv_base_reverse" },
    { "name": "reverse_holo_2", "table": "sv_base_reverse" },
    { "name": "rare_slot", "table": "sv_base_rare" }
  ]
}
```

The exact structure should be configurable per set/product.

### Probability model

A pull table should support either:

```text
weighted_card_pool
```

or:

```text
weighted_rarity_pool -> weighted_card_pool
```

Example:

```json
{
  "table": "special_illustration_rare",
  "entries": [
    { "card_id": "PFL-XXX", "weight": 1 },
    { "card_id": "PFL-YYY", "weight": 1 },
    { "card_id": "PFL-ZZZ", "weight": 1 }
  ]
}
```

### Data confidence levels

Every pull-rate value should have a source classification:

- `official`
- `manufacturer_published`
- `documented_community_data`
- `estimated`
- `unknown`

This is important because older Pokémon TCG products do not necessarily have the same level of publicly documented pull-rate information as modern products.

### Never fake precision

If the real-world probability is unknown, do not display:

> 1.72% chance

unless that number is actually supported by the underlying source/data.

Instead, use:

> Estimated pull rate

or

> Community estimate

and expose a source/notes panel.

### Deterministic randomness

Each opening should be generated server-side using cryptographically strong randomness or an auditable server RNG.

Optional advanced feature:

```text
Opening ID
Random seed
Pack template version
Probability table version
```

This makes debugging and anti-cheat investigations possible.

---

## 6. Pack Opening UX

Pack opening is the emotional centerpiece of the application.

### Opening flow

```text
Shop
  -> Choose product
  -> Confirm purchase
  -> Pack added to inventory
  -> Open pack
  -> Pack animation
  -> Card stack appears
  -> Reveal cards one-by-one
  -> Rarity/shine effects
  -> Collection updated
  -> Value summary
```

### Recommended reveal sequence

1. Pack artwork.
2. "Rip" / opening interaction.
3. Cards slide out.
4. Reveal commons/uncommons quickly.
5. Slow down on reverse holo slots.
6. Dramatic pause on the rare/hit slot.
7. High-rarity effects.
8. Final results screen.
9. "Add to album" / "Sell" / "Grade" actions.

### Visual philosophy

The UI should gradually become more chaotic and spectacular as the player's collection gets more valuable.

Early game:

- Clean
- Small collection
- Basic pack opening
- Minimal effects

Late game:

- Large collection
- Multiple graded cards
- Lots of market activity
- Rare pull animations
- Portfolio graphs
- Sealed inventory
- Trophy cards

---

## 7. Player Economy

### Base currencies

Use two currencies at first:

**Cash**

Primary currency used for:

- Packs
- Singles
- Supplies
- Grading
- Collection upgrades

**Collector XP / Reputation**

Used for progression/unlocks rather than purchasing cards.

Avoid adding too many currencies in the MVP.

### Starting state

Example:

```text
Cash: $500
Collector Level: 1
Album capacity: 100
Available sets: Starter-era sets
```

The player should immediately be able to buy a few packs and make decisions.

---

## 8. Main Player Loops

### Loop A — Pack opener

```text
Earn money
-> Buy packs
-> Open packs
-> Keep valuable cards
-> Sell duplicates
-> Repeat
```

### Loop B — Set collector

```text
Choose set
-> Buy/open packs
-> Fill binder
-> Search for missing cards
-> Buy singles
-> Complete set
-> Earn completion reward
-> Start next set
```

### Loop C — Trader

```text
Find underpriced card
-> Buy
-> Wait
-> Sell when market rises
```

### Loop D — Grader

```text
Pull valuable card
-> Send for grading
-> Pay grading fee
-> Wait
-> Receive grade
-> Sell/keep
```

### Loop E — Sealed investor

```text
Buy sealed product
-> Hold
-> Market changes
-> Sell later
```

### Loop F — Shop owner (late-game)

```text
Buy inventory
-> Set prices
-> Sell to NPC customers
-> Manage cash flow
-> Unlock higher-tier products
```

---

## 9. Collection / Album System

### Album views

The album should support:

- Card grid
- Binder pages
- Set completion
- Owned quantity
- Duplicates
- Graded status
- Favorite cards
- Estimated collection value
- Acquisition history

### Card states

A single physical card owned by the player should have a unique inventory ID.

```text
InventoryCard
- inventory_id
- card_id
- condition
- acquisition_source
- acquisition_price
- acquired_at
- current_estimated_value
- status
- grading_id
```

This is necessary because two copies of the same card may have different histories and values.

Example:

```text
Pikachu #123
Copy A: raw, acquired for $4.50
Copy B: PSA 10, acquired for $8.00
Copy C: raw, acquired from pack
```

---

## 10. Card Condition System

Start simple.

```text
Near Mint
Lightly Played
Moderately Played
Heavily Played
Damaged
```

Pack-pulled cards can default to `Near Mint` but should still have tiny simulated condition variance if desired.

Later, condition can influence:

- Raw price
- Grading probability
- Customer demand
- Sell price

---

## 11. Grading System

### MVP

Use the most famous pokemon grading brands and their methods and singularities.

Example:

**CardGrade**

```text
10 Gem Mint
9 Mint
8 Near Mint/Mint
7 Near Mint
6 Excellent-Mint
5 Excellent
...
```

### Grading pipeline

```text
Raw card
-> Submit
-> Pay grading fee
-> Queue
-> Processing timer
-> Grade revealed
-> Card becomes graded inventory
```

### Grade generation

Use probabilities influenced by condition and card age/source if desired.

Example:

```text
Raw NM
  10: 8%
   9: 35%
   8: 40%
   7: 14%
  <7: 3%
```

Do not use these numbers as real grading probabilities. They are game-design placeholders and must be balanced through playtesting.

### Graded value

```text
graded_value = base_market_value
              * grade_multiplier
              * market_modifier
```

Example game multipliers can be tuned later.

---

## 12. Card Market

The market should simulate prices instead of simply using a static database value.

### Base value

Each card has a baseline price:

```text
market_base_price
```

### Dynamic value

Actual game price:

```text
price = base_price
      * demand_modifier
      * rarity_modifier
      * trend_modifier
      * supply_modifier
      * condition_modifier
      * grade_modifier
```

### Market events

Occasional events create interesting decisions:

- New Pokémon game release
- New TCG expansion
- Pokémon anime focus
- Championship results
- Influencer hype
- Nostalgia event
- Reprint
- Sudden supply increase
- "Vintage week"
- Community challenge

### Important design rule

Market movement should be **predictable enough to learn but unpredictable enough to be interesting**.

Players should be able to make informed decisions, not simply gamble on random numbers.

---

## 13. Buying and Selling

### Player-to-NPC market

MVP should use an NPC dealer/buylist model because it is vastly easier to implement.

Example:

```text
Market value: $25
Dealer offer: $21
Player listing value: $25
```

### Later: player marketplace

A future multiplayer version could support:

- Player listings
- Auctions
- Buy orders
- Trade requests
- Price history

This introduces fraud, market manipulation, moderation, item duplication, and economic security issues, so it should not be part of the MVP.

---

## 14. Sealed Product System

The player should be able to hold sealed inventory.

### Product types

```text
Booster Pack
Booster Bundle
Elite Trainer Box
Collection Box
Special Collection
Tin
Blister
Premium Collection
Booster Box
```

Each product should contain a configurable payload:

```json
{
  "product_id": "sv151-etb",
  "packs": 9,
  "promo_cards": ["promo-xyz"],
  "accessories": ["sleeves", "energy", "dice"]
}
```

### Sealed investment

Product price can evolve independently from the price of its individual cards.

Example:

```text
Player buys ETB for $45
6 months later:
Market value = $70
```

The player can:

- Sell sealed
- Open it
- Keep it as a trophy

That decision is a major part of the game's strategy.

---

## 15. Progression System

### Collector levels

Example progression:

```text
Level 1  Casual Collector
Level 2  Rookie
Level 3  Regular
Level 4  Enthusiast
Level 5  Serious Collector
Level 6  Trader
Level 7  Investor
Level 8  Grading Expert
Level 9  Dealer
Level 10 Card Shop Owner
```

### Unlocks

Potential unlocks:

- More historical sets
- Better storage
- Larger album
- Better market information
- Grading access
- Sealed market
- Bulk selling
- Advanced statistics
- NPC shop
- Auctions
- High-end cards

Unlocks should be based on progression, not real-money purchases.

---

## 16. Missions and Challenges

Examples:

### Daily

- Open 3 packs.
- Sell 5 duplicates.
- Buy a card below $10.
- Add 10 unique cards to your collection.

### Weekly

- Complete 25 cards from one set.
- Make $100 profit from trading.
- Grade 3 cards.

### Long-term

- Complete a full set.
- Own 100 unique Pokémon.
- Own a grade 10 card.
- Reach $10,000 collection value.
- Own a sealed booster box.

---

## 17. Set Completion System

Set pages should be one of the main navigation hubs.

Each set page shows:

```text
Set
├── Release date
├── Total cards
├── Owned / total
├── Completion %
├── Estimated set value
├── Missing cards
├── Rarity breakdown
├── Pull statistics
└── "Open this set" button
```

### Completion rewards

Optional rewards:

- Cash
- XP
- Album pages
- Cosmetic binder themes
- Rare promotional simulator cards

Completion rewards should not distort the real-card economy too much.

---

## 18. UI / Information Architecture

Recommended main navigation:

```text
HOME
PACKS
SHOP
COLLECTION
MARKET
GRADING
SEALED
MISSIONS
PROFILE
```

### Home dashboard

Show:

- Cash
- Collection value
- Recent pulls
- Current pack offers
- Active grading orders
- Market movements
- Mission progress

### Packs

Filters:

- Era
- Series
- Set
- Price
- Popularity
- Release date
- Vintage / modern

### Collection

Filters:

- Set
- Rarity
- Pokémon
- Type
- Condition
- Graded/raw
- Value

---

## 19. Recommended Tech Stack

### Frontend

**Next.js + React + TypeScript**

Why:

- Excellent web-app ecosystem.
- Good routing and server/client separation.
- Easy deployment.
- TypeScript reduces data-model bugs.
- Good fit for a large catalogue UI.

### Styling

**Tailwind CSS**

Use a component library only where it genuinely saves time.

### Animation

**Framer Motion** for most UI animation.

Potentially use CSS/Web Animations for simple effects.

For high-impact pack openings later, evaluate:

- React Three Fiber
- Three.js

Do not introduce WebGL on day one. The first pack-opening animation can be built with standard DOM/CSS animations.

### Backend

**Node.js + TypeScript**

Initially:

- Next.js server actions / route handlers

As the application becomes more complex:

- Dedicated API service
- Background workers

### Database

**PostgreSQL**

Why:

- Strong relational model for cards, sets, inventories and transactions.
- Reliable transactions.
- Excellent indexing.
- Easy reporting/analytics.

### ORM

**Prisma** or **Drizzle**.

Recommendation: Drizzle if you want more explicit SQL control; Prisma if developer velocity and schema ergonomics are more important.

### Cache / queues

**Redis**

Used later for:

- Market snapshots
- Session data
- Rate limiting
- Job queues
- Expensive catalogue queries

### Background jobs

**BullMQ + Redis** or an equivalent managed queue.

Useful for:

- Data imports
- Price updates
- Grading timers
- Market simulation ticks
- Scheduled events

### Object storage

**S3-compatible object storage**

Store approved/legally usable card assets and generated UI assets separately from application code.

### Search

MVP:

- PostgreSQL full-text search

Later:

- Meilisearch / Typesense / OpenSearch

### Authentication

Use a managed auth solution initially:

- Auth.js
- Clerk
- Supabase Auth

The exact choice depends on deployment preference.

### Deployment

MVP-friendly:

```text
Vercel
+ Managed PostgreSQL
+ Managed Redis
+ S3-compatible storage
```

Alternative:

```text
Cloudflare / Fly.io / AWS
+ PostgreSQL
+ Redis
+ Object storage
```

---

## 20. High-Level Architecture

```text
                    ┌──────────────────────┐
                    │      Next.js UI      │
                    │ React + TypeScript   │
                    └──────────┬───────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │ Application / API    │
                    │ Game logic           │
                    └──────────┬───────────┘
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
      ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
      │ PostgreSQL   │ │ Redis        │ │ Object Store │
      │ Game + data  │ │ Cache/queue  │ │ Card assets  │
      └──────────────┘ └──────────────┘ └──────────────┘
              ▲
              │
      ┌──────────────────────┐
      │ Import / Data Worker │
      │ Set/card/price data  │
      └──────────────────────┘
```

---

## 21. Suggested Core Database Schema

### `sets`

```text
id
name
code
series
release_date
card_count
logo_asset_id
symbol_asset_id
status
source
created_at
updated_at
```

### `cards`

```text
id
set_id
number
name
rarity
supertype
subtype
hp
artist
variant
image_asset_id
market_base_price
source
created_at
updated_at
```

### `pack_templates`

```text
id
set_id
name
product_type
cards_per_pack
rules_json
source
confidence
version
```

### `pull_tables`

```text
id
pack_template_id
name
slot_name
selection_mode
entries_json
source
confidence
version
```

### `products`

```text
id
name
set_id
type
msrp_reference
simulator_price
sealed_base_value
contents_json
image_asset_id
```

### `users`

```text
id
created_at
currency
xp
level
```

### `inventory_items`

```text
id
user_id
type
card_id
product_id
condition
quantity
acquisition_price
acquired_at
status
```

### `openings`

```text
id
user_id
pack_template_id
cost
rng_seed_hash
created_at
```

### `opening_cards`

```text
id
opening_id
card_id
inventory_item_id
slot_name
```

### `grades`

```text
id
inventory_item_id
grade_company
numeric_grade
label
submission_fee
submitted_at
completed_at
```

### `transactions`

```text
id
user_id
type
amount
currency
item_type
item_id
metadata_json
created_at
```

All currency-affecting actions should create an auditable transaction record.

---

## 22. Security and Anti-Cheat

Even though it is a game, the virtual economy must be treated like a real economy.

### Never trust the client for:

- Money balance
- Card ownership
- Pack contents
- Grading result
- Sale price
- Inventory quantity
- XP

The server must decide all economically meaningful outcomes.

### Example

Bad:

```text
Client: "I opened this pack and got Charizard."
```

Good:

```text
Client: "Open pack #123"
Server:
  -> Verify ownership
  -> Consume pack
  -> Generate result
  -> Write opening
  -> Add cards
  -> Return result
```

### Transaction safety

Opening packs and selling cards must use database transactions where appropriate.

---

## 23. Analytics

Track events from day one.

Example events:

```text
user_created
pack_viewed
pack_purchased
pack_opened
card_revealed
card_sold
card_graded
grade_received
set_started
set_completed
market_item_viewed
mission_completed
```

### Important metrics

- Day 1 / Day 7 retention
- Packs opened per active user
- Average play session
- Average collection value
- Cash velocity
- Sell/buy ratio
- Set completion rate
- Grading usage
- Sealed holding rate
- Most opened sets
- Most valuable pulls

---

## 24. Admin Dashboard

Absolutely necessary once the database becomes large.

Admin features:

- Set importer
- Card importer
- Image status
- Pull-rate editor
- Pack template editor
- Product editor
- Economy balance controls
- Price controls
- Market event manager
- User inventory inspection
- Transaction log
- Manual compensation tool
- Data source/version manager

### Data versioning

Every important simulation configuration should be versioned.

```text
Pull table v1
Pull table v2
Pack template v4
Market model v7
```

This prevents silent changes to historical data and gives you reproducible simulations.

---

# 25. Development Milestones

## Milestone 0 — Pre-production / Technical Spike

**Goal:** Prove the riskiest parts before building the full app.

Tasks:

- Confirm permitted data/image usage.
- Test access to official gallery pages.
- Test structured extraction from permitted sources.
- Build a tiny sample dataset.
- Define normalized schema.
- Implement one pack simulation.
- Prototype pack opening animation.

**Deliverable:**

A tiny page where the user can open one simulated pack containing a handful of real cards from one set.

---

## Milestone 1 — Vertical Slice

**Goal:** Build the entire basic gameplay loop with intentionally small scope.

Include:

- Authentication
- Starting money
- One set
- One pack type
- Pack purchase
- Pack opening
- Collection
- Selling cards
- Basic prices
- Basic save system

Example target:

```text
1 set
20–50 cards
1 pack
1 shop
1 collection page
1 sell flow
```

**Deliverable:**

The game is already playable from start to finish, even though content is tiny.

---

## Milestone 2 — Real Card Database Pipeline

**Goal:** Replace hardcoded cards with a maintainable catalogue.

Tasks:

- Import sets.
- Import cards.
- Import rarity.
- Import card images through the approved asset pipeline.
- Normalize set codes.
- Detect duplicates.
- Create source tracking.
- Build admin import tools.

PkmnCards is useful as a reference because its set page enumerates a broad historical catalogue and its card search supports fields such as set and rarity. citeturn688332search0turn688332search3

**Deliverable:**

Thousands of cards can exist in the database without changing frontend code.

---

## Milestone 3 — Multi-Set Pack Engine

**Goal:** Make pack simulation data-driven.

Tasks:

- Pack templates.
- Slot rules.
- Rarity tables.
- Product contents.
- Set-specific rules.
- Pull-rate source/confidence fields.
- Simulation test harness.

### Automated tests

Run 100k / 1M simulated packs for each pack template and report:

```text
Slot distribution
Rarity distribution
Average card value
Hit rate
Duplicate rate
Set completion rate
```

This is essential to catch probability bugs.

---

## Milestone 4 — Collection Experience

Add:

- Binder UI
- Set pages
- Filters
- Search
- Favorites
- Duplicate handling
- Completion tracking
- Collection statistics

**Deliverable:**

The player can genuinely use the app as a virtual Pokémon card collection.

---

## Milestone 5 — Economy v1

Add:

- Card buy/sell market
- NPC dealer
- Market value history
- Dynamic prices
- Transaction history
- Collection valuation
- Profit/loss tracking

**Balancing target:**

Players should have to make meaningful decisions instead of having infinite money.

---

## Milestone 6 — Grading

Add:

- Grading submission
- Fees
- Timers
- Grade result
- Graded card inventory
- Grade multipliers
- Graded-card selling

**Deliverable:**

A valuable card can become a long-term investment decision.

---

## Milestone 7 — Sealed Market

Add:

- Sealed product inventory
- Booster boxes
- ETBs
- Tins
- Collection boxes
- Sealed price movement
- Open-vs-hold decision

This is where the simulator begins to feel like a complete collector/trader game rather than a pack opener.

---

## Milestone 8 — Progression / Game Layer

Add:

- XP
- Levels
- Missions
- Achievements
- Unlocks
- Milestones
- Collection rewards
- Cosmetic upgrades

The progression system should give the player a reason to keep playing after the novelty of opening packs wears off.

---

## Milestone 9 — Full Catalogue

Expand toward comprehensive historical coverage.

Tasks:

- Import historical eras.
- Import special sets.
- Import promos where appropriate.
- Import trainer kits / unusual releases where useful.
- Add product-specific pack templates.
- Resolve data inconsistencies.
- Add data QA dashboards.

PkmnCards' published set catalogue demonstrates the scale of historical coverage involved: it spans multiple generations/eras and includes promos, trainer kits, special collections and other categories beyond conventional expansions. citeturn688332search0

**Important:** do not treat "all packs" as one final checkbox. Make catalogue expansion an ongoing data operation with an explicit completeness metric.

---

## Milestone 10 — Advanced Market / Shop Simulator

Optional late-game systems:

- Player listings
- Auctions
- Buy orders
- Virtual card shop
- NPC customers
- Wholesale purchases
- Inventory management
- Rent / operating expenses
- Shop reputation

This milestone transforms the game into a deeper management simulator.

---

## Milestone 11 — Polish / Launch

Tasks:

- Mobile responsiveness
- Accessibility
- Loading optimization
- Animation polish
- Sound design
- Error handling
- Monitoring
- Anti-cheat review
- Economy balance pass
- Data QA pass
- Legal review for assets/content
- Privacy policy / terms
- Backups / disaster recovery

---

# 26. MVP Definition

Do **not** attempt to launch with every historical Pokémon set.

A strong MVP should contain:

```text
1–3 sets
50–500 cards
Several pack templates
Realistic pack slot rules
Pack opening animation
Collection album
Card selling
Simple market prices
User accounts
Persistent inventory
Basic progression
```

The MVP success criterion is:

> A player can open packs, get excited about pulls, manage a collection, sell duplicates, and come back because they want to complete something.

Not:

> The database contains every Pokémon card ever printed.

---

# 27. Post-MVP Content Expansion Strategy

Once the engine is stable, content expansion should be mostly data work rather than frontend development.

Ideal architecture:

```text
New Set
   ↓
Importer
   ↓
Normalized Cards
   ↓
Image Assets
   ↓
Pack Template
   ↓
Pull Tables
   ↓
Market Defaults
   ↓
QA
   ↓
Publish
```

This is the difference between a maintainable game and a project where every new set requires custom code.

---

# 28. Development Order Recommendation

The fastest path to something genuinely fun is:

```text
1. Pack simulator
2. Collection
3. Sell cards
4. Economy
5. Grading
6. Sealed market
7. Progression
8. Huge catalogue
9. Advanced trading / shop simulation
```

Do **not** start by importing 20,000+ cards.

Start with one set and make the opening + collection loop excellent.

Then prove the data architecture can ingest the next 10 sets without changing code.

Then scale the catalogue.

---

# 29. Testing Strategy

## Unit tests

Test:

- Probability selection
- Weighted random functions
- Pack rules
- Currency calculations
- Market calculations
- Grade generation
- Inventory operations

## Simulation tests

For every pack:

```text
Run 100,000+ simulated openings
Compare observed distribution to target distribution
```

Alert when the deviation exceeds an acceptable threshold.

## Integration tests

Test:

```text
Buy pack
-> Open pack
-> Receive cards
-> Save inventory
-> Sell one card
-> Balance updates
```

## Economy tests

Simulate thousands of player lifetimes and verify that the economy does not:

- Generate infinite money.
- Destroy all player liquidity.
- Make every strategy profitable.
- Make grading always optimal.
- Make opening packs mathematically superior to all other options.

---

# 30. Balance Philosophy

The game should create different valid strategies.

### Opening should be exciting, not always profitable.

If expected pack value is always higher than pack price, players will simply spam open.

### Selling duplicates should provide liquidity.

### Completing sets should require planning.

### Grading should have real opportunity cost.

### Sealed investing should reward patience but remain uncertain.

### Trading should reward knowledge.

The ideal player question is:

> "Do I open this, sell it, grade it, keep it, or hold the sealed product?"

That decision is the core strategic identity of the game.

---

# 31. Audio / Feedback Design

Pack opening should have layered feedback.

### Common

- Small click
- Quick reveal

### Holo / higher rarity

- Longer reveal
- Sparkle
- Stronger sound

### Extremely rare

- Screen impact
- Dramatic pause
- Unique animation
- Special reveal sequence

The sound/animation system should be data-driven:

```text
rarity -> reveal_profile
```

so new rarities do not require code changes.

---

# 32. Accessibility

Provide:

- Reduced-motion mode
- Skip animation option
- Keyboard navigation
- Screen-reader labels
- High-contrast UI
- Color-independent rarity indicators
- Text descriptions for effects
- Mobile touch targets

A "skip reveal animation" button should always be available after the first few openings.

---

# 33. Performance Strategy

The app may eventually display thousands of cards.

Use:

- Image CDN
- Responsive card images
- Lazy loading
- Virtualized card grids
- Database pagination
- Server-side filtering
- Cached set statistics

Never load an entire historical card catalogue into the browser.

---

# 34. Data Quality Strategy

Every imported card should pass validation.

Example checks:

```text
Set exists
Card number valid
Card name present
Rarity recognized
Image exists
Image dimensions acceptable
No duplicate primary key
Source recorded
```

Data-quality dashboard:

```text
Total cards: 18,xxx
Missing images: 12
Missing rarity: 5
Unmapped sets: 3
Unknown products: 17
Pull tables missing: 7
```

---

# 35. Suggested Repository Structure

```text
pokemon-simulator/
├── apps/
│   ├── web/
│   └── admin/
├── packages/
│   ├── db/
│   ├── game-engine/
│   ├── pack-engine/
│   ├── economy-engine/
│   ├── card-data/
│   ├── ui/
│   └── shared/
├── workers/
│   ├── imports/
│   ├── prices/
│   └── market/
├── scripts/
│   ├── import-sets/
│   ├── validate-data/
│   └── simulate-packs/
└── docs/
```

### Important package boundaries

`pack-engine` should not know anything about React.

`economy-engine` should not know anything about image URLs.

`card-data` should not know anything about user accounts.

This separation will make the project dramatically easier to maintain.

---

# 36. Future Features

Potential long-term additions:

- Multiplayer collections
- Player-to-player trading
- Auctions
- Friends
- Public profiles
- Leaderboards
- Collection showcases
- Community events
- Tournaments using collection decks
- Deck-building mode
- Virtual card shop
- NPC customers
- Historical price charts
- Collection insurance
- Storage upgrades
- Binder customization
- Display cases
- Trophy room
- Seasonal events
- Daily pack rotation
- Mystery vendor inventories

---


---

# 39. First 4 Weeks — Concrete Build Plan

## Week 1

Build:

- Next.js app
- TypeScript
- PostgreSQL
- Basic schema
- Card/Set models
- One sample set
- Simple collection page

## Week 2

Build:

- Pack template model
- Weighted random engine
- Server-side opening endpoint
- Inventory system
- Currency system
- Transaction system

## Week 3

Build:

- Pack opening animation
- Pack purchase UI
- Card reveal UI
- Sell card UI
- Collection filtering
- Basic value display

## Week 4

Build:

- One complete gameplay loop
- Automated pack simulations
- Basic balance pass
- Source/import prototype
- Admin card/set editor
- Deploy a playable prototype

### End-of-week-4 target

A user can:

```text
Create account
-> Receive $500
-> Buy a pack
-> Open it
-> See the card animation
-> Add cards to collection
-> Sell duplicates
-> Buy another pack
```

That is the first milestone that matters.

---

# 40. Definition of Done for Version 1.0

Version 1.0 should satisfy:

- Stable authentication
- Persistent inventory
- Deterministic transaction accounting
- Robust pack simulation
- At least several complete sets
- Collection/binder experience
- Search/filtering
- Buying/selling
- Grading
- Sealed products
- Missions/progression
- Market simulation
- Mobile-friendly layout
- Admin content management
- Automated data validation
- Automated probability tests
- Monitoring/logging
- Backup strategy
- Validated content/image licensing

---

# 41. Final Product Concept

The best version of this project is essentially:

> **A Pokémon TCG collector's life simulator disguised as an incredibly satisfying pack opener.**

The pack opening gets the player through the door.

The collection keeps them engaged.

The economy gives decisions meaning.

Grading and sealed investing create longer-term goals.

Set completion gives structure.

The market creates stories.

And the huge historical catalogue gives the game an almost endless amount of content to explore.

The key architectural decision is to make **cards, sets, products, pull tables, prices and game rules data-driven**. Once that foundation is correct, adding another set should primarily mean importing data and configuring rules—not writing another version of the game.

---

## Reference Notes

Current web research used to inform this document:

- PkmnCards set catalogue: broad historical set coverage across multiple Pokémon TCG eras and product categories. citeturn688332search0
- PkmnCards advanced search: exposes set, series and many rarity classifications useful for normalization. citeturn688332search3
- PkmnCards card search: shows the scale of the indexed card catalogue. citeturn688332search4
- PkmnCards about page: describes its purpose as a high-quality Pokémon card reference/database. citeturn688332search7
- My TCG Collection: describes itself as a free Pokémon pack simulator and collection tracker. citeturn283709search0

