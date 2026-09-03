CREATE TABLE "minigame_cosmetics" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"cosmetic_id" text NOT NULL,
	"game" text NOT NULL,
	"equipped" boolean DEFAULT false NOT NULL,
	"acquired_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "minigame_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"game" text NOT NULL,
	"seed" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"score" integer,
	"duration_ms" integer,
	"payout" integer,
	"reject_reason" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"settled_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "minigame_cosmetics" ADD CONSTRAINT "minigame_cosmetics_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "minigame_runs" ADD CONSTRAINT "minigame_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "minigame_cosmetics_user_item_uq" ON "minigame_cosmetics" USING btree ("user_id","cosmetic_id");--> statement-breakpoint
CREATE UNIQUE INDEX "minigame_cosmetics_equipped_uq" ON "minigame_cosmetics" USING btree ("user_id","game") WHERE "minigame_cosmetics"."equipped";--> statement-breakpoint
CREATE INDEX "minigame_cosmetics_user_idx" ON "minigame_cosmetics" USING btree ("user_id","game");--> statement-breakpoint
CREATE INDEX "minigame_runs_user_idx" ON "minigame_runs" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE INDEX "minigame_runs_open_idx" ON "minigame_runs" USING btree ("user_id","game","status");