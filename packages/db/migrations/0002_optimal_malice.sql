CREATE TABLE "listings" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"inventory_item_id" text NOT NULL,
	"card_id" text NOT NULL,
	"ask_price" integer NOT NULL,
	"market_value_at_listing" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"visits" integer DEFAULT 0 NOT NULL,
	"listed_at" timestamp DEFAULT now() NOT NULL,
	"last_checked_at" timestamp DEFAULT now() NOT NULL,
	"sold_at" timestamp,
	"sold_price" integer,
	"fee_paid" integer,
	"buyer_name" text,
	"buyer_note" text
);
--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_inventory_item_id_inventory_items_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "listings_user_status_idx" ON "listings" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "listings_active_idx" ON "listings" USING btree ("status","last_checked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "listings_item_uq" ON "listings" USING btree ("inventory_item_id");