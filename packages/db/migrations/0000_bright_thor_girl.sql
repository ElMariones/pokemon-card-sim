CREATE TABLE "analytics_events" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"name" text NOT NULL,
	"payload" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cards" (
	"id" text PRIMARY KEY NOT NULL,
	"set_id" text NOT NULL,
	"number" text NOT NULL,
	"name" text NOT NULL,
	"rarity_raw" text,
	"rarity_tier" text NOT NULL,
	"supertype" text,
	"subtypes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"types" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"hp" text,
	"artist" text,
	"national_pokedex_numbers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"image_small" text,
	"image_large" text,
	"market_base_price" integer,
	"price_confidence" text DEFAULT 'unknown' NOT NULL,
	"price_updated_at" timestamp,
	"source" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grades" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"inventory_item_id" text NOT NULL,
	"grade_company" text NOT NULL,
	"service_tier" text NOT NULL,
	"numeric_grade" integer,
	"label" text,
	"submission_fee" integer NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"submitted_at" timestamp DEFAULT now() NOT NULL,
	"ready_at" timestamp NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "inventory_items" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"card_id" text,
	"product_id" text,
	"pack_template_id" text,
	"quantity" integer DEFAULT 1 NOT NULL,
	"condition" text,
	"acquisition_source" text NOT NULL,
	"acquisition_price" integer NOT NULL,
	"status" text DEFAULT 'owned' NOT NULL,
	"favorite" boolean DEFAULT false NOT NULL,
	"grading_id" text,
	"acquired_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_events" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"headline" text NOT NULL,
	"body" text,
	"scope" jsonb NOT NULL,
	"magnitude_bp" integer NOT NULL,
	"starts_at" timestamp NOT NULL,
	"ends_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_state" (
	"card_id" text PRIMARY KEY NOT NULL,
	"current_price" integer NOT NULL,
	"trend_modifier_bp" integer DEFAULT 10000 NOT NULL,
	"demand_modifier_bp" integer DEFAULT 10000 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "missions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"template_id" text NOT NULL,
	"cadence" text NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"target" integer NOT NULL,
	"reward_cash" integer DEFAULT 0 NOT NULL,
	"reward_xp" integer DEFAULT 0 NOT NULL,
	"claimed_at" timestamp,
	"expires_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "opening_cards" (
	"id" text PRIMARY KEY NOT NULL,
	"opening_id" text NOT NULL,
	"card_id" text NOT NULL,
	"inventory_item_id" text,
	"slot_name" text NOT NULL,
	"slot_index" integer NOT NULL,
	"value_at_pull" integer
);
--> statement-breakpoint
CREATE TABLE "openings" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"pack_template_id" text NOT NULL,
	"template_version" integer NOT NULL,
	"cost" integer NOT NULL,
	"rng_seed_hash" text NOT NULL,
	"total_value" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pack_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"set_id" text NOT NULL,
	"name" text NOT NULL,
	"product_type" text DEFAULT 'booster_pack' NOT NULL,
	"cards_per_pack" integer NOT NULL,
	"slots" jsonb NOT NULL,
	"simulator_price" integer NOT NULL,
	"confidence" text NOT NULL,
	"source" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_history" (
	"card_id" text NOT NULL,
	"day" text NOT NULL,
	"price" integer NOT NULL,
	CONSTRAINT "price_history_card_id_day_pk" PRIMARY KEY("card_id","day")
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" text PRIMARY KEY NOT NULL,
	"set_id" text,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"simulator_price" integer NOT NULL,
	"sealed_base_value" integer NOT NULL,
	"contents" jsonb NOT NULL,
	"image_url" text,
	"source" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pull_tables" (
	"id" text PRIMARY KEY NOT NULL,
	"set_id" text NOT NULL,
	"name" text NOT NULL,
	"selection_mode" text NOT NULL,
	"entries" jsonb NOT NULL,
	"rarity_weights" jsonb,
	"confidence" text NOT NULL,
	"source" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sets" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"series" text NOT NULL,
	"era" text NOT NULL,
	"release_date" text NOT NULL,
	"printed_total" integer DEFAULT 0 NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"logo_url" text,
	"symbol_url" text,
	"source" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"amount" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"item_type" text,
	"item_id" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"session_token" text,
	"display_name" text,
	"cash" integer NOT NULL,
	"xp" integer DEFAULT 0 NOT NULL,
	"level" integer DEFAULT 1 NOT NULL,
	"album_capacity" integer DEFAULT 100 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_set_id_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grades" ADD CONSTRAINT "grades_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grades" ADD CONSTRAINT "grades_inventory_item_id_inventory_items_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_pack_template_id_pack_templates_id_fk" FOREIGN KEY ("pack_template_id") REFERENCES "public"."pack_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_state" ADD CONSTRAINT "market_state_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "missions" ADD CONSTRAINT "missions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_cards" ADD CONSTRAINT "opening_cards_opening_id_openings_id_fk" FOREIGN KEY ("opening_id") REFERENCES "public"."openings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_cards" ADD CONSTRAINT "opening_cards_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_cards" ADD CONSTRAINT "opening_cards_inventory_item_id_inventory_items_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "openings" ADD CONSTRAINT "openings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "openings" ADD CONSTRAINT "openings_pack_template_id_pack_templates_id_fk" FOREIGN KEY ("pack_template_id") REFERENCES "public"."pack_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pack_templates" ADD CONSTRAINT "pack_templates_set_id_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_set_id_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_tables" ADD CONSTRAINT "pull_tables_set_id_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analytics_name_idx" ON "analytics_events" USING btree ("name","created_at");--> statement-breakpoint
CREATE INDEX "cards_set_idx" ON "cards" USING btree ("set_id");--> statement-breakpoint
CREATE INDEX "cards_rarity_idx" ON "cards" USING btree ("rarity_tier");--> statement-breakpoint
CREATE INDEX "cards_name_idx" ON "cards" USING btree ("name");--> statement-breakpoint
CREATE INDEX "cards_set_rarity_idx" ON "cards" USING btree ("set_id","rarity_tier");--> statement-breakpoint
CREATE UNIQUE INDEX "cards_set_number_uq" ON "cards" USING btree ("set_id","number");--> statement-breakpoint
CREATE INDEX "grades_user_idx" ON "grades" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "inventory_user_idx" ON "inventory_items" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "inventory_user_card_idx" ON "inventory_items" USING btree ("user_id","card_id");--> statement-breakpoint
CREATE INDEX "inventory_user_status_idx" ON "inventory_items" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "missions_user_idx" ON "missions" USING btree ("user_id","cadence");--> statement-breakpoint
CREATE INDEX "opening_cards_opening_idx" ON "opening_cards" USING btree ("opening_id");--> statement-breakpoint
CREATE INDEX "openings_user_idx" ON "openings" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "pack_templates_set_idx" ON "pack_templates" USING btree ("set_id");--> statement-breakpoint
CREATE INDEX "products_set_idx" ON "products" USING btree ("set_id");--> statement-breakpoint
CREATE INDEX "pull_tables_set_idx" ON "pull_tables" USING btree ("set_id");--> statement-breakpoint
CREATE INDEX "sets_era_idx" ON "sets" USING btree ("era");--> statement-breakpoint
CREATE INDEX "sets_release_idx" ON "sets" USING btree ("release_date");--> statement-breakpoint
CREATE INDEX "transactions_user_idx" ON "transactions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_session_uq" ON "users" USING btree ("session_token");