CREATE TABLE "npc_negotiations" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"stock_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"anger" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"counter_price" integer NOT NULL,
	"last_offer" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "npc_shop_rotations" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"shop_id" text NOT NULL,
	"rotation_number" integer NOT NULL,
	"wanted_criteria" jsonb NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"refresh_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "npc_shop_stock" (
	"id" text PRIMARY KEY NOT NULL,
	"rotation_id" text NOT NULL,
	"user_id" text NOT NULL,
	"shop_id" text NOT NULL,
	"slot" integer NOT NULL,
	"card_id" text NOT NULL,
	"condition" text NOT NULL,
	"grade_company" text,
	"numeric_grade" integer,
	"grade_label" text,
	"is_black_label" boolean DEFAULT false NOT NULL,
	"market_value" integer NOT NULL,
	"ask_price" integer NOT NULL,
	"seller_floor" integer NOT NULL,
	"demand_band" text NOT NULL,
	"other_buyer_at" timestamp NOT NULL,
	"status" text DEFAULT 'available' NOT NULL,
	"hold_user_id" text,
	"hold_until" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "npc_negotiations" ADD CONSTRAINT "npc_negotiations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "npc_negotiations" ADD CONSTRAINT "npc_negotiations_stock_id_npc_shop_stock_id_fk" FOREIGN KEY ("stock_id") REFERENCES "public"."npc_shop_stock"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "npc_shop_rotations" ADD CONSTRAINT "npc_shop_rotations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "npc_shop_stock" ADD CONSTRAINT "npc_shop_stock_rotation_id_npc_shop_rotations_id_fk" FOREIGN KEY ("rotation_id") REFERENCES "public"."npc_shop_rotations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "npc_shop_stock" ADD CONSTRAINT "npc_shop_stock_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "npc_shop_stock" ADD CONSTRAINT "npc_shop_stock_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "npc_shop_stock" ADD CONSTRAINT "npc_shop_stock_hold_user_id_users_id_fk" FOREIGN KEY ("hold_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "npc_negotiations_active_uq" ON "npc_negotiations" USING btree ("user_id","stock_id") WHERE "npc_negotiations"."status" = 'active';--> statement-breakpoint
CREATE INDEX "npc_negotiations_user_idx" ON "npc_negotiations" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "npc_rotations_user_shop_number_uq" ON "npc_shop_rotations" USING btree ("user_id","shop_id","rotation_number");--> statement-breakpoint
CREATE INDEX "npc_rotations_due_idx" ON "npc_shop_rotations" USING btree ("user_id","shop_id","refresh_at");--> statement-breakpoint
CREATE UNIQUE INDEX "npc_stock_rotation_slot_uq" ON "npc_shop_stock" USING btree ("rotation_id","slot");--> statement-breakpoint
CREATE INDEX "npc_stock_user_shop_status_idx" ON "npc_shop_stock" USING btree ("user_id","shop_id","status");--> statement-breakpoint
CREATE INDEX "npc_stock_due_idx" ON "npc_shop_stock" USING btree ("status","other_buyer_at");