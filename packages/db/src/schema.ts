import {
  pgTable, text, integer, timestamp, jsonb, boolean, index, uniqueIndex, primaryKey,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * Conventions
 *  - Money is always `integer` cents. Never numeric, never float.
 *  - Real-world catalogue tables (sets, cards, pack_templates, pull_tables,
 *    products) are rebuildable from the importers and carry no player data.
 *  - Game tables reference cards by id but never inherit their mutability.
 */

// ---------------------------------------------------------------------------
// Real-world data layer
// ---------------------------------------------------------------------------

export const sets = pgTable('sets', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  series: text('series').notNull(),
  era: text('era').notNull(),
  releaseDate: text('release_date').notNull(),
  printedTotal: integer('printed_total').notNull().default(0),
  total: integer('total').notNull().default(0),
  logoUrl: text('logo_url'),
  symbolUrl: text('symbol_url'),
  source: text('source').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('sets_era_idx').on(t.era),
  index('sets_release_idx').on(t.releaseDate),
]);

export const cards = pgTable('cards', {
  id: text('id').primaryKey(),
  setId: text('set_id').notNull().references(() => sets.id, { onDelete: 'cascade' }),
  number: text('number').notNull(),
  name: text('name').notNull(),
  rarityRaw: text('rarity_raw'),
  rarityTier: text('rarity_tier').notNull(),
  supertype: text('supertype'),
  subtypes: jsonb('subtypes').$type<string[]>().notNull().default([]),
  types: jsonb('types').$type<string[]>().notNull().default([]),
  hp: text('hp'),
  artist: text('artist'),
  nationalPokedexNumbers: jsonb('national_pokedex_numbers').$type<number[]>().notNull().default([]),
  imageSmall: text('image_small'),
  imageLarge: text('image_large'),
  /** Baseline market price in cents; null when no price source covers the card. */
  marketBasePrice: integer('market_base_price'),
  priceConfidence: text('price_confidence').notNull().default('unknown'),
  priceUpdatedAt: timestamp('price_updated_at'),
  source: text('source').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('cards_set_idx').on(t.setId),
  index('cards_rarity_idx').on(t.rarityTier),
  index('cards_name_idx').on(t.name),
  index('cards_set_rarity_idx').on(t.setId, t.rarityTier),
  uniqueIndex('cards_set_number_uq').on(t.setId, t.number),
]);

export const packTemplates = pgTable('pack_templates', {
  id: text('id').primaryKey(),
  setId: text('set_id').notNull().references(() => sets.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  productType: text('product_type').notNull().default('booster_pack'),
  cardsPerPack: integer('cards_per_pack').notNull(),
  /** Ordered PackSlot[]; see @pcs/shared domain types. */
  slots: jsonb('slots').$type<unknown[]>().notNull(),
  simulatorPrice: integer('simulator_price').notNull(),
  confidence: text('confidence').notNull(),
  source: text('source').notNull(),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [index('pack_templates_set_idx').on(t.setId)]);

export const pullTables = pgTable('pull_tables', {
  id: text('id').primaryKey(),
  setId: text('set_id').notNull().references(() => sets.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  selectionMode: text('selection_mode').notNull(),
  entries: jsonb('entries').$type<unknown[]>().notNull(),
  rarityWeights: jsonb('rarity_weights').$type<Record<string, number>>(),
  confidence: text('confidence').notNull(),
  source: text('source').notNull(),
  version: integer('version').notNull().default(1),
}, (t) => [index('pull_tables_set_idx').on(t.setId)]);

export const products = pgTable('products', {
  id: text('id').primaryKey(),
  setId: text('set_id').references(() => sets.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  type: text('type').notNull(),
  simulatorPrice: integer('simulator_price').notNull(),
  sealedBaseValue: integer('sealed_base_value').notNull(),
  contents: jsonb('contents').$type<Record<string, unknown>>().notNull(),
  imageUrl: text('image_url'),
  source: text('source').notNull(),
}, (t) => [index('products_set_idx').on(t.setId)]);

// ---------------------------------------------------------------------------
// Game layer
// ---------------------------------------------------------------------------

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  /** Opaque value stored in an httpOnly cookie; nullable once real auth lands. */
  sessionToken: text('session_token'),
  displayName: text('display_name'),
  cash: integer('cash').notNull(),
  xp: integer('xp').notNull().default(0),
  level: integer('level').notNull().default(1),
  albumCapacity: integer('album_capacity').notNull().default(100),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('users_session_uq').on(t.sessionToken)]);

/**
 * One row per physical card the player owns. Two copies of the same card have
 * different histories and different values, so quantity is deliberately absent
 * for cards (design doc section 9). Sealed products do use quantity.
 */
export const inventoryItems = pgTable('inventory_items', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  cardId: text('card_id').references(() => cards.id),
  productId: text('product_id').references(() => products.id),
  packTemplateId: text('pack_template_id').references(() => packTemplates.id),
  quantity: integer('quantity').notNull().default(1),
  condition: text('condition'),
  acquisitionSource: text('acquisition_source').notNull(),
  acquisitionPrice: integer('acquisition_price').notNull(),
  status: text('status').notNull().default('owned'),
  favorite: boolean('favorite').notNull().default(false),
  gradingId: text('grading_id'),
  acquiredAt: timestamp('acquired_at').notNull().defaultNow(),
}, (t) => [
  index('inventory_user_idx').on(t.userId),
  index('inventory_user_card_idx').on(t.userId, t.cardId),
  index('inventory_user_status_idx').on(t.userId, t.status),
]);

export const openings = pgTable('openings', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  packTemplateId: text('pack_template_id').notNull().references(() => packTemplates.id),
  templateVersion: integer('template_version').notNull(),
  cost: integer('cost').notNull(),
  /** Seed is hashed, never stored raw, so past openings cannot be replayed. */
  rngSeedHash: text('rng_seed_hash').notNull(),
  totalValue: integer('total_value').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [index('openings_user_idx').on(t.userId, t.createdAt)]);

export const openingCards = pgTable('opening_cards', {
  id: text('id').primaryKey(),
  openingId: text('opening_id').notNull().references(() => openings.id, { onDelete: 'cascade' }),
  cardId: text('card_id').notNull().references(() => cards.id),
  inventoryItemId: text('inventory_item_id').references(() => inventoryItems.id, { onDelete: 'set null' }),
  slotName: text('slot_name').notNull(),
  slotIndex: integer('slot_index').notNull(),
  valueAtPull: integer('value_at_pull'),
}, (t) => [index('opening_cards_opening_idx').on(t.openingId)]);

export const grades = pgTable('grades', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  inventoryItemId: text('inventory_item_id').notNull().references(() => inventoryItems.id, { onDelete: 'cascade' }),
  gradeCompany: text('grade_company').notNull(),
  serviceTier: text('service_tier').notNull(),
  numericGrade: integer('numeric_grade'),
  label: text('label'),
  submissionFee: integer('submission_fee').notNull(),
  status: text('status').notNull().default('queued'),
  submittedAt: timestamp('submitted_at').notNull().defaultNow(),
  readyAt: timestamp('ready_at').notNull(),
  completedAt: timestamp('completed_at'),
}, (t) => [
  index('grades_user_idx').on(t.userId, t.status),
  // A physical inventory copy can only ever receive one grade.
  uniqueIndex('grades_inventory_item_uq').on(t.inventoryItemId),
]);

/** Every action that moves money writes one of these. The ledger is the truth. */
export const transactions = pgTable('transactions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  /** Signed: negative is money leaving the player. */
  amount: integer('amount').notNull(),
  balanceAfter: integer('balance_after').notNull(),
  itemType: text('item_type'),
  itemId: text('item_id'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [index('transactions_user_idx').on(t.userId, t.createdAt)]);

/** Per-card market state, so prices can drift without touching the catalogue. */
export const marketState = pgTable('market_state', {
  cardId: text('card_id').primaryKey().references(() => cards.id, { onDelete: 'cascade' }),
  currentPrice: integer('current_price').notNull(),
  trendModifier: integer('trend_modifier_bp').notNull().default(10000),
  demandModifier: integer('demand_modifier_bp').notNull().default(10000),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const priceHistory = pgTable('price_history', {
  cardId: text('card_id').notNull().references(() => cards.id, { onDelete: 'cascade' }),
  day: text('day').notNull(),
  price: integer('price').notNull(),
}, (t) => [primaryKey({ columns: [t.cardId, t.day] })]);

export const marketEvents = pgTable('market_events', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(),
  headline: text('headline').notNull(),
  body: text('body'),
  scope: jsonb('scope').$type<Record<string, unknown>>().notNull(),
  magnitudeBp: integer('magnitude_bp').notNull(),
  startsAt: timestamp('starts_at').notNull(),
  endsAt: timestamp('ends_at').notNull(),
});

export const missions = pgTable('missions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  templateId: text('template_id').notNull(),
  cadence: text('cadence').notNull(),
  progress: integer('progress').notNull().default(0),
  target: integer('target').notNull(),
  rewardCash: integer('reward_cash').notNull().default(0),
  rewardXp: integer('reward_xp').notNull().default(0),
  claimedAt: timestamp('claimed_at'),
  expiresAt: timestamp('expires_at'),
}, (t) => [
  index('missions_user_idx').on(t.userId, t.cadence),
  // A mission reward is claimable once per window. templateId carries the
  // window ('daily_open_3:2026-08-31'), so this unique key is what actually
  // stops a player claiming the same reward on a loop — the check happens in
  // the database, not in application code that a concurrent request can race.
  uniqueIndex('missions_user_template_uq').on(t.userId, t.templateId),
]);

export const analyticsEvents = pgTable('analytics_events', {
  id: text('id').primaryKey(),
  userId: text('user_id'),
  name: text('name').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [index('analytics_name_idx').on(t.name, t.createdAt)]);

/**
 * Player marketplace listings (DESIGN.md section 10).
 *
 * One listing per inventory item, enforced by a unique index: a card cannot be
 * on sale twice, and the constraint is what prevents a double-sale race rather
 * than a check that happened a moment earlier.
 *
 * `visits` and `lastCheckedAt` are how elapsed time is resolved. Buyers arrive
 * lazily when the player looks, and the consumed visits are persisted, so a
 * refresh cannot re-roll a visitor who declined.
 */
export const listings = pgTable('listings', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  inventoryItemId: text('inventory_item_id').notNull()
    .references(() => inventoryItems.id, { onDelete: 'cascade' }),
  cardId: text('card_id').notNull().references(() => cards.id),
  askPrice: integer('ask_price').notNull(),
  /** Market value when listed, so the ratio the player chose is recoverable. */
  marketValueAtListing: integer('market_value_at_listing').notNull(),
  status: text('status').notNull().default('active'),
  visits: integer('visits').notNull().default(0),
  listedAt: timestamp('listed_at').notNull().defaultNow(),
  lastCheckedAt: timestamp('last_checked_at').notNull().defaultNow(),
  soldAt: timestamp('sold_at'),
  soldPrice: integer('sold_price'),
  feePaid: integer('fee_paid'),
  buyerName: text('buyer_name'),
  buyerNote: text('buyer_note'),
}, (t) => [
  index('listings_user_status_idx').on(t.userId, t.status),
  index('listings_active_idx').on(t.status, t.lastCheckedAt),
  // Only one active listing per physical card; cancelled/sold rows stay for history
  uniqueIndex('listings_item_uq').on(t.inventoryItemId).where(sql`${t.status} = 'active'`),
]);
