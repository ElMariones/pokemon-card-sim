ALTER TABLE "pack_templates" ADD COLUMN "market_base_price" integer;--> statement-breakpoint
ALTER TABLE "pack_templates" ADD COLUMN "price_confidence" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "pack_templates" ADD COLUMN "price_source" text;--> statement-breakpoint
ALTER TABLE "pack_templates" ADD COLUMN "price_updated_at" timestamp;